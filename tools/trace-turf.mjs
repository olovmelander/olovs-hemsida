/* Classify mown golf turf out of orthoimagery, so a course that nobody mapped
   can be traced from the ground truth instead of drawn by hand.

   usage: node tools/trace-turf.mjs <build> --cx <m> --cz <m> --w <m> --h <m>
                                    [--zoom 18] [--tag name]

   The criteria are the ones build-treecover.py arrived at the hard way and
   CLAUDE.md records, because they hold here too:
     - mown turf is bright, green AND SMOOTH. Smoothness is what separates it
       from canopy, which is also bright and green and violently textured.
     - a tree's long shadow on grass is dark but still decisively green and dead
       smooth, so darkness alone must not disqualify turf.
   Greens read as turf that is smoother and slightly deeper than fairway; sand is
   bright with almost no green; water is dark with none.

   Output: a labelled PNG to look at, and a raster JSON in WORLD coordinates so
   anything derived from it needs no registration -- a tile's coordinates are its
   georeference. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'geobuild/cache/turf');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const build = args[0];
if (!build) { console.error('usage: trace-turf.mjs <build> --cx --cz --w --h'); process.exit(2); }
const Z = +flag('zoom', 18);
const CX = +flag('cx', 0), CZ = +flag('cz', 0);
const W = +flag('w', 600), H = +flag('h', 600);
const TAG = flag('tag', 'turf');
const CELL = +flag('cell', 2);        /* metres per raster cell */

const m = JSON.parse(fs.readFileSync(path.join(ROOT, build, 'course-model.json'), 'utf8'));
const O = m.origin, mLat = m.mPerLat, mLon = m.mPerLon;
const toLatLon = (x, z) => [O.lat - z / mLat, O.lon + x / mLon];
const toTile = (lat, lon, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
};

const [clat] = toLatLon(CX, CZ);
const mPerTile = 156543.03392 * Math.cos(clat * Math.PI / 180) / (2 ** Z) * 256;
const corners = [[CX - W / 2, CZ - H / 2], [CX + W / 2, CZ + H / 2]].map(([x, z]) => {
  const [la, lo] = toLatLon(x, z);
  return toTile(la, lo, Z);
});
const x0 = Math.floor(Math.min(corners[0][0], corners[1][0]));
const x1 = Math.ceil(Math.max(corners[0][0], corners[1][0]));
const y0 = Math.floor(Math.min(corners[0][1], corners[1][1]));
const y1 = Math.ceil(Math.max(corners[0][1], corners[1][1]));
const nx = x1 - x0, ny = y1 - y0;
console.log(`${build}: ${nx}x${ny} tiles at z${Z} (${mPerTile.toFixed(1)} m/tile, ${(mPerTile / 256).toFixed(2)} m/px)`);

const tiles = [];
for (let dy = 0; dy < ny; dy++) for (let dx = 0; dx < nx; dx++) {
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y0 + dy}/${x0 + dx}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    tiles.push({ dx, dy, src: 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64') });
  } catch (e) { console.log(`  tile ${dx},${dy}: ${e.message}`); }
}

