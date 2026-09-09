import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { ringSpecFor, ringLevelExtent } from './ground-rings-registry.mjs';
import { LIDINGO_V2_CONFIG as config } from '../../apps/golf/src/engine/v2-lidingo-config.mjs';
import { refusePublishedRingOverwrite } from './ground-ring-publication-guard.mjs';

const publicDirectory = new URL('../../apps/golf/public/', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, publicDirectory)));
const course = read(read('courses/v2-index.json').courses.find(c => c.slug === 'lidingo').manifest.url);
const ground = read(course.groundManifest.url);

test('Lidingö serves one complete 16 km quadtree with the exact native course window', () => {
  const spec = ringSpecFor('lidingo');
  assert.equal(ground.tiles.length, 277);
  assert.equal(ground.tiles.filter(t => t.parentId).length, 276);
  assert.deepEqual(spec.levels.map(l => ground.tiles.filter(t => t.lod === l.lod).length), config.ringGraph.tilesByLod);
  const byId = new Map(ground.tiles.map(t => [t.id, t]));
  for (const tile of ground.tiles) {
    if (!tile.parentId) continue;
    const parent = byId.get(tile.parentId);
    assert.equal(parent.lod, tile.lod + 1);
    const a = parent.bounds, b = tile.bounds;
    assert.ok(a.minEasting <= b.minEasting && a.maxEasting >= b.maxEasting && a.minNorthing <= b.minNorthing && a.maxNorthing >= b.maxNorthing);
  }
  for (const [key, value] of Object.entries(config.expectedBoundsEpsg5845)) {
    assert.equal(ground.bounds[key], value);
    assert.equal(ringLevelExtent(spec.levels.at(-1))[key], value);
  }
  for (const [key, value] of Object.entries(config.expectedFrontierBoundsEpsg5845)) assert.equal(ringLevelExtent(spec.levels[0])[key], value);
});

test('expanded Lidingö preserves all original course terrain and measured canopy layers', () => {
  const previous = read('grounds/lidingo/ground-v2-6732ca39f30b00dbce720225d42149da5d0f9d9fd0753d0f871fc67f4184877a.json');
  const originals = previous.tiles.filter(t => t.lod === 0);
  assert.equal(originals.length, 64);
  for (const tile of originals) {
    const current = ground.tiles.find(t => t.id === tile.id);
    assert.deepEqual(current.layers, tile.layers, `source data changed in ${tile.id}`);
  }
});

test('the old Lidingö pyramid compiler cannot erase the surrounding world', async () => {
  await assert.rejects(refusePublishedRingOverwrite(publicDirectory.pathname, 'lidingo'), /Refusing to replace the surrounding terrain/);
});
