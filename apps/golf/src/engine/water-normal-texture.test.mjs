/* The water's ripple map (engine/water-normal-texture.mjs): it repeats, so it
   must close across the repeat, and closing it must not change the ripples. */
import { describe, expect, it } from 'vitest';
import { fbm } from './geom.js';
import { fillWaterNormalPixels } from './water-normal-texture.mjs';

const S = 512;
const fill = seamless => fillWaterNormalPixels(new Uint8ClampedArray(S * S * 4), S, { seamless });
/* mean |step| in the two normal channels between horizontal neighbours, and across the wrap */
function steps(d) {
  const at = (x, y, c) => d[(y * S + x) * 4 + c];
  const step = (ax, ay, bx, by) => Math.abs(at(ax, ay, 0) - at(bx, by, 0)) + Math.abs(at(ax, ay, 1) - at(bx, by, 1));
  let inside = 0, wrap = 0, insideRows = 0, wrapRows = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S - 1; x++) inside += step(x + 1, y, x, y);
    wrap += step(0, y, S - 1, y);
  }
  for (let x = 0; x < S; x++) { insideRows += step(x, 1, x, 0); wrapRows += step(x, 0, x, S - 1); }
  return { inside: inside / (S * (S - 1)), wrap: wrap / S, insideRows: insideRows / S, wrapRows: wrapRows / S };
}
const deviation = (d, c) => {
  let sum = 0, sq = 0;
  for (let i = c; i < d.length; i += 4) { sum += d[i]; sq += d[i] * d[i]; }
  const mean = sum / (S * S);
  return Math.sqrt(sq / (S * S) - mean * mean);
};

describe('the water ripple map', () => {
  const before = fill(false), now = fill(true);

  it('is, as the before, the generator it replaced, byte for byte', () => {
    const d = new Uint8ClampedArray(S * S * 4);
    const H = (x, y) => fbm(x * 0.028, y * 0.043, 4) + fbm(x * 0.11, y * 0.09, 2) * 0.35;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const nx = (H(x - 1, y) - H(x + 1, y)) * 2.6, ny = (H(x, y - 1) - H(x, y + 1)) * 2.6;
      const l = Math.hypot(nx, ny, 1);
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    expect(Buffer.from(before).equals(Buffer.from(d))).toBe(true);
  });

  it('had a seam at every repeat, and now closes both ways', () => {
    const was = steps(before), is = steps(now);
    /* the step across the old repeat was four times any step inside it */
    expect(was.wrap).toBeGreaterThan(3 * was.inside);
    expect(was.wrapRows).toBeGreaterThan(2 * was.insideRows);
    expect(is.wrap).toBeLessThan(1.25 * is.inside);
    expect(is.wrapRows).toBeLessThan(1.25 * is.insideRows);
  });

  it('keeps the ripples: the same grain and the same tilt', () => {
    expect(steps(now).inside).toBeCloseTo(steps(before).inside, 0);
    for (const c of [0, 1]) expect(deviation(now, c) / deviation(before, c)).toBeCloseTo(1, 1);
    for (let i = 3; i < now.length; i += 4) if (now[i] !== 255) throw new Error('alpha must stay opaque for the canvas upload');
  });
});
