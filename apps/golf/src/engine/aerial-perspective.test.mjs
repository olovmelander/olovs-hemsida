import { describe, expect, it } from 'vitest';
import { Color, FogExp2 } from 'three/webgpu';
import { createAerialPerspective } from './aerial-perspective.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';

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
      expect(aerial.snapshot()).toEqual({ colour: p.fog, density: p.dens, maximum: p.hazeMax });
    }
    fog.color.setHex(0x718296);
    expect(aerial.snapshot().colour).toBe(0x718296);
  });
});
