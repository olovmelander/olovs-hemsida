import { squaredDistanceTransform } from '../../../../packages/course-v2/distance-transform.mjs';

/* THE WATER ENDS WHERE THE GROUND RISES OUT OF IT (7 November, owner request:
   "i dont want these straight and sharp lines on the water").

   A lake's sheet was its traced ring, and the ring is a sketch: Puttom's run
   30-90 m between points (337 m at most) and sit inside the real shore. The
   ground between the ring and the bank is the laser's own lake surface, flat at
   the water's level, so it was drawn as a dry strip of bed below the water,
   2-10 m wide, ending at the ring's straight chords (measured beside Puttom's
   12th: 6 m at the median, 10 m at p90; Veckefjarden's 14th 2 m, Angso's 3rd
   2.5 m and 10.5 m).

   This reads the water off the ground instead. On a lattice round the ring, the
   water is every node connected to the ring's inside whose ground stands no
   higher than the level (plus the laser's own spread), out to `reach` metres
   past the ring. Three things come of it:

   - an OUTLINE for the sheet, the wet ground grown by `tuck` nodes under the
     bank: the terrain then hides the sheet wherever it is higher, so the
     waterline drawn is the ground's own contour at the level, at the terrain's
     resolution, with no chord and no corner of the ring in it;
   - the BANK DISTANCE at every node, metres to the nearest dry node, which the
     sheet fades in by (water-shading.mjs) and the bed deepens by;
   - the WET mask the bed is carved under (refineReachedWaterBeds), so the
     strip beyond the ring is water with depth, not a bed left dry.

   The source ring is untouched: it stays the hazard, the level's evidence and
   every other reader's water. Only the drawn sheet and the carved bed follow
   the ground. */

export const WATER_REACH = Object.freeze({
  /* how far past its ring a lake may run over low ground (probes reached 29 m) */
  reachMetres: 32,
  /* ground this little above the level is still the water's: the laser's
     surface over a lake is flat to 2 cm, and a node is a 1-2 m average */
  wetToleranceMetres: 0.08,
  /* the sheet runs this many nodes under the bank, so the ground draws the line */
  tuckNodes: 2,
  /* the lattice: finest near the course, coarser for the far lakes, and never
     more samples than this per lake */
  nearCellMetres: 1.5,
  farCellMetres: 5,
  maximumSamples: 100000,
  maximumNodes: 300000,
  /* how far above the laser's own surface a fitted shore may stand */
  fitRangeMetres: 1.5,
  /* the bed is the lattice's only this far from the bank: deeper, under more than a metre
     of water that shows no bed (water-shading.mjs), the broad field carves it, and the
     boot does not walk every lake's open water through the lattice */
  ownBandMetres: 10,
});

function bbox(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

function perimeter(ring) {
  let p = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

/* even-odd scanline fill of a ring at the lattice's node centres */
function fillRing(ring, x0, z0, cell, cols, rows) {
  const inside = new Uint8Array(cols * rows);
  const xs = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * cell;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z)) xs.push(xi + (z - zi) * (xj - xi) / (zj - zi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / cell));
      for (let c = c0; c <= c1; c++) inside[r * cols + c] = 1;
    }
  }
  return inside;
}

/* The outer boundary of a node mask, through the midpoints of the lattice edges
   it crosses (marching squares at 0.5). Inside lies on the left, so an outer
   loop has positive area and a hole negative; the largest outer loop is kept,
   since a hole in the sheet is ground the terrain hides anyway. */
