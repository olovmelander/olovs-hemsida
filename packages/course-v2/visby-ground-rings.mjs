/* The nested resolution rings that would make Visby's v2 ground the ONLY
   ground: 1 m over the whole retained source window, 2 m to the same 4 km
   square, 4 m to 8 km, and 8 m and coarser to a 16 km root, every level cut
   from Lantmäteriet's Markhöjdmodell so nothing is ever stitched to a coarser
   field.

   The topology is Norrfällsviken's, unchanged, because the finest window is
   the same sixteen tiles per side: lod 0 is 16 tiles of 1 m and lod 1 is 8
   tiles of 2 m over the SAME 4,096 m square, after which each finer ring is
   exactly the middle four tiles of the next coarser one, so a coarse tile is
   either wholly covered by finer tiles or not at all. Puttom's first cut used
   six-wide rings and the half-covered coarse tiles showed sky through the
   ground in tile-shaped plates; do not narrow these.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   visby-ground-graph.mjs, which for this ground is also the software frame's
   own origin (E 687748.5, N 6370951.5), so lod 0 here and the published
   course terrain address the same lattice and publish-ground-rings can reuse
   the published 1 m tiles byte for byte. The two must not be edited apart.  */
import { VISBY_GROUND_GRAPH_CONFIG } from './visby-ground-graph.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: VISBY_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: VISBY_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const VISBY_GROUND_RINGS = Object.freeze({
  groundId: 'visby',
  courseSlugs: Object.freeze(['visby']),
  courseModels: Object.freeze({
    /* The card is the official SGF scorecard the club's own page embeds,
       independently reproduced by the club-linked Caddee page: all 18 pars,
       all 18 stroke indexes and all 108 tee lengths agree, the six printed
       tee totals reconcile, and the index is exactly the permutation 1..18.
       visbybuild/course.node-test.mjs gates every one of those values through
       the published pack, so the stroke index is verified. The hole LINES are
       not: they are source-traced corridors and are deliberately never
       stretched to the card length. */
    visby: Object.freeze({
      migration: 'course-model.epsg3006.json',
      strokeIndexStatus: 'verified',
    }),
  }),
  /* This ground's own terrain source ids: unlike every inland ground here it
     does not register a single 'terrain-lm-1m', because its window is cut
     from two named coastal items. publish-ground-rings records the ring
     evidence as derived from these, and the manifest refuses an id it does
     not carry. */
  terrainSourceIds: Object.freeze(['terrain-lm-636-68', 'terrain-lm-637-68']),
  tileSegments: 256,
  /* Lantmäteriet dtm-cog items are 10 km squares named <northing/10 km>_<easting/10 km> */
  dtm: Object.freeze({
    collection: 'dtm-cog',
    hrefTemplate: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif',
    itemMetres: 10000,
  }),
  levels: Object.freeze([
    Object.freeze({ lod: 0, sampleSpacingMetres: 1, tilesPerSide: 16, heightScaleMetres: 0.01, ...centred(2048), source: Object.freeze({ kind: 'published-and-dtm', factor: 1, subsample: 1 }) }),
    Object.freeze({ lod: 1, sampleSpacingMetres: 2, tilesPerSide: 8, heightScaleMetres: 0.02, ...centred(2048), source: Object.freeze({ kind: 'dtm', factor: 1, subsample: 2 }) }),
    Object.freeze({ lod: 2, sampleSpacingMetres: 4, tilesPerSide: 8, heightScaleMetres: 0.04, ...centred(4096), source: Object.freeze({ kind: 'dtm', factor: 4, subsample: 1 }) }),
    Object.freeze({ lod: 3, sampleSpacingMetres: 8, tilesPerSide: 8, heightScaleMetres: 0.08, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 8, subsample: 1 }) }),
    Object.freeze({ lod: 4, sampleSpacingMetres: 16, tilesPerSide: 4, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 16, subsample: 1 }) }),
    Object.freeze({ lod: 5, sampleSpacingMetres: 32, tilesPerSide: 2, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 1 }) }),
    Object.freeze({ lod: 6, sampleSpacingMetres: 64, tilesPerSide: 1, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 2 }) }),
  ]),
  /* The 16 km square is the west coast of Gotland: Kronholmen and Västergarn
     in the middle, the open Baltic filling everything west of the shore, and
     the flat limestone plain behind it to the east. The retained 4 km course
     window alone measures 0.10084 to 11.01286 m RH 2000 -- this is a links
     course a metre or two above the sea -- and the wider square adds only the
     island's low interior, so the band below is wide on purpose: wide enough
     to be no gate on the data, narrow enough that a wrong item (a mainland or
     Norrland square) or a decimetre-for-metre slip still fails. The acquire
     run prints each level's own extremes and those replace this note. */
  coverageGate: Object.freeze({ minimumHeightRH2000: -20, maximumHeightRH2000: 150, requireEverySampleFinite: true }),
  /* THIS GROUND IS MOSTLY SEA, and it is the first one here where that is
     true of the RINGS rather than of a corner of them.

     Markhöjdmodell tiles Sweden's land and the water the laser reached; it
     does not tile the open Baltic. West of Gotland that means whole 10 km
     squares simply do not exist: the STAC collection over this coast lists
     636_68, 636_69, 637_68, 637_69 and their neighbours to the east, and
     nothing at all in the *_67 column. The two coastal items the course
     itself sits on are not full squares either -- they are clipped to the
     shore.

     Measured by exact rectangle intersection of the items' own published
     `proj:bbox` extents against each ring, which is what matters because
     every level is gated separately:

       level(s)     ring       published   would need sea fill
        0, 1         4,096 m    100.00%       0.00%   <- all real data
        2            8,192 m     83.55%      16.45%
        3, 4, 5, 6  16,384 m     62.60%      37.40%

     Norrfällsviken's largest level measured 6.3% and it capped at 15%. Nearly
     forty per cent is a different regime, and the honest reading is that it
     is not an anomaly to be capped away: it is the Baltic, seen from a course
     whose own holes run along the beach. RH 2000 is referenced to mean sea
     level, so the surface out there is known rather than missing.

     MEASURED by acquire run 34203277715 (2026-09-08), which read all seven
     levels in 25 s and left EVERY sample of every level finite:

       lod  spacing  heights RH 2000     sea fill
        0    1 m     0.101 .. 11.013     none
        1    2 m     0.101 .. 10.967     none
        2    4 m     0.180 .. 19.191     1 component, 18.83%
        3    8 m     0.002 .. 58.157     1 component, 39.71%
        4   16 m     0.004 .. 58.089     1 component, 39.71%
        5   32 m     0.013 .. 57.723     1 component, 39.79%
        6   64 m     0.025 .. 57.649     1 component, 39.90%

     One component per level, and it is the Baltic: its boundary median is
     0.230 m RH 2000 at EVERY level, which is exactly the height of the sea
     plateau inside the course window measured independently from the
     published ground (8,766,382 of 16,785,409 samples at 0.230 m). Its
     boundary maximum is 0.230 m at lod 2 and 0.290 m at lod 3 and coarser,
     its water fraction 1.000 and then 0.836-0.839, and it is filled with
     0.230 m -- its own boundary's median, which is the sea's own level.

     The inherited 3 m ceiling was expected to refuse and did not: the west
     edge of the published items really is open water along its whole length,
     0.29 m at worst. So the thresholds below are this ground's own now, set
     from those numbers with stated headroom rather than carried from another
     coast, and every one of them is far below Gotland's interior at 58 m --
     which is the thing a lost LAND square would have to sneak past.

     What must NOT be relaxed is the discriminator. A component is filled only
     if it is bounded by water in the middle (MEDIAN, which a few mixed shore
     pixels cannot drag), mostly (fraction) and at the extreme (ceiling), and
     it is filled with the median of its OWN boundary rather than a constant.
     Gotland's interior rises tens of metres, so a missing LAND square fails
     all three of those at once -- which is the test that actually protects
     this, not the fraction cap. The cap below is set from the 40.2% measured
     here with headroom for the reader's own accounting, and its job is only
     to catch a delivery that lost most of the world.

     These boundary thresholds are the ones Norrfällsviken MEASURED on Baltic
     water in this same datum, carried here as the reviewed starting point
     because it is the nearest measurement that exists. build-ground-rings
     names the boundary median, the water fraction and the highest boundary
     sample of any component it refuses, so a run that fails here MEASURES
     this ground's own numbers and those replace these. A failure is the
     instrument: do not relax the rule to get past it, and never relax
     coverageGate.requireEverySampleFinite instead. */
  seaFill: Object.freeze({
    reason: 'Markhöjdmodell does not tile the open Baltic west of Gotland -- run 34203277715 confirmed both 636_67 and 637_67 answer 404 while all four of their eastern neighbours answer 200, and both coastal items are clipped 5,000 m off their west edge; RH 2000 is referenced to mean sea level',
    /* the sea plateau reads 0.230 m; this counts a boundary sample as water */
    boundaryWaterHeightRH2000: 0.35,
    /* THE discriminator. Measured 0.230 m at every level, against Gotland's
       interior at 58 m. The 0.25 m carried from Norrfällsviken passed with two
       centimetres to spare, which is too little to survive a re-fly; 0.5 m is
       still two orders of magnitude below anything that is not sea. */
    boundaryMedianMaximumHeightRH2000: 0.5,
    /* measured 1.000 at lod 2 and 0.836-0.839 at lod 3 and coarser */
    boundaryWaterMinimumFraction: 0.75,
    /* measured 0.230 m at lod 2 and 0.290 m at lod 3 and coarser. Tightened
       from the inherited 3 m, which was Norrfällsviken's measurement on a
       coast that rises to 90 m inside its course window; this one does not
       rise above 11 m inside its own, so a ceiling that loose gates nothing. */
    boundaryMaximumHeightRH2000: 1,
    /* measured 39.90% at the coarsest level; the cap catches a lost delivery,
       the boundary tests catch a lost land square */
    maximumFilledFraction: 0.5,
    provenance: 'every threshold measured on this ground by acquire run 34203277715 (2026-09-08); no value here is carried from another coast',
  }),
  /* BOTH COASTAL ITEMS STOP THEIR OVERVIEW CHAIN AT 16x. 636_68 and 637_68
     publish factors 1,2,4,8,16 while the inland 636_69 and 637_69 reach 32, so
     levels 5 and 6 -- which ask for 32 -- fall back over the coastal items to
     the finest coarser overview available and resample. That is the
     substitution build-ground-rings already carries and the reason it carries
     it; the acquisition evidence records the factor each item actually served
     per level (5:16 and 6:16 against 5:32 and 6:32), so it is visible rather
     than discovered later from a soft horizon. Both items are also cropped:
     636_68 by 5,000 m west and 5,000 m south, 637_68 by 5,000 m west. */
});
