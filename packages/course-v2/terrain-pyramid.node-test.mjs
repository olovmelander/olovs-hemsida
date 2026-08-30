import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTerrainGrid, encodeTerrainGrid } from './terrain-grid.mjs';
import {
  TerrainPyramidSampler,
  compileTerrainPyramid,
  sampleTerrainTile,
} from './terrain-pyramid.mjs';

function terrain(width, height) {
  const values = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      values[row * width + column] = 40 + column * 0.25 + row * 0.5;
    }
  }
  values[3 * width + 3] += 3;
  return values;
}

test('terrain encoder accepts a shared quantization origin for crack-free neighboring tiles', () => {
  const west = encodeTerrainGrid({
    heights: [40, 40.5, 41, 41.5], width: 2, height: 2,
    heightOffsetMetres: 30, heightScaleMetres: 0.01,
  });
  const east = encodeTerrainGrid({
    heights: [41, 41.5, 42, 42.5], width: 2, height: 2,
    heightOffsetMetres: 30, heightScaleMetres: 0.01,
  });
  assert.equal(west.grid.heightOffsetMetres, 30);
  assert.equal(east.grid.heightOffsetMetres, 30);
  assert.throws(() => encodeTerrainGrid({
    heights: [40, 40.5, 41, 41.5], width: 2, height: 2,
    heightOffsetMetres: Number.NaN,
  }), /must be finite/);
});

test('terrain pyramid produces deterministic overlapping tiles, LOD error and a one-tile shell', () => {
  const heights = terrain(9, 9);
  const options = {
    heights,
    width: 9,
    height: 9,
    originEasting: 700000,
    originNorthing: 6600000,
    tileSegments: 4,
    heightScaleMetres: 0.01,
  };
  const first = compileTerrainPyramid(options);
  const second = compileTerrainPyramid(options);
  assert.equal(first.maximumLod, 1);
  assert.equal(first.levels[0].tiles.length, 4);
  assert.equal(first.levels[1].tiles.length, 1);
  assert.equal(first.shell.id, 'l1/0/0');
  assert.equal(first.seamsVerified, true);
  assert.equal(first.morphMethod, 'bilinear-even-samples-v1');
  assert.ok(first.levels[0].tiles.every(tile => Math.abs(tile.grid.geometricErrorMetres - 0.005) < 1e-12));
  assert.ok(first.shell.grid.geometricErrorMetres > 2.9);
  assert.deepEqual(first.levels.map(level => level.tiles.map(tile => tile.payload)),
    second.levels.map(level => level.tiles.map(tile => tile.payload)));

  const northWest = first.levels[0].tiles.find(tile => tile.id === 'l0/0/0');
  const northEast = first.levels[0].tiles.find(tile => tile.id === 'l0/1/0');
  const westView = new DataView(northWest.payload.buffer, northWest.payload.byteOffset, northWest.payload.byteLength);
  const eastView = new DataView(northEast.payload.buffer, northEast.payload.byteOffset, northEast.payload.byteLength);
  for (let row = 0; row < 5; row++) {
    assert.equal(westView.getUint16((row * 5 + 4) * 2, true), eastView.getUint16(row * 5 * 2, true));
  }
});

test('CPU sampler uses the finest resident tile and falls back to the shared shell', () => {
  const heights = terrain(9, 9);
  const pyramid = compileTerrainPyramid({
    heights,
    width: 9,
    height: 9,
    originEasting: 700000,
    originNorthing: 6600000,
    tileSegments: 4,
  });
  const sampler = new TerrainPyramidSampler(pyramid);
  const exact = sampler.sample(700002, 6599998);
  assert.equal(exact.tileId, 'l0/0/0');
  assert.equal(exact.lod, 0);
  assert.ok(Math.abs(exact.heightRH2000 - heights[2 * 9 + 2]) <= 0.005001);

  const shellOnly = sampler.sample(700002, 6599998, {
    availableTileIds: new Set(['l1/0/0']),
  });
  assert.equal(shellOnly.tileId, 'l1/0/0');
  assert.equal(shellOnly.lod, 1);
  assert.ok(Number.isFinite(shellOnly.heightRH2000));
  assert.ok(Number.isNaN(sampleTerrainTile(pyramid.shell, 699999, 6599998)));
});

test('rectangular non-power-of-two tile extents receive one bounded fallback shell', () => {
  const pyramid = compileTerrainPyramid({
    heights: terrain(13, 9),
    width: 13,
    height: 9,
    originEasting: 700000,
    originNorthing: 6600000,
    tileSegments: 4,
  });
  assert.equal(pyramid.maximumLod, 0);
  assert.equal(pyramid.levels[0].tiles.length, 6);
  assert.equal(pyramid.shell.id, 'shell');
  assert.equal(pyramid.shell.grid.width, 4);
  assert.equal(pyramid.shell.grid.height, 3);
  assert.equal(pyramid.shell.grid.sampleSpacingMetres, 4);
  assert.deepEqual(pyramid.shell.bounds, {
    minEasting: 700000,
    minNorthing: 6599992,
    minHeightRH2000: pyramid.shell.bounds.minHeightRH2000,
    maxEasting: 700012,
    maxNorthing: 6600000,
    maxHeightRH2000: pyramid.shell.bounds.maxHeightRH2000,
  });
  const sampled = new TerrainPyramidSampler(pyramid).sample(700006, 6599996, {
    availableTileIds: new Set(['shell']),
  });
  assert.equal(sampled.tileId, 'shell');
  assert.equal(sampled.lod, 2);
  assert.ok(Number.isFinite(sampled.heightRH2000));
});

test('terrain pyramid rejects unaligned grids and LODs that exceed the source hierarchy', () => {
  assert.throws(() => compileTerrainPyramid({
    heights: terrain(8, 9), width: 8, height: 9,
    originEasting: 0, originNorthing: 8, tileSegments: 4,
  }), /tileSegments \* tileCount \+ 1/);
  assert.throws(() => compileTerrainPyramid({
    heights: terrain(9, 9), width: 9, height: 9,
    originEasting: 0, originNorthing: 8, tileSegments: 4, maximumLod: 2,
  }), /maximumLod/);
});

test('compiled tile payload decodes with its shared RH 2000 grid metadata', () => {
  const pyramid = compileTerrainPyramid({
    heights: terrain(9, 9), width: 9, height: 9,
    originEasting: 0, originNorthing: 8, tileSegments: 4,
  });
  const tile = pyramid.levels[0].tiles[0];
  const decoded = decodeTerrainGrid(tile.payload, tile.grid);
  assert.equal(decoded.length, 25);
  assert.ok(decoded.every(Number.isFinite));
});
