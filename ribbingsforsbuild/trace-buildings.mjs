#!/usr/bin/env node
/* Roofs read off the z18 orthoimagery, by rule, where OSM has no footprints.

   Skagersvik and the Ribbingsfors manor are almost unmapped in OSM: the model
   had one PROVISIONAL clubhouse rectangle (a POI plus a generic form, 25 m
   south of the building it stands for) and three yard sheds traced by eye
   10–20 m off. This finds roofs the way the tree-cover classifier finds mown
   turf — by colour AND smoothness: a roof is low in excess green, mid-tone,
   and SMOOTH at metre scale, where a leaf-off crown is low in excess green
   and violently textured, and gravel is pale. Components are fitted with an
   oriented box (PCA axes, 2–98 percentile extents) and kept where they fill
   their box (a roof is a rectangle; a hardstanding is not) and are 25–900 m².

   Two windows: the manor / clubhouse / parking block, and the greenkeeping
   yard. Output is a candidate list with a review sheet; the accepted ids are
   written by hand into surroundings-traces.json → features.buildings (the
   review is the gate that has eyes), and apply-surroundings.mjs emits them.

     node ribbingsforsbuild/trace-buildings.mjs   -> cache/building-candidates.json + cache/review/buildings-*.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMosaic, excessGreen, brightness } from './imagery.mjs';
import { gridOver, labelComponents, open, close } from './raster-shapes.mjs';
import { encodePNG } from '../geobuild/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const WINDOWS = [
  { name: 'manor', x0: 380, x1: 780, z0: -720, z1: -380 },
  { name: 'yard', x0: -430, x1: -270, z0: 90, z1: 290 },
];
const S = 0.5;                       /* raster spacing, metres */
/* two roof classes: mid-tone (tile, sheet) and DARK (tarred felt, slate, shadowed north pitches); texture: std of brightness over (2r+1)² samples at 0.5 m */
const ROOF = { exgMax: 18, bright: [55, 215], textureMax: 11, texR: 3, dark: { bright: [18, 60], textureMax: 9 } };
const KEEP = { areaMin: 25, areaMax: 900, fill: 0.68, aspectMax: 6 };

function orientedBox(pts) {
  const n = pts.length, cx = pts.reduce((a, p) => a + p[0], 0) / n, cz = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of pts) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  const a = pts.map(([x, z]) => (x - cx) * ux + (z - cz) * uz).sort((p, q) => p - q), b = pts.map(([x, z]) => -(x - cx) * uz + (z - cz) * ux).sort((p, q) => p - q);
  const pct = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  const a0 = pct(a, 0.02), a1 = pct(a, 0.98), b0 = pct(b, 0.02), b1 = pct(b, 0.98);
  const mid = [cx + ux * (a0 + a1) / 2 - uz * (b0 + b1) / 2, cz + uz * (a0 + a1) / 2 + ux * (b0 + b1) / 2];
  return { c: mid.map(v => +v.toFixed(1)), w: +(a1 - a0 + S).toFixed(1), d: +(b1 - b0 + S).toFixed(1), rot: +ang.toFixed(3), ux, uz };
}
const rect = ({ c, w, d, rot }) => { const ux = Math.cos(rot), uz = Math.sin(rot); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [c[0] + ux * p * w / 2 - uz * q * d / 2, c[1] + uz * p * w / 2 + ux * q * d / 2]); };

