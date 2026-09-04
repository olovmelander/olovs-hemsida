import { describe, it, expect } from 'vitest';
import { createGroundClamp, GROUND_CLAMP } from './camera-clamp.mjs';

const DT = 1 / 60;
const run = (clamp, pos, frames, dt = DT, move = null) => {
  const dys = [];
  for (let i = 0; i < frames; i++) { if (move) move(pos, i); dys.push(clamp.step(pos, dt)); }
  return dys;
};

describe('the ground clamp', () => {
  it('leaves a camera at or above eye height alone, and never lowers one the user raised', () => {
    const clamp = createGroundClamp({ heightAt: () => 10 });
    const at = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    expect(run(clamp, at, 30).every(d => d === 0)).toBe(true);
    const high = { x: 0, y: 40, z: 0 };
    run(clamp, high, 120);
    expect(high.y).toBe(40);
    expect(clamp.lift).toBe(0);
  });

  it('climbs a three centimetre bump as a ramp, not a step, and settles on it', () => {
    let bump = 0;
    const clamp = createGroundClamp({ heightAt: () => 10 + bump });
    const pos = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    run(clamp, pos, 5);
    bump = 0.03;
    const dys = run(clamp, pos, 60);
    expect(dys[0]).toBeGreaterThan(0);
    expect(dys[0]).toBeLessThan(0.03 * 0.2);            /* the first frame takes a fraction of it */
    expect(Math.max(...dys)).toBeLessThan(0.006);
    expect(Math.abs(pos.y - (10.03 + GROUND_CLAMP.eye))).toBeLessThan(0.001);   /* within a millimetre after a second */
    expect(clamp.lift).toBeCloseTo(0.03, 3);
  });

  it('holds the hard floor in one step, whatever the ease', () => {
    const clamp = createGroundClamp({ heightAt: () => 10 });
    const pos = { x: 0, y: 10.5, z: 0 };
    clamp.step(pos, DT);
    expect(pos.y).toBeCloseTo(10 + GROUND_CLAMP.floor, 9);
    /* and keeps it under a rise faster than the ease can follow */
    let g = 10;
    const fast = createGroundClamp({ heightAt: () => g });
    const p2 = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    for (let i = 0; i < 40; i++) { g += 0.3; fast.step(p2, DT); expect(p2.y - g).toBeGreaterThanOrEqual(GROUND_CLAMP.floor - 1e-9); }
  });

  it('gives back what it lifted when the ground falls away, eased, and no more', () => {
    let g = 10;
    const clamp = createGroundClamp({ heightAt: () => g });
    const pos = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    g = 12; run(clamp, pos, 120);
    expect(pos.y).toBeCloseTo(12 + GROUND_CLAMP.eye, 3);
    expect(clamp.lift).toBeCloseTo(2, 3);
    g = 10;
    const dys = run(clamp, pos, 200);
    expect(dys[0]).toBeLessThan(0);
    /* the two metres come back as a glide, never faster than maxDescent */
    expect(Math.min(...dys)).toBeGreaterThanOrEqual(-GROUND_CLAMP.maxDescent * DT - 1e-9);
    expect(pos.y).toBeCloseTo(10 + GROUND_CLAMP.eye, 3);
    expect(clamp.lift).toBeCloseTo(0, 3);
    /* a camera the user then raises keeps its height: lift is spent */
    pos.y = 20; run(clamp, pos, 60);
    expect(pos.y).toBe(20);
  });

  it('climbs a step in the ground before reaching it, walking at a steady pace', () => {
    const heightAt = x => (x >= 10 ? 10.5 : 10);
    const clamp = createGroundClamp({ heightAt });
    const pos = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    const dys = run(clamp, pos, 200, DT, (p, i) => { p.x = i * 0.1; });   /* 6 m/s */
    /* a hard clamp would step 0.5 m in one frame; the rate steps up at each
       horizon handover as the wall nears, and peaks at about two centimetres */
    expect(Math.max(...dys)).toBeLessThan(0.03);
    /* by the time the step is under the camera, the camera is already up */
    const clamp2 = createGroundClamp({ heightAt });
    const p2 = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    for (let i = 0; i * 0.1 < 10; i++) { p2.x = i * 0.1; clamp2.step(p2, DT); }
    expect(p2.y).toBeGreaterThan(10.5 + GROUND_CLAMP.eye - 0.05);
  });

  it('reads the ground no more than four metres ahead, however fast the camera moves', () => {
    /* a hill twenty metres on: an orbit's tangent would point at it and never cross it */
    const heightAt = x => (x >= 20 ? 20 : 10);
    const clamp = createGroundClamp({ heightAt });
    const pos = { x: 0, y: 10 + GROUND_CLAMP.eye, z: 0 };
    for (let i = 0; i < 12; i++) { pos.x = i * 1.0; clamp.step(pos, DT); }   /* 60 m/s, 12 m in: the hill is 8 m off */
    expect(pos.y).toBe(10 + GROUND_CLAMP.eye);
    expect(clamp.lift).toBe(0);
    pos.x = 16.5; clamp.step(pos, DT);                                       /* 3.5 m off: now it climbs */
    expect(clamp.lift).toBeGreaterThan(0);
  });

  it('forgets its account when the camera is placed on purpose', () => {
    let g = 12;
    const clamp = createGroundClamp({ heightAt: () => g });
    const pos = { x: 0, y: 10, z: 0 };
    run(clamp, pos, 120);
    expect(clamp.lift).toBeGreaterThan(3);
    clamp.reset();
    expect(clamp.lift).toBe(0);
    g = 10; pos.y = 12.4;                                 /* a tee view, 2.4 m up: it must stay there */
    run(clamp, pos, 60);
    expect(pos.y).toBe(12.4);
  });
});
