/* Upsala's rings on the standard topology (standard-ground-rings.mjs): 1 m
   over the central 4,096 m of Håmö, holding both courses, then 2, 4 and 8 m
   rings and the 16, 32 and 64 m shell to a 16 km root, every level cut from
   Lantmäteriet's Markhöjdmodell so nothing is ever stitched to the Terrarium
   field.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   upsala-ground-graph.mjs, so the standard's 1 m level and the published
   course terrain address the same lattice and publish-ground-rings carries
   the published 1 m tiles across byte for byte (they sit in the middle of
   the sixteen-wide level, columns and rows 4-11). The two must not be edited
   apart.

   Håmö is inland farmland: the 16 km square reaches Ekoln in the south-east
   and the Uppsala plain in every other direction, and no level of it crosses
   a coastline. That is why the coverage band below is so much tighter than
   the coastal grounds' -- it is measured, not inherited. */
import { UPSALA_GROUND_GRAPH_CONFIG } from './upsala-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: UPSALA_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: UPSALA_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

export const UPSALA_GROUND_RINGS = standardGroundRings({
  groundId: 'upsala',
  courseSlugs: ['upsala', 'upsala-mellanbanan'],
  /* Two courses share this ground and they do not share a card or a migration. */
  courseModels: {
    upsala: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' },
    'upsala-mellanbanan': { migration: 'mellanbanan-course-model.epsg3006.json', strokeIndexStatus: 'unverified' },
  },
  centre: FRAME_ORIGIN,
  /* MEASURED, on a raster wider than the rings themselves. The legacy-field
     acquisition read a 32 m lattice out to +-10,784 m about this same origin
     -- half again the 8,192 m the 16 km root reaches -- and it runs
     0.7123-68.2051 m RH 2000 over all 455,625 samples. The band below clears
     that on both sides with room for the finer levels to find a ditch or a
     roof ridge the 32 m field averaged away, and is still tight enough that a
     wrong item, a nodata plane or a decimetre/metre unit slip fails loudly.
     Puttom's -5..400 and Veckefjärden's -10..400 would pass all three here. */
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 120, requireEverySampleFinite: true },
});
