/**
 * Woodland context is a coarse rendering prior, never an individual species
 * observation. The Upsala input is NMD2023 v2.0 (10 m cells; 2021–2023 species
 * imagery), with small patches and a 10 m edge removed. Its equivalence to the
 * newer v2.1 product is unverified. Preserve crown geometry and species status.
 */

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

const PACKED_ENCODING = 'row-major-2bit-lsb-base64-v1';
const RUN_ENCODING = 'runs [row,startColumn,length,class]; omitted cells0';

function encodeBytes(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(''));
}

function readContext(context) {
  if (context == null || typeof context !== 'object') throw new TypeError('woodland context must be an object');
  if (context.schemaVersion !== 1 || context.kind !== 'woodland-leaf-type-context') {
    throw new TypeError('unsupported woodland context schema or kind');
  }
  if (context.crs !== 'EPSG:3006') throw new TypeError('woodland context must use EPSG:3006');
  const width = positiveInteger(context.width, 'width');
  const height = positiveInteger(context.height, 'height');
  const cells = positiveInteger(width * height, 'cell count');
  const size = context.cellSizeMetres;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('cellSizeMetres must be positive');
  if (!Array.isArray(context.extent) || context.extent.length !== 4 ||
      !context.extent.every(Number.isFinite)) {
    throw new TypeError('extent must contain four finite EPSG:3006 coordinates');
  }
  const [minE, minN, maxE, maxN] = context.extent;
  if (!(maxE > minE && maxN > minN) ||
      !Number.isFinite(width * size) || !Number.isFinite(height * size) ||
      Math.abs(maxE - minE - width * size) > 1e-7 * size ||
      Math.abs(maxN - minN - height * size) > 1e-7 * size) {
    throw new RangeError('extent must match width, height and cellSizeMetres');
  }
  const geometry = { width, cells, size, minE, minN, maxE, maxN };
  if (context.encoding === PACKED_ENCODING) {
    if (context.runs !== undefined) throw new TypeError('packed woodland context must not also contain runs');
    const byteLength = Math.ceil(cells / 4);
    if (typeof context.data !== 'string' || context.data.length !== 4 * Math.ceil(byteLength / 3)) {
      throw new RangeError('packed woodland data length must match the declared grid');
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(context.data)) throw new TypeError('packed woodland data must be canonical base64');
    const decoded = atob(context.data);
    if (decoded.length !== byteLength) throw new RangeError('packed woodland byte length must match the declared grid');
    if (btoa(decoded) !== context.data) throw new TypeError('packed woodland data must be canonical base64');
    const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
    for (let i = 0; i < cells; i++) {
      if (((bytes[Math.floor(i / 4)] >> ((i % 4) * 2)) & 3) === 3) {
        throw new RangeError('packed woodland class must be 0, 1 or 2');
      }
    }
    if (cells % 4 && (bytes[bytes.length - 1] >> ((cells % 4) * 2)) !== 0) {
      throw new RangeError('unused packed woodland padding cells must be zero');
    }
    return { ...geometry, bytes };
  }
  if ((context.encoding !== undefined && context.encoding !== RUN_ENCODING) || context.data !== undefined) {
    throw new TypeError('unsupported woodland context encoding');
  }
  if (!Array.isArray(context.runs)) throw new TypeError('runs must be an array');

  // Sparse row intervals avoid allocating a national-size dense raster. Copy
  // intervals so later mutation of the source JSON cannot alter the sampler.
  const rows = new Map();
  for (const run of context.runs) {
    if (!Array.isArray(run) || run.length !== 4 || !run.every(Number.isSafeInteger)) {
      throw new TypeError('each run must be [row, startColumn, length, class] integers');
    }
    const [row, start, length, type] = run;
    if (row < 0 || row >= height || start < 0 || start >= width || length <= 0 || length > width - start) {
      throw new RangeError('woodland run is outside the declared grid');
    }
    if (type !== 1 && type !== 2) throw new RangeError('woodland run class must be 1 or 2; omit unknown cells');
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push([start, start + length, type]);
  }
  for (const intervals of rows.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i][0] < intervals[i - 1][1]) throw new RangeError('woodland runs overlap');
    }
  }
  return { ...geometry, rows };
}

