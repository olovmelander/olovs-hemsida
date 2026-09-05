/* Shapes on a cell raster: fill rings, label components, trace boundaries,
   simplify. Shared by the lake union and the surface tracer, so a polygon
   traced from a mask is one algorithm everywhere in this build. Frame: x
   east, z south (screen space), cells addressed row * width + column. */

export function bboxOfRings(rings) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const ring of rings) for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

/** A grid over a box: `grid.x0/z0` are the west/north edges, cell centres at (c + 0.5) * spacing. */
export function gridOver(box, spacing, padCells = 2) {
  const x0 = Math.floor(box.x0 / spacing) * spacing - padCells * spacing;
  const z0 = Math.floor(box.z0 / spacing) * spacing - padCells * spacing;
  const width = Math.ceil((box.x1 - x0) / spacing) + padCells + 1;
  const height = Math.ceil((box.z1 - z0) / spacing) + padCells + 1;
  return { x0, z0, width, height, spacing,
    cellOf: (x, z) => { const c = Math.floor((x - x0) / spacing), r = Math.floor((z - z0) / spacing); return (c < 0 || r < 0 || c >= width || r >= height) ? -1 : r * width + c; },
    centre: i => [x0 + (i % width + 0.5) * spacing, z0 + (Math.floor(i / width) + 0.5) * spacing] };
}

/** Scanline-fill `ring` into `target` (value where the cell centre is inside). */
export function fillRing(ring, target, grid, value = 1) {
  const { width, height, x0, z0, spacing } = grid;
  const n = ring.length;
  for (let row = 0; row < height; row++) {
    const z = z0 + (row + 0.5) * spacing;
    const crossings = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z)) crossings.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[k] - x0) / spacing - 0.5));
      const c1 = Math.min(width - 1, Math.floor((crossings[k + 1] - x0) / spacing - 0.5));
      for (let c = c0; c <= c1; c++) target[row * width + c] = value;
    }
  }
}

/** Label 4-connected non-zero cells; returns { label: Int32Array, sizes: number[] } (label 0 = none). */
export function labelComponents(mask, width, height) {
  const label = new Int32Array(width * height);
  const sizes = [0];
  const stack = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || label[seed]) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(seed); label[seed] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const column = i % width, row = (i - column) / width;
      if (column > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (column < width - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (row > 0 && mask[i - width] && !label[i - width]) { label[i - width] = id; stack.push(i - width); }
      if (row < height - 1 && mask[i + width] && !label[i + width]) { label[i + width] = id; stack.push(i + width); }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Binary morphology with a square window of radius r cells. */
export function erode(mask, width, height, r = 1) {
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    let keep = 1;
    for (let dr = -r; dr <= r && keep; dr++) for (let dc = -r; dc <= r; dc++) {
      const rr = row + dr, cc = column + dc;
      if (rr < 0 || cc < 0 || rr >= height || cc >= width || !mask[rr * width + cc]) { keep = 0; break; }
    }
    out[row * width + column] = keep;
  }
  return out;
}
export function dilate(mask, width, height, r = 1) {
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    if (!mask[row * width + column]) continue;
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
      const rr = row + dr, cc = column + dc;
      if (rr >= 0 && cc >= 0 && rr < height && cc < width) out[rr * width + cc] = 1;
    }
  }
  return out;
}
export const open = (mask, width, height, r = 1) => dilate(erode(mask, width, height, r), width, height, r);
export const close = (mask, width, height, r = 1) => erode(dilate(mask, width, height, r), width, height, r);

