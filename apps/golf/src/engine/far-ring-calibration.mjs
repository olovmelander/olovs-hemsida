/* The far ring calibrated on the measured stands.

   Beyond every planted band the horizon is dressed with impostor trees, one
   per cell, sized by hash: 12 m times 1.5-2.6, so 18-31 m tall, at one per
   30 m cell. On a ground whose LiDAR generation owns everything the middle
   band would have planted (Ribbingsfors, where the raster box IS the
   2,048 m window), the far ring meets the measured stands DIRECTLY -- and
   measured, those stands are 10 m tall at the median (p10 3.75, p90 18.25)
   at about 208 stems a hectare when closed. The owner's phone showed the
   difference as a square: small dark crowns inside, big pale blobs outside.

   Where the far ring continues a measured population it now takes that
   population's own numbers -- heights drawn from the stand trees' height
   distribution, crown radii through the same allometry the stand planter
   uses, stem density from the stands' own planted-cell ratio -- and thins
   only with DISTANCE, in three bands, because a quad per stem to the horizon
   is a million quads. The orthophoto record still says WHERE the forest is;
   the LiDAR says how tall and how dense. Nothing here changes a course whose
   far ring meets a legacy planted band: the calibration is null there and
   the old rule stands, cone for cone.

   NO STATIC IMPORT OF THE V2 RUNTIME. main.js imports this module statically,
   and a static import of v2-vegetation.mjs from here made that chunk
   reachable from the flagless entry -- check-app-build refused the build on
   main (2026-09-10). The stand planter's allometry and overlap factor arrive
   as parameters from the dynamically loaded module instead.                 */

export const FAR_RING_BANDS = Object.freeze({
  /* metres outside the measured coverage: the measured stem spacing, then
     the data ring's spacing, then the dressing ring's */
  nearMetres: 600,
  middleMetres: 1800,
  middleSpacing: 16,
  farSpacing: 30,
  /* a phone plants the stand field at 0.55 of its stems (STAND_PLANTING.lowQualityKeep) */
  lowQualitySpacingFactor: 1.35,
  /* the record's light canopy is birch four in five, and shorter */
  lightHeightFactor: 0.75,
  minimumSamples: 500,
  quantileSteps: 20,
});

/**
 * Quantiles of the stand trees' heights and the stem area of a closed stand
 * at their median height, or null where there are too few stand trees to
 * calibrate on.
 */
export function calibrateFarRing({ standHeights, planting, crownRadiusAt, bands = FAR_RING_BANDS }) {
  if (!standHeights || standHeights.length < bands.minimumSamples) return null;
  if (typeof crownRadiusAt !== 'function' || !(planting?.overlapFactor > 0)) {
    throw new TypeError('calibrateFarRing needs the stand planter\'s crownRadiusAt(height) and planting.overlapFactor');
  }
  const sorted = Float32Array.from(standHeights).sort();
  const steps = bands.quantileSteps;
  const quantiles = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) quantiles[i] = sorted[Math.min(sorted.length - 1, Math.floor((i / steps) * (sorted.length - 1)))];
  const medianHeight = quantiles[steps >> 1];
  const radius = crownRadiusAt(medianHeight);
  return Object.freeze({
    samples: sorted.length,
    quantiles,
    medianHeight,
    crownRadiusAt,
    /* THE STAND PLANTER'S OWN RULE: a cell stands up fraction x area / (pi r^2)
       x overlap stems, so a CLOSED stand at the median height has one stem per
       pi r^2 / overlap square metres, and the record's local tree fraction
       scales it exactly as the stand field's fraction does. (The planner's
       planted-cell ratio is NOT a density: it rolls at most one stem per 4 m
       cell, so that ratio is 16 m2 by construction -- measured, and wrong
       by a factor of two and a half here.) */
    m2PerStem: (Math.PI * radius * radius) / planting.overlapFactor,
  });
}

/** Cell spacing for a far-ring tree `dCover` metres outside the measured coverage. */
export function farRingSpacing(dCover, calibration, lowQuality = false, bands = FAR_RING_BANDS) {
  const factor = lowQuality ? bands.lowQualitySpacingFactor : 1;
  if (!calibration) return (lowQuality ? 42 : 30);
  if (dCover < bands.nearMetres) return Math.max(4, Math.sqrt(calibration.m2PerStem)) * factor;
  if (dCover < bands.middleMetres) return bands.middleSpacing * factor;
  return bands.farSpacing * factor;
}

/** A far-ring tree's height and crown radius from two hashes in [0, 1). */
export function farRingTree(calibration, r1, r2, lightCanopy = false, bands = FAR_RING_BANDS) {
  const q = calibration.quantiles, steps = q.length - 1;
  const t = Math.min(0.999999, Math.max(0, r1)) * steps;
  const i = Math.floor(t), f = t - i;
  let height = q[i] + (q[Math.min(steps, i + 1)] - q[i]) * f;
  if (lightCanopy) height *= bands.lightHeightFactor;
  const radius = calibration.crownRadiusAt(height) * (0.85 + 0.3 * r2);
  return { height, radius };
}
