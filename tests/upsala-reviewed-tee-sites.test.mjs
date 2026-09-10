import { describe, expect, it } from 'vitest';
import { applyUpsalaReviewedTeeSites } from '../tools/apply-upsala-reviewed-tee-sites.mjs';
import { pointInPoly, polyLen } from '../upsalabuild/lib.mjs';

const frame = { origin: { lat: 59.839, lon: 17.4952 }, mPerLat: 111320, mPerLon: 55930.68 };
function fixture() {
  const model = { ...frame, holes: Array.from({ length: 18 }, (_, i) => ({
    n: i + 1, t: [110, 70], line: [[1, 1], [50, 0], [100, 0]], lineLen: 99, lenDev: 10, teePadDist: 12.7,
    green: { c: [100, 0] }, fairway: { rings: [[[30, -8], [100, -8], [100, 8], [30, 8]]] },
    tees: { inferPads: false, pads: [{ ring: [[0, 0], [20, 0], [20, 20], [0, 20]], provisional: true }],
      marks: [{ c: [1, 1], b: 90, m: 110 }, { c: [38, 0], b: 90, m: 70 }],
      referenceReview: { unresolvedReferencesRetained: true } },
  })) };
  const hole = model.holes[0];
  const review = { schemaVersion: 1, reviewedAt: '2026-09-09', course: 'stora', frame,
    holes: [{ hole: 1, originalTees: structuredClone(hole.tees), originalLine: structuredClone(hole.line),
      originalDistances: [...hole.t], decisions: [{ markIndex: 0, siteClass: 'tee', reviewedPosition: [5, 5],
        supportRing: [[4, 4], [12, 4], [12, 12], [4, 12]], maxShiftMetres: 6,
        sourceIds: ['native-visible-turf', 'published-guide-point'], reason: 'Visible turf supports this point while canopy hides the full platform edge.',
        sourceGeometryEPSG3006: [[639800, 6636100]], originalPixelRing: [[10, 20]], updateRouteStart: false }] }] };
  return { model, review };
}

