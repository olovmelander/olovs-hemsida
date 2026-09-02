/* Pure canopy-building over decoded points: the Stage 2-3 arithmetic the
   plan assigns to PDAL, done in Node because this machine has none and
   because the result must be provable against the hierarchy anyway.

   A window's points come in as typed arrays. Ground returns (classes 2 and
   9) make a 1 m ground grid, mean per cell, gap-filled by nearest measured
   cell within a bounded radius and lightly smoothed; every non-noise return
   gets a height above that ground by bilinear interpolation; the canopy
   height model is the highest such value per cell, with a cell that holds
   only ground returns reading 0 (open ground, measured) and a cell with no
   return at all NaN (void, unmeasured). Counts per cell of all, first and
   ground returns come out beside it, so density is a measurement with a
   definition, never a label copied from a catalogue.                       */

export const GROUND_CLASSES = Object.freeze(new Set([2, 9]));
export const NOISE_CLASSES = Object.freeze(new Set([7, 18]));
export const DEFAULT_GROUND_FILL_RADIUS_CELLS = 60;
export const HAG_CEILING_METRES = 60;

export function gridSpec({ minEasting, maxNorthing, width, height, sampleSpacingMetres = 1 }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new RangeError('grid needs positive integer width and height');
  return Object.freeze({ minEasting, maxNorthing, width, height, sampleSpacingMetres });
}

function cellIndex(grid, x, y) {
  const column = Math.floor((x - grid.minEasting) / grid.sampleSpacingMetres);
  const row = Math.floor((grid.maxNorthing - y) / grid.sampleSpacingMetres);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return -1;
  return row * grid.width + column;
}

/** Mean ground height per cell from the ground-class returns, plus the count. */
export function groundGrid(grid, points) {
  const size = grid.width * grid.height;
  const sum = new Float64Array(size);
  const count = new Uint32Array(size);
  for (let i = 0; i < points.count; i++) {
    if (!GROUND_CLASSES.has(points.classification[i])) continue;
    const index = cellIndex(grid, points.x[i], points.y[i]);
    if (index < 0) continue;
    sum[index] += points.z[i];
    count[index]++;
  }
  const mean = new Float32Array(size).fill(Number.NaN);
  for (let i = 0; i < size; i++) if (count[i]) mean[i] = sum[i] / count[i];
  return { mean, count };
}

/**
 * Fill cells without ground returns from the nearest measured cell, by
 * breadth-first propagation over 8-neighbours, out to `radiusCells`. Beyond
 * that the ground is unknown and so is every height above it.
 */
export function fillGround(grid, mean, { radiusCells = DEFAULT_GROUND_FILL_RADIUS_CELLS } = {}) {
  const { width, height } = grid;
  const size = width * height;
  const filled = new Float32Array(mean);
  const distance = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < size; i++) if (!Number.isNaN(mean[i])) { distance[i] = 0; queue[tail++] = i; }
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (head < tail) {
    const current = queue[head++];
    const d = distance[current];
    if (d >= radiusCells) continue;
    const row = Math.floor(current / width);
    const column = current - row * width;
    for (const [dx, dy] of neighbours) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const index = r * width + c;
      if (distance[index] !== -1) continue;
      distance[index] = d + 1;
      filled[index] = filled[current];
      queue[tail++] = index;
    }
  }
  return { ground: filled, fillDistance: distance };
}

/** 3 x 3 mean over finite cells; keeps NaN where the centre is NaN. */
export function smoothGround(grid, ground) {
  const { width, height } = grid;
  const out = new Float32Array(ground.length);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      if (Number.isNaN(ground[index])) { out[index] = Number.NaN; continue; }
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = column + dx;
          const r = row + dy;
          if (c < 0 || r < 0 || c >= width || r >= height) continue;
          const value = ground[r * width + c];
          if (Number.isNaN(value)) continue;
          sum += value;
          count++;
        }
      }
      out[index] = sum / count;
    }
  }
  return out;
}

