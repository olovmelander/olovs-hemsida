import { describe, expect, it } from 'vitest';
import { ringSD } from './geom.js';
import { canRenderTeeMarker } from './tee-marker-visibility.mjs';
import { reviewedTeeMarkerPositions } from './reviewed-tee-marker-placement.mjs';

const fixture = () => ({
  n: 1, line: [[0, 0], [0, 100]],
  tees: {
    markerPlacement: 'reviewed', markerLayout: 'separate-reviewed-colours',
    pads: [{ id: 'reviewed-platform', ring: [[-2, -4], [2, -4], [2, 4], [-2, 4]] }],
    marks: Array.from({ length: 3 }, () => ({
      c: [0, 0], b: 0, sourcePadId: 'reviewed-platform',
      orthophotoReference: { kind: 'orthophoto-platform-reference' },
    })),
  },
});

describe('reviewed tee pairs on a mapped-only course', () => {
  it('keeps mapped-only references hidden unless both explicit tee policies are present', () => {
    for (const field of ['markerPlacement', 'markerLayout']) {
      const hole = fixture();
      delete hole.tees[field];
      expect(canRenderTeeMarker(hole, hole.tees.marks[0], 'mapped-only')).toBe(false);
    }
    const hole = fixture();
    expect(canRenderTeeMarker(hole, hole.tees.marks[0], 'mapped-only')).toBe(true);
  });

  it('requires a reviewed reference inside its nominated platform', () => {
    for (const extra of [
      { orthophotoReference: undefined },
      { orthophotoReference: { kind: 'unresolved-guide-tee-reference' } },
      { sourcePadId: undefined },
      { sourcePadId: 'another-platform' },
      { c: [8, 0] },
      { c: [NaN, 0] },
    ]) {
      const hole = fixture(), mark = { ...hole.tees.marks[0], ...extra };
      expect(canRenderTeeMarker(hole, mark, 'mapped-only')).toBe(false);
    }
  });

  it('retains card colour indices while fitting accepted pairs without moving the references', () => {
    const hole = fixture();
    hole.tees.marks[1].orthophotoReference.kind = 'unresolved-guide-tee-reference';
    const before = structuredClone(hole);
    const rendered = hole.tees.marks.flatMap((mark, colourIndex) =>
      canRenderTeeMarker(hole, mark, 'mapped-only')
        ? reviewedTeeMarkerPositions(hole, mark).map(position => ({ colourIndex, position })) : []);
    expect(rendered.map(entry => entry.colourIndex)).toEqual([0, 0, 2, 2]);
    expect(rendered.every(entry => ringSD(...entry.position, hole.tees.pads[0].ring) <= -.15 + 1e-8)).toBe(true);
    for (const a of rendered.filter(entry => entry.colourIndex === 0)) {
      for (const b of rendered.filter(entry => entry.colourIndex === 2)) {
        expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])).toBeGreaterThanOrEqual(.35);
      }
    }
    expect(hole).toEqual(before);
  });

  it('leaves existing non-mapped course visibility to its placement helper', () => {
    const hole = fixture();
    delete hole.tees.markerPlacement;
    delete hole.tees.marks[0].orthophotoReference;
    expect(canRenderTeeMarker(hole, hole.tees.marks[0], undefined)).toBe(true);
    expect(reviewedTeeMarkerPositions(hole, hole.tees.marks[0])).toHaveLength(2);
  });
});
