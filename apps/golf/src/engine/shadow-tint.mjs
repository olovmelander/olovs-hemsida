import { Color } from 'three/webgpu';
import { mix, shadow, uniform, vec3 } from 'three/tsl';

/* A CAST SHADOW IS LIT BY THE SKY. Where a tree hides the sun, the ground still
   takes the open sky's light, and a painter lays that shade in the sky's blue.
   The renderer removed the sun's light and left the fill: sky-coloured, but the
   same in sun and shade, so the stronger the sun, the deeper and duller the
   shade. Now a share of the sun's strength reaches a shadow in the preset's own
   sky colour (hemiS): shade is lifted in the sky's cool colour by as much as
   the sun is strong -- most at noon and on surfaces facing the sun, least on
   flat ground under a low sun. The tint is the light's shadow node -- three's
   own shadow, filtered and edge-faded as before, mixed toward the tint where it
   falls -- so every sunlit receiver takes it at once: ground, trunks,
   buildings, furniture, flags. The shadow map and its on-demand renders are
   untouched. */

/** The sun's shadow, sky-lit: mix(tint, 1, shadow) in place of the plain shadow. */
export function createShadowTint(light) {
  const tint = uniform(new Color(0, 0, 0));
  return { tint, node: mix(tint, vec3(1), shadow(light)) };
}

/** The tint for a preset: the light a shadow keeps, as a fraction of the sun's
    own light, so that sun x tint is the sky colour at `shadowSky` of the sun's
    strength whatever the sun's colour; zero where the preset has no sun. */
export function shadowTintFor(preset, out = new Color()) {
  const share = preset.shadowSky ?? 0;
  if (!(share > 0) || preset.sun === undefined || preset.hemiS === undefined) return out.setRGB(0, 0, 0);
  const sky = new Color(preset.hemiS), sun = new Color(preset.sun);
  return out.setRGB(share * sky.r / Math.max(sun.r, 0.05), share * sky.g / Math.max(sun.g, 0.05), share * sky.b / Math.max(sun.b, 0.05));
}
