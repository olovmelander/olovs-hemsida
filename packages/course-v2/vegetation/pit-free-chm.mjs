/* A pit-free canopy height model from a sparse (1-3 returns/m²) leaf-off
   cloud, on a 0.5 m lattice.

   At 0.5 m most cells hold no return at all, and a first return that slips
   between branches leaves a cell far below its neighbours: the "pits" that
   split one crown into several maxima or sink a treetop. The method follows
   the layered idea of Khosravipour et al. (2014, "Generating pit-free canopy
   height models from airborne lidar", PE&RS 80(9)): build a surface from all
   returns, then again from only the returns above each of a series of height
   thresholds, and keep the highest value any layer gives a cell, so a low
   return inside a tall crown is overruled by the layer that excludes it. Their
   layers are TINs with a maximum edge length; here each layer is interpolated
   on the grid instead, without a triangulation: an empty cell is filled only
   when a layer's returns stand within `radiusMetres` of it in at least three
   of the four quadrants around it (the grid analogue of lying inside a
   triangle whose edges are short), by inverse-distance weighting of the
   nearest return in each quadrant. A crown's outside edge has returns on one
   side only, so the surface never bleeds past it.

   A final robust pass fills any remaining pit: a cell more than
   max(absolute, relative x median) below the median of its eight neighbours,
   where that median is canopy, takes the median. Everything is a pure
   function of the returns and the stated parameters.                     */

export const PIT_FREE_DEFAULTS = Object.freeze({
  thresholdsMetres: Object.freeze([0, 2, 5, 10, 15, 20, 25, 30]),
  /* layer interpolation reach: about twice the first-return spacing of a
     1.8 pulse/m² survey; the ground layer may reach a little further */
  radiusMetres: 1.5,
  groundRadiusMetres: 2,
  minimumQuadrants: 3,
  pit: Object.freeze({ minimumHeightMetres: 2, absoluteMetres: 1.5, relativeFraction: 0.25, passes: 2 }),
});

function cellOf(grid, x, y) {
  const column = Math.floor((x - grid.minEasting) / grid.sampleSpacingMetres);
  const row = Math.floor((grid.maxNorthing - y) / grid.sampleSpacingMetres);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return -1;
  return row * grid.width + column;
}

/**
 * Highest height-above-ground per cell with the position of the return that
 * set it, and the per-cell return counts. `hag[i]` is the height above ground
 * of point i (NaN to skip it, e.g. noise); ground-class returns should carry 0.
 */
export function rasterizeReturns(grid, points, hag, { groundClasses = new Set([2, 9]) } = {}) {
  const size = grid.width * grid.height;
  const max = new Float32Array(size).fill(Number.NaN);
  const maxX = new Float64Array(size);
  const maxY = new Float64Array(size);
  const all = new Uint16Array(size);
  const first = new Uint16Array(size);
  const ground = new Uint16Array(size);
  for (let i = 0; i < points.count; i++) {
    const h = hag[i];
    if (Number.isNaN(h)) continue;
    const index = cellOf(grid, points.x[i], points.y[i]);
    if (index < 0) continue;
    if (all[index] < 65535) all[index]++;
    if (points.returnNumber[i] === 1 && first[index] < 65535) first[index]++;
    if (groundClasses.has(points.classification[i]) && ground[index] < 65535) ground[index]++;
    if (Number.isNaN(max[index]) || h > max[index]) { max[index] = h; maxX[index] = points.x[i]; maxY[index] = points.y[i]; }
  }
  return { max, maxX, maxY, all, first, ground };
}

/** One layer: cells whose highest return is at least `threshold`, filled by quadrant IDW. */
export function interpolateLayer(grid, raster, threshold, { radiusMetres, minimumQuadrants = 3 } = {}) {
  const { width, height, sampleSpacingMetres: s } = grid;
  const { max, maxX, maxY } = raster;
  const size = width * height;
  const out = new Float32Array(size).fill(Number.NaN);
  const reach = Math.ceil(radiusMetres / s);
  const r2 = radiusMetres * radiusMetres;
  const seed = new Uint8Array(size);
  let seeds = 0;
  for (let i = 0; i < size; i++) if (max[i] >= threshold) { seed[i] = 1; out[i] = max[i]; seeds++; }
  if (!seeds) return { values: out, seeds, filled: 0 };
  /* cells within reach of a seed, by a separable dilation of the seed mask */
  const rowNear = new Uint8Array(size);
  for (let row = 0; row < height; row++) {
    let last = -Infinity;
    const base = row * width;
    for (let column = 0; column < width; column++) { if (seed[base + column]) last = column; if (column - last <= reach) rowNear[base + column] = 1; }
    last = Infinity;
    for (let column = width - 1; column >= 0; column--) { if (seed[base + column]) last = column; if (last - column <= reach) rowNear[base + column] = 1; }
  }
  const near = new Uint8Array(size);
  for (let column = 0; column < width; column++) {
    let last = -Infinity;
    for (let row = 0; row < height; row++) { if (rowNear[row * width + column]) last = row; if (row - last <= reach) near[row * width + column] = 1; }
    last = Infinity;
    for (let row = height - 1; row >= 0; row--) { if (rowNear[row * width + column]) last = row; if (last - row <= reach) near[row * width + column] = 1; }
  }
  const best = new Float64Array(4);
  const value = new Float64Array(4);
  let filled = 0;
  for (let row = 0; row < height; row++) {
    const cy = grid.maxNorthing - (row + 0.5) * s;
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      if (seed[index] || !near[index]) continue;
      const cx = grid.minEasting + (column + 0.5) * s;
      best.fill(Infinity);
      for (let dy = -reach; dy <= reach; dy++) {
        const r = row + dy;
        if (r < 0 || r >= height) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const c = column + dx;
          if (c < 0 || c >= width) continue;
          const other = r * width + c;
          if (!seed[other]) continue;
          const ex = maxX[other] - cx;
          const ey = maxY[other] - cy;
          const d2 = ex * ex + ey * ey;
          if (d2 > r2) continue;
          const quadrant = (ex >= 0 ? 0 : 1) + (ey >= 0 ? 0 : 2);
          if (d2 < best[quadrant]) { best[quadrant] = d2; value[quadrant] = max[other]; }
        }
      }
      let quadrants = 0;
      let sum = 0;
      let weights = 0;
      for (let q = 0; q < 4; q++) {
        if (best[q] === Infinity) continue;
        quadrants++;
        const w = 1 / Math.max(best[q], 1e-4);
        sum += w * value[q];
        weights += w;
      }
      if (quadrants < minimumQuadrants) continue;
      out[index] = sum / weights;
      filled++;
    }
  }
  return { values: out, seeds, filled };
}

