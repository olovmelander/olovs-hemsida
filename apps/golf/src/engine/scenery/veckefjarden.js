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
   fact about the ground rather than a preference: the reserve's Tvillingsta half
   is GREY-ALDER SWAMP FOREST -- deciduous, softer green, a scatter of old spruce
   -- so the planter goes birch-dominant inside the reserve rings. Above about
   46 m the ridge turns to spruce and pine. Rendering either as the High Coast's
   pine country would say something untrue about the place.

   Species ids match the engine's SPECIES table: 0 spruce, 1 pine, 2 birch.   */
export function species({ r, x, z, h, ringSD, RES }) {
  for (const rr of RES) {
    if (x < rr.bb.x0 || x > rr.bb.x1 || z < rr.bb.z0 || z > rr.bb.z1) continue;
    if (ringSD(x, z, rr.ring) < 0) return r < 0.78 ? 2 : 0;
  }
  return h > 46 ? (r < 0.66 ? 0 : 1) : r < 0.44 ? 0 : r < 0.80 ? 1 : 2;
}
