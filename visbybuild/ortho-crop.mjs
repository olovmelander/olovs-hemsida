#!/usr/bin/env node
/* A georeferenced Lantmäteriet orthophoto crop of the Visby frame, with the
   model drawn on top and a labelled metre grid, for tracing and review by eye.
 *
 * WHY THIS AND NOT sat-crop.mjs. Esri World Imagery over Kronholmen is
 * WorldView-2 from 2016-08-24 at 0.5 m source, served no finer than z18
 * (0.3214 m/px) -- z19 and beyond return the same 2,521-byte "Map data not yet
 * available" placeholder, so z18 is its floor, not a choice. Lantmäteriet's
 * national orthophoto over this block is the 2026-04-10 flight at 0.16 m RGBI,
 * twice as fine and ten years newer, and its pixels are servable with NO
 * credentials through the viewing service Min karta proxies. The 0.16 m COG
 * itself is 401 unauthenticated and was 403 for this repo's configured account,
 * so the WMS is the route that works.
 *
 * The imagery is a TRACING SOURCE and never a runtime texture, which is the
 * policy this ground already states: nothing fetched here is redistributed.
 * Lantmäteriet's ortho STAC declares CC-BY-4.0 and also says use is legally
 * reviewed and requires accepting special terms; the Min karta capabilities
 * carry no Fees or AccessConstraints element. That is recorded rather than
 * resolved -- derived vector geometry is what leaves this tool.
 *
 *   node visbybuild/ortho-crop.mjs <name> <cx> <cz> <sizeMetres> [--plain]
 *     --plain     no overlay, for tracing a feature the overlay would hide
 *     --gotland   Region Gotland's open 0.25 m SUMMER capture instead of the
 *                 April national one; leaf-on, so mow lines read where the
 *                 spring frame flattens them. A genuine second dated capture.
 *     --metres N  ground sampling to render at (default 0.16, the native one)
 *     VISBY_ORTHO_MARKS  "x,z[,label];..." extra points to check by eye
 *
 * Tiles cache in visbybuild/cache/ortho/; PNGs land in visbybuild/cache/crops/.
 *
 * Two request conventions that cost a blank image if got wrong, both measured:
 * WMS 1.3.0 with EPSG:3006 wants the bbox NORTHING FIRST and returns pure white
 * with easting first, so this speaks 1.1.1 with SRS= and easting first; and the
 * service caps a request at 4096 x 4096, so a native-resolution course view is
 * mosaicked rather than asked for in one go.                                  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { VISBY_FRAME } from './frame.mjs';

const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const id of ['playwright-core', process.env.VISBY_PLAYWRIGHT_MODULE].filter(Boolean)) {
    try { return require_(id); } catch { /* try the next candidate */ }
  }
  throw new Error('playwright-core not resolvable; set VISBY_PLAYWRIGHT_MODULE to an installed copy');
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = flag => argv.includes(`--${flag}`);
const value = (flag, fallback) => { const i = argv.indexOf(`--${flag}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const plain = has('plain');
const gotland = has('gotland');
const positional = argv.filter((item, index) => !item.startsWith('--') && !(index > 0 && argv[index - 1] === '--metres'));
const [name, cxs, czs, sizes] = positional;
if (!name || !Number.isFinite(+cxs) || !Number.isFinite(+czs) || !(+sizes > 0)) {
  console.error('usage: node visbybuild/ortho-crop.mjs <name> <cx> <cz> <sizeMetres> [--plain] [--gotland] [--metres 0.16]');
  process.exit(2);
}
const cx = +cxs, cz = +czs, size = +sizes;
const metres = +value('metres', gotland ? 0.25 : 0.16);
const SOURCE = gotland ? 'gotland-2022' : 'lm-0.16';
const CACHE = path.join(HERE, 'cache', 'ortho', SOURCE);
const OUT = path.join(HERE, 'cache', 'crops');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/* local metres -> EPSG:3006. This frame IS grid metres about its origin, so
   there is no projection step and no convergence to correct for. */
const east = x => VISBY_FRAME.easting + x;
const north = z => VISBY_FRAME.northing - z;
const minEasting = east(cx - size / 2), maxEasting = east(cx + size / 2);
const minNorthing = north(cz + size / 2), maxNorthing = north(cz - size / 2);
const W = Math.round(size / metres), H = Math.round(size / metres);
const px = (x, z) => [(east(x) - minEasting) / metres, (maxNorthing - north(z)) / metres];

/* The service caps a request at 4096 px a side, so the view is mosaicked into
   whole sub-rectangles of the requested pixel grid; each piece keeps the exact
   ground extent its own pixels cover, so the mosaic is seamless by
   construction rather than by alignment. */
const MAX = 4096;
async function fetchPiece(column0, row0, columns, rows) {
  const w0 = minEasting + column0 * metres, w1 = w0 + columns * metres;
  const n1 = maxNorthing - row0 * metres, n0 = n1 - rows * metres;
  const key = `${SOURCE}_${metres}_${w0.toFixed(2)}_${n0.toFixed(2)}_${columns}x${rows}.jpg`;
  const file = path.join(CACHE, key);
  if (!fs.existsSync(file)) {
    const url = gotland
      ? `https://imageserver.gotland.se/arcgis/rest/services/Ortofoto/Ortofoto_2022/ImageServer/exportImage?bbox=${w0},${n0},${w1},${n1}&bboxSR=3006&imageSR=3006&size=${columns},${rows}&format=jpg&f=pjson`
      : `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofoto_0.16&STYLES=&SRS=EPSG:3006&BBOX=${w0},${n0},${w1},${n1}&WIDTH=${columns}&HEIGHT=${rows}&FORMAT=image/jpeg`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' };
    let response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${SOURCE} piece ${columns}x${rows} at ${w0},${n0} returned HTTP ${response.status}`);
    /* Region Gotland's f=image returns a two-tone tRNS artefact rather than
       imagery; f=pjson and then the href it names returns the real pixels. */
    if (gotland) {
      const meta = await response.json();
      if (!meta.href) throw new Error(`Gotland ImageServer returned no href: ${JSON.stringify(meta).slice(0, 200)}`);
      response = await fetch(meta.href, { headers });
      if (!response.ok) throw new Error(`Gotland href returned HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2048) throw new Error(`${SOURCE} piece is ${bytes.length} bytes, which is a service exception rather than imagery`);
    fs.writeFileSync(file, bytes);
  }
  return { column0, row0, columns, rows, b64: fs.readFileSync(file).toString('base64') };
}
const pieces = [];
for (let row0 = 0; row0 < H; row0 += MAX) {
  for (let column0 = 0; column0 < W; column0 += MAX) {
    pieces.push(await fetchPiece(column0, row0, Math.min(MAX, W - column0), Math.min(MAX, H - row0)));
  }
}

