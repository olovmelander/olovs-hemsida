/* Veckefjärden's rings on the standard topology (standard-ground-rings.mjs):
   1 m over the central 4,096 m, holding both courses, the reserve shore and
   the clubhouse, then 2, 4 and 8 m rings and the 16, 32 and 64 m shell to a
   16 km root, every level cut from Lantmäteriet's Markhöjdmodell so nothing
   is ever stitched to the Terrarium field.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   veckefjarden-ground-graph.mjs, so the standard's 1 m level and the
   published course terrain address the same lattice and publish-ground-rings
   carries the published 1 m tiles across byte for byte (they sit in the
   middle of the sixteen-wide level, columns and rows 4-11). The two must not
   be edited apart. */
import { VECKEFJARDEN_GROUND_GRAPH_CONFIG } from './veckefjarden-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: VECKEFJARDEN_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: VECKEFJARDEN_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

export const VECKEFJARDEN_GROUND_RINGS = standardGroundRings({
  groundId: 'veckefjarden',
  courseSlugs: ['veckefjarden', 'veckefjarden-korthalsbanan'],
  /* Two courses share this ground, and they do not share a migration file or a
     card. The Mästerskapsbanan's 144 card values are gated exactly by
     geobuild/check3d.mjs, so its stroke index is verified; the korthålsbanan
     publishes none at all -- the only column ever found for it was 1..9 in hole
     order, which is a scrape artifact, and an unrated short course having no
     index is the expected state rather than a gap. */
  courseModels: {
    veckefjarden: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' },
    'veckefjarden-korthalsbanan': { migration: 'short-course-model.epsg3006.json', strokeIndexStatus: 'not-applicable' },
  },
  centre: FRAME_ORIGIN,
  /* The 16 km square runs from the Gulf of Bothnia in the south-east to the
     High Coast hills: the retained 2 km course window alone measures
     0.164-151.461 m RH 2000, Åsberget's summit stands at 217 m two kilometres
     north of the 9th, and the sea is 0 by definition. This band is the same
     one Puttom's 16 km square carries 30 km east, widened at the bottom
     because Veckefjärden reaches real coastline where Puttom only grazes it. */
  coverageGate: { minimumHeightRH2000: -10, maximumHeightRH2000: 400, requireEverySampleFinite: true },
});
