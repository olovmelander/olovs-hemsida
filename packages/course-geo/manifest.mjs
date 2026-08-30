import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_MANIFEST_VERSION = 1;
export const SOURCE_CATALOG_VERSION = 1;
export const CANONICAL_CRS = Object.freeze({
  compound: 'EPSG:5845',
  horizontal: 'EPSG:3006',
  vertical: 'EPSG:5613',
});
export const EXPECTED_GROUNDS = Object.freeze({
  angso: ['angso'],
  norrfallsviken: ['norrfallsviken'],
  puttom: ['puttom'],
  upsala: ['upsala', 'upsala-mellanbanan'],
  johannesberg: ['johannesberg', 'johannesberg-9'],
  veckefjarden: ['veckefjarden', 'veckefjarden-korthalsbanan'],
});

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = new Set([
  'terrain', 'surface', 'imagery', 'topography', 'canopy', 'object',
  'hydrology', 'routing', 'control', 'course-guide',
]);
const LIFECYCLES = new Set(['planned', 'legacy', 'acquired', 'approved']);
const USES = new Set([
  'candidate', 'supporting', 'supplemental', 'reference-only',
  'migration-only', 'authoritative',
]);
const ARTIFACT_KINDS = new Set([
  'terrain', 'surface', 'canopy', 'topography', 'routing', 'control',
  'composite', 'acquisition',
]);
const ARTIFACT_USES = new Set(['migration-only', 'discovery-evidence']);
const LICENCE_REVIEWS = new Set(['approved', 'pending', 'blocked']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sortedUnique = values => [...new Set(values)].sort();

function exactKeys(value, allowed, at, fail) {
  if (!object(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(at + '.' + key, 'unknown field');
  }
}

function bbox(value, at, fail) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(v => !Number.isFinite(v))) {
    fail(at, 'must be [west, south, east, north]');
    return;
  }
  const [west, south, east, north] = value;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    fail(at, 'has invalid WGS84 bounds or axis order');
  }
}

function roles(value, at, fail) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(at, 'must contain at least one role');
    return;
  }
  if (new Set(value).size !== value.length) fail(at, 'contains duplicate roles');
  value.forEach((role, index) => {
    if (!ROLES.has(role)) fail(at + '[' + index + ']', 'unknown role ' + JSON.stringify(role));
  });
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(file + ': ' + error.message);
  }
}

export function validateSourceCatalog(catalog) {
  const errors = [];
  const fail = (at, message) => errors.push(at + ': ' + message);
  if (!object(catalog)) return ['catalog: must be an object'];
  exactKeys(catalog, new Set(['$schema', 'schemaVersion', 'products']), 'catalog', fail);
  if (catalog.schemaVersion !== SOURCE_CATALOG_VERSION) {
    fail('catalog.schemaVersion', 'must be ' + SOURCE_CATALOG_VERSION);
  }
  if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
    fail('catalog.products', 'must be a non-empty array');
    return errors;
  }

  const ids = new Set();
  catalog.products.forEach((product, index) => {
    const at = 'catalog.products[' + index + ']';
    if (!object(product)) { fail(at, 'must be an object'); return; }
    exactKeys(product, new Set([
      'id', 'provider', 'product', 'homepage', 'horizontalCrs', 'verticalCrs',
      'licence',
    ]), at, fail);
    if (!ID.test(product.id || '')) fail(at + '.id', 'must be kebab-case');
    else if (ids.has(product.id)) fail(at + '.id', 'duplicate product id');
    else ids.add(product.id);
    for (const field of ['provider', 'product', 'homepage']) {
      if (!text(product[field])) fail(at + '.' + field, 'must be explicit');
    }
    for (const field of ['horizontalCrs', 'verticalCrs']) {
      if (product[field] !== null && !text(product[field])) {
        fail(at + '.' + field, 'must be a CRS description or null');
      }
    }
    const licence = product.licence;
    if (!object(licence)) { fail(at + '.licence', 'must be an object'); return; }
    exactKeys(licence, new Set([
      'id', 'attribution', 'redistribution', 'derivatives', 'reviewStatus', 'notes',
    ]), at + '.licence', fail);
    for (const field of ['id', 'attribution', 'redistribution', 'derivatives', 'notes']) {
      if (!text(licence[field])) fail(at + '.licence.' + field, 'must be explicit');
    }
    if (!LICENCE_REVIEWS.has(licence.reviewStatus)) {
      fail(at + '.licence.reviewStatus', 'must be approved, pending or blocked');
    }
  });
  return errors;
}

export function catalogProductMap(catalog) {
  const errors = validateSourceCatalog(catalog);
  if (errors.length) throw new Error('invalid source catalog:\n' + errors.join('\n'));
  return new Map(catalog.products.map(product => [product.id, product]));
}

