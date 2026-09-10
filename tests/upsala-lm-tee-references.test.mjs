import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyUpsalaLmTeeReferences, interiorTeeReference } from '../tools/apply-upsala-lm-tee-references.mjs';
import { pointInPoly, polyLen, ptSegD } from '../upsalabuild/lib.mjs';
import { teeView } from '../apps/golf/src/engine/tee-view.mjs';
import { withInferredTeePads } from '../apps/golf/src/engine/tee-pads.mjs';

const ring = [[0, -5], [20, -5], [20, 5], [0, 5]];
const frame = { origin: { lat: 59.839, lon: 17.4952 }, mPerLat: 111320, mPerLon: 55930.68 };
const clearance = (p, r) => pointInPoly(...p, r)
  ? Math.min(...r.map((a, i) => ptSegD(...p, ...a, ...r[(i + 1) % r.length]))) : -1;
function fixture() {
  const model = { ...frame, holes: Array.from({ length: 18 }, (_, index) => ({
    n: index + 1, t: [104, 40], line: [[-4, 0], [50, 0], [100, 0]], lineLen: 104, lenDev: 0, teePadDist: 14,
    pin: [100, 0], green: { c: [100, 0] },
    tees: { inferPads: false, pads: [{ sourceId: `pad-${index + 1}`, ring: structuredClone(ring), preserveTerrain: true, prov: 'dated-orthophoto-trace' }],
      marks: [{ c: [-4, 0], teeIdx: 0, m: 104, b: 90 }, { c: [60, 0], teeIdx: 1, m: 40, b: 90 }] },
  })) };
  const hole = model.holes[0];
  const review = { schemaVersion: 1, course: 'stora', reviewedAt: '2026-09-09', frame,
    holes: [{ hole: 1, originalMarks: structuredClone(hole.tees.marks), originalLine: structuredClone(hole.line),
      originalDistances: [...hole.t], referenceDecisions: [
        { markIndex: 0, status: 'align-to-observed-pad', padIndex: 0, padSourceId: 'pad-1',
          originalPadRing: structuredClone(ring), maxShiftMetres: 10, reason: 'The reviewed rear platform serves this navigation reference.' },
        { markIndex: 1, status: 'retain', reason: 'Forward fairway reference has no identified physical platform; do not move it backward.' },
      ] }] };
  return { model, review };
}

