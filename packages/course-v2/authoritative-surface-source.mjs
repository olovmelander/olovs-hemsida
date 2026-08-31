import { SURFACE } from '../../apps/golf/src/engine/surface.js';
import {
  CANONICAL_CRS,
  validateSourceCatalog,
  validateSourceManifest,
} from '../course-geo/manifest.mjs';

export const AUTHORITATIVE_SURFACE_SOURCE_KIND = 'banvy-authoritative-surface-source-v1';
export const AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS = Object.freeze([
  'exposure',
  'moisture',
  'mow-coordinate',
  'mow-direction',
  'vegetation-density',
  'wear',
]);

export const AUTHORITATIVE_SURFACE_CLASS_IDS = Object.freeze({
  rough: SURFACE.ROUGH,
  'semi-rough': SURFACE.SEMI,
  fairway: SURFACE.FAIRWAY,
  fringe: SURFACE.FRINGE,
  green: SURFACE.GREEN,
  tee: SURFACE.TEE,
  'bunker-sand': SURFACE.SAND,
  path: SURFACE.PATH,
  'forest-floor': SURFACE.FOREST,
  heath: SURFACE.HEATH,
  'shore-sand': SURFACE.SHORE,
  wetland: SURFACE.WETLAND,
  rock: SURFACE.ROCK,
  asphalt: SURFACE.ASPHALT,
  gravel: SURFACE.GRAVEL,
  dirt: SURFACE.DIRT,
  mud: SURFACE.MUD,
});

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPSILON = 1e-9;
const MAX_FEATURES = 10_000;
const MAX_POLYGONS_PER_FEATURE = 128;
const MAX_POINTS_PER_RING = 10_000;
const MAX_TOTAL_POINTS = 1_000_000;
const TIER_RANK = Object.freeze({ A: 0, B: 1, C: 2 });
const PROHIBITED_SOLE_AUTHORITY_PRODUCTS = new Set([
  'aws-terrarium',
  'club-course-guide',
  'esri-world-imagery',
  'golftraxx-layout',
  'openstreetmap',
]);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function shape(value, required, optional, at, fail) {
  if (!object(value)) {
    fail(at, 'must be an object');
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${at}.${key}`, 'unknown field');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${at}.${key}`, 'is required');
  }
  return true;
}

function validDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return Math.abs(cross(a, b, point)) <= EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) ||
    (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) ||
    (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) ||
    (Math.abs(cdB) <= EPSILON && onSegment(c, d, b));
}

