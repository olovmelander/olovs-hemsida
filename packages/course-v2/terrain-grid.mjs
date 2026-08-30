const DEFAULT_NO_DATA = 65535;

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 2 || width > 4097) {
    throw new RangeError('width must be an integer from 2 to 4097');
  }
  if (!Number.isSafeInteger(height) || height < 2 || height > 4097) {
    throw new RangeError('height must be an integer from 2 to 4097');
  }
  return width * height;
}

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('payload must be an ArrayBuffer or Uint8Array');
}

export function encodeTerrainGrid({
  heights,
  width,
  height,
  heightOffsetMetres: requestedHeightOffsetMetres,
  heightScaleMetres = 0.01,
  noDataValue = DEFAULT_NO_DATA,
}) {
  const count = dimensions(width, height);
  if (!heights || heights.length !== count) throw new RangeError(`heights must contain ${count} samples`);
  if (!Number.isFinite(heightScaleMetres) || heightScaleMetres < 0.0001 || heightScaleMetres > 10) {
    throw new RangeError('heightScaleMetres must be between 0.0001 and 10');
  }
  if (!Number.isSafeInteger(noDataValue) || noDataValue < 0 || noDataValue > 65535) {
    throw new RangeError('noDataValue must fit uint16');
  }

  let sourceMin = Infinity;
  let finiteCount = 0;
  for (const value of heights) {
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value)) throw new TypeError('height samples must be finite or NaN nodata');
    sourceMin = Math.min(sourceMin, value);
    finiteCount++;
  }
  if (!finiteCount) throw new Error('terrain grid contains no finite height samples');

  const heightOffsetMetres = requestedHeightOffsetMetres === undefined
    ? Math.floor(sourceMin / heightScaleMetres) * heightScaleMetres
    : requestedHeightOffsetMetres;
  if (!Number.isFinite(heightOffsetMetres)) {
    throw new TypeError('heightOffsetMetres must be finite when supplied');
  }
  const payload = new Uint8Array(count * 2);
  const view = new DataView(payload.buffer);
  let minHeightRH2000 = Infinity;
  let maxHeightRH2000 = -Infinity;
  for (let index = 0; index < count; index++) {
    const value = heights[index];
    if (Number.isNaN(value)) {
      view.setUint16(index * 2, noDataValue, true);
      continue;
    }
    const quantized = Math.round((value - heightOffsetMetres) / heightScaleMetres);
    if (quantized < 0 || quantized > 65535 || quantized === noDataValue) {
      throw new RangeError(`height sample ${index} exceeds the uint16 quantization range`);
    }
    view.setUint16(index * 2, quantized, true);
    const decoded = heightOffsetMetres + quantized * heightScaleMetres;
    minHeightRH2000 = Math.min(minHeightRH2000, decoded);
    maxHeightRH2000 = Math.max(maxHeightRH2000, decoded);
  }

  return {
    payload,
    grid: {
      width,
      height,
      heightOffsetMetres,
      heightScaleMetres,
      noDataValue,
      rowOrder: 'north-to-south',
      columnOrder: 'west-to-east',
    },
    minHeightRH2000,
    maxHeightRH2000,
    finiteCount,
    maximumQuantizationErrorMetres: heightScaleMetres / 2,
  };
}

export function decodeTerrainGrid(payload, grid) {
  const bytes = byteView(payload);
  const count = dimensions(grid.width, grid.height);
  if (bytes.byteLength !== count * 2) {
    throw new RangeError(`terrain payload has ${bytes.byteLength} bytes; expected ${count * 2}`);
  }
  if (grid.rowOrder !== 'north-to-south' || grid.columnOrder !== 'west-to-east') {
    throw new Error('unsupported terrain grid axis order');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const quantized = view.getUint16(index * 2, true);
    heights[index] = quantized === grid.noDataValue
      ? Number.NaN
      : grid.heightOffsetMetres + quantized * grid.heightScaleMetres;
  }
  return heights;
}

export function inspectTerrainPayload(payload, header) {
  const bytes = byteView(payload);
  const count = dimensions(header.grid.width, header.grid.height);
  if (bytes.byteLength !== count * 2) {
    throw new RangeError(`terrain payload has ${bytes.byteLength} bytes; expected ${count * 2}`);
  }
  if (header.grid.rowOrder !== 'north-to-south' || header.grid.columnOrder !== 'west-to-east') {
    throw new Error('unsupported terrain grid axis order');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let finiteCount = 0;
  let minHeightRH2000 = Infinity;
  let maxHeightRH2000 = -Infinity;
  for (let index = 0; index < count; index++) {
    const quantized = view.getUint16(index * 2, true);
    if (quantized === header.grid.noDataValue) continue;
    const height = header.grid.heightOffsetMetres + quantized * header.grid.heightScaleMetres;
    finiteCount++;
    minHeightRH2000 = Math.min(minHeightRH2000, height);
    maxHeightRH2000 = Math.max(maxHeightRH2000, height);
  }
  if (!finiteCount) throw new Error('decoded terrain grid contains no finite height samples');
  const tolerance = header.grid.heightScaleMetres / 2 + 1e-5;
  if (minHeightRH2000 < header.bounds.minHeightRH2000 - tolerance ||
      maxHeightRH2000 > header.bounds.maxHeightRH2000 + tolerance) {
    throw new Error('decoded terrain height lies outside the declared RH 2000 bounds');
  }
  return { finiteCount, minHeightRH2000, maxHeightRH2000 };
}
