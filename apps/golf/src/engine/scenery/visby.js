/* Visby GK / Kronholmen — the things about this place that are not data.

   Everything here comes from photographs or from the orthophoto, and each line
   says which. Aerial imagery gives a roof and never a facade, which is the rule
   that has already put a blue lower storey on Puttom's red clubhouse and a dark
   shingle roof on Norrfällsviken's tiled chapel; so roof colour, roof shape and
   the terrace are read off the 0.16 m 2026 flight, and wall colour, storeys and
   glazing come from daylight ground photographs and from nowhere else.        */

/* THE CLUBHOUSE, from three daylight photographs of the whole building and its
   terrace facade (semesterisverige.nu, April 2023) and the club's own daylight
   aerial. NOT from the club's own hero shot of it, which is taken at the blue
   hour: that one gives shape and nothing about colour.

   Smooth WHITE RENDER, not timber boarding — the render texture is visible and
   there are no board lines, and the measured pixels run rgb(129,136,149) in soft
   light with a cool cast, which is what ambient sky does to white render. The
   roof is dark blue-grey profiled SHEET METAL, ribs running down a steep pitch,
   measured rgb(37,46,59) sunlit and rgb(34,58,85) from the air — not pantile,
   not shingle, and nothing like the terracotta this engine defaults to. Two
   storeys at the west gable block, dropping to one and an attic eastward, so
   the window rows are set for two.

   The terrace is the building's whole point: a raised deck along the entire sea
   front on a low retaining wall of flat pale Gotland limestone, facing broadly
   west-south-west over the putting course to the sea — the club's own words are
   "utsikten mot Karlsöarna ifrån uteserveringen". `terrace: true` is the
   engine's own apron and bench, which is exactly right here. */
export const clubhouse = {
  wall: 0xe8e7e2,          /* white render */
  roof: 0x38414d,          /* dark blue-grey profiled sheet metal */
  height: 6.4,             /* two storeys at the west gable block */
  windowRows: [1.5, 4.2],
  terrace: true,
};

/* THE LIGHTHOUSE STATION BY THE FIRST TEE, which the model carried as two
   anonymous houses and a gap where a lighthouse is.

   Skansudde fyrplats: a light of 1890, the keeper's dwelling of 1892, the
   station manned until 1938 and — sv.wikipedia — "har omgetts av Visby
   golfklubb sedan 1958, som tidigare använde boningshuset som klubbhus". The
   dwelling is let today as Fyrhuset and stands twenty metres from the 1st tee,
   which is the view a visitor gets first, since the app opens on the tee.

     way/530655632, 117 m2 — Fyrhuset, the 1892 keeper's house. Falu-red
       VERTICAL BOARD timber with white window frames, white corner boards and
       white bargeboards (Wikimedia Commons, "Skansudde fyr October 2023",
       measured rgb(111,64,59) sunlit), under a near-black gabled roof. A glazed
       veranda of small white panes runs the full sea-facing side and the
       orthophoto shows exactly that strip. sv.wikipedia on the 1892 house:
       "rödfärgades med blyvita snickerier".
     way/530655633, 82 m2 — the station outbuilding. WHITE board-and-batten with
       white trim under a near-black roof (same Commons set).

   The engine's generic pass would paint both from its neighbourhood rule, which
   knows nothing about either. */
export const buildingLooks = {
  'way/530655632': { wall: 0x8f4a41, roof: 0x2b2d30 },
  'way/530655633': { wall: 0xe9e7e0, roof: 0x2b2d30 },
};

/* The 1936 tower itself is NOT a footprint in OpenStreetMap — too small to be
   mapped — so it is drawn here, at a position measured off the orthophoto: the
   only white thing on the point, a compact bright blob whose centre is stable
   to 0.03 m across three brightness cuts at local (-603.3, 190.4), p90 radius
   2.2 m. A white painted concrete cylinder with a white railed gallery, a
   polygonal lantern house and a white conical roof (Commons, daylight).

   ITS HEIGHT IS NOT MEASURED. The 1890 tower it replaced was 10.4 m; a shadow
   reading was attempted and refused, because this is a rocky shore where the
   dark mask is rocks and water as much as shadow and the flight's capture time
   is not published. 9 m is an assumption and is written down as one. */