export function traceMaskOutline(mask, cols, rows, x0, z0, cell) {
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : mask[r * cols + c]);
  /* edge ids: horizontal edge (c, r)-(c+1, r) = 2 * (r * (cols + 1) + c), vertical (c, r)-(c, r+1) = +1 */
  const W = cols + 1;
  const hEdge = (c, r) => 2 * ((r + 1) * (W + 1) + (c + 1));
  const vEdge = (c, r) => 2 * ((r + 1) * (W + 1) + (c + 1)) + 1;
  const point = id => {
    const k = id >> 1, r = Math.floor(k / (W + 1)) - 1, c = k % (W + 1) - 1;
    return id & 1 ? [x0 + c * cell, z0 + (r + 0.5) * cell] : [x0 + (c + 0.5) * cell, z0 + r * cell];
  };
  const next = new Map();
  /* each square (c, r)-(c+1, r+1); corners a (c,r) b (c+1,r) d (c+1,r+1) e (c,r+1) */
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const a = at(c, r), b = at(c + 1, r), d = at(c + 1, r + 1), e = at(c, r + 1);
      const code = a | b << 1 | d << 2 | e << 3;
      if (code === 0 || code === 15) continue;
      const top = hEdge(c, r), right = vEdge(c + 1, r), bottom = hEdge(c, r + 1), left = vEdge(c, r);
      /* segments directed with the inside on the left, in x-right z-down space */
      const seg = (from, to) => next.set(from, to);
      switch (code) {
        case 1: seg(left, top); break;
        case 2: seg(top, right); break;
        case 3: seg(left, right); break;
        case 4: seg(right, bottom); break;
        case 5: seg(left, bottom); seg(right, top); break;   /* a and d: kept apart */
        case 6: seg(top, bottom); break;
        case 7: seg(left, bottom); break;
        case 8: seg(bottom, left); break;
        case 9: seg(bottom, top); break;
        case 10: seg(top, left); seg(bottom, right); break;  /* b and e: kept apart */
        case 11: seg(bottom, right); break;
        case 12: seg(right, left); break;
        case 13: seg(right, top); break;
        case 14: seg(top, left); break;
      }
    }
  }
  let best = null, bestArea = 0;
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let id = start;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      loop.push(point(id));
      id = next.get(id);
    }
    if (loop.length < 3) continue;
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    /* z points south, so a loop with the inside on its left has negative shoelace area here */
    const outer = -area / 2;
    if (outer > bestArea) { bestArea = outer; best = loop; }
  }
  return best ? simplifyRing(best, cell * 0.3) : null;
}

