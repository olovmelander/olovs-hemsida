/* Individual trees from a pit-free 0.5 m canopy height model, with per-tree
   attributes from the leaf-off returns and the orthophotos: the second-
   generation detector for grounds whose laser is sparse (1-3 returns/m²).

   Detection reuses crown-detect.mjs's two steps on a better surface:
   treetops are local maxima of the Gaussian-smoothed pit-free CHM inside a
   circular window whose radius grows with height (radius = base + slope x h,
   clamped), and crowns are grown from them by Dalponte-style region growing
   (Dalponte & Coomes 2016; lidR's dalponte2016), with heights read from the
   unsmoothed CHM. The coefficients are chosen by a benchmark on calibration
   areas only (see the pilot review), never assumed universal.

   The attributes are measured, not invented: crown height and area, an
   irregular outline (the convex hull of the crown's cells), and the leaf-off
   structure of the returns inside it -- how many first returns stop in the
   crown, how many reach the ground -- which separates evergreen conifers
   (pulses intercepted) from bare broadleaves (pulses through) in an April
   scan. Photo terms are supplied by the caller from co-registered mosaics.
   None of this is a stem position: a crown centre and an apex are kept.   */
import { createRaster } from './canopy-fields.mjs';
import { crownStatistics, detectLocalMaxima, growCrowns } from './crown-detect.mjs';
import { smoothChm } from './pit-free-chm.mjs';

export const TREE_DETECT_V2_DEFAULTS = Object.freeze({
  smoothingSigmaMetres: 0.6,
  windowBaseMetres: 0.8,
  windowSlope: 0.08,
  windowMinimumMetres: 1.5,
  windowMaximumMetres: 4,
  minimumCandidateHeightMetres: 3,
  seedFraction: 0.45,
  crownFraction: 0.55,
  maximumCrownRadiusMetres: 10,
  /* a grown crown smaller than this is a branch or noise, not a tree */
  minimumCrownAreaSquareMetres: 1.5,
  /* a top less than this above the saddle to a taller neighbour is a branch */
  minimumProminenceMetres: 1,
  /* crown extents continue down to this fraction of the apex (0 = core only) */
  extentFraction: 0.25,
});

/** The parameter names crown-detect.mjs expects. */
export function crownDetectParameters(parameters) {
  return Object.freeze({
    windowBaseMetres: parameters.windowBaseMetres,
    windowSlope: parameters.windowSlope,
    windowMinimumMetres: parameters.windowMinimumMetres,
    windowMaximumMetres: parameters.windowMaximumMetres,
    minimumCandidateHeightMetres: parameters.minimumCandidateHeightMetres,
    seedFraction: parameters.seedFraction,
    crownFraction: parameters.crownFraction,
    maximumCrownRadiusMetres: parameters.maximumCrownRadiusMetres,
    horizontalAccuracyFloorMetres: 1.5,
    verticalAccuracyFloorMetres: 1.5,
  });
}

/**
 * Dalponte-style growth from every treetop AT ONCE. crown-detect.mjs grows
 * one crown after another, tallest first, so a tall crown's region can run
 * over a neighbour's apex before that neighbour has grown, and the neighbour
 * vanishes; lidR's dalponte2016 grows all seeds together. Here cells are
 * taken from a priority queue, highest first (a marker-controlled watershed
 * on the smoothed surface), and a cell joins the region that reached it when
 * it is above seedFraction x that region's apex, above crownFraction x the
 * region's running mean, not above the apex, at least `minimumHeightMetres`,
 * and within the maximum crown radius of the apex. Every treetop keeps at
 * least its own cell.
 */
