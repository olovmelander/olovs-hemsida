/* A tiled GeoTIFF reader over range requests, for the few tiles of a
   cloud-optimised raster a course actually needs. Classic little-endian
   TIFF, one sample per pixel; unsigned 8/16-bit or 32-bit float samples;
   deflate or uncompressed; the horizontal-differencing predictor (2) and the
   floating-point predictor (3) undone; every overview IFD exposed as its own
   level so a coarse ring can be read at the resolution it is drawn at.
   Written for Lantmäteriet's DTM COGs (Float32, deflate, predictor 3, 512 px
   tiles, five overviews) and the Meta/WRI CHMv2 tiles (8-bit), and kept
   that narrow on purpose.                                                    */
import zlib from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8, 16: 8 };
const TAG = Object.freeze({
  subfileType: 254, width: 256, height: 257, bitsPerSample: 258, compression: 259, samplesPerPixel: 277,
  predictor: 317, tileWidth: 322, tileLength: 323, tileOffsets: 324, tileByteCounts: 325,
  sampleFormat: 339, pixelScale: 33550, tiepoint: 33922, geoKeys: 34735, gdalNoData: 42113,
});

function readValues(buffer, type, count, offset) {
  const values = [];
  for (let k = 0; k < count; k++) {
    if (type === 1 || type === 7) values.push(buffer[offset + k]);
    else if (type === 3) values.push(buffer.readUInt16LE(offset + 2 * k));
    else if (type === 4) values.push(buffer.readUInt32LE(offset + 4 * k));
    else if (type === 12) values.push(buffer.readDoubleLE(offset + 8 * k));
    else if (type === 16) values.push(Number(buffer.readBigUInt64LE(offset + 8 * k)));
    else if (type === 2) return [buffer.toString('latin1', offset, offset + count)];
    else throw new Error(`unsupported TIFF field type ${type}`);
  }
  return values;
}

function parseIfd(head, ifd) {
  const count = head.readUInt16LE(ifd);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    if (o + 12 > head.length) throw new Error('TIFF directory runs past the header window');
    const tag = head.readUInt16LE(o);
    const type = head.readUInt16LE(o + 2);
    const n = head.readUInt32LE(o + 4);
    const size = TYPE_SIZE[type] * n;
    const inline = size <= 4;
    const valueOffset = inline ? o + 8 : head.readUInt32LE(o + 8);
    tags.set(tag, {
      tag, type, count: n, size, inline, valueOffset,
      values: inline || valueOffset + size <= head.length ? readValues(head, type, n, valueOffset) : null,
    });
  }
  const nextAt = ifd + 2 + count * 12;
  const next = nextAt + 4 <= head.length ? head.readUInt32LE(nextAt) : 0;
  return { tags, next };
}

/** Parse every IFD reachable inside the header window (main image first). */
export function parseTiffHeader(head) {
  if (head.toString('latin1', 0, 2) !== 'II' || head.readUInt16LE(2) !== 42) {
    throw new Error('only classic little-endian TIFF is supported');
  }
  const directories = [];
  let ifd = head.readUInt32LE(4);
  while (ifd && ifd + 2 <= head.length && directories.length < 32) {
    const parsed = parseIfd(head, ifd);
    directories.push(parsed.tags);
    ifd = parsed.next;
  }
  if (!directories.length) throw new Error('TIFF has no readable directory');
  return directories;
}

function undoPredictor2(bytes, width, height, bytesPerSample) {
  if (bytesPerSample === 1) {
    for (let row = 0; row < height; row++) {
      const base = row * width;
      for (let column = 1; column < width; column++) bytes[base + column] = (bytes[base + column] + bytes[base + column - 1]) & 0xff;
    }
  } else if (bytesPerSample === 2) {
    for (let row = 0; row < height; row++) {
      const base = row * width * 2;
      for (let column = 1; column < width; column++) {
        const o = base + column * 2;
        bytes.writeUInt16LE((bytes.readUInt16LE(o) + bytes.readUInt16LE(o - 2)) & 0xffff, o);
      }
    }
  } else {
    throw new Error('predictor 2 is supported for 8- and 16-bit samples only');
  }
  return bytes;
}

/* TIFF floating-point predictor: each row is stored as byte planes, the most
   significant byte of every sample first, differenced horizontally across the
   whole row of bytes. Undo the differences, then interleave the planes back
   into little-endian samples. */
function undoPredictor3(bytes, width, height, bytesPerSample) {
  const rowBytes = width * bytesPerSample;
  const out = Buffer.alloc(bytes.length);
  for (let row = 0; row < height; row++) {
    const base = row * rowBytes;
    for (let k = 1; k < rowBytes; k++) bytes[base + k] = (bytes[base + k] + bytes[base + k - 1]) & 0xff;
    for (let column = 0; column < width; column++) {
      for (let plane = 0; plane < bytesPerSample; plane++) {
        /* plane 0 holds the most significant byte; little-endian output puts it last */
        out[base + column * bytesPerSample + (bytesPerSample - 1 - plane)] = bytes[base + plane * width + column];
      }
    }
  }
  return out;
}

