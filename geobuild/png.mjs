/* Minimal PNG reader: 8-bit RGB/RGBA, non-interlaced. That is exactly what the
   Terrarium elevation tiles are, and it keeps the pipeline dependency-free.
   Anything else fails loudly rather than returning plausible garbage.            */
import zlib from 'node:zlib';

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    throw new Error('png: not a PNG');
  let p = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`png: bit depth ${depth} unsupported`);
  if (ctype !== 2 && ctype !== 6) throw new Error(`png: colour type ${ctype} unsupported`);
  if (interlace !== 0) throw new Error('png: interlaced unsupported');

  const ch = ctype === 6 ? 4 : 3;
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    line.copy(cur);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      switch (filter) {
        case 0: break;
        case 1: cur[i] = (cur[i] + a) & 255; break;
        case 2: cur[i] = (cur[i] + b) & 255; break;
        case 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 255; break;
        case 4: {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
        default: throw new Error(`png: filter ${filter} at row ${y}`);
      }
    }
    prev = cur;
  }
  return { width, height, channels: ch, data: out };
}

/* Write an 8-bit RGB PNG. Used for the design drawing's hillshade, which is a raster
   and would be a hundred thousand SVG rectangles otherwise. */
export function encodePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                              // filter: none
    rgb.copy ? rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
             : Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

/* Terrarium: h = R*256 + G + B/256 - 32768 */
export function terrariumHeights(buf) {
  const { width, height, channels, data } = decodePNG(buf);
  const h = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    h[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
  }
  return { width, height, h };
}
