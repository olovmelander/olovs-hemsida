import { describe, expect, it } from 'vitest';
import { Color, FogExp2 } from 'three/webgpu';
import fs from 'node:fs';
import { createAerialPerspective, glazeOf, GLAZE, valleyMistAmount, valleyMistBase, valleyMistOf, VALLEY_MIST } from './aerial-perspective.mjs';
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

describe('the light\'s glaze on the land', () => {
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  /* the glaze as the fog node lays it, on the CPU: a share of the colour to the tint at its luminance, giving way when bright */
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const glazed = (c, { tint, amount }) => {
    const l = lum(c), a = amount * (1 - smooth(GLAZE.bright[0], GLAZE.bright[1], l));
    return new Color(c.r + (tint.r * l - c.r) * a, c.g + (tint.g * l - c.g) * a, c.b + (tint.b * l - c.b) * a);
  };
  const GLAZED = ['bluehour', 'storm', 'dawn', 'midnight'];
  it('is laid in the blue hour, the storm, dawn and the midnight sun alone, and in none before the audit', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const g = glazeOf(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]));
      if (GLAZED.includes(name)) { expect(g.amount, name).toBeGreaterThan(0.1); expect(g.amount, name).toBeLessThan(0.5); }
      else expect(g.amount, name).toBe(0);
      expect(glazeOf(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name], { before: true })).amount, name).toBe(0);
    }
  });
  it('keeps a colour\'s brightness, and lays each light\'s colour: the blue hour\'s blue-grey, the storm\'s grey, dawn\'s rose, the midnight sun\'s gold', () => {
    const turf = new Color(0x4a7827);
    for (const name of GLAZED) {
      const g = glazeOf(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]));
      expect(lum(g.tint), name).toBeCloseTo(1, 9);
      expect(lum(glazed(turf, g)), name).toBeCloseTo(lum(turf), 9);
    }
    const tint = name => glazeOf(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name])).tint;
    expect(tint('bluehour').b).toBeGreaterThan(tint('bluehour').g); expect(tint('bluehour').g).toBeGreaterThan(tint('bluehour').r);
    for (const c of ['r', 'g', 'b']) expect(tint('storm')[c]).toBeCloseTo(1, 0);
    expect(tint('dawn').r).toBeGreaterThan(tint('dawn').g); expect(tint('dawn').r).toBeGreaterThan(tint('dawn').b);
    expect(tint('midnight').r).toBeGreaterThan(tint('midnight').g); expect(tint('midnight').g).toBeGreaterThan(tint('midnight').b);
    /* dawn's is rose, the midnight sun's gold: dawn's blue lies far nearer its green */
    expect(tint('dawn').g / tint('dawn').b).toBeLessThan(0.7 * tint('midnight').g / tint('midnight').b);
    /* the blue hour's turf goes from grass green to a cool blue-grey-green, its green share cut */
    const t = glazed(turf, glazeOf(paintedAtmosphere('bluehour', ATMOSPHERE_PRESETS.bluehour)));
    expect(t.b / t.g).toBeGreaterThan(2 * turf.b / turf.g);
  });
  it('gives way over bright colours: lamps pushed past white keep their own', () => {
    const g = glazeOf(paintedAtmosphere('bluehour', ATMOSPHERE_PRESETS.bluehour)), lamp = new Color(6, 0.48, 0.4);
    expect(glazed(lamp, g).toArray()).toEqual(lamp.toArray());
    expect(glazed(new Color(0, 0, 0), g).toArray()).toEqual([0, 0, 0]);
  });
  it('is none without a glaze: the colour is the land\'s own, and set on the aerial perspective from the preset', () => {
    const none = glazeOf({});
    expect(none.amount).toBe(0);
    const turf = new Color(0x4a7827);
    expect(glazed(turf, none).toArray()).toEqual(turf.toArray());
    const aerial = createAerialPerspective(new FogExp2(0xffffff, 0.0003));
    aerial.setPreset(paintedAtmosphere('storm', ATMOSPHERE_PRESETS.storm));
    expect(aerial.snapshot().glaze.amount).toBeCloseTo(0.35, 9);
    aerial.setPreset(paintedAtmosphere('noon', ATMOSPHERE_PRESETS.noon));
    expect(aerial.snapshot().glaze.amount).toBe(0);
    const source = fs.readFileSync(new URL('./aerial-perspective.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/vec4\(mix\(glazeColour\(output\.rgb, glazeTint, glazeAmount\), hazeColour, amount\), output\.a\)/);
  });
});
