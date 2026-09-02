/* Measured stand fields: what dense forest becomes when crowns cannot be
   told apart. Aggregates the 1 m canopy fields into coarser cells that carry
   canopy fraction, mean and 95th-percentile height, measured fraction and
   campaign ownership -- density and height, never invented stems. The
   runtime stand payload will be versioned separately; this is the compiler
   side and the review evidence.                                              */
import { assertRaster } from './canopy-fields.mjs';

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const round = (value, decimals = 3) => (value === null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals);

/**
 * Aggregate to `cellMetres` cells aligned to the raster origin. Each output
 * cell reports how much of it was measured, how much of the measured part is
 * canopy at or above `canopyThresholdMetres`, the mean and p95 canopy height,
 * and which campaign owns it. A cell straddling a seam is `mixed` and its
 * statistics come from its majority side only, which the field states.
 */
export function standField(heights, {
  voids,
  ownership = null,
  cellMetres = 8,
  canopyThresholdMetres = 2,
} = {}) {
  assertRaster(heights);
  const { width, height, values, sampleSpacingMetres } = heights;
  if (!voids || voids.length !== values.length) throw new RangeError('voids mask must match the raster');
  const cells = Math.round(cellMetres / sampleSpacingMetres);
  if (!Number.isSafeInteger(cells) || cells < 1) throw new RangeError('cellMetres must be a positive multiple of the sample spacing');
  const columns = Math.ceil(width / cells);
  const rows = Math.ceil(height / cells);
  const count = columns * rows;
  const measuredFraction = new Float32Array(count);
  const canopyFraction = new Float32Array(count);
  const meanHeight = new Float32Array(count).fill(Number.NaN);
  const p95Height = new Float32Array(count).fill(Number.NaN);
  const campaign = new Int8Array(count).fill(-1);
  const mixed = new Uint8Array(count);
  for (let cellRow = 0; cellRow < rows; cellRow++) {
    for (let cellColumn = 0; cellColumn < columns; cellColumn++) {
      let total = 0;
      let measured = 0;
      const north = [];
      const south = [];
      let northCount = 0;
      let southCount = 0;
      for (let row = cellRow * cells; row < Math.min(height, (cellRow + 1) * cells); row++) {
        for (let column = cellColumn * cells; column < Math.min(width, (cellColumn + 1) * cells); column++) {
          const index = row * width + column;
          total++;
          const owner = ownership ? ownership[index] : 0;
          if (owner) northCount++; else southCount++;
          if (voids[index]) continue;
          measured++;
          const value = values[index];
          if (Number.isNaN(value)) continue;
          (owner ? north : south).push(value);
        }
      }
      const output = cellRow * columns + cellColumn;
      const majorityNorth = ownership ? northCount >= southCount : false;
      const sample = majorityNorth ? north : south;
      measuredFraction[output] = total ? measured / total : 0;
      campaign[output] = ownership ? (majorityNorth ? 1 : 0) : -1;
      mixed[output] = ownership && northCount > 0 && southCount > 0 ? 1 : 0;
      const canopy = sample.filter(value => value >= canopyThresholdMetres).sort((a, b) => a - b);
      canopyFraction[output] = sample.length ? canopy.length / sample.length : 0;
      if (canopy.length) {
        meanHeight[output] = canopy.reduce((sum, value) => sum + value, 0) / canopy.length;
        p95Height[output] = quantile(canopy, 0.95);
      }
    }
  }
  return Object.freeze({
    columns,
    rows,
    cellMetres: cells * sampleSpacingMetres,
    originEasting: heights.originEasting,
    originNorthing: heights.originNorthing,
    canopyThresholdMetres,
    ownershipNote: ownership ? 'campaign 1 = north/east of the seam, 0 = south/west; a mixed cell reports its majority side only' : 'single campaign',
    measuredFraction,
    canopyFraction,
    meanHeight,
    p95Height,
    campaign,
    mixed,
  });
}

/**
 * The publishable field for one tile, in the arrays `encodeStandField`
 * takes. Every `cellMetres` cell of the tile looks at its 1 m canopy cells:
 * a cell is measured when at least a quarter of them carry a return; it is
 * excluded when at least half of them fall in a semantic exclusion; cells an
 * individual's crown extent has claimed are left to that individual and are
 * neither canopy nor excluded here. Canopy fraction, mean and p95 height are
 * over the remaining canopy cells at or above the threshold.
 */