const TOWER = [-603.3, 190.4];
const TOWER_RADIUS = 2.2;
const TOWER_HEIGHT = 9.0;     /* assumed, not measured -- see above */

/* Kronholmen's woods are Gotland's: pine over limestone, with juniper under it
   and birch and rowan where the ground is damp or sheltered. Three records
   agree and none of them is a guess about Sweden in general. OSM's own forest
   here carries `leaf_type=needleleaved`. The published LiDAR generation's 3,040
   crowns measure a median height of 10.9 m at a median crown radius of 4.6 m --
   a radius-to-height ratio of 0.42, which is a broad pine or a broadleaf and is
   nothing like a spruce's 0.2. And the reserve texts for this coast name tall
   och en, not gran. The engine's default is a pine mix with more than a quarter
   spruce; here spruce is the rare one, and the birch share rises on the low
   ground near the shore, where this course spends most of its time.
   Ids: 0 spruce, 1 pine, 2 birch. */
export function species({ r, h }) {
  if (h < 2.5) return r < 0.52 ? 1 : r < 0.94 ? 2 : 0;
  return r < 0.74 ? 1 : r < 0.94 ? 2 : 0;
}

export function build(ctx) {
  const { quad, tri, demH, L, stats } = ctx;
  const before = stats.draws;
  const WHITE = L(0xf0eeea), SHADE = L(0xd8d6d2), DARK = L(0x33363b);
  const base = demH(TOWER[0], TOWER[1]) - 0.4;
  const ring = (radius, sides) => Array.from({ length: sides }, (unused, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return [TOWER[0] + Math.cos(angle) * radius, TOWER[1] + Math.sin(angle) * radius];
  });
  /* the shaft: a twelve-sided cylinder reads round from any distance a golfer
     stands at, and alternating the two whites gives it the shading a flat-lit
     cylinder otherwise never gets */
  const shaft = ring(TOWER_RADIUS, 12);
  for (let index = 0; index < shaft.length; index++) {
    const a = shaft[index], b = shaft[(index + 1) % shaft.length];
    quad([a[0], base, a[1]], [b[0], base, b[1]],
         [b[0], base + TOWER_HEIGHT, b[1]], [a[0], base + TOWER_HEIGHT, a[1]], index % 2 ? SHADE : WHITE);
  }
  /* the gallery: a wider deck with a railing, the step every one of these towers
     has under its lantern */
  const gallery = ring(TOWER_RADIUS + 0.7, 12), top = base + TOWER_HEIGHT;
  for (let index = 0; index < gallery.length; index++) {
    const a = gallery[index], b = gallery[(index + 1) % gallery.length];
    quad([a[0], top, a[1]], [b[0], top, b[1]], [b[0], top + 0.25, b[1]], [a[0], top + 0.25, a[1]], WHITE);
    quad([a[0], top + 0.45, a[1]], [b[0], top + 0.45, b[1]], [b[0], top + 1.0, b[1]], [a[0], top + 1.0, a[1]], WHITE);
  }
  /* the lantern house and its conical roof with the vent finial */
  const lantern = ring(TOWER_RADIUS - 0.3, 8), sill = top + 0.25;
  for (let index = 0; index < lantern.length; index++) {
    const a = lantern[index], b = lantern[(index + 1) % lantern.length];
    quad([a[0], sill, a[1]], [b[0], sill, b[1]], [b[0], sill + 2.1, b[1]], [a[0], sill + 2.1, a[1]], DARK);
    tri([a[0], sill + 2.1, a[1]], [b[0], sill + 2.1, b[1]], [TOWER[0], sill + 3.5, TOWER[1]], WHITE);
  }
  return stats.draws - before;
}