const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const mapPx = points => points.map(([x, z]) => px(x, z));
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
for (const spec of (process.env.VISBY_ORTHO_MARKS || '').split(';').filter(Boolean)) {
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
const dataUrl = await page.evaluate(async ({ pieces, W, H, grid, overlays, plain, lineScale }) => {
  const canvas = document.getElementById('c');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  for (const piece of pieces) {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + piece.b64;
    await img.decode();
    g.drawImage(img, piece.column0, piece.row0);
  }
  if (!plain) {
    const poly = (points, close) => { g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); };
    g.lineWidth = lineScale;
    g.strokeStyle = 'rgba(255,255,0,0.30)'; g.fillStyle = 'yellow'; g.font = `bold ${12 * lineScale}px sans-serif`;
    for (const [x, y, label, vertical, line] of grid) { poly(line, false); g.fillText(label, x + 3 * lineScale, y + (vertical ? 14 : -4) * lineScale); }
    g.lineWidth = 1.6 * lineScale;
    g.strokeStyle = 'rgba(0,180,255,0.9)'; for (const ring of overlays.water) poly(ring, true);
    g.strokeStyle = 'rgba(255,80,80,0.9)'; for (const ring of overlays.buildings) poly(ring, true);
    g.strokeStyle = 'rgba(255,160,40,0.8)'; for (const line of overlays.roads) poly(line, false);
    g.strokeStyle = 'rgba(255,160,40,0.45)'; for (const line of overlays.paths) poly(line, false);
    g.strokeStyle = 'rgba(120,255,120,0.55)'; for (const ring of overlays.fairways) poly(ring, true);
    g.strokeStyle = 'rgba(120,255,120,0.8)'; for (const ring of overlays.range) poly(ring, true);
    g.strokeStyle = 'rgba(60,255,60,0.95)'; for (const ring of overlays.greens) poly(ring, true);
    g.strokeStyle = 'rgba(255,60,255,0.9)'; for (const ring of overlays.teePads) poly(ring, true);
    g.strokeStyle = 'rgba(255,255,120,0.9)'; for (const ring of overlays.bunkers) poly(ring, true);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'white'; g.font = `bold ${16 * lineScale}px sans-serif`;
    for (const hole of overlays.holes) { poly(hole.line, false); g.fillText(String(hole.n), hole.green[0] + 4 * lineScale, hole.green[1] - 4 * lineScale); }
    g.font = `bold ${13 * lineScale}px sans-serif`;
    for (const mark of overlays.marks) {
      g.strokeStyle = 'rgba(255,0,0,0.95)'; g.beginPath();
      g.moveTo(mark.p[0] - 9 * lineScale, mark.p[1]); g.lineTo(mark.p[0] + 9 * lineScale, mark.p[1]);
      g.moveTo(mark.p[0], mark.p[1] - 9 * lineScale); g.lineTo(mark.p[0], mark.p[1] + 9 * lineScale); g.stroke();
      g.fillStyle = 'red'; g.fillText(mark.label, mark.p[0] + 11 * lineScale, mark.p[1] - 5 * lineScale);
    }
  }
  return canvas.toDataURL('image/png');
}, { pieces, W, H, grid, overlays, plain, lineScale: Math.max(1, Math.round(0.32 / metres)) });
await browser.close();
const file = path.join(OUT, `${name}${plain ? '-plain' : ''}.png`);
fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`${file} ${W}x${H}px at ${metres} m/px, ${pieces.length} service request${pieces.length === 1 ? '' : 's'} (${SOURCE})`);
