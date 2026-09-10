/* Reviewed EPSG:3006 geometry enters the existing frozen local frame exactly
 * once. Scorecard distances remain metadata, never an image registration. */
import assert from 'node:assert/strict';
import { sweref99TmToLatLon } from '../../packages/course-geo/chmv2/projection.mjs';
import { centroid, polyArea, polyLen, pointInPoly } from '../lib.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const round = value => Math.round(value * 1000) / 1000;

export function localPoint(model, point) {
  assert(pair(point) && point[0] > 677000 && point[0] < 681000 && point[1] > 6985000 && point[1] < 6991000,
    'Review coordinates must be EPSG:3006 within Norrfällsviken');
  const [lat, lon] = sweref99TmToLatLon(...point);
  return [round((lon - model.origin.lon) * model.mPerLon), round((model.origin.lat - lat) * model.mPerLat)];
}

function provenance(feature) {
  assert(typeof feature.id === 'string' && feature.id && typeof feature.sourceId === 'string' && feature.sourceId &&
    typeof feature.evidence === 'string' && feature.evidence.trim(), 'A trace needs identity, source and visual evidence');
  return { id: feature.id, reviewId: feature.id, prov: 'lm-orthophoto', sourceId: feature.sourceId,
    evidence: feature.evidence, sourceSha256: feature.panel?.sourceSha256,
    observedYear: 2024, notSurveyed: true };
}

export function reviewedRing(model, feature) {
  const metadata = provenance(feature);
  assert(Array.isArray(feature.ringEpsg3006) && feature.ringEpsg3006.length >= 3, 'A reviewed ring needs at least three vertices');
  const ring = feature.ringEpsg3006.map(p => localPoint(model, p));
  if (JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1))) ring.pop();
  assert(ring.length >= 3 && Math.abs(polyArea(ring)) > 1, 'Degenerate reviewed polygon');
  assert(new Set(ring.map(p => p.join(','))).size === ring.length, 'Repeated reviewed vertices');
  return { ring, ...metadata };
}

export function applyOrthophotoReview(model, review) {
  assert(review.schemaVersion === 1 && review.groundId === 'norrfallsviken', 'Wrong review schema or ground');
  assert(model.origin.lat === 62.9825 && model.origin.lon === 18.5325 && model.mPerLon === 50568.51,
    'Norrfällsviken frozen frame changed');
  const seen = new Set();
  for (const entry of review.holes || []) {
    assert(Number.isInteger(entry.hole) && !seen.has(entry.hole), 'Duplicate or invalid reviewed hole');
    seen.add(entry.hole);
    const hole = model.holes.find(h => h.n === entry.hole);
    assert(hole, `Missing reviewed hole ${entry.hole}`);
    if (entry.green) {
      const green = reviewedRing(model, entry.green);
      const c = entry.green.pointEpsg3006 ? localPoint(model, entry.green.pointEpsg3006)
        : pointInPoly(...hole.green.c, green.ring) ? hole.green.c : centroid(green.ring).map(round);
      assert(pointInPoly(...c, green.ring), `H${hole.n} reference outside reviewed green`);
      hole.green = { ...green, c, area: Math.round(Math.abs(polyArea(green.ring))) };
      hole.pin = [...c];
      hole.line[hole.line.length - 1] = [...c];
    }
    if (entry.fairways) hole.fairway = { rings: entry.fairways.map(f => reviewedRing(model, f).ring),
      prov: 'lm-orthophoto', sourceFeatures: entry.fairways.map(provenance) };
    if (entry.bunkers) hole.bunkers = entry.bunkers.map(f => reviewedRing(model, f));
    if (entry.tees) {
      hole.tees.pads = entry.tees.map(feature => {
        const pad = reviewedRing(model, feature), c = centroid(pad.ring);
        return { ...pad, cx: round(c[0]), cz: round(c[1]), preserveTerrain: true };
      });
      hole.tees.inferPads = false;
      hole.tees.markerLayout = 'separate-reviewed-colours';
      hole.tees.status = 'orthophoto-reviewed-platforms';
    }
    const markIndices = new Set();
    for (const ref of entry.teeReferences || []) {
      assert(Number.isInteger(ref.index) && hole.tees.marks[ref.index] && !markIndices.has(ref.index), 'Invalid tee reference index');
      assert(typeof ref.evidence === 'string' && ref.evidence, 'Tee reference needs an explicit visual association');
      markIndices.add(ref.index);
      const mark = hole.tees.marks[ref.index], pad = hole.tees.pads.find(p => p.id === ref.padId);
      assert(pad, `H${hole.n}: unknown reviewed tee platform ${ref.padId}`);
      const c = ref.pointEpsg3006 ? localPoint(model, ref.pointEpsg3006) : centroid(pad.ring).map(round);
      assert(pointInPoly(...c, pad.ring), 'Tee navigation reference must be inside its observed platform');
      const originalReference = mark.orthophotoReference?.originalReference || { c: [...mark.c], b: mark.b };
      mark.c = c;
      mark.sourcePadId = pad.id;
      mark.orthophotoReference = { kind: 'reviewed-platform-reference', sourceId: pad.sourceId,
        evidence: ref.evidence, originalReference, dailyMarkerPositionVerified: false };
      if (ref.index === 0) hole.line[0] = [...c];
      // Renderer angle is atan2(dx,dz), not a north-up compass bearing.
      mark.b = round(lineBearingAt(hole.line, c) * 180 / Math.PI);
    }
    for (const index of entry.unresolvedTeeReferences || []) {
      const mark = hole.tees.marks[index];
      assert(mark, 'Invalid unresolved tee index');
      mark.orthophotoReference = { kind: 'unresolved-guide-tee-reference',
        evidence: 'No colour-specific physical platform can be established from this orthophoto.',
        dailyMarkerPositionVerified: false };
      // Keep an invalid inherited source reference in the audit, while the
      // navigation camera gets a clearly separate safe display anchor.
      if ((entry.invalidTeeReferences || []).includes(index)) {
        mark.displayC = centroid(hole.tees.pads[0].ring).map(round);
      }
    }
    hole.lineLen = Math.round(polyLen(hole.line) * 10) / 10;
    hole.lenDev = round(Math.abs(polyLen(hole.line) - hole.t[0]) / hole.t[0] * 100);
    if (entry.green || entry.teeReferences?.length) {
      hole.lineSrc = 'orthophoto-reviewed-endpoints';
      hole.teeSlide = 0;
    }
    if (entry.tees) hole.teePadDist = 0;
    hole.orthophotoReview = { reviewedOn: '2026-09-09', observedYear: 2024,
      notes: [hole.orthophotoReview?.notes, entry.notes].filter(Boolean).join(' '),
      dailyMarkerPositionVerified: false };
  }
  model.mappingRevision = { id: 'lm-orthophoto-2026-09-09', observedYear: 2024,
    frame: 'EPSG:3006 through frozen WGS84 legacy frame; no fitted offset',
    independentSurveyAccuracyVerified: false };
  return model;
}