function median(values, n) {
  const sorted = Array.from(values.subarray(0, n)).sort((a, b) => a - b);
  return n % 2 ? sorted[(n - 1) >> 1] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
}

/** Replace cells much lower than the median of their eight neighbours. */
export function fillPits(grid, chm, { minimumHeightMetres = 2, absoluteMetres = 1.5, relativeFraction = 0.25, passes = 2 } = {}) {
  const { width, height } = grid;
  let current = chm;
  let changed = 0;
  const neighbours = new Float64Array(8);
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(current);
    let changedThisPass = 0;
    for (let row = 1; row < height - 1; row++) {
      for (let column = 1; column < width - 1; column++) {
        const index = row * width + column;
        const value = current[index];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const other = current[index + dy * width + dx];
          if (!Number.isNaN(other)) neighbours[n++] = other;
        }
        if (n < 6) continue;
        const m = median(neighbours, n);
        if (m < minimumHeightMetres) continue;
        if (Number.isNaN(value) || value < m - Math.max(absoluteMetres, relativeFraction * m)) { next[index] = m; changedThisPass++; }
      }
    }
    current = next;
    changed += changedThisPass;
    if (!changedThisPass) break;
  }
  return { values: current, changed };
}

/**
 * The whole method: per-layer interpolation, the per-cell maximum over the
 * layers, then the pit pass. Returns the CHM with NaN where no layer reaches
 * (unmeasured), plus counts for the evidence.
 */
export function pitFreeChm(grid, raster, parameters = PIT_FREE_DEFAULTS) {
  const size = grid.width * grid.height;
  const chm = new Float32Array(size).fill(Number.NaN);
  const layers = [];
  for (const threshold of parameters.thresholdsMetres) {
    const radiusMetres = threshold === 0 ? parameters.groundRadiusMetres : parameters.radiusMetres;
    const layer = interpolateLayer(grid, raster, threshold, { radiusMetres, minimumQuadrants: parameters.minimumQuadrants });
    let raised = 0;
    for (let i = 0; i < size; i++) {
      const value = layer.values[i];
      if (Number.isNaN(value)) continue;
      if (Number.isNaN(chm[i])) chm[i] = value;
      else if (value > chm[i]) { chm[i] = value; raised++; }
    }
    layers.push({ thresholdMetres: threshold, radiusMetres, seedCells: layer.seeds, filledCells: layer.filled, cellsRaised: raised });
    if (!layer.seeds) break;
  }
  const pits = fillPits(grid, chm, parameters.pit);
  return { values: pits.values, layers, pitCellsFilled: pits.changed };
}

/** NaN-aware Gaussian smoothing for treetop detection (heights stay unsmoothed). */
export function smoothChm(grid, values, sigmaMetres) {
  const { width, height, sampleSpacingMetres: s } = grid;
  if (!(sigmaMetres > 0)) return new Float32Array(values);
  const sigma = sigmaMetres / s;
  const reach = Math.max(1, Math.ceil(2.5 * sigma));
  const kernel = new Float64Array(2 * reach + 1);
  for (let k = -reach; k <= reach; k++) kernel[k + reach] = Math.exp(-(k * k) / (2 * sigma * sigma));
  const pass = (input, horizontal) => {
    const out = new Float32Array(input.length).fill(Number.NaN);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        if (Number.isNaN(values[index])) continue;
        let sum = 0;
        let weights = 0;
        for (let k = -reach; k <= reach; k++) {
          const c = horizontal ? column + k : column;
          const r = horizontal ? row : row + k;
          if (c < 0 || r < 0 || c >= width || r >= height) continue;
          const value = input[r * width + c];
          if (Number.isNaN(value)) continue;
          sum += kernel[k + reach] * value;
          weights += kernel[k + reach];
        }
        if (weights > 0) out[index] = sum / weights;
      }
    }
    return out;
  };
  return pass(pass(values, true), false);
}
