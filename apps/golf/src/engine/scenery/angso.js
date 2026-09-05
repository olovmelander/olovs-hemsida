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

/* "Sikta på det lilla röda huset i horisonten" -- the club's own aiming line on
   the 5th. Of every building within twelve degrees of the hole's last leg
   (bearing 142), the one on the axis is OSM way 215457959: a 168 m2 building
   standing twenty metres from the shore of the eastern bay, 792 m from the
   tee, 2.2 degrees off the line, with the open water between. The imagery
   gives it a dark roof and no more; the club's text gives it its colour. */
export const buildingLooks = {
  w215457959: { wall: 0x8b3a2c, roof: 0x3d3f43 },
};

/* The woods here are Mälardalen's, not the High Coast's: leaf-off imagery over
   the course shows bare deciduous crowns through most of the stands with dark
   conifers among them, and the low shore plain by the lake -- reeds, then
   alder and birch -- carries almost no pine at all. The SPECIES table has no
   alder or oak, so birch stands in for both, as it does at Veckefjärden.
   Ids: 0 spruce, 1 pine, 2 birch. h is the ground height in RH 2000 now that
   the pack is re-grounded; the shore plain lies under 3 m. */
export function species({ r, h }) {
  if (h < 3) return r < 0.72 ? 2 : 0;
  return r < 0.36 ? 0 : r < 0.68 ? 1 : 2;
}

/* Ängsö slott and its church stand on the island 4.5 km south, and the
   published laser ground says the terrain line of sight from the clubhouse,
   the 3rd green and the 6th tee is clear -- it runs over open Mälaren. Without
   a clearing the far scatter's stand-in conifers bury both. */
export const clearings = [
  { c: [-777, 4563], r: 110, wobble: 40 },
  { c: [-877, 4512], r: 60, wobble: 20 },
];

/* Footprints from OpenStreetMap ways 215052664 (the castle) and 215052661
   (the church), projected through the pack's own frame. */
const SLOTT = [[-769.6, 4579.3], [-793, 4569.4], [-783.6, 4547.1], [-760.2, 4557]];
const KYRKA = [[-872.1, 4515.8], [-871.5, 4522.7], [-881.8, 4523.6], [-882.3, 4516.9], [-893.1, 4517.8], [-893.8, 4509.2],
  [-883.5, 4508.4], [-884.2, 4501], [-872.2, 4500], [-871.8, 4507.4], [-860.7, 4506.6], [-858.9, 4511], [-860.2, 4514.9]];

export function build(ctx) {
  const { quad, tri, demH, L, stats } = ctx;
  const before = stats.draws;
  const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  /* a walled block on its footprint: walls to `height`, a hipped roof `rise`
     higher meeting at the centroid, a plinth sunk into the ground so a sloping
     site never shows daylight under a wall */
  const block = (ring, height, rise, wall, roof) => {
    const c = centroid(ring);
    const y0 = Math.min(...ring.map(p => demH(p[0], p[1]))) - 0.6;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + height, b[1]], [a[0], y0 + height, a[1]], wall);
      tri([a[0], y0 + height, a[1]], [b[0], y0 + height, b[1]], [c[0], y0 + height + rise, c[1]], roof);
    }
    return y0;
  };
  /* Ängsö slott: the square medieval keep rebuilt as a baroque block in the
     1740s, plastered pale, three tall storeys under a hipped roof. Whitewashed
     is the one thing every description agrees on; the roof reads dark from the
     imagery. Nothing finer is visible at four kilometres. */
  block(SLOTT, 14, 6, L(0xe6dfcb), L(0x45474b));
  /* Ängsö kyrka: the medieval church beside it, white, with a tower at its
     west end under a dark spire -- drawn low and plain, a white shape under a
     dark roof against the island's treeline, which is all the distance keeps. */
  const y0 = block(KYRKA, 7.5, 3.5, L(0xece8dc), L(0x3f3a36));
  {
    const west = KYRKA.reduce((m, p) => (p[0] < m[0] ? p : m), KYRKA[0]);
    const tx = west[0] + 5, tz = west[1], hw = 4.5;
    const sq = [[tx - hw, tz - hw], [tx + hw, tz - hw], [tx + hw, tz + hw], [tx - hw, tz + hw]];
    for (let i = 0; i < 4; i++) {
      const a = sq[i], b = sq[(i + 1) % 4];
      quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + 16, b[1]], [a[0], y0 + 16, a[1]], L(0xece8dc));
      tri([a[0], y0 + 16, a[1]], [b[0], y0 + 16, b[1]], [tx, y0 + 30, tz], L(0x2e2b29));
    }
  }
  /* "Gå över enen om du ska in på två": the juniper on the 18th. The z18
     imagery shows one lone dark columnar tree at (-253, 109) on the fairway's
     right edge, level with the two ponds, exactly where a second shot from the
     right side of the landing area has to carry it. Two crossed dark-green
     rhombi, 4.5 m tall and 1.6 m wide, the way a juniper reads from a tee. */
  {
    const x = -253, z = 109, y = demH(x, z) - 0.1, H = 4.5, W = 0.8;
    const J = L(0x2f4a2a);
    for (const [ax, az] of [[1, 0], [0, 1], [0.7, 0.7], [-0.7, 0.7]]) {
      quad([x - ax * W, y, z - az * W], [x + ax * W, y, z + az * W], [x + ax * 0.15, y + H, z + az * 0.15], [x - ax * 0.15, y + H, z - az * 0.15], J);
    }
  }
  return stats.draws - before;
}
