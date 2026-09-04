/* Veckefjärden's landmarks -- the things the basin is identified by, moved here
   verbatim from the page that first drew them. Nothing was retuned in the move:
   every coordinate is the surveyed one and every proportion came off a
   photograph, and the notes that explain WHY each is shaped as it is travelled
   with the code, because they are the reason it looks right.

   ctx carries the engine's own helpers, so these are the same calls they were:
   quad/pole draw into the far-scenery batches, demH is the elevation model
   (never the sculpted surface -- these stand on land, not on the course),
   L() converts an sRGB literal into the linear working space, and stats is the
   draw counter the harness reads back.                                       */
import { hash2 } from '../geom.js';

/* The island 14th is armoured in granite riprap -- the collar of pale boulders at
   the waterline is the first thing every photograph of the hole leads with, and
   the ground under them is a berm of dumped stone, not a mown bank. Eleven club
   photographs put it there (a3afff0); it is the same kind of course-specific truth
   as the reserve's alder swamp, and a shared engine has no way to guess it.
   rise is how far from the green centre the berm and the boulders reach; paint how
   far the waterline band is stone grey rather than bleached sand. */
/* The colour was a warm beige-grey and the stone is not warm. The club's own
   photographs of the hole show angular BLASTED rubble in a neutral-to-cool
   grey -- sunlit faces measure about #909098 in the frame, which is lighting
   plus albedo, so what is corrected here is the HUE at the same luminance
   rather than the brightness: (168,164,154) warm becomes (160,162,168) cool.
   Granite riprap beside water reads cold; beige reads like the bleached sand
   the paint band exists to replace. */
export const armour = { hole: 14, rise: 115, paint: 110, colour: 0xa0a2a8 };

/* Ground beyond every record we have gets a ring of stand-in conifers, and these
   are the two places in this basin where that ring must NOT close. Kyrkudden is
   churchyard and village lawn, and the peninsula falls outside the OSM extract,
   so without the hole the vista scatter buries Själevads kyrka -- the one
   landmark the course looks across the fjärd at. The second is the cleared works
   yard at Åsmasten's foot, which is gravel and guy anchors. `wobble` is how much
   fbm ripples the edge so a clearing does not read as a stamped circle. */
export const clearings = [
  { c: [-3310, -928], r: 150, wobble: 70 },
  { c: [-632, -2007], r: 40, wobble: 0 },
];

/* The far-vista ring is square everywhere else. Here it is pushed north: the
   course sits in the south of its own frame and looks up the basin at Åsberget,
   so the ring reaches 6 km that way to carry the hills, and stops 2520 m south
   rather than spend a quarter of its geometry on ground that FogExp2 has already
   taken. The vista heightfield covers z from -6592 to 6016, so both edges stand
   on real elevation either way -- this is a framing choice, not a data limit. */
export const farRing = { z0: -6000, z1: 2520 };

