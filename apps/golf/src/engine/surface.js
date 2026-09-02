/* ===========================================================================
   Banvy Surface Registry & Classification
   Formal registry of all course surface types, overlap priorities,
   and geometric classification logic.
   =========================================================================== */

export const SURFACE = {
  ROUGH: 0,
  SEMI: 1,
  FAIRWAY: 2,
  FRINGE: 3,
  GREEN: 4,
  TEE: 5,
  SAND: 6,
  PATH: 7,
  FOREST: 8,
  HEATH: 9,
  SHORE: 10,
  WETLAND: 11,
  ROCK: 12,
  ASPHALT: 13,
  GRAVEL: 14,
  DIRT: 15,
  MUD: 16,
};

/* Explicit rendering and rasterization priority order (highest precedence first).
   SAND outranks GREEN and TEE because the overlay stack always drew sand above
   everything: where a traced bunker ring bites into a green complex the player
   sees sand, and Ängsö's 9th has exactly that overlap. */
export const SURFACE_PRIORITY = [
  SURFACE.SAND,
  SURFACE.GREEN,
  SURFACE.TEE,
  SURFACE.FRINGE,
  SURFACE.FAIRWAY,
  SURFACE.SEMI,
  SURFACE.PATH,
  SURFACE.ASPHALT,
  SURFACE.GRAVEL,
  SURFACE.DIRT,
  SURFACE.MUD,
  SURFACE.WETLAND,
  SURFACE.SHORE,
  SURFACE.ROCK,
  SURFACE.FOREST,
  SURFACE.HEATH,
  SURFACE.ROUGH,
];

export const EDGE_WIDTHS = {
  GREEN_CUT: 0.2,
  FRINGE_FALLOFF: 4.2,
  FAIRWAY_NEAR_GREEN: 13.0,
  TEE_CUT: 1.2,
  TEE_FAIRWAY_FALLOFF: 7.0,
  BUNKER_CUT: 0.25,
  BUNKER_FADE_INNER: -0.45,
  FAIRWAY_FALLOFF: 5.0,
  PATH_MARGIN: 1.2,
};

/* Physical half-width, in metres, of the blend between a class and whatever
   it meets, for the per-class SDF material: weight_i = smoothstep(-w, w, sdf_i)
   with w = max(this, the screen-space antialiasing width). The width of a
   PAIR is the wider of its two classes. One table, read by both the shader
   and the CPU probe, so the two can never disagree about an edge. A cut edge
   (green, tee, sand) is sharp; a mown-into-rough edge is soft. */
export const SURFACE_TRANSITION_WIDTH_METRES = Object.freeze({
  [SURFACE.ROUGH]: 0.30,
  [SURFACE.SEMI]: 0.30,
  [SURFACE.FAIRWAY]: 0.25,
  [SURFACE.FRINGE]: 0.20,
  [SURFACE.GREEN]: 0.16,
  [SURFACE.TEE]: 0.16,
  [SURFACE.SAND]: 0.18,
  [SURFACE.PATH]: 0.20,
  [SURFACE.FOREST]: 0.45,
  [SURFACE.HEATH]: 0.45,
  [SURFACE.SHORE]: 0.40,
  [SURFACE.WETLAND]: 0.45,
  [SURFACE.ROCK]: 0.25,
  [SURFACE.ASPHALT]: 0.16,
  [SURFACE.GRAVEL]: 0.22,
  [SURFACE.DIRT]: 0.30,
  [SURFACE.MUD]: 0.35,
});
export const SURFACE_TRANSITION_WIDTH_DEFAULT_METRES = 0.22;

export function surfaceTransitionWidthMetres(surfaceId) {
  return SURFACE_TRANSITION_WIDTH_METRES[surfaceId] ?? SURFACE_TRANSITION_WIDTH_DEFAULT_METRES;
}

export function createClassifier({ GI, TI, BI, FI, PI, VI, HOLES, ringSD, distToLine, smooth }) {
  return function classify(x, z) {
    let green = 0, fringe = 0, tee = 0, sand = 0, fair = 0, path = 0, forest = 0, wet = 0, along = 0, hole = 0;

    if (GI) {
      for (const g of GI.at(x, z)) {
        const sd = ringSD(x, z, g.ring);
        if (sd < 0.2) { green = Math.max(green, 1 - smooth(-1.6, 0.2, sd)); hole = g.hole; }
        if (sd < 4.2) fringe = Math.max(fringe, 1 - smooth(0, 4.2, sd));
        if (sd < 13) fair = Math.max(fair, (1 - smooth(3, 13, sd)) * 0.85);
      }
    }

    if (TI) {
      for (const t of TI.at(x, z)) {
        const sd = ringSD(x, z, t.ring);
        if (sd < 1.2) tee = Math.max(tee, 1 - smooth(-1, 1.2, sd));
        if (sd < 7) fair = Math.max(fair, (1 - smooth(1, 7, sd)) * 0.7);
      }
    }

    if (BI) {
      for (const b of BI.at(x, z)) {
        const sd = ringSD(x, z, b.ring);
        /* Bunker cut is crisp at 0.25m */
        if (sd < 0.25) sand = Math.max(sand, 1 - smooth(-0.45, 0.25, sd));
      }
    }

    if (FI) {
      for (const f of FI.at(x, z)) {
        const sd = ringSD(x, z, f.ring);
        if (sd < 5) fair = Math.max(fair, 1 - smooth(-2.5, 5, sd));
      }
    }

    if (PI) {
      for (const p of PI.at(x, z)) {
        const d = distToLine(x, z, p.line);
        if (d < p.w + 1.2) path = Math.max(path, 1 - smooth(p.w - 0.4, p.w + 1.2, d));
      }
    }

    if (VI) {
      for (const v of VI.at(x, z)) {
        if (v.kind === 'forest' || v.kind === 'wood' || v.kind === 'scrub') {
          const sd = ringSD(x, z, v.ring);
          if (sd < 2) forest = Math.max(forest, 1 - smooth(-6, 2, sd));
        } else if (v.kind === 'sand') {
          const sd = ringSD(x, z, v.ring);
          if (sd < 0.5) sand = Math.max(sand, 1 - smooth(-0.9, 0.5, sd));
        } else if (v.kind === 'wetland') {
          const sd = ringSD(x, z, v.ring);
          if (sd < 2) wet = Math.max(wet, 1 - smooth(-4, 2, sd));
        }
      }
    }

    let bestD = Infinity;
    if (HOLES) {
      for (const h of HOLES) {
        const d = distToLine(x, z, h.line);
        if (d < bestD) { bestD = d; along = d; hole = hole || h.n; }
      }
    }

    return { green, fringe, tee, sand, fair, path, forest, wet, dLine: bestD, hole };
  };
}
