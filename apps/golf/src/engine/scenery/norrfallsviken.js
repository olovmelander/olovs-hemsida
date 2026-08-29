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
