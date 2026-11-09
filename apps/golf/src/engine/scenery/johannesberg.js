/* Johannesberg's course-specific scenery.

   Worth being careful here, because two buildings could be called "the
   clubhouse" and only one of them is. The aerial shows a white multi-storey
   manor with a dark roof and a turreted centre standing east of the course --
   that is Johannesberg herrgård, the hotel, and it is NOT the golf clubhouse.
   The clubhouse is the long low Falu red range west of it, at the model's
   "klubbhus" footprint, under an orange-red tile roof: red walls, white window
   frames, a storey and a half, facing the practice ground and the 18th.

   The verified Blender asset replaces the exact source IDs of the clubhouse
   and estate buildings together. This appearance spec remains the fallback
   when that asset is unavailable; the name match still distinguishes the golf
   clubhouse from the manor. */
export { applyGroundSurfaceReview, groundAppearance } from './johannesberg-ground-surfaces.mjs';
export { applyWaterSourceReview, reviewedWaterLevel, deferWaterBedToWorld } from './johannesberg-water.mjs';
import roofColours from './johannesberg-roof-colours.json' with { type: 'json' };

/* The houses on Johannesberg's ground are drawn with the house kit (engine/house-kit.mjs; owner request,
   9 November: "Can we fix all the buildings in Johannesberg now"): a plinth, eaves and gables, and windows,
   doors and the rest modelled in Blender on each mapped footprint. The clubhouse, the manor and the estate
   buildings keep the verified Blender asset below.
   Each roof takes its colour from Lantmäteriet's June 2025 orthophoto (geobuild/facilities/roof-colours.py;
   Ortofoto Nedladdning © Lantmäteriet, CC BY 4.0; 288 of 307 footprints, the course shifted 0.96 m east and
   1.28 m north onto its roofs) unless this module states it; the walls keep the palette. */
export const houseKit = true;
export { roofColours };
/* What this ground knows of single buildings, where the kit's guess was wrong (engine/house-kit.mjs
   houseKitBuildings). OpenStreetMap tags the horse farm 1 km west of the course (SWEREF 99 TM about
   E 678560, N 6624935) as three residential buildings, two of them close enough to be drawn as blocks of
   flats. Lantmäteriet's June 2025 and April 2021 orthophotos show two long stables, one beside the riding
   arena and one across the road, and a farmhouse at the arena's east side. */
export const houseKitBuildings = {
  w378947925: { type: 'barn' },
  w378947846: { type: 'barn' },
  w378947829: { type: 'villa' },
};

export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött */
  roof: 0xb4502c,          /* orange-red tile */
  height: 4.6,             /* a storey and a half */
  windowRows: [1.5],
  terrace: true,
};

export async function loadFacilities(context) {
  const { loadJohannesbergFacilities } = await import('./johannesberg-facilities.mjs');
  return loadJohannesbergFacilities(context);
}
