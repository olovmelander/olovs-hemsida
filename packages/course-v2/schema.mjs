export const V2_SCHEMA_VERSION = 2;
export const V2_CHUNK_MAGIC = 'BVCH';
export const V2_CHUNK_MEDIA_TYPE = 'application/vnd.banvy.chunk-v2';
export const V2_COURSE_MEDIA_TYPE = 'application/vnd.banvy.course-manifest-v2+json';
export const V2_GROUND_MEDIA_TYPE = 'application/vnd.banvy.ground-manifest-v2+json';
export const MAX_CHUNK_ENCODED_BYTES = 16 * 1024 * 1024;
export const MAX_CHUNK_DECODED_BYTES = 64 * 1024 * 1024;

export const V2_SUPPORTED_FEATURES = Object.freeze([
  'chunk-envelope-v2',
  'course-routing-json-v1',
  'object-registry-json-v1',
  'surface-grid-u8-i16-v1',
  'surface-sdf-u8-v1',
  'terrain-grid-u16-v1',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEATURE = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/;
const TILE_ID = /^[a-z0-9]+(?:[a-z0-9._/-]*[a-z0-9])?$/;
const ASSET_KINDS = new Set(['terrain', 'surface', 'objects', 'routing']);
const ACCURACY_TIERS = new Set(['A', 'B', 'C', 'D', 'E', 'unrated']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function exactKeys(value, allowed, at, fail) {
  if (!object(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${at}.${key}`, 'unknown field');
  }
}

function requiredText(value, at, fail) {
  if (typeof value !== 'string' || !value.trim()) fail(at, 'must be a non-empty string');
}

function id(value, at, fail) {
  if (!ID.test(value || '')) fail(at, 'must be a lowercase kebab-case id');
}

function integer(value, at, fail, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(at, `must be an integer from ${minimum} to ${maximum}`);
  }
}

function finite(value, at, fail, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(at, `must be a finite number from ${minimum} to ${maximum}`);
  }
}

function sha256(value, at, fail) {
  if (!SHA256.test(value || '')) fail(at, 'must be a lowercase SHA-256');
}

function sortedUniqueStrings(value, at, fail, validateItem = requiredText, allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(at, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    return;
  }
  value.forEach((item, index) => validateItem(item, `${at}[${index}]`, fail));
  for (let index = 1; index < value.length; index++) {
    if (value[index - 1] >= value[index]) {
      fail(at, 'must be sorted and contain no duplicates');
      break;
    }
  }
}

function feature(value, at, fail) {
  if (!FEATURE.test(value || '')) fail(at, 'must be a versioned kebab-case feature id');
}

function tileId(value, at, fail) {
  if (!TILE_ID.test(value || '') || value.includes('..') || value.includes('//')) {
    fail(at, 'must be a safe relative tile id');
  }
}

function relativeUrl(value, at, fail, sha, suffix) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') ||
      value.includes('?') || value.includes('#') || value.includes('://')) {
    fail(at, 'must be a query-free relative URL');
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(value); }
  catch { fail(at, 'contains invalid percent encoding'); return; }
  const segments = decoded.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) {
    fail(at, 'must not contain empty or traversal segments');
  }
  if (sha && suffix && !segments.at(-1)?.endsWith(`${sha}${suffix}`)) {
    fail(at, `filename must contain the full declared hash before ${suffix}`);
  }
}

function bounds(value, at, fail) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  const fields = [
    'minEasting', 'minNorthing', 'minHeightRH2000',
    'maxEasting', 'maxNorthing', 'maxHeightRH2000',
  ];
  exactKeys(value, new Set(fields), at, fail);
  for (const field of fields) finite(value[field], `${at}.${field}`, fail);
  if (Number.isFinite(value.minEasting) && Number.isFinite(value.maxEasting) &&
      value.minEasting >= value.maxEasting) fail(at, 'minEasting must be below maxEasting');
  if (Number.isFinite(value.minNorthing) && Number.isFinite(value.maxNorthing) &&
      value.minNorthing >= value.maxNorthing) fail(at, 'minNorthing must be below maxNorthing');
  if (Number.isFinite(value.minHeightRH2000) && Number.isFinite(value.maxHeightRH2000) &&
      value.minHeightRH2000 > value.maxHeightRH2000) fail(at, 'minimum height exceeds maximum height');
}

function validateAssetReference(value, at, fail, expectedKind = null) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  exactKeys(value, new Set([
    'kind', 'url', 'mediaType', 'bytes', 'sha256', 'decodedBytes',
    'decodedSha256', 'requiredFeatures',
  ]), at, fail);
  if (!ASSET_KINDS.has(value.kind)) fail(`${at}.kind`, 'has an unsupported asset kind');
  if (expectedKind && value.kind !== expectedKind) fail(`${at}.kind`, `must be ${expectedKind}`);
  if (value.mediaType !== V2_CHUNK_MEDIA_TYPE) fail(`${at}.mediaType`, `must be ${V2_CHUNK_MEDIA_TYPE}`);
  integer(value.bytes, `${at}.bytes`, fail, 16, MAX_CHUNK_ENCODED_BYTES);
  integer(value.decodedBytes, `${at}.decodedBytes`, fail, 0, MAX_CHUNK_DECODED_BYTES);
  sha256(value.sha256, `${at}.sha256`, fail);
  sha256(value.decodedSha256, `${at}.decodedSha256`, fail);
  relativeUrl(value.url, `${at}.url`, fail, value.sha256, '.bvch');
  sortedUniqueStrings(value.requiredFeatures, `${at}.requiredFeatures`, fail, feature, false);
  if (Array.isArray(value.requiredFeatures) && !value.requiredFeatures.includes('chunk-envelope-v2')) {
    fail(`${at}.requiredFeatures`, 'must include chunk-envelope-v2');
  }
}

function validateManifestReference(value, at, fail, mediaType) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  exactKeys(value, new Set(['url', 'mediaType', 'bytes', 'sha256']), at, fail);
  if (value.mediaType !== mediaType) fail(`${at}.mediaType`, `must be ${mediaType}`);
  integer(value.bytes, `${at}.bytes`, fail, 2, 4 * 1024 * 1024);
  sha256(value.sha256, `${at}.sha256`, fail);
  relativeUrl(value.url, `${at}.url`, fail, value.sha256, '.json');
}

function validateFallback(value, at, fail) {
  if (!object(value)) { fail(at, 'must be an object'); return; }
  exactKeys(value, new Set(['format', 'packUrl', 'bytes', 'sha256']), at, fail);
  if (value.format !== 1) fail(`${at}.format`, 'must be 1');
  integer(value.bytes, `${at}.bytes`, fail, 1, 16 * 1024 * 1024);
  sha256(value.sha256, `${at}.sha256`, fail);
  relativeUrl(value.packUrl, `${at}.packUrl`, fail);
  if (typeof value.packUrl === 'string' && !value.packUrl.endsWith('/pack.bin')) {
    fail(`${at}.packUrl`, 'must end in /pack.bin');
  }
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
    finite(value.origin.easting, `${at}.origin.easting`, fail);
    finite(value.origin.northing, `${at}.origin.northing`, fail);
    finite(value.origin.heightRH2000, `${at}.origin.heightRH2000`, fail);
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
      if (value.axisMapping[key] !== expected) fail(`${at}.axisMapping.${key}`, `must be ${JSON.stringify(expected)}`);
    }
  }
  sha256(value.fingerprint, `${at}.fingerprint`, fail);
}

export function validateRootIndex(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'root';
  if (!object(value)) return ['root: must be an object'];
  exactKeys(value, new Set(['$schema', 'schemaVersion', 'courses']), at, fail);
  requiredText(value.$schema, `${at}.$schema`, fail);
  if (value.schemaVersion !== V2_SCHEMA_VERSION) fail(`${at}.schemaVersion`, `must be ${V2_SCHEMA_VERSION}`);
  if (!Array.isArray(value.courses) || !value.courses.length) {
    fail(`${at}.courses`, 'must be a non-empty array');
    return errors;
  }
  const slugs = new Set();
  value.courses.forEach((entry, index) => {
    const path = `${at}.courses[${index}]`;
    if (!object(entry)) { fail(path, 'must be an object'); return; }
    exactKeys(entry, new Set([
      'slug', 'name', 'groundId', 'courseFormat', 'groundFormat', 'manifest', 'fallbackV1',
    ]), path, fail);
    id(entry.slug, `${path}.slug`, fail);
    if (slugs.has(entry.slug)) fail(`${path}.slug`, 'is duplicated');
    slugs.add(entry.slug);
    requiredText(entry.name, `${path}.name`, fail);
    id(entry.groundId, `${path}.groundId`, fail);
    if (entry.courseFormat !== 2) fail(`${path}.courseFormat`, 'must be 2');
    if (entry.groundFormat !== 2) fail(`${path}.groundFormat`, 'must be 2');
    validateManifestReference(entry.manifest, `${path}.manifest`, fail, V2_COURSE_MEDIA_TYPE);
    validateFallback(entry.fallbackV1, `${path}.fallbackV1`, fail);
  });
  return errors;
}

export function validateGroundManifest(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'ground';
  if (!object(value)) return ['ground: must be an object'];
  exactKeys(value, new Set([
    '$schema', 'schemaVersion', 'groundFormat', 'groundId', 'requiredFeatures',
    'frame', 'bounds', 'sourceManifestSha256', 'shell', 'tiles',
  ]), at, fail);
  requiredText(value.$schema, `${at}.$schema`, fail);
  if (value.schemaVersion !== 2) fail(`${at}.schemaVersion`, 'must be 2');
  if (value.groundFormat !== 2) fail(`${at}.groundFormat`, 'must be 2');
  id(value.groundId, `${at}.groundId`, fail);
  sortedUniqueStrings(value.requiredFeatures, `${at}.requiredFeatures`, fail, feature, false);
  validateFrame(value.frame, `${at}.frame`, fail);
  bounds(value.bounds, `${at}.bounds`, fail);
  sha256(value.sourceManifestSha256, `${at}.sourceManifestSha256`, fail);
  validateAssetReference(value.shell, `${at}.shell`, fail, 'terrain');
  if (!Array.isArray(value.tiles) || !value.tiles.length) {
    fail(`${at}.tiles`, 'must be a non-empty array');
    return errors;
  }
  const tileIds = new Set();
  value.tiles.forEach((tile, index) => {
    const path = `${at}.tiles[${index}]`;
    if (!object(tile)) { fail(path, 'must be an object'); return; }
    exactKeys(tile, new Set(['id', 'lod', 'bounds', 'geometricErrorMetres', 'courses', 'layers']), path, fail);
    tileId(tile.id, `${path}.id`, fail);
    if (tileIds.has(tile.id)) fail(`${path}.id`, 'is duplicated');
    tileIds.add(tile.id);
    integer(tile.lod, `${path}.lod`, fail, 0, 31);
    bounds(tile.bounds, `${path}.bounds`, fail);
    finite(tile.geometricErrorMetres, `${path}.geometricErrorMetres`, fail, 0, 100000);
    sortedUniqueStrings(tile.courses, `${path}.courses`, fail, id, false);
    if (!object(tile.layers)) fail(`${path}.layers`, 'must be an object');
    else {
      exactKeys(tile.layers, new Set(['terrain', 'surface', 'objects']), `${path}.layers`, fail);
      validateAssetReference(tile.layers.terrain, `${path}.layers.terrain`, fail, 'terrain');
      for (const kind of ['surface', 'objects']) {
        if (tile.layers[kind] !== null) validateAssetReference(tile.layers[kind], `${path}.layers.${kind}`, fail, kind);
      }
    }
  });
  return errors;
}

export function validateCourseManifest(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'course';
  if (!object(value)) return ['course: must be an object'];
  exactKeys(value, new Set([
    '$schema', 'schemaVersion', 'courseFormat', 'groundFormat', 'slug', 'groundId',
    'requiredFeatures', 'groundManifest', 'routing', 'holes', 'fallbackV1',
  ]), at, fail);
  requiredText(value.$schema, `${at}.$schema`, fail);
  if (value.schemaVersion !== 2) fail(`${at}.schemaVersion`, 'must be 2');
  if (value.courseFormat !== 2) fail(`${at}.courseFormat`, 'must be 2');
  if (value.groundFormat !== 2) fail(`${at}.groundFormat`, 'must be 2');
  id(value.slug, `${at}.slug`, fail);
  id(value.groundId, `${at}.groundId`, fail);
  sortedUniqueStrings(value.requiredFeatures, `${at}.requiredFeatures`, fail, feature, false);
  validateManifestReference(value.groundManifest, `${at}.groundManifest`, fail, V2_GROUND_MEDIA_TYPE);
  validateAssetReference(value.routing, `${at}.routing`, fail, 'routing');
  validateFallback(value.fallbackV1, `${at}.fallbackV1`, fail);
  if (!Array.isArray(value.holes) || !value.holes.length) {
    fail(`${at}.holes`, 'must be a non-empty array');
    return errors;
  }
  value.holes.forEach((hole, index) => {
    const path = `${at}.holes[${index}]`;
    if (!object(hole)) { fail(path, 'must be an object'); return; }
    exactKeys(hole, new Set([
      'number', 'par', 'strokeIndex', 'strokeIndexStatus', 'tileIds', 'accuracyTier',
    ]), path, fail);
    integer(hole.number, `${path}.number`, fail, 1, 99);
    if (hole.number !== index + 1) fail(`${path}.number`, `must be ${index + 1}`);
    integer(hole.par, `${path}.par`, fail, 3, 6);
    if (hole.strokeIndex !== null) integer(hole.strokeIndex, `${path}.strokeIndex`, fail, 1, 99);
    if (!['verified', 'unverified', 'not-applicable'].includes(hole.strokeIndexStatus)) {
      fail(`${path}.strokeIndexStatus`, 'must be verified, unverified or not-applicable');
    }
    if (hole.strokeIndexStatus === 'verified' && hole.strokeIndex === null) {
      fail(`${path}.strokeIndex`, 'is required when stroke index is verified');
    }
    if (hole.strokeIndexStatus === 'not-applicable' && hole.strokeIndex !== null) {
      fail(`${path}.strokeIndex`, 'must be null when stroke index is not applicable');
    }
    sortedUniqueStrings(hole.tileIds, `${path}.tileIds`, fail, tileId, false);
    if (!ACCURACY_TIERS.has(hole.accuracyTier)) fail(`${path}.accuracyTier`, 'has an invalid accuracy tier');
  });
  return errors;
}

export function validateChunkHeader(value) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  const at = 'chunk';
  if (!object(value)) return ['chunk: must be an object'];
  exactKeys(value, new Set([
    'schemaVersion', 'id', 'kind', 'owner', 'bounds', 'payloadFormat',
    'decodedBytes', 'decodedSha256', 'requiredFeatures', 'grid', 'surfaceGrid', 'surfaceSdf', 'records',
  ]), at, fail);
  if (value.schemaVersion !== 2) fail(`${at}.schemaVersion`, 'must be 2');
  tileId(value.id, `${at}.id`, fail);
  if (!ASSET_KINDS.has(value.kind)) fail(`${at}.kind`, 'has an unsupported kind');
  if (!object(value.owner)) fail(`${at}.owner`, 'must be an object');
  else {
    exactKeys(value.owner, new Set(['type', 'id']), `${at}.owner`, fail);
    if (!['ground', 'course'].includes(value.owner.type)) fail(`${at}.owner.type`, 'must be ground or course');
    id(value.owner.id, `${at}.owner.id`, fail);
    if (['terrain', 'surface', 'objects'].includes(value.kind) && value.owner.type !== 'ground') {
      fail(`${at}.owner.type`, `${value.kind} must belong to a ground`);
    }
    if (value.kind === 'routing' && value.owner.type !== 'course') fail(`${at}.owner.type`, 'routing must belong to a course');
  }
  bounds(value.bounds, `${at}.bounds`, fail);
  requiredText(value.payloadFormat, `${at}.payloadFormat`, fail);
  integer(value.decodedBytes, `${at}.decodedBytes`, fail, 0, MAX_CHUNK_DECODED_BYTES);
  sha256(value.decodedSha256, `${at}.decodedSha256`, fail);
  sortedUniqueStrings(value.requiredFeatures, `${at}.requiredFeatures`, fail, feature, false);
  if (Array.isArray(value.requiredFeatures) && !value.requiredFeatures.includes('chunk-envelope-v2')) {
    fail(`${at}.requiredFeatures`, 'must include chunk-envelope-v2');
  }
  if (value.payloadFormat === 'terrain-grid-u16-le-v1') {
    if (value.kind !== 'terrain') fail(`${at}.kind`, 'must be terrain for a terrain grid');
    if (!object(value.grid)) fail(`${at}.grid`, 'is required for a terrain grid');
    else {
      exactKeys(value.grid, new Set([
        'width', 'height', 'sampleSpacingMetres', 'heightOffsetMetres',
        'heightScaleMetres', 'noDataValue', 'rowOrder', 'columnOrder',
        'geometricErrorMetres',
      ]), `${at}.grid`, fail);
      integer(value.grid.width, `${at}.grid.width`, fail, 2, 4097);
      integer(value.grid.height, `${at}.grid.height`, fail, 2, 4097);
      finite(value.grid.sampleSpacingMetres, `${at}.grid.sampleSpacingMetres`, fail, 0.01, 10000);
      finite(value.grid.heightOffsetMetres, `${at}.grid.heightOffsetMetres`, fail);
      finite(value.grid.heightScaleMetres, `${at}.grid.heightScaleMetres`, fail, 0.0001, 10);
      integer(value.grid.noDataValue, `${at}.grid.noDataValue`, fail, 0, 65535);
      if (value.grid.rowOrder !== 'north-to-south') fail(`${at}.grid.rowOrder`, 'must be north-to-south');
      if (value.grid.columnOrder !== 'west-to-east') fail(`${at}.grid.columnOrder`, 'must be west-to-east');
      finite(value.grid.geometricErrorMetres, `${at}.grid.geometricErrorMetres`, fail, 0, 100000);
      if (Number.isSafeInteger(value.grid.width) && Number.isSafeInteger(value.grid.height) &&
          value.decodedBytes !== value.grid.width * value.grid.height * 2) {
        fail(`${at}.decodedBytes`, 'must equal width * height * 2');
      }
    }
    if (Array.isArray(value.requiredFeatures) && !value.requiredFeatures.includes('terrain-grid-u16-v1')) {
      fail(`${at}.requiredFeatures`, 'terrain grids must require terrain-grid-u16-v1');
    }
    if (value.surfaceGrid !== undefined) fail(`${at}.surfaceGrid`, 'is not allowed for a terrain grid');
    if (value.records !== undefined) fail(`${at}.records`, 'is not allowed for a terrain grid');
    if (value.surfaceSdf !== undefined) fail(`${at}.surfaceSdf`, 'is not allowed for a terrain grid');
  } else if (value.payloadFormat === 'surface-grid-u8-i16-le-v1') {
    if (value.kind !== 'surface') fail(`${at}.kind`, 'must be surface for a surface grid');
    if (!object(value.surfaceGrid)) fail(`${at}.surfaceGrid`, 'is required for a surface grid');
    else {
      exactKeys(value.surfaceGrid, new Set([
        'width', 'height', 'sampleSpacingMetres', 'bytesPerSample',
        'distanceScaleMetres', 'mowCoordinateScaleMetres', 'noDataSurfaceId',
        'surfaceRegistryVersion', 'rowOrder', 'columnOrder',
        'mowDirectionEncoding', 'continuousEncoding',
      ]), `${at}.surfaceGrid`, fail);
      integer(value.surfaceGrid.width, `${at}.surfaceGrid.width`, fail, 2, 4097);
      integer(value.surfaceGrid.height, `${at}.surfaceGrid.height`, fail, 2, 4097);
      finite(value.surfaceGrid.sampleSpacingMetres, `${at}.surfaceGrid.sampleSpacingMetres`, fail, 0.01, 10000);
      if (value.surfaceGrid.bytesPerSample !== 14) fail(`${at}.surfaceGrid.bytesPerSample`, 'must be 14');
      finite(value.surfaceGrid.distanceScaleMetres, `${at}.surfaceGrid.distanceScaleMetres`, fail, 0.001, 10);
      finite(value.surfaceGrid.mowCoordinateScaleMetres, `${at}.surfaceGrid.mowCoordinateScaleMetres`, fail, 0.001, 100);
      if (value.surfaceGrid.noDataSurfaceId !== 255) fail(`${at}.surfaceGrid.noDataSurfaceId`, 'must be 255');
      integer(value.surfaceGrid.surfaceRegistryVersion, `${at}.surfaceGrid.surfaceRegistryVersion`, fail, 1, 65535);
      if (value.surfaceGrid.rowOrder !== 'north-to-south') {
        fail(`${at}.surfaceGrid.rowOrder`, 'must be north-to-south');
      }
      if (value.surfaceGrid.columnOrder !== 'west-to-east') {
        fail(`${at}.surfaceGrid.columnOrder`, 'must be west-to-east');
      }
      if (value.surfaceGrid.mowDirectionEncoding !== 'turn-u16') {
        fail(`${at}.surfaceGrid.mowDirectionEncoding`, 'must be turn-u16');
      }
      if (value.surfaceGrid.continuousEncoding !== 'unorm8') {
        fail(`${at}.surfaceGrid.continuousEncoding`, 'must be unorm8');
      }
      if (Number.isSafeInteger(value.surfaceGrid.width) && Number.isSafeInteger(value.surfaceGrid.height) &&
          value.decodedBytes !== value.surfaceGrid.width * value.surfaceGrid.height * 14) {
        fail(`${at}.decodedBytes`, 'must equal width * height * 14');
      }
    }
    if (Array.isArray(value.requiredFeatures) && !value.requiredFeatures.includes('surface-grid-u8-i16-v1')) {
      fail(`${at}.requiredFeatures`, 'surface grids must require surface-grid-u8-i16-v1');
    }
    if (value.grid !== undefined) fail(`${at}.grid`, 'is not allowed for a surface grid');
    if (value.records !== undefined) fail(`${at}.records`, 'is not allowed for a surface grid');
    if (value.surfaceSdf !== undefined) fail(`${at}.surfaceSdf`, 'is not allowed for a surface grid');
  } else if (value.payloadFormat === 'surface-sdf-u8-v1') {
    if (value.kind !== 'surface') fail(`${at}.kind`, 'must be surface for a surface sdf grid');
    if (!object(value.surfaceSdf)) fail(`${at}.surfaceSdf`, 'is required for a surface sdf grid');
    else {
      const sdf = value.surfaceSdf;
      exactKeys(sdf, new Set([
        'width', 'height', 'sampleSpacingMetres', 'bytesPerSample', 'channels',
        'distanceLimitMetres', 'distanceEncoding', 'routeStepMetres', 'noRouteValue',
        'ringStepMetres', 'ownerEncoding', 'surfaceRegistryVersion', 'rowOrder', 'columnOrder',
      ]), `${at}.surfaceSdf`, fail);
      integer(sdf.width, `${at}.surfaceSdf.width`, fail, 2, 4097);
      integer(sdf.height, `${at}.surfaceSdf.height`, fail, 2, 4097);
      finite(sdf.sampleSpacingMetres, `${at}.surfaceSdf.sampleSpacingMetres`, fail, 0.01, 10000);
      if (!Array.isArray(sdf.channels) || sdf.channels.length < 1 || sdf.channels.length > 16 ||
          sdf.channels.some(id => !Number.isSafeInteger(id) || id < 1 || id > 254) ||
          new Set(sdf.channels).size !== sdf.channels.length) {
        fail(`${at}.surfaceSdf.channels`, 'must list 1 to 16 unique surface ids from 1 to 254');
      } else if (sdf.bytesPerSample !== sdf.channels.length + 3) {
        fail(`${at}.surfaceSdf.bytesPerSample`, 'must equal channels + 3');
      }
      if (sdf.distanceLimitMetres !== 4) fail(`${at}.surfaceSdf.distanceLimitMetres`, 'must be 4');
      if (sdf.distanceEncoding !== 'unorm8-signed') fail(`${at}.surfaceSdf.distanceEncoding`, 'must be unorm8-signed');
      if (sdf.routeStepMetres !== 0.25) fail(`${at}.surfaceSdf.routeStepMetres`, 'must be 0.25');
      if (sdf.noRouteValue !== 255) fail(`${at}.surfaceSdf.noRouteValue`, 'must be 255');
      if (sdf.ringStepMetres !== 0.16) fail(`${at}.surfaceSdf.ringStepMetres`, 'must be 0.16');
      if (sdf.ownerEncoding !== 'u8-hole') fail(`${at}.surfaceSdf.ownerEncoding`, 'must be u8-hole');
      integer(sdf.surfaceRegistryVersion, `${at}.surfaceSdf.surfaceRegistryVersion`, fail, 1, 65535);
      if (sdf.rowOrder !== 'north-to-south') fail(`${at}.surfaceSdf.rowOrder`, 'must be north-to-south');
      if (sdf.columnOrder !== 'west-to-east') fail(`${at}.surfaceSdf.columnOrder`, 'must be west-to-east');
      if (Number.isSafeInteger(sdf.width) && Number.isSafeInteger(sdf.height) &&
          Number.isSafeInteger(sdf.bytesPerSample) &&
          value.decodedBytes !== sdf.width * sdf.height * sdf.bytesPerSample) {
        fail(`${at}.decodedBytes`, 'must equal width * height * bytesPerSample');
      }
    }
    if (Array.isArray(value.requiredFeatures) && !value.requiredFeatures.includes('surface-sdf-u8-v1')) {
      fail(`${at}.requiredFeatures`, 'surface sdf grids must require surface-sdf-u8-v1');
    }
    if (value.grid !== undefined) fail(`${at}.grid`, 'is not allowed for a surface sdf grid');
    if (value.surfaceGrid !== undefined) fail(`${at}.surfaceGrid`, 'is not allowed for a surface sdf grid');
    if (value.records !== undefined) fail(`${at}.records`, 'is not allowed for a surface sdf grid');
  } else if (value.payloadFormat === 'json-canonical-v1') {
    if (value.kind === 'terrain' || value.kind === 'surface') {
      fail(`${at}.payloadFormat`, `${value.kind} must use its binary grid payload`);
    }
    if (!['routing', 'objects'].includes(value.kind)) {
      fail(`${at}.kind`, 'canonical JSON is supported only for routing and objects');
    }
    if (!object(value.records)) fail(`${at}.records`, 'is required for canonical JSON');
    else {
      exactKeys(value.records, new Set(['content', 'count']), `${at}.records`, fail);
      requiredText(value.records.content, `${at}.records.content`, fail);
      integer(value.records.count, `${at}.records.count`, fail, 0, 10_000_000);
    }
    if (value.kind === 'routing' && Array.isArray(value.requiredFeatures) &&
        !value.requiredFeatures.includes('course-routing-json-v1')) {
      fail(`${at}.requiredFeatures`, 'routing chunks must require course-routing-json-v1');
    }
    if (value.kind === 'routing' && value.records?.content !== 'course-routing') {
      fail(`${at}.records.content`, 'routing chunks must contain course-routing');
    }
    if (value.kind === 'objects' && Array.isArray(value.requiredFeatures) &&
        !value.requiredFeatures.includes('object-registry-json-v1')) {
      fail(`${at}.requiredFeatures`, 'object chunks must require object-registry-json-v1');
    }
    if (value.kind === 'objects' && value.records?.content !== 'object-registry') {
      fail(`${at}.records.content`, 'object chunks must contain object-registry');
    }
    if (value.grid !== undefined) fail(`${at}.grid`, 'is not allowed for canonical JSON');
    if (value.surfaceGrid !== undefined) fail(`${at}.surfaceGrid`, 'is not allowed for canonical JSON');
    if (value.surfaceSdf !== undefined) fail(`${at}.surfaceSdf`, 'is not allowed for canonical JSON');
  } else {
    fail(`${at}.payloadFormat`, 'is not supported by schema version 2');
  }
  return errors;
}

export function missingRequiredFeatures(required, supported = V2_SUPPORTED_FEATURES) {
  const available = new Set(supported);
  return [...new Set(required || [])].filter(item => !available.has(item)).sort();
}

export function assertValid(label, errors) {
  if (errors.length) throw new Error(`invalid ${label}:\n${errors.join('\n')}`);
}

export function assertSupported(label, required, supported = V2_SUPPORTED_FEATURES) {
  const missing = missingRequiredFeatures(required, supported);
  if (missing.length) throw new Error(`${label} requires unsupported features: ${missing.join(', ')}`);
}

export function assertValidAssetReference(value, expectedKind = null) {
  const errors = [];
  validateAssetReference(value, 'asset', (at, message) => errors.push(`${at}: ${message}`), expectedKind);
  assertValid('asset reference', errors);
  return value;
}

export function assertValidManifestReference(value, mediaType) {
  const errors = [];
  if (![V2_COURSE_MEDIA_TYPE, V2_GROUND_MEDIA_TYPE].includes(mediaType)) {
    throw new Error(`unsupported manifest media type ${mediaType}`);
  }
  validateManifestReference(
    value,
    'manifest',
    (at, message) => errors.push(`${at}: ${message}`),
    mediaType,
  );
  assertValid('manifest reference', errors);
  return value;
}
