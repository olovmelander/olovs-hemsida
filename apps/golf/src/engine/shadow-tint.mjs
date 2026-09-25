import { Color } from 'three/webgpu';
import { mix, renderGroup, shadow, uniform, vec3 } from 'three/tsl';

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

/* THE SUN UNDER DRIFTING CLOUDS (cloud-shadow.mjs). A cloud's shade is lit by
   the sky just as a tree's is, so with `cloud` the share of the sun a point
   keeps past the clouds (1 in the clear), the light it takes is
   sun x mix(tint, 1, shadow x cloud): a tree's shadow fades into a cloud's shade
   rather than darkening again inside it. The sun's own colour carries
   mix(tint, 1, cloud) to every lit surface, those without a shadow map too
   (tufts, bushes, stones); a receiver's shadow node then takes the rest,
   mix(tint, 1, shadow x cloud) over that. Without a tint (?shadowtint=0) the
   cloud simply dims the sun. Clear sky (cloud = 1) leaves both exactly the
   before. */
export function sunUnderClouds(light, { cloud, tint = null }) {
  /* the sun's colour at its strength, reckoned as three's own light node does (colour x intensity, once a render) */
  const colour = new Color();
  const sun = uniform(colour).setGroup(renderGroup).onRenderUpdate(() => colour.copy(light.color).multiplyScalar(light.intensity));
  if (!tint) return { colorNode: sun.mul(cloud), shadowNode: null };
  const cloudLight = mix(tint, vec3(1), cloud);
  return { colorNode: sun.mul(cloudLight), shadowNode: mix(tint, vec3(1), shadow(light).mul(cloud)).div(cloudLight.max(1e-3)) };
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