function levelFromTags(tags, range, { noDataValue, fallbackScale, fallbackOrigin, factor }) {
  const get = (tag, fallback = null) => tags.get(tag)?.values?.[0] ?? fallback;
  const width = get(TAG.width), height = get(TAG.height);
  const tileWidth = get(TAG.tileWidth), tileLength = get(TAG.tileLength);
  const bitsPerSample = get(TAG.bitsPerSample, 8);
  const compression = get(TAG.compression, 1);
  const predictor = get(TAG.predictor, 1);
  const samplesPerPixel = get(TAG.samplesPerPixel, 1);
  const sampleFormat = get(TAG.sampleFormat, 1);
  if (!tileWidth || !tileLength) throw new Error('the raster is not tiled');
  if (samplesPerPixel !== 1) throw new Error('only single-band rasters are supported');
  const isFloat = sampleFormat === 3 && bitsPerSample === 32;
  const isUnsigned = sampleFormat === 1 && [8, 16].includes(bitsPerSample);
  if (!isFloat && !isUnsigned) throw new Error(`unsupported sample type: format ${sampleFormat}, ${bitsPerSample} bits`);
  if (![1, 8, 32946].includes(compression)) throw new Error(`unsupported TIFF compression ${compression}`);
  if (![1, 2, 3].includes(predictor)) throw new Error(`unsupported TIFF predictor ${predictor}`);
  const bytesPerSample = bitsPerSample / 8;
  const tilesAcross = Math.ceil(width / tileWidth);
  const tilesDown = Math.ceil(height / tileLength);
  const pixelScaleX = fallbackScale[0] * factor;
  const pixelScaleY = fallbackScale[1] * factor;
  const loadArray = async tag => {
    const entry = tags.get(tag);
    if (!entry) throw new Error(`TIFF tag ${tag} is missing`);
    if (entry.values) return entry.values;
    const bytes = await range(entry.valueOffset, entry.size);
    return readValues(bytes, entry.type, entry.count, 0);
  };
  let tables = null;
  const cache = new Map();
  const level = {
    width, height, tileWidth, tileLength, tilesAcross, tilesDown, bitsPerSample, compression, predictor,
    isFloat, factor, noData: noDataValue,
    originX: fallbackOrigin[0], originY: fallbackOrigin[1], pixelScaleX, pixelScaleY,
    pixelOf(x, y) {
      return [Math.floor((x - this.originX) / this.pixelScaleX), Math.floor((this.originY - y) / this.pixelScaleY)];
    },
    /** The map coordinate of a pixel centre. */
    centreOf(column, row) {
      return [this.originX + (column + 0.5) * this.pixelScaleX, this.originY - (row + 0.5) * this.pixelScaleY];
    },
    async tile(tileColumn, tileRow) {
      if (tileColumn < 0 || tileRow < 0 || tileColumn >= tilesAcross || tileRow >= tilesDown) return null;
      const index = tileRow * tilesAcross + tileColumn;
      if (cache.has(index)) return cache.get(index);
      if (!tables) tables = { offsets: await loadArray(TAG.tileOffsets), counts: await loadArray(TAG.tileByteCounts) };
      const size = tables.counts[index];
      if (!size) { cache.set(index, null); return null; }
      const raw = await range(tables.offsets[index], size);
      let bytes = compression === 1 ? Buffer.from(raw) : zlib.inflateSync(raw);
      const expected = tileWidth * tileLength * bytesPerSample;
      if (bytes.length !== expected) throw new Error(`tile ${index} decoded to ${bytes.length} bytes; expected ${expected}`);
      if (predictor === 2) bytes = undoPredictor2(bytes, tileWidth, tileLength, bytesPerSample);
      if (predictor === 3) bytes = undoPredictor3(bytes, tileWidth, tileLength, bytesPerSample);
      let values;
      if (isFloat) values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
      else if (bytesPerSample === 1) values = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
      else values = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
      cache.set(index, values);
      return values;
    },
    async sample(column, row) {
      if (column < 0 || row < 0 || column >= width || row >= height) return Number.NaN;
      const tile = await this.tile(Math.floor(column / tileWidth), Math.floor(row / tileLength));
      return this.valueFrom(tile, column, row);
    },
    /** Sample from tiles already fetched; NaN where the tile is not cached. */
    sampleSync(column, row) {
      if (column < 0 || row < 0 || column >= width || row >= height) return Number.NaN;
      const tile = cache.get(Math.floor(row / tileLength) * tilesAcross + Math.floor(column / tileWidth));
      return this.valueFrom(tile, column, row);
    },
    valueFrom(tile, column, row) {
      if (!tile) return Number.NaN;
      const value = tile[(row % tileLength) * tileWidth + (column % tileWidth)];
      if (this.noData !== null && value === this.noData) return Number.NaN;
      return value;
    },
    /**
     * Fetch every tile a pixel window touches, `concurrency` at a time, then
     * read the window into a Float32Array (row-major, NaN for nodata and
     * outside the raster).
     */
    async readWindow({ column0, row0, columns, rows, concurrency = 6, step = 1 }) {
      const wanted = [];
      const tileColumn0 = Math.max(0, Math.floor(column0 / tileWidth));
      const tileColumn1 = Math.min(tilesAcross - 1, Math.floor((column0 + (columns - 1) * step) / tileWidth));
      const tileRow0 = Math.max(0, Math.floor(row0 / tileLength));
      const tileRow1 = Math.min(tilesDown - 1, Math.floor((row0 + (rows - 1) * step) / tileLength));
      for (let tr = tileRow0; tr <= tileRow1; tr++) for (let tc = tileColumn0; tc <= tileColumn1; tc++) wanted.push([tc, tr]);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (cursor < wanted.length) {
          const [tc, tr] = wanted[cursor++];
          await this.tile(tc, tr);
        }
      }));
      const values = new Float32Array(columns * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
        values[r * columns + c] = this.sampleSync(column0 + c * step, row0 + r * step);
      }
      return values;
    },
    get cachedTiles() { return cache.size; },
    dropCache() { cache.clear(); },
  };
  return level;
}

