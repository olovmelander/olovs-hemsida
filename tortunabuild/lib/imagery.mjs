/* The retained 2026-05-02 orthophoto as one georeferenced pixel accessor, plus
   the raster helpers every imagery tool here shares. Two 0.32 m review windows
   (north/south, 4000 x 4000 each, averaged from the 0.16 m source by the
   acquisition script) cover E 596880-598160, N 6613600-6616160, which holds
   every played point with 150 m to spare. Native 0.16 m pieces come from
   ortho-crop.mjs's fetchWindow when a tool needs them. Coordinates are
   EPSG:3006 metres or Tortuna-local metres (x = E - 597400.5, z = 6614899.5 - N). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';
import { TORTUNA_FRAME } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.resolve(HERE, '../cache');
export const REVIEW_WINDOWS = Object.freeze({
  south: { file: 'orthophoto/south.png', boundsEpsg3006: [596880, 6613600, 598160, 6614880], metres: 0.32, size: 4000 },
  north: { file: 'orthophoto/north.png', boundsEpsg3006: [596880, 6614880, 598160, 6616160], metres: 0.32, size: 4000 },
});
export const toLocal = ([e, n]) => [e - TORTUNA_FRAME.easting, TORTUNA_FRAME.northing - n];
export const toEpsg = ([x, z]) => [x + TORTUNA_FRAME.easting, TORTUNA_FRAME.northing - z];

/** Both review windows decoded, with a (E, N) -> [r, g, b] accessor; null outside. */
export function loadReviewMosaic() {
  const windows = Object.entries(REVIEW_WINDOWS).map(([id, spec]) => {
    const image = decodePng(fs.readFileSync(path.join(CACHE, spec.file)));
    if (image.width !== spec.size || image.height !== spec.size) throw new Error(`${id} window is ${image.width}x${image.height}, expected ${spec.size}`);
    return { id, ...spec, image };
  });
  const [minE, minN] = [Math.min(...windows.map(w => w.boundsEpsg3006[0])), Math.min(...windows.map(w => w.boundsEpsg3006[1]))];
  const [maxE, maxN] = [Math.max(...windows.map(w => w.boundsEpsg3006[2])), Math.max(...windows.map(w => w.boundsEpsg3006[3]))];
  const metres = 0.32;
  const rgb = (e, n) => {
    for (const w of windows) {
      const [e0, n0, e1, n1] = w.boundsEpsg3006;
      if (e < e0 || e >= e1 || n <= n0 || n > n1) continue;
      const px = Math.floor((e - e0) / w.metres), py = Math.floor((n1 - n) / w.metres);
      const o = (py * w.size + px) * w.image.channels;
      return [w.image.data[o], w.image.data[o + 1], w.image.data[o + 2]];
    }
    return null;
  };
  return { windows, metres, boundsEpsg3006: [minE, minN, maxE, maxN], rgb, rgbLocal: (x, z) => rgb(...toEpsg([x, z])) };
}

/** A regular raster over an EPSG:3006 window, sampled from any (E,N)->value function. */
export function sampleRaster({ boundsEpsg3006: [e0, n0, e1, n1], metres }, fn, Type = Float32Array) {
  const width = Math.round((e1 - e0) / metres), height = Math.round((n1 - n0) / metres);
  const values = new Type(width * height);
  for (let row = 0; row < height; row++) {
    const n = n1 - (row + 0.5) * metres;
    for (let col = 0; col < width; col++) values[row * width + col] = fn(e0 + (col + 0.5) * metres, n);
  }
  return { width, height, metres, originEasting: e0, originNorthing: n1, values,
    cell: (e, n) => [Math.floor((e - e0) / metres), Math.floor((n1 - n) / metres)],
    centre: (col, row) => [e0 + (col + 0.5) * metres, n1 - (row + 0.5) * metres] };
}

/** Excess green, the mown-turf discriminator every trace here has calibrated on. */
export const exg = ([r, g, b]) => 2 * g - r - b;
export const brightness = ([r, g, b]) => (r + g + b) / 3;

