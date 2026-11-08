import { describe, expect, it } from 'vitest';
import { readChannel, buildStreamWater, STREAM_WATER } from './stream-water.mjs';

/* a ditch running east along z = 0.8 (the traced line at z = 0 is 0.8 m off it): a 1.2 m
   wide cut 0.6 m deep in ground at 10 m, falling 1 cm a metre; a road crosses it at
   x = 60-66 on a culvert, and from x = 120 it is piped (no cut) */
const ground = (x, z) => {
  const fall = -0.01 * x;
  if (x >= 60 && x <= 66) return 10.3 + fall;
  if (x >= 120) return 10 + fall;
  const off = Math.abs(z - 0.8);
  return off <= 0.6 ? 9.4 + fall : off <= 1.6 ? 9.4 + (off - 0.6) * 0.6 + fall : 10 + fall;
};
const line = [[0, 0], [160, 0]];

describe('water in the ditches', () => {
  const samples = readChannel(line, 1.5, ground);
  const at = x => samples.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best));

  it('stands a little over the floor of the cut, on the cut itself', () => {
    const s = at(30);
    expect(s.wet).toBe(true);
    expect(Math.abs(s.z - 0.8)).toBeLessThanOrEqual(0.6);
    const floor = 9.4 - 0.3;
    expect(s.surface - floor).toBeGreaterThanOrEqual(STREAM_WATER.minimumDepthMetres - 1e-6);
    expect(s.surface - floor).toBeLessThanOrEqual(STREAM_WATER.maximumDepthMetres + 1e-6);
    /* across to where the ground rises over it, no further */
    expect(s.left + s.right).toBeGreaterThan(1);
    expect(s.left + s.right).toBeLessThan(3);
  });

  it('leaves a ditch to the lake it runs into', () => {
    const wet = readChannel(line, 1.5, ground, {}, x => x < 20);
    expect(wet.filter(s => s.x < 19).every(s => !s.wet)).toBe(true);
    expect(wet.some(s => s.x > 25 && s.wet)).toBe(true);
  });

  it('keeps the road over its culvert dry, and a piped stretch', () => {
    expect(at(63).wet).toBe(false);
    expect(at(140).wet).toBe(false);
    expect(at(80).wet).toBe(true);
  });

  it('draws the wet runs as one geometry, fading at their edges', () => {
    const water = buildStreamWater([{ line, w: 1.5 }, { line: [[0, 50]], w: 1 }], ground);
    expect(water.runs).toBe(2);
    expect(water.metres).toBeGreaterThan(90);
    expect(water.positions.length / 3).toBe(water.shore.length);
    expect(water.indices.length % 3).toBe(0);
    /* the banks' vertices fade to nothing, the middle's are water */
    expect(water.shore[0]).toBe(0);
    /* a run begins from nothing, and is water a few samples in */
    expect(water.shore[1]).toBe(0);
    expect(water.shore[3 * 5 + 1]).toBeGreaterThan(1.5);
    expect(Math.max(...water.indices)).toBeLessThan(water.positions.length / 3);
  });
});