/* pixel -> world, exactly */
const pxToWorld = (px2, py) => {
  const tx = x0 + px2 / 256, ty = y0 + py / 256;
  const n = 2 ** Z;
  const lon = tx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
  return [(lon - O.lon) * mLon, -(lat - O.lat) * mLat];
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const res = await page.evaluate(async ([tiles, nx, ny]) => {
  const Wp = nx * 256, Hp = ny * 256;
  const c = document.createElement('canvas');
  c.width = Wp; c.height = Hp;
  const g = c.getContext('2d', { willReadFrequently: true });
  for (const t of tiles) {
    const im = new Image();
    await new Promise(ok => { im.onload = ok; im.onerror = ok; im.src = t.src; });
    g.drawImage(im, t.dx * 256, t.dy * 256);
  }
  const d = g.getImageData(0, 0, Wp, Hp).data;
  const luma = new Float32Array(Wp * Hp), grn = new Float32Array(Wp * Hp);
  for (let i = 0; i < Wp * Hp; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    luma[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    grn[i] = (2 * gg - r - b) / 255;
  }
  /* texture: mean absolute laplacian over a small window -- canopy is violently
     textured, mown turf is dead smooth, and that is the separation that works */
  const tex = new Float32Array(Wp * Hp);
  for (let y = 1; y < Hp - 1; y++) for (let x = 1; x < Wp - 1; x++) {
    const i = y * Wp + x;
    tex[i] = Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - Wp] - luma[i + Wp]);
  }
  const box = new Float32Array(Wp * Hp);
  const R = 3;
  for (let y = R; y < Hp - R; y++) for (let x = R; x < Wp - R; x++) {
    let s = 0;
    for (let b2 = -R; b2 <= R; b2++) for (let a = -R; a <= R; a++) s += tex[(y + b2) * Wp + x + a];
    box[y * Wp + x] = s / ((2 * R + 1) ** 2);
  }
  /* 0 other/rough  1 mown turf  2 green (smoothest, deeper)  3 sand  4 water  5 trees */
  const cls = new Uint8Array(Wp * Hp);
  for (let i = 0; i < Wp * Hp; i++) {
    const L = luma[i], G = grn[i], T = box[i];
    if (G < 0.02 && L < 70) { cls[i] = 4; continue; }                 /* water */
    if (G < 0.06 && L > 120) { cls[i] = 3; continue; }                /* sand */
    if (G > 0.05 && T > 7) { cls[i] = 5; continue; }                  /* canopy */
    if (G > 0.12 && T < 3.2 && L > 55) { cls[i] = 2; continue; }      /* green/tight cut */
    if (G > 0.085 && T < 5.5 && L > 45) { cls[i] = 1; continue; }     /* mown turf */
  }
  const PAL = [[40, 40, 40], [90, 200, 90], [230, 245, 120], [235, 210, 150], [60, 90, 150], [25, 70, 35]];
  const ov = g.createImageData(Wp, Hp);
  for (let i = 0; i < Wp * Hp; i++) {
    const p = PAL[cls[i]];
    ov.data[i * 4] = p[0]; ov.data[i * 4 + 1] = p[1]; ov.data[i * 4 + 2] = p[2]; ov.data[i * 4 + 3] = 255;
  }
  const oc = document.createElement('canvas');
  oc.width = Wp; oc.height = Hp;
  oc.getContext('2d').putImageData(ov, 0, 0);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < cls.length; i++) counts[cls[i]]++;
  return { raw: c.toDataURL('image/jpeg', 0.8).split(',')[1],
           lab: oc.toDataURL('image/png').split(',')[1],
           cls: Array.from(cls), Wp, Hp, counts };
}, [tiles, nx, ny]);
await browser.close();

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${build}-${TAG}-raw.jpg`), Buffer.from(res.raw, 'base64'));
fs.writeFileSync(path.join(OUT, `${build}-${TAG}-classified.png`), Buffer.from(res.lab, 'base64'));

/* downsample to a world raster at CELL metres, majority class per cell */
const mPerPx = mPerTile / 256;
const step = Math.max(1, Math.round(CELL / mPerPx));
const rw = Math.floor(res.Wp / step), rh = Math.floor(res.Hp / step);
const grid = new Uint8Array(rw * rh);
for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
  const tally = [0, 0, 0, 0, 0, 0];
  for (let b = 0; b < step; b++) for (let a = 0; a < step; a++)
    tally[res.cls[(j * step + b) * res.Wp + i * step + a]]++;
  let best = 0;
  for (let k = 1; k < 6; k++) if (tally[k] > tally[best]) best = k;
  grid[j * rw + i] = best;
}
const w00 = pxToWorld(0, 0), w11 = pxToWorld(step, step);
fs.writeFileSync(path.join(OUT, `${build}-${TAG}.json`), JSON.stringify({
  build, zoom: Z, cellMetres: CELL, rw, rh,
  x0: w00[0], z0: w00[1], dx: w11[0] - w00[0], dz: w11[1] - w00[1],
  legend: { 0: 'rough/other', 1: 'mown turf', 2: 'tight cut (green)', 3: 'sand', 4: 'water', 5: 'trees' },
  grid: Array.from(grid),
}) + '\n');

const tot = res.counts.reduce((a, b) => a + b, 0);
const names = ['rough', 'mown', 'tight', 'sand', 'water', 'trees'];
console.log('  ' + res.counts.map((v, i) => `${names[i]} ${(100 * v / tot).toFixed(1)}%`).join('  '));
console.log('  ->', path.relative(ROOT, path.join(OUT, `${build}-${TAG}-classified.png`)));
