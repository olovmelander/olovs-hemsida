import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERONS, planHerons } from './herons.mjs';

/* a round pond, its bed shelving from the bank: 0 at the shore to `deep` at the middle */
const pond = (r, cx = 0, ccw = true, n = 64) => Array.from({ length: n }, (_, i) => {
  const a = (ccw ? 1 : -1) * i / n * Math.PI * 2;
  return [cx + r * Math.cos(a), r * Math.sin(a)];
});
const shelf = (r, deep, cx = 0) => (x, z) => -deep * Math.max(0, 1 - Math.hypot(x - cx, z) / r) * 4;

describe('herons in the shallows', () => {
  it('stands one heron a pond in the shallows by the bank, facing out over the water, whichever way the ring winds', () => {
    for (const ccw of [true, false]) {
      const plan = planHerons([{ id: 'p', ring: pond(40, 0, ccw), level: 0 }], { ground: shelf(40, 0.6) });
      expect(plan).toHaveLength(1);
      const [h] = plan;
      const fromShore = 40 - Math.hypot(h.x, h.z);
      expect(fromShore).toBeGreaterThan(0.5);
      expect(fromShore).toBeLessThan(HERONS.out[HERONS.out.length - 1] + 0.5);
      expect(-h.y).toBeGreaterThanOrEqual(HERONS.depth[0]);
      expect(-h.y).toBeLessThanOrEqual(HERONS.depth[1]);
      /* the bill (sin yaw, cos yaw) points within `turn` of the pond's middle */
      const toMiddle = Math.atan2(-h.x, -h.z);
      const off = Math.abs(Math.atan2(Math.sin(h.yaw - toMiddle), Math.cos(h.yaw - toMiddle)));
      expect(off).toBeLessThanOrEqual(HERONS.turn + 0.15);
    }
  });
  it('keeps at most four a course, far apart, nearest the played ground first, and the same every time', () => {
    const bodies = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, ring: pond(30, i * 150), level: 0 }));
    const ground = (x, z) => { const i = Math.round(x / 150); return shelf(30, 0.6, i * 150)(x, z); };
    const plan = planHerons(bodies, { ground });
    expect(plan.length).toBe(HERONS.maxTotal);
    for (let i = 0; i < plan.length; i++) for (let j = i + 1; j < plan.length; j++)
      expect(Math.hypot(plan[i].x - plan[j].x, plan[i].z - plan[j].z)).toBeGreaterThanOrEqual(HERONS.apart);
    expect(planHerons(bodies, { ground })).toEqual(plan);
    const near = planHerons(bodies, { ground, focus: { x0: 1000, x1: 1100, z0: -50, z1: 50 } });
    expect(Math.min(...near.map(h => h.x))).toBeGreaterThan(600);
  });
  it('stands none in deep water, on dry ground or in a puddle', () => {
    expect(planHerons([{ id: 'd', ring: pond(40), level: 0 }], { ground: () => -3 })).toEqual([]);
    expect(planHerons([{ id: 'y', ring: pond(40), level: 0 }], { ground: () => 1 })).toEqual([]);
    expect(planHerons([{ id: 's', ring: pond(10), level: 0 }], { ground: shelf(10, 0.6) })).toEqual([]);
  });
  it('is placed behind ?herons=0 in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/get\('herons'\) !== '0'/);
    expect(main).toContain('planHerons(bodies, { ground: terrainH, focus: playB })');
  });
});
