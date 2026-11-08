/* Lantmäteriet RGBI orthophoto COGs, read tile by tile in Node (from the
   Johannesberg pilot's ortho-store.mjs, unchanged in behaviour).

   The 0.16 m items are classic little-endian tiled TIFFs: 15,625 px square,
   512 px tiles, four 8-bit samples per pixel interleaved (PlanarConfiguration
   1), deflate with the horizontal-differencing predictor. Photometric RGB with
   one unspecified extra sample: the band order is red, green, blue and the
   fourth band is near infrared, NOT alpha -- confirmed from the tags and the
   GDAL metadata of every item read, never assumed.

   A local "pack" holds the compressed bytes of the tiles a window needs,
   exactly as served, with an index of offsets and per-tile SHA-256; decoding
   happens on read. Raw pixels stay in the ignored cache; only hashes and
   coverage go into committed evidence.                                       */
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8, 16: 8 };

function readValue(buffer, type, offset) {
  if (type === 1 || type === 7 || type === 2) return buffer[offset];
  if (type === 3) return buffer.readUInt16LE(offset);
  if (type === 4) return buffer.readUInt32LE(offset);
  if (type === 5) return buffer.readUInt32LE(offset) / buffer.readUInt32LE(offset + 4);
  if (type === 12) return buffer.readDoubleLE(offset);
  if (type === 16) return Number(buffer.readBigUInt64LE(offset));
  throw new Error(`unsupported TIFF field type ${type}`);
}

/** The first IFD of a classic TIFF, with every value resolved inside `head`. */
export function parseFirstIfd(head) {
  if (head.toString('latin1', 0, 2) !== 'II' || head.readUInt16LE(2) !== 42) throw new Error('expected a classic little-endian TIFF');
  const ifd = head.readUInt32LE(4);
  const count = head.readUInt16LE(ifd);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    const tag = head.readUInt16LE(o);
    const type = head.readUInt16LE(o + 2);
    const n = head.readUInt32LE(o + 4);
    const size = TYPE_SIZE[type] * n;
    const at = size <= 4 ? o + 8 : head.readUInt32LE(o + 8);
    if (at + size > head.length) throw new Error(`TIFF tag ${tag} lies outside the header window`);
    const values = type === 2 ? head.toString('latin1', at, at + n).replace(/\0+$/, '') : Array.from({ length: n }, (_, k) => readValue(head, type, at + k * TYPE_SIZE[type]));
    tags.set(tag, values);
  }
  return tags;
}

/** Layout, georeferencing and band identity of an RGBI orthophoto item. */
export function orthoLayout(head) {
  const tags = parseFirstIfd(head);
  const get = tag => tags.get(tag);
  const one = tag => (Array.isArray(get(tag)) ? get(tag)[0] : get(tag));
  const layout = {
    width: one(256),
    height: one(257),
    bitsPerSample: get(258),
    compression: one(259),
    photometric: one(262),
    samplesPerPixel: one(277),
    planarConfiguration: one(284) ?? 1,
    predictor: one(317) ?? 1,
    tileWidth: one(322),
    tileLength: one(323),
    tileOffsets: get(324),
    tileByteCounts: get(325),
    extraSamples: get(338) ?? [],
    sampleFormat: get(339) ?? [1],
    pixelScale: get(33550),
    tiepoint: get(33922),
    description: get(270) ?? null,
    software: get(305) ?? null,
    gdalMetadata: get(42112) ?? null,
    gdalNoData: get(42113) ?? null,
  };
  const problems = [];
  if (layout.samplesPerPixel !== 4) problems.push(`expected 4 samples, found ${layout.samplesPerPixel}`);
  if (layout.bitsPerSample.some(bits => bits !== 8)) problems.push('expected 8-bit samples');
  if (layout.planarConfiguration !== 1) problems.push('expected pixel-interleaved samples');
  if (layout.photometric !== 2) problems.push('expected photometric RGB');
  if (layout.extraSamples.length !== 1 || layout.extraSamples[0] !== 0) problems.push('expected one unspecified (non-alpha) extra sample');
  if (![1, 8, 32946].includes(layout.compression)) problems.push(`unsupported compression ${layout.compression}`);
  if (![1, 2].includes(layout.predictor)) problems.push(`unsupported predictor ${layout.predictor}`);
  if (!layout.pixelScale || !layout.tiepoint) problems.push('no GeoTIFF pixel scale / tiepoint');
  if (problems.length) throw new Error(`orthophoto layout rejected: ${problems.join('; ')}`);
  const [, , , originEasting, originNorthing] = layout.tiepoint;
  return Object.freeze({
    ...layout,
    tilesAcross: Math.ceil(layout.width / layout.tileWidth),
    tilesDown: Math.ceil(layout.height / layout.tileLength),
    originEasting,
    originNorthing,
    pixelMetres: layout.pixelScale[0],
    /* photometric RGB + one unspecified extra sample */
    bands: Object.freeze(['red', 'green', 'blue', 'near-infrared']),
  });
}

