import { assertValidAssetReference } from './schema.mjs';

/* This descriptor is deliberately narrower than a v2 ground manifest. It is
   only an opt-in retained preview of migration-derived surface samples; a
   future surveyed surface release must use the normal ground manifest path. */
export const SURFACE_PREVIEW_KIND = 'banvy-surface-preview-v1';
export const SURFACE_PREVIEW_PROVISIONAL_REASON = 'migration-vectors-not-survey-approved';
export const SURFACE_PREVIEW_SOURCE_KIND = 'gpk1-vector-migration-v1';
export const MAX_SURFACE_PREVIEW_TILES = 64;
/* pair-sdf-v1: two nearest ids and one signed distance per sample (the
   original preview). class-sdf-v1: one exact signed distance per non-rough
   class, blended in the terrain material. The descriptor names which so the
   runtime builds the matching atlas and shader rather than inferring it. */
export const SURFACE_REPRESENTATIONS = Object.freeze(['pair-sdf-v1', 'class-sdf-v1']);
/* The coordinate a fragment presents to sample the raster: the legacy pack
   world through a translation-only bridge (migration vectors), or canonical
   EPSG:3006 offsets from the frame origin (surveyed sources). */
export const SURFACE_SAMPLING_FRAMES = Object.freeze(['legacy-bridge', 'canonical']);

const TILE_ID = /^l(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UNMEASURED_FIELDS = Object.freeze([
  'exposure', 'moisture', 'vegetation-density', 'wear',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, at, fail) {
  for (const key of Object.keys(value || {})) {
    if (!expected.has(key)) fail(`${at}.${key}`, 'is not allowed');
  }
  for (const key of expected) {
    if (!Object.hasOwn(value || {}, key)) fail(`${at}.${key}`, 'is required');
  }
}

function sha256(value, at, fail) {
  if (!SHA256.test(value || '')) fail(at, 'must be a lowercase SHA-256');
}

function sortedExact(value, expected, at, fail) {
  if (!Array.isArray(value) || value.length !== expected.length ||
      value.some((item, index) => item !== expected[index])) {
    fail(at, `must equal ${expected.join(', ')}`);
  }
}

export function validateSurfacePreview(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'surfacePreview';
  if (!object(value)) return ['surfacePreview: must be an object'];
  exactKeys(value, new Set([
    'schemaVersion', 'kind', 'provisional', 'provisionalReason', 'label',
    'terrainDescriptorSha256', 'frameFingerprint', 'representation', 'samplingFrame',
    'source', 'unmeasuredFields', 'tiles',
  ]), at, fail);
  if (value.schemaVersion !== 1) fail(`${at}.schemaVersion`, 'must be 1');
  if (!SURFACE_REPRESENTATIONS.includes(value.representation)) {
    fail(`${at}.representation`, `must be one of ${SURFACE_REPRESENTATIONS.join(', ')}`);
  }
  if (!SURFACE_SAMPLING_FRAMES.includes(value.samplingFrame)) {
    fail(`${at}.samplingFrame`, `must be one of ${SURFACE_SAMPLING_FRAMES.join(', ')}`);
  }
  if (value.kind !== SURFACE_PREVIEW_KIND) fail(`${at}.kind`, `must be ${SURFACE_PREVIEW_KIND}`);
  if (value.provisional !== true) fail(`${at}.provisional`, 'must remain true');
  if (value.provisionalReason !== SURFACE_PREVIEW_PROVISIONAL_REASON) {
    fail(`${at}.provisionalReason`, `must be ${SURFACE_PREVIEW_PROVISIONAL_REASON}`);
  }
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 96 || /[\u0000-\u001f]/.test(value.label)) {
    fail(`${at}.label`, 'must be a printable string of at most 96 characters');
  }
  sha256(value.terrainDescriptorSha256, `${at}.terrainDescriptorSha256`, fail);
  sha256(value.frameFingerprint, `${at}.frameFingerprint`, fail);
  if (!object(value.source)) fail(`${at}.source`, 'must be an object');
  else {
    exactKeys(value.source, new Set(['kind', 'packSha256']), `${at}.source`, fail);
    if (value.source.kind !== SURFACE_PREVIEW_SOURCE_KIND) {
      fail(`${at}.source.kind`, `must be ${SURFACE_PREVIEW_SOURCE_KIND}`);
    }
    sha256(value.source.packSha256, `${at}.source.packSha256`, fail);
  }
  sortedExact(value.unmeasuredFields, UNMEASURED_FIELDS, `${at}.unmeasuredFields`, fail);
  if (!Array.isArray(value.tiles) || !value.tiles.length || value.tiles.length > MAX_SURFACE_PREVIEW_TILES) {
    fail(`${at}.tiles`, `must contain 1 to ${MAX_SURFACE_PREVIEW_TILES} tiles`);
  } else {
    const ids = new Set();
    value.tiles.forEach((tile, index) => {
      const path = `${at}.tiles[${index}]`;
      if (!object(tile)) { fail(path, 'must be an object'); return; }
      exactKeys(tile, new Set(['id', 'reference']), path, fail);
      if (!TILE_ID.test(tile.id || '')) fail(`${path}.id`, 'must be a terrain tile id');
      else if (ids.has(tile.id)) fail(`${path}.id`, 'is duplicated');
      else ids.add(tile.id);
      try { assertValidAssetReference(tile.reference, 'surface'); }
      catch (error) { fail(`${path}.reference`, String(error.message || error)); }
    });
  }
  return errors;
}

export function assertSurfacePreview(value) {
  const errors = validateSurfacePreview(value);
  if (errors.length) throw new Error(`invalid surface preview:\n${errors.join('\n')}`);
  return value;
}

export function resolveSurfacePreviewAssetUrl(reference, descriptorUrl) {
  assertValidAssetReference(reference, 'surface');
  const base = new URL(descriptorUrl, globalThis.location?.href);
  const resolved = new URL(reference.url, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password ||
      resolved.search || resolved.hash) {
    throw new Error('surface preview asset must be a clean same-origin URL');
  }
  const directory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  if (!resolved.pathname.startsWith(directory)) {
    throw new Error('surface preview asset escapes the descriptor directory');
  }
  return resolved.href;
}
