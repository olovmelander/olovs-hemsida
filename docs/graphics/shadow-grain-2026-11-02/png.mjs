// A minimal RGBA PNG writer for check-isolated.mjs: linear 8-bit read-backs,
// encoded to sRGB for viewing, side by side, with an enlarged crop beneath.
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const toSrgb = v => { const c = v / 255; return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); };

export function encode(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const PNG = {
  /** images: linear RGBA arrays (w x h); flipY for WebGL's bottom-up rows */
  sideBySide(images, w, h, { crop, flipY = false }) {
    const s = crop.scale, cw = crop.w * s, ch = crop.h * s;
    const W = Math.max(images.length * w, images.length * cw), H = h + 4 + ch;
    const out = new Uint8Array(W * H * 4);
    const at = (img, x, y) => 4 * ((flipY ? h - 1 - y : y) * w + x);
    images.forEach((img, k) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = at(img, x, y), o = 4 * (y * W + k * w + x);
        for (let c = 0; c < 3; c++) out[o + c] = toSrgb(img[i + c]); out[o + 3] = 255;
      }
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = at(img, crop.x + Math.floor(x / s), crop.y + Math.floor(y / s)), o = 4 * ((h + 4 + y) * W + k * cw + x);
        for (let c = 0; c < 3; c++) out[o + c] = toSrgb(img[i + c]); out[o + 3] = 255;
      }
    });
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return encode(out, W, H);
  },
};