export function build(ctx) {
  /* tri/quad push into the CALLER's vertex batch -- these landmarks are part of
     the far-scenery mesh, which is one draw call for the whole horizon, and
     that is why they take the batch rather than building meshes of their own.
     avLights collects the aviation lamps, which are emissive and drawn last. */
  const { tri, quad, pole, demH, L, WHITE, GREY, YEL, DARKR, stats, TAU, avLights } = ctx;
  const before = stats.draws;
  /* Åsmasten -- OSM node 845145336, "Åsbergsmasten", height=259 -- Teracom's
     guyed TV mast on Åsberget's 241 m summit due north of the course, the
     tallest thing the whole basin sees. A body that thins in three hops, the
     white antenna radome on top, three guy fans 120 degrees apart. The first
     fetch bbox stopped at 63.300 N and this node sits at 63.3025, which is how
     an unnamed 35 m works mast in Domsjö briefly wore its name. */
  {
    const mx = -632, mz = -2007, y0 = demH(-632, -2007) - 0.8;
    for (const [h0, h1, r0, r1] of [[0, 90, 1.7, 1.3], [90, 180, 1.3, 1.0], [180, 246, 1.0, 0.75]])
      for (const [ox, oz] of [[1, 0], [0, 1]])
        quad([mx - ox * r0, y0 + h0, mz - oz * r0], [mx + ox * r0, y0 + h0, mz + oz * r0],
             [mx + ox * r1, y0 + h1, mz + oz * r1], [mx - ox * r1, y0 + h1, mz - oz * r1], GREY);
    for (const [ox, oz] of [[0.85, 0], [0, 0.85]])
      quad([mx - ox, y0 + 246, mz - oz], [mx + ox, y0 + 246, mz + oz],
           [mx + ox, y0 + 259, mz + oz], [mx - ox, y0 + 259, mz - oz], WHITE);
    for (let a = 0; a < 3; a++) {
      const ca = Math.cos(a * TAU / 3 + 0.4), sa = Math.sin(a * TAU / 3 + 0.4);
      for (const [ah, ar] of [[82, 100], [164, 158], [238, 208]]) {
        const gx = mx + ca * ar, gz = mz + sa * ar, gy = demH(gx, gz);
        const wx = -sa * 0.17, wz = ca * 0.17;
        quad([mx - wx, y0 + ah, mz - wz], [mx + wx, y0 + ah, mz + wz],
             [gx + wx, gy, gz + wz], [gx - wx, gy, gz - wz], GREY);
      }
    }
    for (const lh of [65, 130, 195, 260]) avLights.push([mx, y0 + lh, mz]);
  }
  /* the small works mast at Domsjö, from its surveyed OSM node */
  {
    const y0 = demH(1084, 1401) - 0.5;
    pole(1084, y0, 1401, 52, 1.1, GREY);
    avLights.push([1084, y0 + 53, 1401]);
  }
  /* the Domsjö mill chimney, from its surveyed OSM node (man_made=chimney, 68 m) */
  {
    const cx = 1804, cz = 1243, y0 = demH(1804, 1243) - 0.5, CONC = L(0xb3aca1);
    for (const [ox, oz] of [[1, 0], [0, 1]]) {
      quad([cx - ox * 2.9, y0, cz - oz * 2.9], [cx + ox * 2.9, y0, cz + oz * 2.9],
           [cx + ox * 2.1, y0 + 56, cz + oz * 2.1], [cx - ox * 2.1, y0 + 56, cz - oz * 2.1], CONC);
      quad([cx - ox * 2.1, y0 + 56, cz - oz * 2.1], [cx + ox * 2.1, y0 + 56, cz + oz * 2.1],
           [cx + ox * 1.9, y0 + 68, cz + oz * 1.9], [cx - ox * 1.9, y0 + 68, cz - oz * 1.9], L(0x8a3a30));
    }
    avLights.push([cx, y0 + 69, cz]);
  }
  /* Själevads kyrka at its real coordinates, drawn from photographs of the church
     itself: the tall white octagon of 1880 with arched windows and a columned
     temple portico; a shallow copper roof carrying the broad white bell-storey
     drum; then the copper bell roof, the clock lantern and the copper spire with
     the gilt ball and cross -- the 1923 crown that makes the silhouette. ~35 m to
     the cross, white and verdigris, which is what reads across 3 km of water. */
  {
    const kx = -3310, kz = -928, y0 = demH(-3310, -928) - 0.6;
    const GREENC = L(0x5c7a66), GLK = L(0x2b3138), GOLD = L(0xd8b93c);
    const oct = a => [Math.cos(a * TAU / 8 + TAU / 16), Math.sin(a * TAU / 8 + TAU / 16)];
    const ring8 = (r0, ya, r1, yb, col) => {
      for (let k = 0; k < 8; k++) {
        const [c0, s0] = oct(k), [c1, s1] = oct(k + 1);
        quad([kx + c0 * r0, ya, kz + s0 * r0], [kx + c1 * r0, ya, kz + s1 * r0],
             [kx + c1 * r1, yb, kz + s1 * r1], [kx + c0 * r1, yb, kz + s0 * r1], col);
      }
    };
    const facet = (k, r, w, ya, yb, col) => {   /* a panel on facet k's face plane */
      const fm = k * TAU / 8 + TAU / 8;         /* facet k faces angle k*45+45 deg */
      const fx = Math.cos(fm), fz = Math.sin(fm), tx = -fz, tz = fx;
      const px = kx + fx * r, pz = kz + fz * r;
      quad([px - tx * w, ya, pz - tz * w], [px + tx * w, ya, pz + tz * w],
           [px + tx * w, yb, pz + tz * w], [px - tx * w, yb, pz - tz * w], col);
    };
    ring8(11.5, y0, 11.5, y0 + 11, WHITE);                  /* the body */
    const RF = 11.5 * Math.cos(TAU / 16) + 0.08;
    for (let k = 0; k < 8; k++) if (k !== 7) facet(k, RF, 1.15, y0 + 3.6, y0 + 8.6, GLK);
    ring8(12.4, y0 + 11, 6.6, y0 + 14.8, GREENC);           /* shallow copper roof */
    ring8(6.3, y0 + 14.8, 6.3, y0 + 20.3, WHITE);           /* the bell-storey drum */
    const RD = 6.3 * Math.cos(TAU / 16) + 0.08;
    for (let k = 0; k < 8; k++) facet(k, RD, 0.85, y0 + 15.6, y0 + 19.4, GLK);
    ring8(6.9, y0 + 20.3, 4.4, y0 + 22.4, GREENC);          /* bell roof in two springs */
    ring8(4.4, y0 + 22.4, 1.95, y0 + 24.3, GREENC);
    ring8(1.85, y0 + 24.3, 1.85, y0 + 27.2, WHITE);         /* the clock lantern */
    const RL = 1.85 * Math.cos(TAU / 16) + 0.05;
    for (let k = 0; k < 8; k++) facet(k, RL, 0.5, y0 + 25.0, y0 + 26.6, GLK);
    for (let k = 0; k < 8; k++) {                           /* the copper spire */
      const [c0, s0] = oct(k), [c1, s1] = oct(k + 1);
      tri([kx + c0 * 2.05, y0 + 27.2, kz + s0 * 2.05], [kx + c1 * 2.05, y0 + 27.2, kz + s1 * 2.05],
          [kx, y0 + 33.8, kz], GREENC);
    }
    quad([kx - 0.35, y0 + 33.7, kz - 0.35], [kx + 0.35, y0 + 33.7, kz + 0.35],
         [kx + 0.35, y0 + 34.35, kz + 0.35], [kx - 0.35, y0 + 34.35, kz - 0.35], GOLD);
    pole(kx, y0 + 34.3, kz, 1.1, 0.09, GOLD);
    for (const [ox, oz] of [[0.45, 0], [0, 0.45]])
      quad([kx - ox, y0 + 34.95, kz - oz], [kx + ox, y0 + 34.95, kz + oz],
           [kx + ox, y0 + 35.15, kz + oz], [kx - ox, y0 + 35.15, kz - oz], GOLD);
    /* the temple portico on the east facet (k=7 faces +x, toward the fjärd) */
    {
      const bx = kx + 11.5 * Math.cos(TAU / 16), px2 = bx + 4.6;
      for (const zz of [-4.65, -1.55, 1.55, 4.65]) pole(px2, y0, kz + zz, 8.6, 0.34, WHITE);
      for (const zz of [-5.2, 5.2])
        quad([bx, y0 + 8.3, kz + zz], [px2 + 0.4, y0 + 8.3, kz + zz],
             [px2 + 0.4, y0 + 9.1, kz + zz], [bx, y0 + 9.1, kz + zz], WHITE);
      quad([px2 + 0.4, y0 + 8.3, kz - 5.2], [px2 + 0.4, y0 + 8.3, kz + 5.2],
           [px2 + 0.4, y0 + 9.1, kz + 5.2], [px2 + 0.4, y0 + 9.1, kz - 5.2], WHITE);
      tri([px2 + 0.4, y0 + 9.1, kz - 5.2], [px2 + 0.4, y0 + 9.1, kz + 5.2],
          [px2 + 0.4, y0 + 11.5, kz], WHITE);
      quad([px2 + 0.5, y0 + 9.1, kz - 5.4], [px2 + 0.5, y0 + 11.5, kz],
           [bx, y0 + 11.5, kz], [bx, y0 + 9.1, kz - 5.4], GREENC);
      quad([px2 + 0.5, y0 + 11.5, kz], [px2 + 0.5, y0 + 9.1, kz + 5.4],
           [bx, y0 + 9.1, kz + 5.4], [bx, y0 + 11.5, kz], GREENC);
      quad([bx + 0.06, y0, kz - 1.1], [bx + 0.06, y0, kz + 1.1],
           [bx + 0.06, y0 + 3.4, kz + 1.1], [bx + 0.06, y0 + 3.4, kz - 1.1], GLK);
    }
    /* churchyard wall and the north-east sacristy, as the aerial shows them */
    for (let k = 0; k < 8; k++) {
      const [c0, s0] = oct(k), [c1, s1] = oct(k + 1);
      const wx0 = kx + c0 * 40, wz0 = kz + s0 * 40, wx1 = kx + c1 * 40, wz1 = kz + s1 * 40;
      const wy0 = demH(wx0, wz0), wy1 = demH(wx1, wz1);
      quad([wx0, wy0 - 0.4, wz0], [wx1, wy1 - 0.4, wz1], [wx1, wy1 + 1.1, wz1], [wx0, wy0 + 1.1, wz0], L(0xb9b4a8));
    }
    {
      const sx = kx + 9.5, sz = kz - 9.5;
      const box = [[-4, -3], [4, -3], [4, 3], [-4, 3]];
      for (let k = 0; k < 4; k++) {
        const [a0, b0] = box[k], [a1, b1] = box[(k + 1) % 4];
        quad([sx + a0, y0, sz + b0], [sx + a1, y0, sz + b1],
             [sx + a1, y0 + 4.5, sz + b1], [sx + a0, y0 + 4.5, sz + b0], WHITE);
      }
      quad([sx - 4.3, y0 + 4.5, sz - 3.3], [sx + 4.3, y0 + 4.5, sz - 3.3],
           [sx + 4.3, y0 + 5.8, sz], [sx - 4.3, y0 + 5.8, sz], DARKR);
      quad([sx + 4.3, y0 + 4.5, sz + 3.3], [sx - 4.3, y0 + 4.5, sz + 3.3],
           [sx - 4.3, y0 + 5.8, sz], [sx + 4.3, y0 + 5.8, sz], DARKR);
    }
  }
  /* the wind turbines on the western ridge (dressing: placed where the dusk
     photograph shows them, on the high ground beyond the fjärd) */
  for (let k = 0; k < 7; k++) {
    const tx = -4350 + k * 265 + (hash2(k, 3) - 0.5) * 90;
    const tz = 520 + Math.sin(k * 1.2) * 260;
    const y0 = demH(tx, tz);
    pole(tx, y0, tz, 46, 0.9, WHITE);
    for (let bl = 0; bl < 3; bl++) {
      const a = bl / 3 * TAU + k * 0.9;
      const bx = Math.cos(a) * 17, by = Math.sin(a) * 17;
      quad([tx, y0 + 46, tz], [tx + 4, y0 + 46, tz + 1.1],
           [tx + bx * 0.06 + 4, y0 + 46 + by, tz + bx], [tx + bx * 0.06, y0 + 46 + by, tz + bx], WHITE);
    }
  }

  return stats.draws - before;
}

