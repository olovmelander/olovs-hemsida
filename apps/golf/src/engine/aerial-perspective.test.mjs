import { describe, expect, it } from 'vitest';
import { Color, FogExp2 } from 'three/webgpu';
import { createAerialPerspective } from './aerial-perspective.mjs';
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
