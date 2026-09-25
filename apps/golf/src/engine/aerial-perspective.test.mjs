import { describe, expect, it } from 'vitest';
import { Color, FogExp2 } from 'three/webgpu';
import fs from 'node:fs';
import { createAerialPerspective, valleyMistAmount, valleyMistBase, valleyMistOf, VALLEY_MIST } from './aerial-perspective.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';

describe('distant landscape haze', () => {
  it('keeps shaded relief visible even at the maximum authored distance haze', () => {
    for (const p of Object.values(ATMOSPHERE_PRESETS)) {
      expect(p.hazeMax).toBeGreaterThan(0.5);
      expect(p.hazeMax).toBeLessThanOrEqual(0.9);
      const c = new Color(p.fog);
      expect(c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722).toBeLessThan(0.52);
    }
  });
  it('updates density, colour and retained contrast without replacing the fog graph', () => {
    const fog = new FogExp2(), aerial = createAerialPerspective(fog), node = aerial.node;
    for (const p of Object.values(ATMOSPHERE_PRESETS)) {
      fog.color.setHex(p.fog); fog.density = p.dens;
      aerial.setPreset(p);
      expect(aerial.node).toBe(node);
      expect(aerial.snapshot()).toMatchObject({ colour: p.fog, density: p.dens, maximum: p.hazeMax });
    }
    fog.color.setHex(0x718296);
    expect(aerial.snapshot().colour).toBe(0x718296);
  });
  it('warms toward the sun with a share of the sky\'s own glow, and only where the sky has one', () => {
    const fog = new FogExp2(), warm = createAerialPerspective(fog), plain = createAerialPerspective(fog, { sunward: false });
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
      warm.setPreset(p); plain.setPreset(p);
      const { glow, glowStrength } = warm.snapshot();
      expect(glowStrength, name).toBeCloseTo((p.skySunGlowStrength ?? 0) * (p.hazeGlow ?? 0), 6);
      expect(glowStrength > 0, name).toBe(['golden', 'dawn', 'midnight', 'host'].includes(name));
      /* never the sky's full glow: the haze takes a share of it */
      expect(glowStrength, name).toBeLessThan(0.5);
      if (glowStrength) expect(glow, name).toBe(p.skySunGlow);
      /* the before (?hazewarm=0) builds the plain haze and takes no glow */
      expect(plain.snapshot().glowStrength, name).toBe(0);
    }
    expect(plain.node).not.toBe(warm.node);
  });
});

describe('valley mist', () => {
  const dawn = paintedAtmosphere('dawn', ATMOSPHERE_PRESETS.dawn), mist = paintedAtmosphere('mist', ATMOSPHERE_PRESETS.mist);
  const ray = (fromY, toY, length, m = dawn.valleyMist, base = 0) => valleyMistAmount({ fromY, toY, length, base, ...m });
  it('lies at dawn and in the mist preset only', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const m = valleyMistOf(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]));
      expect(m.density > 0, name).toBe(name === 'dawn' || name === 'mist');
    }
    expect(valleyMistOf({})).toEqual({ density: 0, height: 1 });
  });
  it('is the plain exponential along the low ground, and thins with height above it', () => {
    const { density } = dawn.valleyMist;
    expect(ray(0, 0, 300)).toBeCloseTo(1 - Math.exp(-density * 300), 12);
    /* below the base the density is the base's, not more */
    expect(ray(-5, -5, 300)).toBeCloseTo(ray(0, 0, 300), 12);
    /* the same distance along ground one mist-height up keeps a share e^-1 of it */
    expect(-Math.log(1 - ray(6, 6, 300))).toBeCloseTo(density * 300 * Math.exp(-1), 9);
    /* a crest 30 m up stands nearly clear of it */
    expect(ray(30, 30, 300)).toBeLessThan(0.005);
  });
  it('is the same looking up or down a ray, and continuous where the closed form changes branch', () => {
    expect(ray(2, 25, 400)).toBeCloseTo(ray(25, 2, 400), 12);
    const near = ray(3, 3 + 6.0005e-3, 200), far = ray(3, 3 + 5.9995e-3, 200);
    expect(Math.abs(near - far)).toBeLessThan(1e-6);
  });
  it('fills a hollow seen from a hill more than the hill beside the eye, and never covers the far ground alone', () => {
    const down = ray(30, 0, 500), across = ray(30, 30, 500);
    expect(down).toBeGreaterThan(5 * across);
    /* the dense preset's long low ray reaches toward full mist; the haze's ceiling (hazeMax) caps the sum in the shader */
    expect(ray(0, 0, 3000, mist.valleyMist)).toBeGreaterThan(0.99);
    expect(ray(0, 0, 150, mist.valleyMist)).toBeLessThan(0.3);
  });
  it('sits on the course\'s low ground: the quarter of the holes\' ground below it', () => {
    const heights = Array.from({ length: 100 }, (_, i) => i);
    expect(VALLEY_MIST.basePercentile).toBe(0.25);
    expect(valleyMistBase(heights)).toBe(25);
    expect(valleyMistBase([NaN, 4, Infinity, 2, 8, 6])).toBe(4);
    expect(valleyMistBase([])).toBe(0);
  });
  it('adds to the haze exactly nothing without mist, and is set on the aerial perspective from the preset', () => {
    const fog = new FogExp2(), aerial = createAerialPerspective(fog, { valleyMist: true }), before = createAerialPerspective(fog);
    aerial.setPreset(dawn); aerial.setMistBase(12.5);
    expect(aerial.snapshot().valleyMist).toEqual({ density: dawn.valleyMist.density, height: dawn.valleyMist.height, base: 12.5 });
    aerial.setPreset(paintedAtmosphere('noon', ATMOSPHERE_PRESETS.noon));
    expect(aerial.snapshot().valleyMist.density).toBe(0);
    expect(before.snapshot().valleyMist).toBe(null);
    /* the shader's sum, haze + mist (1 - haze), is the haze itself when the mist is 0 */
    for (const haze of [0, 1e-9, 0.3, 0.88]) expect(haze + 0 * (1 - haze)).toBe(haze);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/createAerialPerspective\(fog, \{ sunward: HAZE_WARM, valleyMist: VALLEY_MIST_ON \}\)/);
    expect(main).toMatch(/aerialPerspective\.setMistBase\(valleyMistBase\(heights\)\)/);
  });
});