describe('reviewed tee and fairway navigation sites', () => {
  it('moves a point inside visible tee turf without claiming or changing the provisional platform boundary', () => {
    const { model, review } = fixture(), before = structuredClone(model);
    expect(applyUpsalaReviewedTeeSites(model, review)).toBe(model);
    const hole = model.holes[0], mark = hole.tees.marks[0];
    expect(mark.c).toEqual([5, 5]);
    expect(hole.tees.pads).toEqual(before.holes[0].tees.pads);
    expect(hole.tees.marks[1]).toEqual(before.holes[0].tees.marks[1]);
    expect([hole.line, hole.t, hole.green, hole.fairway]).toEqual([before.holes[0].line, before.holes[0].t, before.holes[0].green, before.holes[0].fairway]);
    expect(model.holes.slice(1)).toEqual(before.holes.slice(1));
    expect(mark.referencePlacement).toMatchObject({ siteClass: 'tee', physicalPadBoundaryVerified: false,
      supportFootprintIsPhysicalBoundary: false, dailyMarkerPositionVerified: false, teeColourAssociationVerified: false });
    expect(JSON.stringify(model)).not.toMatch(/supportRing|sourceGeometryEPSG3006|originalPixelRing|639800|6636100/);
  });

  it('supports a fairway reference without introducing a pad or changing a scorecard distance', () => {
    const { model, review } = fixture(), before = structuredClone(model.holes[0]);
    Object.assign(review.holes[0].decisions[0], { markIndex: 1, siteClass: 'fairway', reviewedPosition: [42, 2],
      supportRing: [[40, -2], [50, -2], [50, 5], [40, 5]] });
    applyUpsalaReviewedTeeSites(model, review);
    const hole = model.holes[0];
    expect(hole.tees.pads).toEqual(before.tees.pads);
    expect(pointInPoly(...hole.tees.marks[1].c, hole.tees.pads[0].ring)).toBe(false);
    expect(hole.tees.marks[1].referencePlacement.siteClass).toBe('fairway');
    expect(hole.tees.marks.map(m => m.m)).toEqual(before.tees.marks.map(m => m.m));
    expect(hole.line).toEqual(before.line);
  });

  it('preserves the declared point uncertainty and coordinate basis without promoting a site to a surveyed marker', () => {
    const { model, review } = fixture();
    Object.assign(review.holes[0].decisions[0], { positionInterpretationUncertaintyMetres: 12,
      coordinateBasis: 'guide-identified-fairway-entry' });
    applyUpsalaReviewedTeeSites(model, review);
    expect(model.holes[0].tees.marks[0].referencePlacement).toMatchObject({ positionInterpretationUncertaintyMetres: 12,
      coordinateBasis: 'guide-identified-fairway-entry', dailyMarkerPositionVerified: false,
      physicalPadBoundaryVerified: false, teeColourAssociationVerified: false });
  });

  it('accepts only omitted undefined object metadata from the generated pre-serialization model', () => {
    const { model, review } = fixture();
    model.holes[0].tees.pads[0].evidence = { latestVisualCrossCheckYear: undefined, source: 'native-photo' };
    review.holes[0].originalTees.pads[0].evidence = { source: 'native-photo' };
    expect(() => applyUpsalaReviewedTeeSites(model, review)).not.toThrow();
    const changed = fixture();
    changed.model.holes[0].tees.pads[0].evidence = { latestVisualCrossCheckYear: 2025 };
    changed.review.holes[0].originalTees.pads[0].evidence = {};
    expect(() => applyUpsalaReviewedTeeSites(changed.model, changed.review)).toThrow(/original complete tees changed/);
  });

  it.each([undefined, NaN, Infinity])('does not erase undefined array entries or non-finite coordinates: %s', value => {
    const { model, review } = fixture(); model.holes[0].tees.pads[0].ring[0][0] = value;
    expect(() => applyUpsalaReviewedTeeSites(model, review)).toThrow(/original complete tees changed/);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid site interpretation uncertainty %s', uncertainty => {
    const { model, review } = fixture(), before = structuredClone(model);
    review.holes[0].decisions[0].positionInterpretationUncertaintyMetres = uncertainty;
    expect(() => applyUpsalaReviewedTeeSites(model, review)).toThrow(/uncertainty must be finite and positive/);
    expect(model).toEqual(before);
  });

  it('rejects a missing coordinate basis label when the optional field is supplied', () => {
    const { model, review } = fixture(); review.holes[0].decisions[0].coordinateBasis = '  ';
    expect(() => applyUpsalaReviewedTeeSites(model, review)).toThrow(/coordinate basis/);
  });

  it('can confirm an existing point with a zero movement bound and leave its route untouched', () => {
    const { model, review } = fixture();
    model.holes[0].tees.marks[0].c = [5, 5];
    review.holes[0].originalTees = structuredClone(model.holes[0].tees);
    review.holes[0].decisions[0].maxShiftMetres = 0;
    applyUpsalaReviewedTeeSites(model, review);
    expect(model.holes[0].tees.marks[0].referencePlacement.shiftMetres).toBe(0);
    expect(model.holes[0].line).toEqual(review.holes[0].originalLine);
    expect(model.holes[0].routeStartReference).toBeUndefined();
  });

  it('changes only an explicitly requested formerly coincident route start and recomputes derived metrics', () => {
    const { model, review } = fixture(); review.holes[0].decisions[0].updateRouteStart = true;
    applyUpsalaReviewedTeeSites(model, review);
    const hole = model.holes[0], length = polyLen(hole.line);
    expect(hole.line[0]).toEqual([5, 5]);
    expect(hole.line.slice(1)).toEqual(review.holes[0].originalLine.slice(1));
    expect(hole.lineLen).toBe(Number(length.toFixed(1)));
    expect(hole.lenDev).toBe(Number((Math.abs(length - 110) / 110 * 100).toFixed(2)));
    const invalid = fixture(); invalid.review.holes[0].decisions[0].updateRouteStart = true;
    invalid.model.holes[0].line[0] = [0, 4]; invalid.review.holes[0].originalLine[0] = [0, 4];
    expect(() => applyUpsalaReviewedTeeSites(invalid.model, invalid.review)).toThrow(/not coincident/);
  });

  it.each([
    ['stale pad', r => { r.holes[0].originalTees.pads[0].ring[0][0]++; }, /complete tees changed/],
    ['stale unselected reference', r => { r.holes[0].originalTees.marks[1].c[0]++; }, /complete tees changed/],
    ['wrong frame', r => { r.frame = { ...r.frame, mPerLon: 111320 }; }, /frame changed/],
    ['nonfinite point', r => { r.holes[0].decisions[0].reviewedPosition = [NaN, 5]; }, /finite local point/],
    ['outside support', r => { r.holes[0].decisions[0].reviewedPosition = [3, 5]; }, /outside/],
    ['insufficient inset', r => { r.holes[0].decisions[0].reviewedPosition = [4.99, 5]; }, /at least 1 m/],
    ['excessive movement', r => { r.holes[0].decisions[0].maxShiftMetres = 5; }, /exceeds its bound/],
    ['invalid surface class', r => { r.holes[0].decisions[0].siteClass = 'rough'; }, /site class/],
    ['self-intersecting support', r => { r.holes[0].decisions[0].supportRing = [[0, 0], [10, 12], [0, 9], [8, 0]]; }, /self-intersecting/],
    ['missing source', r => { r.holes[0].decisions[0].sourceIds = []; }, /source identities/],
  ])('rejects %s transactionally, including an earlier valid record', (_label, mutate, message) => {
    const { model, review } = fixture(), before = structuredClone(model);
    const second = structuredClone(review); second.holes[0].hole = 2; mutate(second);
    expect(() => applyUpsalaReviewedTeeSites(model, [review, second])).toThrow(message);
    expect(model).toEqual(before);
  });

  it('requires ordered source lineage and resolves retained prior associations without erasing them', () => {
    const { model, review } = fixture();
    applyUpsalaReviewedTeeSites(model, review);
    expect(() => applyUpsalaReviewedTeeSites(model, review)).toThrow(/complete tees changed/);
    const second = structuredClone(review); second.holes[0].originalTees = structuredClone(model.holes[0].tees);
    Object.assign(second.holes[0].decisions[0], { markIndex: 1, siteClass: 'fairway', reviewedPosition: [42, 2],
      supportRing: [[40, -2], [50, -2], [50, 5], [40, 5]] });
    const prior = structuredClone(model.holes[0].tees.marks[0]);
    applyUpsalaReviewedTeeSites(model, second);
    expect(model.holes[0].tees.marks[0]).toEqual(prior);
    expect(model.holes[0].tees.referenceReview.unresolvedReferencesRetained).toBe(false);
    expect(model.holes[0].tees.siteReferenceReview.unresolvedReferenceCount).toBe(0);
  });
});
