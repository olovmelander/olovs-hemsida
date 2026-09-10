/* Native orthophoto observations in EPSG:3006. Pixel coordinates are measured
 * from the northwest pixel edge; no fitted translation or scorecard scaling. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pointInPoly, polyArea } from '../../geobuild/lib.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REVIEW_PATH = 'lidingobuild/mapping/tee-native-alignment-review-2026-09-09.json';
export const PLAN_PATH = 'geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json';
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

export function reviewPoint(pixel, window) {
  if (!Array.isArray(pixel) || pixel.length !== 2 || !pixel.every(Number.isFinite) ||
      pixel[0] < 0 || pixel[1] < 0 || pixel[0] > window.width || pixel[1] > window.height) {
    throw new Error('Tee observation leaves its acquired pixel window');
  }
  return [window.boundsEpsg3006[0] + pixel[0] * window.resolutionMetres,
    window.boundsEpsg3006[3] - pixel[1] * window.resolutionMetres];
}

export function reviewedPlatforms(review, plan) {
  if (review.groundId !== 'lidingo' || plan.groundId !== 'lidingo' ||
      review.horizontalCrs !== 'EPSG:3006' || review.pixelConvention !== 'pixel-edge') {
    throw new Error('Lidingö tee review frame differs');
  }
  const ids = new Set();
  return review.holes.flatMap(hole => {
    const window = plan.windows.find(w => w.id === hole.windowId);
    if (!window || window.resolutionMetres !== .16) throw new Error(`Hole ${hole.hole}: missing native source window`);
    return hole.platforms.map(platform => {
      if (!platform.id || ids.has(platform.id)) throw new Error('Duplicate tee platform ID');
      ids.add(platform.id);
      const ring = platform.pixels.map(p => reviewPoint(p, window));
      if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) ring.push([...ring[0]]);
      if (ring.length < 4 || Math.abs(polyArea(ring)) < 1) throw new Error('Degenerate reviewed tee');
      return { type: 'Feature', id: platform.id, properties: {
        kind: 'tee', hole: hole.hole, sourceId: 'imagery-lm-ortho', observedYear: 2025,
        captureDate: review.captureDate, sourceWindowId: hole.windowId,
        sourcePixelTrace: platform.id, reviewStatus: 'machine-visual-review', notSurveyed: true,
        method: 'manual-native-orthophoto-boundary-digitization',
        interpretationUncertaintyMetres: platform.uncertaintyMetres ?? 1,
        areaSquareMetres: Math.round(Math.abs(polyArea(ring)) * 100) / 100,
        registrationAccuracy: 'not independently surveyed', note: platform.note,
        ...(platform.extentStatus ? { extentStatus: platform.extentStatus } : {}),
      }, geometry: { type: 'Polygon', coordinates: [ring] } };
    });
  });
}

export function applyReviewedSurfaces(collection, review, plan) {
  const replacements = reviewedPlatforms(review, plan);
  const holes = new Set(review.holes.map(h => h.hole));
  if (holes.size !== review.holes.length || [...holes].some(n => !Number.isInteger(n) || n < 1 || n > 18)) {
    throw new Error('Invalid or duplicate reviewed hole');
  }
  const retired = new Set(review.retiredContextFeatureIds || []);
  return { ...collection, features: [
    ...collection.features.filter(f => !retired.has(f.id) &&
      !(f.properties.kind === 'tee' && holes.has(f.properties.hole))), ...replacements,
  ] };
}

export function applyReviewedReferences(hole, review, plan, local) {
  const record = review.holes.find(h => h.hole === hole.n);
  if (!record) return hole;
  const window = plan.windows.find(w => w.id === record.windowId);
  if (record.markers.length !== hole.t.length) throw new Error(`Hole ${hole.n}: incomplete tee references`);
  hole.tees.pads.forEach(p => { p.id = p.sourceFeatureId; });
  hole.tees.marks = record.markers.map((marker, i) => {
    const c = local(reviewPoint(marker.pixel, window));
    const pad = hole.tees.pads.find(p => p.id === marker.platformId);
    if (!pad || !pointInPoly(...c, pad.ring)) throw new Error(`Hole ${hole.n} colour ${i}: reference outside nominated platform`);
    const b = lineBearingAt(hole.line, c) * 180 / Math.PI;
    return { c, b, m: hole.t[i], sourcePadId: pad.id,
      placement: 'representative-start-on-reviewed-platform; daily-marker-position-unknown',
      orthophotoReference: { kind: marker.unresolved ? 'unresolved-guide-tee-reference' : 'orthophoto-platform-reference', sourceId: 'imagery-lm-ortho',
        sourceWindowId: record.windowId, captureDate: review.captureDate,
        association: marker.association || record.association,
        dailyMarkerPositionVerified: false, ...(marker.unresolved ? { unresolvedReason: marker.reason } : {}) },
    };
  });
  hole.tees.markerPlacement = 'reviewed';
  hole.tees.markerLayout = 'separate-reviewed-colours';
  return hole;
}

export function loadTeeReview() {
  const review = read(REVIEW_PATH), plan = read(PLAN_PATH);
  if (review.planSha256 !== sha(PLAN_PATH)) throw new Error('Tee review source plan changed');
  reviewedPlatforms(review, plan);
  return { review, plan };
}

if (process.argv.includes('--surfaces-only')) {
  const { review, plan } = loadTeeReview();
  const filename = 'lidingobuild/mapping/playing-surfaces.geojson';
  const result = applyReviewedSurfaces(read(filename), review, plan);
  fs.writeFileSync(path.join(ROOT, filename), JSON.stringify(result, null, 2) + '\n');
  const reportFile = 'lidingobuild/mapping/playing-surfaces-review.json';
  const report = read(reportFile);
  report.featureCount = result.features.length;
  report.counts = Object.fromEntries(['green', 'tee', 'fairway', 'bunker'].map(kind =>
    [kind, result.features.filter(f => f.properties.kind === kind).length]));
  report.currentTeeReview = { path: REVIEW_PATH, sha256: sha(REVIEW_PATH),
    planPath: PLAN_PATH, planSha256: sha(PLAN_PATH), holes: review.holes.map(h => h.hole),
    captureDate: review.captureDate, independentHumanReview: false,
    dailyMarkerPositionsVerified: false };
  report.output.sha256 = sha(filename);
  fs.writeFileSync(path.join(ROOT, reportFile), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reviewedHoles: review.holes.length, counts: report.counts }));
}
