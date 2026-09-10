#!/usr/bin/env node
/* A georeferenced Lantmäteriet orthophoto crop of the Veckefjärden frame, with
   a labelled-by-spacing metre grid and optional overlays, for tracing and for
   checking OSM geometry against the ground. Visby's and Tortuna's ortho-crop
   carried to a FLAT-EARTH frame: every output pixel is a local (x, z), taken
   through lonLat -> SWEREF 99 TM per point (the repo's own Krüger series), so
   the 3.28° convergence and the frame's 0.13-0.34% scale error never enter --
   the same exact-per-point rule tools/build-landcover.mjs uses for its window.

   The national orthophoto over this basin is served with no credentials by the
   viewing service Min karta proxies (Ortofoto_0.16 at 0.16 m, Ortofoto_0.5 at
   0.5 m). It is a TRACING SOURCE and never a runtime texture; nothing fetched
   here is redistributed. Pieces cache under geobuild/cache/ortho/ (gitignored),
   PNGs land in geobuild/cache/crops/.

     node geobuild/ortho-crop.mjs <name> <cx> <cz> <sizeMetres> [--mpp 0.25]
          [--grid 50] [--marks "x,z;x,z"] [--lines file.json]
   --lines takes a JSON array of {pts:[[x,z],...], col:[r,g,b]} polylines in
   local metres (a ring repeats its first point).

   Two request conventions that cost a blank image if got wrong, both measured
   at Visby: WMS 1.3.0 with EPSG:3006 wants the bbox NORTHING FIRST and returns
   pure white with easting first, so this speaks 1.1.1 with SRS= and easting
   first; and the service caps a request at 4096 x 4096, so a larger view is
   mosaicked rather than asked for in one go.                                  */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, xzToLonLat } from './lib.mjs';
import { decodePNG, encodePNG } from './png.mjs';
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [name, cxS, czS, sizeS] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!name || !sizeS) { console.error('usage: ortho-crop <name> <cx> <cz> <sizeMetres> [--mpp 0.25] [--grid 50] [--marks ..] [--lines file]'); process.exit(2); }
const cx = +cxS, cz = +czS, size = +sizeS;
const MPP = +opt('--mpp', 0.25);
const GRID = +opt('--grid', 50);
const LAYER = MPP >= 0.5 ? 'Ortofoto_0.5' : 'Ortofoto_0.16';
const SRC_PX = MPP >= 0.5 ? 0.5 : 0.16;
const DIR = path.join(CACHE, 'ortho', LAYER);
const OUT = path.join(CACHE, 'crops');
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

export const toGrid = (x, z) => { const [lon, lat] = xzToLonLat(x, z); return latLonToSweref99Tm(lat, lon); };

