/* The ground's relief, baked into the tint's alpha: flat open ground is neutral,
   a hollow and the foot of a slope are sheltered, a crest is exposed, open
   ground beside a wood is sheltered by it -- and a whole raster is cheap. */
import { describe, expect, it } from 'vitest';
import { GROUND_RELIEF, groundReliefBytes, reliefOfByte } from './ground-relief.mjs';

const grid = (n, dx, heightAt) => {
  const heights = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = heightAt((i - (n - 1) / 2) * dx, (j - (n - 1) / 2) * dx);
  return heights;
};
const centre = n => ((n - 1) / 2) * n + (n - 1) / 2;

describe('the ground\'s baked relief', () => {
  it('decodes a byte to its signed relief exactly, 128 open', () => {
    expect(reliefOfByte(128)).toBe(0);
    expect(reliefOfByte(255)).toBe(1);
    expect(reliefOfByte(1)).toBe(-1);
    expect(reliefOfByte(0)).toBe(-1);
  });
  it('leaves flat open ground neutral, and water untouched', () => {
    const n = 41, heights = grid(n, 6, () => 12);
    const skip = new Uint8Array(n * n); skip[5] = 1;
    const bytes = groundReliefBytes({ heights, n, dx: 6, skip });
    expect(new Set(bytes)).toEqual(new Set([128]));
  });
  it('shelters a hollow and the foot of a slope, and exposes a crest', () => {
    const n = 61, dx = 6;
    /* a bowl 8 m deep and 120 m across */
    const bowl = groundReliefBytes({ heights: grid(n, dx, (x, z) => -8 * Math.exp(-(x * x + z * z) / (2 * 30 * 30))), n, dx });
    expect(reliefOfByte(bowl[centre(n)])).toBeLessThan(-0.2);
    /* a round hill 10 m high: its top exposed, its foot sheltered by the rise beside it */
    const hill = grid(n, dx, (x, z) => 10 * Math.exp(-(x * x + z * z) / (2 * 35 * 35)));
    const bytes = groundReliefBytes({ heights: hill, n, dx });
    expect(reliefOfByte(bytes[centre(n)])).toBeGreaterThan(0.8);
    const foot = ((n - 1) / 2) * n + (n - 1) / 2 + Math.round(55 / dx);
    expect(reliefOfByte(bytes[foot])).toBeLessThan(-0.05);
  });
  it('matches the ring meshes\' own horizon occlusion on the slope of a valley', () => {
    const n = 61, dx = 6, heightAt = (x) => 0.25 * Math.abs(x);
    const bytes = groundReliefBytes({ heights: grid(n, dx, heightAt), n, dx });
    /* main.js horizonAO at the valley floor: two of six directions look up the 25% walls... */
    let occ = 0;
    for (let k = 0; k < 6; k++) {
      const cx = Math.cos(k / 6 * 2 * Math.PI);
      let m = 0;
      for (const r of GROUND_RELIEF.radiiMetres) m = Math.max(m, (heightAt(cx * r) - heightAt(0)) / r);
      occ += Math.min(1, m * 2.4);
    }
    /* ...the valley floor also sits below its mean, so no crest term is added */
    expect(reliefOfByte(bytes[centre(n)])).toBeCloseTo(-occ / 6, 1);
  });
  it('shelters open ground beside a wood, and not the wood itself', () => {
    const n = 41, dx = 6, heights = grid(n, dx, () => 5), forest = new Float32Array(n * n);
    /* a wood over the western half */
    for (let j = 0; j < n; j++) for (let i = 0; i < 20; i++) forest[j * n + i] = 1;
    const bytes = groundReliefBytes({ heights, forest, n, dx });
    const row = 20 * n;
    expect(reliefOfByte(bytes[row + 20])).toBeLessThan(-0.15);  // open ground at the edge
    expect(reliefOfByte(bytes[row + 22])).toBeLessThan(0);      // and a little way out
    expect(bytes[row + 35]).toBe(128);                            // open ground 90 m out
    expect(bytes[row + 10]).toBe(128);                            // the wood's own floor
  });
  it('does not pick out a wood\'s gaps one cell at a time', () => {
    /* a wood with three cells in ten open, scattered at random, as the 3 m canopy raster reads one */
    const n = 61, dx = 6, heights = grid(n, dx, () => 5), forest = new Float32Array(n * n);
    let seed = 99;
    for (let k = 0; k < n * n; k++) forest[k] = (seed = (seed * 16807) % 2147483647) / 2147483647 < 0.7 ? 1 : 0;
    const bytes = groundReliefBytes({ heights, forest, n, dx });
    const inner = [];
    for (let j = 10; j < n - 10; j++) for (let i = 10; i < n - 10; i++) inner.push(reliefOfByte(bytes[j * n + i]));
    const mean = inner.reduce((a, v) => a + v, 0) / inner.length;
    const sd = Math.sqrt(inner.reduce((a, v) => a + (v - mean) ** 2, 0) / inner.length);
    /* a mild, even shelter through the stand, not a speckle of dark gaps */
    expect(mean).toBeLessThan(0);
    expect(sd).toBeLessThan(0.08);
  });
  it('costs tens of milliseconds for a whole raster, not seconds', () => {
    const n = 513, dx = 6, heights = grid(n, dx, (x, z) => 20 * Math.sin(x / 300) * Math.cos(z / 240));
    const forest = new Float32Array(n * n).map((_, k) => (k % 7 === 0 ? 1 : 0));
    const started = performance.now();
    groundReliefBytes({ heights, forest, n, dx });
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