/* Douglas-Peucker on a closed ring, split at its two farthest points */
function simplifyRing(ring, tolerance) {
  if (ring.length < 8) return ring;
  let far = 0, d = 0;
  for (let i = 1; i < ring.length; i++) {
    const q = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (q > d) { d = q; far = i; }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[far] = 1;
  const stack = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = ring[i], b = ring[j % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = ring[k];
      const e = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / l;
      if (e > worst) { worst = e; at = k; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * The water a ring's ground holds. `heightAt(x, z)` is the UNCARVED ground (the
 * laser's lake surface inside the ring); `near(x, z)` says whether the lake is
 * beside the played ground, which earns it the fine lattice.
 * Returns null when the ring is degenerate or nothing could be sampled.
 */
export function waterReach({ ring, level, heightAt, near = () => true, surface = NaN, otherWater = null, fit = false, options = {} } = {}) {
  const o = { ...WATER_REACH, ...options };
  if (!Array.isArray(ring) || ring.length < 3 || (!fit && !Number.isFinite(level)) || typeof heightAt !== 'function') return null;
  /* the highest ground that is still the lake's: its level, and never above the laser's
     own surface inside it (water-plate-level.mjs) by more than the tolerance -- a level
     lifted clear of that surface would otherwise flood a gentle bank, or a fairway */
  let ceiling = NaN;   /* set once the ring's inside has been read, below */
  const box = bbox(ring);
  const centre = [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2];
  const nearRing = ring.some(p => near(p[0], p[1])) || near(centre[0], centre[1]);
  /* the ring's inside (its islands and banks too) and the band round it are what get
     sampled: choose the cell they fit in */
  let ringArea = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; ringArea += p[0] * q[1] - q[0] * p[1]; }
  const extent = Math.abs(ringArea) / 2 + perimeter(ring) * o.reachMetres;
  let cell = nearRing ? o.nearCellMetres : o.farCellMetres;
  while (extent / (cell * cell) > o.maximumSamples) cell *= 1.5;
  const margin = o.reachMetres + (o.tuckNodes + 3) * cell;
  let cols = Math.ceil((box.x1 - box.x0 + 2 * margin) / cell) + 1;
  let rows = Math.ceil((box.z1 - box.z0 + 2 * margin) / cell) + 1;
  while (cols * rows > o.maximumNodes) {
    cell *= 1.5;
    cols = Math.ceil((box.x1 - box.x0 + 2 * margin) / cell) + 1;
    rows = Math.ceil((box.z1 - box.z0 + 2 * margin) / cell) + 1;
  }
  const x0 = box.x0 - margin, z0 = box.z0 - margin;
  const n = cols * rows;
  const inside = fillRing(ring, x0, z0, cell, cols, rows);
  /* distance in nodes from the ring's inside */
  const toInside = squaredDistanceTransform(cols, rows, i => inside[i] === 1);
  const reach2 = (o.reachMetres / cell) ** 2;
  /* 0 beyond the reach, 1 sampled and dry, 2 sampled and low enough to be the lake's,
     3 water another sheet draws: a lake the extract cut at its box runs on as the flat
     water the ground found (v2-flat-water.mjs), and its sheet is drawn there already.
     The reach does not flood it, own its bed or tuck its outline into it, but it is
     water, so the sheet does not fade toward it: the two meet as they did. */
  const kind = new Uint8Array(n);
  const heights = new Float32Array(n).fill(Number.NaN), insideHeights = [];
  let samples = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * cell;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inside[i] && toInside[i] > reach2) continue;
      if (!inside[i] && otherWater && otherWater(x0 + c * cell, z)) { kind[i] = 3; continue; }
      heights[i] = heightAt(x0 + c * cell, z);
      samples++;
      kind[i] = 1;
      if (inside[i] && Number.isFinite(heights[i])) insideHeights.push(heights[i]);
    }
  }
  if (!samples) return null;
  if (insideHeights.length) insideHeights.sort((a, b) => a - b);
  /* THE SPILL: every node's lowest water level that reaches it from the ring's inside --
     the inside's own ground, then outward the lowest pass over the ground between
     (a priority flood). Water at level L covers exactly the nodes whose spill is at most
     L, connected by construction; the level fit below and the reach both read it. */
  const spill = spillFrom(heights, inside, kind, cols, rows);
  let fitted = null;
  if (fit) {
    fitted = fitShoreLevel({ spill, inside, kind, n, surface, insideHeights, maximumRise: o.fitRangeMetres });
    if (!fitted) return null;
    level = fitted.level;
    ceiling = fitted.shore + o.wetToleranceMetres;
  } else {
    /* a pond too small (or too wooded) for the plate reading has no surface given: its own
       inside's lower quartile is its water, and the level's lift never floods its banks */
    if (!Number.isFinite(surface) && insideHeights.length) surface = insideHeights[Math.floor(insideHeights.length * 0.25)];
    ceiling = Math.min(level, Number.isFinite(surface) ? surface : Infinity) + o.wetToleranceMetres;
  }
  for (let i = 0; i < n; i++) if (kind[i] === 1 && Number.isFinite(heights[i]) && heights[i] <= ceiling) kind[i] = 2;
  /* the water: every node the level reaches from the ring's inside */
  const wet = new Uint8Array(n);
  for (let i = 0; i < n; i++) if ((kind[i] === 1 || kind[i] === 2) && spill[i] <= ceiling) wet[i] = 1;
  const dry = squaredDistanceTransform(cols, rows, i => wet[i] === 0 && kind[i] !== 3);
  const bank = new Float32Array(n);
  let outsideWet = 0, farthest = 0;
  for (let i = 0; i < n; i++) {
    bank[i] = Math.sqrt(dry[i]) * cell;
    /* 4: open water inside the ring, far from any bank, left to the broad field's bed */
    if (wet[i] && inside[i] && bank[i] > o.ownBandMetres) kind[i] = 4;
    if (wet[i] && !inside[i]) {
      outsideWet++;
      const d = Math.sqrt(toInside[i]) * cell;
      if (d > farthest) farthest = d;
    }
  }
  /* the sheet: the water and the ring's own inside, grown under the bank */
  const region = squaredDistanceTransform(cols, rows, i => wet[i] === 1 || inside[i] === 1);
  const tuck2 = o.tuckNodes * o.tuckNodes + 1e-6;
  const sheet = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (region[i] > tuck2 || kind[i] === 3) continue;
    /* past the reach too, another sheet's water is never tucked into */
    if (kind[i] === 0 && otherWater && otherWater(x0 + (i % cols) * cell, z0 + Math.floor(i / cols) * cell)) continue;
    sheet[i] = 1;
  }
  const outline = traceMaskOutline(sheet, cols, rows, x0, z0, cell);
  if (!outline) return null;
  return makeReach({
    level, ceiling, fitted, x0, z0, cell, cols, rows, wet, bank, kind, outline,
    stats: { cell, samples, nodes: n, outsideWetSquareMetres: Math.round(outsideWet * cell * cell),
      farthestOutsideMetres: +farthest.toFixed(1), outlinePoints: outline.length, ringPoints: ring.length },
  });
}