const candidates = [];
for (const win of WINDOWS) {
  const IMG = await loadMosaic(win, { zoom: 18, name: win.name });
  const G = gridOver(win, S, 0);
  const eg = new Float32Array(G.width * G.height), br = new Float32Array(G.width * G.height);
  for (let i = 0; i < eg.length; i++) { const p = IMG.rgbAt(...G.centre(i)); eg[i] = p ? excessGreen(p) : NaN; br[i] = p ? brightness(p) : NaN; }
  const tex = new Float32Array(eg.length);
  const r = ROOF.texR;
  for (let row = 0; row < G.height; row++) for (let col = 0; col < G.width; col++) {
    let s = 0, s2 = 0, n = 0;
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) { const rr = row + dr, cc = col + dc; if (rr < 0 || cc < 0 || rr >= G.height || cc >= G.width) continue; const v = br[rr * G.width + cc]; if (Number.isFinite(v)) { s += v; s2 += v * v; n++; } }
    tex[row * G.width + col] = n ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : 99;
  }
  const mask = new Uint8Array(eg.length);
  for (let i = 0; i < mask.length; i++) if (eg[i] <= ROOF.exgMax && ((br[i] >= ROOF.bright[0] && br[i] <= ROOF.bright[1] && tex[i] <= ROOF.textureMax) || (br[i] >= ROOF.dark.bright[0] && br[i] <= ROOF.dark.bright[1] && tex[i] <= ROOF.dark.textureMax))) mask[i] = 1;
  const cleaned = close(open(mask, G.width, G.height, 1), G.width, G.height, 1);
  const { label, sizes } = labelComponents(cleaned, G.width, G.height);
  const cells = new Map();
  for (let i = 0; i < label.length; i++) { const id = label[i]; if (!id) continue; const area = sizes[id] * S * S; if (area < KEEP.areaMin || area > KEEP.areaMax * 1.5) continue; let list = cells.get(id); if (!list) { list = []; cells.set(id, list); } list.push(G.centre(i)); }
  for (const [id, pts] of cells) {
    const box = orientedBox(pts), area = pts.length * S * S, boxArea = box.w * box.d, fill = area / boxArea, aspect = Math.max(box.w, box.d) / Math.min(box.w, box.d);
    let sb = 0, se = 0; for (const p of pts) { const q = IMG.rgbAt(...p); sb += brightness(q); se += excessGreen(q); }
    const cand = { id: `${win.name}-${candidates.filter(c => c.window === win.name).length}`, window: win.name, c: box.c, w: box.w, d: box.d, rot: box.rot, area: Math.round(area), fill: +fill.toFixed(2), aspect: +aspect.toFixed(1), brightness: Math.round(sb / pts.length), exg: Math.round(se / pts.length),
      accepted: area >= KEEP.areaMin && area <= KEEP.areaMax && fill >= KEEP.fill && aspect <= KEEP.aspectMax };
    candidates.push(cand);
  }
  /* review sheet: imagery, accepted boxes green, refused red, model buildings magenta */
  const scale = 3, W = Math.round((win.x1 - win.x0) * scale), H = Math.round((win.z1 - win.z0) * scale);
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = IMG.rgbAt(win.x0 + x / scale, win.z0 + y / scale) || [0, 0, 0]; const o = (y * W + x) * 3; rgb[o] = p[0]; rgb[o + 1] = p[1]; rgb[o + 2] = p[2]; }
  const put = (X, Y, c) => { if (X < 0 || Y < 0 || X >= W || Y >= H) return; const o = (Y * W + X) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; };
  const poly = (ring, c) => { for (let i = 0; i < ring.length; i++) { const P = ring[i], Q = ring[(i + 1) % ring.length]; const n = Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1]) * scale) + 1; for (let s = 0; s <= n; s++) put(Math.round((P[0] + (Q[0] - P[0]) * s / n - win.x0) * scale), Math.round((P[1] + (Q[1] - P[1]) * s / n - win.z0) * scale), c); } };
  for (const cand of candidates.filter(c => c.window === win.name)) poly(rect(cand), cand.accepted ? [0, 255, 0] : [255, 0, 0]);
  for (const b of model.infra.buildings) poly(b.ring, [255, 0, 255]);
  for (const p of model.infra.parking) poly(p.ring, [255, 160, 0]);
  /* 50 m grid ticks along the edges */
  for (let x = Math.ceil(win.x0 / 50) * 50; x <= win.x1; x += 50) for (let y = 0; y < H; y += 4) put(Math.round((x - win.x0) * scale), y, [255, 255, 0]);
  for (let z = Math.ceil(win.z0 / 50) * 50; z <= win.z1; z += 50) for (let x = 0; x < W; x += 4) put(x, Math.round((z - win.z0) * scale), [255, 255, 0]);
  fs.mkdirSync(path.join(HERE, 'cache', 'review'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'cache', 'review', `buildings-${win.name}.png`), encodePNG(W, H, rgb));
  console.log(`${win.name}: ${candidates.filter(c => c.window === win.name).length} roof-like components, ${candidates.filter(c => c.window === win.name && c.accepted).length} accepted by rule`);
}
for (const c of candidates) console.log(`  ${c.id} ${c.accepted ? 'OK ' : '-- '} c ${c.c} ${c.w}x${c.d} m rot ${(c.rot * 180 / Math.PI).toFixed(0)}° area ${c.area} fill ${c.fill} aspect ${c.aspect} bright ${c.brightness} exg ${c.exg}`);
fs.writeFileSync(path.join(HERE, 'cache', 'building-candidates.json'), JSON.stringify({ rule: { roof: ROOF, keep: KEEP, spacing: S }, candidates }, null, 1));
