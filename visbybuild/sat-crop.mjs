#!/usr/bin/env node
/* A georeferenced Esri World Imagery crop of the Visby frame, with the model
   drawn on top and a labelled metre grid, for tracing and review by eye.

   tools/sat-mosaic.mjs cannot serve this build for the same reason it cannot
   serve Ribbingsfors: it converts through a flat-earth ORIGIN frame, and Visby
   is authored in EPSG:3006 grid metres, so the meridian convergence (Gotland
   sits 3.1 degrees east of the 15 degree central meridian) would put every
   overlay tens of metres off across the property. This goes
   local -> EPSG:3006 -> WGS84 -> tile with the repo's own Krueger series, so
   the overlay is exact per point.

   usage: node visbybuild/sat-crop.mjs <name> <cx> <cz> <sizeMetres> [zoom] [--plain]
     --plain   no overlay, for tracing a feature the overlay would hide
     VISBY_SAT_TEMPLATE  overrides the tile URL template ({z}/{y}/{x}); use it to
                         read one dated Esri Wayback release instead of the live
                         mosaic, which is a patchwork of flights.
   Tiles cache in visbybuild/cache/sat/; PNGs land in visbybuild/cache/crops/. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { VISBY_FRAME } from './frame.mjs';

const require_ = createRequire(import.meta.url);
/* playwright-core is the repo's pinned harness dependency; a scratch install
   may supply it where the workspace has not been installed. */
