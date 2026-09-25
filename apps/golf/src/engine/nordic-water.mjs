/* NORDIC LAKE WATER. A Swedish lake at golden hour is a dark mirror of its own
   shore with a warm road of light across it toward the sun, broken by patches
   where the wind ruffles it. The water had none of that: its sparkle was one
   dab of warm white wherever a ripple faced the sun, sharp at every distance
   (so at range it thinned to a flicker as the ripple map's mipmaps averaged
   the ripples flat), its reflection was the sky's gradient with no shore in it
   and no sun glow, and its four ripple layers scrolled on a clock of their own,
   the same everywhere on the lake. Now (main.js makeWater):
   - THE SUN'S ROAD. Past a few hundred metres the dabs give way to their own
     expectation: the share of a pixel's ripples tilted to throw the sun to the
     eye, reckoned from the ripple map's own spread of slopes and fitted to the
     map itself (nordic-water.test.mjs). So the road keeps its width and
     brightness to the horizon, widening with the chop. Dabs and road take the
     sun's own colour, and the reflection takes the sky's own sun glow, the
     painted sky's lobe (painted-sky.mjs), so the water and the sky agree.
   - THE SHORE IN THE WATER. Just above the reflected horizon the far shore's
     wood stands dark in the reflection, its top broken along the horizon: a
     lake in full, a pond half, the open sea not at all.
   - THE ONE WIND ON THE WATER. The ripple layers and the foam drift downwind
     with the air (one-wind.mjs), the chop follows the wind's strength, and calm
     and gusty patches the air carries across a lake break it up. Reduced motion
     and det=1 hold the water still.
   All of it is per water pixel: a texture read, an arctangent and a few
   operations. */
import { Color, Vector2 } from 'three/webgpu';
import { atan, float, mix, normalize, renderGroup, sin, smoothstep, texture, uniform } from 'three/tsl';
import { FOLIAGE_PALETTES } from './painted-world-palette.mjs';
import { ONE_WIND } from './one-wind.mjs';
import { cloudPatternTexture } from './cloud-shadow.mjs';
import { sunwardLobe } from './aerial-perspective.mjs';

export const NORDIC_WATER = Object.freeze({
  /* the ripple map's spread of slopes per axis (water-normal-texture.mjs, the seamless map), measured */
  slopeSpread: [0.0848, 0.1015],
  /* the dabs, smoothstep(0.985, 0.996, N.H), averaged over ripples of slope spread sigma at the tangent t
     of the tilt a ripple needs to throw the sun to the eye: a plateau that thins as the water roughens
     (1 / (1 + thin sigma^4)), falling between an inner and an outer tangent that widen with it */
  glitter: { thin: 1590, inner: 0.113, innerSpread: 1.27, outer: 0.166, outerSpread: 1.04 },
  /* the dabs give way to their expectation between these distances, as they grow finer than a pixel */
  sharpMetres: [120, 450],
  /* the far shore's wood in the reflection: up to this reflected height (a 20 m wood 570 m off),
     broken along the horizon; a pond's share of it, and the air it is seen through. It is read off
     a calmer surface than the sky's -- a quarter of the chop, none by 1.2 km -- since the full chop
     threw each pixel's reflection in and out of so thin a band and broke it into dark specks. */
  treeLine: { height: 0.035, pond: 0.5, shoreMetres: 600, calm: 0.25, calmFarMetres: [200, 1200] },
  /* the ripple layers as main.js draws them, [scale, gain, cross]: each drifts at the air's velocity
     times its gain, and across the wind at its cross share of the wind's speed */
  layers: [[0.115, 0.07, 0.03], [0.052, 0.12, -0.06], [0.245, 0.05, 0.04], [0.014, 0.2, 0.03]],
  foam: [0.55, 0.02, 0.03],
  /* the chop against the wind: 0.45 of the drawn chop in calm air, all of it at the reference wind, up to 1.6 */
  chop: { calm: 0.45, cap: 1.6 },
  /* calm and gusty patches carried by the air: the cloud pattern at 1.2 km a tile; a calm patch keeps 0.45
     of the chop, a gusty one 1.2, over the mean; far off they fade to the mean, where they would shimmer */
  patches: { tileMetres: 1200, calm: 0.45, gusty: 1.2, edges: [0.35, 0.65], fadeMetres: [600, 1500] },
});

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (x, period) => x - Math.floor(x / period) * period;

