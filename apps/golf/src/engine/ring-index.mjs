/* Signed distance to a ring, and distance to a polyline, through an edge
   index -- the same numbers geom.js's ringSD and distToLine return, at a
   cost that does not grow with the ring.

   Puttom's classifier was paying 14 µs a point, eighteen times what the
   atlas costs, and the reason was one OSM forest polygon: 378 vertices over
   a 6 x 4 km box, so it sits in the spatial grid's cell for every point in
   the middle ring, and every classification walked all 378 edges for the
   distance and all 378 again for the crossing test. Half a million tint
   samples and eight hundred thousand scatter candidates each paid it.

   The index is exact, not approximate. Edges live in a uniform grid over
   the ring's box; a query examines the cells around its own in growing
   squares and keeps the minimum of the same ptSegD the plain walk uses.
   After each square it knows a bound: every edge not yet examined lies
   beyond the square's border, so no closer than the point's distance to
   that border. When the bound reaches the minimum found, the minimum IS
   the minimum -- the same value, since it is the same function over a set
   that contains the nearest edge. The crossing test reads only the edges
   whose z-range covers the query's row band, which is exactly the set the
   plain test lets toggle.

   `cutoff` is the one licence: a caller that only compares the distance
   against a threshold, or feeds it to a smoothstep that saturates, needs
   the exact value only while it is smaller than the cutoff. Past it the
   query stops and returns a value on the correct side whose magnitude is
   at least the cutoff, never the exact one. The classifier's thresholds
   are all under 13 m, so its queries examine one 3 x 3 block of cells. */
import { ptSegD, inRing, ringSD, distToLine } from './geom.js';

const INDEX = new WeakMap();
/** Below this many vertices the plain walk is cheaper than the index. */
export const INDEX_MIN_VERTICES = 40;
const TARGET_CELLS_PER_SIDE = 64;
const MIN_CELL_METRES = 12;

function buildIndex(points, closed) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  if (!Number.isFinite(x0 + x1 + z0 + z1)) return null;
  const cell = Math.max(MIN_CELL_METRES, Math.ceil(Math.max(x1 - x0, z1 - z0) / TARGET_CELLS_PER_SIDE));
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const cells = new Array(nx * nz);
  const bands = new Array(nz);
  const edgeCount = closed ? points.length : points.length - 1;
  /* edge e runs from a(e) to b(e): for a ring, from points[j] to points[i]
     with j = i - 1 (wrapping), the order ringSD walks it in */
  const ax = new Float64Array(edgeCount), az = new Float64Array(edgeCount);
  const bx = new Float64Array(edgeCount), bz = new Float64Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const from = closed ? points[(e + points.length - 1) % points.length] : points[e];
    const to = closed ? points[e] : points[e + 1];
    ax[e] = from[0]; az[e] = from[1]; bx[e] = to[0]; bz[e] = to[1];
    const i0 = Math.floor((Math.min(ax[e], bx[e]) - x0) / cell), i1 = Math.floor((Math.max(ax[e], bx[e]) - x0) / cell);
    const j0 = Math.floor((Math.min(az[e], bz[e]) - z0) / cell), j1 = Math.floor((Math.max(az[e], bz[e]) - z0) / cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) (cells[j * nx + i] ??= []).push(e);
      if (closed) (bands[j] ??= []).push(e);
    }
  }
  return { x0, z0, x1, z1, cell, nx, nz, cells, bands, ax, az, bx, bz, edgeCount, stamp: new Int32Array(edgeCount), query: 0 };
}

function indexFor(points, closed) {
  let index = INDEX.get(points);
  if (index === undefined) {
    index = buildIndex(points, closed);
    INDEX.set(points, index || null);
  }
  return index;
}

