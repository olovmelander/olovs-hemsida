/* Norrfällsviken's course-specific scenery.

   Its two bespoke landmarks -- the 1649 chapel on its OSM footprint, and the
   boats moored along the marina piers -- are still drawn inline in main.js
   behind the feature guards they were written with. They render correctly
   there, and moving working code for symmetry is how a refactor turns into a
   regression; they come across when something asks them to. What is here is
   the one piece of this course's truth that the shared engine WAS carrying,
   and had no business carrying: the clearing in the far-vista forest. */

/* The chapel green and the harbour front are village lawn and bare rock, not
   forest. This is true of the place, and it is why the guard was written -- but
   it is currently INERT here, and saying so is the point of the note: the far
   scatter only runs outside the tree-cover raster's box, and at Norrfällsviken
   this point lies inside it, where the satellite raster already decides what
   grows. It is kept because the fact does not stop being true when the box
   moves, and because leaving it in the engine meant five other courses got a
   bald patch at Norrfällsviken's coordinate -- at Upsala, a real one. */
export const clearings = [
  { c: [-551, 1161], r: 90, wobble: 30 },
];

/* The clubhouse, from the club's own photograph.

   These notes previously said "cream walls, red roof", which is the wrong way
   round: it is a Falu red timber building with WHITE window frames and corner
   boards under a dark red-brown roof, single storey, with a glazed veranda and
   a railed terrace standing above the green it looks over. Aerial imagery gives
   a roof and never a facade -- this one needed a picture from the ground. */
export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött */
  roof: 0x5c3a30,          /* dark red-brown */
  height: 3.6,             /* one storey; the terrace does the rest */
  windowRows: [1.3],
  terrace: true,
};
