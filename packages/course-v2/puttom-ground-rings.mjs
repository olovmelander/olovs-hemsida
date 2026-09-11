/* Puttom's rings on the standard topology (standard-ground-rings.mjs): 1 m
   over the central 4,096 m, then 2, 4 and 8 m rings and the 16, 32 and 64 m
   shell to a 16 km root, every level cut from Lantmäteriet's Markhöjdmodell
   so nothing is ever stitched to the Terrarium field.

   This was the first ring ground and the one whose first cut taught the
   whole-tile rule (six-wide rings, sky through the ground in tile-shaped
   plates), and until 2026-09-11 its 1 m level was eight tiles per side over
   2,048 m. The 64 published course tiles stay exactly where they are -- in
   the middle of the sixteen-wide standard level, at columns and rows 4-11
   -- and publish-ground-rings carries their heights across byte for byte.

   FRAME_ORIGIN is the centre of the reviewed course window, which is also
   the published graph's frame origin; it must not move. */
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({ easting: 697428.5, northing: 7024826.5 });

export const PUTTOM_GROUND_RINGS = standardGroundRings({
  groundId: 'puttom',
  courseSlugs: ['puttom'],
  courseModels: {
    /* The 144 card cells are gated exactly by puttombuild/check3d.mjs against
       the club's card (two aggregators; the club's own LiveCaddie card swaps
       the 11th's and 16th's index, recorded and left for the owner). */
    puttom: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' },
  },
  centre: FRAME_ORIGIN,
  /* a healthy compile lands inside this band: Puttom's ground runs 26-103 m
     over the course and the 16 km square reaches the coast to the south-east */
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 400, requireEverySampleFinite: true },
});

/* The generic helpers were written beside this spec and are re-exported so
   nothing that imported them from here breaks; they live in the standard now. */
export { dtmItemsFor, ringLevelExtent } from './standard-ground-rings.mjs';
