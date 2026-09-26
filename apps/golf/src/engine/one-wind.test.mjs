/* One wind: the air eases toward the flags' own target wind, carries the gusts,
   the sky's clouds and their shadows downwind, and holds still for reduced
   motion; main.js steps it every frame and puts the plants and sky on it. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_DEFAULT_MS, flagWindYaw } from './flag-motion.mjs';
import { ONE_WIND, createAir, downwindOf, gustAt, lightWind, stepAir, swayStrength } from './one-wind.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';

const wind = (fromDeg, ms) => ({ ms, yaw: flagWindYaw(fromDeg) });
const run = (air, seconds, w, options = {}) => { for (let t = 0; t < seconds; t += 1 / 60) stepAir(air, 1 / 60, w, options); return air; };

describe('the one wind', () => {
  it('blows downwind: a westerly toward +x (east), a northerly toward +z (south), an easterly toward -x', () => {
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
    expect(near(downwindOf(flagWindYaw(270)), [1, 0])).toBe(true);
    expect(near(downwindOf(flagWindYaw(0)), [0, 1])).toBe(true);
    expect(near(downwindOf(flagWindYaw(90)), [-1, 0])).toBe(true);
    /* the flags' default wind -- no weather yet, yaw 0 -- is a westerly at the reference speed */
    const air = stepAir(createAir(), 1 / 60, { ms: null, yaw: 0 });
    expect([air.axisX, air.axisZ]).toEqual([1, -0]);
    expect(air.ms).toBe(FLAG_DEFAULT_MS);
    expect(air.sway).toBe(1);
  });
  it('sways as drawn at the reference wind, a fifth of it in calm air, and no more than 2.2 times in a gale', () => {
    expect(swayStrength(ONE_WIND.referenceMs)).toBe(1);
    expect(swayStrength(0)).toBeCloseTo(0.2, 12);
    expect(swayStrength(8)).toBeCloseTo(1.8, 12);
    expect(swayStrength(30)).toBe(2.2);
  });
  it('eases toward a new wind as a vector, in about three seconds, and turns the axis with it', () => {
    const air = run(createAir(), 1, wind(270, 4));
    run(air, 3, wind(0, 8));
    /* one time constant: the velocity has come 63% of the way from (4, 0) to (0, 8) */
    expect(air.x).toBeCloseTo(4 * Math.exp(-1), 1);
    expect(air.z).toBeCloseTo(8 * (1 - Math.exp(-1)), 1);
    run(air, 30, wind(0, 8));
    expect(air.axisX).toBeCloseTo(0, 3);
    expect(air.axisZ).toBeCloseTo(1, 3);
    expect(air.ms).toBeCloseTo(8, 3);
  });
  it('passes a reversal through calm rather than swinging the air round', () => {
    const air = run(createAir(), 10, wind(270, 6));
    let slowest = Infinity;
    for (let t = 0; t < 12; t += 1 / 60) { stepAir(air, 1 / 60, wind(90, 6)); slowest = Math.min(slowest, air.ms); }
    expect(slowest).toBeLessThan(0.3);
    expect(air.axisX).toBeCloseTo(-1, 3);
  });
  it('carries the gusts with the air, the cloud shadows at 1.5 times its speed, and the sky at its preset speed', () => {
    const air = run(createAir(), 1, wind(270, 4), { skySpeed: 0.001, cloudPeriod: 4096 });
    const before = { ...air };
    run(air, 10, wind(270, 4), { skySpeed: 0.001, cloudPeriod: 4096 });
    const moved = (a, b, period) => ((a - b) % period + period) % period;
    expect(moved(air.gustX, before.gustX, ONE_WIND.gustPeriod)).toBeCloseTo(40, 0);
    expect(moved(air.cloudX, before.cloudX, 4096)).toBeCloseTo(60, 0);
    /* at the reference wind the sky runs exactly at its preset speed, as before, but downwind */
    expect(air.skyRun - before.skyRun).toBeCloseTo(0.01, 4);
    expect(air.skyX - before.skyX).toBeCloseTo(0.01, 4);
    expect(Math.abs(air.skyY - before.skyY)).toBeLessThan(1e-9);
    /* a gale drives the sky three times as fast at most, a calm at a quarter */
    const gale = run(createAir(), 1, wind(270, 40), { skySpeed: 0.001 });
    const calm = run(createAir(), 1, wind(270, 0.1), { skySpeed: 0.001 });
    expect(gale.skyRun).toBeCloseTo(0.003, 4);
    expect(calm.skyRun).toBeCloseTo(0.00025, 5);
  });
  it('keeps its offsets inside their periods, so they never lose precision', () => {
    const air = run(createAir(), 600, wind(250, 12), { cloudPeriod: 4096 });
    for (const v of [air.gustX, air.gustZ]) expect(v >= 0 && v < ONE_WIND.gustPeriod).toBe(true);
    for (const v of [air.cloudX, air.cloudZ]) expect(v >= 0 && v < 4096).toBe(true);
  });
  it('holds still for reduced motion: no sway, and nothing carried', () => {
    const air = run(createAir(), 2, wind(270, 5), { skySpeed: 0.001, cloudPeriod: 4096 });
    const held = { ...air };
    run(air, 5, wind(270, 5), { still: true, skySpeed: 0.001, cloudPeriod: 4096 });
    expect(air.sway).toBe(0);
    for (const key of ['gustX', 'gustZ', 'cloudX', 'cloudZ', 'skyX', 'skyY', 'skyRun']) expect(air[key]).toBe(held[key]);
  });
  it('is pinned under det=1: the target wind at once, and nothing carried', () => {
    const air = run(createAir(), 3, wind(180, 7), { deterministic: true, skySpeed: 0.001, cloudPeriod: 4096 });
    expect(air.ms).toBeCloseTo(7, 12);
    expect(air.axisX).toBeCloseTo(0, 12);
    expect(air.axisZ).toBeCloseTo(-1, 12);
    expect(air.sway).toBe(swayStrength(7));
    for (const key of ['gustX', 'gustZ', 'cloudX', 'cloudZ', 'skyX', 'skyY', 'skyRun']) expect(air[key]).toBe(0);
  });
  it('lays gusts as patches, even on average and repeating every 400 m both ways so the offset can wrap', () => {
    let sum = 0, n = 0, lo = 1, hi = 0;
    for (let z = 0; z < 400; z += 7) for (let x = 0; x < 400; x += 7) {
      const g = gustAt(x, z);
      expect(Math.abs(g - gustAt(x + 400, z))).toBeLessThan(1e-9);
      expect(Math.abs(g - gustAt(x, z - 400))).toBeLessThan(1e-9);
      sum += g; n++; lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.95);
  });
  it('is stepped every frame from the flags\' wind in main.js, and carries the trees, reeds and sky there', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/stepAir\(AIR, dt, lightWind\(FLAG_WIND, preset\.wind\), \{ deterministic: DET, still: cameraMotionPreference\.matches/);
    expect(main).toMatch(/applyAir\(AIR\)/);
    expect(main).toMatch(/poseFlagCloths\(dt\);\n  stepOneAir\(dt\);/);
    expect(main).toMatch(/swayOnWind\(\{ p: wp, weight, rate: 1\.35, swing: treeSwing\(LOCAL_HEIGHT\)/);
    expect(main).toMatch(/swayOnWind\(\{ p: wp, weight, rate: 2\.2, scale: 2, swing: reedSwing/);
    expect(main).toMatch(/drift: ONE_WIND_ON \? skyDrift : null/);
  });
});

describe('a light\'s own wind', () => {
  const storm = paintedAtmosphere('storm', ATMOSPHERE_PRESETS.storm).wind;
  it('brings the storm\'s gale into the air when the weather\'s wind is weaker, from where it blew', () => {
    expect(storm).toEqual({ ms: 12, gust: 18 });
    const live = { fromDeg: 200, ms: 3, gust: 5, source: 'open-meteo', yaw: flagWindYaw(200) };
    expect(lightWind(live, storm)).toEqual({ ...live, ms: 12, gust: 18 });
    /* the default breeze, before any reading: 4 m/s from the west */
    expect(lightWind({ fromDeg: null, ms: null, gust: null, source: 'default', yaw: 0 }, storm)).toMatchObject({ ms: 12, gust: 18, yaw: 0 });
    /* a real gale already stronger is kept, and a stronger gust too */
    const gale = { fromDeg: 250, ms: 15, gust: 24, source: 'open-meteo', yaw: flagWindYaw(250) };
    expect(lightWind(gale, storm)).toBe(gale);
    expect(lightWind({ ...gale, ms: 14, gust: 10 }, storm)).toMatchObject({ ms: 14, gust: 18 });
  });
  it('keeps a wind asked for with ?vind=, and leaves every other light\'s wind alone', () => {
    const asked = { fromDeg: 270, ms: 2, gust: null, source: 'url', yaw: flagWindYaw(270) };
    expect(lightWind(asked, storm)).toBe(asked);
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      if (name === 'storm') continue;
      const wind = { fromDeg: 90, ms: 1, gust: null, source: 'open-meteo', yaw: flagWindYaw(90) };
      expect(lightWind(wind, paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]).wind), name).toBe(wind);
    }
    /* ?lights=before: the storm without its wind */
    expect(paintedAtmosphere('storm', ATMOSPHERE_PRESETS.storm, { before: true }).wind).toBeUndefined();
  });
  it('is what the air and the flags answer in main.js, while the Kikaren reads the weather itself', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const wind = lightWind\(FLAG_WIND, preset\.wind\);\n  for \(const p of pins\) \{\n    const s = stepFlagMotion\(p\.cs, dt, wind, DET\);/);
    expect(main).toMatch(/windAlong\(bTo\(p\), wx\.windFromDeg, wx\.windMs\)/);
  });
});