/** Point in polygon, even-odd, ring as [[x,y],...] (open or closed). */
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringBounds(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

/** Rasterise rings into a Uint8 mask on a raster's lattice (cells whose centre is inside). */
export function rasterizeRings(raster, rings, mask = new Uint8Array(raster.width * raster.height), value = 1) {
  for (const ring of rings) {
    const [e0, n0, e1, n1] = ringBounds(ring);
    const [c0, r1] = raster.cell(e0, n0), [c1, r0] = raster.cell(e1, n1);
    for (let row = Math.max(0, r0); row <= Math.min(raster.height - 1, r1); row++) {
      for (let col = Math.max(0, c0); col <= Math.min(raster.width - 1, c1); col++) {
        if (pointInRing(...raster.centre(col, row), ring)) mask[row * raster.width + col] = value;
      }
    }
  }
  return mask;
}

/** Distance in cells from every cell to the nearest cell where `isTarget(i)`; two-pass chamfer (3-4). */
export function chamferDistance(width, height, isTarget) {
  const INF = 1e9;
  const d = new Float32Array(width * height).fill(INF);
  for (let i = 0; i < d.length; i++) if (isTarget(i)) d[i] = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col; let v = d[i];
    if (col > 0) v = Math.min(v, d[i - 1] + 1);
    if (row > 0) { v = Math.min(v, d[i - width] + 1); if (col > 0) v = Math.min(v, d[i - width - 1] + 1.4142); if (col < width - 1) v = Math.min(v, d[i - width + 1] + 1.4142); }
    d[i] = v;
  }
  for (let row = height - 1; row >= 0; row--) for (let col = width - 1; col >= 0; col--) {
    const i = row * width + col; let v = d[i];
    if (col < width - 1) v = Math.min(v, d[i + 1] + 1);
    if (row < height - 1) { v = Math.min(v, d[i + width] + 1); if (col < width - 1) v = Math.min(v, d[i + width + 1] + 1.4142); if (col > 0) v = Math.min(v, d[i + width - 1] + 1.4142); }
    d[i] = v;
  }
  return d;
}

/** Box-filtered mean and standard deviation of a raster over a (2r+1)^2 window, via summed-area tables. */
export function localStats(raster, r) {
  const { width, height, values } = raster;
  const W = width + 1;
  const s1 = new Float64Array(W * (height + 1)), s2 = new Float64Array(W * (height + 1));
  for (let row = 1; row <= height; row++) {
    let acc1 = 0, acc2 = 0;
    for (let col = 1; col <= width; col++) {
      const v = values[(row - 1) * width + (col - 1)];
      acc1 += v; acc2 += v * v;
      s1[row * W + col] = s1[(row - 1) * W + col] + acc1;
      s2[row * W + col] = s2[(row - 1) * W + col] + acc2;
    }
  }
  const mean = new Float32Array(width * height), sd = new Float32Array(width * height);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const r0 = Math.max(0, row - r), r1 = Math.min(height - 1, row + r), c0 = Math.max(0, col - r), c1 = Math.min(width - 1, col + r);
    const n = (r1 - r0 + 1) * (c1 - c0 + 1);
    const sum = s1[(r1 + 1) * W + c1 + 1] - s1[r0 * W + c1 + 1] - s1[(r1 + 1) * W + c0] + s1[r0 * W + c0];
    const sq = s2[(r1 + 1) * W + c1 + 1] - s2[r0 * W + c1 + 1] - s2[(r1 + 1) * W + c0] + s2[r0 * W + c0];
    const m = sum / n;
    mean[row * width + col] = m; sd[row * width + col] = Math.sqrt(Math.max(0, sq / n - m * m));
  }
  return { mean, sd };
}

/** Morphology on a Uint8 mask with a square (2r+1) structuring element. */
export function dilate(mask, width, height, r) {
  const out = new Uint8Array(mask.length);
  const tmp = new Uint8Array(mask.length);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const c = col + k; if (c >= 0 && c < width && mask[row * width + c]) v = 1; }
    tmp[row * width + col] = v;
  }
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const rr = row + k; if (rr >= 0 && rr < height && tmp[rr * width + col]) v = 1; }
    out[row * width + col] = v;
  }
  return out;
}
export function erode(mask, width, height, r) {
  const inv = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, width, height, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}