/* The forest here is not the engine's default forest, and the difference is a
   fact about the ground rather than a preference. Länsstyrelsen Västernorrland's
   own reserve description names GRÅAL -- grey alder -- first, then björk and
   rönn, with hägg, lönn and ask: deciduous swamp forest, softer green, a scatter
   of old spruce. So the planter goes birch-dominant inside the reserve rings,
   and above about 46 m the ridge turns to spruce and pine. Rendering either as
   the High Coast's pine country would say something untrue about the place.

   Two corrections to what this note used to claim. The reserve is TWO polygons
   totalling 63.11 ha, and the half that touches the course is its EASTERN area,
   not "Tvillingsta"; the western half sits at the Moälven mouth by Själevad,
   outside geobuild's fetch bbox, and is not in the model at all. And the
   dominant tree is alder, not birch -- but the engine's SPECIES table has no
   alder, and birch is the nearest thing in it by form and colour, so the rule
   below is the closest honest approximation rather than the measured mix. Do
   not "fix" the ratio without adding the species.

   Species ids match the engine's SPECIES table: 0 spruce, 1 pine, 2 birch.   */
export function species({ r, x, z, h, ringSD, RES }) {
  for (const rr of RES) {
    if (x < rr.bb.x0 || x > rr.bb.x1 || z < rr.bb.z0 || z > rr.bb.z1) continue;
    if (ringSD(x, z, rr.ring) < 0) return r < 0.78 ? 2 : 0;
  }
  return h > 46 ? (r < 0.66 ? 0 : 1) : r < 0.44 ? 0 : r < 0.80 ? 1 : 2;
}