export function growCrownsSimultaneous(grid, surface, maxima, {
  seedFraction = 0.45, crownFraction = 0.55, maximumCrownRadiusMetres = 10, minimumHeightMetres = 2, excludeMask = null,
  /* continue from existing labels (crown extents) instead of from the apexes */
  initialLabels = null,
} = {}) {
  const { width, height, sampleSpacingMetres: s } = grid;
  const labels = initialLabels || new Int32Array(width * height).fill(-1);
  const sum = new Float64Array(maxima.length);
  const count = new Uint32Array(maxima.length);
  const maxR2 = (maximumCrownRadiusMetres / s) ** 2;
  /* binary max-heap of (value, cell, label) in growable typed arrays */
  let capacity = 1024;
  let hv = new Float32Array(capacity), hi = new Int32Array(capacity), hl = new Int32Array(capacity);
  let size = 0;
  const push = (value, cell, label) => {
    if (size === capacity) {
      capacity *= 2;
      const v = new Float32Array(capacity); v.set(hv); hv = v;
      const c = new Int32Array(capacity); c.set(hi); hi = c;
      const l = new Int32Array(capacity); l.set(hl); hl = l;
    }
    let k = size++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (hv[parent] >= value) break;
      hv[k] = hv[parent]; hi[k] = hi[parent]; hl[k] = hl[parent];
      k = parent;
    }
    hv[k] = value; hi[k] = cell; hl[k] = label;
  };
  const pop = out => {
    out[0] = hv[0]; out[1] = hi[0]; out[2] = hl[0];
    size--;
    const value = hv[size], cell = hi[size], label = hl[size];
    let k = 0;
    for (;;) {
      let child = 2 * k + 1;
      if (child >= size) break;
      if (child + 1 < size && hv[child + 1] > hv[child]) child++;
      if (hv[child] <= value) break;
      hv[k] = hv[child]; hi[k] = hi[child]; hl[k] = hl[child];
      k = child;
    }
    hv[k] = value; hi[k] = cell; hl[k] = label;
  };
  const neighbours = (cell, label) => {
    const row = Math.floor(cell / width);
    const column = cell - row * width;
    if (column > 0) { const n = cell - 1; if (labels[n] === -1 && !Number.isNaN(surface[n])) push(surface[n], n, label); }
    if (column < width - 1) { const n = cell + 1; if (labels[n] === -1 && !Number.isNaN(surface[n])) push(surface[n], n, label); }
    if (row > 0) { const n = cell - width; if (labels[n] === -1 && !Number.isNaN(surface[n])) push(surface[n], n, label); }
    if (row < height - 1) { const n = cell + width; if (labels[n] === -1 && !Number.isNaN(surface[n])) push(surface[n], n, label); }
  };
  if (initialLabels) {
    for (let cell = 0; cell < labels.length; cell++) {
      const k = labels[cell];
      if (k < 0) continue;
      sum[k] += surface[cell];
      count[k]++;
    }
    for (let cell = 0; cell < labels.length; cell++) if (labels[cell] >= 0) neighbours(cell, labels[cell]);
  } else {
    maxima.forEach((apex, k) => {
      if (labels[apex.index] !== -1) return;
      labels[apex.index] = k;
      sum[k] = apex.height;
      count[k] = 1;
    });
    maxima.forEach((apex, k) => { if (labels[apex.index] === k) neighbours(apex.index, k); });
  }
  const out = new Float64Array(3);
  while (size > 0) {
    pop(out);
    const value = out[0], cell = out[1], k = out[2];
    if (labels[cell] !== -1) continue;
    if (excludeMask && excludeMask[cell]) continue;
    const apex = maxima[k];
    if (value > apex.height || value < minimumHeightMetres) continue;
    if (value < seedFraction * apex.height) continue;
    if (value < crownFraction * (sum[k] / count[k])) continue;
    const row = Math.floor(cell / width);
    const column = cell - row * width;
    if ((column - apex.column) ** 2 + (row - apex.row) ** 2 > maxR2) continue;
    labels[cell] = k;
    sum[k] += value;
    count[k]++;
    neighbours(cell, k);
  }
  return labels;
}

/**
 * Treetops and crowns over a CHM grid. `grid` is { minEasting, maxNorthing,
 * width, height, sampleSpacingMetres }; `chm` the unsmoothed pit-free heights
 * (NaN = unmeasured). `excludeMask` (1 = excluded) stops detection and growth.
 * `smoothed` may be passed to reuse a surface across parameter sweeps.
 * `growth: 'sequential'` reproduces crown-detect.mjs's tallest-first growth.
 */