export const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
export const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

/** Connected components (8-neighbour) of a mask; returns labels (Int32, 0 = none) and sizes. */
export function components(mask, width, height) {
  const labels = new Int32Array(mask.length);
  const sizes = [0];
  const stack = new Int32Array(mask.length);
  let next = 1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    let top = 0; stack[top++] = i; labels[i] = next; let size = 0;
    while (top) {
      const j = stack[--top]; size++;
      const row = Math.floor(j / width), col = j - row * width;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr, cc = col + dc;
        if (rr < 0 || rr >= height || cc < 0 || cc >= width) continue;
        const k = rr * width + cc;
        if (mask[k] && !labels[k]) { labels[k] = next; stack[top++] = k; }
      }
    }
    sizes.push(size); next++;
  }
  return { labels, sizes, count: next - 1 };
}

/** Trace the outer boundary of one component as a polygon of cell corners (marching squares, outer ring only). */
export function traceOuterRing(isInside, width, height, seedIndex) {
  /* boundary following on the cell grid: walk the outline of the 4-connected region containing the seed,
     keeping the region on the left. Returns corner coordinates [col,row] (cell edges). */
  const at = (c, r) => c >= 0 && c < width && r >= 0 && r < height && isInside(r * width + c);
  let sr = Math.floor(seedIndex / width), sc = seedIndex - sr * width;
  while (at(sc, sr - 1)) sr--; /* go to the top edge of the region above the seed column */
  /* start at the top-left corner of (sc, sr), heading east along its top edge */
  const start = [sc, sr];
  const ring = [];
  let x = sc, y = sr, dir = 0; /* 0 east, 1 south, 2 west, 3 north; position is a corner */
  const dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
  let guard = 0;
  do {
    ring.push([x, y]);
    /* cells around the corner (x,y): NW=(x-1,y-1) NE=(x,y-1) SW=(x-1,y) SE=(x,y) */
    const nw = at(x - 1, y - 1), ne = at(x, y - 1), sw = at(x - 1, y), se = at(x, y);
    /* choose next direction keeping inside on the right-hand side for a clockwise walk */
    let nd;
    if (dir === 0) nd = ne ? 3 : se ? 0 : 1;
    else if (dir === 1) nd = se ? 0 : sw ? 1 : 2;
    else if (dir === 2) nd = sw ? 1 : nw ? 2 : 3;
    else nd = nw ? 2 : ne ? 3 : 0;
    dir = nd; x += dx[dir]; y += dy[dir];
    if (++guard > 4 * (width + height) * 8) throw new Error('boundary trace did not close');
  } while (!(x === start[0] && y === start[1]));
  return ring;
}

/** Douglas-Peucker on a ring of [x,y] (open list; the closure is implicit). */
export function simplifyRing(points, tolerance) {
  if (points.length < 4) return points;
  /* a closed ring must be seeded on two chords, never on the degenerate
     first-to-last segment (which is one point and keeps nothing) */
  const closed = [...points, points[0]];
  const mid = Math.floor(points.length / 2);
  const keep = new Uint8Array(closed.length); keep[0] = keep[mid] = keep[closed.length - 1] = 1;
  const stack = [[0, mid], [mid, closed.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bestD = tolerance;
    const [ax, ay] = closed[a], [bx, by] = closed[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = closed[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < closed.length - 1; i++) if (keep[i]) out.push(closed[i]);
  return out;
}

export function ringArea(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a) / 2; }
export function ringCentroid(ring) { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; }
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from a point to a polyline and the fraction along it. */
export function distToPolyline(p, line) {
  let best = Infinity, bestT = 0, acc = 0, total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1], line[i]);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], ab = [b[0] - a[0], b[1] - a[1]], L2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)) : 0;
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t], d = dist(p, q);
    if (d < best) { best = d; bestT = (acc + Math.sqrt(L2) * t) / (total || 1); }
    acc += Math.sqrt(L2);
  }
  return { d: best, t: bestT };
}
