/* The nested resolution rings that make Veckefjärden's v2 ground the ONLY
   ground: 1 m over both courses, 2 m to 2 km, 4 m to 4 km, 8 m to 8 km, and
   16 m and coarser to a 16 km root, every level cut from Lantmäteriet's
   Markhöjdmodell so nothing is ever stitched to the Terrarium field.

   The topology is Puttom's and is deliberately unchanged: eight tiles per
   side at every level down to lod 3, so each finer ring is exactly the middle
   four tiles of the next coarser one and a coarse tile is either wholly
   covered by finer tiles or not at all. The first Puttom cut used six-wide
   rings and the half-covered coarse tiles showed sky through the ground in
   tile-shaped plates; do not narrow these.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   veckefjarden-ground-graph.mjs, so lod 0 here and the published course
   terrain address the same lattice and publish-ground-rings can reuse the
   published 1 m tiles byte for byte. The two must not be edited apart. */
import { VECKEFJARDEN_GROUND_GRAPH_CONFIG } from './veckefjarden-ground-graph.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: VECKEFJARDEN_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: VECKEFJARDEN_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const VECKEFJARDEN_GROUND_RINGS = Object.freeze({
  groundId: 'veckefjarden',
  courseSlugs: Object.freeze(['veckefjarden', 'veckefjarden-korthalsbanan']),
  /* Two courses share this ground, and they do not share a migration file or a
     card. The Mästerskapsbanan's 144 card values are gated exactly by
     geobuild/check3d.mjs, so its stroke index is verified; the korthålsbanan
     publishes none at all -- the only column ever found for it was 1..9 in hole
     order, which is a scrape artifact, and an unrated short course having no
     index is the expected state rather than a gap. */
  courseModels: Object.freeze({
    veckefjarden: Object.freeze({
      migration: 'course-model.epsg3006.json',
      strokeIndexStatus: 'verified',
    }),
    'veckefjarden-korthalsbanan': Object.freeze({
      migration: 'short-course-model.epsg3006.json',
      strokeIndexStatus: 'not-applicable',
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
  /* The 16 km square runs from the Gulf of Bothnia in the south-east to the
     High Coast hills: the retained 2 km course window alone measures
     0.164-151.461 m RH 2000, Åsberget's summit stands at 241 m two kilometres
     north of the 9th, and the sea is 0 by definition. This band is the same
     one Puttom's 16 km square carries 30 km east, widened at the bottom
     because Veckefjärden reaches real coastline where Puttom only grazes it. */
  coverageGate: Object.freeze({ minimumHeightRH2000: -10, maximumHeightRH2000: 400, requireEverySampleFinite: true }),
});
