/* The retained 4-band review windows (north.tif / south.tif: RGBI uint8, tiled,
   deflate, written by rasterio from the 0.16 m national orthophoto at 0.32 m)
   read in plain Node. The repo's COG reader is single-band by design; this is
   the four-band, whole-file case, and it exists for one reason: the NEAR
   INFRARED band, which no PNG here carries and which separates living turf
   from dormant meadow far better than any visible-band index. */
import fs from 'node:fs';
import zlib from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

function readValues(buf, type, count, offset, le) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * TYPE_SIZE[type];
    if (type === 1 || type === 7) out.push(buf[o]);
    else if (type === 3) out.push(le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    else if (type === 4) out.push(le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    else if (type === 16) out.push(Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o)));
    else if (type === 12) out.push(le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
    else if (type === 2) out.push(String.fromCharCode(buf[o]));
    else out.push(null);
  }
  return out;
}

/** Decode one RGBI window file into { width, height, bands: 4, data: Uint8Array (interleaved), boundsEpsg3006, metres }. */
export function readRgbiTiff(file) {
  const buf = fs.readFileSync(file);
  const le = buf.toString('latin1', 0, 2) === 'II';
  const magic = le ? buf.readUInt16LE(2) : buf.readUInt16BE(2);
  const big = magic === 43;
  let ifd = big ? Number(le ? buf.readBigUInt64LE(8) : buf.readBigUInt64BE(8)) : (le ? buf.readUInt32LE(4) : buf.readUInt32BE(4));
  const count = big ? Number(le ? buf.readBigUInt64LE(ifd) : buf.readBigUInt64BE(ifd)) : (le ? buf.readUInt16LE(ifd) : buf.readUInt16BE(ifd));
  const entrySize = big ? 20 : 12;
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = ifd + (big ? 8 : 2) + i * entrySize;
    const tag = le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const type = le ? buf.readUInt16LE(o + 2) : buf.readUInt16BE(o + 2);
    const n = big ? Number(le ? buf.readBigUInt64LE(o + 4) : buf.readBigUInt64BE(o + 4)) : (le ? buf.readUInt32LE(o + 4) : buf.readUInt32BE(o + 4));
    const size = n * TYPE_SIZE[type];
    const valueOffset = big ? o + 12 : o + 8;
    const inline = size <= (big ? 8 : 4);
    const dataOffset = inline ? valueOffset : (big ? Number(le ? buf.readBigUInt64LE(valueOffset) : buf.readBigUInt64BE(valueOffset)) : (le ? buf.readUInt32LE(valueOffset) : buf.readUInt32BE(valueOffset)));
    tags.set(tag, readValues(buf, type, n, dataOffset, le));
  }
  const get = (t, d = null) => tags.get(t)?.[0] ?? d;
  const width = get(256), height = get(257), bits = get(258), compression = get(259, 1), spp = get(277, 1), planar = get(284, 1), predictor = get(317, 1);
  const tileWidth = get(322), tileLength = get(323);
  if (bits !== 8 || spp !== 4 || planar !== 1 || !tileWidth) throw new Error(`expected a tiled interleaved 8-bit 4-band TIFF; got bits ${bits} spp ${spp} planar ${planar} tiled ${!!tileWidth}`);
  if (![1, 8, 32946].includes(compression)) throw new Error(`unsupported compression ${compression}`);
  if (![1, 2].includes(predictor)) throw new Error(`unsupported predictor ${predictor}`);
  const offsets = tags.get(324), counts = tags.get(325);
  const scale = tags.get(33550) || [], tiepoint = tags.get(33922) || [];
  const metres = scale[0], originX = tiepoint[3], originY = tiepoint[4];
  const data = new Uint8Array(width * height * 4);
  const across = Math.ceil(width / tileWidth), down = Math.ceil(height / tileLength);
  for (let tr = 0; tr < down; tr++) for (let tc = 0; tc < across; tc++) {
    const index = tr * across + tc;
    if (!counts[index]) continue;
    const raw = buf.subarray(offsets[index], offsets[index] + counts[index]);
    let bytes = compression === 1 ? Buffer.from(raw) : zlib.inflateSync(raw);
    if (bytes.length !== tileWidth * tileLength * 4) throw new Error(`tile ${index} decoded to ${bytes.length} bytes`);
    if (predictor === 2) for (let row = 0; row < tileLength; row++) { const base = row * tileWidth * 4; for (let k = 4; k < tileWidth * 4; k++) bytes[base + k] = (bytes[base + k] + bytes[base + k - 4]) & 0xff; }
    for (let row = 0; row < tileLength; row++) {
      const y = tr * tileLength + row; if (y >= height) break;
      const w = Math.min(tileWidth, width - tc * tileWidth);
      data.set(bytes.subarray(row * tileWidth * 4, row * tileWidth * 4 + w * 4), (y * width + tc * tileWidth) * 4);
    }
  }
  return { width, height, bands: 4, data, metres, boundsEpsg3006: [originX, originY - height * metres, originX + width * metres, originY] };
}

/** Both review windows as one (E, N) -> [r, g, b, nir] accessor. */
export function loadRgbiMosaic(files) {
  const windows = files.map(readRgbiTiff);
  const at = (e, n) => {
    for (const w of windows) {
      const [e0, n0, e1, n1] = w.boundsEpsg3006;
      if (e < e0 || e >= e1 || n <= n0 || n > n1) continue;
      const px = Math.floor((e - e0) / w.metres), py = Math.floor((n1 - n) / w.metres);
      const o = (py * w.width + px) * 4;
      return [w.data[o], w.data[o + 1], w.data[o + 2], w.data[o + 3]];
    }
    return null;
  };
  return { windows, at };
}
export const ndvi = ([r, , , nir]) => (nir - r) / Math.max(1, nir + r);