/** Bilinear ground height at a point over cell centres; NaN outside the filled ground. */
export function groundAt(grid, ground, x, y) {
  const fx = (x - grid.minEasting) / grid.sampleSpacingMetres - 0.5;
  const fy = (grid.maxNorthing - y) / grid.sampleSpacingMetres - 0.5;
  const column = Math.floor(fx);
  const row = Math.floor(fy);
  const tx = fx - column;
  const ty = fy - row;
  const at = (c, r) => {
    const cc = Math.min(grid.width - 1, Math.max(0, c));
    const rr = Math.min(grid.height - 1, Math.max(0, r));
    return ground[rr * grid.width + cc];
  };
  const h00 = at(column, row), h10 = at(column + 1, row), h01 = at(column, row + 1), h11 = at(column + 1, row + 1);
  if ([h00, h10, h01, h11].some(Number.isNaN)) {
    const nearest = at(Math.round(fx), Math.round(fy));
    return nearest;
  }
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

/**
 * Canopy height model and the per-cell counts. `points` holds x, y, z,
 * classification and returnNumber arrays with `count` entries.
 */
export function canopyHeightModel(grid, points, ground, { ceilingMetres = HAG_CEILING_METRES } = {}) {
  const size = grid.width * grid.height;
  const chm = new Float32Array(size).fill(Number.NaN);
  const allReturns = new Uint16Array(size);
  const firstReturns = new Uint16Array(size);
  const groundReturns = new Uint16Array(size);
  let noise = 0;
  let unreferenced = 0;
  let clipped = 0;
  for (let i = 0; i < points.count; i++) {
    const classification = points.classification[i];
    if (NOISE_CLASSES.has(classification)) { noise++; continue; }
    const index = cellIndex(grid, points.x[i], points.y[i]);
    if (index < 0) continue;
    allReturns[index]++;
    if (points.returnNumber[i] === 1) firstReturns[index]++;
    const isGround = GROUND_CLASSES.has(classification);
    if (isGround) groundReturns[index]++;
    const base = groundAt(grid, ground, points.x[i], points.y[i]);
    if (Number.isNaN(base)) { unreferenced++; continue; }
    let hag = isGround ? 0 : points.z[i] - base;
    if (hag < 0) hag = 0;
    if (hag > ceilingMetres) { clipped++; continue; }
    if (Number.isNaN(chm[index]) || hag > chm[index]) chm[index] = hag;
  }
  return { chm, allReturns, firstReturns, groundReturns, noise, unreferenced, clipped };
}

/** Whole-window statistics with the density definitions stated. */
export function windowStatistics(grid, model, { interior = null } = {}) {
  const cells = interior ? interior.length : model.chm.length;
  let all = 0, first = 0, ground = 0, voids = 0, canopy = 0, measured = 0, open = 0;
  const visit = index => {
    all += model.allReturns[index];
    first += model.firstReturns[index];
    ground += model.groundReturns[index];
    const value = model.chm[index];
    if (Number.isNaN(value)) voids++;
    else { measured++; if (value >= 2) canopy++; else if (value === 0) open++; }
  };
  if (interior) for (const index of interior) visit(index);
  else for (let index = 0; index < model.chm.length; index++) visit(index);
  const area = cells * grid.sampleSpacingMetres * grid.sampleSpacingMetres;
  const round = (value, decimals = 4) => Math.round(value * 10 ** decimals) / 10 ** decimals;
  return Object.freeze({
    cells,
    squareMetres: area,
    allReturns: all,
    firstReturns: first,
    groundReturns: ground,
    allReturnDensityPerSquareMetre: round(all / area),
    pulseDensityPerSquareMetre: round(first / area),
    groundReturnFraction: all ? round(ground / all) : null,
    voidCells: voids,
    voidFraction: round(voids / cells),
    measuredCells: measured,
    canopyCells: canopy,
    canopyFractionOfMeasured: measured ? round(canopy / measured) : null,
    openGroundCells: open,
    noiseReturnsDropped: model.noise,
    unreferencedReturns: model.unreferenced,
    clippedReturns: model.clipped,
  });
}

/** Copy the interior of a window model into a larger campaign raster. */
export function blitInterior(source, sourceGrid, target, targetGrid, interiorBbox) {
  let written = 0;
  const [minX, minY, maxX, maxY] = interiorBbox;
  for (let row = 0; row < sourceGrid.height; row++) {
    const northing = sourceGrid.maxNorthing - (row + 0.5) * sourceGrid.sampleSpacingMetres;
    if (northing <= minY || northing > maxY) continue;
    const targetRow = Math.floor((targetGrid.maxNorthing - northing) / targetGrid.sampleSpacingMetres);
    if (targetRow < 0 || targetRow >= targetGrid.height) continue;
    for (let column = 0; column < sourceGrid.width; column++) {
      const easting = sourceGrid.minEasting + (column + 0.5) * sourceGrid.sampleSpacingMetres;
      if (easting < minX || easting >= maxX) continue;
      const targetColumn = Math.floor((easting - targetGrid.minEasting) / targetGrid.sampleSpacingMetres);
      if (targetColumn < 0 || targetColumn >= targetGrid.width) continue;
      target[targetRow * targetGrid.width + targetColumn] = source[row * sourceGrid.width + column];
      written++;
    }
  }
  return written;
}
