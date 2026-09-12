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
  /* Measured on the built app at Veckefjarden (a top-down frame with the trees
     shown and hidden, over ground the land-cover record calls closed forest):
     the old 16 m and 30 m bands drew 5.3% and 1.9% canopy against band 0's
     10.0%, so the horizon read as scattered trees on open ground -- which is
     what the flat-cone fallback had been hiding. A quad is two triangles and
     the cone it replaced was ten, so the budget was already there. */
  middleSpacing: 10,
  farSpacing: 15,
  /* a phone plants the stand field at 0.55 of its stems (STAND_PLANTING.lowQualityKeep) */
  lowQualitySpacingFactor: 1.35,
  /* the record's light canopy is birch four in five, and shorter */
  lightHeightFactor: 0.75,
  minimumSamples: 500,
  quantileSteps: 20,
  /* A thinned band draws one quad where the stand has several stems, so the
     quad is grown to cover them. Past this the quad stops reading as a tree
     and starts reading as a hill, and the skyline it draws is not one the
     LiDAR measured -- so the growth is capped here AND, separately, at the
     tallest tree the population actually carries. */
  maximumClumpScale: 2.2,
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
       x overlap stems, so a CLOSED stand of trees of one height has one stem
       per pi r^2 / overlap square metres, and the record's local tree fraction
       scales it exactly as the stand field's fraction does. (The planner's
       planted-cell ratio is NOT a density: it rolls at most one stem per 4 m
       cell, so that ratio is 16 m2 by construction -- measured, and wrong
       by a factor of two and a half here.)

       A STAND IS NOT ONE HEIGHT, AND THE MEDIAN TREE IS NOT THE MEDIAN
       DENSITY. Crown area grows with height, so the small trees -- which are
       many -- each stand for far less ground than the median one does: the
       density of a mixed stand is the MEAN of its trees' densities, which is
       the harmonic mean of their stem areas and never the median tree's.
       Measured at Veckefjarden the median-tree rule asked for 288 stems a
       hectare where the stand planter itself had planted 488. */
    m2PerStem: 1 / (quantiles.reduce((sum, h) => sum + planting.overlapFactor / (Math.PI * crownRadiusAt(h) ** 2), 0) / quantiles.length),
    /* what one stem stands for at the median height: kept because the old
       rule is worth being able to quote, and because a caller may want the
       typical tree rather than the typical density */
    m2PerMedianStem: (Math.PI * radius * radius) / planting.overlapFactor,
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

/** A far-ring tree's height and crown radius from two hashes in [0, 1).
 *
 * `spacing` is the band's own cell spacing: where it is wider than the measured
 * stem spacing the quad stands for a CLUMP, and is grown in proportion -- its
 * own allometric shape kept -- so the band draws the canopy it replaces rather
 * than a fraction of it. Omit it and nothing grows. */
export function farRingTree(calibration, r1, r2, lightCanopy = false, bands = FAR_RING_BANDS, spacing = null) {
  const q = calibration.quantiles, steps = q.length - 1;
  const t = Math.min(0.999999, Math.max(0, r1)) * steps;
  const i = Math.floor(t), f = t - i;
  let height = q[i] + (q[Math.min(steps, i + 1)] - q[i]) * f;
  if (lightCanopy) height *= bands.lightHeightFactor;
  let radius = calibration.crownRadiusAt(height) * (0.85 + 0.3 * r2);
  const stems = spacing > 0 ? (spacing * spacing) / calibration.m2PerStem : 1;
  if (stems > 1) {
    /* cover n crowns with one: the linear scale is sqrt(n), capped, and then
       capped again at the tallest tree this population actually carries --
       a measured ceiling, so the skyline never claims a tree nobody found */
    const scale = Math.min(bands.maximumClumpScale, Math.sqrt(stems), q[steps] / height);
    if (scale > 1) { height *= scale; radius *= scale; }
  }
  return { height, radius };
}