/* the 3006 box around the rotated local square, on the source pixel lattice */
const half = size / 2;
const corners = [[cx - half, cz - half], [cx + half, cz - half], [cx + half, cz + half], [cx - half, cz + half]].map(([x, z]) => toGrid(x, z));
const PX = SRC_PX;
const minE = Math.floor((Math.min(...corners.map(c => c[0])) - 2) / PX) * PX;
const maxE = Math.ceil((Math.max(...corners.map(c => c[0])) + 2) / PX) * PX;
const minN = Math.floor((Math.min(...corners.map(c => c[1])) - 2) / PX) * PX;
const maxN = Math.ceil((Math.max(...corners.map(c => c[1])) + 2) / PX) * PX;
const W = Math.round((maxE - minE) / PX), H = Math.round((maxN - minN) / PX);
const MAXPX = 4000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' };
async function piece(c0, r0, cols, rows) {
  const e0 = minE + c0 * PX, e1 = e0 + cols * PX, n1 = maxN - r0 * PX, n0 = n1 - rows * PX;
  const file = path.join(DIR, `${LAYER}_${PX}m_${e0}_${n0}_${cols}x${rows}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${LAYER}&STYLES=&SRS=EPSG:3006&BBOX=${e0},${n0},${e1},${n1}&WIDTH=${cols}&HEIGHT=${rows}&FORMAT=image/png`;
    let r = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      r = await fetch(url, { headers: HEADERS });
      if (r.ok) break;
      if (attempt === 3) throw new Error(`WMS ${r.status} for ${cols}x${rows} at ${e0},${n0}`);
      await new Promise(res => setTimeout(res, 1500 * attempt));
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 4096 || bytes[0] !== 0x89) throw new Error(`WMS answered ${bytes.length} bytes, not a PNG`);
    fs.writeFileSync(file, bytes);
    console.log(`  fetched ${cols}x${rows} at E${e0} N${n0}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  const png = decodePNG(fs.readFileSync(file));
  if (png.width !== cols || png.height !== rows) throw new Error(`${file} is ${png.width}x${png.height}, asked ${cols}x${rows}`);
  return { c0, r0, cols, rows, png };
}
const RGB = new Uint8Array(W * H * 3);
const nCols = Math.ceil(W / MAXPX), nRows = Math.ceil(H / MAXPX);
for (let pr = 0; pr < nRows; pr++) for (let pc = 0; pc < nCols; pc++) {
  const c0 = Math.floor(pc * W / nCols), c1 = Math.floor((pc + 1) * W / nCols);
  const r0 = Math.floor(pr * H / nRows), r1 = Math.floor((pr + 1) * H / nRows);
  const p = await piece(c0, r0, c1 - c0, r1 - r0);
  const ch = p.png.channels;
  for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.cols; x++) {
    const s = (y * p.cols + x) * ch, d = ((r0 + y) * W + (c0 + x)) * 3;
    RGB[d] = p.png.data[s]; RGB[d + 1] = p.png.data[s + 1]; RGB[d + 2] = p.png.data[s + 2];
  }
}

/* resample onto the local lattice: pixel (i, j) is local (cx - half + i*MPP, cz - half + j*MPP) */
const OW = Math.round(size / MPP), OH = OW;
const out = new Uint8Array(OW * OH * 3);
for (let j = 0; j < OH; j++) for (let i = 0; i < OW; i++) {
  const [e, n] = toGrid(cx - half + (i + 0.5) * MPP, cz - half + (j + 0.5) * MPP);
  const si = Math.floor((e - minE) / PX), sj = Math.floor((maxN - n) / PX);
  const d = (j * OW + i) * 3;
  if (si < 0 || sj < 0 || si >= W || sj >= H) { out[d] = 255; out[d + 1] = 0; out[d + 2] = 255; continue; }
  const s = (sj * W + si) * 3;
  out[d] = RGB[s]; out[d + 1] = RGB[s + 1]; out[d + 2] = RGB[s + 2];
}
const put = (i, j, col) => { if (i < 0 || j < 0 || i >= OW || j >= OH) return; const d = (j * OW + i) * 3; out[d] = col[0]; out[d + 1] = col[1]; out[d + 2] = col[2]; };
const toPx = (x, z) => [Math.round((x - (cx - half)) / MPP), Math.round((z - (cz - half)) / MPP)];
/* the grid: thin lines every GRID m, the multiples of 5*GRID heavier, the centre cross heaviest */
const gx0 = Math.ceil((cx - half) / GRID) * GRID;
for (let gx = gx0; gx <= cx + half; gx += GRID) {
  const [i] = toPx(gx, cz), heavy = Math.abs(gx) % (GRID * 5) === 0 ? 1 : 0;
  for (let j = 0; j < OH; j++) for (let k = -heavy; k <= heavy; k++) put(i + k, j, heavy ? [255, 240, 0] : [255, 255, 255]);
}
for (let gz = Math.ceil((cz - half) / GRID) * GRID; gz <= cz + half; gz += GRID) {
  const [, j] = toPx(cx, gz), heavy = Math.abs(gz) % (GRID * 5) === 0 ? 1 : 0;
  for (let i = 0; i < OW; i++) for (let k = -heavy; k <= heavy; k++) put(i, j + k, heavy ? [255, 240, 0] : [255, 255, 255]);
}
{ const [ci, cj] = toPx(cx, cz); for (let k = -20; k <= 20; k++) { put(ci + k, cj, [255, 0, 0]); put(ci, cj + k, [255, 0, 0]); } }
const line = (a, b, col, w = 1) => {
  const [i0, j0] = toPx(a[0], a[1]), [i1, j1] = toPx(b[0], b[1]);
  const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0), 1);
  for (let t = 0; t <= n; t++) {
    const i = Math.round(i0 + (i1 - i0) * t / n), j = Math.round(j0 + (j1 - j0) * t / n);
    for (let a2 = -w; a2 <= w; a2++) for (let b2 = -w; b2 <= w; b2++) put(i + a2, j + b2, col);
  }
};
const marks = opt('--marks', '');
if (marks) for (const m of marks.split(';')) {
  const [mx, mz] = m.split(',').map(Number);
  const [i, j] = toPx(mx, mz);
  for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) if (Math.abs(a) > 3 || Math.abs(b) > 3) put(i + a, j + b, [0, 255, 255]);
}
const linesFile = opt('--lines', '');
if (linesFile) for (const L of JSON.parse(fs.readFileSync(linesFile, 'utf8')))
  for (let k = 0; k + 1 < L.pts.length; k++) line(L.pts[k], L.pts[k + 1], L.col || [0, 255, 255], L.w ?? 1);
const dest = path.join(OUT, `${name}.png`);
fs.writeFileSync(dest, encodePNG(OW, OH, out));
console.log(`${path.relative(process.cwd(), dest)}: ${OW}x${OH} px at ${MPP} m, local x ${cx - half}..${cx + half} z ${cz - half}..${cz + half}, ${LAYER}`);