/* The lowest water level that reaches each node from the ring's inside (Infinity where
   none can: beyond the reach, another sheet's water, no ground). A binary-heap priority
   flood seeded with every inside node at its own height. */
function spillFrom(heights, inside, kind, cols, rows) {
  const n = cols * rows;
  const spill = new Float32Array(n).fill(Infinity);
  const heapI = new Int32Array(n), heapV = new Float32Array(n);
  let size = 0;
  const push = (i, v) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapV[p] <= v) break;
      heapI[k] = heapI[p]; heapV[k] = heapV[p]; k = p;
    }
    heapI[k] = i; heapV[k] = v;
  };
  const pop = () => {
    const top = heapI[0], last = heapI[--size], lastV = heapV[size];
    let k = 0;
    for (;;) {
      let child = 2 * k + 1;
      if (child >= size) break;
      if (child + 1 < size && heapV[child + 1] < heapV[child]) child++;
      if (heapV[child] >= lastV) break;
      heapI[k] = heapI[child]; heapV[k] = heapV[child]; k = child;
    }
    heapI[k] = last; heapV[k] = lastV;
    return top;
  };
  const open = i => (kind[i] === 1 || kind[i] === 2) && Number.isFinite(heights[i]);
  for (let i = 0; i < n; i++) if (inside[i] && open(i)) { spill[i] = heights[i]; push(i, heights[i]); }
  const done = new Uint8Array(n);
  while (size) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const c = i % cols, v = spill[i];
    for (const j of [c ? i - 1 : -1, c + 1 < cols ? i + 1 : -1, i - cols, i + cols]) {
      if (j < 0 || j >= n || done[j] || !open(j)) continue;
      const w = Math.max(heights[j], v);
      if (w < spill[j]) { spill[j] = w; push(j, w); }
    }
  }
  return spill;
}

/* THE LEVEL A TRACED SHORE AND ITS GROUND AGREE ON (8 November, owner request: "one
   solid way to place the water correctly on the golf courses"; Upsala's first ponds
   felt too low). A water outline is traced off summer aerials: it is where the water
   stands. The laser caught the same water's surface on one day of one campaign, often
   lower, and a level read off either alone was wrong somewhere: the outline's ground
   plus a quarter metre flooded banks, and the laser's surface left Upsala's ponds a
   metre down their banks inside their own outlines.

   So the level is the one at which the water, rising over the laser's ground from the
   outline's inside, covers the outline best: the most overlap (intersection over
   union) between the water and the traced polygon, the lowest such level within half
   a percent, never below the laser's own surface inside (the water was at least that
   high when it was measured) and at most `maximumRise` above it. The sheet stands the
   measured-water display clearance above that shore. */
export function fitShoreLevel({ spill, inside, kind, n, surface = NaN, insideHeights = [], maximumRise = 1.5,
  clearance = 0.06, step = 0.01 }) {
  const insideSpill = [], outsideSpill = [];
  for (let i = 0; i < n; i++) {
    if (!(kind[i] === 1 || kind[i] === 2) || !Number.isFinite(spill[i])) continue;
    (inside[i] ? insideSpill : outsideSpill).push(spill[i]);
  }
  /* the inside's ground the lattice could read: the polygon's own area in nodes */
  let insideTotal = 0;
  for (let i = 0; i < n; i++) if (inside[i] && (kind[i] === 1 || kind[i] === 2)) insideTotal++;
  if (!insideSpill.length || !insideTotal) return null;
  insideSpill.sort((a, b) => a - b); outsideSpill.sort((a, b) => a - b);
  const below = (sorted, v) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo; };
  const floor = Number.isFinite(surface) ? surface : insideHeights[Math.floor(insideHeights.length * 0.1)];
  const top = floor + maximumRise;
  let best = -1, bestLevel = floor;
  const scores = [];
  for (let L = floor; L <= top + 1e-9; L += step) {
    const iou = below(insideSpill, L) / (insideTotal + below(outsideSpill, L));
    scores.push([L, iou]);
    if (iou > best) { best = iou; bestLevel = L; }
  }
  /* the middle of the run of levels within half a percent of the best round it: a
     lattice node stands for a band of the bank, so the outline's own level lies inside
     that run, not at its foot (the foot was 0.1 m low on a 1:10 bank at 1.5 m) */
  const at = scores.findIndex(([L]) => L === bestLevel);
  let lo = at, hi = at;
  while (lo > 0 && scores[lo - 1][1] >= best - 0.005) lo--;
  while (hi + 1 < scores.length && scores[hi + 1][1] >= best - 0.005) hi++;
  /* ...unless the run reaches down to the laser's own surface: the measured water already
     covers the outline, and the water stands there */
  const shore = lo === 0 ? scores[0][0] : (scores[lo][0] + scores[hi][0]) / 2;
  return Object.freeze({
    shore: Math.round(shore * 1000) / 1000,
    level: Math.round((shore + clearance) * 100) / 100,
    overlap: +best.toFixed(3),
    surface: Number.isFinite(surface) ? surface : null,
    method: 'shore-fit',
  });
}

