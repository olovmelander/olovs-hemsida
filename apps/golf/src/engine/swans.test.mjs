import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SWANS, loopAt, planSwans, ringArea, shoreDepth, swanHash, createSwans } from './swans.mjs';
import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three/webgpu';

/* a round lake, `r` metres across its radius, its centre at (cx, cz) */
const lake = (r, cx = 0, cz = 0, n = 64) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cz + r * Math.sin(i / n * Math.PI * 2)]);
const deep = () => -5;

describe('swans on the lakes', () => {
  it('measures a lake: its area and how far inside a point lies', () => {
    expect(ringArea(lake(100))).toBeCloseTo(Math.PI * 100 * 100, -3);
    expect(shoreDepth(0, 0, lake(100))).toBeGreaterThan(99);
    expect(shoreDepth(200, 0, lake(100))).toBeLessThan(-99);
  });
  it('keeps no swans on a pond too small for them', () => {
    expect(planSwans([{ id: 'p', ring: lake(25), level: 0 }], { ground: deep })).toEqual([]);
  });
  it('puts a pair on a lake, and every swan stays inset off the shore and over open water', () => {
    const ring = lake(90);
    const plan = planSwans([{ id: 'l', ring, level: 0 }], { ground: deep });
    expect(plan.length).toBeGreaterThanOrEqual(2);
    for (const swan of plan)
      for (let s = 0; s < 4000; s += 7) {
        const p = loopAt(swan.loop, s - swan.lag);
        expect(shoreDepth(p.x, p.z, ring)).toBeGreaterThanOrEqual(SWANS.inset - 1e-6);
      }
  });
  it('keeps the loop off an island and a silt bank', () => {
    const ring = lake(60);
    /* the whole middle is an island: the channel round it is too narrow for a loop */
    const island = (x, z) => Math.hypot(x, z) < 50 ? 1 : -3;
    expect(planSwans([{ id: 'i', ring, level: 0 }], { ground: (x, z) => Math.hypot(x, z) < 8 ? 1 : -3 }).length).toBeGreaterThan(0);
    expect(planSwans([{ id: 'i', ring, level: 0 }], { ground: island })).toEqual([]);
  });
  it('leaves a lake far from the played ground alone', () => {
    const far = planSwans([{ id: 'f', ring: lake(90, 5000, 0), level: 0 }], { ground: deep, focus: { x0: -100, x1: 100, z0: -100, z1: 100 } });
    expect(far).toEqual([]);
  });
  it('heads each swan along its loop, a unit heading, and is the same plan every time', () => {
    const plan = planSwans([{ id: 'l', ring: lake(150), level: 2 }], { ground: deep });
    expect(plan).toEqual(planSwans([{ id: 'l', ring: lake(150), level: 2 }], { ground: deep }));
    const loop = plan[0].loop;
    const a = loopAt(loop, 10), b = loopAt(loop, 10.01);
    expect(Math.hypot(a.dx, a.dz)).toBeCloseTo(1, 6);
    expect((b.x - a.x) * a.dx + (b.z - a.z) * a.dz).toBeGreaterThan(0);
    expect(plan.filter(s => s.cygnet).every(s => s.scale < 1)).toBe(true);
    expect(swanHash('x', 1)).not.toBe(swanHash('x', 2));
  });
  it('floats the swans at the lake\'s level, bill forward, and holds them still when asked', () => {
    const plan = planSwans([{ id: 'l', ring: lake(150), level: 2 }], { ground: deep });
    const g = () => { const geo = new BufferGeometry(); geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)); return geo; };
    const swans = createSwans({ body: g(), trim: g() }, plan);
    const [body] = swans.group.children;
    expect(body.count).toBe(plan.length);
    expect(body.castShadow).toBe(false);
    const m = new Matrix4();
    body.getMatrixAt(0, m);
    const at = new Vector3().setFromMatrixPosition(m);
    expect(Math.abs(at.y - (2 - SWANS.sink))).toBeLessThanOrEqual(SWANS.bob + 1e-6);
    const ripple = swans.group.getObjectByName('swans-ripple');
    expect(ripple.renderOrder).toBe(7);
    expect(ripple.material.depthWrite).toBe(false);
    const p = loopAt(plan[0].loop, 0);
    const bill = new Vector3(0, 0, 1).applyMatrix4(m).sub(at);
    expect(bill.x * p.dx + bill.z * p.dz).toBeGreaterThan(0.99);
    swans.update({ dt: 0.5, still: true });
    expect(swans.snapshot().time).toBe(0);
    swans.update({ dt: 0.05 });
    expect(swans.snapshot().time).toBeCloseTo(0.05, 6);
    swans.dispose();
  });
  it('is drawn behind ?swans=0 in main.js and updated each frame', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/get\('swans'\) !== '0'/);
    expect(main).toContain('swans?.update({ dt, still: cameraMotionPreference.matches })');
  });
});
