/* The nested resolution rings that make Upsala's v2 ground the ONLY ground:
   1 m over both courses, 2 m to 2 km, 4 m to 4 km, 8 m to 8 km, and 16 m and
   coarser to a 16 km root, every level cut from Lantmäteriet's Markhöjdmodell
   so nothing is ever stitched to the Terrarium field.

   The topology is Puttom's and is deliberately unchanged: eight tiles per side
   at every level down to lod 3, so each finer ring is exactly the middle four
   tiles of the next coarser one and a coarse tile is either wholly covered by
   finer tiles or not at all. The first Puttom cut used six-wide rings and the
   half-covered coarse tiles showed sky through the ground in tile-shaped
   plates; do not narrow these.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   upsala-ground-graph.mjs, so lod 0 here and the published course terrain
   address the same lattice and publish-ground-rings can reuse the published
   1 m tiles byte for byte. The two must not be edited apart.

   Håmö is inland farmland: the 16 km square reaches Ekoln in the south-east
   and the Uppsala plain in every other direction, and no level of it crosses a
   coastline. That is why the coverage band below is so much tighter than the
   coastal grounds' -- it is measured, not inherited. */
import { UPSALA_GROUND_GRAPH_CONFIG } from './upsala-ground-graph.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: UPSALA_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: UPSALA_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const UPSALA_GROUND_RINGS = Object.freeze({
  groundId: 'upsala',
  courseSlugs: Object.freeze(['upsala', 'upsala-mellanbanan']),
  /* Two courses share this ground and they do not share a card or a migration.
     Stora banan's 144 card values are gated exactly by upsalabuild/check3d.mjs,
     so its stroke index is verified. Mellanbanan's is the club's own banguide
     column, transcribed -- correct, but not gated, and a second valid odd
     1-17 permutation is in public circulation that disagrees with it on all
     nine holes, so no arithmetic check can tell them apart. */
  courseModels: Object.freeze({
    upsala: Object.freeze({
      migration: 'course-model.epsg3006.json',
      strokeIndexStatus: 'verified',
    }),
    'upsala-mellanbanan': Object.freeze({
      migration: 'mellanbanan-course-model.epsg3006.json',
      strokeIndexStatus: 'unverified',
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
  /* MEASURED, on a raster wider than the rings themselves. The legacy-field
     acquisition read a 32 m lattice out to +-10,784 m about this same origin
     -- half again the 8,192 m the 16 km root reaches -- and it runs
     0.7123-68.2051 m RH 2000 over all 455,625 samples. The band below clears
     that on both sides with room for the finer levels to find a ditch or a
     roof ridge the 32 m field averaged away, and is still tight enough that a
     wrong item, a nodata plane or a decimetre/metre unit slip fails loudly.
     Puttom's -5..400 and Veckefjärden's -10..400 would pass all three here. */
  coverageGate: Object.freeze({ minimumHeightRH2000: -5, maximumHeightRH2000: 120, requireEverySampleFinite: true }),
});
