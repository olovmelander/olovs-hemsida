/* Colour across a stand: the old per-tree tint's two axes, with two slow washes
   that survive distance and half of each tree's own variation -- so neighbours
   are alike and stands differ -- and the far vista takes the same washes. */
import { describe, expect, it } from 'vitest';
import { hash2 } from './geom.js';
import { treeTint, vistaTint } from './stand-tint.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const oldTint = (x, z) => {
  const a = hash2(x * 0.37 + 11.3, z * 0.91 + 5.7) - 0.5, b = hash2(z * 0.53 + 2.1, x * 0.29 + 9.9) - 0.5;
  return [1 + a * 0.24 + b * 0.06, 1 + b * 0.16, 1 - a * 0.24 + b * 0.04, hash2(x * 0.71 + 4.4, z * 0.43 + 1.9)];
};
/* a deterministic scatter of tree positions over 8 km */
const positions = (() => {
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 40000 }, () => [(rnd() - 0.5) * 8000, (rnd() - 0.5) * 8000]);
})();
const stats = values => {
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return { mean, sd: Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) };
};
/* the mean difference in red between each tree and one `metres` east of it */
const neighbourGap = (stands, metres) => {
  const a = new Float32Array(4), b = new Float32Array(4);
  let sum = 0;
  for (const [x, z] of positions) {
    treeTint(x, z, a, 0, stands); treeTint(x + metres, z, b, 0, stands);
    sum += Math.abs(a[0] - b[0]);
  }
  return sum / positions.length;
};

describe('colour across a stand', () => {
  it('is the old per-tree tint when the before is asked for', () => {
    const out = new Float32Array(4);
    for (const [x, z] of positions.slice(0, 2000)) {
      treeTint(x, z, out, 0, false);
      const old = oldTint(x, z);
      for (let c = 0; c < 4; c++) expect(out[c]).toBeCloseTo(old[c], 6);
    }
  });
  it('keeps the old mean colour, and a spread that stays within reason', () => {
    const spread = {};
    for (const stands of [false, true]) {
      const r = [], g = [], b = [], out = new Float32Array(4);
      for (const [x, z] of positions) { treeTint(x, z, out, 0, stands); r.push(out[0]); g.push(out[1]); b.push(out[2]); }
      for (const channel of [r, g, b]) expect(Math.abs(stats(channel).mean - 1)).toBeLessThan(0.01);
      /* never a strange colour: every multiplier within 0.6-1.4 */
      for (const channel of [r, g, b]) { expect(Math.min(...channel)).toBeGreaterThan(0.6); expect(Math.max(...channel)).toBeLessThan(1.4); }
      spread[stands] = { r: stats(r).sd, g: stats(g).sd };
    }
    /* the before's spread (red 0.071, green 0.046), and the washes' larger one */
    expect(spread.false.r).toBeCloseTo(0.071, 2); expect(spread.false.g).toBeCloseTo(0.046, 2);
    expect(spread.true.r).toBeGreaterThan(0.09); expect(spread.true.r).toBeLessThan(0.13);
    expect(spread.true.g).toBeGreaterThan(0.06); expect(spread.true.g).toBeLessThan(0.1);
  });
  it('makes neighbours alike and stands different', () => {
    /* trees 6 m apart: half as different as before, or less */
    expect(neighbourGap(true, 6)).toBeLessThan(neighbourGap(false, 6) * 0.6);
    /* trees 600 m apart, in different stands: more different than any two trees were */
    expect(neighbourGap(true, 600)).toBeGreaterThan(neighbourGap(false, 600) * 1.2);
  });
  it('gives the far vista the same stands, and the before its plain white', () => {
    const a = new Float32Array(4), b = new Float32Array(4);
    for (const [x, z] of positions.slice(0, 500)) {
      vistaTint(x, z, a, 0); treeTint(x, z, b, 0);
      expect(Array.from(a)).toEqual(Array.from(b));
      vistaTint(x, z, a, 0, false);
      expect(Array.from(a.subarray(0, 3))).toEqual([1, 1, 1]);
      expect(a[3]).toBeCloseTo(b[3], 6);
    }
  });
  it('keeps prepared startup data eligible when the before is asked for', () => {
    expect(preparedTintAllowed('?bana=angso&standtint=0')).toBe(true);
  });
});
