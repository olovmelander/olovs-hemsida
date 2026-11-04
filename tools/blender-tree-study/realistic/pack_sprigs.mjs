/* The modelled sprigs' atlases (sprig_atlas.py's renders) for the realistic catalogue: per species
   <out>/<key>.png -- the colour, straight alpha, the colour bled into the clear texels so the mipmaps
   do not darken the edges -- and <out>/<key>-normal.png -- the card-frame normal in R and G, the light
   through in B, the coverage in A (clear texels flat and opaque to light) -- and <out>/atlas.json with
   their bytes, hashes and the colour's mean over the leaves. With --preview, <out>/preview.png: each
   species tinted and lit from the upper left by its normals, on the sky.

   node tools/blender-tree-study/realistic/pack_sprigs.mjs <renders> <out> [--preview]          */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodePNG, encodePNG } from '../../../geobuild/png.mjs';
import { encodeRGBA } from './make_leaf_atlas.mjs';
import { encodePNG as encodeFiltered } from './tree-png.mjs';

const [renders, out] = process.argv.slice(2);
const preview = process.argv.includes('--preview');
fs.mkdirSync(out, { recursive: true });
/* --keys kust: only those (Visby's coastal pine is packed on its own) */
const keysAt = process.argv.indexOf('--keys');
const KEYS = keysAt > 0 ? process.argv[keysAt + 1].split(',') : ['björk', 'ek', 'al', 'tall', 'gran'];
const sha = b => createHash('sha256').update(b).digest('hex');
/* The normals light a leaf; they do not outline it. A half-size atlas is 6 mm a texel on a 1.2 m sprig, finer than a
   pixel past 10 m, and a fifth of the bytes and a quarter of the memory. Nothing reads their alpha, so it goes. */
const half = (px, w, h) => { const W = w >> 1, H = h >> 1, o = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { for (let k = 0; k < 3; k++) {
    let s = 2; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += px[((y * 2 + dy) * w + x * 2 + dx) * 4 + k];
    o[(y * W + x) * 4 + k] = s >> 2; } o[(y * W + x) * 4 + 3] = 255; }
  return o; };
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/* colour into the clear texels: a few passes of the covered neighbours' mean, then the mean */
function bleed(px, w, h) {
  const have = new Uint8Array(w * h), mean = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 8) { have[i] = 1; for (let k = 0; k < 3; k++) mean[k] += px[i * 4 + k]; n++; }
  for (let k = 0; k < 3; k++) mean[k] /= Math.max(1, n);
  for (let pass = 0; pass < 16; pass++) {
    const next = have.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (have[i]) continue;
      const s = [0, 0, 0]; let m = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (!have[j]) continue;
        for (let k = 0; k < 3; k++) s[k] += px[j * 4 + k]; m++;
      }
      if (m) { for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(s[k] / m); next[i] = 1; }
    }
    have.set(next);
  }
  for (let i = 0; i < w * h; i++) if (!have[i]) for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(mean[k]);
}

const record = {}, previews = [];
const TINT = { björk: [0.42, 0.6, 0.22], ek: [0.26, 0.42, 0.15], al: [0.22, 0.38, 0.17], tall: [0.24, 0.36, 0.16], gran: [0.14, 0.27, 0.14] };
for (const key of KEYS) {
  const c = decodePNG(fs.readFileSync(path.join(renders, `${key}-colour.png`)));
  const nm = decodePNG(fs.readFileSync(path.join(renders, `${key}-normal.png`)));
  if (c.channels !== 4 || nm.channels !== 4 || c.width !== nm.width) throw new Error(`${key}: unexpected renders`);
  const W = c.width, H = c.height, colour = Uint8Array.from(c.data), normal = new Uint8Array(W * H * 4);
  /* the mean over the leaves (linear), as the material divides by it */
  const mean = [0, 0, 0]; let leaves = 0;
  for (let i = 0; i < W * H; i++) {
    const a = c.data[i * 4 + 3];
    normal[i * 4] = a ? nm.data[i * 4] : 128; normal[i * 4 + 1] = a ? nm.data[i * 4 + 1] : 128;
    normal[i * 4 + 2] = a ? nm.data[i * 4 + 2] : 0; normal[i * 4 + 3] = a;
    if (a > 200 && nm.data[i * 4 + 2] > 128) { for (let k = 0; k < 3; k++) mean[k] += lin(c.data[i * 4 + k]); leaves++; }
  }
  for (let k = 0; k < 3; k++) mean[k] /= Math.max(1, leaves);
  bleed(colour, W, H);
  const colourPng = encodeRGBA(W, H, colour), normalPng = encodeFiltered(W >> 1, H >> 1, half(normal, W, H), { opaque: true });
  fs.writeFileSync(path.join(out, `${key}.png`), colourPng);
  fs.writeFileSync(path.join(out, `${key}-normal.png`), normalPng);
  record[key] = { bytes: colourPng.length, sha256: sha(colourPng), mean: mean.map(v => +v.toFixed(4)),
    normal: { bytes: normalPng.length, sha256: sha(normalPng) } };
  if (preview) previews.push({ key, W, H, colour, normal, mean });
  console.log(key, record[key].mean, `${(colourPng.length / 1024).toFixed(0)} + ${(normalPng.length / 1024).toFixed(0)} kB`);
}
fs.writeFileSync(path.join(out, 'atlas.json'), JSON.stringify({ atlas: { size: 1024, cells: 2, modelled: 'sprig_atlas.py' }, species: record }, null, 2));

if (preview) {
  /* each atlas at half size, tinted, lit by its normals from the upper left and lit through from behind a little */
  const S = 512, o = new Uint8Array(S * previews.length * S * 3), WW = S * previews.length;
  const L = [-0.45, 0.55, 0.7], Ln = Math.hypot(...L);
  previews.forEach((p, n) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * 2 * p.W + x * 2) * 4, a = p.colour[i + 3] / 255;
      const nx = p.normal[i] / 127.5 - 1, ny = p.normal[i + 1] / 127.5 - 1, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lit = 0.35 + 0.75 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / Ln) + 0.15 * (p.normal[i + 2] / 255);
      for (let k = 0; k < 3; k++) {
        const v = lin(p.colour[i + k]) / p.mean[k] * TINT[p.key][k] * lit * 1.6, bg = [0.55, 0.7, 0.9][k];
        o[(y * WW + n * S + x) * 3 + k] = Math.round(Math.min(1, v * a + bg * (1 - a)) ** (1 / 2.2) * 255);
      }
    }
  });
  fs.writeFileSync(path.join(out, 'preview.png'), encodePNG(WW, S, o));
}