export function tileStandField({
  raster,
  voids,
  excludeMask = null,
  extentLabels = null,
  bbox,
  cellMetres = 4,
  canopyThresholdMetres = 2,
  north = 0,
}) {
  assertRaster(raster);
  const { width, height, values, sampleSpacingMetres, originEasting, originNorthing } = raster;
  if (!voids || voids.length !== values.length) throw new RangeError('voids mask must match the raster');
  const columns = Math.floor((bbox[2] - bbox[0]) / cellMetres + 1e-9);
  const rows = Math.floor((bbox[3] - bbox[1]) / cellMetres + 1e-9);
  if (columns < 1 || rows < 1) throw new RangeError('tile is smaller than one stand cell');
  const count = columns * rows;
  const fraction = new Float32Array(count).fill(Number.NaN);
  const meanHeight = new Float32Array(count).fill(Number.NaN);
  const p95Height = new Float32Array(count).fill(Number.NaN);
  const measured = new Uint8Array(count);
  const northFlags = new Uint8Array(count).fill(north ? 1 : 0);
  const excluded = new Uint8Array(count);
  const perCell = Math.max(1, Math.round((cellMetres / sampleSpacingMetres) ** 2));
  for (let cellRow = 0; cellRow < rows; cellRow++) {
    const northing1 = bbox[3] - cellRow * cellMetres;
    const northing0 = northing1 - cellMetres;
    for (let cellColumn = 0; cellColumn < columns; cellColumn++) {
      const easting0 = bbox[0] + cellColumn * cellMetres;
      const easting1 = easting0 + cellMetres;
      const column0 = Math.max(0, Math.floor((easting0 - originEasting) / sampleSpacingMetres));
      const column1 = Math.min(width, Math.ceil((easting1 - originEasting) / sampleSpacingMetres - 1e-9));
      const row0 = Math.max(0, Math.floor((originNorthing - northing1) / sampleSpacingMetres));
      const row1 = Math.min(height, Math.ceil((originNorthing - northing0) / sampleSpacingMetres - 1e-9));
      let seen = 0;
      let measuredCells = 0;
      let excludedCells = 0;
      const canopy = [];
      for (let row = row0; row < row1; row++) {
        for (let column = column0; column < column1; column++) {
          const index = row * width + column;
          seen++;
          if (excludeMask && excludeMask[index]) excludedCells++;
          if (voids[index]) continue;
          const value = values[index];
          if (Number.isNaN(value)) continue;
          measuredCells++;
          if (extentLabels && extentLabels[index] >= 0) continue;
          if (excludeMask && excludeMask[index]) continue;
          if (value >= canopyThresholdMetres) canopy.push(value);
        }
      }
      const output = cellRow * columns + cellColumn;
      if (!seen || measuredCells * 4 < Math.min(seen, perCell)) continue;
      measured[output] = 1;
      excluded[output] = excludedCells * 2 >= seen ? 1 : 0;
      fraction[output] = canopy.length / measuredCells;
      if (canopy.length) {
        canopy.sort((a, b) => a - b);
        meanHeight[output] = canopy.reduce((sum, value) => sum + value, 0) / canopy.length;
        p95Height[output] = quantile(canopy, 0.95);
      } else {
        meanHeight[output] = 0;
        p95Height[output] = 0;
      }
    }
  }
  return Object.freeze({ width: columns, height: rows, cellMetres, fraction, meanHeight, p95Height, measured, north: northFlags, excluded });
}

/** Cell-wise merge of per-campaign tile fields: the first measured value wins. */
export function mergeTileStandFields(fields) {
  if (!fields.length) throw new RangeError('at least one field is required');
  const base = fields[0];
  const out = {
    width: base.width, height: base.height, cellMetres: base.cellMetres,
    fraction: new Float32Array(base.fraction.length).fill(Number.NaN),
    meanHeight: new Float32Array(base.fraction.length).fill(Number.NaN),
    p95Height: new Float32Array(base.fraction.length).fill(Number.NaN),
    measured: new Uint8Array(base.fraction.length),
    north: new Uint8Array(base.fraction.length),
    excluded: new Uint8Array(base.fraction.length),
  };
  for (const field of fields) {
    if (field.width !== base.width || field.height !== base.height) throw new RangeError('tile fields differ in shape');
    for (let i = 0; i < out.measured.length; i++) {
      if (out.measured[i] || !field.measured[i]) continue;
      out.measured[i] = 1;
      out.fraction[i] = field.fraction[i];
      out.meanHeight[i] = field.meanHeight[i];
      out.p95Height[i] = field.p95Height[i];
      out.north[i] = field.north[i];
      out.excluded[i] = field.excluded[i];
    }
  }
  return Object.freeze(out);
}

/** Whole-field totals for evidence. */
export function standFieldSummary(field) {
  let canopyCells = 0;
  let measuredCells = 0;
  let mixedCells = 0;
  let heightSum = 0;
  let heightCount = 0;
  for (let i = 0; i < field.canopyFraction.length; i++) {
    if (field.measuredFraction[i] > 0) measuredCells++;
    if (field.canopyFraction[i] >= 0.5) canopyCells++;
    if (field.mixed[i]) mixedCells++;
    if (!Number.isNaN(field.meanHeight[i])) { heightSum += field.meanHeight[i]; heightCount++; }
  }
  return Object.freeze({
    cells: field.canopyFraction.length,
    measuredCells,
    closedCanopyCells: canopyCells,
    mixedCells,
    meanCanopyHeightMetres: round(heightCount ? heightSum / heightCount : null),
  });
}
