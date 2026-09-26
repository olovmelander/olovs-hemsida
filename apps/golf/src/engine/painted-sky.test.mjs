/* The clouds lit by the sun (painted-sky.mjs sunLit, docs/visual-clouds-2026-09-26.md):
   each light with a sun and clouds lights them at its share, shading their bases
   and far flanks in its own base colour -- darker than the lit paint and apart
   from the sky's blue, never brighter than the paint the glow's thresholds stand
   above -- and the sky reports what it draws; without the switch the sky is the
   before. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { CLOUD_SUN } from './painted-sky.mjs';
import { createAtmosphericSky, setAtmospherePreset, atmosphereState } from './atmospheric-sky.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { glowThresholdOf, luminanceOf, skyPaintCeiling } from './glow.mjs';
import { cloudShadowOf } from './cloud-shadow.mjs';

const LIGHTS = Object.keys(ATMOSPHERE_PRESETS);
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);

describe('the clouds lit by the sun', () => {
  it('light every sky with a sun and clouds, each in its own base colour, and none without', () => {
    for (const name of LIGHTS) {
      const p = painted(name);
      /* a sun and clouds: the lights whose clouds cast shadows (the summer day has none, blue hour's sun has set) */
      if (cloudShadowOf(p).opacity > 0) {
        expect(p.skyCloudSun, name).toBe(1);
        const base = new Color(p.skyCloudBase), lit = new Color(p.skyCloudLit ?? 0xfff5df), zenith = new Color(p.skyZenith);
        /* the base is the shaded side of the lit paint: darker */
        expect(luminanceOf(base), name).toBeLessThan(luminanceOf(lit) * 0.75);
        /* and a lavender or grey the sky's blue does not swallow: far less blue for its red than the zenith (linear) */
        expect(base.b / base.r, name).toBeLessThan(1.6);
        expect(base.b / base.r, name).toBeLessThan(zenith.b / zenith.r * 0.85);
        /* never brighter than the sky's paint the glow's threshold stands above, at the sky's exposure */
        expect(luminanceOf(base) * (p.paintedSkyExposure ?? 1), name).toBeLessThan(glowThresholdOf(p));
        expect(luminanceOf(base) * (p.paintedSkyExposure ?? 1), name).toBeLessThan(skyPaintCeiling(p, new Color(p.fog)));
      } else {
        expect(p.skyCloudSun, name).toBeUndefined();
        expect(p.skyCloudBase, name).toBeUndefined();
      }
    }
  });

  it('keep every cloud colour between the base and the lit paint: the lit paint stays the brightest', () => {
    /* the darkest a cloud goes, and the lining, are shares of the way from the base to the lit paint */
    expect(CLOUD_SUN.floor).toBeGreaterThan(0);
    expect(CLOUD_SUN.floor).toBeLessThan(0.5);
    expect(CLOUD_SUN.backlit).toBeGreaterThan(0);
    expect(CLOUD_SUN.backlit).toBeLessThan(1);
    expect(CLOUD_SUN.belly).toBeLessThan(0.5);
    /* the lining lies inside the cloud's soft edge (the field's coverage ramp, painted-sky.mjs, is 0.105 wide) */
    expect(CLOUD_SUN.lining[0]).toBeGreaterThan(0);
    expect(CLOUD_SUN.lining[0]).toBeLessThan(0.105);
    expect(CLOUD_SUN.lining[1]).toBeGreaterThan(0.105);
    const source = fs.readFileSync(new URL('./painted-sky.mjs', import.meta.url), 'utf8');
    /* the lit colour is mixed from the base toward the lit paint, and the lining toward the lit paint alone */
    expect(source).toMatch(/cloud=mix\(cloud,mix\(cloudBase,cloudLit,mix\(float\(CLOUD_SUN\.floor\),float\(1\),sunLight\)\),cloudSun\);/);
    expect(source).toMatch(/if\(lining\)cloud=mix\(cloud,cloudLit,lining\);/);
    /* near the sun the clouds keep their lit paint, so the glow's shine is what crosses the threshold there */
    expect(source).toMatch(/const sunLight=mix\(shaded,float\(1\),sunward\.mul\(sunward\)\);/);
    /* the before, without the switch: the noise's own light and shade, as main drew it */
    expect(source).toMatch(/let cloud=mix\(cloudShade,cloudLit,light\.mul\(\.65\)\.add\(\.35\)\),lining=null;\n\s+if\(sunLit\)\{/);
    expect(source).toMatch(/\n\s+\}\n\s+cloud=mix\(cloud,cloudLit,glow\.mul\(\.6\)\);/);
  });

  it('are set by the preset and reported by the sky, and a sky without them draws none', () => {
    const lit = createAtmosphericSky({ painted: true, deterministic: true, sunLit: true });
    const plain = createAtmosphericSky({ painted: true, deterministic: true });
    for (const name of LIGHTS) {
      const p = painted(name);
      setAtmospherePreset(lit, p); setAtmospherePreset(plain, p);
      expect(atmosphereState(lit), name).toMatchObject({ sunLit: true, cloudSun: p.skyCloudSun ?? 0,
        cloudBase: p.skyCloudBase ?? p.skyCloudShade ?? 0xa5b5c6 });
      expect(atmosphereState(plain), name).toMatchObject({ sunLit: false, cloudSun: 0 });
    }
  });

  it('are wired in main.js behind their before', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/sunLit: new URLSearchParams\(location\.search\)\.get\('cloudlight'\) !== '0' \}\);/);
    expect(main.match(/createAtmosphericSky\(/g)).toHaveLength(1);
  });
});
