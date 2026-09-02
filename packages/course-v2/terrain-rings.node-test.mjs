import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTerrainRings, createRingSampler } from './terrain-rings.mjs';
import { readChunk } from './chunk-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

/* a smooth field plus one sharp bump near the centre, sampled at any spacing */
function field(easting, northing) {
  const dx = easting - 1000, dy = northing - 2000;
  return 40 + 0.004 * dx + Math.sin(dy / 90) * 3 + (Math.hypot(dx - 7, dy + 5) < 6 ? 4 : 0);
}

function level({ lod, spacing, originEasting, originNorthing, tilesPerSide, tileSegments, heightScaleMetres }) {
  const size = tilesPerSide * tileSegments + 1;
  const heights = new Float64Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = field(originEasting + column * spacing, originNorthing - row * spacing);
  }
  return { lod, sampleSpacingMetres: spacing, originEasting, originNorthing, tilesPerSide, heightScaleMetres, heights };
}

/* tileSegments 8: l0 1 m over 32 m (4 tiles), l1 2 m over 64 m (4 tiles),
   l2 4 m over 128 m (4 tiles), l3 8 m over 128 m (2 tiles), l4 16 m root.
   Every finer ring is a whole number of the coarser level's tiles, placed on
   its lattice, so each tile lies inside exactly one coarser tile and a
   coarser tile is covered by finer ones wholly or not at all. */
function rings() {
  const seg = 8;
  return [
    level({ lod: 0, spacing: 1, originEasting: 984, originNorthing: 2016, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.01 }),
    level({ lod: 1, spacing: 2, originEasting: 968, originNorthing: 2032, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.02 }),
    level({ lod: 2, spacing: 4, originEasting: 936, originNorthing: 2064, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.04 }),
    level({ lod: 3, spacing: 8, originEasting: 936, originNorthing: 2064, tilesPerSide: 2, tileSegments: seg, heightScaleMetres: 0.08 }),
    level({ lod: 4, spacing: 16, originEasting: 936, originNorthing: 2064, tilesPerSide: 1, tileSegments: seg, heightScaleMetres: 0.16 }),
  ];
}

test('nested rings compile into one explicit quadtree with a single root as the shell', () => {
  const compiled = compileTerrainRings({ groundId: 'test-ground', courseSlugs: ['test-course'], levels: rings(), tileSegments: 8 });
  assert.equal(compiled.tiles.length, 16 + 16 + 16 + 4 + 1);
  assert.equal(compiled.stats.rootTiles, 1);
  const byId = new Map(compiled.tiles.map(tile => [tile.id, tile]));
  /* parents are found by footprint, not by index arithmetic: the course
     tiles start one l1 tile in from the l1 origin */
  assert.equal(byId.get('l0/0/0').parentId, 'l1/1/1');
  assert.equal(byId.get('l0/3/3').parentId, 'l1/2/2');
  assert.equal(byId.get('l1/0/0').parentId, 'l2/1/1');
  assert.equal(byId.get('l2/0/0').parentId, 'l3/0/0');
  assert.equal(byId.get('l2/2/2').parentId, 'l3/1/1');
  assert.equal(byId.get('l3/1/1').parentId, 'l4/0/0');
  assert.equal(byId.get('l4/0/0').parentId, null);
  for (const tile of compiled.tiles) {
    if (!tile.parentId) continue;
    const parent = byId.get(tile.parentId);
    assert.ok(parent.bounds.minEasting <= tile.bounds.minEasting && parent.bounds.maxEasting >= tile.bounds.maxEasting);
    assert.ok(parent.bounds.minNorthing <= tile.bounds.minNorthing && parent.bounds.maxNorthing >= tile.bounds.maxNorthing);
    assert.equal(parent.lod, tile.lod + 1);
  }
  /* the shell is the root's payload under the ground's bounds */
  const shell = readChunk(compiled.resources.get(compiled.shell.url));
  assert.equal(shell.header.id, 'shell');
  assert.deepEqual(shell.header.bounds, compiled.bounds);
  assert.equal(compiled.bounds.minEasting, 936);
  assert.equal(compiled.bounds.maxEasting, 936 + 128);
  /* the coarser levels measure their error against the finest data under them:
     the bump only exists at 1 m, so the l1 tile over it carries it and the
     l1 tiles away from the course carry only their own quantization */
  assert.ok(byId.get('l1/2/2').geometricErrorMetres > 1, `bump error ${byId.get('l1/2/2').geometricErrorMetres}`);
  assert.ok(byId.get('l1/0/0').geometricErrorMetres < 0.5, `outer l1 error ${byId.get('l1/0/0').geometricErrorMetres}`);
  /* every chunk decodes to the level it was cut from, on that level's lattice */
  const tile = byId.get('l2/0/1');
  const chunk = readChunk(compiled.resources.get(tile.layers.terrain.url));
  const heights = decodeTerrainGrid(chunk.payload, chunk.header.grid);
  assert.equal(chunk.header.grid.heightScaleMetres, 0.04);
  assert.equal(chunk.header.grid.sampleSpacingMetres, 4);
  assert.ok(Math.abs(heights[0] - field(tile.bounds.minEasting, tile.bounds.maxNorthing)) <= 0.02);
  assert.equal(chunk.header.grid.geometricErrorMetres, tile.geometricErrorMetres);
});

test('a published tile is reused byte for byte when it decodes to the compiled heights', () => {
  const first = compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8 });
  const published = new Map(first.tiles.filter(tile => tile.lod === 0).map(tile => {
    const chunkBytes = first.resources.get(tile.layers.terrain.url);
    const chunk = readChunk(chunkBytes);
    return [tile.id, { chunk: chunkBytes, reference: tile.layers.terrain, grid: chunk.header.grid, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid) }];
  }));
  const second = compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8,
    reuse: (lod, column, row) => published.get(`l${lod}/${column}/${row}`) ?? null,
  });
  assert.equal(second.stats.reusedTiles, 16);
  const changed = rings();
  changed[0].heights[5] += 1;
  assert.throws(() => compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: changed, tileSegments: 8,
    reuse: (lod, column, row) => published.get(`l${lod}/${column}/${row}`) ?? null,
  }), /differs from the compiled heights/);
});

test('misaligned or unnested rings are refused', () => {
  const misaligned = rings();
  misaligned[1] = { ...misaligned[1], originEasting: 975 };
  const partial = rings();
  partial[1] = { ...partial[1], tilesPerSide: 3, heights: partial[1].heights.subarray(0, 25 * 25) };
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: partial, tileSegments: 8 }), /whole level 2 tiles/);
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: misaligned, tileSegments: 8 }), /not aligned/);
  const escaping = rings();
  escaping[0] = level({ lod: 0, spacing: 1, originEasting: 900, originNorthing: 2016, tilesPerSide: 4, tileSegments: 8, heightScaleMetres: 0.01 });
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: escaping, tileSegments: 8 }), /leaves level/);
  const twoRoots = rings().slice(0, 4);
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: twoRoots, tileSegments: 8 }), /single root/);
});

test('the ring sampler reads the finest level under a point', () => {
  const sample = createRingSampler(rings());
  assert.ok(Math.abs(sample(1000, 2000) - field(1000, 2000)) < 1e-9, 'inside the 1 m ring the 1 m data is exact');
  assert.ok(Math.abs(sample(940, 2060) - field(940, 2060)) < 0.5, 'far out the 8 m data still answers');
  assert.ok(Number.isNaN(sample(0, 0)));
});