/* the queries every consumer shares: the bed, the sheet and the tint */
function makeReach(data) {
  const { x0, z0, cell, cols, rows, wet, bank, kind } = data;
  const x1 = x0 + (cols - 1) * cell, z1 = z0 + (rows - 1) * cell;
  /* the corner node and the fractions, held in place: these are asked of every tint
     texel and sheet vertex near a lake, and must not allocate */
  let ci = -1, tx = 0, tz = 0;
  const corner = (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    const c = Math.floor(fx), r = Math.floor(fz);
    if (c < 0 || r < 0 || c >= cols - 1 || r >= rows - 1) return false;
    ci = r * cols + c; tx = fx - c; tz = fz - r;
    return true;
  };
  const bilinear = values => {
    const i = ci;
    return (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - tz) + (values[i + cols] * (1 - tx) + values[i + cols + 1] * tx) * tz;
  };
  /* sampled ground, dry or the lake's: not beyond the reach, another sheet's water or open water */
  const owned = i => kind[i] === 1 || kind[i] === 2;
  return Object.freeze({
    ...data,
    bounds: Object.freeze({ x0, z0, x1, z1 }),
    /** metres to the bank: 0 on dry ground and beyond the lattice */
    bankAt(x, z) { return corner(x, z) ? bilinear(bank) : 0; },
    /** the lattice decides here: ground it sampled, dry or the lake's, near a bank */
    ownsAt(x, z) {
      if (!corner(x, z)) return false;
      const i = ci;
      return owned(i) && owned(i + 1) && owned(i + cols) && owned(i + cols + 1);
    },
    /** how many of the four nodes round (x, z) are water, 0-1 */
    wetAt(x, z) { return corner(x, z) ? bilinear(wet) : 0; },
  });
}

/* THE BANK, DAMP; THE SHALLOWS' BED, SILT. The ground's colour beside a lake its
   ground was read for (the near tint, main.js): within `heightMetres` above the
   water's ceiling the bank darkens toward the waterline by up to `darken`, and
   ground under the reached water takes `bedShare` of the bed's silt, which the
   faded shallows show through. By height, not by distance: a steep bank keeps a
   narrow band and a flat shore a wide one, as wet ground does. ?shoredamp=0. */
export const SHORE_DAMP = Object.freeze({ heightMetres: 0.5, darken: 0.24, bedShare: 0.5 });

/** { under, damp } at (x, z) for ground at height h, or null where no lake decides */
export function shoreWetness(reaches, x, z, h) {
  for (const reach of reaches) {
    const b = reach.bounds;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !reach.ownsAt(x, z)) continue;
    const wet = reach.wetAt(x, z), above = h - reach.ceiling;
    if (wet <= 0 && !(above < SHORE_DAMP.heightMetres)) return null;
    const t = Math.min(1, Math.max(0, above / SHORE_DAMP.heightMetres));
    return { under: above <= 0 ? wet : 0, damp: above > 0 ? 1 - t * t * (3 - 2 * t) : 0 };
  }
  return null;
}