/* the ripple map's radial slope spread per unit of drawn weight: sqrt(2 x its mean variance per axis) */
export const SLOPE_SCALE = Math.sqrt(NORDIC_WATER.slopeSpread[0] ** 2 + NORDIC_WATER.slopeSpread[1] ** 2);

/** The expected glitter (0..1) of ripples with slope spread sigma, at the tangent t of the tilt they need. */
export function expectedGlitterAt(sigma, t) {
  const g = NORDIC_WATER.glitter;
  return 1 / (1 + g.thin * sigma ** 4) * (1 - smooth(Math.max(0, g.inner - g.innerSpread * sigma), g.outer + g.outerSpread * sigma, t));
}

/** The same in the shader, toward the sun L from the eye V, over the flat water. */
export function expectedGlitter({ V, L, sigma }) {
  const g = NORDIC_WATER.glitter;
  const H = normalize(V.add(L)), hy = H.y.max(1e-3);
  const t = float(1).sub(hy.mul(hy)).max(0).sqrt().div(hy);
  const s2 = sigma.mul(sigma);
  const plateau = float(1).div(s2.mul(s2).mul(g.thin).add(1));
  return plateau.mul(float(1).sub(smoothstep(float(g.inner).sub(sigma.mul(g.innerSpread)).max(0), sigma.mul(g.outerSpread).add(g.outer), t)));
}

/* the colours the preset sets: the sun on the water, the sky's glow, the far shore's wood */
export const waterSun = uniform(new Color(0xfff4d9));
export const waterSkyGlow = uniform(new Color(0xffffff));
export const waterSkyGlowStrength = uniform(0);
export const waterTreeLine = uniform(new Color(0x1d2b22));

/** How much of the reflected sky's sun glow a reflection toward R takes: the painted sky's own lobe. */
export const reflectedSunGlow = ({ R, up, sun }) => sunwardLobe(R, sun).mul(float(1).sub(smoothstep(0.10, 0.68, up))).mul(waterSkyGlowStrength);

/** How much of a reflection toward R is the far shore's wood (0..1), broken along the horizon. */
export function treeLineShare({ R, up }) {
  const az = atan(R.z, R.x);
  /* whole numbers of waves round the horizon, so the line closes behind the eye */
  const broad = sin(az.mul(5).add(sin(az.mul(2)).mul(1.4))).mul(0.5).add(0.5);
  const fine = sin(az.mul(13).add(1.7)).mul(0.5).add(0.5);
  const top = broad.mul(0.5).add(fine.mul(0.15)).add(0.6).mul(NORDIC_WATER.treeLine.height);
  return float(1).sub(smoothstep(top.mul(0.55), top.mul(1.1), up));
}

/** The far shore's wood, reflected: the spruce's darkest pigment in the crowns' shaded light, through the haze of its distance. */
export function treeLineColour(p, { fogColour, fogDensity, hazeMax = 0.85 }, out = new Color()) {
  const strength = p.foliage?.strength ?? Math.max(0.35, Math.min(1, 0.18 + (p.int ?? 0) * 0.30 + (p.hemiI ?? 0) * 0.10));
  const shade = new Color(p.hemiS ?? 0xffffff).lerp(new Color(1, 1, 1), p.foliage?.shadowWhite ?? 0.62);
  out.setHex(FOLIAGE_PALETTES.gran[0]).multiply(shade).multiplyScalar(strength);
  const air = (1 - Math.exp(-((fogDensity * NORDIC_WATER.treeLine.shoreMetres) ** 2))) * hazeMax;
  return out.lerp(fogColour, Math.min(1, air + 0.12));
}

