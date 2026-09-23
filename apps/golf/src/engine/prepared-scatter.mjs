/* Prepared scatter: which candidates of the reed lattice, the ground-cover
   lattice and the ground cover's edge tufts were planted.

   The same idea as the prepared far vista (engine/prepared-vista.mjs), for the
   three other planting loops of the forest stage, measured at 1.6 s, 1.7 s and
   0.5 s at a phone's CPU speed on Veckefjärden (docs/performance-plan-
   2026-09-23.md, Phase 3 progress). Each loop is a SECTION of one record: a
   bitset over its candidates in loop order, and the digest of every value the
   loop produced. A visit replays a section's set bits with the loop's own code
   and keeps the result only if it reproduces that section's digest; a section
   that does not is planted the ordinary way, on its own. */
import { canonicalJson } from '../../../../packages/course-v2/canonical-json.mjs';
import { inflateBounded, sha256Hex } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { CacheStorageByteCache, VerifiedImmutableStore } from '../../../../packages/course-v2/runtime/cache.mjs';
import { preparedVistaAllowed } from './prepared-vista.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024, MAX_DECODED = 32 * 1024 * 1024;
export const SCATTER_SECTIONS = ['reeds', 'cover', 'edge'];

export function scatterVariant(lowQuality) { return `scatter-${lowQuality ? 'lo' : 'hi'}`; }

export async function preparedScatterIdentity({ meta, groundSha256, lowQuality, revision }) {
  return sha256Hex(new TextEncoder().encode(canonicalJson({ version: 1, kind: 'scatter', revision,
    slug: meta.slug, pack: meta.sha256, ground: groundSha256,
    landcover: meta.landcover?.sha256 ?? null, mown: meta.mownSurface?.sha256 ?? null,
    surroundings: meta.surroundings?.sha256 ?? null, lowQuality })));
}

export function preparedScatterAllowed(search) {
  const params = new URLSearchParams(search);
  if (params.get('prepscatter') === '0') return false;
  return preparedVistaAllowed(params);
}

/* A recorder for one loop: `candidate()` at the top of every iteration,
   `passed()` once the candidate has cleared every test. */
export function scatterRecorder() {
  const decisions = [];
  return { decisions, candidate() { decisions.push(0); }, passed() { decisions[decisions.length - 1] = 1; } };
}

/* Bits least-significant first; sections are concatenated, each starting on a byte. */
export function packScatter(sections) {
  const out = {}, parts = [];
  let offset = 0;
  for (const name of SCATTER_SECTIONS) {
    const section = sections[name];
    if (!section) { out[name] = null; continue; }
    const bytes = new Uint8Array((section.decisions.length + 7) >> 3);
    for (let k = 0; k < section.decisions.length; k++) if (section.decisions[k]) bytes[k >> 3] |= 1 << (k & 7);
    out[name] = { candidates: section.decisions.length, offset, digest: section.digest, extra: section.extra ?? {} };
    parts.push(bytes); offset += bytes.length;
  }
  const payload = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) { payload.set(p, at); at += p.length; }
  return { sections: out, payload };
}

/* Calls visit(k) for each set bit of one section, in ascending candidate order.
   Returns false when a set bit lies past the section's candidates. */
export async function forEachSetBit(payload, section, visit, yieldEvery = null) {
  const start = section.offset, bytes = (section.candidates + 7) >> 3;
  for (let b = 0; b < bytes; b++) {
    let byte = payload[start + b];
    if (!byte) continue;
    if (yieldEvery && (b & 4095) === 0) await yieldEvery();
    for (let bit = 0; byte; bit++, byte >>= 1) {
      if (!(byte & 1)) continue;
      const k = b * 8 + bit;
      if (k >= section.candidates) return false;
      visit(k);
    }
  }
  return true;
}

/* The digest of a loop's output: its Float64 arrays, in order, at full precision. */
export async function scatterDigest(arrays) {
  const views = arrays.map(a => new Uint8Array(new Float64Array(a).buffer));
  const lengths = new Float64Array(arrays.map(a => a.length));
  const all = new Uint8Array(lengths.byteLength + views.reduce((s, v) => s + v.length, 0));
  all.set(new Uint8Array(lengths.buffer), 0);
  let at = lengths.byteLength;
  for (const v of views) { all.set(v, at); at += v.length; }
  return sha256Hex(all);
}

export function validPreparedScatterReference(reference) {
  if (!reference || !HASH.test(reference.identity ?? '') || !HASH.test(reference.sha256 ?? '') ||
      !HASH.test(reference.decodedSha256 ?? '') || typeof reference.url !== 'string' || typeof reference.inputs !== 'string' ||
      !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > MAX_BYTES ||
      !Number.isSafeInteger(reference.decodedBytes) || reference.decodedBytes < 0 || reference.decodedBytes > MAX_DECODED ||
      !reference.sections || typeof reference.sections !== 'object') return false;
  let end = 0;
  for (const name of SCATTER_SECTIONS) {
    const s = reference.sections[name];
    if (s === null) continue;
    if (!s || !Number.isSafeInteger(s.candidates) || s.candidates < 0 || !Number.isSafeInteger(s.offset) ||
        s.offset !== end || !HASH.test(s.digest ?? '')) return false;
    end += (s.candidates + 7) >> 3;
  }
  return end === reference.decodedBytes;
}

export async function loadPreparedScatter({ reference, baseUrl, fetchImpl = globalThis.fetch, cacheStorage, cache }) {
  if (!validPreparedScatterReference(reference)) return null;
  const store = new VerifiedImmutableStore({ fetchBytes: createHttpByteFetcher(fetchImpl),
    cache: cache || new CacheStorageByteCache({ cacheStorage, cacheName: 'banvy-prepared-scatter-v1' }),
    urlFor: ref => resolveV2AssetUrl(ref.url, baseUrl) });
  try {
    const result = await store.load(reference, { verify: async (ref, bytes) => {
      if (bytes.byteLength !== ref.bytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('prepared scatter transport mismatch');
      const payload = await inflateBounded(bytes, ref.decodedBytes);
      if (payload.byteLength !== ref.decodedBytes || await sha256Hex(payload) !== ref.decodedSha256) throw new Error('prepared scatter payload mismatch');
      return payload;
    } });
    return { ...reference, payload: result.value };
  } catch { return null; }
}

/* A section is usable for this identity and inputs, when the loop has the
   same number of candidates the bake saw. */
export function usableScatterSection(prepared, name, { identity, inputs, candidates }) {
  const section = prepared?.sections?.[name];
  return !!section && prepared.identity === identity && prepared.inputs === inputs &&
    section.candidates === candidates && !!prepared.payload;
}