export function validateSourceManifest(manifest, options = {}) {
  const errors = [];
  const fail = (at, message) => errors.push(at + ': ' + message);
  const label = options.label || 'manifest';
  const products = options.catalog ? catalogProductMap(options.catalog) : new Map();
  if (!object(manifest)) return [label + ': must be an object'];

  exactKeys(manifest, new Set([
    '$schema', 'schemaVersion', 'groundId', 'groundName', 'courseSlugs',
    'targetBboxWgs84', 'legacyFrame', 'canonicalFrame', 'sources', 'artifacts',
    'blockers',
  ]), label, fail);
  if (manifest.schemaVersion !== SOURCE_MANIFEST_VERSION) {
    fail(label + '.schemaVersion', 'must be ' + SOURCE_MANIFEST_VERSION);
  }
  if (!ID.test(manifest.groundId || '')) fail(label + '.groundId', 'must be kebab-case');
  if (!text(manifest.groundName)) fail(label + '.groundName', 'must be explicit');
  if (!Array.isArray(manifest.courseSlugs) || manifest.courseSlugs.length === 0) {
    fail(label + '.courseSlugs', 'must be a non-empty array');
  } else {
    if (new Set(manifest.courseSlugs).size !== manifest.courseSlugs.length) {
      fail(label + '.courseSlugs', 'contains duplicates');
    }
    manifest.courseSlugs.forEach((slug, index) => {
      if (!ID.test(slug || '')) fail(label + '.courseSlugs[' + index + ']', 'must be kebab-case');
    });
  }
  bbox(manifest.targetBboxWgs84, label + '.targetBboxWgs84', fail);
  validateLegacyFrame(manifest.legacyFrame, label, fail);
  validateCanonicalFrame(manifest.canonicalFrame, label, fail);

  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    fail(label + '.sources', 'must be a non-empty array');
  }
  const sourceIds = new Set();
  (manifest.sources || []).forEach((source, index) => {
    const at = label + '.sources[' + index + ']';
    if (!object(source)) { fail(at, 'must be an object'); return; }
    exactKeys(source, new Set([
      'id', 'productId', 'roles', 'lifecycle', 'use', 'sourceUri', 'localPath',
      'bboxWgs84', 'acquiredAt', 'capturedAt', 'checksum', 'checksumReason',
      'replacementSourceId', 'accuracyTier', 'horizontalAccuracyMetres',
      'verticalAccuracyMetres', 'notes',
    ]), at, fail);
    if (!ID.test(source.id || '')) fail(at + '.id', 'must be kebab-case');
    else if (sourceIds.has(source.id)) fail(at + '.id', 'duplicate source id');
    else sourceIds.add(source.id);
    if (!products.has(source.productId)) fail(at + '.productId', 'unknown product ' + JSON.stringify(source.productId));
    roles(source.roles, at + '.roles', fail);
    if (!LIFECYCLES.has(source.lifecycle)) fail(at + '.lifecycle', 'invalid lifecycle');
    if (!USES.has(source.use)) fail(at + '.use', 'invalid use');
    if (!text(source.sourceUri)) fail(at + '.sourceUri', 'must be explicit');
    if (source.localPath !== null && !text(source.localPath)) fail(at + '.localPath', 'must be a path or null');
    if (source.bboxWgs84 !== null) bbox(source.bboxWgs84, at + '.bboxWgs84', fail);
    for (const field of ['acquiredAt', 'capturedAt']) {
      if (source[field] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(source[field])) {
        fail(at + '.' + field, 'must be YYYY-MM-DD or null');
      }
    }
    if (source.checksum !== null && !SHA256.test(source.checksum || '')) {
      fail(at + '.checksum', 'must be a lowercase sha256 or null');
    }
    if (source.checksum === null && !text(source.checksumReason)) {
      fail(at + '.checksumReason', 'is required when checksum is null');
    }
    if (source.checksum !== null && source.checksumReason !== null) {
      fail(at + '.checksumReason', 'must be null when checksum is present');
    }
    if (source.localPath !== null && source.checksum === null) {
      fail(at + '.checksum', 'local source assets require a checksum');
    }
    if (source.lifecycle === 'planned' && (source.localPath !== null || source.checksum !== null)) {
      fail(at, 'planned sources cannot claim acquired files');
    }
    if (source.lifecycle === 'acquired' &&
        (source.checksum === null || source.acquiredAt === null)) {
      fail(at, 'acquired sources require a checksum and acquisition date');
    }
    if (source.use === 'migration-only' && !text(source.replacementSourceId)) {
      fail(at + '.replacementSourceId', 'migration-only sources require a replacement');
    }
    if (source.use !== 'migration-only' && source.replacementSourceId !== null) {
      fail(at + '.replacementSourceId', 'only migration-only sources name replacements');
    }
    if (!['A', 'B', 'C', 'D', 'E', 'unrated'].includes(source.accuracyTier)) {
      fail(at + '.accuracyTier', 'invalid tier');
    }
    for (const field of ['horizontalAccuracyMetres', 'verticalAccuracyMetres']) {
      if (source[field] !== null && (!Number.isFinite(source[field]) || source[field] < 0)) {
        fail(at + '.' + field, 'must be non-negative or null');
      }
    }
    if (!text(source.notes)) fail(at + '.notes', 'must state scope and limitations');

    const product = products.get(source.productId);
    if (source.use === 'authoritative') {
      if (source.lifecycle !== 'approved') fail(at + '.lifecycle', 'authoritative use requires approval');
      if (product?.licence.reviewStatus !== 'approved') fail(at + '.productId', 'licence is not approved');
      if (source.checksum === null || source.acquiredAt === null) {
        fail(at, 'authoritative use requires checksum and acquisition date');
      }
    }
    if (product?.licence.reviewStatus === 'blocked' &&
        !['migration-only', 'reference-only'].includes(source.use)) {
      fail(at + '.use', 'blocked products are migration/reference only');
    }
    if (options.repoRoot && source.localPath !== null && SHA256.test(source.checksum || '')) {
      localChecksum(source.localPath, source.checksum, at, options.repoRoot, fail);
    }
  });
  (manifest.sources || []).forEach((source, index) => {
    if (source.replacementSourceId !== null && !sourceIds.has(source.replacementSourceId)) {
      fail(label + '.sources[' + index + '].replacementSourceId', 'does not resolve');
    }
  });

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail(label + '.artifacts', 'must inventory committed migration artifacts');
  }
  const artifactIds = new Set();
  (manifest.artifacts || []).forEach((artifact, index) => {
    const at = label + '.artifacts[' + index + ']';
    if (!object(artifact)) { fail(at, 'must be an object'); return; }
    exactKeys(artifact, new Set([
      'id', 'kind', 'path', 'sha256', 'derivedFrom', 'use', 'notes',
    ]), at, fail);
    if (!ID.test(artifact.id || '')) fail(at + '.id', 'must be kebab-case');
    else if (artifactIds.has(artifact.id)) fail(at + '.id', 'duplicate artifact id');
    else artifactIds.add(artifact.id);
    if (!ARTIFACT_KINDS.has(artifact.kind)) fail(at + '.kind', 'unknown kind');
    if (!text(artifact.path)) fail(at + '.path', 'is required');
    if (!SHA256.test(artifact.sha256 || '')) fail(at + '.sha256', 'must be a lowercase sha256');
    if (!ARTIFACT_USES.has(artifact.use)) {
      fail(at + '.use', 'must be migration-only or discovery-evidence');
    }
    if (!Array.isArray(artifact.derivedFrom) || artifact.derivedFrom.length === 0) {
      fail(at + '.derivedFrom', 'must name source ids');
    } else {
      if (new Set(artifact.derivedFrom).size !== artifact.derivedFrom.length) {
        fail(at + '.derivedFrom', 'contains duplicates');
      }
      artifact.derivedFrom.forEach(sourceId => {
        if (!sourceIds.has(sourceId)) fail(at + '.derivedFrom', 'unknown source ' + JSON.stringify(sourceId));
      });
    }
    if (!text(artifact.notes)) fail(at + '.notes', 'must describe the artifact');
    if (options.repoRoot && text(artifact.path) && SHA256.test(artifact.sha256 || '')) {
      localChecksum(artifact.path, artifact.sha256, at, options.repoRoot, fail);
    }
  });

  if (!Array.isArray(manifest.blockers)) fail(label + '.blockers', 'must be an array');
  const blockerIds = new Set();
  (manifest.blockers || []).forEach((blocker, index) => {
    const at = label + '.blockers[' + index + ']';
    if (!object(blocker)) { fail(at, 'must be an object'); return; }
    exactKeys(blocker, new Set(['id', 'severity', 'description', 'exitGate']), at, fail);
    if (!ID.test(blocker.id || '')) fail(at + '.id', 'must be kebab-case');
    else if (blockerIds.has(blocker.id)) fail(at + '.id', 'duplicate blocker id');
    else blockerIds.add(blocker.id);
    if (!['release-blocking', 'quality', 'follow-up'].includes(blocker.severity)) {
      fail(at + '.severity', 'invalid severity');
    }
    if (!text(blocker.description)) fail(at + '.description', 'is required');
    if (!text(blocker.exitGate)) fail(at + '.exitGate', 'is required');
  });
  return errors;
}

