import { describe, it, expect } from 'vitest';
import { canRenderTeeMarker } from './tee-marker-visibility.mjs';
import { reviewedTeeMarkerPositions } from './reviewed-tee-marker-placement.mjs';
import { withInferredTeePads } from './tee-pads.mjs';
import { inRing, ringSD } from './geom.js';

const fixture = () => ({
  n: 1, line: [[0, 0], [60, 80]],
  tees: { inferPads: false, markerPlacement: 'reviewed', markerLayout: 'separate-reviewed-colours',
    pads: [{ id: 'reviewed-platform', ring: [[-5,-6],[5,-6],[5,6],[-5,6]], preserveTerrain: true }],
    marks: [162,162,155,128,120].map(m => ({ c: [0,0], b: 0, m, sourcePadId: 'reviewed-platform',
      orthophotoReference: { kind: 'orthophoto-platform-reference' } })) },
});

describe('reviewed tee marker opt-in for mapped-only grounds', () => {
  it('keeps historical mapped-only starts hidden unless their platform has an explicit review', () => {
    const hole = fixture();
    expect(canRenderTeeMarker(hole, hole.tees.marks[0], 'mapped-only')).toBe(true);
    for (const key of ['markerPlacement', 'markerLayout']) {
      const copy = structuredClone(hole); delete copy.tees[key];
      expect(canRenderTeeMarker(copy, copy.tees.marks[0], 'mapped-only')).toBe(false);
    }
    const old = structuredClone(hole); delete old.tees.marks[0].orthophotoReference;
    expect(canRenderTeeMarker(old, old.tees.marks[0], 'mapped-only')).toBe(false);
    expect(canRenderTeeMarker(old, old.tees.marks[0], undefined)).toBe(true);
  });

  it('rejects missing identities, unresolved evidence and a reference on another platform', () => {
    const hole = fixture();
    for (const change of [
      { sourcePadId: undefined }, { sourcePadId: 'unreviewed-platform' },
      { c: [7, 0] }, { c: [NaN, 0] },
      { orthophotoReference: { kind: 'unresolved-guide-tee-reference' } },
    ]) expect(canRenderTeeMarker(hole, { ...hole.tees.marks[0], ...change }, 'mapped-only')).toBe(false);
    hole.tees.pads.push({ id: 'unreviewed-platform', ring: [[6,-2],[9,-2],[9,2],[6,2]] });
    expect(canRenderTeeMarker(hole, { ...hole.tees.marks[0], c: [7,0] }, 'mapped-only')).toBe(false);
  });

  it('renders five separate transverse colour pairs on a shared reviewed platform without moving camera references', () => {
    const source = fixture(), before = structuredClone(source);
    const hole = withInferredTeePads([source])[0], positions = [];
    for (const mark of hole.tees.marks) {
      expect(canRenderTeeMarker(hole, mark, 'mapped-only')).toBe(true);
      const pair = reviewedTeeMarkerPositions(hole, mark);
      expect(pair).toHaveLength(2);
      expect(pair.every(p => inRing(...p, hole.tees.pads[0].ring))).toBe(true);
      expect(pair.every(p => ringSD(...p, hole.tees.pads[0].ring) <= -.15 + 1e-8)).toBe(true);
      expect((pair[1][0] - pair[0][0]) * .6 + (pair[1][1] - pair[0][1]) * .8).toBeCloseTo(0, 8);
      for (const p of pair) expect(positions.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= .35)).toBe(true);
      positions.push(...pair);
      expect(mark.c).toEqual([0, 0]);
    }
    expect(positions).toHaveLength(10);
    expect(hole.tees.pads).toHaveLength(1);
    expect(source).toEqual(before);
  });
});
