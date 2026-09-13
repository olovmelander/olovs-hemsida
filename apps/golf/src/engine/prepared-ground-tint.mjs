import { canonicalJson } from '../../../../packages/course-v2/canonical-json.mjs';
import { inflateBounded, sha256Hex } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { CacheStorageByteCache, VerifiedImmutableStore } from '../../../../packages/course-v2/runtime/cache.mjs';

export async function groundTintIdentity({ meta, groundSha256, painted, lowQuality, revision }) {
  return sha256Hex(new TextEncoder().encode(canonicalJson({ version: 1, revision,
    slug: meta.slug, pack: meta.sha256, ground: groundSha256,
    landcover: meta.landcover?.sha256 ?? null, mown: meta.mownSurface?.sha256 ?? null,
    surroundings: meta.surroundings?.sha256 ?? null, painted, lowQuality })));
}

export function preparedTintAllowed(search) {
  const params = new URLSearchParams(search);
  if (params.get('startup') === '0' || params.has('bakeTint')) return false;
  const displayOnly = new Set(['bana', 'hal', 'vy', 'ljus', 'tee', 'skylt', 'ren', 'q', 'det',
    'ghibli', 'gl', 'rdepth', 'hero', 'trees', 'look', 'qualitylock', 'startup', 'v2', 'kiosk']);
  return [...params.keys()].every(key => displayOnly.has(key));
}

export async function loadPreparedGroundTint({ reference, identity, baseUrl, fetchImpl = globalThis.fetch, cacheStorage, cache }) {
  if (!reference || reference.identity !== identity) return null;
  if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(reference.decodedBytes) || reference.decodedBytes < 1 || reference.decodedBytes > 16 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(reference.sha256) || !/^[a-f0-9]{64}$/.test(reference.decodedSha256)) return null;
  const store = new VerifiedImmutableStore({ fetchBytes: createHttpByteFetcher(fetchImpl),
    cache: cache || new CacheStorageByteCache({ cacheStorage, cacheName: 'banvy-prepared-ground-tint-v1' }),
    urlFor: ref => resolveV2AssetUrl(ref.url, baseUrl) });
  try {
    const result = await store.load(reference, { verify: async (ref, bytes) => {
      if (bytes.byteLength !== ref.bytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('prepared tint transport mismatch');
      const payload = await inflateBounded(bytes, ref.decodedBytes);
      if (payload.byteLength !== ref.decodedBytes || await sha256Hex(payload) !== ref.decodedSha256) throw new Error('prepared tint identity mismatch');
      return payload;
    } });
    return { bytes: result.value, layers: reference.layers };
  } catch { return null; }
}

export function applyPreparedGroundTint(tint, prepared) {
  if (!prepared || !Array.isArray(prepared.layers) || prepared.layers.length !== 2) return false;
  let offset = 0;
  for (let i = 0; i < 2; i++) {
    const layer = tint[i ? 'far' : 'near'], meta = prepared.layers[i];
    if (!meta || !meta.bounds || meta.n !== layer.n || meta.dx !== layer.dx || canonicalJson(meta.bounds) !== canonicalJson(layer.bounds) ||
        meta.bytes !== layer.texture.image.data.byteLength || meta.offset !== offset) return false;
    offset += meta.bytes;
  }
  if (offset !== prepared.bytes.byteLength) return false;
  for (let i = 0; i < 2; i++) {
    const layer = tint[i ? 'far' : 'near'], meta = prepared.layers[i];
    layer.texture.image.data.set(prepared.bytes.subarray(meta.offset, meta.offset + meta.bytes));
    layer.texture.needsUpdate = true;
  }
  return true;
}