/* the crossing test of geom.js's inRing over the edges of one row band */
function insideIndexed(index, x, z) {
  const j = Math.floor((z - index.z0) / index.cell);
  if (j < 0 || j >= index.nz) return false;
  const band = index.bands[j];
  if (!band) return false;
  const { ax, az, bx, bz } = index;
  let inside = false;
  for (const e of band) {
    /* ringSD's walk pairs r[j] (from) with r[i] (to); inRing tests the same edges */
    const xi = bx[e], zi = bz[e], xj = ax[e], zj = az[e];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* unsigned distance with the growing-square search; exact below cutoff */
function distanceIndexed(index, x, z, cutoff) {
  const { x0, z0, cell, nx, nz, cells, ax, az, bx, bz, stamp } = index;
  const ci = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)));
  const cj = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / cell)));
  const query = ++index.query;
  let m = Infinity;
  for (let k = 0; ; k++) {
    const i0 = ci - k, i1 = ci + k, j0 = cj - k, j1 = cj + k;
    for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) {
      const edgeRow = j === j0 || j === j1;
      for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
        if (!edgeRow && i !== i0 && i !== i1) continue;   /* only the square's border is new */
        const list = cells[j * nx + i];
        if (!list) continue;
        for (const e of list) {
          if (stamp[e] === query) continue;
          stamp[e] = query;
          const d = ptSegD(x, z, ax[e], az[e], bx[e], bz[e]);
          if (d < m) m = d;
        }
      }
    }
    /* every edge not yet examined lies beyond a side of the square that is
       not the grid's own edge; the point is on the near side of each such
       side, so no unexamined edge is closer than the nearest of them */
    let bound = Infinity;
    if (i0 > 0) bound = Math.min(bound, x - (x0 + i0 * cell));
    if (i1 < nx - 1) bound = Math.min(bound, x0 + (i1 + 1) * cell - x);
    if (j0 > 0) bound = Math.min(bound, z - (z0 + j0 * cell));
    if (j1 < nz - 1) bound = Math.min(bound, z0 + (j1 + 1) * cell - z);
    if (bound === Infinity) return m;                 /* the square covers the grid */
    if (bound >= m) return m;                         /* exact */
    if (bound >= cutoff) return Math.max(bound, cutoff);   /* licensed: at least the cutoff, not the value */
  }
}

/**
 * geom.js's ringSD(x, z, ring), exact while |result| < cutoff. Past the
 * cutoff the magnitude is at least the cutoff and the sign is right.
 */
export function ringSDIndexed(x, z, ring, cutoff = Infinity) {
  if (ring.length < INDEX_MIN_VERTICES) return ringSD(x, z, ring);
  const index = indexFor(ring, true);
  if (!index) return ringSD(x, z, ring);
  /* outside the box by more than the cutoff: outside the ring by at least that */
  const outside = Math.max(index.x0 - x, x - index.x1, index.z0 - z, z - index.z1);
  if (outside >= cutoff) return Math.max(outside, cutoff);
  const m = distanceIndexed(index, x, z, cutoff);
  return insideIndexed(index, x, z) ? -m : m;
}

/** geom.js's inRing(x, z, ring), through the row bands: the same edges toggle. */
export function inRingIndexed(x, z, ring) {
  if (ring.length < INDEX_MIN_VERTICES) return inRing(x, z, ring);
  const index = indexFor(ring, true);
  if (!index) return inRing(x, z, ring);
  return insideIndexed(index, x, z);
}

/**
 * geom.js's distToLine(x, z, line), exact while the result is under cutoff.
 */
export function distToLineIndexed(x, z, line, cutoff = Infinity) {
  if (line.length < INDEX_MIN_VERTICES) return distToLine(x, z, line);
  const index = indexFor(line, false);
  if (!index) return distToLine(x, z, line);
  const outside = Math.max(index.x0 - x, x - index.x1, index.z0 - z, z - index.z1);
  if (outside >= cutoff) return Math.max(outside, cutoff);
  return distanceIndexed(index, x, z, cutoff);
}

/* geom's inRing is re-exported for the tests that prove the band test against it */
export { inRing as inRingPlain };
