/* Veckefjärden's landmarks and local scenery. The church and Paradiskullen
   now load as photo-referenced Blender models; the other skyline features
   remain in the engine's shared vertex batches. Plans follow the mapped
   course frame; architectural proportions are photograph-based estimates.

   ctx carries the engine's own helpers, so these are the same calls they were:
   quad/pole draw into the far-scenery batches, demH is the elevation model
   (never the sculpted surface -- these stand on land, not on the course),
   L() converts an sRGB literal into the linear working space, and stats is the
   draw counter the harness reads back.                                       */
import { hash2 } from '../geom.js';
export { loadFacilities, facilityFootprints, isFacilityInterior } from './veckefjarden-facilities.mjs';
export { loadLandmarks, isReplacedLandmarkBox, isReplacedLandmarkRail, isLandmarkTreeObstruction } from './veckefjarden-landmarks.mjs';
export const loadFacilitiesBeforeSurfaces = true;
export const replacesRangeFacilities = true;

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
  { c: [-3278.4, -905.3], r: 150, wobble: 70 },
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
  /* The church is now loaded from its photo-referenced Blender asset.
     The mapped church is the sole fallback when that asset cannot load; the
     former custom octagon 40 m away duplicated the same real building. */
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

   Species ids match the engine's SPECIES table: 0 spruce, 1 pine, 2 birch --
   and, when the caller says the table is `extended` (the authored tree set),
   3 alder: then the reserve rings plant what Länsstyrelsen names, grey alder
   first, then birch, and the rule above stops being an approximation.        */
export function species({ r, x, z, h, ringSD, RES, extended = false }) {
  for (const rr of RES) {
    if (x < rr.bb.x0 || x > rr.bb.x1 || z < rr.bb.z0 || z > rr.bb.z1) continue;
    if (ringSD(x, z, rr.ring) < 0) return extended ? (r < 0.5 ? 3 : r < 0.78 ? 2 : 0) : (r < 0.78 ? 2 : 0);
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
