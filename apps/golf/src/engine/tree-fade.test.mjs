import { describe, it, expect } from 'vitest';
import { bayer4, fadeProgress, drainAt, fadeKeep, reversedFade, PAIR, FADE_LEVELS } from './tree-fade.mjs';

const B = Array.from({ length: FADE_LEVELS }, (_, m) => (m + 0.5) / FADE_LEVELS);
const kept = (code, f) => B.map(b => fadeKeep(code, f, b));

describe('bayer4', () => {
  it('reproduces the classic matrix', () => {
    const expected = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(bayer4(x, y)).toBe(expected[y][x]);
  });
});

describe('the pair masks partition every pixel at every level', () => {
  for (const inCode of [1, 2]) {
    it(`in code ${inCode} against out code ${PAIR[inCode]}`, () => {
      const flipped = new Array(FADE_LEVELS).fill(0);
      let prev = null;
      for (let L = 0; L <= FADE_LEVELS; L++) {
        const f = L / FADE_LEVELS;
        const a = kept(inCode, f), b = kept(PAIR[inCode], f);
        for (let m = 0; m < FADE_LEVELS; m++) expect(a[m] !== b[m]).toBe(true);   /* exactly one owner */
        if (prev) for (let m = 0; m < FADE_LEVELS; m++) if (a[m] !== prev[m]) flipped[m]++;
        prev = a;
      }
      /* every pixel flips from out to in exactly once over the fade */
      for (let m = 0; m < FADE_LEVELS; m++) expect(flipped[m]).toBe(1);
      expect(kept(inCode, 0).every(v => !v)).toBe(true);     /* the first frame shows only the old tier */
      expect(kept(inCode, 1).every(v => v)).toBe(true);      /* the last frame shows only the new one */
    });
  }
});

describe('fadeProgress in f32', () => {
  it('is 0 at t0 and 1 with no duration', () => {
    expect(fadeProgress(5, 5, 0.3)).toBe(0);
    expect(fadeProgress(5, 5, 0)).toBe(1);
    expect(fadeProgress(7, 5, 0.3)).toBe(1);
    expect(fadeProgress(5, 7, 0.3)).toBe(0);
  });
  it('lands on the level either side of every boundary, at every epoch, for both durations', () => {
    for (const t0 of [0, 100.37, 511.9]) for (const dur of [0.3, 0.25]) for (let L = 0; L <= FADE_LEVELS; L++) {
      for (const d of [-1e-4, 0, 1e-4]) {
        const clock = t0 + L * dur / FADE_LEVELS + d;
        expect(fadeProgress(clock, t0, dur)).toBe(Math.min(L, FADE_LEVELS) / FADE_LEVELS);
      }
      expect(fadeProgress(drainAt(t0, dur), t0, dur)).toBe(1);
    }
  });
});

describe('reversal keeps the pixel sets continuous', () => {
  for (const inCode of [1, 2]) for (const t0 of [0, 100.37, 511.9]) for (const dur of [0.3, 0.25]) {
    it(`code ${inCode}, t0 ${t0}, dur ${dur}`, () => {
      for (let L = 0; L <= FADE_LEVELS; L++) {
        const clock = t0 + L * dur / FADE_LEVELS;
        const f = fadeProgress(clock, t0, dur);
        const r = reversedFade(clock, t0, dur, inCode);
        const f2 = fadeProgress(clock, r.t0, dur);
        /* the old IN's kept set is the new OUT's, and the old OUT's is the new IN's */
        expect(kept(r.inCode, f2)).toEqual(kept(PAIR[inCode], f));
        expect(kept(PAIR[r.inCode], f2)).toEqual(kept(inCode, f));
        /* and the new t0 sits away from both boundaries of its level */
        for (const d of [-1e-4, 1e-4]) expect(fadeProgress(clock + d, r.t0, dur)).toBe(f2);
      }
    });
  }
});
