/* A navigation point may be supported by visible tee or fairway turf even when
 * no complete platform boundary is known. Support rings are evidence only:
 * this helper never turns one into rendered geometry or claims a daily marker.
 */
import assert from 'node:assert/strict';
import { centroid, pointInPoly, polyArea, polyLen, ptSegD } from '../upsalabuild/lib.mjs';

const CLEARANCE = 1;
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// JSON ledgers omit optional undefined object fields. Preserve array slots and
// non-finite values so this normalization cannot conceal geometry mismatches.
const comparable = value => Array.isArray(value) ? value.map(comparable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).map(([key, child]) => [key, comparable(child)])) : value;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(p, a, b) {
  return Math.abs(cross(a, b, p)) < 1e-9 && p[0] >= Math.min(a[0], b[0]) - 1e-9
    && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}
function intersects(a, b, c, d) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
function supportRing(input) {
  assert(Array.isArray(input) && input.length >= 3 && input.every(point), 'support ring must contain finite local points');
  const ring = distance(input[0], input.at(-1)) === 0 ? input.slice(0, -1) : input.slice();
  assert(ring.length >= 3 && Math.abs(polyArea(ring)) > 1, 'support ring must enclose a nondegenerate area');
  for (let i = 0; i < ring.length; i++) {
    const nextI = (i + 1) % ring.length;
    assert(distance(ring[i], ring[nextI]) > 0, 'support ring has a duplicate adjacent vertex');
    for (let j = i + 1; j < ring.length; j++) {
      const nextJ = (j + 1) % ring.length;
      if (j === nextI || i === nextJ) continue;
      assert(!intersects(ring[i], ring[nextI], ring[j], ring[nextJ]), 'support ring is self-intersecting or self-touching');
    }
  }
  return ring;
}

/** Apply one or more ordered ledgers transactionally and return the same model.
 * A later review must guard the output state of an earlier review. A record's
 * decisions name only changed/confirmed references; its originalTees snapshot
 * protects every other mark and every physical pad without selecting a pad.
 */
