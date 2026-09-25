/* THE WATER FROM ABOVE (docs/visual-water-above-2026-09-25.md).
   Owner, 25 September: "How does the water look straight from above???", and on
   the answer, "Start with 1 and 2". Ovan looks straight down from 170-900 m
   (top-view.mjs). There the water is its body: straight down it mirrors a few
   percent of the sky overhead, so the sky's colours, the sun's road and the far
   shore, all reflections, are gone. It was one even blue under the water road
   pass's fine wave grain, and two things a view from above shows at once:
   - THE CLOUDS' SHADE STOPPED AT THE SHORE. A cloud's shadow crossed the course
     and ended at the water's edge: it took the sun from every lit surface, but on
     the water only the sun's sparkle. Now the body -- the light that comes up out
     of the water, lit by the sun and the sky as the ground is -- keeps in a
     cloud's shade the share of its light level open ground keeps there: the
     sky's light and the sky-lit share of the sun (shadowSky, shadow-tint.mjs),
     over the sky's and the sun's. So the shade crosses the shoreline as deep and
     as cool as it lies on the bank. The waves' relief, the sun's modelling of
     each facet, gives way with the sun. The reflection is the sky's, which the
     cloud does not shade, and the sparkle keeps its own rule (water-road.mjs).
     Under a low sun the shade is taken only as the eye looks down (from 25
     degrees, in full from 45: all of any Ovan frame, a desktop's corners too,
     and none of the water a player looks out over: from the owner's camera
     over Visby's sea the nearest water lies 22 degrees down). The clouds'
     shadows are laid round, where a low sun would draw them out along its
     light, and seen along the water a round shadow is a thin bar: the bars the
     water road pass took off the sun's road.
     Under a high sun, when the shadows are round, the water takes them at every
     angle, as the road does.
   - THE WIND DID NOT SHOW. The air carries calm and gusty patches across the
     water (nordic-water.mjs), but they only change how strongly it ripples, and
     from a few hundred metres up that barely showed. Seen from above, a gust's
     patch is ruffled and a calm one glassy. Now, as the eye looks down (the same
     25 to 45 degrees), the waves' relief follows the patches, as the square of a
     patch's chop over the mean: 1.8 times as strong in a gusty patch, half as
     strong in a calm one (the square would leave a quarter, and seen from 60 m
     a calm patch went dead flat), within the relief's cap. And the ruffled
     water, which scatters more of the sky to the eye, is a little lighter than
     the glassy: by 8% of the chop's difference, at most 3% lighter or 4%
     darker, as the wind is strong.
     Darkening the calm patches as a cloud's shade does was tried and read as
     more cloud shadows: round dark blobs, since the patches are the cloud
     pattern at a smaller scale. From a low eye the patches already show in the
     ripples, as calm mirrors and broken water, and the body is left alone: a
     gust seen along the water is darker, not lighter.
   Both read what the water already reads per pixel -- the cloud pattern for the
   sparkle, the patch pattern for the chop -- and add a few operations. */
import { Color } from 'three/webgpu';
import { float, max, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import { shadowTintFor } from './shadow-tint.mjs';
import { deriveEnvironmentPalette, LIGHTING_ENVIRONMENT_INTENSITY } from './lighting-environment.mjs';
import { waterChop } from './nordic-water.mjs';
import { WATER_ROAD } from './water-road.mjs';

export const WATER_ABOVE = Object.freeze({
  /* the environment's light on level ground: its sky, mix(horizon, zenith, sqrt(up)), cosine-weighted */
  overhead: { horizon: 0.2, zenith: 0.8 },
  /* the eye looking down on the water: the sines of 25 and 45 degrees */
  above: [Math.sin(25 * Math.PI / 180), Math.sin(45 * Math.PI / 180)],
  /* the patches from above: the relief as the square of a patch's chop over the mean, never under `glassy`, and
     the body's brightness against that chop, at the wind's chop */
  lanes: { gain: 0.08, glassy: 0.5 },
});

/** The share of its light level open ground keeps in a cloud's full shade, per channel (linear), as main.js
    lights it: the hemisphere's light and the environment's from overhead, and the sky-lit share of the sun
    (shadowSky) a shade keeps, over those and the full sun. `environment` is whether the preset's own
    environment lights the scene (GRAPHICS_POLISH), as lighting-environment.mjs chooses. */
export function groundCloudShadeFor(p, { environment = true } = {}, out = new Color()) {
  if (p.sun === undefined || !(p.int > 0) || !p.dir) return out.setRGB(1, 1, 1);
  const [x, y, z] = p.dir;
  const direct = p.int * Math.max(0, y / Math.hypot(x, y, z)) / Math.PI;
  const hemi = (p.hemiI ?? 0) * (p.paintedFill ?? 1) / Math.PI;
  const sun = new Color(p.sun), sky = new Color(p.hemiS ?? 0xffffff), tint = shadowTintFor(p);
  const palette = deriveEnvironmentPalette(p, environment);
  const intensity = environment ? (p.environmentIntensity ?? LIGHTING_ENVIRONMENT_INTENSITY) : LIGHTING_ENVIRONMENT_INTENSITY;
  const { horizon, zenith } = WATER_ABOVE.overhead;
  const share = c => {
    const fill = sky[c] * hemi + (palette.horizon[c] * horizon + palette.zenith[c] * zenith) * intensity;
    const d = sun[c] * direct;
    return fill + d > 0 ? (fill + d * tint[c]) / (fill + d) : 1;
  };
  return out.setRGB(share('r'), share('g'), share('b'));
}

/** The body's share of its light in a cloud's full shade: set per preset by setWaterAbovePreset. */
export const waterCloudShade = uniform(new Color(1, 1, 1));
export function setWaterAbovePreset(p, { environment = true } = {}) {
  groundCloudShadeFor(p, { environment }, waterCloudShade.value);
}

/** How far the eye looks down on the water (0 below 25 degrees, 1 past 45), from its direction V. */
export const fromAbove = V => smoothstep(WATER_ABOVE.above[0], WATER_ABOVE.above[1], V.y);

/** The share of the sun the body takes past the clouds (`sunlit`, 1 in the clear): the cloud's own as the eye
    looks down or the sun stands high (the road's rule, water-road.mjs), and all of it seen low under a low sun. */
export function bodySunlit({ sunlit, V, sunUp }) {
  const [low, high] = WATER_ROAD.cloudSun;
  return mix(float(1), sunlit, max(fromAbove(V), smoothstep(low, high, sunUp)));
}

/** The body's light at that share of the sun: mix(its share in full shade, 1, share). */
export const bodyCloudShade = share => mix(waterCloudShade, vec3(1), share);

/** How much more of its relief the water shows from above over the calm and gusty patches (bodyRelief's `rough`):
    `chop` is a patch's chop over the mean (1 on average, nordic-water.mjs), V the eye's direction. */
export const waterRoughness = ({ chop, V }) => mix(float(1), chop.mul(chop).max(WATER_ABOVE.lanes.glassy), fromAbove(V));

/** The body's brightness from above over the patches: the ruffled a little lighter, the glassy a little darker. */
export function waterLanes({ chop, V }) {
  return chop.sub(1).mul(waterChop).mul(WATER_ABOVE.lanes.gain).mul(fromAbove(V)).add(1);
}
