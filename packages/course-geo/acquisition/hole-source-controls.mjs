import { EXPECTED_GROUNDS } from '../manifest.mjs';
import { rectangleUnionArea } from './stac.mjs';

export const HOLE_SOURCE_CONTROL_VERSION = 1;
export const DEFAULT_HOLE_PADDING_METRES = 48;
export const DEFAULT_CONTROL_SPAN_METRES = 256;

export const COURSE_MODEL_PATHS = Object.freeze({
  angso: 'geo_data/course-v2/angso/migration/course-model.epsg3006.json',
  norrfallsviken: 'geo_data/course-v2/norrfallsviken/migration/course-model.epsg3006.json',
  puttom: 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json',
  ribbingsfors: 'geo_data/course-v2/ribbingsfors/migration/course-model.epsg3006.json',
  upsala: 'geo_data/course-v2/upsala/migration/course-model.epsg3006.json',
  'upsala-mellanbanan': 'geo_data/course-v2/upsala/migration/mellanbanan-model.epsg3006.json',
  johannesberg: 'geo_data/course-v2/johannesberg/migration/course-model.epsg3006.json',
  'johannesberg-9': 'geo_data/course-v2/johannesberg/migration/nine-course-model.epsg3006.json',
  veckefjarden: 'geo_data/course-v2/veckefjarden/migration/course-model.epsg3006.json',
  'veckefjarden-korthalsbanan': 'geo_data/course-v2/veckefjarden/migration/short-course-model.epsg3006.json',
});

// Keep the immutable migration candidates fail-closed even when CI has to
// reconstruct a model from an already committed legacy course model.
export const COURSE_MODEL_SHA256 = Object.freeze({
  angso: '8f61356dc5117135278310b01ec7766df384b2b49804a44d278d2b32e1812669',
  norrfallsviken: '185f0417db1e4d02f7a884abba327790e1696cc291e794eb908269f73733589a',
  puttom: '518beceead88a48ebce53e66282031aed85b57d4e7e4b8058b39f7d8f17d38cf',
  ribbingsfors: '985f89615224b39e64aea1b86a2b5274f99ca4edaef6b92cdbb47559952cecaf',
  upsala: 'd0f6f895614c2472505587dd6796d33ec860058264da4286dafec79bd1e43d56',
  'upsala-mellanbanan': '3ccc7f203c1f96f63c270f53e8604da18d2825a7913e071573abb275c92d1864',
  johannesberg: '11a23400ba7a47cf8f99a7015f0639e3ab3b7cb803e057ce8ed2fbbf847253b5',
  'johannesberg-9': 'd5c43e278cd9784ad22e2081d9860da8c3b3ad924c57f65069a56421135a6342',
  veckefjarden: 'f98de4a0aa0c06276d46520d189c428c92efa8cee33fc6893bad2cec492de436',
  'veckefjarden-korthalsbanan': '4a6554023dfbe113d72a9bb5d6ada4d3e2fa81a16e6e5b1a8d89078f30f697a2',
});

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const round = value => Math.round(value * 1000) / 1000;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value, label) {
  if (!ID.test(value || '')) throw new Error(`${label} must be kebab-case`);
  return value;
}

function safeSourceId(value, label) {
  if (!SOURCE_ID.test(value || '')) throw new Error(`${label} has unsafe characters`);
  return value;
}

function finiteBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item)) ||
      value[0] >= value[2] || value[1] >= value[3]) {
    throw new Error(`${label} must be a finite non-empty [minX,minY,maxX,maxY] bbox`);
  }
  return value;
}

function intersection(left, right) {
  const overlap = [
    Math.max(left[0], right[0]), Math.max(left[1], right[1]),
    Math.min(left[2], right[2]), Math.min(left[3], right[3]),
  ];
  return overlap[0] < overlap[2] && overlap[1] < overlap[3] ? overlap : null;
}

function addPair(points, value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required`);
    return;
  }
  if (!Array.isArray(value) || value.length !== 2 || value.some(item => !Number.isFinite(item))) {
    throw new Error(`${label} must be a finite EPSG:3006 coordinate pair`);
  }
  points.push(value);
}

function addNestedPairs(points, value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required`);
    return;
  }
  if (!Array.isArray(value)) throw new Error(`${label} must contain coordinate pairs`);
  if (value.length === 2 && value.every(Number.isFinite)) {
    addPair(points, value, label, { required: true });
    return;
  }
  if (!value.length && required) throw new Error(`${label} must not be empty`);
  value.forEach((item, index) => addNestedPairs(points, item, `${label}[${index}]`, { required: true }));
}

