/* DEPTH INSIDE A CROWN. The approved crowns carry one flat vertex colour
   (0.94-0.99 on every card), so a card at the heart of a spruce is as bright
   as one on its sunlit shoulder, and a crown reads as a lit shell with nothing
   behind it. This bakes, once per template when the trees load, how much of
   the sky each vertex sees through the crown's own leaves:

   - the cards' area, at half cover for the atlas's cut-outs, is splatted into
     a 16 x 16 x 16 grid over the crown, as leaf area per cubic metre;
   - for each of 14 directions a sweep across the grid gives every cell the
     light it receives from outside along that direction (Beer's law with the
     random-leaf extinction of 0.5 per unit leaf area);
   - a vertex's openness is those 14 transmittances at its position, weighted
     toward the bright sky overhead.

   The crown keeps its own brightness where it is open -- its outer quarter
   stays exactly as it was -- and darkens toward `floor` in its heart and under
   its skirt. It multiplies the vertex colours the crown material already
   reads, and the impostor bake draws those same colours (tree-impostor.mjs,
   crownAlbedo), so a distant billboard carries the same depth as the mesh. */

export const CROWN_DEPTH = Object.freeze({ cells: 16, floor: 0.62, cover: 0.5, extinction: 0.5, openShare: 0.25 });

const DIRECTIONS = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
  const axes = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (axes === 1 || axes === 3) DIRECTIONS.push([x, y, z]);
}

/** Openness of every vertex to the sky through the crown, 0-1 (1 = unobstructed). */
export function crownOpenness(geometry, { cells = CROWN_DEPTH.cells, cover = CROWN_DEPTH.cover, extinction = CROWN_DEPTH.extinction } = {}) {
  const pos = geometry.attributes.position.array, n = pos.length / 3;
  const index = geometry.index ? geometry.index.array : null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], pos[i * 3 + a]); hi[a] = Math.max(hi[a], pos[i * 3 + a]);
  }
  const size = hi.map((h, a) => Math.max(h - lo[a], 1e-3) / cells);
  const N = cells, cellVolume = size[0] * size[1] * size[2];
  const at = (x, y, z) => (z * N + y) * N + x;
  /* leaf area per cell, splatted trilinearly from each card's centroid */
  const area = new Float64Array(N * N * N);
  const triangles = index ? index.length / 3 : n / 3;
  const v = (t, k) => (index ? index[t * 3 + k] : t * 3 + k) * 3;
  const g = [0, 0, 0];
  for (let t = 0; t < triangles; t++) {
    const a = v(t, 0), b = v(t, 1), c = v(t, 2);
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const s = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) * cover;
    for (let k = 0; k < 3; k++) g[k] = ((pos[a + k] + pos[b + k] + pos[c + k]) / 3 - lo[k]) / size[k] - 0.5;
    splat(area, N, g, s);
  }
  /* extinction per metre in each cell */
  const k = area.map(A => extinction * A / cellVolume);
  /* for each direction, the transmittance from outside to each cell's centre */
  const fields = DIRECTIONS.map(d => {
    const step = Math.hypot(d[0] * size[0], d[1] * size[1], d[2] * size[2]);
    const through = new Float64Array(N * N * N); // outside to the far side of the cell, including all of it
    const T = new Float32Array(N * N * N);
    /* sweep from the side the light enters: the neighbour toward the light is done first */
    const order = a => d[a] > 0 ? Array.from({ length: N }, (_, i) => N - 1 - i) : Array.from({ length: N }, (_, i) => i);
    const [xs, ys, zs] = [order(0), order(1), order(2)];
    for (const z of zs) for (const y of ys) for (const x of xs) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      const outside = nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N;
      const beyond = outside ? 1 : through[at(nx, ny, nz)];
      const self = Math.exp(-k[at(x, y, z)] * step);
      through[at(x, y, z)] = self * beyond;
      T[at(x, y, z)] = Math.sqrt(self) * beyond;
    }
    return T;
  });
  /* weighted toward the sky overhead: the zenith counts three times the horizon, the ground a third */
  const weights = DIRECTIONS.map(d => { const up = d[1] / Math.hypot(...d); return 1 + 2 * Math.max(0, up) - (2 / 3) * Math.max(0, -up); });
  const total = weights.reduce((s, w) => s + w, 0);
  /* one weighted field: the directions' weights are the same at every vertex */
  const field = new Float32Array(N * N * N);
  for (let j = 0; j < DIRECTIONS.length; j++) for (let c = 0; c < field.length; c++) field[c] += weights[j] / total * fields[j][c];
  const openness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) g[a] = (pos[i * 3 + a] - lo[a]) / size[a] - 0.5;
    openness[i] = sample(field, N, g);
  }
  return openness;
}

/** Multiplies the crown's vertex colours by its baked depth; returns the factors. */
export function bakeCrownDepth(geometry, { floor = CROWN_DEPTH.floor, openShare = CROWN_DEPTH.openShare, ...options } = {}) {
  const open = crownOpenness(geometry, options);
  /* the crown's own scale: its most open quarter keeps its colour, the least open vertex takes the floor */
  const sorted = Float32Array.from(open).sort();
  const top = sorted[Math.floor((1 - openShare) * (sorted.length - 1))], bottom = sorted[0];
  const colour = geometry.attributes.color.array;
  const factors = new Float32Array(open.length);
  for (let i = 0; i < open.length; i++) {
    const t = top > bottom ? Math.min(1, Math.max(0, (open[i] - bottom) / (top - bottom))) : 1;
    const f = floor + (1 - floor) * t * t * (3 - 2 * t);
    factors[i] = f;
    for (let c = 0; c < 3; c++) colour[i * 3 + c] *= f;
  }
  geometry.attributes.color.needsUpdate = true;
  return factors;
}

function splat(grid, N, g, value) {
  const i0 = Math.floor(g[0]), j0 = Math.floor(g[1]), k0 = Math.floor(g[2]);
  const fx = g[0] - i0, fy = g[1] - j0, fz = g[2] - k0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const x = Math.min(N - 1, Math.max(0, i0 + dx)), y = Math.min(N - 1, Math.max(0, j0 + dy)), z = Math.min(N - 1, Math.max(0, k0 + dz));
    grid[(z * N + y) * N + x] += value * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
}

function sample(field, N, g) {
  const cx = Math.min(N - 1, Math.max(0, g[0])), cy = Math.min(N - 1, Math.max(0, g[1])), cz = Math.min(N - 1, Math.max(0, g[2]));
  const i0 = Math.min(N - 2, Math.floor(cx)), j0 = Math.min(N - 2, Math.floor(cy)), k0 = Math.min(N - 2, Math.floor(cz));
  const fx = cx - i0, fy = cy - j0, fz = cz - k0;
  let sum = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    sum += field[((k0 + dz) * N + j0 + dy) * N + i0 + dx] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
  return sum;
}