describe('reviewed Upsala tee navigation references', () => {
  it('moves only an explicitly associated reference into its pad and updates only a coincident route start', () => {
    const { model, review } = fixture(), before = structuredClone(model.holes[0]);
    expect(applyUpsalaLmTeeReferences(model, review)).toBe(model);
    const hole = model.holes[0], mark = hole.tees.marks[0];
    expect(clearance(mark.c, ring)).toBeGreaterThanOrEqual(1);
    expect(mark.c[0]).toBeLessThan(1.02); // near the edge, not an unnecessary move to the centre
    expect(hole.tees.marks[1]).toEqual(before.tees.marks[1]);
    expect(hole.tees.pads).toEqual(before.tees.pads);
    expect(hole.t).toEqual(before.t);
    expect(hole.tees.marks.map(m => m.m)).toEqual(before.tees.marks.map(m => m.m));
    expect(hole.line[0]).toEqual(mark.c);
    expect(hole.line.slice(1)).toEqual(before.line.slice(1));
    expect(hole.lineLen).toBe(Number(polyLen(hole.line).toFixed(1)));
    expect(hole.lenDev).toBe(Number((Math.abs(polyLen(hole.line) - 104) / 104 * 100).toFixed(2)));
    expect(hole.teePadDist).not.toBe(before.teePadDist);
    expect(mark.referencePlacement.dailyMarkerPositionVerified).toBe(false);
    expect(mark.referencePlacement.teeColourAssociationVerified).toBe(false);
    expect(teeView(hole, mark).position).toEqual(mark.c);
    expect(withInferredTeePads([hole])[0].tees.pads).toHaveLength(1);
  });

  it('preserves an already safe reference and leaves a separately sourced route start unchanged', () => {
    const { model, review } = fixture();
    model.holes[0].tees.marks[0].c = [4, 0];
    review.holes[0].originalMarks = structuredClone(model.holes[0].tees.marks);
    applyUpsalaLmTeeReferences(model, review);
    expect(model.holes[0].tees.marks[0].c).toEqual([4, 0]);
    expect(model.holes[0].line).toEqual(review.holes[0].originalLine);
    expect(model.holes[0].routeStartReference).toBeUndefined();
    expect(model.holes[0].tees.referenceReview.movedReferenceCount).toBe(0);
  });

  it('fails transactionally when a later reference targets changed geometry or exceeds its reviewed shift', () => {
    for (const mutation of [
      decision => { decision.originalPadRing[0][0] += 1; },
      decision => { decision.maxShiftMetres = 1; },
      decision => { decision.padSourceId = 'another-platform'; },
    ]) {
      const { model, review } = fixture(), before = structuredClone(model);
      const record = structuredClone(review.holes[0]); record.hole = 2;
      record.referenceDecisions[0].padSourceId = 'pad-2';
      mutation(record.referenceDecisions[0]); review.holes.push(record);
      expect(() => applyUpsalaLmTeeReferences(model, review)).toThrow();
      expect(model).toEqual(before);
    }
  });

  it('rejects stale references and refuses an unreviewed inference or missing reference decision', () => {
    const { model, review } = fixture();
    applyUpsalaLmTeeReferences(model, review);
    expect(() => applyUpsalaLmTeeReferences(model, review)).toThrow(/original marker references changed/);
    const missing = fixture(); missing.review.holes[0].referenceDecisions.pop();
    expect(() => applyUpsalaLmTeeReferences(missing.model, missing.review)).toThrow(/every reference/);
    const synthetic = fixture(); synthetic.model.holes[0].tees.pads[0].prov = 'synth';
    expect(() => applyUpsalaLmTeeReferences(synthetic.model, synthetic.review)).toThrow(/observed physical platform/);
  });

  it('rejects a platform too narrow for 1 m clearance and handles a concave platform safely', () => {
    expect(() => interiorTeeReference([-2, 0], [[0, -0.9], [10, -0.9], [10, 0.9], [0, 0.9]])).toThrow(/1 m interior/);
    const concave = [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]];
    const p = interiorTeeReference([8, 8], concave);
    expect(clearance(p, concave)).toBeGreaterThanOrEqual(1);
    expect(interiorTeeReference([8, 8], concave)).toEqual(p);
  });

  it('uses the reviewed target even when another same-hole platform is nearer', () => {
    const { model, review } = fixture();
    const second = ring.map(([x, z]) => [x + 30, z]);
    model.holes[0].tees.pads.push({ sourceId: 'second', ring: second, preserveTerrain: true, prov: 'ortho-trace' });
    Object.assign(review.holes[0].referenceDecisions[0], { padIndex: 1, padSourceId: 'second', originalPadRing: second, maxShiftMetres: 40 });
    applyUpsalaLmTeeReferences(model, review);
    expect(clearance(model.holes[0].tees.marks[0].c, second)).toBeGreaterThanOrEqual(1);
    expect(pointInPoly(...model.holes[0].tees.marks[0].c, ring)).toBe(false);
  });

  it('preserves a separately reviewed coordinate rather than replacing it with a nearest interior candidate', () => {
    const { model, review } = fixture();
    Object.assign(review.holes[0].referenceDecisions[0], { reviewedPosition: [8, 1], maxShiftMetres: 13 });
    applyUpsalaLmTeeReferences(model, review);
    expect(model.holes[0].tees.marks[0].c).toEqual([8, 1]);
    expect(model.holes[0].line[0]).toEqual([8, 1]);
    expect(model.holes[0].tees.marks[0].referencePlacement.explicitReviewedPosition).toBe(true);
    expect(model.holes[0].tees.pads[0].ring).toEqual(ring);
  });

  it.each([[Infinity, 0], [8, 4.01], [22, 0], [10, 0, 0]])('rejects unsupported explicit position %j transactionally', position => {
    const { model, review } = fixture(), before = structuredClone(model);
    Object.assign(review.holes[0].referenceDecisions[0], { reviewedPosition: position, maxShiftMetres: 50 });
    expect(() => applyUpsalaLmTeeReferences(model, review)).toThrow(/explicit reviewed position/);
    expect(model).toEqual(before);
  });

  it('keeps the explicit position within the independently reviewed movement bound', () => {
    const { model, review } = fixture(), before = structuredClone(model);
    Object.assign(review.holes[0].referenceDecisions[0], { reviewedPosition: [8, 1], maxShiftMetres: 10 });
    expect(() => applyUpsalaLmTeeReferences(model, review)).toThrow(/exceeds reviewed limit/);
    expect(model).toEqual(before);
  });

  it('applies actual Mellan decisions while preserving all unassociated forward references', () => {
    const read = relative => JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url)));
    const model = read('upsalamellanbuild/course-model.json');
    const review = read('upsalabuild/mapping/lm-tee-review-mellan-2026-09-09.json');
    for (const record of review.holes) {
      const hole = model.holes.find(h => h.n === record.hole);
      hole.tees.marks = structuredClone(record.originalMarks); hole.line = structuredClone(record.originalLine);
    }
    const before = structuredClone(model);
    applyUpsalaLmTeeReferences(model, review);
    for (const record of review.holes) for (const decision of record.referenceDecisions) {
      const hole = model.holes.find(h => h.n === record.hole), mark = hole.tees.marks[decision.markIndex];
      if (decision.status === 'retain') expect(mark).toEqual(record.originalMarks[decision.markIndex]);
      else expect(clearance(mark.c, hole.tees.pads[decision.padIndex].ring)).toBeGreaterThanOrEqual(1);
    }
    expect(model.holes.map(h => h.tees.pads)).toEqual(before.holes.map(h => h.tees.pads));
    expect(model.holes.map(h => h.t)).toEqual(before.holes.map(h => h.t));
  });
});