/**
 * Losslessly pack the evidence grid for transport without changing its source
 * metadata. Cells follow north-to-south rows, west-to-east columns, four cells
 * per byte starting at the least significant two bits. Zero is unresolved;
 * class 3 is reserved and rejected. The original RLE evidence is not modified.
 * Browser globals only: no compression library or Node dependency is required.
 */
export function compactWoodlandContext(context) {
  const { width, cells, rows, bytes: existingBytes } = readContext(context);
  const bytes = existingBytes ?? new Uint8Array(Math.ceil(cells / 4));
  if (rows) {
    for (const [row, intervals] of rows) {
      for (const [start, end, type] of intervals) {
        for (let i = row * width + start; i < row * width + end; i++) {
          bytes[Math.floor(i / 4)] |= type << ((i % 4) * 2);
        }
      }
    }
  }
  const result = { ...context, encoding: PACKED_ENCODING, data: encodeBytes(bytes) };
  delete result.runs;
  return result;
}

/**
 * Build once, then call sample(localX, localZ). toEpsg must return absolute
 * [easting, northing] in EPSG:3006; a relative grid offset is not sufficient.
 * Returns 1 = conifer-dominant, 2 = broadleaf-dominant, or null = unresolved.
 * Missing data is optional. Malformed supplied data fails at construction.
 * North/west pixel edges are included; south/east outer edges are excluded.
 */
export function createWoodlandContextSampler(context, { toEpsg } = {}) {
  if (context == null) return () => null;
  if (typeof toEpsg !== 'function') throw new TypeError('toEpsg must be a function');
  const { width, size, minE, minN, maxE, maxN, rows, bytes } = readContext(context);
  let cachedRow = -1, cachedIntervals;
  return function sample(localX, localZ) {
    if (!Number.isFinite(localX) || !Number.isFinite(localZ)) return null;
    const point = toEpsg(localX, localZ);
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
    const [easting, northing] = point;
    if (easting < minE || easting >= maxE || northing > maxN || northing <= minN) return null;
    const column = Math.floor((easting - minE) / size);
    const row = Math.floor((maxN - northing) / size);
    if (bytes) {
      const i = row * width + column;
      return ((bytes[Math.floor(i / 4)] >> ((i % 4) * 2)) & 3) || null;
    }
    if (row !== cachedRow) {
      cachedRow = row;
      cachedIntervals = rows.get(row);
    }
    if (!cachedIntervals) return null;
    let low = 0, high = cachedIntervals.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const [start, end, type] = cachedIntervals[mid];
      if (column < start) high = mid - 1;
      else if (column >= end) low = mid + 1;
      else return type;
    }
    return null;
  };
}

/**
 * Choose a representative mesh: 0 spruce, 1 pine, 2 broadleaf (the current
 * engine's birch proxy). Undefined preserves the caller's existing choice in
 * unresolved cells. Never export the result as an observed botanical species.
 *
 * 70% is a deliberately chosen rendering prior at the source dominance limit,
 * not a measured local proportion. The source threshold describes crown area;
 * sampling gives that proportion in expectation, not exact local tree counts.
 * The unresolved pine:spruce split retains the existing conditional 56:27 mix.
 */
export function woodlandSpeciesPrior({ r, context, baseBroadleafProbability = 0.17 } = {}) {
  if (context !== 1 && context !== 2) return undefined;
  if (!Number.isFinite(r) || r < 0 || r >= 1) throw new RangeError('r must be in [0, 1)');
  if (!Number.isFinite(baseBroadleafProbability) || baseBroadleafProbability < 0 || baseBroadleafProbability > 1) {
    throw new RangeError('baseBroadleafProbability must be in [0, 1]');
  }
  const broadleaf = context === 2
    ? Math.max(0.70, baseBroadleafProbability)
    : Math.min(0.30, baseBroadleafProbability);
  const conifer = 1 - broadleaf;
  return r < conifer * (56 / 83) ? 1 : r < conifer ? 0 : 2;
}
