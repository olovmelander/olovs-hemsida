/* Norrfällsviken's rings on the standard topology (standard-ground-rings.mjs):
   1 m over the central 4,096 m -- the course, the chapel and the harbour --
   2 m over the same square, 4 m to 8 km, and 8 m and coarser to a 16 km
   root, every level cut from Lantmäteriet's Markhöjdmodell so nothing is
   ever stitched to the Terrarium field.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   norrfallsviken-ground-graph.mjs, so lod 0 here and the published course
   terrain address the same lattice and publish-ground-rings can reuse the
   published 1 m tiles byte for byte. The two must not be edited apart.

   One thing here is not shared with any inland ground. Two of the four 10 km
   items this 16 km square needs are COASTAL and are not full squares:
   698_68 is 7,500 x 7,500 m and its overview chain stops at 16x where every
   other item reaches 32x. Levels 5 and 6 ask for factor 32, so over that item
   they fall back to the finest coarser overview available and resample --
   the fallback build-ground-rings already carries, and the reason it carries
   it. The evidence file records which overview each item actually served per
   level, so the substitution is visible rather than assumed. */
import { NORRFALLSVIKEN_GROUND_GRAPH_CONFIG } from './norrfallsviken-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: NORRFALLSVIKEN_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: NORRFALLSVIKEN_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

export const NORRFALLSVIKEN_GROUND_RINGS = standardGroundRings({
  groundId: 'norrfallsviken',
  courseSlugs: ['norrfallsviken'],
  courseModels: {
    /* The 144 card cells are gated exactly by nvgkbuild/check3d.mjs against
       the club's own 2025 scorecard, and the numbering is the card's rather
       than the GPS survey's. */
    norrfallsviken: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' },
  },
  centre: FRAME_ORIGIN,
  /* The 16 km square is mostly the Gulf of Bothnia and the High Coast behind
     it. The retained 4 km course window alone measures -0.841 to 90.589 m
     RH 2000; the wider square reaches the Mjällom cape's hills and, at its
     north-west corner, the ground rising towards Skuleberget. The sea is zero
     by definition, and the DTM carries it as a flattened surface rather than
     as nodata, so requireEverySampleFinite is a real gate here and not a
     formality -- roughly half of this square is water. */
  coverageGate: { minimumHeightRH2000: -10, maximumHeightRH2000: 400, requireEverySampleFinite: true },
  /* THE FIRST GROUND HERE THAT NEEDED THIS, and it needs it because it is the
     first that reaches open sea.

     Markhöjdmodell tiles Sweden's land and the water the laser reached. It
     does not tile the open Gulf of Bothnia, so beyond roughly E 681000 the
     coastal item 698_68 returns nodata: two blocks, 264,013 samples, 6.3% of
     the 8 km level. The 4 km course window is unaffected -- all 16,785,409 of
     its samples are finite -- so this is a horizon problem, not a course one.

     The wrong fix would be to relax coverageGate.requireEverySampleFinite,
     because that gate is what catches a wrong item, a padded window or a
     half-covered ring. The surface out there is not unknown: it is the sea,
     and RH 2000 is referenced to mean sea level. So the build fills it, under
     a rule that cannot paper over a hole in the LAND -- a nodata component is
     filled only if every finite sample bounding it is at or below the height
     below, and it is filled with the MEDIAN of its own boundary rather than a
     constant, so it meets the real data at the height the real data has.

     The thresholds below are MEASURED on the boundaries these holes actually
     have, not raised until the build passed. The first attempt used a single
     rule -- no boundary sample above 0.25 m -- and it failed, correctly: the
     two real components are bounded at up to 0.673 and 0.796 m. That tail is
     shore and skerry averaged into a factor-4 overview block, not terrain, and
     the way to tell the difference is the MEDIAN, which cannot be dragged by
     a few mixed pixels. Both components' boundary medians are -0.03 m, with
     93.2% and 96.4% of their boundaries at or below 0.25 m.

     So a hole must be bounded by water in the middle (median), mostly
     (fraction) and at the extreme (ceiling). A missing LAND square would fail
     all three at once, because this coast rises to 90 m inside the course
     window alone. The 15% cap is roughly twice the largest level's measured
     6.3%, so a delivery that silently lost a whole land item cannot pass. */
  seaFill: {
    reason: 'Markhöjdmodell does not tile the open Gulf of Bothnia; RH 2000 is referenced to mean sea level',
    /* what counts as a water sample: measured p50 -0.03 m, p90 <= 0.19 m */
    boundaryWaterHeightRH2000: 0.25,
    /* the discriminator: measured -0.03 m on both components */
    boundaryMedianMaximumHeightRH2000: 0.25,
    /* measured 0.932 and 0.964 */
    boundaryWaterMinimumFraction: 0.75,
    /* the hard ceiling: measured maxima 0.673 and 0.796 m */
    boundaryMaximumHeightRH2000: 3,
    maximumFilledFraction: 0.15,
  },
});