/** Fill the holes of a labelled component: every non-member cell not reachable from the raster edge. */
export function fillHoles(member, width, height) {
  const outside = new Uint8Array(width * height);
  const stack = [];
  const seed = i => { if (!member[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let c = 0; c < width; c++) { seed(c); seed((height - 1) * width + c); }
  for (let r = 0; r < height; r++) { seed(r * width); seed(r * width + width - 1); }
  while (stack.length) {
    const i = stack.pop();
    const column = i % width, row = (i - column) / width;
    if (column > 0) seed(i - 1); if (column < width - 1) seed(i + 1);
    if (row > 0) seed(i - width); if (row < height - 1) seed(i + width);
  }
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

/** Trace the boundary loops of the cells where `isMember(i)` holds, as
    lattice-corner loops. Each member cell contributes its four edges
    clockwise (x right, z down); interior edges cancel, and at a saddle
    corner the loop turns right so diagonally touching regions stay separate.
    Outer boundaries come out clockwise in screen space, holes anticlockwise. */
export function traceLoops(isMember, width, height) {
  const key = (c, r) => r * (width + 1) + c;
  const out = new Map();
  const member = (c, r) => c >= 0 && r >= 0 && c < width && r < height && isMember(r * width + c);
  const add = (c0, r0, c1, r1, dir) => {
    const k = key(c0, r0);
    const list = out.get(k) || [];
    list.push({ to: key(c1, r1), c: c1, r: r1, dir });
    out.set(k, list);
  };
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    if (!isMember(r * width + c)) continue;
    if (!member(c, r - 1)) add(c, r, c + 1, r, 0);
    if (!member(c + 1, r)) add(c + 1, r, c + 1, r + 1, 1);
    if (!member(c, r + 1)) add(c + 1, r + 1, c, r + 1, 2);
    if (!member(c - 1, r)) add(c, r + 1, c, r, 3);
  }
  const loops = [];
  for (const [startKey, edges] of out) {
    while (edges.length) {
      const first = edges.pop();
      const loop = [[startKey % (width + 1), Math.floor(startKey / (width + 1))]];
      let current = first;
      let guard = 0;
      while (current.to !== startKey) {
        loop.push([current.c, current.r]);
        const next = out.get(current.to);
        if (!next?.length) throw new Error('boundary does not close');
        let pick = -1;
        for (const want of [(current.dir + 1) % 4, current.dir, (current.dir + 3) % 4]) {
          pick = next.findIndex(edge => edge.dir === want);
          if (pick >= 0) break;
        }
        if (pick < 0) pick = 0;
        current = next.splice(pick, 1)[0];
        if (++guard > 50_000_000) throw new Error('boundary trace runaway');
      }
      loop.push([current.c, current.r]);
      loop.pop();
      loops.push(loop);
    }
  }
  return loops;
}

/** The outer loop (largest clockwise screen-space area) of a component, in world coordinates. */
export function outerRing(isMember, grid) {
  const loops = traceLoops(isMember, grid.width, grid.height);
  let outer = null, outerArea = -Infinity;
  for (const loop of loops) {
    let area = 0;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += (loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1]);
    if (area > outerArea) { outerArea = area; outer = loop; }
  }
  return outer ? outer.map(([c, r]) => [grid.x0 + c * grid.spacing, grid.z0 + r * grid.spacing]) : null;
}

/** Douglas–Peucker on a closed ring with a position-dependent tolerance. */
export function simplifyRing(ring, toleranceAt) {
  if (ring.length < 4) return ring;
  const tolerance = typeof toleranceAt === 'function' ? toleranceAt : () => toleranceAt;
  let a = 0, b = 0, best = -1;
  const stride = Math.max(1, Math.floor(ring.length / 400));
  for (let i = 0; i < ring.length; i += stride) for (let j = i + 1; j < ring.length; j += stride) {
    const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
    if (d > best) { best = d; a = i; b = j; }
  }
  const keep = new Uint8Array(ring.length);
  keep[a] = 1; keep[b] = 1;
  const segDist = (p, u, v) => {
    const dx = v[0] - u[0], dz = v[1] - u[1], l = dx * dx + dz * dz;
    let t = l ? ((p[0] - u[0]) * dx + (p[1] - u[1]) * dz) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dz);
  };
  const run = (i0, i1) => {
    const count = (i1 - i0 + ring.length) % ring.length;
    if (count < 2) return;
    const u = ring[i0], v = ring[i1];
    let worst = -1, at = -1;
    for (let k = 1; k < count; k++) {
      const i = (i0 + k) % ring.length;
      const d = segDist(ring[i], u, v);
      if (d > worst) { worst = d; at = i; }
    }
    const mid = ring[at];
    if (worst > tolerance(mid[0], mid[1])) { keep[at] = 1; run(i0, at); run(at, i1); }
  };
  run(a, b); run(b, a);
  return ring.filter((_, i) => keep[i]);
}

export const polygonArea = ring => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); };
export const centroid = ring => { let sx = 0, sz = 0; for (const p of ring) { sx += p[0]; sz += p[1]; } return [sx / ring.length, sz / ring.length]; };
