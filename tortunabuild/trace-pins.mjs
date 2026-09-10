#!/usr/bin/env node
/* Where the flag stood on 2026-05-02, read off the orthophoto green by green.

   The model's pin has been the green's centroid ("virtual green target"). At
   0.16 m a flagstick is a dark speck of a few pixels with a thin shadow, and
   on a fresh-cut May green it is the ONLY compact dark thing inside the
   putting surface -- a green has no rocks, no leaves, no bunker edge inside
   its ring. So the rule is: inside the green ring, eroded by 1.5 m so the
   collar's shade never counts, take the 0.16 m samples darker than the
   green's own median by a margin, keep the compact blobs of 3-40 samples
   whose bounding box is under 1.6 m, and adopt a hole's pin only when ONE
   blob is clearly darkest -- a second blob within 10 brightness of the first
   (a sprinkler head, a golfer, two ball marks) refuses the hole and the
   centroid stays. Whatever is adopted is dated: it is the hole location of one
   May morning, which is better than the centroid and is not today's.

   Writes mapping/pins-2026.json and cache/review/pins.png (a contact sheet). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { fetchWindow } from './ortho-crop.mjs';
import { decodePng } from './lib/png.mjs';
import { pointInRing, ringCentroid, dist, components } from './lib/imagery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const METRES = 0.16, SIZE = 64, INSET = 1.5, MARGIN = 28, MIN_PX = 3, MAX_PX = 40, MAX_BOX = 1.6, RUNNER_UP = 10;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
/* decode a fetched window to RGB through Chrome (the pieces are JPEG) */
async function rgbWindow(win) {
  const dataUrl = await page.evaluate(async ({ pieces, W, H }) => {
    const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    for (const piece of pieces) { const img = new Image(); img.src = 'data:image/jpeg;base64,' + piece.b64; await img.decode(); g.drawImage(img, piece.column0, piece.row0); }
    return canvas.toDataURL('image/png');
  }, { pieces: win.pieces, W: win.W, H: win.H });
  return decodePng(Buffer.from(dataUrl.split(',')[1], 'base64'));
}
const results = [];
const sheets = [];
for (const h of model.holes) {
  const c = h.green.c;
  const win = await fetchWindow({ cx: c[0], cz: c[1], size: SIZE, metres: METRES });
  const img = await rgbWindow(win);
  const { width: W, height: H } = img;
  const at = (col, row) => { const o = (row * W + col) * img.channels; return (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3; };
  const local = (col, row) => [c[0] - SIZE / 2 + (col + 0.5) * METRES, c[1] - SIZE / 2 + (row + 0.5) * METRES];
  /* the eroded green: inside the ring and further than INSET from its edge */
  const ring = h.green.ring;
  const edgeDist = p => { let best = Infinity; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)); } return best; };
  const inside = new Uint8Array(W * H);
  const values = [];
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) { const p = local(col, row); if (pointInRing(p[0], p[1], ring) && edgeDist(p) > INSET) { inside[row * W + col] = 1; values.push(at(col, row)); } }
  values.sort((a, b) => a - b);
  const median = values[values.length >> 1] ?? 0;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (inside[i] && at(i % W, (i / W) | 0) < median - MARGIN) dark[i] = 1;
  const comp = components(dark, W, H);
  const blobs = [];
  for (let k = 1; k <= comp.count; k++) {
    const n = comp.sizes[k]; if (n < MIN_PX || n > MAX_PX) continue;
    let c0 = W, c1 = 0, r0 = H, r1 = 0, sum = 0, sx = 0, sz = 0, minv = 255;
    for (let i = 0; i < W * H; i++) if (comp.labels[i] === k) { const col = i % W, row = (i / W) | 0; c0 = Math.min(c0, col); c1 = Math.max(c1, col); r0 = Math.min(r0, row); r1 = Math.max(r1, row); const v = at(col, row); sum += v; minv = Math.min(minv, v); const p = local(col, row); sx += p[0]; sz += p[1]; }
    const box = Math.max(c1 - c0 + 1, r1 - r0 + 1) * METRES;
    if (box > MAX_BOX) continue;
    blobs.push({ n, box: +box.toFixed(2), mean: +(sum / n).toFixed(1), min: minv, centre: [sx / n, sz / n] });
  }
  blobs.sort((a, b) => a.mean - b.mean);
  const best = blobs[0], second = blobs[1];
  const adopted = best && (!second || second.mean - best.mean >= RUNNER_UP);
  const pin = adopted ? best.centre.map(v => +v.toFixed(2)) : null;
  results.push({ hole: h.n, greenMedianBrightness: median, blobs: blobs.slice(0, 4), adopted: !!adopted, pin, centroid: c.map(v => +v.toFixed(2)), offsetFromCentroidMetres: pin ? +dist(pin, c).toFixed(1) : null,
    reason: !best ? 'no compact dark blob inside the eroded green' : !adopted ? `runner-up within ${RUNNER_UP} of the darkest (${best.mean} vs ${second.mean})` : 'one clearly darkest compact blob' });
  console.log(`hole ${String(h.n).padStart(2)}: median ${median} blobs ${blobs.length} ${best ? `best ${best.mean}/${best.n}px/${best.box}m` : ''} ${second ? `second ${second.mean}` : ''} -> ${adopted ? `PIN ${dist(pin, c).toFixed(1)} m from centroid` : 'centroid stays'}`);
  sheets.push({ hole: h.n, win: { pieces: win.pieces }, blobs: blobs.slice(0, 3).map(b => ({ px: win.px(...b.centre), mean: b.mean })), adopted: !!adopted, centroid: win.px(...c), ring: ring.map(p => win.px(...p)) });
}
/* contact sheet: 18 tiles of the green window with the ring, the blobs and the adopted pin */
const tile = Math.round(SIZE / METRES), cols = 6, rows = 3;
const sheet = await page.evaluate(async ({ sheets, tile, cols, rows }) => {
  const canvas = document.getElementById('c'); canvas.width = tile * cols; canvas.height = tile * rows;
  const g = canvas.getContext('2d');
  for (const [i, s] of sheets.entries()) {
    const ox = (i % cols) * tile, oy = Math.floor(i / cols) * tile;
    for (const piece of s.win.pieces) { const img = new Image(); img.src = 'data:image/jpeg;base64,' + piece.b64; await img.decode(); g.drawImage(img, ox + piece.column0, oy + piece.row0); }
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.beginPath(); s.ring.forEach(([x, y], k) => k ? g.lineTo(ox + x, oy + y) : g.moveTo(ox + x, oy + y)); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(255,255,0,0.9)'; g.beginPath(); g.arc(ox + s.centroid[0], oy + s.centroid[1], 5, 0, Math.PI * 2); g.stroke();
    s.blobs.forEach((b, k) => { g.strokeStyle = k === 0 && s.adopted ? 'rgba(255,40,40,1)' : 'rgba(60,200,255,0.9)'; g.lineWidth = k === 0 ? 2 : 1; g.beginPath(); g.arc(ox + b.px[0], oy + b.px[1], 9, 0, Math.PI * 2); g.stroke(); });
    g.fillStyle = 'white'; g.font = 'bold 16px sans-serif'; g.fillText(`${s.hole}${s.adopted ? '' : ' (centroid)'}`, ox + 6, oy + 18);
  }
  return canvas.toDataURL('image/png');
}, { sheets, tile, cols, rows });
await browser.close();
fs.mkdirSync(path.join(HERE, 'cache', 'review'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'cache', 'review', 'pins.png'), Buffer.from(sheet.split(',')[1], 'base64'));
const out = { schemaVersion: 1, groundId: 'tortuna', captureDate: '2026-05-02', source: 'Lantmäteriet orto-n2-2026 at 0.16 m via the Min karta proxy', script: 'tortunabuild/trace-pins.mjs',
  rule: { insetMetres: INSET, darkMarginBelowGreenMedian: MARGIN, blobSamples: [MIN_PX, MAX_PX], maxBoxMetres: MAX_BOX, runnerUpMargin: RUNNER_UP },
  adopted: results.filter(r => r.adopted).length, holes: results };
fs.writeFileSync(path.join(HERE, 'mapping', 'pins-2026.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`adopted ${out.adopted} of 18; wrote mapping/pins-2026.json and cache/review/pins.png`);