function holePlayingPoints(hole, label) {
  if (!object(hole) || !Number.isSafeInteger(hole.n) || hole.n < 1) {
    throw new Error(`${label} must have a positive integer hole number`);
  }
  const points = [];
  addNestedPairs(points, hole.line, `${label}.line`, { required: true });
  if (hole.line.length < 2) throw new Error(`${label}.line must contain at least two coordinates`);
  addPair(points, hole.pin, `${label}.pin`);
  addPair(points, hole.green?.c, `${label}.green.c`);
  addNestedPairs(points, hole.green?.ring, `${label}.green.ring`);
  addNestedPairs(points, hole.fairway?.rings, `${label}.fairway.rings`);
  for (const [index, pad] of (hole.tees?.pads || []).entries()) {
    addPair(points, pad?.c, `${label}.tees.pads[${index}].c`);
    addNestedPairs(points, pad?.ring, `${label}.tees.pads[${index}].ring`);
  }
  for (const [index, mark] of (hole.tees?.marks || []).entries()) {
    addPair(points, mark?.c, `${label}.tees.marks[${index}].c`);
  }
  for (const [index, bunker] of (hole.bunkers || []).entries()) {
    addPair(points, bunker?.c, `${label}.bunkers[${index}].c`);
    addNestedPairs(points, bunker?.ring, `${label}.bunkers[${index}].ring`);
  }
  if (points.length < 2) throw new Error(`${label} has insufficient playing geometry`);
  return points;
}

