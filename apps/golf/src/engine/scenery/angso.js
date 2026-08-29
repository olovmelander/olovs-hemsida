/* Ängsö's course-specific scenery.

   The clubhouse, from the club's own photograph. It is not one building but a
   Falu red COURTYARD -- which the model already knew and nobody had read: OSM
   carries three separate footprints all named "Ängsö GK Klubbhus" (546, 165 and
   123 m2), and the photograph shows exactly that, a yard of red timber ranges
   with the golf trolleys parked in the middle of it.

   Red panel walls with white window frames and white corner boards, under
   TERRACOTTA PANTILE roofs -- the bright orange of a Mälardalen farm, not the
   dark roof of the northern clubs. A storey and a half, with dormer windows in
   the roof pitch and a white-railed balcony over the entrance.

   The engine draws the largest footprint as the clubhouse; the other two come
   through the generic buildings pass and read as the outbuildings they are. */
export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött */
  roof: 0xc0552c,          /* terracotta pantile */
  height: 5.0,             /* a storey and a half, dormers in the pitch */
  windowRows: [1.4, 3.6],
  terrace: true,
};
