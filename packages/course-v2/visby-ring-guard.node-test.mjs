import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLiveGroundManifest, ringGraphRefusal } from './compile-visby-ground-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');

/* The pyramid compiler and publish-ground-rings write the same paths. Before
   the rings this was harmless; now a rerun with --out apps/golf/public would
   replace a 469-tile quadtree with a 341-tile pyramid carrying no parentId,
   and the tile manager would fall back to the fixed frontier with no error
   anywhere -- the parentId strip the notes record, reached by another route. */
test('the published Visby ground is a ring quadtree with explicit parent links', async () => {
  const live = await readLiveGroundManifest(PUBLIC);
  assert.ok(live, 'a Visby ground manifest must be published');
  assert.equal(live.tiles.length, 469);
  assert.equal(live.tiles.filter(tile => tile.parentId).length, 468, 'every tile but the root carries a parent');
  const byLod = {};
  for (const tile of live.tiles) byLod[tile.lod] = (byLod[tile.lod] || 0) + 1;
  assert.deepEqual(byLod, { 0: 256, 1: 64, 2: 64, 3: 64, 4: 16, 5: 4, 6: 1 });
});

test('the pyramid compiler refuses to write over a published ring graph', async () => {
  const live = await readLiveGroundManifest(PUBLIC);
  const refusal = ringGraphRefusal(live);
  assert.match(refusal, /a ring graph is published for this ground \(469 tiles, 468 with a parent\)/);
  assert.match(refusal, /publish-ground-rings\.mjs owns apps\/golf\/public now/);
});

test('it does not refuse a pyramid, an absent ground or a partial tree', () => {
  const pyramid = { tiles: Array.from({ length: 341 }, (unused, index) => ({ id: `t${index}`, lod: 0 })) };
  assert.equal(ringGraphRefusal(pyramid), null, 'a pyramid carries no parent link and may be rewritten');
  assert.equal(ringGraphRefusal(null), null, 'nothing published yet is nothing to defend');
  assert.equal(ringGraphRefusal({}), null);
});
