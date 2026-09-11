/* Ängsö's rings on the standard topology (standard-ground-rings.mjs) -- and
   the ground the standard was taken from. Its played ground is 2,167 m long,
   so its 1 m level had to be sixteen tiles per side over 4,096 m with lod 1
   spanning the SAME square; every lod 1 tile still has exactly four lod 0
   children, which is the rule the plates bug taught, and it costs one extra
   doubling at the top rather than a half-covered coarse tile anywhere. Every
   other ground now shares that shape.

   FRAME_ORIGIN is the centre of the reviewed LOD0 window in
   angso-ground-graph.mjs, so lod 0 here and the published course terrain
   address the same lattice and publish-ground-rings can reuse the published
   1 m tiles byte for byte. The two must not be edited apart. */
import { ANGSO_GROUND_GRAPH_CONFIG } from './angso-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: ANGSO_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: ANGSO_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

export const ANGSO_GROUND_RINGS = standardGroundRings({
  groundId: 'angso',
  courseSlugs: ['angso'],
  courseModels: {
    /* All 126 card cells -- par, stroke index and five tee columns over
       eighteen holes -- are gated exactly by angsobuild/check3d.mjs against
       the club's published card, so par and stroke index are verified. The
       hole LINES are not: only four of the eighteen carry an OSM hole way and
       the rest are satellite traces slid to their card length. */
    angso: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' },
  },
  centre: FRAME_ORIGIN,
  /* The 16 km square runs from Mälaren's regulated surface -- the DTM reads
     the lake as a laser-flat 0.876 m RH 2000 inside the course's own western
     bay -- up onto the Västmanland till plain, and the retained 4 km course
     window measures -1.747 to 40.109 m. Nothing within 8 km of Stora Bodarna
     approaches a hundred metres, so this band is wide enough to be no gate on
     the data and narrow enough that a wrong item or a unit slip fails. */
  coverageGate: { minimumHeightRH2000: -10, maximumHeightRH2000: 200, requireEverySampleFinite: true },
});