function validateLegacyFrame(legacy, label, fail) {
  const at = label + '.legacyFrame';
  if (!object(legacy)) { fail(at, 'must be an object'); return; }
  exactKeys(legacy, new Set([
    'buildDirectory', 'originWgs84', 'metresPerLatitude', 'metresPerLongitude',
    'heightReference', 'frame',
  ]), at, fail);
  if (!text(legacy.buildDirectory)) fail(at + '.buildDirectory', 'is required');
  if (!object(legacy.originWgs84)) fail(at + '.originWgs84', 'must be an object');
  else {
    exactKeys(legacy.originWgs84, new Set(['latitude', 'longitude']), at + '.originWgs84', fail);
    const { latitude, longitude } = legacy.originWgs84;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      fail(at + '.originWgs84.latitude', 'invalid latitude');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      fail(at + '.originWgs84.longitude', 'invalid longitude');
    }
  }
  if (!Number.isFinite(legacy.metresPerLatitude) || legacy.metresPerLatitude <= 0) {
    fail(at + '.metresPerLatitude', 'must be positive');
  }
  if (!Number.isFinite(legacy.metresPerLongitude) || legacy.metresPerLongitude <= 0) {
    fail(at + '.metresPerLongitude', 'must be positive');
  }
  if (!text(legacy.heightReference)) fail(at + '.heightReference', 'must be explicit');
  if (!text(legacy.frame)) fail(at + '.frame', 'must be explicit');
}

