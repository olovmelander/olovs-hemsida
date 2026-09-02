/* Canopy-height fields: the raster half of the vegetation compiler.

   A raster here is { width, height, sampleSpacingMetres, originEasting,
   originNorthing, values } with rows north-to-south and columns west-to-east
   -- the same orientation as every v2 grid -- and NaN as the ONLY nodata.
   The PDAL side rasterises the highest normalised return per cell; these
   functions turn that into the fields Stage 3 of the plan names: a void mask
   (nodata is never a clearing), a conservatively gap-filled height copy, a
   median-smoothed DETECTION copy (heights are read from the unsmoothed one),
   a canopy-presence mask, the signed distance to the stand edge, local
   roughness, and campaign ownership split on a hard seam line. Everything is
   deterministic and pure; every function returns a new raster.              */

export function assertRaster(raster, label = 'raster') {
  if (!raster || typeof raster !== 'object') throw new TypeError(`${label} must be an object`);
  const { width, height, values, sampleSpacingMetres, originEasting, originNorthing } = raster;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError(`${label} needs positive integer width and height`);
  }
  if (!(values instanceof Float32Array) || values.length !== width * height) {
    throw new TypeError(`${label}.values must be a Float32Array of width * height samples`);
  }
  if (!Number.isFinite(sampleSpacingMetres) || sampleSpacingMetres <= 0) {
    throw new RangeError(`${label}.sampleSpacingMetres must be positive`);
  }
  if (!Number.isFinite(originEasting) || !Number.isFinite(originNorthing)) {
    throw new RangeError(`${label} needs a finite origin (north-west corner)`);
  }
  return raster;
}

export function createRaster({ width, height, sampleSpacingMetres, originEasting, originNorthing, values = null, fill = Number.NaN }) {
  const data = values || new Float32Array(width * height).fill(fill);
  return assertRaster(Object.freeze({ width, height, sampleSpacingMetres, originEasting, originNorthing, values: data }));
}

export function withValues(raster, values) {
  return createRaster({ ...raster, values });
}

/** Cell centre in EPSG:3006. */
export function cellCentre(raster, column, row) {
  return {
    easting: raster.originEasting + (column + 0.5) * raster.sampleSpacingMetres,
    northing: raster.originNorthing - (row + 0.5) * raster.sampleSpacingMetres,
  };
}

export function cellOf(raster, easting, northing) {
  return {
    column: Math.floor((easting - raster.originEasting) / raster.sampleSpacingMetres),
    row: Math.floor((raster.originNorthing - northing) / raster.sampleSpacingMetres),
  };
}

const NEIGHBOURS_8 = Object.freeze([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]);

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 1 where the raster has no return. */
export function voidMask(raster) {
  assertRaster(raster);
  const mask = new Uint8Array(raster.values.length);
  for (let i = 0; i < mask.length; i++) mask[i] = Number.isNaN(raster.values[i]) ? 1 : 0;
  return mask;
}

/**
 * Fill isolated single-cell voids from their neighbours, one pass. A void is
 * isolated only when EVERY in-bounds neighbour is measured (and at least
 * `minimumNeighbours` exist, so a corner cell still needs evidence). Any
 * wider void stays void: at 1-2 pulses per square metre a two-cell hole is a
 * real gap in the evidence, and filling it would invent canopy that was
 * never captured.
 */
export function fillSingleCellVoids(raster, { minimumNeighbours = 5 } = {}) {
  assertRaster(raster);
  const { width, height, values } = raster;
  const out = new Float32Array(values);
  let filled = 0;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      if (!Number.isNaN(values[index])) continue;
      const neighbours = [];
      let isolated = true;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const c = column + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const value = values[r * width + c];
        if (Number.isNaN(value)) { isolated = false; break; }
        neighbours.push(value);
      }
      if (isolated && neighbours.length >= minimumNeighbours) {
        out[index] = median(neighbours);
        filled++;
      }
    }
  }
  return { raster: withValues(raster, out), filled };
}

/** NaN-aware 3 x 3 median: a void centre stays void, voids around it are ignored. */
export function medianFilter3x3(raster) {
  assertRaster(raster);
  const { width, height, values } = raster;
  const out = new Float32Array(values.length);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const centre = values[index];
      if (Number.isNaN(centre)) { out[index] = Number.NaN; continue; }
      const window = [centre];
      for (const [dx, dy] of NEIGHBOURS_8) {
        const c = column + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const value = values[r * width + c];
        if (!Number.isNaN(value)) window.push(value);
      }
      out[index] = median(window);
    }
  }
  return withValues(raster, out);
}

