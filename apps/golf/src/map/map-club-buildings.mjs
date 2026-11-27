/* The clubs' own buildings, as the map draws houses. Pure.

   tools/bake-map-buildings.mjs records each building the detailed course models
   (a castle, a barn campus, a manor) from above, in its own axes: a grid of cells,
   each with how high the building stands there and its colour from above, and the
   colour its walls show most. Here that becomes walls and a roof in the vertex form
   of map-houses.mjs (x, height above its ground, z, ground, normal, colour), standing
   on the map's own ground as its other houses do: the same outline, height, roof
   shape, towers and colours, without windows and trim.

   A roof is smooth: at each corner, cells of one roof share its height. Where a tower
   or a higher wing rises out of a roof the heights jump, and a wall closes the step. */
import { HOUSE_FLOATS } from './map-houses.mjs';
import catalogue from '../../public/models/map-buildings.json';

/* A jump between neighbouring cells larger than this is a step, not a slope: a cell
   wide plus a little covers roofs up to about 65 degrees. */
const stepFor = cell => 2 * cell + 0.5;

const decode = (text, Type) => {
  const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  return new Type(bytes.buffer, 0, bytes.length / Type.BYTES_PER_ELEMENT);
};

/* Which of the layout's houses a club building stands in for: by id, or, where a
   course names its footprints by place in the pack, by where the footprint stands. */
export function replacedBy(replaces) {
  const ids = new Set(replaces?.ids ?? []);
  const rings = replaces?.rings ?? [];
  return structure => {
    if (structure.id && ids.has(structure.id)) return true;
    if (!rings.length) return false;
    const [cx, cz] = ringCentre(structure.ring);
    return rings.some(([x, z]) => Math.hypot(cx - x, cz - z) < 1.5);
  };
}

export function ringCentre(ring) {
  const open = ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  const sum = open.reduce((total, [x, z]) => [total[0] + x, total[1] + z], [0, 0]);
  return [sum[0] / open.length, sum[1] / open.length];
}

/* The corner (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) a cell of a
   diagonal outline gives up, or -1. Its two sides there are open and a diagonal
   neighbour carries the stair on; a building's square corner has no such neighbour. */
export function cutCorner(present, col, row) {
  const n = present(col, row - 1), e = present(col + 1, row), s = present(col, row + 1), w = present(col - 1, row);
  const ne = present(col + 1, row - 1), nw = present(col - 1, row - 1), se = present(col + 1, row + 1), sw = present(col - 1, row + 1);
  if (!n && !w && e && s && (ne || sw)) return 0;
  if (!n && !e && w && s && (nw || se)) return 1;
  if (!s && !e && w && n && (ne || sw)) return 2;
  if (!s && !w && e && n && (nw || se)) return 3;
  return -1;
}

/* Where a building stands, to file it with the ground under it. */
export const buildingCentre = building => building.feet[4];

