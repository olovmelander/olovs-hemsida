/* A wide georeferenced view of a club's whole property, with the course we
   ALREADY have drawn over it. Whatever golf is visible outside those lines is
   the course we do not have yet -- which is how the second course gets found
   and, later, traced.

   usage: node tools/course-overview.mjs <build> [--zoom 17] [--span 1400]

   Esri tiles are orthorectified, so pixel -> world is affine and a trace made
   on this image needs no registration. The overlay is therefore a real check on
   where things are, not decoration. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const build = args[0] || 'upsalabuild';
const Z = +flag('zoom', 17);
const SPAN = +flag('span', 1400);           /* metres either side of the centre */
const OUT = path.join(ROOT, 'geobuild/cache/overview');

const m = JSON.parse(fs.readFileSync(path.join(ROOT, build, 'course-model.json'), 'utf8'));
const O = m.origin, mLat = m.mPerLat, mLon = m.mPerLon;
const toLatLon = (x, z) => [O.lat - z / mLat, O.lon + x / mLon];
const toTile = (lat, lon, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
};

/* centre on the middle of what we already have, unless told otherwise */
const pts = m.holes.flatMap(h => h.line);
const cx = flag('cx', null) !== null ? +flag('cx')
  : (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2;
const cz = flag('cz', null) !== null ? +flag('cz')
  : (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2;
const [clat, clon] = toLatLon(cx, cz);
const [ftx, fty] = toTile(clat, clon, Z);

/* how many tiles cover SPAN metres at this zoom and latitude */
const mPerTile = 156543.03392 * Math.cos(clat * Math.PI / 180) / (2 ** Z) * 256;
const RAD = Math.max(1, Math.ceil(SPAN / mPerTile));
const x0 = Math.floor(ftx) - RAD, y0 = Math.floor(fty) - RAD, span = RAD * 2 + 1;
const px = (x, z) => {
  const [la, lo] = toLatLon(x, z);
  const [tx, ty] = toTile(la, lo, Z);
  return [(tx - x0) * 256, (ty - y0) * 256];
};

fs.mkdirSync(OUT, { recursive: true });
const tiles = [];
for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < span; dx++) {
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y0 + dy}/${x0 + dx}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    tiles.push({ dx, dy, src: 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64') });
  } catch (e) { console.log(`  tile ${dx},${dy}: ${e.message}`); }
}
console.log(`${tiles.length}/${span * span} tiles at z${Z}, ${mPerTile.toFixed(0)} m per tile`);

const lines = m.holes.map(h => ({ n: h.n, pts: h.line.map(p => px(p[0], p[1])) }));
const greens = m.holes.map(h => px(h.green.c[0], h.green.c[1]));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
const png = await page.evaluate(async ([tiles, lines, greens, span, label]) => {
  const S = span * 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
  for (const t of tiles) {
    const im = new Image();
    await new Promise(ok => { im.onload = ok; im.onerror = ok; im.src = t.src; });
    g.drawImage(im, t.dx * 256, t.dy * 256);
  }
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,60,50,.95)';
  for (const L of lines) {
    g.beginPath();
    L.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.stroke();
  }
  g.fillStyle = '#fff'; g.font = 'bold 26px system-ui';
  greens.forEach((p, i) => {
    g.strokeStyle = '#000'; g.lineWidth = 4;
    g.strokeText(String(i + 1), p[0] + 8, p[1] - 8);
    g.fillText(String(i + 1), p[0] + 8, p[1] - 8);
  });
  g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, 0, S, 40);
  g.fillStyle = '#fff'; g.font = '20px system-ui';
  g.fillText(label, 12, 27);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}, [tiles, lines, greens, span, `${build} — the course we already have is drawn in red`]);
const tag = flag('tag', `z${Z}`);
const file = path.join(OUT, `${build}-${tag}.jpg`);
fs.writeFileSync(file, Buffer.from(png, 'base64'));

/* The frame's own georeference, written beside it. A trace made on this image is
   worth nothing without it, and re-deriving it later by eye is how registration
   error creeps in -- the tiles are orthorectified, so pixel -> world is exactly
   affine and can simply be stated. Sample two pixels and solve. */
const p0 = px(0, 0), p1 = px(100, 100);
const sx = 100 / (p1[0] - p0[0]), sz = 100 / (p1[1] - p0[1]);
const meta = {
  build, zoom: Z, tilesAcross: span, imagePx: span * 256,
  /* world = origin + pixel * scale */
  pixelToWorld: { x0: -p0[0] * sx, z0: -p0[1] * sz, sx, sz },
  note: 'world_x = x0 + px_x * sx ; world_z = z0 + px_z * sz. Esri World Imagery is orthorectified, so this is exact and a trace needs no registration.',
};
fs.writeFileSync(file.replace(/\.jpg$/, '.json'), JSON.stringify(meta, null, 1) + '\n');
console.log('->', path.relative(ROOT, file));
console.log(`   ${meta.pixelToWorld.sx.toFixed(4)} m per pixel; world(0,0) at px ${(-meta.pixelToWorld.x0 / sx).toFixed(0)},${(-meta.pixelToWorld.z0 / sz).toFixed(0)}`);
await browser.close();
