import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WATER_LILIES, createWaterLilies, lilyFlowerGeometry, lilyPadGeometry, planWaterLilies } from './water-lilies.mjs';

/* a round pond `r` metres across its radius, wound either way, its bed sloping from the shore to `deep` at the middle */
const pond = (r, n = 48, ccw = true) => Array.from({ length: n }, (_, i) => {
  const a = (ccw ? 1 : -1) * i / n * Math.PI * 2;
  return [r * Math.cos(a), r * Math.sin(a)];
});
const bowl = (r, deep) => (x, z) => -deep * Math.max(0, 1 - Math.hypot(x, z) / r);

describe('water lilies', () => {
  it('rafts pads in a pond\'s shallows, inside the water, at its level, whichever way the ring winds', () => {
    for (const ccw of [true, false]) {
      const plan = planWaterLilies([{ id: 'p', ring: pond(40, 48, ccw), level: 0 }], { ground: bowl(40, 3) });
      expect(plan.length).toBeGreaterThan(20);
      for (const p of plan) {
        const fromShore = 40 - Math.hypot(p.x, p.z);
        expect(fromShore).toBeGreaterThan(WATER_LILIES.out[0] * 0.5);
        expect(fromShore).toBeLessThan(WATER_LILIES.out[1] + WATER_LILIES.spread + 1);
        const deep = 0 - bowl(40, 3)(p.x, p.z);
        expect(deep).toBeGreaterThanOrEqual(WATER_LILIES.depth[0]);
        expect(deep).toBeLessThanOrEqual(WATER_LILIES.depth[1]);
        expect(p.y).toBeCloseTo(WATER_LILIES.lift, 6);
      }
      /* in patches, not a ring: some of the shore keeps none */
      const bearings = new Set(plan.map(p => Math.floor((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI / 12))));
      expect(bearings.size).toBeLessThan(24);
    }
  });
  it('keeps none on the sea, a big lake, dry ground, or a pond far from the course', () => {
    expect(planWaterLilies([{ id: 'b', ring: pond(600), level: 0 }], { ground: bowl(600, 3) })).toEqual([]);
    expect(planWaterLilies([{ id: 'd', ring: pond(40), level: 0 }], { ground: () => 1 })).toEqual([]);
    expect(planWaterLilies([{ id: 'f', ring: pond(40).map(([x, z]) => [x + 5000, z]), level: 0 }],
      { ground: (x, z) => bowl(40, 3)(x - 5000, z), focus: { x0: -50, x1: 50, z0: -50, z1: 50 } })).toEqual([]);
  });
  it('is the same plan every time, with a share of flowers', () => {
    const a = planWaterLilies([{ id: 'p', ring: pond(60), level: 2 }], { ground: (x, z) => 2 + bowl(60, 3)(x, z) });
    expect(a).toEqual(planWaterLilies([{ id: 'p', ring: pond(60), level: 2 }], { ground: (x, z) => 2 + bowl(60, 3)(x, z) }));
    const share = a.filter(p => p.flower).length / a.length;
    expect(share).toBeGreaterThan(0.05); expect(share).toBeLessThan(0.3);
  });
  it('builds a notched pad facing up, flowers with sound normals, and two instanced draws', () => {
    const pad = lilyPadGeometry();
    pad.computeBoundingBox();
    expect(pad.boundingBox.min.x).toBeCloseTo(-1, 3);
    expect(pad.boundingBox.max.x).toBeLessThan(0.99);
    const n = pad.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBe(1);
    const flower = lilyFlowerGeometry();
    const fn = flower.getAttribute('normal');
    for (let i = 0; i < fn.count; i++) expect(Math.hypot(fn.getX(i), fn.getY(i), fn.getZ(i))).toBeGreaterThan(0.9);
    const plan = planWaterLilies([{ id: 'p', ring: pond(60), level: 0 }], { ground: bowl(60, 3) });
    const lilies = createWaterLilies(plan);
    const [pads, blooms] = lilies.group.children;
    expect(pads.count).toBe(plan.length);
    expect(blooms.count).toBe(plan.filter(p => p.flower).length);
    expect(pads.castShadow).toBe(false);
    expect(pads.renderOrder).toBe(0);
    lilies.dispose();
  });
  it('is drawn behind ?lilies=0 in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/get\('lilies'\) !== '0'/);
  });
});