export function raiseClubBuilding(building, heightAt) {
  const { cols, rows, cell, angle, origin, palette } = building;
  const heights = decode(building.heights, Uint16Array), colours = decode(building.colours, Uint8Array);
  const levels = building.feet.map(([x, z]) => heightAt(x, z)).filter(Number.isFinite);
  if (!levels.length) return new Float32Array(0);
  /* On its lowest corner, so no wall hangs in the air on a slope. */
  const ground = Math.min(...levels);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const step = stepFor(cell);
  const top = (col, row) => (col < 0 || row < 0 || col >= cols || row >= rows ? 0 : heights[row * cols + col] / 100);

  /* Each cell's own height at its four corners (0 top-left, 1 top-right, 2 bottom-right,
     3 bottom-left): the mean of the cells meeting there that belong to its roof. */
  const corner = new Float32Array(cols * rows * 4);
  const around = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
  const cornerOf = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const own = top(col, row);
      if (!own) continue;
      for (let k = 0; k < 4; k++) {
        const cx = col + cornerOf[k][0], cz = row + cornerOf[k][1];
        let sum = 0, count = 0;
        for (const [dc, dr] of around) {
          const h = top(cx + dc, cz + dr);
          if (h && Math.abs(h - own) <= step) { sum += h; count++; }
        }
        corner[(row * cols + col) * 4 + k] = sum / count;
      }
    }
  }

  const out = [];
  const world = (u, v) => [origin[0] + u * cos - v * sin, origin[1] + u * sin + v * cos];
  const turn = (nu, ny, nv) => [nu * cos - nv * sin, ny, nu * sin + nv * cos];
  const vertex = (u, up, v, normal, colour) => {
    const [x, z] = world(u, v);
    out.push(x, up, z, ground, normal[0], normal[1], normal[2], colour[0], colour[1], colour[2], 1);
  };
  const wallColour = building.wall.map(value => value / 255);
  /* A triangle's own normal, faced upward or outward from the building's side. */
  const face = (p, q, r, colour, outward) => {
    const e = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], f = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
    const length = Math.hypot(...n) || 1;
    n = n.map(value => value / length);
    if (outward ? n[0] * outward[0] + n[2] * outward[1] < 0 : n[1] < 0) n = n.map(value => -value);
    const normal = turn(n[0], n[1], n[2]);
    for (const [u, up, v] of [p, q, r]) vertex(u, up, v, normal, colour);
  };
  const quad = (a, b, c, d, colour, outward) => { face(a, b, c, colour, outward); face(a, c, d, colour, outward); };

  const present = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && heights[row * cols + col] > 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = row * cols + col;
      if (!heights[k]) continue;
      const h = corner.subarray(k * 4, k * 4 + 4);
      const u0 = col * cell, u1 = u0 + cell, v0 = row * cell, v1 = v0 + cell;
      const roof = palette[colours[k]].map(value => value / 255);
      const at = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const cut = cutCorner(present, col, row);
      if (cut < 0) quad([u0, h[0], v0], [u1, h[1], v0], [u1, h[2], v1], [u0, h[3], v1], roof, null);
      else {
        /* A wall that runs across the grid: its stair is cut along the diagonal. */
        const [p, q, r] = [1, 2, 3].map(step => (cut + step) % 4);
        face([at[p][0], h[p], at[p][1]], [at[q][0], h[q], at[q][1]], [at[r][0], h[r], at[r][1]], roof, null);
        const outward = [Math.sign(at[cut][0] - (u0 + u1) / 2), Math.sign(at[cut][1] - (v0 + v1) / 2)];
        quad([at[p][0], 0, at[p][1]], [at[r][0], 0, at[r][1]], [at[r][0], h[r], at[r][1]], [at[p][0], h[p], at[p][1]], wallColour, outward);
      }

      /* Each edge once: the right and lower edges against a neighbour, and every edge
         the outline runs along. A neighbour of another height gets a wall between. */
      const edges = [
        { dc: 0, dr: -1, a: [u0, v0, 0], b: [u1, v0, 1], other: [3, 2], out: [0, -1] },
        { dc: 1, dr: 0, a: [u1, v0, 1], b: [u1, v1, 2], other: [0, 3], out: [1, 0] },
        { dc: 0, dr: 1, a: [u1, v1, 2], b: [u0, v1, 3], other: [1, 0], out: [0, 1] },
        { dc: -1, dr: 0, a: [u0, v1, 3], b: [u0, v0, 0], other: [2, 1], out: [-1, 0] },
      ];
      for (const { dc, dr, a, b, other, out } of edges) {
        const nc = col + dc, nr = row + dr;
        const neighbour = nc >= 0 && nr >= 0 && nc < cols && nr < rows && heights[nr * cols + nc] ? nr * cols + nc : -1;
        const ha = h[a[2]], hb = h[b[2]];
        if (neighbour < 0) {
          /* the cut's diagonal wall stands in for the two outer edges at its corner */
          if (cut < 0 || (a[2] !== cut && b[2] !== cut)) quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], hb, b[1]], [a[0], ha, a[1]], wallColour, out);
          continue;
        }
        if (dc < 0 || dr < 0) continue;
        /* `other`: the neighbour's corners at this edge's a and b ends */
        const na = corner[neighbour * 4 + other[0]], nb = corner[neighbour * 4 + other[1]];
        if (Math.abs(na - ha) < 0.01 && Math.abs(nb - hb) < 0.01) continue;
        /* facing the lower side */
        const facing = (ha + hb) >= (na + nb) ? out : [-out[0], -out[1]];
        quad([a[0], Math.min(ha, na), a[1]], [b[0], Math.min(hb, nb), b[1]], [b[0], Math.max(hb, nb), b[1]], [a[0], Math.max(ha, na), a[1]], wallColour, facing);
      }
    }
  }
  return new Float32Array(out);
}

export const CLUB_FLOATS = HOUSE_FLOATS;

/* ------------------------------------------------------------------ loading */
/* The baked records' index (tools/bake-map-buildings.mjs): one small file a ground. */

export const clubRecord = groundId => catalogue.grounds[groundId] ?? null;

/* A record read against another frame of the ground would stand its buildings in the
   wrong place: then the layout's own houses stay. */
export async function loadClubBuildings(entry, fetchFile, frameFingerprint) {
  if (!entry) return null;
  const record = JSON.parse(new TextDecoder().decode(await fetchFile(entry.file)));
  if (record.version !== 1 || record.frame !== frameFingerprint) {
    console.warn(`Kartans klubbhus: ${entry.file} är bakad mot en annan ram`);
    return null;
  }
  return record;
}
