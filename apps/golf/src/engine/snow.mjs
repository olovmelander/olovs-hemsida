/* WINTER (docs/visual-winter-2026-11-06.md): the map's Vinter on the simulator.
 *
 * Snow settles over the ground, thinner on steep faces and a little thinner on
 * mown turf so a course still reads under it, lies on what faces the sky in a
 * conifer's crown, and covers a frozen lake; the sea stays open. Broadleaves go
 * bare: their leaf cards are not drawn and their impostors are baked from the
 * wood alone (main.js). How much snow lies is one uniform (paintedSnow), set by
 * the light (painted-world-palette.mjs `snow`) or by Nu (light-now.mjs), so
 * nothing is rebuilt when it changes. ?snow=0 draws no snow in any light.
 */
import { float, vec3, vec4, mix, smoothstep, saturate } from 'three/tsl';
import { paintedSnow } from './painted-world-lighting.mjs';

export const SNOW = Object.freeze({
  /* the snow's albedo, linear: a little blue, under the brightest a lit lawn reaches four times over */
  albedo: Object.freeze([0.80, 0.84, 0.90]),
  /* how much settles: wild ground nearly all, mown turf less (a course reads under it), sand and hard ground most */
  settle: Object.freeze({ wild: 0.97, mown: 0.86, bare: 0.92 }),
  /* the terrain normal's height over which a face holds snow: a 45 degree bank sheds most of it */
  slope: Object.freeze([0.6, 0.86]),
  /* a crown holds snow on its tops alone, and not all of them: from 0.2 up the whole upper half of a
     crown went white, and a stand of pines read as snowballs from the tee (6 November) */
  crown: Object.freeze({ facing: Object.freeze([0.5, 0.95]), share: 0.6 }),
  /* the ice on a frozen lake: snow on it, wind-scoured into a darker grey-blue in patches */
  ice: Object.freeze({ snow: Object.freeze([0.78, 0.83, 0.89]), scoured: Object.freeze([0.5, 0.6, 0.68]) }),
  /* a roof holds snow up to a 60 degree pitch, and most of it: the eaves' drip lines and its seams show */
  roof: Object.freeze([0.4, 0.7]), roofShare: 0.9,
  /* the conifers: they keep their needles, and hold the snow */
  conifers: Object.freeze(['tall', 'gran', 'martall']),
});

/** Broadleaves lose their leaves in winter; a conifer keeps its needles. */
export const isBroadleaf = key => !SNOW.conifers.includes(key);

/* ?snow=0 is the before: every light as it was, winter included, with no snow drawn */
let SNOW_ON = true;
export function setSnowDrawn(on) { SNOW_ON = !!on; }
export const snowDrawn = () => SNOW_ON;

/**
 * Snow laid over a ground colour. `turf` 1 on grass, 0 on sand and hard ground;
 * `gloss` the surface's own gloss (a green 0.42, a fairway 0.28, rough 0.06) when
 * the finish has it; `blotch` the finish's broad blotch, about 0, which breaks
 * the snow's edge on slopes and the tone of a field of it.
 */
export function snowOnGround({ colour, normal, turf = float(1), gloss = null, blotch = float(0) }) {
  if (!SNOW_ON) return colour;
  const mown = gloss ? smoothstep(0.1, 0.38, gloss) : float(0);
  const settle = mix(float(SNOW.settle.bare), mix(float(SNOW.settle.wild), float(SNOW.settle.mown), mown), turf);
  const holds = smoothstep(SNOW.slope[0], SNOW.slope[1], normal.y.add(blotch.mul(0.4)));
  const amount = saturate(paintedSnow.mul(settle).mul(holds));
  const snow = vec3(...SNOW.albedo).mul(float(1).add(blotch.mul(0.12)));
  return mix(colour, snow, amount);
}

/** Snow on the faces of a conifer's crown that look up, over its lit colour; `light` is what lights the crown. */
export function snowOnCrown({ colour, normal, light, key, dabs = float(0) }) {
  if (!SNOW_ON || isBroadleaf(key)) return colour;
  const facing = smoothstep(SNOW.crown.facing[0], SNOW.crown.facing[1], normal.y.add(dabs.mul(2)));
  return mix(colour, vec3(...SNOW.albedo).mul(light), paintedSnow.mul(facing).mul(SNOW.crown.share));
}

/** Snow on a roof, or anything built that faces the sky, over its colour (vec4, alpha passed through). */
export function snowOnRoof(colour, normal) {
  if (!SNOW_ON) return colour;
  const holds = smoothstep(SNOW.roof[0], SNOW.roof[1], normal.y);
  return vec4(mix(colour.rgb, vec3(...SNOW.albedo), paintedSnow.mul(holds).mul(SNOW.roofShare)), colour.a);
}

/** A frozen lake's colour under `light` (its sky's and sun's light on level ground), patchy with `blotch` 0..1. */
export function iceColour({ light, blotch }) {
  const scoured = smoothstep(0.58, 0.8, blotch);
  return mix(vec3(...SNOW.ice.snow), vec3(...SNOW.ice.scoured), scoured.mul(0.6)).mul(light);
}

/** How frozen the lakes are: all of the snow's share, none in a light without snow. */
export const lakeFrozen = () => (SNOW_ON ? paintedSnow : float(0));
