import { it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { sha256Bytes } from '../../../../packages/course-v2/chunk-node.mjs';
import { applyPreparedGroundTint, groundTintIdentity, loadPreparedGroundTint, preparedTintAllowed } from './prepared-ground-tint.mjs';

it('invalidates prepared colors when source, ground, sidecars, style or quality changes', async () => {
  const base = { meta: { slug: 'test', sha256: 'pack', landcover: { sha256: 'land' } },
    groundSha256: 'ground', painted: true, lowQuality: false, revision: 'source' };
  const original = await groundTintIdentity(base);
  for (const change of [{ painted: false }, { lowQuality: true }, { groundSha256: 'new' }, { revision: 'new' },
    { meta: { ...base.meta, landcover: { sha256: 'new' } } }]) expect(await groundTintIdentity({ ...base, ...change })).not.toBe(original);
  expect(preparedTintAllowed('?bana=test&hal=13&ljus=dis&ghibli=1')).toBe(true);
  expect(preparedTintAllowed('?bana=test&buildingGeometry=source')).toBe(false);
  expect(preparedTintAllowed('?startup=0')).toBe(false);
});

it('checks compressed and decoded identities, then applies both correctly sized layers atomically', async () => {
  const payload = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const compressed = new Uint8Array(deflateRawSync(payload));
  const layers = [0, 4].map(offset => ({ n: 1, dx: 6, bounds: { x0: 0, z0: 0, x1: 6, z1: 6 }, offset, bytes: 4 }));
  const reference = { identity: 'identity', bytes: compressed.length, decodedBytes: payload.length,
    sha256: sha256Bytes(compressed), decodedSha256: sha256Bytes(payload), url: 'courses/test/tint.bin', layers };
  const make = () => ({ n: 1, dx: 6, bounds: layers[0].bounds, texture: { image: { data: new Uint8Array(4) } } });
  const tint = { near: make(), far: make() };
  const prepared = await loadPreparedGroundTint({ reference, identity: 'identity', baseUrl: 'https://example.test/sub/',
    fetchImpl: async () => new Response(compressed), cacheStorage: null });
  expect(applyPreparedGroundTint(tint, { ...prepared, layers: [layers[0], { ...layers[1], n: 2 }] })).toBe(false);
  expect(applyPreparedGroundTint(tint, { ...prepared, layers: [layers[0], null] })).toBe(false);
  expect(applyPreparedGroundTint(tint, { ...prepared, layers: [layers[0], { ...layers[1], bounds: undefined }] })).toBe(false);
  expect(tint.near.texture.image.data).toEqual(new Uint8Array(4));
  expect(applyPreparedGroundTint(tint, prepared)).toBe(true);
  expect(tint.far.texture.image.data).toEqual(payload.slice(4));
  expect(tint.near.texture.needsUpdate).toBe(true);
  expect(await loadPreparedGroundTint({ reference: { ...reference, decodedSha256: '0'.repeat(64) }, identity: 'identity',
    baseUrl: 'https://example.test/', fetchImpl: async () => new Response(compressed), cacheStorage: null })).toBeNull();
});
