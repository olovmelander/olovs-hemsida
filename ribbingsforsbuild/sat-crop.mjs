#!/usr/bin/env node
/* A georeferenced Esri World Imagery crop of the Ribbingsfors frame, with the
   model drawn on top and a labelled metre grid, for tracing by eye.

   tools/sat-mosaic.mjs cannot serve this build: it converts through a
   flat-earth ORIGIN frame, and Ribbingsfors is authored in grid metres — the
   0.76° meridian convergence would put every overlay ~17 m off at the course
   edge. This tool goes local -> EPSG:3006 -> WGS84 -> tile with the repo's
   own Krüger series, so the overlay is exact.

   usage: node ribbingsforsbuild/sat-crop.mjs <name> <cx> <cz> <sizeMetres> [zoom] [--plain]
   Tiles cache in ribbingsforsbuild/cache/sat/; PNGs land in cache/crops/. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const plain = argv.includes('--plain');
const [name, cxs, czs, sizes, zs] = argv.filter(item => item !== '--plain');
if (!name || !Number.isFinite(+cxs) || !Number.isFinite(+czs) || !(+sizes > 0)) {
  console.error('usage: node ribbingsforsbuild/sat-crop.mjs <name> <cx> <cz> <sizeMetres> [zoom] [--plain]');
  process.exit(2);
}
const cx = +cxs, cz = +czs, size = +sizes, Z = +(zs || 18);
const CACHE = path.join(HERE, 'cache', 'sat');
const OUT = path.join(HERE, 'cache', 'crops');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const toLatLon = (x, z) => sweref99TmToLatLon(FRAME.easting + x, FRAME.northing - z);
const n = 2 ** Z;
const tileOf = (lat, lon) => [(lon + 180) / 360 * n,
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
/* The grid frame is rotated against web-mercator north by well under a degree
   here, so a crop aligned on the corner tiles stays a faithful locator; the
   px() mapping below is exact per point regardless. */
const corners = [[cx - size / 2, cz - size / 2], [cx + size / 2, cz + size / 2]];
const [t0, t1] = corners.map(([x, z]) => tileOf(...toLatLon(x, z)));
const tx0 = Math.min(t0[0], t1[0]), tx1 = Math.max(t0[0], t1[0]);
const ty0 = Math.min(t0[1], t1[1]), ty1 = Math.max(t0[1], t1[1]);
const X0 = Math.floor(tx0), Y0 = Math.floor(ty0), X1 = Math.floor(tx1), Y1 = Math.floor(ty1);
const tiles = [];
for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
  if (!fs.existsSync(file)) {
    const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
    if (!response.ok) throw new Error(`tile ${Z}/${ty}/${tx} ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  tiles.push({ tx, ty, b64: fs.readFileSync(file).toString('base64') });
}
const W = Math.round((tx1 - tx0) * 256), H = Math.round((ty1 - ty0) * 256);
const px = (x, z) => { const [tx, ty] = tileOf(...toLatLon(x, z)); return [(tx - tx0) * 256, (ty - ty0) * 256]; };

const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const surroundings = fs.existsSync(path.join(HERE, 'osm-surroundings.json'))
  ? JSON.parse(fs.readFileSync(path.join(HERE, 'osm-surroundings.json'), 'utf8')) : null;
const mapPx = points => points.map(([x, z]) => px(x, z));
const overlays = {
  holes: model.holes.map(hole => ({ n: hole.n, line: mapPx(hole.line), green: px(...hole.green.c) })),
  water: model.water.map(item => mapPx(item.ring)),
  buildings: (surroundings ? surroundings.buildings : model.infra.buildings).map(b => mapPx(b.ring)),
  roads: (surroundings ? surroundings.roads : model.infra.roads).map(r => mapPx(r.line)),
  tracks: (surroundings ? surroundings.tracks : model.infra.tracks).map(r => mapPx(r.line)),
  range: (model.scenery.range || []).map(mapPx),
};
const grid = [];
const step = size > 1600 ? 500 : 200;
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
    g.strokeStyle = 'rgba(255,255,0,0.4)'; g.fillStyle = 'yellow'; g.font = 'bold 12px sans-serif';
    for (const [x, y, label, vertical, line] of grid) { poly(line, false); g.fillText(label, x + 3, y + (vertical ? 14 : -4)); }
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(0,180,255,0.9)'; for (const ring of overlays.water) poly(ring, true);
    g.strokeStyle = 'rgba(255,80,80,0.9)'; for (const ring of overlays.buildings) poly(ring, true);
    g.strokeStyle = 'rgba(255,160,40,0.8)'; for (const line of overlays.roads) poly(line, false);
    g.strokeStyle = 'rgba(255,160,40,0.45)'; for (const line of overlays.tracks) poly(line, false);
    g.strokeStyle = 'rgba(120,255,120,0.8)'; for (const ring of overlays.range) poly(ring, true);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'white'; g.font = 'bold 16px sans-serif';
    for (const hole of overlays.holes) { poly(hole.line, false); g.fillText(String(hole.n), hole.green[0] + 4, hole.green[1] - 4); }
  }
  return canvas.toDataURL('image/png');
}, { tiles, W, H, tx0, ty0, grid, overlays, plain });
await browser.close();
const file = path.join(OUT, `${name}${plain ? '-plain' : ''}.png`);
fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`${file} ${W}x${H}px, ${(size / W * 1000).toFixed(0)} mm/px nominal`);