/** The preset's water colours: `sky` is the preset as the sky takes it (main.js skyPreset). */
export function setNordicWaterPreset(p, { sky = p, fogColour, fogDensity, hazeMax }) {
  const sun = new Color(p.sun ?? 0xfff4d9);
  waterSun.value.copy(sun).multiplyScalar(1 / Math.max(sun.r, sun.g, sun.b, 1e-3));
  waterSkyGlow.value.setHex(sky.skySunGlow ?? 0xffffff);
  waterSkyGlowStrength.value = sky.skySunGlowStrength ?? 0;
  treeLineColour(p, { fogColour, fogDensity, hazeMax }, waterTreeLine.value);
}

/* THE WATER ON THE ONE WIND: each ripple layer's and the foam's offset, in its own texture's units and
   wrapped there, the patches' offset in metres, wrapped at their tile, and the chop. Once a render. */
export const waterFlow = Array.from({ length: 5 }, () => uniform(new Vector2(0, 0)).setGroup(renderGroup));
export const waterPatchOffset = uniform(new Vector2(0, 0)).setGroup(renderGroup);
export const waterChop = uniform(1).setGroup(renderGroup);

/** The chop against the wind: 1 at the reference wind. */
export function waterChopFor(ms) {
  const { calm, cap } = NORDIC_WATER.chop;
  return Math.min(cap, calm + (1 - calm) * Math.max(0, ms) / ONE_WIND.referenceMs);
}

export function createWaterMotion() {
  return { flow: Array.from({ length: 5 }, () => [0, 0]), patch: [0, 0], chop: 1 };
}

/** Carry the water with the air (one-wind.mjs stepAir, stepped first): nothing moves when it is still or pinned. */
export function stepWaterMotion(state, dt, air, { deterministic = false, still = false } = {}) {
  state.chop = waterChopFor(air.ms);
  const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
  if (deterministic || still || !(step > 0) || air.x === null) return state;
  const sideX = -air.axisZ * air.ms, sideZ = air.axisX * air.ms;
  [...NORDIC_WATER.layers, NORDIC_WATER.foam].forEach(([scale, gain, cross], i) => {
    state.flow[i][0] = wrap(state.flow[i][0] + (air.x * gain + sideX * cross) * scale * step, 1);
    state.flow[i][1] = wrap(state.flow[i][1] + (air.z * gain + sideZ * cross) * scale * step, 1);
  });
  const tile = NORDIC_WATER.patches.tileMetres;
  state.patch[0] = wrap(state.patch[0] + air.x * step, tile);
  state.patch[1] = wrap(state.patch[1] + air.z * step, tile);
  return state;
}

export function applyWaterMotion(state) {
  state.flow.forEach(([u, v], i) => waterFlow[i].value.set(u, v));
  waterPatchOffset.value.set(state.patch[0], state.patch[1]);
  waterChop.value = state.chop;
}

/** The patches' chop as the pattern holds it, over its own mean (so the lake's mean chop is the wind's). */
export function patchChopOf(value) {
  const { calm, gusty, edges } = NORDIC_WATER.patches;
  return calm + (gusty - calm) * smooth(edges[0], edges[1], value);
}
let patchMean = null;
export function waterPatchMean() {
  if (patchMean !== null) return patchMean;
  const { bytes } = cloudPatternTexture();
  let sum = 0;
  for (const b of bytes) sum += patchChopOf(b / 255);
  return (patchMean = sum / bytes.length);
}

/** The shader's patch chop at ground position p (vec2) and eye distance d: 1 on average, 1 far off. */
export function waterPatchChop({ p, distance }) {
  const { calm, gusty, edges, tileMetres, fadeMetres } = NORDIC_WATER.patches;
  const value = texture(cloudPatternTexture().map, p.sub(waterPatchOffset).div(tileMetres)).r;
  const chop = mix(float(calm), float(gusty), smoothstep(edges[0], edges[1], value)).div(waterPatchMean());
  return mix(chop, float(1), smoothstep(fadeMetres[0], fadeMetres[1], distance));
}