function ringsIntersect(left, right) {
  for (let a = 0; a + 1 < left.length; a++) {
    for (let b = 0; b + 1 < right.length; b++) {
      if (segmentsIntersect(left[a], left[a + 1], right[b], right[b + 1])) return true;
    }
  }
  return false;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 2; index + 1 < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if (((a[1] > point[1]) !== (b[1] > point[1])) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  return pointInRing(point, polygon.outer) && !polygon.holes.some(hole => pointInRing(point, hole));
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index + 1 < ring.length; index++) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function validateRing(value, { at, outer, bounds, fail, pointBudget }) {
  if (!Array.isArray(value) || value.length < 4 || value.length > MAX_POINTS_PER_RING) {
    fail(at, `must contain 4 to ${MAX_POINTS_PER_RING} positions including closure`);
    return null;
  }
  pointBudget.count += value.length;
  if (pointBudget.count > MAX_TOTAL_POINTS) fail('surface.features', `exceeds ${MAX_TOTAL_POINTS} total positions`);
  const points = [];
  for (let index = 0; index < value.length; index++) {
    const position = value[index];
    const item = `${at}[${index}]`;
    if (!Array.isArray(position) || position.length !== 2 || position.some(number => !Number.isFinite(number))) {
      fail(item, 'must be an [easting, northing] pair');
      continue;
    }
    const [easting, northing] = position;
    if (easting < 100_000 || easting > 1_000_000 || northing < 6_000_000 || northing > 8_000_000) {
      fail(item, 'must be an absolute EPSG:3006 coordinate inside the Swedish working extent');
    }
    if (bounds && (easting < bounds.minEasting - EPSILON || easting > bounds.maxEasting + EPSILON ||
        northing < bounds.minNorthing - EPSILON || northing > bounds.maxNorthing + EPSILON)) {
      fail(item, 'lies outside the compiled terrain frontier');
    }
    points.push([easting, northing]);
  }
  if (points.length !== value.length) return null;
  if (!samePoint(points[0], points.at(-1))) fail(at, 'must be explicitly closed');
  const unique = new Set(points.slice(0, -1).map(point => `${point[0]},${point[1]}`));
  if (unique.size !== points.length - 1) fail(at, 'contains a repeated non-closure position');
  for (let index = 0; index + 1 < points.length; index++) {
    if (samePoint(points[index], points[index + 1])) fail(`${at}[${index}]`, 'creates a zero-length segment');
  }
  const area = signedArea(points);
  if (Math.abs(area) < 0.01) fail(at, 'must enclose at least 0.01 square metres');
  if (outer && area <= 0) fail(at, 'outer ring must be counter-clockwise');
  if (!outer && area >= 0) fail(at, 'hole ring must be clockwise');
  const segments = points.length - 1;
  for (let left = 0; left < segments; left++) {
    for (let right = left + 1; right < segments; right++) {
      if (right === left + 1 || (left === 0 && right === segments - 1)) continue;
      if (segmentsIntersect(points[left], points[left + 1], points[right], points[right + 1])) {
        fail(at, `self-intersects between segments ${left} and ${right}`);
        return points;
      }
    }
  }
  return points;
}

function validateGeometry(value, at, bounds, fail, pointBudget) {
  if (!shape(value, ['type', 'polygons'], [], at, fail)) return;
  if (value.type !== 'MultiPolygon') fail(`${at}.type`, 'must be MultiPolygon');
  if (!Array.isArray(value.polygons) || value.polygons.length < 1 ||
      value.polygons.length > MAX_POLYGONS_PER_FEATURE) {
    fail(`${at}.polygons`, `must contain 1 to ${MAX_POLYGONS_PER_FEATURE} polygons`);
    return;
  }
  const polygons = [];
  value.polygons.forEach((polygon, index) => {
    const polygonAt = `${at}.polygons[${index}]`;
    if (!shape(polygon, ['outer', 'holes'], [], polygonAt, fail)) return;
    const outer = validateRing(polygon.outer, {
      at: `${polygonAt}.outer`, outer: true, bounds, fail, pointBudget,
    });
    if (!Array.isArray(polygon.holes) || polygon.holes.length > 128) {
      fail(`${polygonAt}.holes`, 'must be an array with at most 128 rings');
      return;
    }
    const holes = polygon.holes.map((hole, holeIndex) => validateRing(hole, {
      at: `${polygonAt}.holes[${holeIndex}]`, outer: false, bounds, fail, pointBudget,
    })).filter(Boolean);
    if (outer) {
      for (let holeIndex = 0; holeIndex < holes.length; holeIndex++) {
        const hole = holes[holeIndex];
        if (!pointInRing(hole[0], outer) || ringsIntersect(outer, hole)) {
          fail(`${polygonAt}.holes[${holeIndex}]`, 'must lie strictly inside the outer ring');
        }
        for (let other = 0; other < holeIndex; other++) {
          if (ringsIntersect(hole, holes[other]) || pointInRing(hole[0], holes[other]) ||
              pointInRing(holes[other][0], hole)) {
            fail(`${polygonAt}.holes[${holeIndex}]`, `overlaps hole ${other}`);
          }
        }
      }
      polygons.push({ outer, holes });
    }
  });
  for (let left = 0; left < polygons.length; left++) {
    for (let right = left + 1; right < polygons.length; right++) {
      const a = polygons[left], b = polygons[right];
      if (ringsIntersect(a.outer, b.outer) || pointInPolygon(a.outer[0], b) || pointInPolygon(b.outer[0], a)) {
        fail(`${at}.polygons[${right}]`, `overlaps polygon ${left}`);
      }
    }
  }
}

function sameSortedStrings(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

export function validateAuthoritativeSurfaceSource(value, {
  manifest = null,
  catalog = null,
  expectedGroundId = null,
  expectedFrameFingerprint = null,
  terrainBounds = null,
} = {}) {
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  if (!shape(value, [
    'schemaVersion', 'kind', 'groundId', 'sourceId', 'sourceSha256', 'frame',
    'replaceMigration', 'unmeasuredFields', 'review', 'features',
  ], ['$schema'], 'surface', fail)) return errors;
  if (value.schemaVersion !== 1) fail('surface.schemaVersion', 'must be 1');
  if (value.kind !== AUTHORITATIVE_SURFACE_SOURCE_KIND) {
    fail('surface.kind', `must be ${AUTHORITATIVE_SURFACE_SOURCE_KIND}`);
  }
  if (!ID.test(value.groundId || '')) fail('surface.groundId', 'must be a lowercase kebab-case id');
  if (expectedGroundId !== null && value.groundId !== expectedGroundId) {
    fail('surface.groundId', `must be ${expectedGroundId}`);
  }
  if (!ID.test(value.sourceId || '')) fail('surface.sourceId', 'must be a lowercase kebab-case id');
  if (!SHA256.test(value.sourceSha256 || '')) fail('surface.sourceSha256', 'must be a lowercase SHA-256');
  if (value.replaceMigration !== true) fail('surface.replaceMigration', 'must be true');
  if (!sameSortedStrings(value.unmeasuredFields, AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS)) {
    fail('surface.unmeasuredFields', `must exactly equal ${AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS.join(', ')}`);
  }

  if (shape(value.frame, [
    'compoundCrs', 'horizontalCrs', 'verticalCrs', 'fingerprint',
  ], [], 'surface.frame', fail)) {
    if (value.frame.compoundCrs !== CANONICAL_CRS.compound) fail('surface.frame.compoundCrs', `must be ${CANONICAL_CRS.compound}`);
    if (value.frame.horizontalCrs !== CANONICAL_CRS.horizontal) fail('surface.frame.horizontalCrs', `must be ${CANONICAL_CRS.horizontal}`);
    if (value.frame.verticalCrs !== CANONICAL_CRS.vertical) fail('surface.frame.verticalCrs', `must be ${CANONICAL_CRS.vertical}`);
    if (!SHA256.test(value.frame.fingerprint || '')) fail('surface.frame.fingerprint', 'must be a lowercase SHA-256');
    if (expectedFrameFingerprint !== null && value.frame.fingerprint !== expectedFrameFingerprint) {
      fail('surface.frame.fingerprint', 'does not match the terrain frame');
    }
  }

  if (shape(value.review, [
    'status', 'reviewedAt', 'reviewerId', 'notes',
  ], [], 'surface.review', fail)) {
    if (value.review.status !== 'approved') fail('surface.review.status', 'must be approved');
    if (!validDate(value.review.reviewedAt)) fail('surface.review.reviewedAt', 'must be a real YYYY-MM-DD date');
    if (!ID.test(value.review.reviewerId || '')) fail('surface.review.reviewerId', 'must be a lowercase kebab-case id');
    if (typeof value.review.notes !== 'string' || !value.review.notes.trim()) fail('surface.review.notes', 'must describe the review');
  }

  let manifestValid = false;
  let catalogValid = false;
  if (!catalog) fail('catalog', 'is required');
  else {
    const catalogErrors = validateSourceCatalog(catalog);
    catalogErrors.forEach(error => fail('catalog', error));
    catalogValid = catalogErrors.length === 0;
  }
  if (!manifest) fail('manifest', 'is required');
  else if (catalogValid) {
    const manifestErrors = validateSourceManifest(manifest, { catalog, label: 'manifest' });
    manifestErrors.forEach(error => errors.push(error));
    manifestValid = manifestErrors.length === 0;
  }

  let source = null;
  let product = null;
  if (manifestValid) {
    if (manifest.groundId !== value.groundId) fail('manifest.groundId', 'must match the surface ground');
    if (manifest.canonicalFrame.originStatus !== 'approved') {
      fail('manifest.canonicalFrame.originStatus', 'must be approved before authoritative surface compilation');
    }
    source = manifest.sources.find(candidate => candidate.id === value.sourceId) || null;
    if (!source) fail('surface.sourceId', 'does not resolve in the ground source manifest');
  }
  if (source) {
    product = catalog.products.find(candidate => candidate.id === source.productId) || null;
    if (!source.roles.includes('surface')) fail('manifest.source.roles', 'must include surface');
    if (source.lifecycle !== 'approved') fail('manifest.source.lifecycle', 'must be approved');
    if (source.use !== 'authoritative') fail('manifest.source.use', 'must be authoritative');
    if (!['A', 'B', 'C'].includes(source.accuracyTier)) fail('manifest.source.accuracyTier', 'must be A, B or C');
    if (!Number.isFinite(source.horizontalAccuracyMetres)) {
      fail('manifest.source.horizontalAccuracyMetres', 'must be measured');
    }
    if (!validDate(source.acquiredAt)) fail('manifest.source.acquiredAt', 'must be a real acquisition date');
    if (!validDate(source.capturedAt)) fail('manifest.source.capturedAt', 'must be a real capture date');
    if (source.checksum !== value.sourceSha256) fail('surface.sourceSha256', 'must match the approved manifest source');
    if (PROHIBITED_SOLE_AUTHORITY_PRODUCTS.has(source.productId)) {
      fail('manifest.source.productId', 'may not be the sole authority for golf-surface boundaries');
    }
    if (product?.licence.reviewStatus !== 'approved') fail('catalog.product.licence.reviewStatus', 'must be approved');
    if (validDate(value.review?.reviewedAt) && validDate(source.capturedAt) && value.review.reviewedAt < source.capturedAt) {
      fail('surface.review.reviewedAt', 'must not predate source capture');
    }
  }

  if (!Array.isArray(value.features) || value.features.length < 1 || value.features.length > MAX_FEATURES) {
    fail('surface.features', `must contain 1 to ${MAX_FEATURES} reviewed features`);
    return errors;
  }
  const featureIds = new Set();
  const ownerIds = new Set();
  const pointBudget = { count: 0 };
  let previousId = null;
  value.features.forEach((feature, index) => {
    const at = `surface.features[${index}]`;
    if (!shape(feature, [
      'id', 'surfaceClass', 'ownerFeatureId', 'holeNumber', 'accuracyTier',
      'horizontalAccuracyMetres', 'reviewStatus', 'geometry',
    ], [], at, fail)) return;
    if (!ID.test(feature.id || '')) fail(`${at}.id`, 'must be a lowercase kebab-case id');
    else {
      if (featureIds.has(feature.id)) fail(`${at}.id`, 'is duplicated');
      featureIds.add(feature.id);
      if (previousId !== null && previousId >= feature.id) fail('surface.features', 'must be sorted by id');
      previousId = feature.id;
    }
    if (!Object.hasOwn(AUTHORITATIVE_SURFACE_CLASS_IDS, feature.surfaceClass)) {
      fail(`${at}.surfaceClass`, 'is not in the reviewed surface registry');
    }
    if (!Number.isSafeInteger(feature.ownerFeatureId) || feature.ownerFeatureId < 1 || feature.ownerFeatureId > 65535) {
      fail(`${at}.ownerFeatureId`, 'must be an integer from 1 to 65535');
    } else if (ownerIds.has(feature.ownerFeatureId)) fail(`${at}.ownerFeatureId`, 'is duplicated');
    else ownerIds.add(feature.ownerFeatureId);
    if (feature.holeNumber !== null && (!Number.isSafeInteger(feature.holeNumber) ||
        feature.holeNumber < 1 || feature.holeNumber > 255)) {
      fail(`${at}.holeNumber`, 'must be null or an integer from 1 to 255');
    }
    if (!Object.hasOwn(TIER_RANK, feature.accuracyTier)) fail(`${at}.accuracyTier`, 'must be A, B or C');
    if (!Number.isFinite(feature.horizontalAccuracyMetres) || feature.horizontalAccuracyMetres < 0) {
      fail(`${at}.horizontalAccuracyMetres`, 'must be a non-negative measured value');
    }
    if (source && Object.hasOwn(TIER_RANK, feature.accuracyTier) && Object.hasOwn(TIER_RANK, source.accuracyTier) &&
        TIER_RANK[feature.accuracyTier] < TIER_RANK[source.accuracyTier]) {
      fail(`${at}.accuracyTier`, 'may not claim a better tier than its source');
    }
    if (source && Number.isFinite(feature.horizontalAccuracyMetres) &&
        feature.horizontalAccuracyMetres + EPSILON < source.horizontalAccuracyMetres) {
      fail(`${at}.horizontalAccuracyMetres`, 'may not claim better accuracy than its source');
    }
    if (feature.reviewStatus !== 'approved') fail(`${at}.reviewStatus`, 'must be approved');
    validateGeometry(feature.geometry, `${at}.geometry`, terrainBounds, fail, pointBudget);
  });
  return errors;
}

export function assertAuthoritativeSurfaceSource(value, options = {}) {
  const errors = validateAuthoritativeSurfaceSource(value, options);
  if (errors.length) throw new Error(`invalid authoritative surface source:\n${errors.join('\n')}`);
  return value;
}

export function prepareAuthoritativeSurfaceFeatures(value, {
  frame,
  manifest,
  catalog,
  expectedGroundId = value?.groundId,
  terrainBounds = null,
} = {}) {
  assertAuthoritativeSurfaceSource(value, {
    manifest,
    catalog,
    expectedGroundId,
    expectedFrameFingerprint: frame?.fingerprint,
    terrainBounds,
  });
  if (!frame?.origin || !Number.isFinite(frame.origin.easting) || !Number.isFinite(frame.origin.northing)) {
    throw new TypeError('an approved canonical terrain frame origin is required');
  }
  const approvedOrigin = manifest.canonicalFrame.origin;
  if (frame.origin.easting !== approvedOrigin.easting || frame.origin.northing !== approvedOrigin.northing ||
      frame.origin.heightRH2000 !== approvedOrigin.heightRH2000) {
    throw new Error('terrain frame origin does not match the approved source manifest origin');
  }
  const worldRing = ring => ring.slice(0, -1).map(([easting, northing]) => Object.freeze([
    easting - frame.origin.easting,
    frame.origin.northing - northing,
  ]));
  const features = value.features.map(feature => Object.freeze({
    surface: AUTHORITATIVE_SURFACE_CLASS_IDS[feature.surfaceClass],
    polygons: Object.freeze(feature.geometry.polygons.map(polygon => Object.freeze({
      rings: Object.freeze([polygon.outer, ...polygon.holes].map(worldRing)),
    }))),
    hole: feature.ownerFeatureId,
    sourceFeatureId: feature.id,
    holeNumber: feature.holeNumber,
  }));
  return Object.freeze({
    groundId: value.groundId,
    sourceId: value.sourceId,
    sourceSha256: value.sourceSha256,
    reviewedAt: value.review.reviewedAt,
    unmeasuredFields: AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS,
    features: Object.freeze(features),
  });
}