export function detectTreesV2(grid, chm, { parameters = TREE_DETECT_V2_DEFAULTS, excludeMask = null, smoothed = null, growth = 'simultaneous' } = {}) {
  const surface = smoothed || smoothChm(grid, chm, parameters.smoothingSigmaMetres);
  const raster = values => createRaster({ width: grid.width, height: grid.height, sampleSpacingMetres: grid.sampleSpacingMetres, originEasting: grid.minEasting, originNorthing: grid.maxNorthing, values });
  const detection = raster(surface);
  const heights = raster(chm);
  const p = crownDetectParameters(parameters);
  const maxima = detectLocalMaxima(detection, { parameters: p, excludeMask });
  const labels = growth === 'sequential'
    ? growCrowns(detection, maxima, { parameters: p, excludeMask })
    : growCrownsSimultaneous(grid, surface, maxima, { seedFraction: p.seedFraction, crownFraction: p.crownFraction, maximumCrownRadiusMetres: p.maximumCrownRadiusMetres, minimumHeightMetres: Math.max(2, p.minimumCandidateHeightMetres - 1), excludeMask });
  const merged = parameters.minimumProminenceMetres > 0 ? mergeShallowCrowns(grid, surface, labels, maxima, parameters.minimumProminenceMetres) : null;
  /* the visible crown reaches past Dalponte's core: extend every crown at
     once over the remaining canopy down to extentFraction of its apex */
  if (parameters.extentFraction > 0) {
    growCrownsSimultaneous(grid, surface, maxima, { seedFraction: parameters.extentFraction, crownFraction: 0, maximumCrownRadiusMetres: p.maximumCrownRadiusMetres, minimumHeightMetres: 2, excludeMask, initialLabels: labels });
  }
  const statistics = crownStatistics(heights, labels, maxima);
  const kept = statistics.filter(crown => crown.areaSquareMetres >= parameters.minimumCrownAreaSquareMetres);
  return { maxima, labels, crowns: kept, smoothed: surface, merged };
}

/**
 * Merge a crown into its neighbour when its apex stands less than
 * `prominenceMetres` (a number, or a function of the lower and the taller
 * maximum) above the highest saddle between them (the h-maxima /
 * "dynamics" rule of watershed segmentation): a bump on a broad crown is a
 * branch, while two trees have a real dip between their tops. Lowest crowns
 * are merged first, into the neighbour across the highest saddle, and saddles
 * are carried over so chains merge correctly. Labels are rewritten in place;
 * a merged maximum keeps no cells, so it drops out of the crown list.
 */
export function mergeShallowCrowns(grid, surface, labels, maxima, prominenceMetres) {
  const { width, height } = grid;
  const n = maxima.length;
  const saddles = Array.from({ length: n }, () => new Map());
  const note = (a, b, value) => {
    if ((saddles[a].get(b) ?? -Infinity) < value) { saddles[a].set(b, value); saddles[b].set(a, value); }
  };
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const i = row * width + column;
      const a = labels[i];
      if (a < 0) continue;
      if (column < width - 1) { const b = labels[i + 1]; if (b >= 0 && b !== a) note(a, b, Math.min(surface[i], surface[i + 1])); }
      if (row < height - 1) { const b = labels[i + width]; if (b >= 0 && b !== a) note(a, b, Math.min(surface[i], surface[i + width])); }
    }
  }
  const parent = Int32Array.from({ length: n }, (_, k) => k);
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const order = maxima.map((m, k) => k).sort((a, b) => maxima[a].height - maxima[b].height || b - a);
  let mergedCount = 0;
  for (const k of order) {
    if (find(k) !== k) continue;
    let best = -Infinity, into = -1;
    for (const [other, saddle] of saddles[k]) {
      const root = find(other);
      if (root === k) continue;
      if (maxima[root].height < maxima[k].height || (maxima[root].height === maxima[k].height && root > k)) continue;
      if (saddle > best) { best = saddle; into = root; }
    }
    if (into < 0) continue;
    const threshold = typeof prominenceMetres === 'function' ? prominenceMetres(maxima[k], maxima[into]) : prominenceMetres;
    if (maxima[k].height - best >= threshold) continue;
    parent[k] = into;
    mergedCount++;
    for (const [other, saddle] of saddles[k]) {
      const root = find(other);
      if (root === into) continue;
      if ((saddles[into].get(root) ?? -Infinity) < saddle) { saddles[into].set(root, saddle); saddles[root].set(into, saddle); }
    }
  }
  if (mergedCount) for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) labels[i] = find(labels[i]);
  return mergedCount;
}

