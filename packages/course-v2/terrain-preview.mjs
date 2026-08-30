import { assertValidAssetReference } from './schema.mjs';

export const TERRAIN_PREVIEW_KIND = 'banvy-terrain-preview-v1';
export const TERRAIN_PREVIEW_PROVISIONAL_REASON = 'visual-only-origin-not-approved';
export const MAX_TERRAIN_PREVIEW_TILES = 64;

const TILE_ID = /^l(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)$/;

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

function finite(value, at, fail) {
  if (!Number.isFinite(value)) fail(at, 'must be finite');
}

function vector(value, at, fail) {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(at, 'must contain exactly three coordinates');
    return;
  }
  value.forEach((coordinate, index) => finite(coordinate, `${at}[${index}]`, fail));
}

function validateFrame(value, at, fail) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  exactKeys(value, new Set([
    'compoundCrs', 'horizontalCrs', 'verticalCrs', 'origin', 'axisMapping', 'fingerprint',
  ]), at, fail);
  if (value.compoundCrs !== 'EPSG:5845') fail(`${at}.compoundCrs`, 'must be EPSG:5845');
  if (value.horizontalCrs !== 'EPSG:3006') fail(`${at}.horizontalCrs`, 'must be EPSG:3006');
  if (value.verticalCrs !== 'EPSG:5613') fail(`${at}.verticalCrs`, 'must be EPSG:5613');
  if (!object(value.origin)) fail(`${at}.origin`, 'must be an object');
  else {
    exactKeys(value.origin, new Set(['easting', 'northing', 'heightRH2000']), `${at}.origin`, fail);
    for (const key of ['easting', 'northing', 'heightRH2000']) finite(value.origin[key], `${at}.origin.${key}`, fail);
  }
  const expectedMapping = {
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  };
  if (!object(value.axisMapping)) fail(`${at}.axisMapping`, 'must be an object');
  else {
    exactKeys(value.axisMapping, new Set(Object.keys(expectedMapping)), `${at}.axisMapping`, fail);
    for (const [key, expected] of Object.entries(expectedMapping)) {
      if (value.axisMapping[key] !== expected) fail(`${at}.axisMapping.${key}`, `must be ${expected}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint || '')) fail(`${at}.fingerprint`, 'must be a lowercase SHA-256');
}

function validateBounds(value, at, fail) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  const fields = [
    'minEasting', 'minNorthing', 'minHeightRH2000',
    'maxEasting', 'maxNorthing', 'maxHeightRH2000',
  ];
  exactKeys(value, new Set(fields), at, fail);
  for (const field of fields) finite(value[field], `${at}.${field}`, fail);
  for (const [minimum, maximum] of [
    ['minEasting', 'maxEasting'], ['minNorthing', 'maxNorthing'],
    ['minHeightRH2000', 'maxHeightRH2000'],
  ]) {
    if (Number.isFinite(value[minimum]) && Number.isFinite(value[maximum]) &&
        value[minimum] >= value[maximum]) fail(at, `${minimum} must be below ${maximum}`);
  }
}

/** Strict descriptor used only by the screenshot harness, never as a v2 manifest. */
export function validateTerrainPreview(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'preview';
  if (!object(value)) return ['preview: must be an object'];
  exactKeys(value, new Set([
    'schemaVersion', 'kind', 'provisional', 'provisionalReason', 'label',
    'frame', 'bounds', 'camera', 'tiles',
  ]), at, fail);
  if (value.schemaVersion !== 1) fail(`${at}.schemaVersion`, 'must be 1');
  if (value.kind !== TERRAIN_PREVIEW_KIND) fail(`${at}.kind`, `must be ${TERRAIN_PREVIEW_KIND}`);
  if (value.provisional !== true) fail(`${at}.provisional`, 'must remain true');
  if (value.provisionalReason !== TERRAIN_PREVIEW_PROVISIONAL_REASON) {
    fail(`${at}.provisionalReason`, `must be ${TERRAIN_PREVIEW_PROVISIONAL_REASON}`);
  }
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80 || /[\u0000-\u001f]/.test(value.label)) {
    fail(`${at}.label`, 'must be a printable string of at most 80 characters');
  }
  validateFrame(value.frame, `${at}.frame`, fail);
  validateBounds(value.bounds, `${at}.bounds`, fail);
  if (!object(value.camera)) fail(`${at}.camera`, 'must be an object');
  else {
    exactKeys(value.camera, new Set([
      'position', 'target', 'fovDegrees', 'nearMetres', 'farMetres',
    ]), `${at}.camera`, fail);
    vector(value.camera.position, `${at}.camera.position`, fail);
    vector(value.camera.target, `${at}.camera.target`, fail);
    finite(value.camera.fovDegrees, `${at}.camera.fovDegrees`, fail);
    finite(value.camera.nearMetres, `${at}.camera.nearMetres`, fail);
    finite(value.camera.farMetres, `${at}.camera.farMetres`, fail);
    if (!(value.camera.fovDegrees > 10 && value.camera.fovDegrees < 100)) fail(`${at}.camera.fovDegrees`, 'must be from 10 to 100');
    if (!(value.camera.nearMetres > 0)) fail(`${at}.camera.nearMetres`, 'must be positive');
    if (!(value.camera.farMetres > value.camera.nearMetres)) fail(`${at}.camera.farMetres`, 'must exceed nearMetres');
  }
  if (!Array.isArray(value.tiles) || !value.tiles.length || value.tiles.length > MAX_TERRAIN_PREVIEW_TILES) {
    fail(`${at}.tiles`, `must contain 1 to ${MAX_TERRAIN_PREVIEW_TILES} tiles`);
  } else {
    const ids = new Set();
    value.tiles.forEach((tile, index) => {
      const path = `${at}.tiles[${index}]`;
      if (!object(tile)) { fail(path, 'must be an object'); return; }
      exactKeys(tile, new Set(['id', 'reference']), path, fail);
      if (!TILE_ID.test(tile.id || '')) fail(`${path}.id`, 'must be a terrain tile id');
      else if (ids.has(tile.id)) fail(`${path}.id`, 'is duplicated');
      else ids.add(tile.id);
      try { assertValidAssetReference(tile.reference, 'terrain'); }
      catch (error) { fail(`${path}.reference`, String(error.message || error)); }
    });
  }
  return errors;
}

export function assertTerrainPreview(value) {
  const errors = validateTerrainPreview(value);
  if (errors.length) throw new Error(`invalid terrain preview:\n${errors.join('\n')}`);
  return value;
}

export function resolveTerrainPreviewAssetUrl(reference, descriptorUrl) {
  assertValidAssetReference(reference, 'terrain');
  const base = new URL(descriptorUrl, globalThis.location?.href);
  const resolved = new URL(reference.url, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password ||
      resolved.search || resolved.hash) {
    throw new Error('terrain preview asset must be a clean same-origin URL');
  }
  const directory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  if (!resolved.pathname.startsWith(directory)) {
    throw new Error('terrain preview asset escapes the descriptor directory');
  }
  return resolved.href;
}
