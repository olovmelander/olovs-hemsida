import { describe, expect, it } from 'vitest';
import { teePadSurfaceOwners } from './tee-surface-ownership.mjs';
import { buildGroundSurfaceFeatures } from './surface-features.mjs';
import { SURFACE } from './surface.js';

const ring = [[0, 0], [12, 0], [12, 20], [0, 20]];
const hole = (n, points) => ({ n, tees: { pads: [{ id: `tee-${n}`, ring: points }],
  marks: [{ c: [6, 10], sourcePadId: `tee-${n}` }] } });

describe('physical tee surface ownership', () => {
  it('keeps both holes marker associations but submits an identical shared ground once', () => {
    const a = hole(15, ring), b = hole(17, structuredClone(ring));
    const before = JSON.stringify([a, b]), owners = teePadSurfaceOwners([b, a]);
    expect([...owners]).toEqual([a.tees.pads[0]]);
    expect(JSON.stringify([a, b])).toBe(before);
    const features = buildGroundSurfaceFeatures({ holes: [a, b] });
    expect(features.filter(f => f.surface === SURFACE.TEE)).toEqual([{ surface: SURFACE.TEE, rings: [ring], hole: 15 }]);
    expect(features.filter(f => f.surface === SURFACE.FRINGE)).toEqual([{ surface: SURFACE.FRINGE, rings: [ring], pad: 2.2, hole: 15 }]);
    expect(b.tees.marks[0].sourcePadId).toBe(b.tees.pads[0].id);
  });

  it('recognizes an identical boundary with another starting vertex, reverse winding and closure', () => {
    const a = hole(15, ring), reversed = [ring[2], ring[1], ring[0], ring[3], ring[2]];
    const b = hole(17, reversed);
    expect([...teePadSurfaceOwners([a, b])]).toEqual([a.tees.pads[0]]);
  });

  it('does not merge nearby, overlapping or nested physical surfaces', () => {
    const a = hole(1, ring), b = hole(2, ring.map(([x, z]) => [x + .01, z]));
    const c = hole(3, ring.map(([x, z]) => [x * .5 + 1, z * .5 + 1]));
    expect(teePadSurfaceOwners([a, b, c]).size).toBe(3);
  });

  it('ignores CRS subtraction noise in identity keys without changing either source ring', () => {
    const a = hole(15, ring), b = hole(17, ring.map(([x, z]) => [x + 1.2e-10, z - 9.3e-10]));
    const before = JSON.stringify([a, b]);
    expect([...teePadSurfaceOwners([a, b])]).toEqual([a.tees.pads[0]]);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