/** Convex hull (monotone chain) of [x, y] points, counter-clockwise, closed. */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  const upper = [];
  for (const point of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.push(hull[0]);
  return hull;
}

/** Crown outlines: the convex hull of each label's cell corners, in EPSG:3006. */
export function crownOutlines(grid, labels, ids) {
  const wanted = new Set(ids);
  const corners = new Map();
  const s = grid.sampleSpacingMetres;
  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < grid.width; column++) {
      const id = labels[row * grid.width + column];
      if (id < 0 || !wanted.has(id)) continue;
      /* boundary cells suffice for the hull */
      const left = column > 0 ? labels[row * grid.width + column - 1] : -2;
      const right = column < grid.width - 1 ? labels[row * grid.width + column + 1] : -2;
      const up = row > 0 ? labels[(row - 1) * grid.width + column] : -2;
      const down = row < grid.height - 1 ? labels[(row + 1) * grid.width + column] : -2;
      if (left === id && right === id && up === id && down === id) continue;
      if (!corners.has(id)) corners.set(id, []);
      const e0 = grid.minEasting + column * s;
      const n0 = grid.maxNorthing - row * s;
      corners.get(id).push([e0, n0], [e0 + s, n0], [e0, n0 - s], [e0 + s, n0 - s]);
    }
  }
  const out = new Map();
  for (const [id, points] of corners) out.set(id, convexHull(points).map(([e, n]) => [Math.round(e * 100) / 100, Math.round(n * 100) / 100]));
  return out;
}

/**
 * Leaf-off structure per crown from the returns. `points` gives per-point
 * column/row on the CHM lattice (or easting/northing), hag, classification,
 * returnNumber. Returns Map id -> metrics.
 */
export function crownReturnMetrics(grid, labels, crowns, points) {
  const byId = new Map(crowns.map(crown => [crown.id, { first: 0, firstCanopy: 0, firstUpper: 0, all: 0, allCanopy: 0, ground: 0, intensitySum: 0, intensityCount: 0, maxHag: 0, height: crown.heightMetres }]));
  for (let i = 0; i < points.count; i++) {
    const column = points.column[i];
    const row = points.row[i];
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) continue;
    const id = labels[row * grid.width + column];
    if (id < 0) continue;
    const m = byId.get(id);
    if (!m) continue;
    const hag = points.hag[i];
    if (Number.isNaN(hag)) continue;
    m.all++;
    if (points.ground[i]) m.ground++;
    if (hag >= 2) m.allCanopy++;
    if (hag > m.maxHag) m.maxHag = hag;
    if (points.returnNumber[i] === 1) {
      m.first++;
      if (hag >= 2) { m.firstCanopy++; m.intensitySum += points.intensity[i]; m.intensityCount++; }
      if (hag >= 0.5 * m.height) m.firstUpper++;
    }
  }
  const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  const out = new Map();
  for (const [id, m] of byId) {
    out.set(id, Object.freeze({
      returns: m.all,
      firstReturns: m.first,
      /* share of first returns stopped at least 2 m up: canopy interception */
      firstCanopyShare: m.first ? round(m.firstCanopy / m.first) : null,
      /* share of first returns in the upper half of the crown height */
      firstUpperShare: m.first ? round(m.firstUpper / m.first) : null,
      /* share of all returns classified ground: penetration */
      groundShare: m.all ? round(m.ground / m.all) : null,
      canopyIntensityMean: m.intensityCount ? round(m.intensitySum / m.intensityCount, 1) : null,
    }));
  }
  return out;
}