function expandedExtent(points, paddingMetres) {
  const extent = points.reduce((bbox, [x, y]) => [
    Math.min(bbox[0], x), Math.min(bbox[1], y),
    Math.max(bbox[2], x), Math.max(bbox[3], y),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  return Object.freeze([
    round(extent[0] - paddingMetres), round(extent[1] - paddingMetres),
    round(extent[2] + paddingMetres), round(extent[3] + paddingMetres),
  ]);
}

function windowId(spanMetres, minX, minY) {
  const axis = value => value < 0 ? `m${Math.abs(value)}` : String(value);
  return `w${spanMetres}-${axis(minX)}-${axis(minY)}`;
}

export function alignedControlWindows(bbox, {
  spanMetres = DEFAULT_CONTROL_SPAN_METRES,
} = {}) {
  finiteBbox(bbox, 'hole control extent');
  if (!Number.isSafeInteger(spanMetres) || spanMetres < 64 || spanMetres > 1024 ||
      (spanMetres & (spanMetres - 1)) !== 0) {
    throw new Error('control span must be a power-of-two integer from 64 to 1024 metres');
  }
  const firstX = Math.floor(bbox[0] / spanMetres) * spanMetres;
  const firstY = Math.floor(bbox[1] / spanMetres) * spanMetres;
  const lastX = Math.floor((bbox[2] - Number.EPSILON) / spanMetres) * spanMetres;
  const lastY = Math.floor((bbox[3] - Number.EPSILON) / spanMetres) * spanMetres;
  const windows = [];
  for (let y = firstY; y <= lastY; y += spanMetres) {
    for (let x = firstX; x <= lastX; x += spanMetres) {
      windows.push(Object.freeze({
        id: windowId(spanMetres, x, y),
        bboxEpsg3006: Object.freeze([x, y, x + spanMetres, y + spanMetres]),
        spanMetres,
        areaSquareMetres: spanMetres * spanMetres,
      }));
    }
  }
  if (!windows.length || windows.length > 64) {
    throw new Error(`hole control extent produced unsafe window count ${windows.length}`);
  }
  return Object.freeze(windows);
}

function laserControl(window, discovery) {
  if (!discovery) return Object.freeze({
    state: 'discovery-pending',
    catalogCoverageRatio: 0,
    candidates: Object.freeze([]),
    requiresLocalDensityCheck: true,
    eligibleForDerivedAssets: false,
  });
  if (discovery.laser?.collection !== 'dsm-skoglig-copc' || !Array.isArray(discovery.laser.items)) {
    throw new Error(`${discovery.groundId || '<unknown>'} discovery lacks dsm-skoglig-copc items`);
  }
  const overlaps = [];
  const candidates = [];
  for (const item of discovery.laser.items) {
    const projected = finiteBbox(item.projBbox || item.assets?.data?.projBbox,
      `laser item ${item.id || '<unknown>'} projBbox`);
    const overlap = intersection(window.bboxEpsg3006, projected);
    if (!overlap) continue;
    overlaps.push(overlap);
    const density = Number(item.pointDensityPerSquareMetre);
    candidates.push(Object.freeze({
      itemId: safeSourceId(item.id, 'laser item id'),
      capturedAt: item.capturedAt || item.captureEnd || null,
      overlapBboxEpsg3006: Object.freeze(overlap.map(round)),
      overlapRatio: rectangleUnionArea([overlap]) / window.areaSquareMetres,
      advertisedPointDensityPerSquareMetre: Number.isFinite(density) && density > 0 ? density : null,
      metadataReady: Number.isFinite(density) && density > 0,
    }));
  }
  candidates.sort((left, right) =>
    String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')) ||
    left.itemId.localeCompare(right.itemId));
  const coverageRatio = Math.min(1, rectangleUnionArea(overlaps) / window.areaSquareMetres);
  let state = 'density-check-required';
  if (!candidates.length) state = 'no-catalog-coverage';
  else if (coverageRatio < 1 - 1e-9) state = 'partial-catalog-coverage';
  else if (candidates.some(candidate => !candidate.metadataReady)) state = 'metadata-incomplete';
  return Object.freeze({
    state,
    catalogCoverageRatio: coverageRatio,
    candidates: Object.freeze(candidates),
    requiresLocalDensityCheck: true,
    eligibleForDerivedAssets: false,
  });
}

function treeHeightControl(window) {
  return Object.freeze({
    state: 'authenticated-check-required',
    request: Object.freeze({
      bboxEpsg3006: window.bboxEpsg3006,
      horizontalCrs: 'EPSG:3006',
      width: window.spanMetres,
      height: window.spanMetres,
      resolutionMetres: 1,
      pixelType: 'S16',
      nodata: 0,
      interpolation: 'nearest',
    }),
    eligibleForDerivedAssets: false,
  });
}

export function courseHoleControlPlan({
  groundId,
  courseSlug,
  model,
  modelPath = null,
  modelSha256 = null,
  paddingMetres = DEFAULT_HOLE_PADDING_METRES,
  spanMetres = DEFAULT_CONTROL_SPAN_METRES,
}) {
  safeId(groundId, 'ground id');
  safeId(courseSlug, 'course slug');
  if (!EXPECTED_GROUNDS[groundId]?.includes(courseSlug)) {
    throw new Error(`${courseSlug} is not registered on physical ground ${groundId}`);
  }
  if (!object(model) || model.groundId !== groundId || model.target?.horizontalCrs !== 'EPSG:3006' ||
      model.target?.coordinateOrder?.join(',') !== 'easting,northing' ||
      !Array.isArray(model.geometry?.holes) || !model.geometry.holes.length) {
    throw new Error(`${courseSlug} requires a migrated EPSG:3006 hole model`);
  }
  if (!Number.isSafeInteger(paddingMetres) || paddingMetres < 16 || paddingMetres > 128) {
    throw new Error('hole padding must be an integer from 16 to 128 metres');
  }
  const seenHoles = new Set();
  const holes = model.geometry.holes.map((hole, index) => {
    const label = `${courseSlug}.holes[${index}]`;
    const points = holePlayingPoints(hole, label);
    if (seenHoles.has(hole.n)) throw new Error(`${courseSlug} has duplicate hole ${hole.n}`);
    seenHoles.add(hole.n);
    const bboxEpsg3006 = expandedExtent(points, paddingMetres);
    const windows = alignedControlWindows(bboxEpsg3006, { spanMetres });
    return Object.freeze({
      holeNumber: hole.n,
      geometryState: model.target.approvalStatus,
      bboxEpsg3006,
      controlWindowIds: Object.freeze(windows.map(window => window.id)),
      windows,
    });
  });
  return Object.freeze({
    courseSlug,
    groundId,
    model: Object.freeze({
      path: modelPath,
      sha256: modelSha256,
      approvalStatus: model.target.approvalStatus,
    }),
    holeCount: holes.length,
    holes: Object.freeze(holes),
  });
}

function countStates(windows, field) {
  const counts = {};
  for (const window of windows) {
    const state = window[field].state;
    counts[state] = (counts[state] || 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort()));
}

export function groundHoleSourceControlPlan({ manifest, courseModels, discovery = null }) {
  if (!object(manifest) || !EXPECTED_GROUNDS[manifest.groundId] ||
      JSON.stringify(manifest.courseSlugs) !== JSON.stringify(EXPECTED_GROUNDS[manifest.groundId])) {
    throw new Error('ground manifest does not match the exact physical-ground/course inventory');
  }
  if (discovery && discovery.groundId !== manifest.groundId) {
    throw new Error(`discovery ground ${discovery.groundId} does not match ${manifest.groundId}`);
  }
  const courses = manifest.courseSlugs.map(courseSlug => {
    const entry = courseModels[courseSlug];
    if (!entry?.model) throw new Error(`missing EPSG:3006 model for ${courseSlug}`);
    return courseHoleControlPlan({
      groundId: manifest.groundId,
      courseSlug,
      model: entry.model,
      modelPath: entry.path,
      modelSha256: entry.sha256,
    });
  });
  const shared = new Map();
  for (const course of courses) {
    for (const hole of course.holes) {
      for (const window of hole.windows) {
        const current = shared.get(window.id) || { ...window, consumers: [] };
        current.consumers.push(Object.freeze({
          courseSlug: course.courseSlug,
          holeNumber: hole.holeNumber,
        }));
        shared.set(window.id, current);
      }
    }
  }
  const windows = [...shared.values()].sort((left, right) => left.id.localeCompare(right.id)).map(window =>
    Object.freeze({
      id: window.id,
      bboxEpsg3006: window.bboxEpsg3006,
      spanMetres: window.spanMetres,
      areaSquareMetres: window.areaSquareMetres,
      consumers: Object.freeze(window.consumers.sort((left, right) =>
        left.courseSlug.localeCompare(right.courseSlug) || left.holeNumber - right.holeNumber)),
      laser: laserControl(window, discovery),
      treeHeight: treeHeightControl(window),
      fallback: Object.freeze(['markhojdmodell-1m', 'tree-height-1m', 'orthophoto-review']),
    }));
  return Object.freeze({
    schemaVersion: HOLE_SOURCE_CONTROL_VERSION,
    phase: 'D2-per-hole-source-control-plan',
    groundId: manifest.groundId,
    courseSlugs: Object.freeze([...manifest.courseSlugs]),
    discoveryState: discovery ? 'checksummed-snapshot-available' : 'discovery-pending',
    courses: Object.freeze(courses.map(course => Object.freeze({
      ...course,
      holes: Object.freeze(course.holes.map(hole => Object.freeze({
        holeNumber: hole.holeNumber,
        geometryState: hole.geometryState,
        bboxEpsg3006: hole.bboxEpsg3006,
        controlWindowIds: hole.controlWindowIds,
      }))),
    }))),
    windows: Object.freeze(windows),
    summary: Object.freeze({
      courseCount: courses.length,
      holeCount: courses.reduce((total, course) => total + course.holeCount, 0),
      uniqueWindowCount: windows.length,
      requestedWindowReferences: courses.reduce((total, course) => total +
        course.holes.reduce((subtotal, hole) => subtotal + hole.controlWindowIds.length, 0), 0),
      laserStates: countStates(windows, 'laser'),
      treeHeightStates: countStates(windows, 'treeHeight'),
    }),
  });
}

export function allCourseHoleSourceControlPlan(grounds) {
  if (!Array.isArray(grounds) || grounds.length !== Object.keys(EXPECTED_GROUNDS).length) {
    throw new Error(`all-course control plan requires all ${Object.keys(EXPECTED_GROUNDS).length} physical grounds`);
  }
  const byId = new Map(grounds.map(ground => [ground.groundId, ground]));
  if (byId.size !== grounds.length || Object.keys(EXPECTED_GROUNDS).some(id => !byId.has(id))) {
    throw new Error('all-course control plan has a missing or duplicate physical ground');
  }
  const ordered = Object.keys(EXPECTED_GROUNDS).sort().map(id => byId.get(id));
  const courseSlugs = ordered.flatMap(ground => ground.courseSlugs);
  if (new Set(courseSlugs).size !== Object.values(EXPECTED_GROUNDS).flat().length) {
    throw new Error(`all-course control plan does not cover ${Object.values(EXPECTED_GROUNDS).flat().length} unique course slugs`);
  }
  return Object.freeze({
    schemaVersion: HOLE_SOURCE_CONTROL_VERSION,
    phase: 'D2-all-course-per-hole-source-control-plan',
    state: 'planning-and-quality-gates-only-production-disabled',
    grounds: Object.freeze(ordered),
    summary: Object.freeze({
      groundCount: ordered.length,
      courseCount: courseSlugs.length,
      holeCount: ordered.reduce((total, ground) => total + ground.summary.holeCount, 0),
      uniqueGroundWindowCount: ordered.reduce((total, ground) => total + ground.summary.uniqueWindowCount, 0),
      requestedWindowReferences: ordered.reduce((total, ground) =>
        total + ground.summary.requestedWindowReferences, 0),
      groundsWithDiscovery: ordered.filter(ground =>
        ground.discoveryState === 'checksummed-snapshot-available').length,
      productionEnabled: false,
    }),
  });
}

export function treeHeightQualityAssessment(window, evidence) {
  if (!object(window?.treeHeight?.request)) throw new Error('tree-height control window is required');
  if (!object(evidence)) throw new Error('tree-height evidence must be an object');
  const expected = window.treeHeight.request;
  const reasons = [];
  const expectedTransform = [
    expected.bboxEpsg3006[0], expected.resolutionMetres, 0,
    expected.bboxEpsg3006[3], 0, -expected.resolutionMetres,
  ];
  const equalNumbers = (left, right) => Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => Number.isFinite(value) && Math.abs(value - right[index]) <= 1e-6);
  if (evidence.width !== expected.width || evidence.height !== expected.height) {
    reasons.push('unexpected-raster-size');
  }
  if (evidence.horizontalCrs !== expected.horizontalCrs) reasons.push('unexpected-horizontal-crs');
  if (evidence.type !== expected.pixelType) reasons.push('unexpected-pixel-type');
  if (evidence.resolutionMetres !== expected.resolutionMetres) reasons.push('unexpected-resolution');
  if (evidence.nodata !== expected.nodata) reasons.push('unexpected-nodata');
  if (!equalNumbers(evidence.bboxEpsg3006, expected.bboxEpsg3006)) reasons.push('unexpected-bbox');
  if (!equalNumbers(evidence.geoTransform, expectedTransform)) reasons.push('unexpected-geotransform');
  const minimum = Number(evidence.minimumDecimetres);
  const maximum = Number(evidence.maximumDecimetres);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) {
    reasons.push('invalid-height-range');
  } else if (maximum > 800) {
    reasons.push('implausible-tree-height');
  }
  return Object.freeze({
    usable: reasons.length === 0,
    reasons: Object.freeze(reasons),
    minimumMetres: Number.isFinite(minimum) ? minimum / 10 : null,
    maximumMetres: Number.isFinite(maximum) ? maximum / 10 : null,
    note: 'Zero decimetres may mean open ground and is not treated as missing canopy by itself.',
  });
}

export function sourceControlDisposition({ laserAssessments = [], treeHeightAssessment = null } = {}) {
  if (!Array.isArray(laserAssessments)) throw new Error('laserAssessments must be an array');
  const laserUsable = laserAssessments.some(assessment => assessment?.usable === true);
  const treeHeightUsable = treeHeightAssessment?.usable === true;
  return Object.freeze({
    laserUsable,
    treeHeightUsable,
    state: laserUsable && treeHeightUsable
      ? 'laser-and-tree-height-eligible'
      : treeHeightUsable
        ? 'tree-height-with-dtm-ortho-fallback'
        : 'manual-review-required',
    eligibleForAutomaticObjectCandidates: laserUsable && treeHeightUsable,
  });
}