/** 1 where the height is at or above the threshold; void is 0, never 1. */
export function presenceMask(raster, minimumHeightMetres) {
  assertRaster(raster);
  if (!Number.isFinite(minimumHeightMetres)) throw new RangeError('minimumHeightMetres must be finite');
  const mask = new Uint8Array(raster.values.length);
  for (let i = 0; i < mask.length; i++) {
    const value = raster.values[i];
    mask[i] = !Number.isNaN(value) && value >= minimumHeightMetres ? 1 : 0;
  }
  return mask;
}

/* Felzenszwalb & Huttenlocher one-dimensional squared distance transform. */
function transform1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Exact Euclidean distance (in cells) from every cell to the nearest cell where `target(i)` is true. */
export function distanceToCells(width, height, target) {
  const INF = 1e20;
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = target(i) ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let column = 0; column < width; column++) {
    for (let row = 0; row < height; row++) f[row] = grid[row * width + column];
    transform1d(f, height, d, v, z);
    for (let row = 0; row < height; row++) grid[row * width + column] = d[row];
  }
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) f[column] = grid[row * width + column];
    transform1d(f, width, d, v, z);
    for (let column = 0; column < width; column++) grid[row * width + column] = d[column];
  }
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = grid[i] >= INF ? Infinity : Math.sqrt(grid[i]);
  return out;
}

/**
 * Signed distance to the stand edge in metres: positive inside the mask
 * (distance to the nearest open cell), negative outside (distance to the
 * nearest canopy cell). Void cells are neither: they count as no evidence on
 * both sides and are returned as NaN.
 */
export function standEdgeDistance(mask, voids, { width, height, sampleSpacingMetres }) {
  if (mask.length !== width * height || voids.length !== width * height) throw new RangeError('mask and voids must match the raster');
  const toOpen = distanceToCells(width, height, i => mask[i] === 0 && voids[i] === 0);
  const toCanopy = distanceToCells(width, height, i => mask[i] === 1);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    if (voids[i]) { out[i] = Number.NaN; continue; }
    out[i] = (mask[i] ? toOpen[i] : -toCanopy[i]) * sampleSpacingMetres;
  }
  return out;
}

/** Standard deviation of the 3 x 3 neighbourhood, NaN-aware; a void centre is NaN. */
export function roughness3x3(raster) {
  assertRaster(raster);
  const { width, height, values } = raster;
  const out = new Float32Array(values.length);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const centre = values[index];
      if (Number.isNaN(centre)) { out[index] = Number.NaN; continue; }
      let sum = centre;
      let sumSquares = centre * centre;
      let count = 1;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const c = column + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const value = values[r * width + c];
        if (Number.isNaN(value)) continue;
        sum += value;
        sumSquares += value * value;
        count++;
      }
      const mean = sum / count;
      out[index] = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
    }
  }
  return out;
}

/**
 * Campaign ownership on a hard seam: 1 for cells whose CENTRE lies north of
 * (or east of) the seam value, 0 otherwise. A cell straddling the seam is
 * owned by the side its centre is on, which is stated in the compiler
 * evidence; nothing is blended across the line.
 */
export function seamOwnership(raster, seam) {
  assertRaster(raster);
  if (!seam || !['northing', 'easting'].includes(seam.axis) || !Number.isFinite(seam.value)) {
    throw new TypeError('seam must be { axis: northing | easting, value }');
  }
  const { width, height } = raster;
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const centre = cellCentre(raster, column, row);
      const coordinate = seam.axis === 'northing' ? centre.northing : centre.easting;
      out[row * width + column] = coordinate > seam.value ? 1 : 0;
    }
  }
  return out;
}

/** Summary statistics a review can read without the raster. */
export function rasterSummary(raster, { canopyThresholdMetres = 2 } = {}) {
  assertRaster(raster);
  let voids = 0;
  let canopy = 0;
  let measured = 0;
  let sum = 0;
  let max = -Infinity;
  for (const value of raster.values) {
    if (Number.isNaN(value)) { voids++; continue; }
    measured++;
    sum += value;
    if (value > max) max = value;
    if (value >= canopyThresholdMetres) canopy++;
  }
  const cells = raster.values.length;
  return Object.freeze({
    cells,
    measuredCells: measured,
    voidCells: voids,
    voidFraction: Math.round((voids / cells) * 1e6) / 1e6,
    canopyCells: canopy,
    canopyFractionOfMeasured: measured ? Math.round((canopy / measured) * 1e6) / 1e6 : null,
    meanHeightMetres: measured ? Math.round((sum / measured) * 1000) / 1000 : null,
    maxHeightMetres: measured ? Math.round(max * 1000) / 1000 : null,
  });
}