/* The fjärd is the only water these reeds belong to, and they thicken along the
   reserve's west shore. The box is also a phase reference: the reed lattice is
   stepped from its own start, so a wider box does not merely add reeds, it moves
   every one of them. */
export const reedbed = { box: [-2300, 0, -1500, 900], denser: [-700, 1.8] };

/* The old school. This used to say "cream render under a dark red roof" and
   claim to be the engine's defaults; the club's own daylight photographs say
   otherwise, and so does the standalone page, which had it right before the
   phase-4 merge onto the shared engine took the engine's numbers instead.

   What the pictures show: PALE YELLOW painted vertical timber panel with white
   trim and white corner boards, under a DARK GREY sheet-metal roof, three
   storeys of white-framed windows over a partly exposed basement, and the
   railed garden terrace facing the 18th. The orthoimagery corroborates the
   grey roof from above; the wall colour needed a picture from the ground,
   which is the whole reason this export exists.

   These four numbers are veckefjarden3d.html's (wall 0xd9c58a at :3195, roof
   0x6f7276 at :3290, height 8.6 at :3285, rows [1.3, 3.7, 6.1] at :3311), so
   the app and the page now draw the same building again. The engine's own
   defaults are still Veckefjärden-shaped cream-and-red, which is now simply
   wrong for every course -- they should become a neutral house, but that moves
   ground on five shipped courses and belongs in its own change. */
export const clubhouse = {
  wall: 0xd9c58a, roof: 0x6f7276, height: 8.6,
  windowRows: [1.3, 3.7, 6.1], terrace: true,
};
