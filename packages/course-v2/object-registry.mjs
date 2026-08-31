export const OBJECT_REGISTRY_CLASSES = Object.freeze([
  'boulder',
  'building-detail',
  'bush',
  'course-furniture',
  'drainage',
  'fence',
  'light',
  'sign',
  'tree',
]);

export const OBJECT_PLACEMENT_METHODS = Object.freeze([
  'derived-lidar',
  'digitized',
  'source-constrained-procedural',
  'survey',
]);

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TILE_ID = /^[a-z0-9]+(?:[a-z0-9._/-]*[a-z0-9])?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z)?$/;
const ACCURACY_TIERS = new Set(['A', 'B', 'C', 'D', 'E', 'unrated']);
const CLASSES = new Set(OBJECT_REGISTRY_CLASSES);
const PLACEMENT_METHODS = new Set(OBJECT_PLACEMENT_METHODS);
const TRUTH_ZONES = new Set(['A', 'B', 'C']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, at, fail) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(`${at}.${key}`, 'unknown field');
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail(`${at}.${key}`, 'is required');
  }
}

function finite(value, at, fail, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(at, `must be a finite number from ${minimum} to ${maximum}`);
  }
}

function validDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) && date.getUTCSeconds() === Number(second);
}

export function validateObjectRegistry(value, header = null) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  if (!object(value)) return ['objects: must be an object'];
  exactKeys(value, new Set(['schemaVersion', 'groundId', 'tileId', 'records']), 'objects', fail);
  if (value.schemaVersion !== 1) fail('objects.schemaVersion', 'must be 1');
  if (!ID.test(value.groundId || '')) fail('objects.groundId', 'must be a lowercase kebab-case id');
  if (!TILE_ID.test(value.tileId || '') || value.tileId?.includes('..') || value.tileId?.includes('//')) {
    fail('objects.tileId', 'must be a safe relative tile id');
  }
  if (!Array.isArray(value.records)) {
    fail('objects.records', 'must be an array');
    return errors;
  }
  let previousId = null;
  const fields = new Set([
    'id', 'groundId', 'class', 'subtype', 'easting', 'northing', 'heightRH2000',
    'objectHeightMetres', 'radiusMetres', 'headingDegrees', 'sourceId', 'capturedAt',
    'accuracyTier', 'horizontalAccuracyMetres', 'verticalAccuracyMetres', 'confidence',
    'reviewStatus', 'truthZone', 'placementMethod',
  ]);
  value.records.forEach((record, index) => {
    const at = `objects.records[${index}]`;
    if (!object(record)) { fail(at, 'must be an object'); return; }
    exactKeys(record, fields, at, fail);
    if (!ID.test(record.id || '')) fail(`${at}.id`, 'must be a lowercase kebab-case id');
    if (previousId !== null && previousId >= record.id) {
      fail('objects.records', 'must be sorted by id and contain no duplicates');
    }
    previousId = record.id;
    if (record.groundId !== value.groundId) fail(`${at}.groundId`, 'must match the registry groundId');
    if (!CLASSES.has(record.class)) fail(`${at}.class`, 'has an unsupported object class');
    if (record.subtype !== null && (typeof record.subtype !== 'string' || !ID.test(record.subtype))) {
      fail(`${at}.subtype`, 'must be null or a lowercase kebab-case id');
    }
    finite(record.easting, `${at}.easting`, fail);
    finite(record.northing, `${at}.northing`, fail);
    finite(record.heightRH2000, `${at}.heightRH2000`, fail);
    finite(record.objectHeightMetres, `${at}.objectHeightMetres`, fail, 0.05, 100);
    finite(record.radiusMetres, `${at}.radiusMetres`, fail, 0.01, 100);
    finite(record.headingDegrees, `${at}.headingDegrees`, fail, 0, 360);
    if (!ID.test(record.sourceId || '')) fail(`${at}.sourceId`, 'must be a lowercase kebab-case id');
    if (!validDate(record.capturedAt)) fail(`${at}.capturedAt`, 'must be an ISO 8601 UTC date or date-time');
    if (!ACCURACY_TIERS.has(record.accuracyTier)) fail(`${at}.accuracyTier`, 'has an invalid accuracy tier');
    finite(record.horizontalAccuracyMetres, `${at}.horizontalAccuracyMetres`, fail, 0, 1000);
    finite(record.verticalAccuracyMetres, `${at}.verticalAccuracyMetres`, fail, 0, 1000);
    finite(record.confidence, `${at}.confidence`, fail, 0, 1);
    if (record.reviewStatus !== 'approved') fail(`${at}.reviewStatus`, 'published runtime objects must be approved');
    if (!TRUTH_ZONES.has(record.truthZone)) fail(`${at}.truthZone`, 'must be A, B or C');
    if (!PLACEMENT_METHODS.has(record.placementMethod)) fail(`${at}.placementMethod`, 'is unsupported');
    if (record.truthZone === 'A') {
      if (!new Set(['A', 'B', 'C']).has(record.accuracyTier)) {
        fail(`${at}.accuracyTier`, 'zone A objects must use accuracy tier A, B or C');
      }
      if (record.placementMethod === 'source-constrained-procedural') {
        fail(`${at}.placementMethod`, 'zone A objects may not be procedurally placed');
      }
    }
    if (header?.bounds) {
      const { bounds } = header;
      if (Number.isFinite(record.easting) &&
          (record.easting < bounds.minEasting || record.easting > bounds.maxEasting)) {
        fail(`${at}.easting`, 'lies outside the declared chunk bounds');
      }
      if (Number.isFinite(record.northing) &&
          (record.northing < bounds.minNorthing || record.northing > bounds.maxNorthing)) {
        fail(`${at}.northing`, 'lies outside the declared chunk bounds');
      }
      if (Number.isFinite(record.heightRH2000) &&
          (record.heightRH2000 < bounds.minHeightRH2000 || record.heightRH2000 > bounds.maxHeightRH2000)) {
        fail(`${at}.heightRH2000`, 'lies outside the declared chunk bounds');
      }
    }
  });
  if (header) {
    if (header.kind !== 'objects') fail('objects', 'header kind must be objects');
    if (header.owner?.type !== 'ground' || header.owner?.id !== value.groundId) {
      fail('objects.groundId', 'must match the ground owner in the chunk header');
    }
    if (header.id !== value.tileId) fail('objects.tileId', 'must match the chunk header id');
    if (header.records?.content !== 'object-registry') {
      fail('objects', 'chunk records content must be object-registry');
    }
    if (header.records?.count !== value.records.length) {
      fail('objects.records', 'count must match the chunk header');
    }
  }
  return errors;
}

export function inspectObjectRegistryPayload(value, header) {
  const errors = validateObjectRegistry(value, header);
  if (errors.length) throw new Error(`invalid object registry:\n${errors.join('\n')}`);
  const byClass = {};
  const byTruthZone = { A: 0, B: 0, C: 0 };
  for (const record of value.records) {
    byClass[record.class] = (byClass[record.class] || 0) + 1;
    byTruthZone[record.truthZone]++;
  }
  return {
    recordCount: value.records.length,
    byClass: Object.fromEntries(Object.entries(byClass).sort(([left], [right]) => left.localeCompare(right))),
    byTruthZone,
  };
}
