import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertLidingoTerrainPreserved, prepareLidingoStandPublication } from './publish-reviewed-stands.mjs';

const ground = () => ({ groundId: 'lidingo', bounds: { minEasting: 1 }, frame: { fingerprint: 'source' }, shell: { sha256: 'shell' },
  tiles: [0, 1].map(lod => ({ id: `l${lod}/0/0`, lod, parentId: lod ? null : 'l1/0/0',
    bounds: { minEasting: 1 }, geometricErrorMetres: lod, courses: ['lidingo'],
    layers: { terrain: { sha256: `terrain${lod}` }, surface: null, objects: null,
      stands: lod ? null : { sha256: 'old-exclusions' } } })) });

test('reviewed tee exclusions can replace finest stands while preserving the complete terrain ring contract', () => {
  const previous = ground(), next = structuredClone(previous);
  next.tiles[0].layers.stands = { sha256: 'reviewed-exclusions' };
  assert.doesNotThrow(() => assertLidingoTerrainPreserved(previous, next));
  for (const mutate of [
    value => { value.tiles.pop(); },
    value => { delete value.tiles[0].parentId; },
    value => { value.tiles[0].layers.terrain.sha256 = 'changed-height'; },
    value => { value.frame.fingerprint = 'shifted-origin'; },
    value => { value.tiles[1].bounds.minEasting += 100; },
    value => { value.tiles[1].layers.stands = { sha256: 'new-coarse-layer' }; },
  ]) {
    const broken = structuredClone(next); mutate(broken);
    assert.throws(() => assertLidingoTerrainPreserved(previous, broken));
  }
});

test('a retained Lidingö stand stage can replace old chunks in a strict graph without orphan resources',
  { skip: !fs.existsSync(new URL('../cache/vegetation/stands-stage/layer-index.json', import.meta.url)) }, async () => {
    const prepared = await prepareLidingoStandPublication();
    assert.equal(prepared.report.standLayers, 64);
    assert.equal(prepared.report.preservedTerrainTiles, 277);
    assert.equal(prepared.report.preservedRoutingCoordinates, true);
  });
