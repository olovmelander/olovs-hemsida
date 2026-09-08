import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LIDINGO_CANOPY_CONFIG as config, assertLidingoLaserSource,
  lidingoCanopyTiles, sampleLidingoDtm } from './lidingo-canopy.mjs';
import { LIDINGO_GROUND_GRAPH_CONFIG as terrain } from '../../course-v2/lidingo-ground-graph.mjs';

const source = () => JSON.parse(readFileSync(new URL('../../../geo_data/course-v2/lidingo/acquisition/d2-discovery.json', import.meta.url), 'utf8')).laser.items[0];

test('Lidingö canopy source pins the actual campaign, dates, CRS, checksum and item footprint', () => {
  assert.equal(assertLidingoLaserSource(source()).id, '21c031-658_67');
  for (const mutate of [
    item => { item.captureStart = '2025-05-31T00:00:00Z'; },
    item => { item.projCode = 'EPSG:4979'; },
    item => { item.assets.data.sha256 = 'a'.repeat(64); },
    item => { item.assets.data.bytes += 1; },
    item => { item.projBbox[0] += 10000; },
    item => { item.pointCount -= 1; },
  ]) {
    const altered = source();
    mutate(altered);
    assert.throws(() => assertLidingoLaserSource(altered), /pinned 2021 campaign/);
  }
});

test('64 canopy interiors exactly partition retained terrain bounds with sufficient fill halo', () => {
  const tiles = lidingoCanopyTiles();
  assert.equal(tiles.length, 64);
  assert.equal(new Set(tiles.map(tile => tile.id)).size, 64);
  assert.equal(config.width + 1, terrain.width);
  assert.equal(config.height + 1, terrain.height);
  assert.equal(config.originEasting, terrain.originEasting);
  assert.equal(config.originNorthing, terrain.originNorthing);
  assert.equal(tiles[0].bbox[0], terrain.expectedBounds.minEasting);
  assert.equal(tiles[0].bbox[3], terrain.expectedBounds.maxNorthing);
  assert.equal(tiles.at(-1).bbox[1], terrain.expectedBounds.minNorthing);
  assert.equal(tiles.at(-1).bbox[2], terrain.expectedBounds.maxEasting);
  assert.ok(config.haloMetres >= config.groundFillRadiusCells + 2,
    'nearest fill, smoothing and bilinear interpolation must fit inside the halo');
  for (const tile of tiles) {
    const east = tiles.find(other => other.row === tile.row && other.column === tile.column + 1);
    const south = tiles.find(other => other.column === tile.column && other.row === tile.row + 1);
    if (east) assert.equal(tile.bbox[2], east.bbox[0]);
    if (south) assert.equal(tile.bbox[1], south.bbox[3]);
    assert.ok(tile.window[0] >= config.sourceBounds[0] && tile.window[1] >= config.sourceBounds[1]);
    assert.ok(tile.window[2] <= config.sourceBounds[2] && tile.window[3] <= config.sourceBounds[3]);
  }
});

test('cell-centred laser ground comparison samples the original terrain without a half-pixel shift', () => {
  const width = terrain.width;
  const values = new Float32Array(width * terrain.height);
  for (let row = 0; row < terrain.height; row++) {
    for (let column = 0; column < width; column++) values[row * width + column] = 5 + column * 0.25 + row * 0.5;
  }
  assert.equal(sampleLidingoDtm(values, config.originEasting, config.originNorthing), 5);
  assert.equal(sampleLidingoDtm(values, config.originEasting + 0.5, config.originNorthing - 0.5), 5.375);
  assert.equal(sampleLidingoDtm(values, config.originEasting + 2048, config.originNorthing - 2048), 1541);
  assert.ok(Number.isNaN(sampleLidingoDtm(values, config.originEasting - 0.01, config.originNorthing)));
  assert.throws(() => sampleLidingoDtm(new Float32Array(1), config.originEasting, config.originNorthing), /complete 2049/);
});
