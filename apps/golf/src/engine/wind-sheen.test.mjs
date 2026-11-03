/* The wind on the grass: the air's gusts cross the turf as laid, paler
   patches; periodic over the air's wrap, gentle, and off with ?windsheen=0. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONE_WIND, WIND_SHEEN, gustAt } from './one-wind.mjs';

describe('the wind on the grass', () => {
  it('is gentle: a laid patch is at most a seventh lighter, and cut to patches', () => {
    expect(WIND_SHEEN.gain).toBeLessThanOrEqual(0.15);
    expect(WIND_SHEEN.cut[0]).toBeGreaterThan(0.5);
    expect(WIND_SHEEN.cut[1]).toBeLessThan(1);
    for (const t of WIND_SHEEN.tint) expect(Math.abs(t - 1)).toBeLessThan(0.08);
  });
  it('never pops when the air wraps: both scales repeat over its period', () => {
    const P = ONE_WIND.gustPeriod;
    for (const [x, z] of [[3, 7], [-120, 55], [250, -310]]) {
      expect(gustAt(x + P, z)).toBeCloseTo(gustAt(x, z), 9);
      expect(gustAt(x, z + P)).toBeCloseTo(gustAt(x, z), 9);
      /* the fine scale is the quilt at twice the frequency, offset: P/2 still repeats */
      expect(gustAt(2 * (x + P) + 17, 2 * z + 31)).toBeCloseTo(gustAt(2 * x + 17, 2 * z + 31), 9);
    }
  });
  it('rides in the blades\' blotch varying and is switched in main.js', () => {
    const grass = fs.readFileSync(new URL('./near-grass.mjs', import.meta.url), 'utf8');
    expect(grass).toMatch(/varying\(vec4\(blotchTaps, windSheenAt\(root\)\), 'nearGrassBlotches'\)/);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/setWindSheen\(new URLSearchParams\(location\.search\)\.get\('windsheen'\) !== '0'\)/);
  });
});
