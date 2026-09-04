/* The nested resolution rings that make Ängsö's v2 ground the ONLY ground:
   1 m over the whole course, 2 m across the same square, 4 m to 4 km, 8 m to
   8 km, and 16 m and coarser to a 16 km root, every level cut from
   Lantmäteriet's Markhöjdmodell so nothing is ever stitched to the Terrarium
   field.

   The topology is Puttom's and Veckefjärden's, with ONE difference that the
   course forces. Ängsö's played ground is 2,167 m long, so its 1 m level is
   sixteen tiles per side rather than eight; lod 1 therefore spans the SAME
   4,096 m as lod 0 instead of twice it. That is legal and deliberate -- every
   lod 1 tile still has exactly four lod 0 children, which is the rule the
   plates bug taught -- and it costs one extra doubling at the top rather than
   a half-covered coarse tile anywhere. From lod 2 up the rings are the usual
   eight per side, each finer ring exactly the middle four tiles of the next
   coarser one. Do not narrow these.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   angso-ground-graph.mjs, so lod 0 here and the published course terrain
   address the same lattice and publish-ground-rings can reuse the published
   1 m tiles byte for byte. The two must not be edited apart. */
import { ANGSO_GROUND_GRAPH_CONFIG } from './angso-ground-graph.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: ANGSO_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: ANGSO_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const ANGSO_GROUND_RINGS = Object.freeze({
  groundId: 'angso',
  courseSlugs: Object.freeze(['angso']),
  courseModels: Object.freeze({
    /* All 126 card cells -- par, stroke index and five tee columns over
       eighteen holes -- are gated exactly by angsobuild/check3d.mjs against
       the club's published card, so par and stroke index are verified. The
       hole LINES are not: only four of the eighteen carry an OSM hole way and
       the rest are satellite traces slid to their card length. */
    angso: Object.freeze({
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
    Object.freeze({ lod: 0, sampleSpacingMetres: 1, tilesPerSide: 16, heightScaleMetres: 0.01, ...centred(2048), source: Object.freeze({ kind: 'published-and-dtm', factor: 1, subsample: 1 }) }),
    Object.freeze({ lod: 1, sampleSpacingMetres: 2, tilesPerSide: 8, heightScaleMetres: 0.02, ...centred(2048), source: Object.freeze({ kind: 'dtm', factor: 1, subsample: 2 }) }),
    Object.freeze({ lod: 2, sampleSpacingMetres: 4, tilesPerSide: 8, heightScaleMetres: 0.04, ...centred(4096), source: Object.freeze({ kind: 'dtm', factor: 4, subsample: 1 }) }),
    Object.freeze({ lod: 3, sampleSpacingMetres: 8, tilesPerSide: 8, heightScaleMetres: 0.08, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 8, subsample: 1 }) }),
    Object.freeze({ lod: 4, sampleSpacingMetres: 16, tilesPerSide: 4, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 16, subsample: 1 }) }),
    Object.freeze({ lod: 5, sampleSpacingMetres: 32, tilesPerSide: 2, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 1 }) }),
    Object.freeze({ lod: 6, sampleSpacingMetres: 64, tilesPerSide: 1, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 2 }) }),
  ]),
  /* The 16 km square runs from Mälaren's regulated surface -- the DTM reads
     the lake as a laser-flat 0.876 m RH 2000 inside the course's own western
     bay -- up onto the Västmanland till plain, and the retained 4 km course
     window measures -1.747 to 40.109 m. Nothing within 8 km of Stora Bodarna
     approaches a hundred metres, so this band is wide enough to be no gate on
     the data and narrow enough that a wrong item or a unit slip fails. */
  coverageGate: Object.freeze({ minimumHeightRH2000: -10, maximumHeightRH2000: 200, requireEverySampleFinite: true }),
});
