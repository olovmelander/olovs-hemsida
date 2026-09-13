import { canonicalJson } from '../../../../packages/course-v2/canonical-json.mjs';
import { inflateBounded, sha256Hex } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { CacheStorageByteCache, VerifiedImmutableStore } from '../../../../packages/course-v2/runtime/cache.mjs';
import { flatWaterFromArrays } from './v2-flat-water.mjs';
import { waterBedFromArrays } from './v2-water-bed.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const MAGIC = 0x31575042; // BPW1, little endian. Float32 samples remain Float32.
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_HEADER = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const align = n => Math.ceil(n / 4) * 4;
const arrayTypes = { label: Int32Array, flatMask: Uint8Array, mask: Uint8Array,
  level: Float32Array, depth: Float32Array, near: Uint8Array };
const encoder = new TextEncoder();

export async function preparedWaterIdentity({ meta, groundSha256, revision }) {
  return sha256Hex(encoder.encode(canonicalJson({ version: 1, revision, slug: meta.slug,
    pack: meta.sha256, ground: groundSha256, surroundings: meta.surroundings?.sha256 ?? null })));
}

export function preparedWaterAllowed(search) {
  const params = new URLSearchParams(search);
  if (params.has('bakeWater') || params.get('startup') === 'live-water') return false;
  params.delete('waterAudit'); params.delete('bakeTint');
  return preparedTintAllowed(params);
}

// Capture the actual post-measurement inputs as well as the published hashes.
// A missing sidecar, changed bridge or fallback ocean cannot reuse a good bake.
export function preparedWaterInputs({ knownBodies, bridge, origin, ocean }) {
  return canonicalJson({ knownBodies, origin, ocean,
    bridge: { rotationRadians: bridge.rotationRadians, scaleX: bridge.scaleX, scaleZ: bridge.scaleZ,
      verticalDatumOffsetMetres: bridge.verticalDatumOffsetMetres } });
}

export function encodePreparedWater({ identity, inputs, flatWater: flat, waterBed: bed }) {
  const arrays = { label: flat.label, flatMask: flat.mask, mask: bed.mask, level: bed.level, depth: bed.depth, near: bed.near };
  const layout = {};
  let length = 0;
  for (const [name, value] of Object.entries(arrays)) {
    length = align(length);
    layout[name] = { offset: length, bytes: value.byteLength };
    length += value.byteLength;
  }
  const metadata = { identity, inputs, layout,
    flat: { width: flat.width, height: flat.height, spacing: flat.spacing, x0: flat.x0, z0: flat.z0,
      components: flat.components, refusedNotLevel: flat.refusedNotLevel,
      ...(flat.excludedOceanCells === undefined ? {} : { excludedOceanCells: flat.excludedOceanCells }) },
    bed: { cells: bed.cells, shoreDepthMetres: bed.shoreDepthMetres, depthPerMetre: bed.depthPerMetre,
      maximumDepthMetres: bed.maximumDepthMetres } };
  const header = encoder.encode(canonicalJson(metadata)), start = align(8 + header.length);
  if (header.length > MAX_HEADER || start + length > MAX_BYTES) throw new Error('prepared water exceeds byte budget');
  const bytes = new Uint8Array(start + length), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, header.length, true);
  bytes.set(header, 8);
  // Explicit LE storage also makes publication independent of host byte order.
  for (const [name, value] of Object.entries(arrays)) {
    const offset = start + layout[name].offset;
    if (value.BYTES_PER_ELEMENT === 1) bytes.set(value, offset);
    else {
      const source = new Uint32Array(value.buffer, value.byteOffset, value.length);
      for (let i = 0; i < source.length; i++) view.setUint32(offset + i * 4, source[i], true);
    }
  }
  return bytes;
}

