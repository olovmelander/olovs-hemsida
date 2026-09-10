import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tortunaCampaigns, rasteriserFeatures, orthoAbsentOverrides, EXCLUSION_INPUTS } from './compile-objects.mjs';
import { readActivePublishedGround } from '../../../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { readChunk } from '../../../../packages/course-v2/chunk-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const json = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('the campaign inventory is the pinned canopy evidence, not a second copy of it', () => {
  const evidence = json('geo_data/course-v2/tortuna/vegetation/canopy-evidence.json');
  const campaigns = tortunaCampaigns(evidence);
  assert.deepEqual(campaigns.activeItemIds, ['21c035-661_59']);
  assert.equal(campaigns.items[0].captureEnd, '2021-04-10T00:00:00Z');
  assert.deepEqual(campaigns.items[0].projBbox, [590000, 6610000, 600000, 6620000]);
});

test('Lidingö-format exclusion records become rasteriser features, kind by kind, holes dropped', () => {
  const features = rasteriserFeatures([
    { id: 'a', kind: 'building', polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 2]]]], lines: [] },
    { id: 'b', kind: 'road', polygons: [], lines: [[[0, 0], [100, 0]]] },
    { id: 'c', kind: 'override', polygons: [], lines: [] },
  ]);
  assert.deepEqual(features.map(f => f.kind), ['building', 'road']);
  assert.equal(features[0].rings.length, 1);
  assert.equal(features[1].lines[0].length, 2);
});

test('an imagery-absent crown becomes an override disc of at least 2 m', () => {
  const { kind, rings } = orthoAbsentOverrides({ absent: { keys: [{ easting: 597000, northing: 6615000, radiusMetres: 0.5 }, { easting: 597100, northing: 6615000, radiusMetres: 3 }] } });
  assert.equal(kind, 'override');
  assert.equal(rings.length, 2);
  const radius = ring => Math.hypot(ring[0][0] - 597000, ring[0][1] - 6615000);
  assert.ok(Math.abs(radius(rings[0]) - 2) < 1e-9);
  assert.ok(Math.abs(Math.hypot(rings[1][0][0] - 597100, rings[1][0][1] - 6615000) - 4) < 1e-9);
});

test('the exclusion inventory is the stand compiler\'s, so the two layers agree on what is not a tree', async () => {
  const stands = await import('./compile-stands.mjs');
  const src = fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/tortuna/vegetation/compile-stands.mjs'), 'utf8');
  for (const input of EXCLUSION_INPUTS) assert.ok(src.includes(`'${input}'`), `${input} is a stand-compiler input`);
  assert.equal(typeof stands.tortunaExclusionFeatures, 'function');
});

test('the published ground carries the compiled object layer: every record tile a finest terrain tile, every chunk the bytes the evidence names', () => {
  const evidence = json('geo_data/course-v2/tortuna/vegetation/objects-evidence.json');
  const review = json('geo_data/course-v2/tortuna/vegetation/ortho-crown-review.json');
  const { ground } = readActivePublishedGround(path.join(ROOT, 'apps/golf/public'), 'tortuna');
  const tiles = new Map(ground.tiles.map(tile => [tile.id, tile]));
  let records = 0;
  for (const [tileId, reference] of Object.entries(evidence.layers.objects)) {
    const tile = tiles.get(tileId);
    assert.ok(tile && tile.lod === 0, `${tileId} is a finest tile`);
    assert.deepEqual(tile.layers.objects, reference, `${tileId} serves the compiled object chunk`);
    const bytes = fs.readFileSync(path.join(ROOT, 'apps/golf/public', reference.url));
    assert.equal(sha256(bytes), reference.sha256);
    const chunk = readChunk(bytes);
    assert.equal(chunk.header.kind, 'objects');
    records += chunk.content.records?.length ?? chunk.content.length ?? 0;
  }
  assert.equal(Object.keys(evidence.layers.objects).length, evidence.records.tiles);
  assert.equal(records, evidence.records.count, 'the published records are the compiled ones');
  for (const [tileId, reference] of Object.entries(evidence.layers.stands)) {
    assert.deepEqual(tiles.get(tileId).layers.stands, reference, `${tileId} serves the recompiled stand field`);
  }
  /* the imagery check is the record the compile was made against */
  assert.equal(evidence.orthophotoCheck.refused, review.refused.count);
  assert.equal(evidence.orthophotoCheck.promoted, review.promoted.count);
  assert.ok(review.census?.verdict.startsWith('NOT ADOPTED'), 'the ortho-only census stays a record, not a layer');
  assert.ok(ground.tiles.filter(tile => tile.layers.stands).length >= 120, 'the expanded-window stand tiles are kept');
});
