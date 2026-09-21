/* The production ground is always painted/Ghibli. Historical material finishes
 * live in studies/ground-material.mjs and are not imported by the player. */
import { float, vec3, texture, mix, smoothstep, saturate, normalWorld, oneMinus } from 'three/tsl';
import { paintedDirect, paintedSeason, paintedTurfStrength, paintedGrassSheen } from './painted-world-lighting.mjs';
import { makeGround as makeGroundCore, createV2GroundMaterialDecorator as createV2DecoratorCore } from './ground-material-core.mjs';
export { groundSurfaceAlbedo, classStyle, surfaceDebugColour, createGroundStyleData, SURFACE_PAIR_GUARD, surfacePairGuardMetres, surfacePairWeight } from './ground-material-core.mjs';

export function paintedGround({ base, wp, DETAIL, uSun, mow = float(0), turf = float(1), seasonal = float(0) }) {
  const blotchA = texture(DETAIL, wp.mul(0.012)).b.sub(0.5);
  const blotchB = texture(DETAIL, wp.mul(0.038)).g.sub(0.5);
  const blotchC = texture(DETAIL, wp.mul(0.11)).r.sub(0.5);
  /* turf is blotched like a meadow; gravel and sand keep a quieter grain */
  const blotch = blotchA.mul(0.18).add(blotchB.mul(0.08)).add(blotchC.mul(0.035)).mul(mix(float(0.35), float(1), turf));
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
  const seasonTone = mix(vec3(1), vec3(1.14,.93,.75), paintedSeason.mul(seasonal).mul(turf));
  const c = base.mul(float(1).add(blotch).add(mow.mul(0.55))).mul(tone).mul(seasonTone)
    .mul(mix(float(1), paintedTurfStrength, turf));
  // Broad grass reflections use the standard light/shadow response, so the
  // sun catches the turf at grazing angles and tree shadows still occlude it.
  // Reuse the existing blotch/mowing samples; no glints, normal map or pass.
  const sheenRoughness = float(.59).add(blotchA.mul(.12)).sub(mow.mul(.35)).clamp(.52,.68);
  return { colorNode: c, roughnessNode: mix(float(.96),sheenRoughness,paintedGrassSheen.mul(turf)) };
}

const PAINTED_SHADING = {
  toneExponent: 2.2, cutLift: 1, mowDivisor: 0.55,
  vertexLinearShare: 1, atlasLinearShare: 1, requiresSun: true,
  vertexAlbedo: colour => colour,
  finishGround({ material, col, wp, DETAIL, uSun, strength, band, sandWeight, hardWeight }) {
    Object.assign(material, paintedGround({ base: col, wp, DETAIL, uSun,
      mow: band.mul(strength.min(1.8)).mul(0.05), turf: oneMinus(sandWeight.max(hardWeight)) }));
  },
  finishV2({ material, litBase, wp, DETAIL, uSun, mow, meta, seasonal }) {
    Object.assign(material, paintedGround({ base: litBase, wp, DETAIL, uSun, mow,
      turf: oneMinus(meta.g.max(meta.b)), seasonal }));
  },
};

export function makeGround(options) {
  return makeGroundCore(options, PAINTED_SHADING);
}

export function createV2GroundMaterialDecorator(options) {
  return createV2DecoratorCore(options, PAINTED_SHADING);
}
