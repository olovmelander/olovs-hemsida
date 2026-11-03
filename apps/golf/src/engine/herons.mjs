/* HERONS IN THE SHALLOWS (3 November). Beside the swans out on the open water,
   the other bird every Swedish pond has: a grey heron standing still in the
   shallows by the bank, watching the water. The Blender-built heron
   (tools/blender-props/heron.py), one to a pond near the course and at most
   `maxTotal` a course, each where the water stands `depth` deep over the bed
   within `out` metres of the shore, facing out over the water and a little
   along the bank. Herons stand still, so they are static instanced furniture
   and cast their shadows like any other. ?herons=0 is the before. */
import { swanHash, ringArea } from './swans.mjs';

export const HERONS = Object.freeze({
  /* the water that keeps a heron, m² */
  minArea: 1200,
  /* a step along the shore, metres, and the distances out from it tried at each */
  step: 3, out: Object.freeze([1.0, 1.8, 2.8, 4.2]),
  /* the water over the bed where a heron stands, metres */
  depth: Object.freeze([0.06, 0.32]),
  /* at most this many a course, this far apart, and this far past the played ground */
  maxTotal: 4, apart: 80, reach: 250,
  /* how far off straight out over the water a heron may face, radians */
  turn: 0.8,
});

function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Plans the herons: `bodies` [{ id, ring, level }] (no sea, no streams),
 * `ground(x, z)` the ground's height, `focus` { x0, x1, z0, z1 } the played
 * ground. Returns [{ x, y, z, yaw }]: y the bed's height, yaw about +y with
 * the bill (+z) turned onto (sin yaw, cos yaw).
 */
export function planHerons(bodies, { ground = () => Infinity, focus = null } = {}) {
  const H = HERONS;
  const box = focus ? { x0: focus.x0 - H.reach, x1: focus.x1 + H.reach, z0: focus.z0 - H.reach, z1: focus.z1 + H.reach } : null;
  const inBox = (x, z) => !box || (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1);
  const away = ring => {
    if (!focus) return 0;
    let best = Infinity;
    for (const [x, z] of ring) best = Math.min(best, Math.hypot(Math.max(0, focus.x0 - x, x - focus.x1), Math.max(0, focus.z0 - z, z - focus.z1)));
    return best;
  };
  const ordered = bodies
    .filter(b => Array.isArray(b.ring) && b.ring.length >= 3 && Number.isFinite(b.level) && Math.abs(ringArea(b.ring)) >= H.minArea)
    .map((body, i) => ({ body, i, d: away(body.ring) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const out = [];
  for (const { body } of ordered) {
    if (out.length >= H.maxTotal) break;
    const ring = body.ring;
    const signed = (() => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return a; })();
    const inward = signed > 0 ? 1 : -1;
    /* every stand along the shore, scored by a hash so the choice is the same every time */
    let best = null;
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz * inward, nz = tx * inward;
      for (let d = (H.step - (s % H.step)) % H.step; d < len; d += H.step) {
        const k = Math.round((s + d) / H.step);
        const score = swanHash(`${body.id ?? ''}:heron:${k}`, 7);
        if (best && score <= best.score) continue;
        for (const o of H.out) {
          const x = ax + tx * d + nx * o, z = az + tz * d + nz * o;
          if (!inBox(x, z)) continue;
          const bed = ground(x, z), deep = body.level - bed;
          if (!(deep >= H.depth[0] && deep <= H.depth[1])) continue;
          if (!inRing(x, z, ring)) continue;
          if (out.some(h => Math.hypot(h.x - x, h.z - z) < H.apart)) continue;
          /* out over the water, turned a little along the bank */
          const turn = (swanHash(`${body.id ?? ''}:heron:${k}`, 8) - 0.5) * 2 * H.turn;
          const yaw = Math.atan2(nx, nz) + turn;
          best = { x, y: bed, z, yaw, score };
          break;
        }
      }
      s += len;
    }
    if (best) out.push({ x: best.x, y: best.y, z: best.z, yaw: best.yaw });
  }
  return out;
}
