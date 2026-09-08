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
   storeys at one gable block, dropping to one and an attic, so the window rows
   are set for two.

   WHICH gable block is not established, and an earlier note here said "the west
   one" from a photograph nobody could orient. The footprint settles the shape
   and refuses the compass: OSM way 530655631 measures 28.8 m east-west by
   38.2 m north-south with its long axis on bearing 156°, so this complex runs
   NNW-SSE and its ends are north and south. Nothing here needs to know which:
   the engine picks the glazed end from where the course is, never from a
   coordinate.

   The terrace is the building's whole point: a raised deck along the entire sea
   front on a low retaining wall of flat pale Gotland limestone, looking out
   over the putting course to the water. The club names the view — "utsikten mot
   Karlsöarna ifrån uteserveringen" — and from this footprint Stora and Lilla
   Karlsö bear 206° and 211° at 16-19 km while Västergarns utholme, which the
   club names in the same breath for Fyrhuset, bears 255° at 1.1 km. So the arc
   is west round to south-south-west, not the flat "west-south-west" this note
   used to give. `terrace: true` is the engine's own apron and bench, which is
   exactly right here. */
export const clubhouse = {
  wall: 0xe8e7e2,          /* white render */
  roof: 0x38414d,          /* dark blue-grey profiled sheet metal */
  height: 6.4,             /* two storeys at the west gable block */
  windowRows: [1.5, 4.2],
  terrace: true,
};

/* THE LIGHTHOUSE STATION BY THE FIRST TEE, which the model carried as two
   anonymous houses and a gap where a lighthouse is.

   Skansudde fyrplats stands twenty metres from the 1st tee, which is the view a
   visitor gets first because the app opens there. sv.wikipedia's own photo
   caption names all three structures in order -- "Fyrplatsen 2023 med från
   vänster bostadshuset, den gamla fyren och längst till höger den nya
   betongfyren" -- and that, with fyrwiki, is what the colours below rest on:

     1890, "den gamla fyren" and still standing ("Den första, ännu bevarade
       fyren"): not a tower at all but a combined light-and-dwelling in timber,
       "Vitt fyrhus med utbyggnad på gaveln", its seaward gable carrying a
       burspråk with a 5th-order fyrlykta. WHITE. This is the building the club
       lets as FYRHUSET -- helagotland, 2016: "det gamla fyrhuset från 1890, som
       är den lilla vita stugan bredvid själva fyren" -- rebuilt on its own
       foundation after a 2016 permit, which is what the club's "byggt på
       grunden av den gamla fyren" means, and the bay window every interior
       photograph shows is that same burspråk.
     1892, the bostadshus for the station's staff: a Bark & Warburg prefab, and
       sv.wikipedia says of THIS house "Huset rödfärgades med blyvita
       snickerier". FALU RED with white joinery. It is also the club's first
       clubhouse: "omges sedan 1958 av Visby golfklubb som tidigare använt
       bostadshuset som klubbhus".

   An earlier reading here had those two the wrong way round -- it called the
   red house Fyrhuset and the white one a plain outbuilding, and hung the 1892
   "rödfärgades" line on the 1890 building. The COLOURS were right either way,
   because they are keyed to the OSM ids below and those did not move; only the
   names and dates were swapped, and they are corrected rather than quietly
   changed. What is still INFERRED is which footprint is which: no photograph
   here is georeferenced, so the mapping rests on the two houses' distance from
   the tower (helagotland's white cottage is the one "bredvid själva fyren",
   and 530655633 stands 9 m from it against 530655632's 17 m). If a captioned
   club photograph ever settles it, check that before anything else. */
export const buildingLooks = {
  'way/530655632': { wall: 0x8f4a41, roof: 0x2b2d30 },   /* 1892 bostadshuset, 117 m2 */
  'way/530655633': { wall: 0xe9e7e0, roof: 0x2b2d30 },   /* 1890 Fyrhuset, 82 m2 */
};

/* The 1936 tower is NOT a footprint in OpenStreetMap -- too small to be mapped
   -- so it is drawn here, at a position measured off the orthophoto: the only
   white thing on the point, a compact bright blob whose centre is stable to
   0.03 m across three brightness cuts at local (-603.3, 190.4), p90 radius
   2.2 m. Fyrwiki describes it as "ett torn i betong krönt med en åttakantig
   fyrkur", with a 4th-order lens, which is the eight-sided lantern below.

   ITS HEIGHT IS PUBLISHED and no longer assumed: fyrwiki's own table gives
   "Tornets höjd m 10,4" against "Nuvarande fyr år 1936", with a lyshöjd of
   13.6 m. This module first drew it at an assumed 9 m and attributed the 10.4 m
   to an 1890 tower it replaced -- but there was no 1890 tower, only the white
   fyrhus above, so that number was never the old light's and always this one's.
   A shadow reading was attempted and refused: this is a rocky shore where the
   dark mask is rock and water as much as shadow, and the flight's capture time
   is not published. It did not need one. */
const TOWER = [-603.3, 190.4];
const TOWER_RADIUS = 2.2;
const TOWER_HEIGHT = 10.4;    /* fyrwiki, "Tornets höjd m 10,4" */

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
