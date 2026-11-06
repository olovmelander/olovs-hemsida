import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { lightNow, sameLight, skyOf, snowLies, NU } from './light-now.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';

/* Upsala GK, and Veckefjärden in Jämtland, further north */
const UPPSALA = [59.839, 17.4952], VECKEFJARDEN = [63.2845, 18.6735];
const at = (iso, weather = null, [lat, lon] = UPPSALA) => lightNow(new Date(iso), lat, lon, weather);

describe('Nu: the light of this moment', () => {
  it('chooses by the real sun when there is no reading', () => {
    expect(at('2026-06-21T10:00:00Z').preset).toBe('noon');
    /* a June evening after nine: the low sun in the north is the midnight sun's */
    expect(at('2026-06-21T20:30:00Z').preset).toBe('midnight');
    /* five on a June morning: dawn */
    expect(at('2026-06-21T03:00:00Z').preset).toBe('dawn');
    /* a November night: the blue hour */
    expect(at('2026-11-06T20:00:00Z').preset).toBe('bluehour');
    /* a January noon: the season's snow lies, and winter is its light */
    expect(at('2026-01-15T11:00:00Z')).toMatchObject({ preset: 'winter', snow: 1, bare: 1 });
  });
  it('turns the leaves in autumn, lays the grass pale from the frosts, and gives a low sun to autumn', () => {
    expect(at('2026-10-05T10:00:00Z')).toMatchObject({ preset: 'noon', autumn: 1, straw: 1, bare: 0 });
    expect(at('2026-10-05T15:00:00Z')).toMatchObject({ preset: 'host', autumn: 1 });
    /* early November: the broadleaves are bare, the grass not yet pale */
    expect(at('2026-11-06T14:30:00Z')).toMatchObject({ preset: 'golden', bare: 1, autumn: 0, straw: 0, snow: 0 });
    /* late November: the grass pale as well, without snow, and a low sun is autumn's */
    expect(at('2026-11-20T13:00:00Z')).toMatchObject({ preset: 'host', bare: 1, autumn: 0, straw: 1, snow: 0 });
    /* midsummer: green, leafy, no snow */
    expect(at('2026-06-21T10:00:00Z')).toMatchObject({ autumn: 0, straw: 0, bare: 0, snow: 0 });
  });
  it('reads the weather: rain is the storm, fog and falling snow the mist, a clear summer sky the cloudless day', () => {
    expect(at('2026-06-21T10:00:00Z', { code: 0, cloudPct: 5 }).preset).toBe('summer');
    expect(at('2026-06-21T10:00:00Z', { code: 2, cloudPct: 50 }).preset).toBe('noon');
    expect(at('2026-06-21T10:00:00Z', { code: 61, cloudPct: 95 }).preset).toBe('storm');
    expect(at('2026-06-21T10:00:00Z', { code: 95 }).preset).toBe('storm');
    expect(at('2026-06-21T10:00:00Z', { code: 45, cloudPct: 100 }).preset).toBe('mist');
    expect(at('2026-06-21T10:00:00Z', { code: 1, cloudPct: 10, visibilityM: 800 }).preset).toBe('mist');
    /* overcast and dry: the mist's light, in clearer air than a fog's */
    const overcast = at('2026-06-21T10:00:00Z', { code: 3, cloudPct: 96 });
    expect(overcast.preset).toBe('mist');
    expect(overcast.overrides.dens).toBe(NU.overcastDensity);
    expect(overcast.overrides.dens).toBeLessThan(ATMOSPHERE_PRESETS.mist.dens);
    /* snowing on a December day: the mist, over snow */
    expect(at('2026-12-06T11:00:00Z', { code: 73, cloudPct: 100, snowDepthM: 0.15 })).toMatchObject({ preset: 'mist', snow: 1, bare: 1 });
  });
  it('lays snow by the reading, not the calendar, when the reading has it', () => {
    /* a green December: no snow on the ground, whatever the season usually is */
    expect(at('2026-12-20T11:00:00Z', { code: 1, cloudPct: 10, snowDepthM: 0 })).toMatchObject({ snow: 0, bare: 1 });
    /* an early snow in November */
    expect(at('2026-11-06T11:00:00Z', { code: 1, cloudPct: 10, snowDepthM: 0.08 })).toMatchObject({ preset: 'winter', snow: 1 });
    expect(snowLies(null, { snow: 1 })).toBe(true);
    expect(snowLies({ code: 0, snowDepthM: 0.01 }, { snow: 1 })).toBe(false);
    expect(snowLies({ code: 71, snowDepthM: 0 }, { snow: 0 })).toBe(true);
  });
  it('keeps the night the blue hour whatever the sky, and its snow when it lies', () => {
    expect(at('2026-06-21T00:00:00Z', { code: 61 }, VECKEFJARDEN).preset).not.toBe('bluehour');
    expect(at('2026-01-15T20:00:00Z', { code: 61 })).toMatchObject({ preset: 'bluehour', snow: 1 });
  });
  it('stands the sun where it really stands, never lower than its light lets it', () => {
    for (const iso of ['2026-06-21T10:00:00Z', '2026-01-15T11:00:00Z', '2026-11-06T20:00:00Z', '2026-06-21T20:30:00Z']) {
      const light = at(iso), [x, y, z] = light.dir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
      if (light.preset === 'bluehour') expect(y).toBe(NU.dusk);
      else expect(y).toBeGreaterThanOrEqual(NU.lowest[light.preset] ?? NU.lowestElse);
      /* toward the sun's azimuth: x east, z south */
      const azimuth = Math.atan2(x, -z);
      expect(Math.abs(((azimuth - light.azimuth + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThan(1e-9);
    }
    /* a January noon sun stands in the south, low */
    const noon = at('2026-01-15T11:00:00Z');
    expect(noon.dir[2]).toBeGreaterThan(0.9);
    expect(noon.elevation).toBeGreaterThan(5);
    expect(noon.elevation).toBeLessThan(10);
  });
  it('only draws again when the light, the season, the air or the sun has moved', () => {
    const a = at('2026-06-21T10:00:00Z'), b = at('2026-06-21T10:01:00Z'), c = at('2026-06-21T10:30:00Z');
    expect(sameLight(a, b)).toBe(true);
    expect(sameLight(a, c)).toBe(false);
    expect(sameLight(a, at('2026-06-21T10:00:00Z', { code: 61 }))).toBe(false);
  });
  it('names a sky from a reading, or none without one', () => {
    expect(skyOf(null)).toBeNull();
    expect(skyOf({ code: 0 })).toBe('clear');
    expect(skyOf({ code: 3 })).toBe('overcast');
    expect(skyOf({ code: 2, cloudPct: 40 })).toBe('broken');
    expect(skyOf({ code: 75 })).toBe('snowing');
  });
  it('is chosen in main.js beside the ten lights, behind the rail\'s and the menu\'s Nu', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const menu = fs.readFileSync(new URL('../shell/menu.js', import.meta.url), 'utf8');
    for (const text of [html, menu]) for (const key of ['nu', 'winter']) expect(text).toContain(`data-preset="${key}"`);
    expect(main).toMatch(/document\.querySelectorAll\('\[data-preset\]'\)\.forEach\(b => b\.onclick = \(\) => chooseLight\(b\.dataset\.preset\)\);/);
    expect(main).toMatch(/sp\.set\('ljus', lightChoice === 'nu' \? 'nu' :/);
    /* never fetched under det or by an automated browser */
    expect(main).toMatch(/if \(!DET && !navigator\.webdriver\) kikWeather\(\);\n\s+const light = applyNu\(true\);/);
  });
});
