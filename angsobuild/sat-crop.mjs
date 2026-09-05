/* A crop of the cached z18 imagery about a point, with the model drawn on it,
   for the eyeball -- straight from the PNG tile cache, no browser.
     node angsobuild/sat-crop.mjs <name> <cx> <cz> <half-size m> [--release 27982] [--scale 3] [--plain]
   Draws hole lines (white), greens (green), fairways (pale), tee pads (blue),
   model bunkers (yellow: osm, orange: sat) and, if angsobuild/dtm-features.json
   exists, its measured bunkers (magenta) and the imagery offset as a red bar. */
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, CACHE } from './lib.mjs';
import { imagery } from './dtm.mjs';
import { encodePNG } from '../geobuild/png.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [name, cx, cz, half] = [args[0], +args[1], +args[2], +args[3]];
const release = flag('release', null) ? +flag('release') : null, scale = +flag('scale', 3), plain = args.includes('--plain');
const I = imagery(release);
const mpp = I.metresPerPixel / scale;
const W = Math.round(2 * half / mpp), H = W;
const rgb = new Uint8Array(W * H * 3);
const toPx = (x, z) => [Math.round((x - (cx - half)) / mpp), Math.round((z - (cz - half)) / mpp)];
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { const c = I.rgbAt(cx - half + px * mpp, cz - half + py * mpp) || [0, 0, 0]; const i = (py * W + px) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; }
const dot = (x, z, col) => { const [px, py] = toPx(x, z); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = (Y * W + X) * 3; rgb[i] = col[0]; rgb[i + 1] = col[1]; rgb[i + 2] = col[2]; } };
const seg = (a, b, col) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (mpp * 0.7)) + 1; for (let k = 0; k <= n; k++) dot(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, col); };
const poly = (r, col, closed = true) => { for (let i = 0; i < r.length - (closed ? 0 : 1); i++) seg(r[i], r[(i + 1) % r.length], col); };
if (!plain) {
  const m = readJSON(path.join(HERE, 'course-model.json'));
  for (const h of m.holes) {
    poly(h.line, [255, 255, 255], false);
    for (const r of h.fairway.rings) poly(r, [200, 220, 200]);
    poly(h.green.ring, [0, 255, 0]);
    for (const p of h.tees.pads) poly(p.ring, [80, 160, 255]);
    for (const b of h.bunkers) poly(b.ring, b.prov === 'osm' ? [255, 255, 0] : [255, 140, 0]);
  }
  for (const w of m.water) if (!w.isLake) poly(w.ring, [60, 120, 255]);
  const df = path.join(HERE, 'dtm-features.json');
  if (fs.existsSync(df)) {
    const d = readJSON(df);
    for (const b of d.bunkers) if (b.src !== 'osm') poly(b.ring, [255, 0, 255]);
    if (d.imagery?.offset) seg([cx - half + 5 * mpp, cz - half + 5 * mpp], [cx - half + 5 * mpp + d.imagery.offset.x, cz - half + 5 * mpp + d.imagery.offset.z], [255, 0, 0]);
  }
}
/* a 10 m scale bar, bottom left */
seg([cx - half + 3, cz + half - 3], [cx - half + 13, cz + half - 3], [255, 255, 255]);
const out = path.join(CACHE, 'crops'); fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `${name}${release ? '-' + release : ''}.png`);
fs.writeFileSync(file, encodePNG(W, H, rgb));
console.log(`wrote ${file} (${W}x${H}, ${mpp.toFixed(3)} m/px)`);
