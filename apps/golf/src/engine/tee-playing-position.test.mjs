import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPack, inflateStream } from '../../../../packages/course-pack/lib.mjs';
import { withInferredTeePads } from './tee-pads.mjs';
import { deriveTeePlayingPositions } from './tee-playing-position.mjs';
import { inRing, ringSD } from './geom.js';
import { reviewedTeeMarkerPositions } from './reviewed-tee-marker-placement.mjs';

const rectangle = (left = -5, right = 5) => [[left, -20], [right, -20], [right, 20], [left, 20]];
const fixture = (marks = [{ c: [4.5, 0], b: 0 }], pads = [{ id: 'pad', ring: rectangle() }]) =>
  ({ n: 1, line: [[0, -20], [0, 200]], tees: { marks, pads, inferPads: false } });
const publicRoot = new URL('../../public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('courses/index.json', publicRoot)));
function loadCourse(course) {
  const pack = readPack(readFileSync(new URL(course.packUrl.replace(/^\//, ''), publicRoot)));
  return JSON.parse(inflateStream(pack.sv));
}

describe('runtime tee playing positions', () => {
  it('centres across a shared long pad without merging tees along the hole', () => {
    const hole = fixture([{ c: [4.5, -12], b: 0 }, { c: [4, 10], b: 0 }]);
    const originalPads = structuredClone(hole.tees.pads);
    deriveTeePlayingPositions(hole);
    expect(hole.tees.marks.map(m => m.c)).toEqual([[0, -12], [0, 10]]);
    expect(hole.tees.marks.map(m => m.referenceC)).toEqual([[4.5, -12], [4, 10]]);
    expect(hole.tees.pads).toEqual(originalPads);
  });

  it('stays in the same connected part of a concave pad', () => {
    const ring = [[-6, -6], [6, -6], [6, 6], [2, 6], [2, -2], [-2, -2], [-2, 6], [-6, 6]];
    const hole = fixture([{ c: [-5.5, 3], b: 0 }], [{ ring }]);
    deriveTeePlayingPositions(hole);
    expect(hole.tees.marks[0].c).toEqual([-4, 3]);
    expect(inRing(...hole.tees.marks[0].c, ring)).toBe(true);
  });

  it.each([
    ['outside every pad', { c: [6, 0], b: 0 }, [{ id: 'pad', ring: rectangle() }], 'reference-outside-associated-pad'],
    ['outside the nominated pad', { c: [4.5, 0], b: 0, sourcePadId: 'other' }, [{ id: 'pad', ring: rectangle() }], 'reference-outside-associated-pad'],
    ['overlapping pads without an association', { c: [4.5, 0], b: 0 }, [{ ring: rectangle() }, { ring: rectangle(0, 10) }], 'ambiguous-pad-association'],
    ['unresolved guide position', { c: [4.5, 0], b: 0, orthophotoReference: { kind: 'unresolved-guide-tee-reference' } }, [{ ring: rectangle() }], 'unresolved-guide-reference'],
    ['fairway reference', { c: [4.5, 0], b: 0, referenceSurfaceKind: 'fairway' }, [{ ring: rectangle() }], 'non-pad-reference'],
    ['excessive lateral movement', { c: [12, 0], b: 0 }, [{ ring: rectangle(-15, 15) }], 'centering-exceeds-shift-limit'],
  ])('retains %s for review', (_label, mark, pads, reason) => {
    const hole = fixture([mark], pads);
    deriveTeePlayingPositions(hole);
    expect(hole.tees.marks[0].c).toEqual(mark.c);
    expect(hole.tees.marks[0].playingPosition.reason).toBe(reason);
  });

  it('honours an explicit association when two pads overlap', () => {
    const hole = fixture([{ c: [4.5, 0], b: 0, sourcePadId: 'pad' }],
      [{ id: 'pad', ring: rectangle() }, { id: 'other', ring: rectangle(0, 10) }]);
    deriveTeePlayingPositions(hole);
    expect(hole.tees.marks[0].c).toEqual([0, 0]);
  });

  it('keeps an inherited source reference and is idempotent after an explicit display anchor', () => {
    const hole = withInferredTeePads([fixture([{ c: [30, 30], displayC: [4.5, 0], b: 0 }])])[0];
    deriveTeePlayingPositions(hole);
    const first = structuredClone(hole);
    expect(hole.tees.marks[0].referenceC).toEqual([30, 30]);
    expect(hole.tees.marks[0].playingPosition.inputC).toEqual([4.5, 0]);
    deriveTeePlayingPositions(hole);
    expect(hole).toEqual(first);
  });

  it('centres Veckefjarden hole 1 tee 312 between its rendered markers on the same pad', () => {
    const model = loadCourse(manifest.courses.find(c => c.slug === 'veckefjarden'));
    const hole = withInferredTeePads(model.holes)[0];
    deriveTeePlayingPositions(hole);
    const mark = hole.tees.marks[2], pair = reviewedTeeMarkerPositions(hole, mark);
    expect(mark.playingPosition.padId).toBe('lm-h01-rear-long');
    expect(mark.playingPosition.beforeEdgeClearanceM).toBeCloseTo(.664, 3);
    expect(mark.playingPosition.afterEdgeClearanceM).toBeCloseTo(3.398, 3);
    expect(mark.playingPosition.shiftM).toBeCloseTo(2.748, 3);
    expect(pair).toHaveLength(2);
    expect((pair[0][0] + pair[1][0]) / 2).toBeCloseTo(mark.c[0], 8);
    expect((pair[0][1] + pair[1][1]) / 2).toBeCloseTo(mark.c[1], 8);
    expect(hole.tees.marks[5].c).toEqual(model.holes[0].tees.marks[5].c);
  });

  it.each(manifest.courses.map(c => [c.slug, c]))('preserves source geometry and safe lateral placement for all %s tees', (_slug, course) => {
    const model = loadCourse(course), original = structuredClone(model.holes);
    const holes = withInferredTeePads(model.holes), padGeometry = structuredClone(holes.map(h => h.tees.pads));
    for (const hole of holes) {
      deriveTeePlayingPositions(hole);
      for (const mark of hole.tees.marks) {
        const p = mark.playingPosition;
        expect(p).toBeDefined();
        if (p.method !== 'lateral-pad-centre') continue;
        const pad = hole.tees.pads[p.padIndex], angle = mark.b * Math.PI / 180;
        expect(inRing(...mark.c, pad.ring)).toBe(true);
        expect(-ringSD(...mark.c, pad.ring)).toBeGreaterThanOrEqual(p.beforeEdgeClearanceM - 1e-6);
        expect(p.shiftM).toBeLessThanOrEqual(6);
        expect((mark.c[0] - p.inputC[0]) * Math.sin(angle) + (mark.c[1] - p.inputC[1]) * Math.cos(angle)).toBeCloseTo(0, 8);
        if (mark.sourcePadId != null) expect([pad.id, pad.reviewId]).toContain(mark.sourcePadId);
      }
    }
    expect(holes.map(h => h.tees.pads)).toEqual(padGeometry);
    expect(model.holes).toEqual(original);
  });
});