export function applyUpsalaReviewedTeeSites(model, inputReviews) {
  const reviews = Array.isArray(inputReviews) ? inputReviews : [inputReviews];
  const staged = new Map();
  for (const review of reviews) {
    assert.equal(review.schemaVersion, 1, 'unsupported reviewed tee-site schema');
    assert(['stora', 'mellan'].includes(review.course), 'reviewed tee site must identify stora or mellan');
    assert.equal(model.holes.length, review.course === 'stora' ? 18 : 9, 'tee-site review belongs to another course');
    assert.deepEqual(review.frame, { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon }, 'tee-site frame changed');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt), 'tee-site review date required');
    assert(Array.isArray(review.holes) && review.holes.length > 0, 'reviewed tee-site holes required');
    const seenHoles = new Set();
    for (const record of review.holes) {
      assert(Number.isInteger(record.hole) && record.hole >= 1 && record.hole <= model.holes.length && !seenHoles.has(record.hole), 'unknown or duplicate reviewed tee-site hole');
      seenHoles.add(record.hole);
      const original = staged.get(record.hole) ?? model.holes[record.hole - 1];
      assert.equal(original.n, record.hole, 'reviewed tee-site hole identity changed');
      assert.deepEqual(comparable(original.tees), comparable(record.originalTees), `H${record.hole}: original complete tees changed`);
      assert.deepEqual(original.line, record.originalLine, `H${record.hole}: original route changed`);
      assert.deepEqual(original.t, record.originalDistances, `H${record.hole}: original card distances changed`);
      assert(Array.isArray(record.decisions) && record.decisions.length > 0, 'explicit reviewed tee-site decisions required');
      const hole = structuredClone(original), seenMarks = new Set();
      let moved = 0, movedRouteStart = false;
      for (const decision of record.decisions) {
        const index = decision.markIndex;
        assert(Number.isInteger(index) && index >= 0 && index < hole.tees.marks.length && !seenMarks.has(index), `H${hole.n}: unknown or duplicate tee-site mark`);
        seenMarks.add(index);
        assert(['tee', 'fairway'].includes(decision.siteClass), `H${hole.n}: tee-site class must be tee or fairway`);
        assert(point(decision.reviewedPosition) && point(original.tees.marks[index].c), `H${hole.n}: reviewed site position must be a finite local point`);
        assert(typeof decision.reason === 'string' && decision.reason.trim(), `H${hole.n}: reviewed site needs an evidence reason`);
        assert(Array.isArray(decision.sourceIds) && decision.sourceIds.length > 0 && decision.sourceIds.every(s => typeof s === 'string' && s.trim()), `H${hole.n}: reviewed site source identities required`);
        if (decision.positionInterpretationUncertaintyMetres !== undefined) assert(Number.isFinite(decision.positionInterpretationUncertaintyMetres)
          && decision.positionInterpretationUncertaintyMetres > 0, `H${hole.n}: site position interpretation uncertainty must be finite and positive`);
        if (decision.coordinateBasis !== undefined) assert(typeof decision.coordinateBasis === 'string' && decision.coordinateBasis.trim()
          && decision.coordinateBasis.length <= 120, `H${hole.n}: site coordinate basis must be a concise nonempty string`);
        const ring = supportRing(decision.supportRing), position = decision.reviewedPosition;
        assert(pointInPoly(...position, ring), `H${hole.n}: reviewed point is outside its evidence support area`);
        const clearance = Math.min(...ring.map((a, i) => ptSegD(...position, ...a, ...ring[(i + 1) % ring.length])));
        assert(clearance >= CLEARANCE, `H${hole.n}: reviewed point needs at least 1 m inside its evidence support area`);
        assert(Number.isFinite(decision.maxShiftMetres) && decision.maxShiftMetres >= 0, `H${hole.n}: explicit site movement bound required`);
        const shift = distance(position, original.tees.marks[index].c);
        assert(shift <= decision.maxShiftMetres + 1e-9, `H${hole.n}: reviewed site movement exceeds its bound`);
        assert(decision.updateRouteStart === undefined || typeof decision.updateRouteStart === 'boolean', `H${hole.n}: route-start choice must be explicit boolean`);
        if (decision.updateRouteStart) {
          assert(index === 0 && distance(original.line[0], original.tees.marks[0].c) <= 0.2, `H${hole.n}: route start was not coincident with this first reference`);
          if (shift > 0) { hole.line[0] = [...position]; movedRouteStart = true; }
        }
        const mark = hole.tees.marks[index];
        mark.c = [...position];
        mark.referencePlacement = { method: 'reviewed-visible-site-navigation-reference',
          reviewId: review.id ?? `upsala-${review.course}-tee-sites-${review.reviewedAt}`,
          siteClass: decision.siteClass, sourceIds: [...new Set(decision.sourceIds)],
          shiftMetres: Number(shift.toFixed(3)), supportBoundaryClearanceMetres: CLEARANCE,
          supportFootprintIsPhysicalBoundary: false, physicalPadBoundaryVerified: false,
          dailyMarkerPositionVerified: false, teeColourAssociationVerified: false };
        if (decision.positionInterpretationUncertaintyMetres !== undefined) mark.referencePlacement.positionInterpretationUncertaintyMetres = decision.positionInterpretationUncertaintyMetres;
        if (decision.coordinateBasis !== undefined) mark.referencePlacement.coordinateBasis = decision.coordinateBasis;
        if (shift > 0) moved++;
      }
      const unresolved = hole.tees.marks.filter(mark => !mark.referencePlacement).length;
      hole.tees.markProvenance = 'Reviewed navigation references on observed platforms or evidence-supported tee/fairway sites; unresolved inferred references retained. Daily marker positions and tee colours unverified.';
      hole.tees.siteReferenceReview = { reviewedAt: review.reviewedAt, reviewedReferenceCount: seenMarks.size,
        movedReferenceCount: moved, unresolvedReferenceCount: unresolved };
      if (hole.tees.referenceReview) hole.tees.referenceReview = { ...hole.tees.referenceReview,
        unresolvedReferencesRetained: unresolved > 0 };
      if (movedRouteStart) {
        const length = polyLen(hole.line);
        hole.lineLen = Number(length.toFixed(1));
        if (Object.hasOwn(hole, 'lenDev')) hole.lenDev = Number((Math.abs(length - hole.t[0]) / hole.t[0] * 100).toFixed(2));
        if (Object.hasOwn(hole, 'teePadDist')) hole.teePadDist = Number(Math.min(...hole.tees.pads.map(p => distance(centroid(p.ring), hole.line[0]))).toFixed(1));
        hole.routeStartReference = { method: 'reviewed-visible-site-navigation-reference', reviewedAt: review.reviewedAt,
          note: 'Explicitly requested first route point follows its formerly coincident reviewed navigation reference; later vertices and card distances are preserved.' };
      }
      staged.set(hole.n, hole);
    }
  }
  for (const [hole, value] of staged) model.holes[hole - 1] = value;
  return model;
}