export function applyEnvironmentReview(model, review) {
  assert(review.groundId === 'norrfallsviken' && review.schemaVersion === 1, 'Wrong environment review');
  const mapped = [];
  const greens = [], ranges = [], newBuildings = [];
  for (const feature of review.features) {
    const shape = feature.ringEpsg3006 ? reviewedRing(model, feature)
      : { ...provenance(feature), line: feature.lineEpsg3006.map(p => localPoint(model, p)) };
    if (feature.kind === 'range') ranges.push(shape.ring);
    else if (feature.kind === 'practice_green') greens.push(shape.ring);
    else if (feature.kind === 'path') model.infra.paths.push({ ...shape, kind: 'path', surface: 'gravel', width: feature.width });
    else if (feature.kind === 'building') newBuildings.push({ ...shape, kind: 'shed', h: feature.height, name: feature.id });
    else if (feature.kind === 'water') {
      const c = centroid(shape.ring);
      const candidates = model.water.filter(w => !w.isSea).sort((a,b) =>
        Math.hypot(...centroid(a.ring).map((v,i)=>v-c[i])) - Math.hypot(...centroid(b.ring).map((v,i)=>v-c[i])));
      assert(candidates.length && Math.hypot(...centroid(candidates[0].ring).map((v,i)=>v-c[i])) < 80, 'No nearby legacy pond for reviewed water');
      const pond = candidates[0];
      Object.assign(pond, shape, { area: Math.round(Math.abs(polyArea(shape.ring))) });
    } else {
      mapped.push({ ...shape, kind: feature.kind, ...(shape.ring ? { rings: [shape.ring] } : {}),
        material: feature.material, ridgeAxis: feature.ridgeAxis,
        eaveHeight: feature.eaveHeight, ridgeHeight: feature.ridgeHeight, height: feature.height });
    }
  }
  model.scenery.greens = greens;
  model.scenery.range = ranges;
  model.scenery.tees = [];
  model.scenery.mappedFeatures = mapped;
  model.scenery.sourceFeatures = review.features.map(feature => feature.ringEpsg3006
    ? reviewedRing(model, feature) : { ...provenance(feature), line: feature.lineEpsg3006.map(p => localPoint(model,p)) });
  model.infra.buildings.push(...newBuildings);
  model.infra.preserveMappedBoundaries = true;
  return model;
}
