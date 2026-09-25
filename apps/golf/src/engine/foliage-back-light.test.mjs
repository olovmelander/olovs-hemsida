/* The sun through the leaves: a crown glows at its edge against a low sun, in
   the presets that have one, meshes and impostors alike; ?backlight=0 builds
   the crown colour exactly as before. */
import { describe, expect, it } from 'vitest';
import { Color, Texture } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { foliageBack, makeGhibliFoliageMaterial, paintedFoliageColour, setFoliageLighting } from './ghibli-foliage-material.mjs';

describe('the back-lit crown', () => {
  it('takes the low sun\'s colour at golden hour, the midnight sun, dawn and autumn, and nothing otherwise', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
      setFoliageLighting(p);
      const lit = ['golden', 'midnight', 'dawn', 'host'].includes(name);
      expect(foliageBack.value.getHex() > 0, name).toBe(lit);
      if (lit) {
        const sun = new Color(p.sun);
        for (const c of ['r', 'g', 'b']) expect(foliageBack.value[c], name).toBeCloseTo(sun[c] * p.foliage.back, 6);
        /* a rim, not a second sun: at most half the sun's colour */
        expect(p.foliage.back, name).toBeLessThanOrEqual(0.5);
      }
    }
    /* strongest in the lowest, warmest light */
    const back = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]).foliage.back;
    expect(back('golden')).toBeGreaterThan(back('dawn'));
  });
  it('builds the before when asked, and a different graph with the glow', () => {
    const args = { key: 'gran', normal: vec3(0, 1, 0), sunDirection: uniform(vec3(0, 0.2, 1)), tint: vec3(1), seed: float(0.5) };
    const before = paintedFoliageColour(args), withGlow = paintedFoliageColour({ ...args, backLight: float(0.5) });
    expect(before.isNode && withGlow.isNode).toBe(true);
    const map = new Texture();
    const plain = makeGhibliFoliageMaterial({ key: 'gran', map, sunDirection: uniform(vec3(0, 0.2, 1)), tint: vec3(1), seed: float(0.5), autumn: float(0), backLight: false });
    const glowing = makeGhibliFoliageMaterial({ key: 'gran', map, sunDirection: uniform(vec3(0, 0.2, 1)), tint: vec3(1), seed: float(0.5), autumn: float(0) });
    expect(plain.colorNode).not.toBe(glowing.colorNode);
    expect(plain.vertexColors && glowing.vertexColors).toBe(true);
  });
});
