/* A cast shadow keeps a share of the sun's strength in the sky's colour: the
   light's shadow node mixes toward a tint, and sun x tint must be the preset's
   sky colour at that share, whatever colour the sun is. Presets without a sun
   of their own keep the plain shadow. */
import { describe, expect, it } from 'vitest';
import { Color, DirectionalLight } from 'three/webgpu';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { createShadowTint, shadowTintFor } from './shadow-tint.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const luminance = c => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const presets = Object.fromEntries(Object.keys(ATMOSPHERE_PRESETS).map(name => [name, paintedAtmosphere(name, ATMOSPHERE_PRESETS[name])]));

describe('the sky-lit shadow tint', () => {
  it('lights a shadow with the preset\'s sky colour at its share of the sun', () => {
    for (const name of ['noon', 'summer', 'golden', 'dawn', 'midnight', 'host']) {
      const p = presets[name], tint = shadowTintFor(p), sun = new Color(p.sun), sky = new Color(p.hemiS);
      expect(p.shadowSky, name).toBeGreaterThan(0);
      for (const channel of ['r', 'g', 'b']) expect(sun[channel] * tint[channel], `${name} ${channel}`).toBeCloseTo(p.shadowSky * sky[channel], 6);
      /* a shade, not a light: never lighter than the sunlit surface beside it in any
         channel, and about a tenth of the sun's light over all */
      for (const channel of ['r', 'g', 'b']) expect(tint[channel], `${name} ${channel}`).toBeLessThan(1);
      const share = luminance(sun.clone().multiply(tint)) / luminance(sun);
      expect(share, name).toBeGreaterThan(0.05);
      expect(share, name).toBeLessThan(0.12);
      /* and cooler than the sun it replaces */
      expect(tint.b, name).toBeGreaterThan(tint.r);
    }
  });
  it('keeps the plain shadow where the preset has no sun of its own', () => {
    for (const name of ['bluehour', 'storm', 'mist']) {
      expect(presets[name].shadowSky, name).toBeUndefined();
      expect(shadowTintFor(presets[name]).getHex(), name).toBe(0);
    }
    expect(shadowTintFor({ sun: 0xffffff, hemiS: 0x8899aa }).getHex()).toBe(0);
  });
  it('writes into the uniform it is given, so a preset change rebuilds nothing', () => {
    const light = new DirectionalLight(0xffffff, 3);
    const { tint, node } = createShadowTint(light);
    const colour = tint.value;
    expect(node.isNode).toBe(true);
    shadowTintFor(presets.golden, tint.value);
    expect(tint.value).toBe(colour);
    expect(colour.b).toBeGreaterThan(0);
    shadowTintFor(presets.storm, tint.value);
    expect(colour.getHex()).toBe(0);
  });
  it('keeps prepared startup data eligible when the before is asked for', () => {
    expect(preparedTintAllowed('?bana=angso&shadowtint=0')).toBe(true);
  });
});
