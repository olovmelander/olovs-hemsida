/* The nested resolution rings that would make Lidingö's v2 ground the ONLY
   ground: 1 m over the course, 2 m to 2 km, 4 m to 4 km, 8 m to 8 km, and
   16 m and coarser to a 16 km root, every level cut from Lantmäteriet's
   Markhöjdmodell so nothing is ever stitched to a coarser field.

   The topology is Veckefjärden's, unchanged: eight tiles per side down to
   lod 3, so each finer ring is exactly the middle four tiles of the next
   coarser one and a coarse tile is either wholly covered by finer tiles or
   not at all. The first Puttom cut used six-wide rings and the half-covered
   coarse tiles showed sky through the ground in tile-shaped plates; do not
   narrow these.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   lidingo-ground-graph.mjs -- which is also the course's canonical origin --
   so lod 0 here and the published course terrain address the same lattice and
   publish-ground-rings can reuse the published 1 m tiles byte for byte. The
   two must not be edited apart.

   All nine 10 km squares the 16 km root needs (657/658/659 x 66/67/68) are
   published: the STAC collection lists every one of them over the Stockholm
   inner archipelago, so unlike Norrfällsviken this ground has no unpublished
   open-water square. What it does share with Norrfällsviken is the SEA, and
   that is why seaFill is declared -- see the note on the rule below.         */
import { LIDINGO_GROUND_GRAPH_CONFIG } from './lidingo-ground-graph.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: LIDINGO_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: LIDINGO_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const LIDINGO_GROUND_RINGS = Object.freeze({
  groundId: 'lidingo',
  courseSlugs: Object.freeze(['lidingo']),
  courseModels: Object.freeze({
    /* The card is the club's own published scorecard, transcribed value by
       value: all 90 tee distances, all 18 pars and a stroke index that is
       exactly the permutation 1..18, with every printed out/in/total sum
       reconciled. lidingobuild/course.node-test.mjs gates those sums, so the
       stroke index is verified. The hole LINES are not: they are the dated
       OSM golf=hole ways, and they are deliberately never extended to the
       card length. */
    lidingo: Object.freeze({
      migration: 'course-model.epsg3006.json',
      strokeIndexStatus: 'verified',
    }),
  }),
  tileSegments: 256,
  /* Lantmäteriet dtm-cog items are 10 km squares named <northing/10 km>_<easting/10 km> */
  dtm: Object.freeze({
    collection: 'dtm-cog',
    hrefTemplate: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif',
    itemMetres: 10000,
  }),
  levels: Object.freeze([
    Object.freeze({ lod: 0, sampleSpacingMetres: 1, tilesPerSide: 8, heightScaleMetres: 0.01, ...centred(1024), source: Object.freeze({ kind: 'published-and-dtm', factor: 1, subsample: 1 }) }),
    Object.freeze({ lod: 1, sampleSpacingMetres: 2, tilesPerSide: 8, heightScaleMetres: 0.02, ...centred(2048), source: Object.freeze({ kind: 'dtm', factor: 1, subsample: 2 }) }),
    Object.freeze({ lod: 2, sampleSpacingMetres: 4, tilesPerSide: 8, heightScaleMetres: 0.04, ...centred(4096), source: Object.freeze({ kind: 'dtm', factor: 4, subsample: 1 }) }),
    Object.freeze({ lod: 3, sampleSpacingMetres: 8, tilesPerSide: 8, heightScaleMetres: 0.08, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 8, subsample: 1 }) }),
    Object.freeze({ lod: 4, sampleSpacingMetres: 16, tilesPerSide: 4, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 16, subsample: 1 }) }),
    Object.freeze({ lod: 5, sampleSpacingMetres: 32, tilesPerSide: 2, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 1 }) }),
    Object.freeze({ lod: 6, sampleSpacingMetres: 64, tilesPerSide: 1, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 2 }) }),
  ]),
  /* The 16 km square is the Stockholm inner archipelago: Lidingö itself, the
     Värtan and Askrikefjärden either side of it, Nacka's höjder to the south
     and the Danderyd/Täby ground to the north. The retained 2 km course
     window measures -0.047 to 61.140 m RH 2000 and nothing within eight
     kilometres of the clubhouse comes near two hundred metres, so this band
     is wide enough to be no gate on the data and narrow enough that a wrong
     item or a unit slip fails. */
  coverageGate: Object.freeze({ minimumHeightRH2000: -10, maximumHeightRH2000: 200, requireEverySampleFinite: true }),
  /* Lidingö is an island, so the coarse rings run out over open Baltic water
     where Markhöjdmodell may carry nodata rather than a flattened surface --
     the behaviour Norrfällsviken measured on its own coastal item.

     These thresholds are the ones Norrfällsviken MEASURED on Baltic water in
     this same RH 2000 datum, carried here as the reviewed starting point
     because it is the nearest measurement that exists, not because they are
     known to hold on this ground. They are deliberately not widened in
     advance: build-ground-rings names the boundary median, the water fraction
     and the highest boundary sample of any component it refuses, so a run
     that fails here MEASURES this ground's own numbers and those replace
     these. A failure is the instrument; do not relax the rule to get past it,
     and never relax coverageGate.requireEverySampleFinite instead. */
  seaFill: Object.freeze({
    reason: 'Markhöjdmodell may not tile the open Baltic around Lidingö; RH 2000 is referenced to mean sea level',
    boundaryWaterHeightRH2000: 0.25,
    boundaryMedianMaximumHeightRH2000: 0.25,
    boundaryWaterMinimumFraction: 0.75,
    boundaryMaximumHeightRH2000: 3,
    maximumFilledFraction: 0.15,
    provenance: 'thresholds measured at Norrfällsviken on the same datum; pending this ground\'s own measurement',
  }),
});
