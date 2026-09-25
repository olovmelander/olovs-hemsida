/* Nordic lake water: the sun's road is the dabs' own expectation over the ripple
   map, measured on the map itself; the far shore's wood is dark and hazed; the
   water drifts with the one wind, with its chop and patches, and holds still
   when the air does; main.js draws all of it, and only on the water. */
import fs from 'node:fs';
import { Color } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { flagWindYaw } from './flag-motion.mjs';
import { createAir, stepAir } from './one-wind.mjs';
import { fillWaterNormalPixels } from './water-normal-texture.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { NORDIC_WATER, SLOPE_SCALE, expectedGlitterAt, treeLineColour, setNordicWaterPreset, waterSun, waterSkyGlowStrength,
  waterChopFor, createWaterMotion, stepWaterMotion, patchChopOf, waterPatchMean } from './nordic-water.mjs';
import { cloudPatternTexture } from './cloud-shadow.mjs';

const S = 512, ripples = fillWaterNormalPixels(new Uint8ClampedArray(S * S * 4), S, { seamless: true });
const tex = (u, v) => { const x = ((Math.floor(u * S) % S) + S) % S, y = ((Math.floor(v * S) % S) + S) % S, k = (y * S + x) * 4; return [ripples[k] / 255 - 0.5, ripples[k + 1] / 255 - 0.5]; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wind = (fromDeg, ms) => ({ ms, yaw: flagWindYaw(fromDeg) });
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);

