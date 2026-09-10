/* A PNG codec in plain Node, because this machine has no Python and no image
   library, and the imagery tools here must read pixels without a browser
   round-trip. Decodes 8-bit greyscale, RGB, RGBA and grey+alpha, non-
   interlaced (what Chrome's canvas and every tool here writes); encodes RGB or
   RGBA. Filters per the PNG spec (none/sub/up/average/paeth). */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  return table;
})();
const crc32 = (bytes) => { let c = -1; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/** @returns {{width:number,height:number,channels:number,data:Uint8Array}} data is row-major, `channels` bytes per pixel */
export function decodePng(buffer) {
  if (!SIGNATURE.equals(buffer.subarray(0, 8))) throw new Error('not a PNG');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat = [];
  let palette = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colourType = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} not supported`);
  if (interlace) throw new Error('interlaced PNG not supported');
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colourType];
  if (!channels) throw new Error(`PNG colour type ${colourType} not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * (colourType === 3 ? 3 : channels));
  const line = new Uint8Array(stride), prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`PNG filter ${filter}`);
      }
      line[i] = v & 0xff;
    }
    if (colourType === 3) {
      for (let x = 0; x < width; x++) { const idx = line[x] * 3; out.set(palette.subarray(idx, idx + 3), (y * width + x) * 3); }
    } else out.set(line, y * stride);
    prev.set(line);
  }
  return { width, height, channels: colourType === 3 ? 3 : channels, data: out };
}

/** RGB (channels 3) or RGBA (4) bytes -> PNG buffer. Filter 0 everywhere; deflate does the rest. */
export function encodePng({ width, height, channels, data }) {
  if (![1, 3, 4].includes(channels)) throw new Error('encodePng wants 1, 3 or 4 channels');
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A drawable RGB canvas with the few primitives review images need. */
export class Canvas {
  constructor(width, height, fill = [0, 0, 0]) {
    this.width = width; this.height = height; this.channels = 3;
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.data.set(fill, i * 3);
  }
  static fromImage(image) {
    const c = new Canvas(image.width, image.height);
    if (image.channels === 3) c.data.set(image.data);
    else for (let i = 0; i < image.width * image.height; i++) {
      const s = i * image.channels;
      if (image.channels === 1) c.data.set([image.data[s], image.data[s], image.data[s]], i * 3);
      else if (image.channels === 2) c.data.set([image.data[s], image.data[s], image.data[s]], i * 3);
      else c.data.set(image.data.subarray(s, s + 3), i * 3);
    }
    return c;
  }
  blend(x, y, rgb, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 3;
    for (let k = 0; k < 3; k++) this.data[o + k] = Math.round(this.data[o + k] * (1 - alpha) + rgb[k] * alpha);
  }
  line(x0, y0, x1, y1, rgb, alpha = 1, width = 1) {
    const dx = x1 - x0, dy = y1 - y0, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const r = (width - 1) / 2;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + dx * s / steps, y = y0 + dy * s / steps;
      if (width <= 1) this.blend(x, y, rgb, alpha);
      else for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) this.blend(x + ox, y + oy, rgb, alpha);
    }
  }
  polyline(points, rgb, alpha = 1, close = false, width = 1) {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], rgb, alpha, width);
    if (close && points.length > 2) this.line(points.at(-1)[0], points.at(-1)[1], points[0][0], points[0][1], rgb, alpha, width);
  }
  cross(x, y, rgb, size = 4, alpha = 1) {
    this.line(x - size, y, x + size, y, rgb, alpha); this.line(x, y - size, x, y + size, rgb, alpha);
  }
  toPng() { return encodePng(this); }
}
