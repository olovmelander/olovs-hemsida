/* Prepared far vista: which candidate points of the far forest were planted.

   The far-vista loops walk a fixed grid of candidates and run expensive tests
   on each (land cover, water, open land, course surfaces, landmarks); 97% of
   the stage is those tests, and the terrain height of the kept points is the
   other 3% (docs/performance-plan-2026-09-23.md, 3.5). A publication records
   one bit per candidate -- kept or not -- from the very same loops. A visit
   walks the same grid, skips the tests for a clear bit and recomputes every
   kept point with the same code, so position, size, height and species come
   out as they always did. The bake also stores the digest of what it planted,
   and a visit that does not reproduce it throws the replay away and plants
   the vista the ordinary way: a stale or wrong record costs time, never trees.

   Inputs that only exist at run time (the landmark models that loaded, the
   LiDAR vegetation) are recorded beside the bits and compared at use. */
import { canonicalJson } from '../../../../packages/course-v2/canonical-json.mjs';
import { inflateBounded, sha256Hex } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { CacheStorageByteCache, VerifiedImmutableStore } from '../../../../packages/course-v2/runtime/cache.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024, MAX_DECODED = 16 * 1024 * 1024;

export function vistaVariant(lowQuality) { return `vista-${lowQuality ? 'lo' : 'hi'}`; }

export async function preparedVistaIdentity({ meta, groundSha256, lowQuality, revision }) {
  return sha256Hex(new TextEncoder().encode(canonicalJson({ version: 1, kind: 'vista', revision,
    slug: meta.slug, pack: meta.sha256, ground: groundSha256,
    landcover: meta.landcover?.sha256 ?? null, mown: meta.mownSurface?.sha256 ?? null,
    surroundings: meta.surroundings?.sha256 ?? null, lowQuality })));
}

/* The run-time inputs the planting read, as one canonical string. */
export function preparedVistaInputs({ landmarks = [], flags = {} }) {
  return canonicalJson({ landmarks: [...landmarks].map(String).sort(), flags });
}

export function preparedVistaAllowed(search) {
  const params = new URLSearchParams(search);
  if (params.has('bakeVista') || params.get('prepvista') === '0') return false;
  params.delete('bakeTint'); params.delete('bakeWater');
  return preparedTintAllowed(params);
}

/* Bits are least-significant first within each byte: candidate k is bit k & 7 of byte k >> 3. */
export function packVistaBits(decisions) {
  const bytes = new Uint8Array((decisions.length + 7) >> 3);
  for (let k = 0; k < decisions.length; k++) if (decisions[k]) bytes[k >> 3] |= 1 << (k & 7);
  return bytes;
}

export function vistaBitReader(bytes, candidates) {
  let k = 0;
  return {
    next() { if (k >= candidates) throw new Error('prepared vista overrun'); const bit = (bytes[k >> 3] >> (k & 7)) & 1; k++; return bit === 1; },
    get consumed() { return k; },
  };
}

/* What the fingerprint and the replay check compare: every planted value at full precision. */
export async function vistaDigest(pts, ptsSize) {
  const n = pts.length / 4, sizes = new Float64Array(n * 2).fill(NaN);
  for (let k = 0; k < n; k++) { const s = ptsSize[k]; if (s) { sizes[k * 2] = s[0]; sizes[k * 2 + 1] = s[1]; } }
  const a = new Uint8Array(new Float64Array(pts).buffer), b = new Uint8Array(sizes.buffer);
  const all = new Uint8Array(a.length + b.length); all.set(a); all.set(b, a.length);
  return sha256Hex(all);
}

export function validPreparedVistaReference(reference) {
  return !!reference && HASH.test(reference.identity ?? '') && HASH.test(reference.sha256 ?? '') &&
    HASH.test(reference.decodedSha256 ?? '') && HASH.test(reference.digest ?? '') && typeof reference.url === 'string' &&
    Number.isSafeInteger(reference.bytes) && reference.bytes > 0 && reference.bytes <= MAX_BYTES &&
    Number.isSafeInteger(reference.decodedBytes) && reference.decodedBytes > 0 && reference.decodedBytes <= MAX_DECODED &&
    Number.isSafeInteger(reference.candidates) && reference.candidates > 0 &&
    reference.decodedBytes === (reference.candidates + 7) >> 3 && typeof reference.inputs === 'string';
}

/* Downloads and verifies the bits; identity and inputs are compared at use. */
export async function loadPreparedVista({ reference, baseUrl, fetchImpl = globalThis.fetch, cacheStorage, cache }) {
  if (!validPreparedVistaReference(reference)) return null;
  const store = new VerifiedImmutableStore({ fetchBytes: createHttpByteFetcher(fetchImpl),
    cache: cache || new CacheStorageByteCache({ cacheStorage, cacheName: 'banvy-prepared-vista-v1' }),
    urlFor: ref => resolveV2AssetUrl(ref.url, baseUrl) });
  try {
    const result = await store.load(reference, { verify: async (ref, bytes) => {
      if (bytes.byteLength !== ref.bytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('prepared vista transport mismatch');
      const payload = await inflateBounded(bytes, ref.decodedBytes);
      if (payload.byteLength !== ref.decodedBytes || await sha256Hex(payload) !== ref.decodedSha256) throw new Error('prepared vista payload mismatch');
      return payload;
    } });
    return { ...reference, bits: result.value };
  } catch { return null; }
}

/* A loaded record is usable only for this exact identity and these run-time inputs. */
export function usablePreparedVista(prepared, { identity, inputs }) {
  return !!prepared && prepared.identity === identity && prepared.inputs === inputs &&
    prepared.bits?.byteLength === (prepared.candidates + 7) >> 3;
}