/**
 * Open a COG by a `range(offset, length)` function. Level 0 is the full
 * resolution image; `levels[k]` is the k-th overview (2^k coarser, by the
 * subfile chain), each addressed in map coordinates through its own pixel
 * scale derived from level 0's georeferencing.
 */
export async function openCog(range, { headerBytes = 65536 } = {}) {
  const head = await range(0, headerBytes);
  const directories = parseTiffHeader(head);
  const main = directories[0];
  const pixelScale = main.get(TAG.pixelScale)?.values;
  const tiepoint = main.get(TAG.tiepoint)?.values;
  if (!pixelScale || !tiepoint) throw new Error('the raster carries no pixel scale or tiepoint');
  const noDataText = main.get(TAG.gdalNoData)?.values?.[0];
  const noDataValue = noDataText === undefined ? null : Number(String(noDataText).replace(/\0/g, '').trim());
  const geoKeys = main.get(TAG.geoKeys)?.values || [];
  let epsg = null;
  for (let i = 4; i + 3 < geoKeys.length; i += 4) if (geoKeys[i] === 3072 || geoKeys[i] === 2048) { epsg = geoKeys[i + 3]; break; }
  const origin = [tiepoint[3] - tiepoint[0] * pixelScale[0], tiepoint[4] + tiepoint[1] * pixelScale[1]];
  const mainWidth = main.get(TAG.width)?.values?.[0];
  const levels = [];
  for (const tags of directories) {
    const subfile = tags.get(TAG.subfileType)?.values?.[0] ?? 0;
    if (levels.length && !(subfile & 1)) continue; /* not an overview */
    const width = tags.get(TAG.width)?.values?.[0];
    const factor = levels.length ? Math.round(mainWidth / width) : 1;
    levels.push(levelFromTags(tags, range, { noDataValue, fallbackScale: pixelScale, fallbackOrigin: origin, factor }));
  }
  const level0 = levels[0];
  return Object.freeze({
    epsg,
    noData: noDataValue,
    originX: origin[0],
    originY: origin[1],
    pixelScaleX: pixelScale[0],
    pixelScaleY: pixelScale[1],
    width: level0.width,
    height: level0.height,
    tileWidth: level0.tileWidth,
    tileLength: level0.tileLength,
    tilesAcross: level0.tilesAcross,
    tilesDown: level0.tilesDown,
    bitsPerSample: level0.bitsPerSample,
    compression: level0.compression,
    predictor: level0.predictor,
    isFloat: level0.isFloat,
    levels: Object.freeze(levels),
    /** The overview whose pixel is `factor` times the base pixel, or null. */
    levelForFactor(factor) {
      return levels.find(level => level.factor === factor) || null;
    },
    pixelOf: (x, y) => level0.pixelOf(x, y),
    tile: (tileColumn, tileRow) => level0.tile(tileColumn, tileRow),
    sample: (column, row) => level0.sample(column, row),
    sampleSync: (column, row) => level0.sampleSync(column, row),
    get cachedTiles() { return level0.cachedTiles; },
  });
}

/**
 * An HTTP range function. `authorization` is sent as the Authorization
 * header and never logged; `transfer` counts requests and bytes.
 */
export function httpRange(url, { fetchImpl = globalThis.fetch, timeoutMs = 120_000, authorization = null, retries = 3 } = {}) {
  const transfer = { requests: 0, bytes: 0 };
  const range = async (offset, length) => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers = { Range: `bytes=${offset}-${offset + length - 1}` };
        if (authorization) headers.Authorization = authorization;
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status !== 206) throw new Error(`range request returned HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        transfer.requests++;
        transfer.bytes += buffer.length;
        return buffer;
      } catch (error) {
        lastError = error;
        if (/HTTP 4\d\d/.test(String(error?.message))) break;
      }
    }
    throw lastError;
  };
  range.transfer = transfer;
  return range;
}

/** Basic authorization header value from a username and password; the caller keeps them out of logs. */
export function basicAuthorization(username, password) {
  if (!username || !password) throw new Error('username and password are required');
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}
