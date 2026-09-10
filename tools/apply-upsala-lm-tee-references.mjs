/* Reviewed navigation references on observed physical platforms. These are not
 * surveyed daily marker positions or evidence of a platform's tee colour.
 * The review explicitly chooses every association; this never selects a pad. */
import assert from 'node:assert/strict';
import { bbox, centroid, pointInPoly, polyArea, polyLen, ptSeg, ptSegD } from '../upsalabuild/lib.mjs';

const CLEARANCE = 1;
const SEARCH_CLEARANCE = CLEARANCE + 0.005; // retain >=1 m after millimetre rounding
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rounded = p => p.map(v => Number(v.toFixed(3)));
const ringClearance = (p, ring) => pointInPoly(...p, ring)
  ? Math.min(...ring.map((a, i) => ptSegD(...p, ...a, ...ring[(i + 1) % ring.length]))) : -Infinity;

/** Find a nearby interior point on an explicitly chosen ring, never a pad ID.
 * Search paths from the reference and nearest boundary points toward a fixed
 * set of interior anchors; choose the closest successful point. This is a
 * deterministic interior placement, not an exact polygon-buffer operation. */
export function interiorTeeReference(position, ring) {
  assert(point(position), 'tee reference must be a finite local point');
  assert(Array.isArray(ring) && ring.length >= 3 && ring.every(point) && Math.abs(polyArea(ring)) > 1,
    'tee platform must be a finite nondegenerate polygon');
  if (ringClearance(position, ring) >= CLEARANCE) return [...position];
  const bounds = bbox(ring), anchors = [centroid(ring)];
  for (let row = 1; row < 10; row++) for (let column = 1; column < 10; column++) {
    anchors.push([bounds.x0 + (bounds.x1 - bounds.x0) * column / 10,
      bounds.z0 + (bounds.z1 - bounds.z0) * row / 10]);
  }
  const safeAnchors = anchors.filter(p => ringClearance(p, ring) >= SEARCH_CLEARANCE);
  assert(safeAnchors.length, 'reviewed tee platform has no supported 1 m interior reference; review an explicit position');
  const boundary = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], hit = ptSeg(...position, ...a, ...b);
    return { d: hit.d, point: [a[0] + (b[0] - a[0]) * hit.t, a[1] + (b[1] - a[1]) * hit.t] };
  }).sort((a, b) => a.d - b.d).slice(0, 3).map(hit => hit.point);
  const candidates = [];
  for (const start of [position, ...boundary]) for (const end of safeAnchors) {
    const at = t => [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
    // A concave ring can leave/re-enter the path. Find its first sampled safe
    // interval before refining locally; do not assume global monotonicity.
    for (let step = 1; step <= 48; step++) {
      if (ringClearance(at(step / 48), ring) < SEARCH_CLEARANCE) continue;
      let low = (step - 1) / 48, high = step / 48;
      for (let iteration = 0; iteration < 25; iteration++) {
        const middle = (low + high) / 2;
        if (ringClearance(at(middle), ring) >= SEARCH_CLEARANCE) high = middle;
        else low = middle;
      }
      const candidate = rounded(at(high));
      if (ringClearance(candidate, ring) >= CLEARANCE) candidates.push(candidate);
      break;
    }
  }
  assert(candidates.length, 'unable to place reviewed tee reference with 1 m boundary clearance');
  candidates.sort((a, b) => distance(position, a) - distance(position, b) || a[0] - b[0] || a[1] - b[1]);
  return candidates[0];
}

/** Validate the entire review before mutating. Return the same model.
 * A changed back-tee reference moves line[0] only when the original reference
 * actually coincided with that original route start (within 0.2 m). */