export function decodePreparedWater(bytes, identity) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > MAX_BYTES || bytes.byteOffset % 4) throw new Error('invalid water payload');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(4, true), start = align(8 + headerBytes);
  if (view.getUint32(0, true) !== MAGIC || headerBytes > MAX_HEADER || start > bytes.length) throw new Error('invalid water header');
  const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, 8 + headerBytes)));
  const flat = meta.flat, bed = meta.bed;
  if (meta.identity !== identity || !HASH.test(identity) || typeof meta.inputs !== 'string') throw new Error('water source mismatch');
  if (!flat || !bed || !Number.isSafeInteger(flat.width) || !Number.isSafeInteger(flat.height) || flat.width < 1 || flat.height < 1 ||
      !(flat.spacing > 0) || ![flat.spacing, flat.x0, flat.z0].every(Number.isFinite)) throw new Error('invalid water grid');
  const cells = flat.width * flat.height;
  if (!Number.isSafeInteger(cells) || cells > Math.floor(MAX_BYTES / 15) || !Number.isSafeInteger(bed.cells) || bed.cells < 0 || bed.cells > cells ||
      ![bed.shoreDepthMetres, bed.depthPerMetre, bed.maximumDepthMetres].every(Number.isFinite) ||
      bed.shoreDepthMetres < 0 || bed.depthPerMetre <= 0 || bed.maximumDepthMetres <= bed.shoreDepthMetres) throw new Error('invalid water bed');
  if (!Array.isArray(flat.components) || !Array.isArray(flat.refusedNotLevel) || flat.components.length > cells ||
      flat.refusedNotLevel.length > cells) throw new Error('invalid water components');
  const ids = new Set();
  for (const c of flat.components) {
    if (!c || !Number.isSafeInteger(c.id) || c.id < 1 || ids.has(c.id) || !Number.isFinite(c.level) || !Number.isFinite(c.surfaceHeight) ||
        ![c.cells, c.knownCells, c.uncoveredCells].every(n => Number.isSafeInteger(n) && n >= 0 && n <= cells) ||
        c.knownCells + c.uncoveredCells !== c.cells || !c.bounds ||
        ![c.bounds.x0, c.bounds.z0, c.bounds.x1, c.bounds.z1].every(Number.isFinite)) throw new Error('invalid water component');
    ids.add(c.id);
  }
  const arrays = {};
  let offset = 0;
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  for (const [name, Type] of Object.entries(arrayTypes)) {
    offset = align(offset);
    const entry = meta.layout?.[name], length = cells * Type.BYTES_PER_ELEMENT;
    if (entry?.offset !== offset || entry?.bytes !== length || start + offset + length > bytes.length) throw new Error('invalid water array layout');
    arrays[name] = new Type(bytes.buffer, bytes.byteOffset + start + offset, cells);
    if (!littleEndian && Type.BYTES_PER_ELEMENT === 4) {
      const words = new Uint32Array(cells);
      for (let i = 0; i < cells; i++) words[i] = view.getUint32(start + offset + i * 4, true);
      arrays[name] = new Type(words.buffer);
    }
    offset += length;
  }
  if (start + offset !== bytes.length) throw new Error('trailing water bytes');
  // No live terrain is mutated until all layout and identity checks succeed.
  return { inputs: meta.inputs,
    flatWater: flatWaterFromArrays({ ...flat, mask: arrays.flatMask, label: arrays.label }),
    waterBed: waterBedFromArrays({ ...flat, ...bed, mask: arrays.mask, level: arrays.level,
      depth: arrays.depth, near: arrays.near, timings: { mode: 'prepared' } }) };
}

export async function loadPreparedWater({ reference, identity, baseUrl, fetchImpl = globalThis.fetch, cacheStorage, cache }) {
  const started = performance.now();
  if (!reference || reference.identity !== identity || !HASH.test(identity) ||
      !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(reference.decodedBytes) || reference.decodedBytes < 8 || reference.decodedBytes > MAX_BYTES ||
      !HASH.test(reference.sha256) || !HASH.test(reference.decodedSha256)) return null;
  try {
    const store = new VerifiedImmutableStore({ fetchBytes: createHttpByteFetcher(fetchImpl),
      cache: cache || new CacheStorageByteCache({ cacheStorage, cacheName: 'banvy-prepared-water-v1' }),
      urlFor: ref => resolveV2AssetUrl(ref.url, baseUrl) });
    const result = await store.load(reference, { verify: async (ref, bytes) => {
      if (bytes.byteLength !== ref.bytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('water transport mismatch');
      const payload = await inflateBounded(bytes, ref.decodedBytes, { preallocate: true });
      if (payload.byteLength !== ref.decodedBytes || await sha256Hex(payload) !== ref.decodedSha256) throw new Error('water content mismatch');
      return decodePreparedWater(payload, identity);
    } });
    return { ...result.value, diagnostics: { milliseconds: +(performance.now() - started).toFixed(1),
      bytes: reference.bytes, decodedBytes: reference.decodedBytes, cacheHit: result.cacheHit } };
  } catch { return null; }
}

// Opt-in proof: exact field bytes, component metadata and every carved ring.
export async function waterFingerprint({ flatWater, waterBed, ringTiles }) {
  const hash = value => sha256Hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  const fields = {};
  for (const key of ['mask', 'label']) fields[`flat.${key}`] = await hash(flatWater[key]);
  for (const key of ['mask', 'level', 'depth', 'near']) fields[`bed.${key}`] = await hash(waterBed[key]);
  return { fields, components: flatWater.components, refusedNotLevel: flatWater.refusedNotLevel,
    excludedOceanCells: flatWater.excludedOceanCells ?? 0,
    rings: await Promise.all([...ringTiles.values()].flat().map(async tile => ({
      bounds: tile.bounds, grid: tile.grid, sha256: await hash(tile.payload) }))) };
}
