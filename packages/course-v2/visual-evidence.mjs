const CORE_INSET = 0.18;
const CELL_COLUMNS = 6;
const CELL_ROWS = 4;
const EDGE_DELTA = 5;
const CELL_RANGE_DELTA = 7;

const round = (value, digits) => Number(value.toFixed(digits));

function imageShape(image) {
  if (!image || typeof image !== 'object') throw new TypeError('renderer image must be an object');
  const { width, height, channels, data } = image;
  if (!Number.isSafeInteger(width) || width < 8 || !Number.isSafeInteger(height) || height < 8) {
    throw new RangeError('renderer image dimensions must be safe integers of at least 8 pixels');
  }
  if (channels !== 3 && channels !== 4) {
    throw new RangeError('renderer image must have three RGB or four RGBA channels');
  }
  if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1 ||
      data.length < width * height * channels) {
    throw new TypeError('renderer image data must contain byte RGB/RGBA pixels');
  }
  return { width, height, channels, data };
}

/* Integer Rec. 709 weights add to 256. Keeping luminance in byte space makes
   evidence stable across Node versions and avoids using one arbitrary corner
   pixel as the assumed clear colour. */
function luminanceAt(data, offset) {
  return (54 * data[offset] + 183 * data[offset + 1] + 19 * data[offset + 2] + 128) >> 8;
}

function percentile(histogram, count, fraction) {
  const rank = Math.floor((count - 1) * fraction);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value++) {
    cumulative += histogram[value];
    if (cumulative > rank) return value;
  }
  return histogram.length - 1;
}

function cellIndex(x, y, bounds) {
  const column = Math.min(CELL_COLUMNS - 1,
    Math.floor((x - bounds.x0) * CELL_COLUMNS / bounds.width));
  const row = Math.min(CELL_ROWS - 1,
    Math.floor((y - bounds.y0) * CELL_ROWS / bounds.height));
  return row * CELL_COLUMNS + column;
}

/**
 * Measure a decoded renderer RGB/RGBA image without filesystem or browser
 * dependencies. The central 64% is evaluated separately so menus, badges and
 * controls at the frame edges cannot make a cleared render target look valid.
 */
export function rendererImageEvidence(image) {
  const { width, height, channels, data } = imageShape(image);
  const bounds = {
    x0: Math.floor(width * CORE_INSET),
    x1: Math.ceil(width * (1 - CORE_INSET)),
    y0: Math.floor(height * CORE_INSET),
    y1: Math.ceil(height * (1 - CORE_INSET)),
  };
  bounds.width = bounds.x1 - bounds.x0;
  bounds.height = bounds.y1 - bounds.y0;

  const cellCount = CELL_COLUMNS * CELL_ROWS;
  const cellHistograms = Array.from({ length: cellCount }, () => new Uint32Array(256));
  const cellSizes = new Uint32Array(cellCount);
  const coreHistogram = new Uint32Array(256);
  const previousRow = new Uint8Array(bounds.width);

  let luminanceSum = 0;
  let nearBlack = 0;
  let nearWhite = 0;
  let coreSum = 0;
  let coreSquareSum = 0;
  let coreCount = 0;
  let edgeComparisons = 0;
  let strongEdges = 0;

  for (let y = 0; y < height; y++) {
    let left = -1;
    for (let x = 0; x < width; x++) {
      const value = luminanceAt(data, (y * width + x) * channels);
      luminanceSum += value;
      if (value < 8) nearBlack++;
      if (value > 247) nearWhite++;

      if (x < bounds.x0 || x >= bounds.x1 || y < bounds.y0 || y >= bounds.y1) continue;
      const localX = x - bounds.x0;
      coreHistogram[value]++;
      coreSum += value;
      coreSquareSum += value * value;
      coreCount++;

      const cell = cellIndex(x, y, bounds);
      cellHistograms[cell][value]++;
      cellSizes[cell]++;

      if (left >= 0) {
        edgeComparisons++;
        if (Math.abs(value - left) >= EDGE_DELTA) strongEdges++;
      }
      if (y > bounds.y0) {
        edgeComparisons++;
        if (Math.abs(value - previousRow[localX]) >= EDGE_DELTA) strongEdges++;
      }
      left = value;
      previousRow[localX] = value;
    }
  }

  const coreMeanByte = coreSum / coreCount;
  const variance = Math.max(0, coreSquareSum / coreCount - coreMeanByte * coreMeanByte);
  const coreP05 = percentile(coreHistogram, coreCount, 0.05);
  const coreP95 = percentile(coreHistogram, coreCount, 0.95);
  let structuredCells = 0;
  for (let index = 0; index < cellCount; index++) {
    const size = cellSizes[index];
    const low = percentile(cellHistograms[index], size, 0.1);
    const high = percentile(cellHistograms[index], size, 0.9);
    if (high - low >= CELL_RANGE_DELTA) structuredCells++;
  }

  const pixelCount = width * height;
  return Object.freeze({
    schemaVersion: 1,
    width,
    height,
    meanLuminance: round(luminanceSum / pixelCount / 255, 4),
    nearBlackPercent: round(nearBlack / pixelCount * 100, 2),
    nearWhitePercent: round(nearWhite / pixelCount * 100, 2),
    corePixelPercent: round(coreCount / pixelCount * 100, 2),
    coreMeanLuminance: round(coreMeanByte / 255, 4),
    coreLuminanceStdDev: round(Math.sqrt(variance) / 255, 4),
    coreRobustLuminanceRange: round((coreP95 - coreP05) / 255, 4),
    coreStrongEdgePercent: round(strongEdges / edgeComparisons * 100, 2),
    coreStructuredCellPercent: round(structuredCells / cellCount * 100, 2),
  });
}

/**
 * Fail-closed visual gate. Brightness is deliberately not a prerequisite: a
 * genuinely dark scene may pass when it contains distributed spatial detail.
 * Uniform black/teal, uniform fog and edge-only UI all fail the core checks.
 */
export function isCourseFrameVisible(evidence) {
  if (!evidence || evidence.schemaVersion !== 1) return false;
  return [
    [evidence.coreLuminanceStdDev, 0.018],
    [evidence.coreRobustLuminanceRange, 0.045],
    [evidence.coreStrongEdgePercent, 0.5],
    [evidence.coreStructuredCellPercent, 25],
  ].every(([value, minimum]) => Number.isFinite(value) && value >= minimum);
}