function validateCanonicalFrame(canonical, label, fail) {
  const at = label + '.canonicalFrame';
  if (!object(canonical)) { fail(at, 'must be an object'); return; }
  exactKeys(canonical, new Set([
    'compoundCrs', 'horizontalCrs', 'verticalCrs', 'originStatus', 'origin',
    'axisMapping',
  ]), at, fail);
  for (const [field, expected] of Object.entries({
    compoundCrs: CANONICAL_CRS.compound,
    horizontalCrs: CANONICAL_CRS.horizontal,
    verticalCrs: CANONICAL_CRS.vertical,
  })) {
    if (canonical[field] !== expected) fail(at + '.' + field, 'must be ' + expected);
  }
  if (!['pending-control-approval', 'approved'].includes(canonical.originStatus)) {
    fail(at + '.originStatus', 'invalid status');
  }
  if (!object(canonical.origin)) fail(at + '.origin', 'must be an object');
  else {
    exactKeys(canonical.origin, new Set(['easting', 'northing', 'heightRH2000']), at + '.origin', fail);
    const values = ['easting', 'northing', 'heightRH2000'].map(field => canonical.origin[field]);
    if (canonical.originStatus === 'approved' && values.some(value => !Number.isFinite(value))) {
      fail(at + '.origin', 'approved origins require three coordinates');
    }
    if (canonical.originStatus !== 'approved' && values.some(value => value !== null)) {
      fail(at + '.origin', 'pending origins must remain null');
    }
  }
  const expected = {
    worldX: 'easting - originEasting',
    worldZ: 'originNorthing - northing',
    worldY: 'heightRH2000 - originHeightRH2000',
  };
  if (!object(canonical.axisMapping)) fail(at + '.axisMapping', 'must be an object');
  else {
    exactKeys(canonical.axisMapping, new Set(Object.keys(expected)), at + '.axisMapping', fail);
    for (const [field, value] of Object.entries(expected)) {
      if (canonical.axisMapping[field] !== value) {
        fail(at + '.axisMapping.' + field, 'must be ' + JSON.stringify(value));
      }
    }
  }
}

function localChecksum(relativePath, expected, at, repoRoot, fail) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    fail(at + '.path', 'must stay inside the repository');
    return;
  }
  const file = path.join(repoRoot, relativePath);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(at + '.path', 'file does not exist: ' + relativePath);
    return;
  }
  const actual = sha256File(file);
  if (actual !== expected) {
    fail(at + '.sha256', 'checksum mismatch for ' + relativePath + ' (actual ' + actual + ')');
  }
}

export function validateGroundCoverage(manifests) {
  const errors = [];
  const seen = new Map();
  for (const manifest of manifests) {
    if (seen.has(manifest.groundId)) errors.push('duplicate ground manifest ' + manifest.groundId);
    seen.set(manifest.groundId, manifest);
  }
  for (const [groundId, slugs] of Object.entries(EXPECTED_GROUNDS)) {
    const manifest = seen.get(groundId);
    if (!manifest) { errors.push('missing ground manifest ' + groundId); continue; }
    const actual = sortedUnique(manifest.courseSlugs || []);
    const expected = sortedUnique(slugs);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(groundId + ': expected slugs ' + expected.join(', ') + '; got ' + actual.join(', '));
    }
  }
  for (const groundId of seen.keys()) {
    if (!(groundId in EXPECTED_GROUNDS)) errors.push('unexpected ground manifest ' + groundId);
  }
  return errors;
}