/**
 * The far lakes the ground found (v2-flat-water.mjs) are drawn as one sheet cut
 * by their 8 m mask, so their shores were the mask's cells, bevelled by its
 * filtering: steps along every far shore. Grow each lake the model does not know
 * by one cell, under its bank, and the terrain draws the waterline there too.
 * A lake that continues a mapped one is left as it is (its mapped sheet meets it
 * at the same level, and two sheets over one cell would blend twice), and so is
 * a cell `blocked(column, row)` says another sheet covers. Returns the mask's
 * bytes (255 water) and how many cells were grown.
 */
export function growFlatWaterMask({ mask, label, width, height, components, blocked = () => false }) {
  const standalone = new Set(components.filter(c => c.knownCells === 0).map(c => c.id));
  const kept = new Set(components.map(c => c.id));
  const bytes = Uint8Array.from(mask, value => (value ? 255 : 0));
  let grown = 0;
  /* from each water cell of a lake the model does not know, to its eight neighbours:
     the raster is 4 million cells and the shores a few thousand */
  let lastLabel = 0, lastStandalone = false;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (label[i] !== lastLabel) { lastLabel = label[i]; lastStandalone = standalone.has(lastLabel); }
    if (!lastStandalone) continue;
    const row = (i / width) | 0, column = i - row * width;
    for (let dr = -1; dr <= 1; dr++) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const c = column + dc;
        if (c < 0 || c >= width || (!dr && !dc)) continue;
        const j = r * width + c;
        /* water already (or grown, or refused), or a lake's cell a ring covers */
        if (bytes[j] || mask[j] || (label[j] && kept.has(label[j]))) continue;
        if (blocked(c, r)) { bytes[j] = 1; continue; }
        bytes[j] = 255;
        grown++;
      }
    }
  }
  /* the refused cells were marked 1 so each was asked once: clear them */
  for (let j = 0; j < bytes.length; j++) if (bytes[j] === 1) bytes[j] = 0;
  return { bytes, grown };
}

/**
 * Split the sheet's triangles near the bank until no edge there is longer than
 * `maxEdge`, so the fade (water-shading.mjs) and the depth it is drawn with are
 * read close to the waterline instead of across a 20 m triangle. Conforming: an
 * edge split by one triangle is split by its neighbour too, at the same vertex,
 * so the sheet stays one surface with no T-junction for a hairline to open in.
 * Winding is kept. `bankAt(x, z)` is metres to the bank.
 */
export function refineNearShore(verts, faces, bankAt, { maxEdge = 2, within = 8, passes = 9 } = {}) {
  const V = verts.map(v => [v[0], v[1]]);
  let F = faces.map(f => [f[0], f[1], f[2]]);
  const bank = V.map(([x, z]) => bankAt(x, z));
  const key = (a, b) => (a < b ? a * 0x200000 + b : b * 0x200000 + a);
  for (let pass = 0; pass < passes; pass++) {
    const split = new Map();
    const long = (a, b) => Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]) > maxEdge;
    for (const [a, b, c] of F) {
      if (Math.min(bank[a], bank[b], bank[c]) > within) continue;
      if (long(a, b)) split.set(key(a, b), -1);
      if (long(b, c)) split.set(key(b, c), -1);
      if (long(c, a)) split.set(key(c, a), -1);
    }
    if (!split.size) break;
    const mid = (p, q) => {
      const k = key(p, q);
      let m = split.get(k);
      if (m === undefined) return -1;
      if (m < 0) {
        m = V.length;
        V.push([(V[p][0] + V[q][0]) / 2, (V[p][1] + V[q][1]) / 2]);
        bank.push(bankAt(V[m][0], V[m][1]));
        split.set(k, m);
      }
      return m;
    };
    const next = [];
    for (const [a, b, c] of F) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      const n = (ab >= 0) + (bc >= 0) + (ca >= 0);
      if (n === 0) next.push([a, b, c]);
      else if (n === 3) next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      else if (n === 1) {
        if (ab >= 0) next.push([a, ab, c], [ab, b, c]);
        else if (bc >= 0) next.push([a, b, bc], [a, bc, c]);
        else next.push([a, b, ca], [ca, b, c]);
      } else if (ab < 0) next.push([c, ca, bc], [a, b, bc], [a, bc, ca]);
      else if (bc < 0) next.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
      else next.push([b, bc, ab], [a, ab, bc], [a, bc, c]);
    }
    F = next;
  }
  return { V, F, bank };
}

