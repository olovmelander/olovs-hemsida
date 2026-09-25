/* The glow at a low sun: each low-sun preset's threshold sits just above its
   sky's broad paint -- its clouds, its clear sky and the haze its horizon fades
   into -- so none of that glows; toward the sun the clouds' centres shine past
   it in the sun glow's colour; the other lights keep 0.86; main.js sets it all
   per preset, and the befores restore the one threshold and the flat paint. */
import fs from 'node:fs';
import { Color } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { GLOW, glowThresholdOf, cloudGlowOf, skyPaintCeiling, shiningCloudAtSun } from './glow.mjs';
import { createAtmosphericSky, setAtmospherePreset, atmosphereState } from './atmospheric-sky.mjs';

const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
/* the fog as main.js setPreset leaves it */
const finalFog = p => new Color(p.fog).lerp(new Color(p.paintedFog), 0.22);
const LOW_SUN = ['golden', 'dawn', 'midnight', 'host'];

describe('the glow at a low sun', () => {
  it('keeps every preset\'s broad sky paint under its threshold: clouds, clear sky and haze do not glow', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = painted(name), ceiling = skyPaintCeiling(p, finalFog(p));
      /* noon's white clouds are the one broad paint over 0.86, as they always were: a faint glow */
      if (name === 'noon') { expect(ceiling).toBeGreaterThan(GLOW.threshold); continue; }
      expect(glowThresholdOf(p) - ceiling).toBeGreaterThanOrEqual(GLOW.margin);
    }
  });
  it('lowers a low sun\'s threshold to just above that paint, and keeps 0.86 for the other lights', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = painted(name), threshold = glowThresholdOf(p);
      if (!LOW_SUN.includes(name)) { expect(threshold).toBe(GLOW.threshold); continue; }
      expect(threshold).toBeLessThanOrEqual(GLOW.threshold);
      expect(threshold - skyPaintCeiling(p, finalFog(p))).toBeLessThan(0.05);
    }
    /* autumn's clouds are nearly as white as noon's: it keeps 0.86 */
    expect(['golden', 'dawn', 'midnight', 'host'].map(n => glowThresholdOf(painted(n)))).toEqual([0.70, 0.60, 0.50, 0.86]);
  });
  it('shines the clouds\' centres toward a low sun into the knee, in the sun glow\'s colour, and nowhere else', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = painted(name), glow = cloudGlowOf(p);
      if (!LOW_SUN.includes(name)) { expect(glow.toArray()).toEqual([0, 0, 0]); continue; }
      /* at the sun the shining centre is past the threshold, more than half way through the knee and not beyond it */
      const into = (shiningCloudAtSun(p) - glowThresholdOf(p)) / GLOW.knee;
      expect(into).toBeGreaterThan(0.5);
      expect(into).toBeLessThan(1);
      /* in the sun glow's hue, so it stays warm under ACES */
      const sun = new Color(p.skySunGlow);
      expect(glow.g / glow.r).toBeCloseTo(sun.g / sun.r, 6);
      expect(glow.b / glow.r).toBeCloseTo(sun.b / sun.r, 6);
    }
  });
  it('gives the painted sky its shine per preset, and none for the before', () => {
    const sky = createAtmosphericSky({ painted: true, deterministic: true });
    setAtmospherePreset(sky, painted('golden'));
    expect(atmosphereState(sky).cloudGlow).toEqual(cloudGlowOf(painted('golden')).toArray());
    setAtmospherePreset(sky, { ...painted('golden'), skyCloudGlow: 0 });
    expect(atmosphereState(sky).cloudGlow).toEqual([0, 0, 0]);
    setAtmospherePreset(sky, painted('noon'));
    expect(atmosphereState(sky).cloudGlow).toEqual([0, 0, 0]);
    /* on the clouds alone: the clear sky and the haze band keep their paint */
    const shader = fs.readFileSync(new URL('./painted-sky.mjs', import.meta.url), 'utf8');
    expect(shader).toMatch(/const shining=cloud\.mul\(cloudGlow\.mul\(sunward\.mul\(sunward\)\.mul\(centre\)\)\.add\(1\)\);/);
    expect(shader).toMatch(/const painted=mix\(clear,shining,coverage\)\.mul\(exposure\);/);
  });
  it('is wired in main.js: the threshold per preset, both befores, and the one pipeline', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/renderer\.__bloomNode\.threshold\.value = GLOW_THRESHOLD_ON \? glowThresholdOf\(p\) : GLOW\.threshold;/);
    expect(main).toMatch(/const GLOW_THRESHOLD_ON = new URLSearchParams\(location\.search\)\.get\('glowthreshold'\) !== '0';/);
    expect(main).toMatch(/const CLOUD_GLOW_ON = new URLSearchParams\(location\.search\)\.get\('cloudglow'\) !== '0';/);
    /* the shine feeds the glow: none without the bloom, at low quality or after the runtime drop */
    expect(main).toMatch(/\.\.\.\(CLOUD_GLOW_ON && !LOWQ && !lowfx \? \{\} : \{ skyCloudGlow: 0 \}\)/);
    expect(main).toMatch(/renderer\.__bloomNode\.strength\.value = 0;\n\s+\/\*[^*]*\*\/\n\s+setAtmospherePreset\(skyMesh, skyPreset\(preset, presetName\)\);/);
    expect(main).toMatch(/bloom\(sceneColor, 0\.14, GLOW\.radius, GLOW\.threshold\)/);
    expect(main).toMatch(/smoothWidth\.value = GLOW\.knee/);
    /* the glow is high quality's alone: the low-quality renderer builds no bloom */
    expect(main).toMatch(/if \(!LOWQ && new URLSearchParams\(location\.search\)\.get\('post'\) !== '0'\) \{\n  const \{ bloom \}/);
  });
});
