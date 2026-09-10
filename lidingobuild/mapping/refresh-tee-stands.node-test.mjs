import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceFinestStandLayers } from './refresh-tee-stands.mjs';

const reference = name => ({ url: `${name}.bin`, sha256: name, bytes: 100 });
function fixture() {
  const tile = (id, lod, parentId) => ({ id, lod, ...(parentId ? { parentId } : {}),
    bounds: { minEasting: 1, minNorthing: 2, maxEasting: 3, maxNorthing: 4 },
    courses: ['lidingo'], geometricErrorMetres: lod + .1,
    layers: { terrain: reference(`${id}-terrain`), surface: reference(`${id}-surface`),
      objects: reference(`${id}-objects`), stands: reference(`${id}-old-stands`) } });
  return { groundId: 'lidingo', frame: { fingerprint: 'unchanged-frame' }, shell: reference('unchanged-shell'),
    sourceManifestSha256: 'a'.repeat(64), requiredFeatures: ['stand-field-u8-v1'],
    tiles: [tile('fine-a', 0, 'outer'), tile('fine-b', 0, 'outer'), tile('outer', 1)] };
}

test('replacing finest stands preserves terrain, coarse stands, parent links and all other ground fields', () => {
  const ground = fixture(), before = structuredClone(ground);
  const replacement = { 'fine-a': reference('new-a'), 'fine-b': reference('new-b') };
  const result = replaceFinestStandLayers(ground, replacement, 'b'.repeat(64));
  const expected = structuredClone(ground);
  expected.sourceManifestSha256 = 'b'.repeat(64);
  expected.tiles[0].layers.stands = replacement['fine-a'];
  expected.tiles[1].layers.stands = replacement['fine-b'];
  assert.deepEqual(result, expected);
  assert.deepEqual(ground, before);
  assert.strictEqual(result.tiles[2], ground.tiles[2]);
  for (const [i, tile] of result.tiles.entries()) {
    for (const layer of ['terrain', 'surface', 'objects']) assert.strictEqual(tile.layers[layer], ground.tiles[i].layers[layer]);
  }
});

test('a missing finest tile or any unexpected coarse tile cannot silently retain a stale generation', () => {
  const ground = fixture();
  for (const layers of [
    { 'fine-a': reference('new-a') },
    { 'fine-a': reference('new-a'), outer: reference('wrong-lod') },
    { 'fine-a': reference('new-a'), 'fine-b': reference('new-b'), outer: reference('wrong-lod') },
  ]) assert.throws(() => replaceFinestStandLayers(ground, layers, 'b'.repeat(64)), /exactly the existing finest tiles/);
});

test('publication requires an explicit current source-ledger hash', () => {
  const ground = fixture(), layers = { 'fine-a': reference('new-a'), 'fine-b': reference('new-b') };
  for (const value of [undefined, '', 'old-source', 'A'.repeat(64)]) {
    assert.throws(() => replaceFinestStandLayers(ground, layers, value), /current source-manifest hash/);
  }
});