/**
 * The bed under the water the ground holds, wrapped round the broad field the
 * way refineMappedWaterBeds wraps it: where a lake's lattice decides, its wet
 * nodes deepen from the bank by the field's own profile and its dry nodes are
 * not carved at all (`toleranceAt`: no bank above the level plus the laser's
 * spread is lowered, where the broad field lowered anything within 0.5 m of
 * it inside half an 8 m cell). Elsewhere the field answers as before.
 * `toLegacy` takes the field's grid space to the lattices' legacy space.
 */
export function refineReachedWaterBeds(field, reaches, toLegacy) {
  const list = (reaches ?? []).filter(Boolean);
  if (!list.length) return field;
  const { shoreDepthMetres, depthPerMetre, maximumDepthMetres } = field;
  /* the bridge is linear: carry it as coefficients, so no sample allocates */
  const [ox, oz] = toLegacy(0, 0), [ax, az] = toLegacy(1, 0), [bx, bz] = toLegacy(0, 1);
  const xx = ax - ox, xz = az - oz, zx = bx - ox, zz = bz - oz;
  /* ...and its inverse, to the field's grid space the carve walks in */
  const det = xx * zz - zx * xz;
  const toGrid = (x, z) => [((x - ox) * zz - (z - oz) * zx) / det, ((z - oz) * xx - (x - ox) * xz) / det];
  /* a coarse grid, in the carve's own grid space, of where any lake owns ground: every
     other sample of the millions the carve walks is one lookup, with no transform */
  const OCC = 32;
  const owned = [];
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  for (let l = 0; l < list.length; l++) {
    const r = list[l];
    for (let row = 0; row < r.rows; row++) for (let col = 0; col < r.cols; col++) {
      const k = r.kind[row * r.cols + col];
      if (k !== 1 && k !== 2) continue;
      const [gx, gz] = toGrid(r.x0 + col * r.cell, r.z0 + row * r.cell);
      owned.push(gx, gz, r.cell, l);
      if (gx < gx0) gx0 = gx; if (gx > gx1) gx1 = gx;
      if (gz < gz0) gz0 = gz; if (gz > gz1) gz1 = gz;
    }
  }
  gx0 -= 2 * OCC; gz0 -= 2 * OCC; gx1 += 2 * OCC; gz1 += 2 * OCC;
  const ow = Math.max(1, Math.ceil((gx1 - gx0) / OCC) + 1), oh = Math.max(1, Math.ceil((gz1 - gz0) / OCC) + 1);
  /* each cell holds the one lake that owns ground in it (its index + 1), or 255 for several */
  const occupied = new Uint8Array(ow * oh);
  for (let k = 0; k < owned.length; k += 4) {
    /* a node reaches a sample up to one lattice cell away (and the bridge turns a little):
       mark every grid cell its neighbourhood touches */
    const reachG = owned[k + 2] * 1.5;
    const c0 = Math.floor((owned[k] - reachG - gx0) / OCC), c1 = Math.floor((owned[k] + reachG - gx0) / OCC);
    const q0 = Math.floor((owned[k + 1] - reachG - gz0) / OCC), q1 = Math.floor((owned[k + 1] + reachG - gz0) / OCC);
    const mark = Math.min(254, owned[k + 3] + 1);
    for (let q = q0; q <= q1; q++) for (let c = c0; c <= c1; c++) {
      const was = occupied[q * ow + c];
      occupied[q * ow + c] = was === 0 || was === mark ? mark : 255;
    }
  }
  /* each grid row's runs of occupied cells, as [x0, x1) pairs in grid metres, for a carve
     that walks a row (rowSpan): everything between the runs is the broad field's */
  const rowRuns = new Array(oh).fill(null);
  for (let q = 0; q < oh; q++) {
    const runs = [];
    for (let c = 0; c < ow; c++) {
      if (!occupied[q * ow + c]) continue;
      const start = c;
      while (c + 1 < ow && occupied[q * ow + c + 1]) c++;
      runs.push(gx0 + start * OCC, gx0 + (c + 1) * OCC);
    }
    if (runs.length) rowRuns[q] = Float64Array.from(runs);
  }
  let lastX = NaN, lastZ = NaN, hit = false, sWet = 0, sDepth = 0, sLevel = NaN, sTolerance = 0;
  /* sets the s* answers and says whether a lake decides at (gx, gz) */
  const sample = (gx, gz) => {
    if (gx === lastX && gz === lastZ) return hit;
    lastX = gx; lastZ = gz; hit = false;
    const cx = Math.floor((gx - gx0) / OCC), cz = Math.floor((gz - gz0) / OCC);
    if (cx < 0 || cz < 0 || cx >= ow || cz >= oh) return false;
    const mark = occupied[cz * ow + cx];
    if (!mark) return false;
    const x = ox + gx * xx + gz * zx, z = oz + gx * xz + gz * zz;
    for (let l = mark === 255 ? 0 : mark - 1, end = mark === 255 ? list.length : mark; l < end; l++) {
      const r = list[l];
      const fx = (x - r.x0) / r.cell, fz = (z - r.z0) / r.cell;
      const c = Math.floor(fx), q = Math.floor(fz);
      if (c < 0 || q < 0 || c >= r.cols - 1 || q >= r.rows - 1) continue;
      const k = r.kind, cols = r.cols, i = q * cols + c;
      const k0 = k[i], k1 = k[i + 1], k2 = k[i + cols], k3 = k[i + cols + 1];
      /* owned: sampled ground, dry or the lake's (not beyond, another sheet's, or open water) */
      if (!((k0 === 1 || k0 === 2) && (k1 === 1 || k1 === 2) && (k2 === 1 || k2 === 2) && (k3 === 1 || k3 === 2))) continue;
      const tx = fx - c, tz = fz - q, w = r.wet, b = r.bank;
      const wet = (w[i] * (1 - tx) + w[i + 1] * tx) * (1 - tz) + (w[i + cols] * (1 - tx) + w[i + cols + 1] * tx) * tz;
      /* the bed falls from the bank by the broad field's profile; between a wet node and
         a dry one it rises to the bank over one node */
      const bank = (b[i] * (1 - tx) + b[i + 1] * tx) * (1 - tz) + (b[i + cols] * (1 - tx) + b[i + cols + 1] * tx) * tz;
      sWet = wet;
      sDepth = wet > 0 ? wet * Math.min(maximumDepthMetres, shoreDepthMetres + depthPerMetre * bank) : 0;
      sLevel = wet > 0 ? r.level : NaN;
      /* carve nothing above the lake's own ceiling (waterReach): no bank is lowered */
      sTolerance = r.ceiling - r.level;
      hit = true;
      return true;
    }
    return false;
  };
  const refined = Object.freeze({ ...field,
    reachedBodies: list.length,
    /** the broad field under this one */
    inner: field,
    /** the [x0, x1) runs of grid row z the lakes may decide in (flat pairs), or null:
        the rest of the row is the broad field's */
    rowSpan(gz) {
      const q = Math.floor((gz - gz0) / OCC);
      return q < 0 || q >= oh ? null : rowRuns[q];
    },
    /** the field a carve of the grid box (x0, z0)-(x1, z1) needs: a tile that touches no
        lake's ground walks the broad field directly, without this wrapper */
    within(x0, z0, x1, z1) {
      const c0 = Math.max(0, Math.floor((x0 - gx0) / OCC)), c1 = Math.min(ow - 1, Math.floor((x1 - gx0) / OCC));
      const q0 = Math.max(0, Math.floor((z0 - gz0) / OCC)), q1 = Math.min(oh - 1, Math.floor((z1 - gz0) / OCC));
      for (let q = q0; q <= q1; q++) for (let c = c0; c <= c1; c++) if (occupied[q * ow + c]) return refined;
      return field;
    },
    inWater(gx, gz) { return sample(gx, gz) ? sWet >= 0.5 : field.inWater(gx, gz); },
    nearWater(gx, gz) { return sample(gx, gz) ? sWet > 0 : field.nearWater(gx, gz); },
    depthAt(gx, gz) { return sample(gx, gz) ? sDepth : field.depthAt(gx, gz); },
    levelAt(gx, gz) { return sample(gx, gz) ? sLevel : field.levelAt(gx, gz); },
    toleranceAt(gx, gz) {
      if (sample(gx, gz)) return sTolerance;
      return typeof field.toleranceAt === 'function' ? field.toleranceAt(gx, gz) : undefined;
    },
  });
  return refined;
}