describe('Nordic lake water', () => {
  it('knows the ripple map\'s own spread of slopes', () => {
    let sxx = 0, syy = 0;
    for (let k = 0; k < S * S; k++) { const x = ripples[k * 4] / 255 - 0.5, y = ripples[k * 4 + 1] / 255 - 0.5; sxx += x * x; syy += y * y; }
    expect(Math.sqrt(sxx / (S * S))).toBeCloseTo(NORDIC_WATER.slopeSpread[0], 3);
    expect(Math.sqrt(syy / (S * S))).toBeCloseTo(NORDIC_WATER.slopeSpread[1], 3);
  });
  it('lays the sun\'s road as the dabs lie on average over the ripples, from calm to a gale', () => {
    /* the dabs main.js draws, over the four layers at random places on the map, against the road's form */
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cases = [];
    for (const [weights, amp] of [[[0.30, 0.7, 0.16, 0.9], 0.38], [[0.30, 0.7, 0.16, 0.9], 1], [[0.75, 0.7, 0.46, 0.9], 1], [[0.30, 0.7, 0.16, 0.9], 1.6]]) {
      const sigma = Math.sqrt(weights.reduce((a, w) => a + w * w, 0)) * amp * 0.55 * SLOPE_SCALE;
      for (const tilt of [0, 4, 7, 10, 14]) {
        const b = tilt * Math.PI / 180;
        let sum = 0;
        for (let s = 0; s < 20000; s++) {
          let rx = 0, ry = 0;
          for (const w of weights) { const [x, y] = tex(rnd(), rnd()); rx += x * w; ry += y * w; }
          const nx = rx * amp * 0.55, nz = ry * amp * 0.55, l = Math.hypot(nx, 1, nz), az = rnd() * 2 * Math.PI;
          sum += smooth(0.985, 0.996, Math.max(0, (nx * Math.sin(b) * Math.cos(az) + Math.cos(b) + nz * Math.sin(b) * Math.sin(az)) / l));
        }
        cases.push({ sigma, tilt, measured: sum / 20000, road: expectedGlitterAt(sigma, Math.tan(b)) });
      }
    }
    for (const c of cases) expect(Math.abs(c.road - c.measured), JSON.stringify(c)).toBeLessThan(0.06);
  });
  it('widens and dims the road as the water roughens, and leaves the water dark beside it', () => {
    const calm = 0.04, gale = 0.15;
    expect(expectedGlitterAt(calm, 0)).toBeGreaterThan(expectedGlitterAt(gale, 0));
    expect(expectedGlitterAt(gale, 0.22)).toBeGreaterThan(expectedGlitterAt(calm, 0.22));
    for (const sigma of [calm, 0.09, gale]) {
      let last = Infinity;
      for (let t = 0; t <= 0.6; t += 0.02) { const g = expectedGlitterAt(sigma, t); expect(g).toBeLessThanOrEqual(last + 1e-12); last = g; }
      expect(expectedGlitterAt(sigma, 0.6)).toBe(0);
    }
  });
  it('sets the far shore\'s wood dark and green, and hazier in thicker air', () => {
    for (const name of ['noon', 'golden', 'dawn', 'mist']) {
      const p = painted(name), fogColour = new Color(p.paintedFog ?? p.fog);
      const clear = treeLineColour(p, { fogColour, fogDensity: 0.0002, hazeMax: p.hazeMax });
      const thick = treeLineColour(p, { fogColour, fogDensity: 0.0012, hazeMax: p.hazeMax });
      const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(lum(clear), name).toBeLessThan(0.6 * lum(fogColour));
      expect(clear.g, name).toBeGreaterThan(clear.r);
      expect(Math.abs(lum(thick) - lum(fogColour)), name).toBeLessThan(Math.abs(lum(clear) - lum(fogColour)));
    }
  });
  it('takes the sun\'s colour at full brightness and the sky\'s own glow', () => {
    const golden = painted('golden');
    setNordicWaterPreset(golden, { fogColour: new Color(golden.fog), fogDensity: 0.0003, hazeMax: golden.hazeMax });
    expect(Math.max(...waterSun.value.toArray())).toBeCloseTo(1, 12);
    expect(waterSun.value.b).toBeLessThan(waterSun.value.r);   // a warm road at golden hour
    expect(waterSkyGlowStrength.value).toBe(golden.skySunGlowStrength);
    /* what the sky takes is what the water takes: ?sunglow=0 reaches it through the sky's preset */
    setNordicWaterPreset(painted('dawn'), { sky: { ...painted('dawn'), skySunGlowStrength: 0 }, fogColour: new Color(0xffffff), fogDensity: 0.0003 });
    expect(waterSkyGlowStrength.value).toBe(0);
  });
  it('chops with the wind: 0.45 in calm air, the drawn chop at 4 m/s, at most 1.6', () => {
    expect(waterChopFor(0)).toBeCloseTo(0.45, 12);
    expect(waterChopFor(4)).toBe(1);
    expect(waterChopFor(40)).toBe(1.6);
  });
  it('drifts downwind with the air, the patches at its speed, and holds still with it', () => {
    const air = createAir(), water = createWaterMotion();
    for (let t = 0; t < 10; t += 1 / 60) { stepAir(air, 1 / 60, wind(270, 4)); stepWaterMotion(water, 1 / 60, air); }
    /* a westerly: every layer and the patches drift east (+x); the offsets stay in their periods */
    const all = [...NORDIC_WATER.layers, NORDIC_WATER.foam];
    water.flow.forEach(([u, v], i) => {
      const [scale, gain] = all[i];
      expect(u).toBeCloseTo((4 * gain * scale * 10) % 1, 2);
      expect(u >= 0 && u < 1 && v >= 0 && v < 1).toBe(true);
    });
    expect(water.patch[0]).toBeCloseTo(40, 0);
    expect(Math.abs(water.patch[1])).toBeLessThan(1e-9);
    const held = JSON.stringify(water);
    for (let t = 0; t < 3; t += 1 / 60) { stepAir(air, 1 / 60, wind(270, 4), { still: true }); stepWaterMotion(water, 1 / 60, air, { still: true }); }
    expect(JSON.stringify(water)).toBe(held);
    for (let t = 0; t < 3; t += 1 / 60) { stepAir(air, 1 / 60, wind(270, 9), { deterministic: true }); stepWaterMotion(water, 1 / 60, air, { deterministic: true }); }
    expect(water.flow).toEqual(JSON.parse(held).flow);
    expect(water.chop).toBe(waterChopFor(9));
  });
  it('keeps a lake\'s mean chop the wind\'s: the patches are drawn over their own mean', () => {
    const { bytes } = cloudPatternTexture();
    let sum = 0, calm = 0, gusty = 0;
    for (const b of bytes) { const c = patchChopOf(b / 255) / waterPatchMean(); sum += c; if (c < 0.7) calm++; if (c > 1.2) gusty++; }
    expect(sum / bytes.length).toBeCloseTo(1, 6);
    /* and there are calm patches and gusty ones to see */
    expect(calm / bytes.length).toBeGreaterThan(0.15);
    expect(gusty / bytes.length).toBeGreaterThan(0.15);
  });
  it('is drawn by the water\'s own shading on every sheet, the far shore not on the open sea', () => {
    const shading = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    expect(shading).toMatch(/const drift = \(i, scale, own\) => wind \? wp\.mul\(scale\)\.sub\(waterFlow\[i\]\)/);
    expect((shading.match(/texture\(WATERN, drift\(\d, /g) || []).length).toBe(4);
    expect(shading).toMatch(/texture\(DETAIL, drift\(4, 0\.55,/);
    expect(shading).toMatch(/const patchChop = wind \? waterPatchChop\(\{ p: wp, distance: cd \}\) : null;/);
    expect(shading).toMatch(/mul\(waterChop\)\.mul\(patchChop\)/);
    /* none on the ocean's sheets, nor on the open sea (the water road pass, water-road.mjs) */
    expect(shading).toMatch(/if \(!ocean && !sea\) \{[\s\S]*?skyC = mix\(skyC, waterTreeLine, treeLineShare\(\{ R: Rs, up: saturate\(Rs\.y\) \}\)/);
    expect(shading).toMatch(/expectedGlitter\(\{ V, L: uSun, sigma \}\), dabs,/);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/waterShading\(\{ WATERN, DETAIL, sun: uSun, waterLighting, glint: uWaterGlint, chop: uWaterChop,\n    cloud: CLOUD, ocean, showBed, nordic: NORDIC_WATER_ON, wind: WATER_WIND_ON,\n/);
    expect(main).toMatch(/if \(NORDIC_WATER_ON\) setNordicWaterPreset\(p, \{ sky: skyPreset\(p, presetName\)/);
    expect(main).toMatch(/stepWaterMotion\(WATER_MOTION, dt, AIR, \{ deterministic: DET, still: cameraMotionPreference\.matches \}\)/);
  });
});
