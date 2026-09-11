/* Johannesberg's rings on the standard topology (standard-ground-rings.mjs):
   1 m over the central 4,096 m, holding both courses, the manor and the
   range, then 2, 4 and 8 m rings and the 16, 32 and 64 m shell to a 16 km
   root, every level cut from Lantmäteriet's Markhöjdmodell.

   Until 2026-09-11 this ground was a FIXED FRONTIER: the 64 published 1 m
   tiles of the reviewed 2,048 m window inside a legacy Terrarium world, with
   a 72 m height blend at the edge. Those 64 tiles sit in the middle of the
   standard's sixteen-wide level (columns and rows 4-11) and are carried
   across byte for byte; the ring adapter then serves the whole world and the
   blend has nothing left to blend.

   FRAME_ORIGIN is the centre of the reviewed window in
   johannesberg-ground-graph.mjs -- the published frame origin, DERIVED from
   the played ground of both courses. The two must not be edited apart.

   The window straddles E 680000, where item 662_67 (2021) meets 662_68
   (2023): measured across the seam the first difference is 0.075 m against
   0.082 and 0.085 for control columns either side, smaller than the terrain's
   own roughness, so the rings read both items as one surface. */
import { JOHANNESBERG_GROUND_GRAPH_CONFIG } from './johannesberg-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: JOHANNESBERG_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: JOHANNESBERG_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

export const JOHANNESBERG_GROUND_RINGS = standardGroundRings({
  groundId: 'johannesberg',
  courseSlugs: ['johannesberg', 'johannesberg-9'],
  /* Two courses share this ground and they do not share a card or a
     migration. The eighteen's hole lines are satellite traces routed by the
     club's 2026 banguide and the nine's are published GPS routes; neither is
     a surveyed intake, which is what the fixed-frontier compiler published
     as `strokeIndexStatus: 'unverified'` at accuracy tier D, and the rings
     keep both. */
  courseModels: {
    johannesberg: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'unverified', accuracyTier: 'D' },
    'johannesberg-9': { migration: 'nine-course-model.epsg3006.json', strokeIndexStatus: 'unverified', accuracyTier: 'D' },
  },
  centre: FRAME_ORIGIN,
  /* MEASURED on the reviewed 2 km window: 9.881 to 44.874 m RH 2000 over all
     4,198,401 samples (terrain-window.json, reviewed band 0..90). The 16 km
     square is Uppland parkland and farmland between Norrtälje's lakes and
     the Vallentuna plain; nothing in it approaches a hundred metres, and the
     laser reads the lakes as flat plates a few metres up. The band clears the
     measured window with room for the rings' own hills and ditches and still
     fails a wrong item, a nodata plane or a unit slip. */
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 150, requireEverySampleFinite: true },
});
