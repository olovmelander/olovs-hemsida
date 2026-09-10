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
