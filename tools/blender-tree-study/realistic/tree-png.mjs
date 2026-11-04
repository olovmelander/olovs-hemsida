/* The realistic catalogues' PNG writer: lossless, with PNG's own per-row filters. The atlases were first written with
   filter 0 on every row, which leaves deflate to find the pattern in raw pixels; a leaf atlas predicted from its
   neighbours is a third smaller, the same pixels. `opaque` drops the alpha of an atlas that does not read it. */
import zlib from 'node:zlib';

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
const FILTERS = [
  (x, a, b, c) => x,
  (x, a, b, c) => x - a,
  (x, a, b, c) => x - b,
  (x, a, b, c) => x - ((a + b) >> 1),
  (x, a, b, c) => x - paeth(a, b, c),
];

const crcTable = Int32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };

/** px: RGBA, w x h. Each row takes the filter whose residuals are smallest, the standard heuristic. */
export function encodePNG(w, h, px, { opaque = false } = {}) {
  const channels = opaque ? 3 : 4, stride = w * channels, row = new Uint8Array(stride), prev = new Uint8Array(stride), best = new Uint8Array(stride), trial = new Uint8Array(stride);
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let k = 0; k < channels; k++) row[x * channels + k] = px[(y * w + x) * 4 + k];
    let score = Infinity, pick = 0;
    for (let f = 0; f < FILTERS.length; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
        const v = FILTERS[f](row[i], a, b, c) & 255;
        trial[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < score) { score = sum; pick = f; best.set(trial); }
    }
    raw[y * (stride + 1)] = pick; raw.set(best, y * (stride + 1) + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