/** Tile indices (row-major) a projected window touches. */
export function tilesForWindow(layout, bbox) {
  const [minE, minN, maxE, maxN] = bbox;
  const c0 = Math.max(0, Math.floor((minE - layout.originEasting) / layout.pixelMetres / layout.tileWidth));
  const c1 = Math.min(layout.tilesAcross - 1, Math.floor((maxE - layout.originEasting) / layout.pixelMetres / layout.tileWidth));
  const r0 = Math.max(0, Math.floor((layout.originNorthing - maxN) / layout.pixelMetres / layout.tileLength));
  const r1 = Math.min(layout.tilesDown - 1, Math.floor((layout.originNorthing - minN) / layout.pixelMetres / layout.tileLength));
  const out = [];
  if (c1 < c0 || r1 < r0) return out;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * layout.tilesAcross + c);
  return out;
}

/** Undo deflate + horizontal differencing over interleaved 8-bit samples. */
export function decodeTile(layout, compressed) {
  let bytes = layout.compression === 1 ? Buffer.from(compressed) : zlib.inflateSync(compressed);
  const { tileWidth, tileLength, samplesPerPixel: s } = layout;
  if (bytes.length !== tileWidth * tileLength * s) throw new Error(`tile decoded to ${bytes.length} bytes`);
  if (layout.predictor === 2) {
    bytes = Buffer.from(bytes);
    const stride = tileWidth * s;
    for (let row = 0; row < tileLength; row++) {
      const base = row * stride;
      for (let i = s; i < stride; i++) bytes[base + i] = (bytes[base + i] + bytes[base + i - s]) & 0xff;
    }
  }
  return bytes;
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Open a local pack written by fetch-ortho.mjs. */
export function openPack(indexPath) {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const packPath = indexPath.replace(/\.index\.json$/, '.pack');
  const fd = fs.openSync(packPath, 'r');
  const layout = Object.freeze({ ...index.layout, tileOffsets: null, tileByteCounts: null });
  const entries = new Map(index.tiles.map(tile => [tile.tile, tile]));
  const cache = new Map();
  const readTile = tile => {
    if (cache.has(tile)) return cache.get(tile);
    const entry = entries.get(tile);
    if (!entry) return null;
    const buffer = Buffer.alloc(entry.length);
    fs.readSync(fd, buffer, 0, entry.length, entry.packOffset);
    const decoded = decodeTile(layout, buffer);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(tile, decoded);
    return decoded;
  };
  /** RGBI of one pixel of this item, or null outside the cached tiles. */
  const pixel = (column, row) => {
    if (column < 0 || row < 0 || column >= layout.width || row >= layout.height) return null;
    const tile = Math.floor(row / layout.tileLength) * layout.tilesAcross + Math.floor(column / layout.tileWidth);
    const data = readTile(tile);
    if (!data) return null;
    const o = ((row % layout.tileLength) * layout.tileWidth + (column % layout.tileWidth)) * 4;
    return data.subarray(o, o + 4);
  };
  return Object.freeze({ index, layout, readTile, pixel, close: () => fs.closeSync(fd) });
}

/**
 * Read a north-up RGBI window at the native 0.16 m lattice (or an integer
 * multiple, block-averaged) from several packs; the first pack holding a pixel
 * wins. Returns { width, height, minEasting, maxNorthing, pixelMetres, data }
 * with data as Uint8Array RGBI, 0 alpha-free; `valid` marks covered pixels.
 */
export function readMosaic(packs, bbox, { factor = 1 } = {}) {
  const base = packs[0].layout;
  const p = base.pixelMetres;
  const step = p * factor;
  /* snap to the shared 0.16 m lattice of the 2.5 km items */
  const minE = base.originEasting + Math.floor((bbox[0] - base.originEasting) / step) * step;
  const maxN = base.originNorthing - Math.floor((base.originNorthing - bbox[3]) / step) * step;
  const width = Math.ceil((bbox[2] - minE) / step);
  const height = Math.ceil((maxN - bbox[1]) / step);
  const data = new Uint8Array(width * height * 4);
  const valid = new Uint8Array(width * height);
  const sums = new Uint32Array(4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      sums.fill(0);
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const e = minE + (column * factor + dx + 0.5) * p;
          const nn = maxN - (row * factor + dy + 0.5) * p;
          for (const pack of packs) {
            const l = pack.layout;
            const c = Math.floor((e - l.originEasting) / p);
            const r = Math.floor((l.originNorthing - nn) / p);
            const value = pack.pixel(c, r);
            if (!value) continue;
            sums[0] += value[0]; sums[1] += value[1]; sums[2] += value[2]; sums[3] += value[3];
            n++;
            break;
          }
        }
      }
      if (!n) continue;
      const o = (row * width + column) * 4;
      data[o] = Math.round(sums[0] / n); data[o + 1] = Math.round(sums[1] / n);
      data[o + 2] = Math.round(sums[2] / n); data[o + 3] = Math.round(sums[3] / n);
      valid[row * width + column] = 1;
    }
  }
  return { width, height, minEasting: minE, maxNorthing: maxN, pixelMetres: step, data, valid };
}