export function applyUpsalaLmTeeReferences(model, inputReviews) {
  const reviews = Array.isArray(inputReviews) ? inputReviews : [inputReviews];
  const seen = new Set(), changes = [];
  for (const review of reviews) {
    assert.equal(review.schemaVersion, 1, 'unsupported tee-reference review schema');
    assert(['stora', 'mellan'].includes(review.course), 'tee-reference review must identify stora or mellan');
    assert.equal(model.holes.length, review.course === 'stora' ? 18 : 9, 'tee-reference review belongs to another course');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt), 'tee-reference review date required');
    assert.deepEqual(review.frame, { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon }, 'tee-reference frame changed');
    assert(Array.isArray(review.holes), 'tee-reference hole decisions required');
    for (const record of review.holes) {
      const hole = model.holes.find(h => h.n === record.hole);
      assert(hole && !seen.has(hole.n), `unknown or duplicate tee-reference hole ${record.hole}`);
      seen.add(hole.n);
      assert.deepEqual(hole.tees.marks, record.originalMarks, `H${hole.n}: original marker references changed`);
      assert.deepEqual(hole.line, record.originalLine, `H${hole.n}: original route changed`);
      assert.deepEqual(hole.t, record.originalDistances, `H${hole.n}: original card distances changed`);
      assert(Array.isArray(record.referenceDecisions), `H${hole.n}: reference decisions required`);
      assert.deepEqual(record.referenceDecisions.map(d => d.markIndex).sort((a, b) => a - b),
        hole.tees.marks.map((_, i) => i), `H${hole.n}: every reference needs exactly one decision`);
      const marks = structuredClone(hole.tees.marks), moved = [];
      for (const decision of record.referenceDecisions) {
        assert(['align-to-observed-pad', 'retain'].includes(decision.status), `H${hole.n}: unsupported reference decision`);
        assert(typeof decision.reason === 'string' && decision.reason.trim(), `H${hole.n}: reference decision needs a reason`);
        if (decision.status === 'retain') continue;
        const pad = hole.tees.pads[decision.padIndex], mark = marks[decision.markIndex];
        assert(Number.isInteger(decision.padIndex) && pad, `H${hole.n}: reviewed pad is missing`);
        assert(typeof decision.padSourceId === 'string' && decision.padSourceId.length > 0,
          `H${hole.n}: reviewed platform identity required`);
        assert.equal(pad.sourceId, decision.padSourceId, `H${hole.n}: reviewed platform identity changed`);
        assert(pad.preserveTerrain === true && ['dated-orthophoto-trace', 'ortho-trace'].includes(pad.prov),
          `H${hole.n}: reference requires an observed physical platform`);
        assert.deepEqual(pad.ring, decision.originalPadRing, `H${hole.n}: reviewed platform boundary changed`);
        assert(Number.isFinite(decision.maxShiftMetres) && decision.maxShiftMetres >= 0,
          `H${hole.n}: explicit maximum reference shift required`);
        let position;
        if (decision.reviewedPosition !== undefined) {
          assert(point(decision.reviewedPosition), `H${hole.n}: explicit reviewed position must be a finite local point`);
          assert(ringClearance(decision.reviewedPosition, pad.ring) >= CLEARANCE,
            `H${hole.n}: explicit reviewed position must be at least 1 m inside its reviewed platform`);
          position = [...decision.reviewedPosition];
        } else position = interiorTeeReference(mark.c, pad.ring);
        const shift = distance(position, mark.c);
        assert(shift <= decision.maxShiftMetres + 1e-9, `H${hole.n}/${decision.markIndex}: reference shift ${shift.toFixed(3)} m exceeds reviewed limit`);
        mark.c = position;
        mark.referencePlacement = { method: 'reviewed-observed-platform-navigation-reference',
          reviewId: review.id ?? `upsala-${review.course}-tee-references-${review.reviewedAt}`,
          padSourceId: pad.sourceId, boundaryClearanceMetres: CLEARANCE,
          shiftMetres: Number(shift.toFixed(3)), dailyMarkerPositionVerified: false,
          teeColourAssociationVerified: false,
          ...(decision.reviewedPosition === undefined ? {} : { explicitReviewedPosition: true }),
          note: 'Navigation reference associated with an observed platform; daily marker position and tee colour are unverified.' };
        if (shift > 0) moved.push(decision.markIndex);
      }
      const line = structuredClone(hole.line);
      const movedStart = moved.includes(0) && distance(record.originalMarks[0].c, record.originalLine[0]) <= 0.2;
      if (movedStart) line[0] = [...marks[0].c];
      changes.push({ hole, marks, line, movedStart, moved, reviewedAt: review.reviewedAt,
        unresolvedCount: marks.filter(mark => !mark.referencePlacement).length,
        retainedCount: record.referenceDecisions.filter(d => d.status === 'retain').length });
    }
  }
  for (const change of changes) {
    const { hole, marks, line, movedStart, moved, reviewedAt, retainedCount, unresolvedCount } = change;
    hole.tees = { ...hole.tees, marks,
      markProvenance: 'Reviewed navigation references on explicitly associated observed platforms; unresolved scorecard-inferred references retained. Daily marker positions and tee colours unverified.',
      referenceReview: { reviewedAt, movedReferenceCount: moved.length, retainedReferenceCount: retainedCount,
        unresolvedReferencesRetained: unresolvedCount > 0,
        dailyMarkerPositionsVerified: false } };
    if (movedStart) {
      hole.line = line;
      const length = polyLen(line);
      hole.lineLen = Number(length.toFixed(1));
      if (Object.hasOwn(hole, 'lenDev')) hole.lenDev = Number((Math.abs(length - hole.t[0]) / hole.t[0] * 100).toFixed(2));
      if (Object.hasOwn(hole, 'teePadDist')) hole.teePadDist = Number(Math.min(...hole.tees.pads.map(p => distance(centroid(p.ring), line[0]))).toFixed(1));
      hole.routeStartReference = { method: 'reviewed-observed-platform-navigation-reference', reviewedAt,
        note: 'Only the formerly coincident back-tee route start follows the reviewed navigation reference; later route vertices and card distances are preserved.' };
    }
  }
  return model;
}
