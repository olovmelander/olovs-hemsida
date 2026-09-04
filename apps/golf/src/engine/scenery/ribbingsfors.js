/* Ribbingsfors Golf & Kultur's course-specific scenery.

   The clubhouse appearance is taken only as a visual reference from the club's
   own 2024 photograph:
   https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1673_fullres-scaled.jpg

   It is a long, simple timber building in the Ribbingsfors manor environment:
   pale warm-yellow vertical boarding with light grey-white corner boards and
   window trim, beneath a low red-orange clay-tile gable roof. The photograph
   also shows a brick chimney, grey-painted multipane openings and a timber
   terrace along the long facade. Only the palette and supported generic
   clubhouse traits are encoded here; the photograph is not redistributed. */
export const clubhouse = {
  wall: 0xcdbb86,          /* pale warm-yellow timber */
  roof: 0xa44f32,          /* red-orange clay tile */
  height: 3.8,             /* one storey with usable space beneath the gable */
  windowRows: [1.3],
  gable: true,
  terrace: true,
};
