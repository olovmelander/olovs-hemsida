import { describe, expect, it } from 'vitest';
import { hemiOctahedralEncode, hemiOctahedralDecode, frameBlend, viewBasis } from './tree-impostor.mjs';

let seed = 3;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const upperDirection = () => {
  const a = rnd() * Math.PI * 2, e = rnd() * Math.PI / 2;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
};

describe('the hemi-octahedral mapping', () => {
  it('round-trips every upper-hemisphere direction through the unit square', () => {
    for (let i = 0; i < 2000; i++) {
      const [x, y, z] = upperDirection();
      const [u, v] = hemiOctahedralEncode(x, y, z);
      expect(u).toBeGreaterThanOrEqual(-1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9);
      const [dx, dy, dz] = hemiOctahedralDecode(u, v);
      expect(Math.hypot(dx - x, dy - y, dz - z)).toBeLessThan(1e-6);
    }
  });
  it('puts the zenith at the centre and the horizon on the edge', () => {
    expect(hemiOctahedralEncode(0, 1, 0)).toEqual([0.5, 0.5]);
    const [u, v] = hemiOctahedralEncode(1, 0, 0);
    expect(Math.min(u, v, 1 - u, 1 - v)).toBeLessThan(1e-9);
  });
});

describe('the frame blend', () => {
  it('weights three frames of the grid to one, all inside it', () => {
    for (const n of [4, 8, 16]) {
      for (let i = 0; i < 1000; i++) {
        const { frames, weights } = frameBlend(rnd(), rnd(), n);
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        for (const w of weights) { expect(w).toBeGreaterThanOrEqual(-1e-9); expect(w).toBeLessThanOrEqual(1 + 1e-9); }
        for (const [fi, fj] of frames) { expect(fi).toBeGreaterThanOrEqual(0); expect(fi).toBeLessThan(n); expect(fj).toBeGreaterThanOrEqual(0); expect(fj).toBeLessThan(n); }
      }
    }
  });
  it('reproduces a frame exactly at its own grid point', () => {
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const { frames, weights } = frameBlend(i / (n - 1), j / (n - 1), n);
      const k = weights.findIndex(w => Math.abs(w - 1) < 1e-6);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(frames[k]).toEqual([i, j]);
    }
  });
});

describe('the view basis', () => {
  it('is orthonormal and right-handed, including straight down', () => {
    const dirs = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.6, 0.8, 0], ...Array.from({ length: 50 }, upperDirection)];
    for (const [x, y, z] of dirs) {
      const { right, up } = viewBasis(x, y, z);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.hypot(...right)).toBeCloseTo(1, 6);
      expect(Math.hypot(...up)).toBeCloseTo(1, 6);
      expect(dot(right, up)).toBeCloseTo(0, 6);
      expect(dot(right, [x, y, z])).toBeCloseTo(0, 6);
      expect(dot(up, [x, y, z])).toBeCloseTo(0, 6);
    }
  });
});