const { chromium } = (() => {
  for (const id of ['playwright-core', process.env.VISBY_PLAYWRIGHT_MODULE].filter(Boolean)) {
    try { return require_(id); } catch { /* try the next candidate */ }
  }
  throw new Error('playwright-core not resolvable; set VISBY_PLAYWRIGHT_MODULE to an installed copy');
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const plain = argv.includes('--plain');
const [name, cxs, czs, sizes, zs] = argv.filter(item => item !== '--plain');
if (!name || !Number.isFinite(+cxs) || !Number.isFinite(+czs) || !(+sizes > 0)) {
  console.error('usage: node visbybuild/sat-crop.mjs <name> <cx> <cz> <sizeMetres> [zoom] [--plain]');
  process.exit(2);
}
const cx = +cxs, cz = +czs, size = +sizes, Z = +(zs || 18);
const TEMPLATE = process.env.VISBY_SAT_TEMPLATE
  || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TAG = process.env.VISBY_SAT_TAG || 'live';
const CACHE = path.join(HERE, 'cache', 'sat', TAG);
const OUT = path.join(HERE, 'cache', 'crops');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const toLatLon = (x, z) => sweref99TmToLatLon(VISBY_FRAME.easting + x, VISBY_FRAME.northing - z);
const n = 2 ** Z;
const tileOf = (lat, lon) => [(lon + 180) / 360 * n,
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
const corners = [[cx - size / 2, cz - size / 2], [cx + size / 2, cz + size / 2]];
const [t0, t1] = corners.map(([x, z]) => tileOf(...toLatLon(x, z)));
const tx0 = Math.min(t0[0], t1[0]), tx1 = Math.max(t0[0], t1[0]);
const ty0 = Math.min(t0[1], t1[1]), ty1 = Math.max(t0[1], t1[1]);
const X0 = Math.floor(tx0), Y0 = Math.floor(ty0), X1 = Math.floor(tx1), Y1 = Math.floor(ty1);
const tiles = [];
for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
  if (!fs.existsSync(file)) {
    const url = TEMPLATE.replace('{z}', Z).replace('{y}', ty).replace('{x}', tx);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`tile ${Z}/${ty}/${tx} ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  tiles.push({ tx, ty, b64: fs.readFileSync(file).toString('base64') });
}
const W = Math.round((tx1 - tx0) * 256), H = Math.round((ty1 - ty0) * 256);
const px = (x, z) => { const [tx, ty] = tileOf(...toLatLon(x, z)); return [(tx - tx0) * 256, (ty - ty0) * 256]; };

const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const mapPx = points => points.map(([x, z]) => px(x, z));
/* Visby keeps bunkers as shared-ground scenery rings, not per-hole, and its
   fairway rings live under hole.fairway.rings plus unassigned scenery ones. */
const overlays = {
  holes: model.holes.map(hole => ({ n: hole.n, line: mapPx(hole.line), green: px(...hole.green.c) })),
  greens: model.holes.map(hole => mapPx(hole.green.ring)),
  fairways: [...model.holes.flatMap(hole => (hole.fairway?.rings || []).map(mapPx)),
    ...(model.scenery.fairways || []).map(mapPx)],
  teePads: model.holes.flatMap(hole => (hole.tees?.pads || []).map(pad => mapPx(pad.ring))),
  bunkers: (model.scenery.bunkers || []).map(mapPx),
  water: model.water.map(item => mapPx(item.ring)),
  buildings: (model.infra.buildings || []).map(b => mapPx(b.ring)),
  roads: (model.infra.roads || []).map(r => mapPx(r.line)),
  paths: [...(model.infra.paths || []), ...(model.infra.tracks || [])].map(r => mapPx(r.line)),
  range: (model.scenery.range || []).map(mapPx),
  marks: [],
};
/* Extra points to check by eye, as "x,z[,label]" repeated in VISBY_SAT_MARKS. */
for (const spec of (process.env.VISBY_SAT_MARKS || '').split(';').filter(Boolean)) {
  const [x, z, label] = spec.split(',');
  overlays.marks.push({ p: px(+x, +z), label: label || '' });
}
const grid = [];
const step = size > 1600 ? 500 : size > 700 ? 200 : size > 300 ? 100 : 50;
for (let x = Math.ceil((cx - size / 2) / step) * step; x <= cx + size / 2; x += step) {
  grid.push([...px(x, cz - size / 2), `x${x}`, true, mapPx([[x, cz - size / 2], [x, cz + size / 2]])]);
}
for (let z = Math.ceil((cz - size / 2) / step) * step; z <= cz + size / 2; z += step) {
  grid.push([...px(cx - size / 2, z), `z${z}`, false, mapPx([[cx - size / 2, z], [cx + size / 2, z]])]);
}

const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(LINUX_CHROME) ? { executablePath: LINUX_CHROME } : { channel: 'chrome' }),
  headless: true,
});
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const dataUrl = await page.evaluate(async ({ tiles, W, H, tx0, ty0, grid, overlays, plain }) => {
  const canvas = document.getElementById('c');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  for (const tile of tiles) {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + tile.b64;
    await img.decode();
    g.drawImage(img, (tile.tx - tx0) * 256, (tile.ty - ty0) * 256);
  }
  if (!plain) {
    const poly = (points, close) => { g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); };
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,0,0.35)'; g.fillStyle = 'yellow'; g.font = 'bold 12px sans-serif';
    for (const [x, y, label, vertical, line] of grid) { poly(line, false); g.fillText(label, x + 3, y + (vertical ? 14 : -4)); }
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(0,180,255,0.9)'; for (const ring of overlays.water) poly(ring, true);
    g.strokeStyle = 'rgba(255,80,80,0.9)'; for (const ring of overlays.buildings) poly(ring, true);
    g.strokeStyle = 'rgba(255,160,40,0.8)'; for (const line of overlays.roads) poly(line, false);
    g.strokeStyle = 'rgba(255,160,40,0.45)'; for (const line of overlays.paths) poly(line, false);
    g.strokeStyle = 'rgba(120,255,120,0.55)'; for (const ring of overlays.fairways) poly(ring, true);
    g.strokeStyle = 'rgba(120,255,120,0.8)'; for (const ring of overlays.range) poly(ring, true);
    g.strokeStyle = 'rgba(60,255,60,0.95)'; for (const ring of overlays.greens) poly(ring, true);
    g.strokeStyle = 'rgba(255,60,255,0.9)'; for (const ring of overlays.teePads) poly(ring, true);
    g.strokeStyle = 'rgba(255,255,120,0.9)'; for (const ring of overlays.bunkers) poly(ring, true);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'white'; g.font = 'bold 16px sans-serif';
    for (const hole of overlays.holes) { poly(hole.line, false); g.fillText(String(hole.n), hole.green[0] + 4, hole.green[1] - 4); }
    g.font = 'bold 13px sans-serif';
    for (const mark of overlays.marks) {
      g.strokeStyle = 'rgba(255,0,0,0.95)'; g.beginPath();
      g.moveTo(mark.p[0] - 9, mark.p[1]); g.lineTo(mark.p[0] + 9, mark.p[1]);
      g.moveTo(mark.p[0], mark.p[1] - 9); g.lineTo(mark.p[0], mark.p[1] + 9); g.stroke();
      g.fillStyle = 'red'; g.fillText(mark.label, mark.p[0] + 11, mark.p[1] - 5);
    }
  }
  return canvas.toDataURL('image/png');
}, { tiles, W, H, tx0, ty0, grid, overlays, plain });
await browser.close();
const file = path.join(OUT, `${name}${plain ? '-plain' : ''}.png`);
fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`${file} ${W}x${H}px, ${(size / W * 1000).toFixed(0)} mm/px nominal (tiles: ${TAG})`);
