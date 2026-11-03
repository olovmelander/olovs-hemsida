#!/usr/bin/env node
/* Publish the grass mat baked by grass_mat.py: its colour and height renders
   packed into one RGBA PNG (RGB the blades' colour, A their height), hash-named
   in apps/golf/public/models/props/ with its JSON record (the mean blade colour,
   linear, and how much of the mat stands over each share of its height), and
   the GRASS_MAT_ASSET constant in apps/golf/src/engine/grass-shells.mjs.
   usage: node tools/blender-props/publish-grass-mat.mjs <colour.png> <height.png> */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { decodePNG } from '../../geobuild/png.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodeRGBA(width, height, rgba) {
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const [colourPath, heightPath] = process.argv.slice(2);
const colour = decodePNG(fs.readFileSync(colourPath)), height = decodePNG(fs.readFileSync(heightPath));
const w = colour.width, h = colour.height, n = w * h, rgba = new Uint8Array(n * 4);
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const sum = [0, 0, 0], levels = [0.05, 0.25, 0.5, 0.75], over = levels.map(() => 0);
let blades = 0;
for (let i = 0; i < n; i++) {
  for (let c = 0; c < 3; c++) rgba[i * 4 + c] = colour.data[i * colour.channels + c];
  const a = height.data[i * height.channels];
  rgba[i * 4 + 3] = a;
  levels.forEach((t, k) => { if (a / 255 > t) over[k]++; });
  if (a / 255 > 0.05) { for (let c = 0; c < 3; c++) sum[c] += lin(colour.data[i * colour.channels + c]); blades++; }
}
const bytes = encodeRGBA(w, h, rgba), sha = createHash('sha256').update(bytes).digest('hex');
const dir = 'apps/golf/public/models/props', url = `models/props/grass-mat-${sha}.png`;
const old = fs.existsSync(`${dir}/grass-mat.json`) ? JSON.parse(fs.readFileSync(`${dir}/grass-mat.json`, 'utf8')) : null;
if (old && old.asset.sha256 !== sha && fs.existsSync(`apps/golf/public/${old.asset.url}`)) fs.rmSync(`apps/golf/public/${old.asset.url}`);
fs.writeFileSync(`apps/golf/public/${url}`, bytes);
const meanLinear = sum.map(v => +(v / Math.max(1, blades)).toFixed(5));
const cover = Object.fromEntries(levels.map((t, k) => [t, +(over[k] / n).toFixed(4)]));
fs.writeFileSync(`${dir}/grass-mat.json`, JSON.stringify({ schemaVersion: 1, kind: 'banvy-texture', id: 'grass-mat',
  asset: { url, sha256: sha, bytes: bytes.length }, layout: { width: w, height: h, metres: 1, channels: 'RGB colour, A height (0 bare, 1 the tallest tip)' },
  meanLinear, cover,
  source: 'tools/blender-props/grass_mat.py, Blender 5.2.2 LTS, Eevee, baked through the Blender MCP on 3 November 2026 (scene BanvyGrassMat)',
  notes: 'A tileable 1 x 1 m patch of curved blades seen straight down: colour by emission, height as an emission ramp.' }, null, 2) + '\n');
const mod = 'apps/golf/src/engine/grass-shells.mjs';
if (fs.existsSync(mod)) {
  let m = fs.readFileSync(mod, 'utf8');
  m = m.replace(/grass-mat-[0-9a-f]{64}\.png/, `grass-mat-${sha}.png`).replace(/(GRASS_MAT_ASSET[\s\S]*?sha256: ')[0-9a-f]{64}'/, `$1${sha}'`)
    .replace(/(GRASS_MAT_ASSET = Object\.freeze\(\{[\s\S]*?bytes: )\d+/, `$1${bytes.length}`)
    .replace(/(GRASS_MAT_ASSET[\s\S]*?meanLinear: Object\.freeze\(\[)[^\]]*\]/, `$1${meanLinear.join(', ')}]`);
  fs.writeFileSync(mod, m);
}
console.log(JSON.stringify({ sha: sha.slice(0, 12), bytes: bytes.length, meanLinear, cover }));
