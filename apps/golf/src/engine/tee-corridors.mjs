import { teeView } from './tee-view.mjs';

/* THE PLAY FROM EVERY TEE (27 November 2026, Bro Hof's blind review: "a lone bush stands on
   the fairway right on the aim line", Stadium 18 from the forward tees).

   The ground cover's lattice (main.js) keeps its tussocks, bushes and stones 24 m off the
   hole's line, and that line starts at the back tee. A forward deck set to the side plays
   a line of its own until it meets the route: Stadium 18's yellow and blue deck lies 41 m
   west of the back tee's line, so the rough its drive crosses was open to the scatter and
   a bush stood in the middle of the shot.

   Each tee mark's line of play is the segment from the mark to its landing area, the aim
   the tee view frames (tee-view.mjs: on the route, a drive at most); past it the hole's
   own line is the corridor. The reed scan keeps off it too: a lone stem on the bank stood
   on Stadium 7's aim line, 20 m in front of the tee, and the hole-line rule only thins
   reeds there. ?teecorridor=0 is the before of both. */
export const TEE_CORRIDOR_METRES = 24;

/** One segment a tee mark, from the mark to the landing area it plays to. */
export function teePlayLines(holes) {
  const lines = [];
  for (const hole of holes ?? []) {
    if (!(hole?.line?.length >= 2)) continue;
    for (const mark of hole.tees?.marks ?? []) {
      if (!Array.isArray(mark?.c) || !Number.isFinite(mark.c[0]) || !Number.isFinite(mark.c[1])) continue;
      const { aim } = teeView(hole, mark);
      if (!Number.isFinite(aim?.x) || !Number.isFinite(aim?.z)) continue;
      lines.push({ hole: hole.n, line: [[mark.c[0], mark.c[1]], [aim.x, aim.z]] });
    }
  }
  return lines;
}

function segmentDistance(x, z, [[ax, az], [bx, bz]]) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

/** Whether (x, z) lies within `metres` of any tee's line of play: a lookup on a coarse grid of the segments. */
export function teeCorridors(holes, { metres = TEE_CORRIDOR_METRES, cell = 32 } = {}) {
  const lines = teePlayLines(holes);
  const grid = new Map();
  for (const entry of lines) {
    const [[ax, az], [bx, bz]] = entry.line;
    const i0 = Math.floor((Math.min(ax, bx) - metres) / cell), i1 = Math.floor((Math.max(ax, bx) + metres) / cell);
    const j0 = Math.floor((Math.min(az, bz) - metres) / cell), j1 = Math.floor((Math.max(az, bz) + metres) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = i + ',' + j;
      (grid.get(key) ?? grid.set(key, []).get(key)).push(entry.line);
    }
  }
  return {
    lines,
    within(x, z) {
      const near = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
      if (!near) return false;
      for (const line of near) if (segmentDistance(x, z, line) < metres) return true;
      return false;
    },
  };
}