/** One-to-one matching, closest pairs first, within `radius` metres. */
export function matchOneToOne(reference, predicted, radius = 4) {
  const pairs = [];
  const cell = radius;
  const buckets = new Map();
  predicted.forEach((p, index) => {
    const key = `${Math.floor(p.easting / cell)},${Math.floor(p.northing / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  });
  reference.forEach((r, ri) => {
    const bx = Math.floor(r.easting / cell);
    const by = Math.floor(r.northing / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const pi of buckets.get(`${bx + dx},${by + dy}`) || []) {
        const d = Math.hypot(predicted[pi].easting - r.easting, predicted[pi].northing - r.northing);
        if (d <= radius) pairs.push({ ri, pi, d });
      }
    }
  });
  pairs.sort((a, b) => a.d - b.d || a.ri - b.ri || a.pi - b.pi);
  const takenR = new Set();
  const takenP = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (takenR.has(pair.ri) || takenP.has(pair.pi)) continue;
    takenR.add(pair.ri);
    takenP.add(pair.pi);
    matches.push(pair);
  }
  return { matches, unmatchedReference: reference.map((_, i) => i).filter(i => !takenR.has(i)), unmatchedPredicted: predicted.map((_, i) => i).filter(i => !takenP.has(i)) };
}

/** Area of intersection over union of two circles. */
export function circleIoU(a, b) {
  const d = Math.hypot(a.easting - b.easting, a.northing - b.northing);
  const r1 = a.radius;
  const r2 = b.radius;
  const area1 = Math.PI * r1 * r1;
  const area2 = Math.PI * r2 * r2;
  let inter;
  if (d >= r1 + r2) inter = 0;
  else if (d <= Math.abs(r1 - r2)) inter = Math.PI * Math.min(r1, r2) ** 2;
  else {
    const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
    const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
    const a3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    inter = a1 + a2 - a3;
  }
  return inter / (area1 + area2 - inter);
}

/** Precision, recall and F1 from counts, with a Wilson 95% interval on each rate. */
export function detectionScores(tp, extra, missed) {
  const wilson = (k, n) => {
    if (!n) return null;
    const z = 1.96;
    const p = k / n;
    const denominator = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denominator;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
    return [Math.round((centre - half) * 1000) / 1000, Math.round((centre + half) * 1000) / 1000];
  };
  const precision = tp + extra ? tp / (tp + extra) : null;
  const recall = tp + missed ? tp / (tp + missed) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  const r = v => (v === null ? null : Math.round(v * 1000) / 1000);
  return { tp, extra, missed, precision: r(precision), recall: r(recall), f1: r(f1), precisionInterval95: wilson(tp, tp + extra), recallInterval95: wilson(tp, tp + missed) };
}

/* ---------------------------------------------------------------------------
   Round 2: type-aware detection. Evergreen conifers and bare broadleaves need
   different treetop windows on a leaf-off scan: a spruce has one sharp top and
   touches its neighbours, a wide broadleaf crown has several bumps. A per-cell
   conifer/broadleaf map is built BEFORE detection from the April orthophoto
   taken the day after the laser (evergreen needles are vegetated in April,
   bare twigs are not), and each type gets its own smoothing, window, merge
   threshold and position (apex or crown centroid).                          */

export const TYPE_NONE = 0;
export const TYPE_CONIFER = 1;
export const TYPE_BROADLEAF = 2;

/**
 * Conifer share per CHM cell: the share of vegetated photo pixels ((NIR - red)
 * / (NIR + red) > ndviThreshold) in a square of half-size base + slope x h
 * around the cell (the relief displacement of a crown grows with its height).
 * Cells below minimumHeightMetres get TYPE_NONE. The photo is a north-up RGBI
 * mosaic { minEasting, maxNorthing, pixelMetres, width, height, data }.
 */
export function typeMapFromPhoto(grid, chm, mosaic, {
  ndviThreshold = 0.12, coniferShare = 0.5, radiusBaseMetres = 1.5, radiusSlope = 0.15, minimumHeightMetres = 2,
} = {}) {
  const { width: mw, height: mh, data } = mosaic;
  /* integral image of the vegetated indicator */
  const iw = mw + 1;
  const integral = new Float64Array(iw * (mh + 1));
  for (let r = 0; r < mh; r++) {
    let row = 0;
    for (let c = 0; c < mw; c++) {
      const o = (r * mw + c) * 4;
      const red = data[o], nir = data[o + 3];
      row += nir + red > 0 && (nir - red) / (nir + red) > ndviThreshold ? 1 : 0;
      integral[(r + 1) * iw + c + 1] = integral[r * iw + c + 1] + row;
    }
  }
  const p = mosaic.pixelMetres;
  const boxShare = (e, n, half) => {
    const c0 = Math.max(0, Math.floor((e - half - mosaic.minEasting) / p)), c1 = Math.min(mw, Math.ceil((e + half - mosaic.minEasting) / p));
    const r0 = Math.max(0, Math.floor((mosaic.maxNorthing - n - half) / p)), r1 = Math.min(mh, Math.ceil((mosaic.maxNorthing - n + half) / p));
    const area = (c1 - c0) * (r1 - r0);
    if (area <= 0) return Number.NaN;
    return (integral[r1 * iw + c1] - integral[r0 * iw + c1] - integral[r1 * iw + c0] + integral[r0 * iw + c0]) / area;
  };
  const size = grid.width * grid.height;
  const share = new Float32Array(size).fill(Number.NaN);
  const type = new Uint8Array(size);
  const spacing = grid.sampleSpacingMetres;
  for (let row = 0; row < grid.height; row++) {
    const n = grid.maxNorthing - (row + 0.5) * spacing;
    for (let column = 0; column < grid.width; column++) {
      const i = row * grid.width + column;
      const h = chm[i];
      if (!(h >= minimumHeightMetres)) continue;
      const value = boxShare(grid.minEasting + (column + 0.5) * spacing, n, radiusBaseMetres + radiusSlope * h);
      share[i] = value;
      if (Number.isFinite(value)) type[i] = value >= coniferShare ? TYPE_CONIFER : TYPE_BROADLEAF;
    }
  }
  return { type, share };
}

/** Local maxima where each cell is tested on its own type's surface and window.
    The minimum height is tested on the unsmoothed CHM (`raw`) when given, so
    smoothing never drops a narrow young crown below it. */
export function detectTreetopsTyped(grid, surfaces, type, byType, { excludeMask = null, raw = null } = {}) {
  const { width, height, sampleSpacingMetres: spacing } = grid;
  const maxima = [];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const t = type[index];
      if (t === TYPE_NONE) continue;
      if (excludeMask && excludeMask[index]) continue;
      const p = byType[t];
      const surface = surfaces[t];
      const value = surface[index];
      if (!((raw ? Math.max(value, raw[index]) : value) >= p.minimumCandidateHeightMetres)) continue;
      const radiusMetres = Math.min(p.windowMaximumMetres, Math.max(p.windowMinimumMetres, p.windowBaseMetres + p.windowSlope * value));
      const radiusCells = radiusMetres / spacing;
      const reach = Math.ceil(radiusCells);
      let isMaximum = true;
      for (let dy = -reach; dy <= reach && isMaximum; dy++) {
        const r = row + dy;
        if (r < 0 || r >= height) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          if (!dx && !dy) continue;
          if (dx * dx + dy * dy > radiusCells * radiusCells) continue;
          const c = column + dx;
          if (c < 0 || c >= width) continue;
          const other = surface[r * width + c];
          if (Number.isNaN(other)) continue;
          if (other > value || (other === value && (r < row || (r === row && c < column)))) { isMaximum = false; break; }
        }
      }
      if (isMaximum) maxima.push({ column, row, index, height: value, windowRadiusMetres: radiusMetres, type: t });
    }
  }
  maxima.sort((a, b) => b.height - a.height || a.index - b.index);
  /* where a conifer and a broadleaf maximum meet at a type boundary inside
     either one's window, the taller one stands */
  const kept = [];
  for (const m of maxima) {
    const clash = kept.some(k => k.type !== m.type && Math.hypot(k.column - m.column, k.row - m.row) * spacing <= Math.max(k.windowRadiusMetres, m.windowRadiusMetres));
    if (!clash) kept.push(Object.freeze(m));
  }
  return kept;
}

export const TYPED_DEFAULTS = Object.freeze({
  type: Object.freeze({ ndviThreshold: 0.12, coniferShare: 0.5, radiusBaseMetres: 1.5, radiusSlope: 0.15 }),
  conifer: Object.freeze({ smoothingSigmaMetres: 0.3, windowBaseMetres: 1.0, windowSlope: 0.05, windowMinimumMetres: 1, windowMaximumMetres: 3, minimumCandidateHeightMetres: 3, prominenceMetres: 0, prominenceFraction: 0, position: 'apex' }),
  broadleaf: Object.freeze({ smoothingSigmaMetres: 0.6, windowBaseMetres: 1.5, windowSlope: 0.08, windowMinimumMetres: 1.5, windowMaximumMetres: 4, minimumCandidateHeightMetres: 3, prominenceMetres: 1, prominenceFraction: 0.1, position: 'centroid' }),
  shared: Object.freeze({ seedFraction: 0.45, crownFraction: 0.55, maximumCrownRadiusMetres: 10, extentFraction: 0.2, minimumCrownAreaSquareMetres: 0.25 }),
  /* oversized conifer crowns re-searched for touching tops (0 = off) */
  split: Object.freeze({ areaFactor: 0, allometryBaseMetres: 1, allometrySlope: 0.1, fineSigmaMetres: 0.25, windowMetres: 1.25, minimumSeparationMetres: 2, seedFraction: 0.6 }),
});

/**
 * The type-aware detector. `typeMap` is typeMapFromPhoto(...).type (or any
 * per-cell TYPE_ array). `surfaces` may be passed to reuse smoothing across a
 * sweep: { [TYPE_CONIFER]: Float32Array, [TYPE_BROADLEAF]: Float32Array }.
 * Crowns carry `type` and `position` (the type's apex or centroid).
 */
export function detectTreesTyped(grid, chm, typeMap, parameters = TYPED_DEFAULTS, { surfaces = null, excludeMask = null, extraMaxima = null } = {}) {
  const byType = { [TYPE_CONIFER]: parameters.conifer, [TYPE_BROADLEAF]: parameters.broadleaf };
  const smooth = surfaces || {
    [TYPE_CONIFER]: smoothChm(grid, chm, parameters.conifer.smoothingSigmaMetres),
    [TYPE_BROADLEAF]: smoothChm(grid, chm, parameters.broadleaf.smoothingSigmaMetres),
  };
  const maxima = detectTreetopsTyped(grid, smooth, typeMap, byType, { excludeMask, raw: chm });
  /* tops recovered by a referee (tree-refine.mjs) join before growth, so every
     crown is grown from the full set of seeds at once */
  if (extraMaxima) {
    const taken = new Set(maxima.map(m => m.index));
    for (const extra of extraMaxima) {
      if (taken.has(extra.index)) continue;
      const t = typeMap[extra.index] === TYPE_BROADLEAF ? TYPE_BROADLEAF : TYPE_CONIFER;
      const height = smooth[t][extra.index];
      if (!(height > 0)) continue;
      taken.add(extra.index);
      maxima.push(Object.freeze({ column: extra.column, row: extra.row, index: extra.index, height, windowRadiusMetres: 0, type: t, recovered: true }));
    }
  }
  /* one growth surface: each cell from its own type's smoothing */
  const surface = new Float32Array(chm.length);
  for (let i = 0; i < chm.length; i++) surface[i] = typeMap[i] === TYPE_BROADLEAF ? smooth[TYPE_BROADLEAF][i] : smooth[TYPE_CONIFER][i];
  const shared = parameters.shared;
  const labels = growCrownsSimultaneous(grid, surface, maxima, { seedFraction: shared.seedFraction, crownFraction: shared.crownFraction, maximumCrownRadiusMetres: shared.maximumCrownRadiusMetres, minimumHeightMetres: 2, excludeMask });
  const threshold = lower => { const p = byType[lower.type]; return Math.max(p.prominenceMetres, p.prominenceFraction * lower.height); };
  const anyMerge = [parameters.conifer, parameters.broadleaf].some(p => p.prominenceMetres > 0 || p.prominenceFraction > 0);
  const merged = anyMerge ? mergeShallowCrowns(grid, surface, labels, maxima, threshold) : 0;
  const split = parameters.split && parameters.split.areaFactor > 0
    ? splitOversizedCrowns(grid, smoothChm(grid, chm, parameters.split.fineSigmaMetres), labels, maxima, { type: TYPE_CONIFER, ...parameters.split })
    : 0;
  if (shared.extentFraction > 0) growCrownsSimultaneous(grid, surface, maxima, { seedFraction: shared.extentFraction, crownFraction: 0, maximumCrownRadiusMetres: shared.maximumCrownRadiusMetres, minimumHeightMetres: 2, excludeMask, initialLabels: labels });
  const heights = createRaster({ width: grid.width, height: grid.height, sampleSpacingMetres: grid.sampleSpacingMetres, originEasting: grid.minEasting, originNorthing: grid.maxNorthing, values: chm });
  const statistics = crownStatistics(heights, labels, maxima);
  const crowns = statistics.filter(c => c.areaSquareMetres >= shared.minimumCrownAreaSquareMetres).map(c => {
    const t = maxima[c.id].type;
    const at = byType[t].position === 'centroid' ? c.centroid : { easting: c.apex.easting, northing: c.apex.northing };
    return Object.freeze({ ...c, type: t === TYPE_CONIFER ? 'conifer' : 'broadleaf', position: Object.freeze({ easting: at.easting, northing: at.northing }), ...(maxima[c.id].recovered ? { recovered: true } : {}) });
  });
  return { maxima, labels, crowns, surface, merged, split };
}

/**
 * Split oversized conifer crowns. Touching spruces in a closed stand often
 * share one smoothed maximum; their joint segment is then far larger than a
 * spruce of that height carries (radius about base + slope x height). Inside
 * such a segment only, maxima are sought again on the less-smoothed `fine`
 * surface with a small window; seeds at least `minimumSeparationMetres` apart
 * and above seedFraction of the crown's apex become crowns of their own, and
 * the segment's cells go to the nearest seed. Labels and maxima are updated
 * in place; returns the number of crowns added.
 */
export function splitOversizedCrowns(grid, fine, labels, maxima, {
  type = TYPE_CONIFER, areaFactor = 2, allometryBaseMetres = 1, allometrySlope = 0.1,
  windowMetres = 1.25, minimumSeparationMetres = 2, seedFraction = 0.6,
} = {}) {
  if (!(areaFactor > 0)) return 0;
  const { width, height, sampleSpacingMetres: s } = grid;
  const cellArea = s * s;
  const cellsOf = new Map();
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i];
    if (k < 0 || maxima[k].type !== type) continue;
    let list = cellsOf.get(k);
    if (!list) { list = []; cellsOf.set(k, list); }
    list.push(i);
  }
  const reach = Math.ceil(windowMetres / s);
  const r2 = (windowMetres / s) ** 2;
  let added = 0;
  for (const [k, cells] of cellsOf) {
    const apex = maxima[k];
    const expected = allometryBaseMetres + allometrySlope * apex.height;
    if (cells.length * cellArea <= areaFactor * Math.PI * expected * expected) continue;
    const inCrown = new Set(cells);
    const candidates = [];
    for (const i of cells) {
      const v = fine[i];
      if (!(v >= seedFraction * apex.height)) continue;
      const row = Math.floor(i / width), column = i - row * width;
      let isMax = true;
      for (let dy = -reach; dy <= reach && isMax; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if ((!dx && !dy) || dx * dx + dy * dy > r2) continue;
        const r = row + dy, c = column + dx;
        if (r < 0 || c < 0 || r >= height || c >= width) continue;
        const j = r * width + c;
        if (!inCrown.has(j)) continue;
        if (fine[j] > v || (fine[j] === v && j < i)) { isMax = false; break; }
      }
      if (isMax) candidates.push({ index: i, row, column, height: v });
    }
    candidates.sort((a, b) => b.height - a.height);
    const seeds = [{ k, row: apex.row, column: apex.column }];
    for (const c of candidates) {
      if (seeds.some(seed => Math.hypot(seed.row - c.row, seed.column - c.column) * s < minimumSeparationMetres)) continue;
      const id = maxima.length;
      maxima.push(Object.freeze({ column: c.column, row: c.row, index: c.index, height: c.height, windowRadiusMetres: windowMetres, type, splitFrom: k }));
      seeds.push({ k: id, row: c.row, column: c.column });
      added++;
    }
    if (seeds.length < 2) continue;
    for (const i of cells) {
      const row = Math.floor(i / width), column = i - row * width;
      let best = Infinity, owner = k;
      for (const seed of seeds) {
        const d = (seed.row - row) ** 2 + (seed.column - column) ** 2;
        if (d < best) { best = d; owner = seed.k; }
      }
      labels[i] = owner;
    }
  }
  return added;
}
