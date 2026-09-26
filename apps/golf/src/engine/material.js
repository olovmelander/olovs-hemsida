/* The production ground is always painted/Ghibli. Historical material finishes
 * live in studies/ground-material.mjs and are not imported by the player. */
import { float, vec3, texture, mix, smoothstep, saturate, normalWorld, oneMinus } from 'three/tsl';
import { paintedDirect, paintedSeason, paintedTurfStrength, paintedGrassSheen, paintedWet } from './painted-world-lighting.mjs';
import { makeGround as makeGroundCore, createV2GroundMaterialDecorator as createV2DecoratorCore } from './ground-material-core.mjs';
export { groundSurfaceAlbedo, classStyle, surfaceDebugColour, createGroundStyleData, SURFACE_PAIR_GUARD, surfacePairGuardMetres, surfacePairWeight } from './ground-material-core.mjs';

/* A fairway's gloss in SHADE: the sheen every turf took before surfaces had their own */
export const FAIRWAY_GLOSS = 0.28;
/* autumn's ochre on the grass (Höst): what the rough, and what grows in it, is multiplied by */
export const SEASON_OCHRE = Object.freeze([1.14, .93, .75]);

/* `taps`: the three blotches' samples when the caller already holds them (the
   class-SDF ground shares its detail taps, ground-material-core.mjs); `broadLift`:
   how much more of the broad blotch a pixel takes (mown turf, there), about the
   detail texture's own mean in that channel, so the turf keeps its tone on average */
export const DETAIL_BROAD_MEAN = 0.4705;
export function paintedGround({ base, wp, DETAIL, uSun, mow = float(0), turf = float(1), seasonal = float(0), gloss = null, taps = null, broadLift = null }) {
  const blotchA = (taps ? taps.a : texture(DETAIL, wp.mul(0.012)).b).sub(0.5);
  const blotchB = (taps ? taps.b : texture(DETAIL, wp.mul(0.038)).g).sub(0.5);
  const blotchC = (taps ? taps.c : texture(DETAIL, wp.mul(0.11)).r).sub(0.5);
  /* EACH SURFACE TAKES THE LIGHT ITS OWN WAY. SHADE gives every surface a gloss
     -- a green 0.42, a fairway 0.28, rough 0.06 -- and this finish dropped it,
     so a green, cut to a few millimetres and rolled, caught the sun exactly as
     knee-high rough did. With `gloss` the sheen scales with the surface's own
     gloss against a fairway's (a fairway is unchanged; a green takes half as
     much again, rough a fifth), and the meadow's blotches calm to under half on
     the finest cuts. Without it (?surfacegloss=0) the finish is the before. */
  const glossy = gloss ? gloss.div(FAIRWAY_GLOSS).clamp(0.2, 1.6) : null;
  const calm = gloss ? oneMinus(smoothstep(0.28, 0.42, gloss).mul(0.55)) : null;
  /* turf is blotched like a meadow; gravel and sand keep a quieter grain */
  let blotch = blotchA.mul(0.18).add(blotchB.mul(0.08)).add(blotchC.mul(0.035));
  if (broadLift) blotch = blotch.add(blotchA.add(0.5 - DETAIL_BROAD_MEAN).mul(broadLift.mul(0.18)));
  blotch = blotch.mul(mix(float(0.35), float(1), turf));
  if (calm) blotch = blotch.mul(calm);
  const wrap = saturate(normalWorld.dot(uSun).mul(0.5).add(0.5));
  const band = mix(float(.55), smoothstep(0.30, 0.80, wrap), paintedDirect);
  /* the sunlit band goes yellow-green, the way a painter warms a lit meadow;
     the shade stays blue-green. Only TURF takes the hue swing: a grey road
     under the warm band turned brown, and sand went orange */
  const turfTone = mix(vec3(0.91, 0.97, 1.06), vec3(1.04, 1.02, 0.94), band);
  const flatTone = mix(vec3(0.90, 0.91, 0.95), vec3(1.03, 1.03, 1.02), band);
  const tone = mix(flatTone, turfTone, turf);
  /* the palette carries the chroma now; the finish only shapes it */
  // Uncut surroundings acquire an ochre undertone in autumn; mown playing
  // surfaces keep their distinct sage/moss hues and readable mowing pattern.
  const seasonTone = mix(vec3(1), vec3(...SEASON_OCHRE), paintedSeason.mul(seasonal).mul(turf));
  const c = base.mul(float(1).add(blotch).add(mow.mul(0.55))).mul(tone).mul(seasonTone)
    .mul(mix(float(1), paintedTurfStrength, turf));
  // Broad grass reflections use the standard light/shadow response, so the
  // sun catches the turf at grazing angles and tree shadows still occlude it.
  // Reuse the existing blotch/mowing samples; no glints, normal map or pass.
  const sheenRoughness = float(.59).add(blotchA.mul(.12)).sub(mow.mul(.35)).clamp(.52,.68);
  const sheen = glossy ? paintedGrassSheen.mul(turf).mul(glossy) : paintedGrassSheen.mul(turf);
  return { colorNode: c, roughnessNode: mix(float(.96),sheenRoughness,sheen) };
}

const PAINTED_SHADING = {
  toneExponent: 2.2, cutLift: 1, mowDivisor: 0.55,
  vertexLinearShare: 1, atlasLinearShare: 1, requiresSun: true,
  /* how wet the ground lies in this light: its hollows damp (storm, mist) */
  wetness: paintedWet,
  vertexAlbedo: colour => colour,
  finishGround({ material, col, wp, DETAIL, uSun, gls, strength, band, sandWeight, hardWeight, surfaceGloss = false }) {
    Object.assign(material, paintedGround({ base: col, wp, DETAIL, uSun,
      mow: band.mul(strength.min(1.8)).mul(0.05), turf: oneMinus(sandWeight.max(hardWeight)),
      gloss: surfaceGloss ? gls : null }));
  },
  finishV2({ material, litBase, wp, DETAIL, uSun, mow, meta, seasonal, shade, surfaceGloss = false, taps = null, broadLift = null }) {
    Object.assign(material, paintedGround({ base: litBase, wp, DETAIL, uSun, mow,
      turf: oneMinus(meta.g.max(meta.b)), seasonal, gloss: surfaceGloss ? shade.z : null, taps, broadLift }));
  },
};

export function makeGround(options) {
  return makeGroundCore(options, PAINTED_SHADING);
}

export function createV2GroundMaterialDecorator(options) {
  return createV2DecoratorCore(options, PAINTED_SHADING);
}
