import { describe, expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { ATMOSPHERE_PRESETS as presets } from './atmosphere-presets.mjs';
import { createAtmosphericSky, setAtmospherePreset, atmosphereState } from './atmospheric-sky.mjs';

const luminance = hex => { const c = new Color(hex); return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; };
const fill = p => luminance(p.hemiS) * p.hemiI;

describe('eight atmosphere identities', () => {
  it('uses an overcast, weakly sunlit storm and a brighter diffuse mist', () => {
    expect(presets.storm.cloud).toBeGreaterThanOrEqual(0.95);
    expect(presets.storm.cloudDensity).toBeGreaterThan(presets.noon.cloudDensity);
    expect(presets.storm.int).toBeLessThan(presets.noon.int * 0.2);
    expect(presets.storm.skyRadiance).toBeLessThan(presets.mist.skyRadiance);
    expect(presets.mist.dens).toBeGreaterThan(presets.storm.dens);
  });
  it('puts blue hour after sunset while retaining diffuse light on the course', () => {
    expect(presets.bluehour.dir[1]).toBeLessThan(0);
    expect(presets.bluehour.int).toBeLessThan(0.1);
    expect(fill(presets.bluehour)).toBeGreaterThan(fill(presets.noon) * 0.4);
    const blue = new Color(presets.bluehour.hemiS);
    expect(blue.b).toBeGreaterThan(blue.r);
  });
  it('keeps midnight sun low, with substantially illuminated shadowed ground', () => {
    const p = presets.midnight;
    expect(p.dir[1] / Math.hypot(...p.dir)).toBeGreaterThan(0);
    expect(p.dir[1] / Math.hypot(...p.dir)).toBeLessThan(0.1);
    expect(fill(p)).toBeGreaterThan(fill(presets.noon) * 0.7);
    expect(p.environmentIntensity).toBeGreaterThan(presets.noon.environmentIntensity);
  });
  it('gives all eight modes distinct cloud settings and valid physical inputs', () => {
    expect(Object.keys(presets)).toHaveLength(8);
    const cloudProfiles = new Set();
    for (const p of Object.values(presets)) {
      cloudProfiles.add(JSON.stringify([p.cloud, p.cloudDensity, p.cloudScale, p.cloudElevation]));
      expect(p.cloud).toBeGreaterThanOrEqual(0); expect(p.cloud).toBeLessThanOrEqual(1);
      expect(p.cloudDensity).toBeGreaterThan(0);
      expect(p.cloudScale).toBeGreaterThan(0);
      expect(p.skyRadiance).toBeGreaterThan(0);
      expect(p.exp).toBeGreaterThan(0);
      expect(p.dir.every(Number.isFinite)).toBe(true);
    }
    expect(cloudProfiles.size).toBe(8);
  });
});

describe('atmosphere preset switching', () => {
  it('updates every preset through one sky, material and node graph', () => {
    const sky = createAtmosphericSky({ reversedDepth: true, deterministic: true });
    const material = sky.material, colour = material.colorNode, vertex = material.vertexNode, geometry = sky.geometry;
    try {
      for (const p of Object.values(presets)) {
        setAtmospherePreset(sky, p);
        expect(sky.material).toBe(material); expect(sky.geometry).toBe(geometry);
        expect(material.colorNode).toBe(colour); expect(material.vertexNode).toBe(vertex);
        expect(atmosphereState(sky)).toMatchObject({ cloudSpeed: 0, cloudCoverage: p.cloud, cloudDensity: p.cloudDensity, radiance: p.skyRadiance });
        expect(sky.sunPosition.value.length()).toBeCloseTo(450000);
        expect(material.fog).toBe(false); expect(material.depthWrite).toBe(false);
      }
    } finally { sky.geometry.dispose(); sky.material.dispose(); }
  });
  it('restores live cloud movement when switching between calm and storm', () => {
    const sky = createAtmosphericSky();
    try {
      setAtmospherePreset(sky, presets.mist);
      const calm = atmosphereState(sky).cloudSpeed;
      setAtmospherePreset(sky, presets.storm);
      expect(atmosphereState(sky).cloudSpeed).toBeGreaterThan(calm);
      setAtmospherePreset(sky, presets.mist);
      expect(atmosphereState(sky).cloudSpeed).toBe(calm);
    } finally { sky.geometry.dispose(); sky.material.dispose(); }
  });
});
