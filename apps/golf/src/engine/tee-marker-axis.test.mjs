/* The tee markers straddle the line.

   A pair of markers is set across the teeing ground, so the axis between them
   is perpendicular to the direction of play. The engine derives that direction
   with `lineBearingAt` instead of reading `mk.b` out of the pack, because the
   packs hold TWO conventions under one name: geobuild writes alongLine's
   atan2(dx, dz), every other build writes the compass bearing atan2(dx, -dz).
   These tests pin the convention and, in the last case, reproduce the exact
   failure that shipped -- a hole on a 45-degree heading whose two markers ended
   up one behind the other down the fairway.                                   */
import { describe, it, expect } from 'vitest';
import { lineBearingAt, rightOf } from './geom.js';

const DEG = 180 / Math.PI;
const compass = (dx, dz) => Math.atan2(dx, -dz);      /* what the pipelines write */
const forward = b => [Math.sin(b), Math.cos(b)];
/* how far the marker axis is from square across the line, in degrees */
const offSquare = (b, F) => {
  const R = rightOf(b);
  return Math.abs(90 - Math.acos(Math.min(1, Math.abs(R[0] * F[0] + R[1] * F[1]))) * DEG);
};

describe('lineBearingAt', () => {
  it('returns alongLine\'s convention: forward is (sin b, cos b)', () => {
    const b = lineBearingAt([[0, 0], [10, 10]], [5, 5]);
    const F = forward(b);
    expect(F[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(F[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('takes the segment the mark actually lies on, not the first', () => {
    /* a dogleg: north for 100 m, then due east. A mark at the tee end must get
       the north leg even though the line ends heading east. */
    const line = [[0, 0], [0, -100], [100, -100]];
    expect(lineBearingAt(line, [0, -5]) * DEG).toBeCloseTo(180, 6);   /* -z */
    expect(lineBearingAt(line, [80, -100]) * DEG).toBeCloseTo(90, 6); /* +x */
  });

  it('ignores a repeated point rather than dividing by zero', () => {
    const b = lineBearingAt([[0, 0], [0, 0], [0, 40]], [0, 20]);
    expect(Number.isFinite(b)).toBe(true);
    expect(b * DEG).toBeCloseTo(0, 6);
  });

  it('puts the marker pair square across the line on every heading', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const r = deg / DEG, L = [[0, 0], [Math.sin(r) * 300, Math.cos(r) * 300]];
      const b = lineBearingAt(L, [Math.sin(r) * 40, Math.cos(r) * 40]);
      expect(offSquare(b, forward(r))).toBeLessThan(1e-6);
    }
  });

  /* the bug, stated as a test: reading the pipelines' compass bearing as if it
     were alongLine's is a mirror in z, so the error is asin|sin 2b| -- nothing
     at all due north or due east, and a full 90 degrees on a 45-degree hole */
  it('a compass bearing read as an along bearing fails exactly where it did', () => {
    const at = deg => {
      const r = deg / DEG, dx = Math.sin(r), dz = Math.cos(r);
      return offSquare(compass(dx, dz), forward(r));
    };
    expect(at(0)).toBeCloseTo(0, 6);
    expect(at(90)).toBeCloseTo(0, 6);
    expect(at(45)).toBeCloseTo(90, 6);     /* markers strung out along the fairway */
    expect(at(135)).toBeCloseTo(90, 6);
    expect(at(30)).toBeGreaterThan(50);
  });
});
