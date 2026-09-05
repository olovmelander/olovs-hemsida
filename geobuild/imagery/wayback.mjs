/* Esri World Imagery at z18 over the course, LIVE or as a dated Wayback release.

   The live service is a mosaic of several capture dates; over Veckefjärden it is a
   leaf-on 2025 capture in the north and a leaf-off date in the south (the 1st's green
   under its winter cover). Esri's Wayback service keeps every past release:
     https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}
   with the release list at
     https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
   A release only stores tiles that changed in it (404 otherwise); the imagery "at" a
   release is the latest release <= it that has the tile. Release 27982 (2025-04-24)
   is ONE leaf-on capture over the whole course and is the tracing frame.

   Tiles cache under geobuild/cache/sat18[-<release>]/ as jpg + decoded png.

   Usage:
     node geobuild/imagery/wayback.mjs releases                # list releases with dates
     node geobuild/imagery/wayback.mjs census <x> <z>          # which releases change the tile at a point
     node geobuild/imagery/wayback.mjs fetch [release] [x0 z0 x1 z1]   # cache a box (default the course)
   As a module: import { ensure, rgbAt, mPerPx, pxOf } and set SAT_REL=<release> in the
   environment (or pass release to ensure/rgbAt) to sample a dated capture.        */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from '../png.mjs';
import { ROOT, FRAME, BUILD, jpgToPng } from './lib.mjs';

const Z = 18, n = 2 ** Z;
export const REL = process.env.SAT_REL || '';
/* geobuild keeps its historical cache name; another build's tiles go beside its own cache */
const dirOf = rel => path.join(ROOT, BUILD, 'cache', 'sat18' + (rel ? '-' + rel : ''));
export const toLonLat = (x, z) => [FRAME.lon + x / FRAME.mPerLon, FRAME.lat - z / FRAME.mPerLat];
export const tileF = (lon, lat) => [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
export const pxOf = (x, z) => { const [lon, lat] = toLonLat(x, z); const [tx, ty] = tileF(lon, lat); return [tx * 256, ty * 256]; };
export const mPerPx = (() => { const [a] = pxOf(0, 0), [b] = pxOf(100, 0); return 100 / (b - a); })();
export const tileURL = (rel, ty, tx) => rel
  ? `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/${Z}/${ty}/${tx}`
  : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;

/** Fetch and decode every tile covering the legacy box (x0,z0)-(x1,z1). */
export async function ensure(x0, z0, x1, z1, rel = REL) {
  const DIR = dirOf(rel); fs.mkdirSync(DIR, { recursive: true });
  const [ax, ay] = pxOf(x0, z0), [bx, by] = pxOf(x1, z1);
  const tx0 = Math.floor(Math.min(ax, bx) / 256), tx1 = Math.floor(Math.max(ax, bx) / 256), ty0 = Math.floor(Math.min(ay, by) / 256), ty1 = Math.floor(Math.max(ay, by) / 256);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const jpg = path.join(DIR, `${Z}_${ty}_${tx}.jpg`); if (!fs.existsSync(jpg)) jobs.push({ tx, ty, jpg }); }
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < jobs.length) { const j = jobs[i++]; const r = await fetch(tileURL(rel, j.ty, j.tx)); if (!r.ok) throw new Error(`tile ${j.ty}/${j.tx} ${r.status} (a Wayback release only holds the tiles that changed in it)`); fs.writeFileSync(j.jpg, Buffer.from(await r.arrayBuffer())); } }));
  const todo = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const png = path.join(DIR, `${Z}_${ty}_${tx}.png`); if (!fs.existsSync(png)) todo.push([path.join(DIR, `${Z}_${ty}_${tx}.jpg`), png]); }
  for (let k = 0; k < todo.length; k += 120) await jpgToPng(todo.slice(k, k + 120));
  return { fetched: jobs.length, decoded: todo.length, tiles: (tx1 - tx0 + 1) * (ty1 - ty0 + 1), release: rel || 'live' };
}
const cache = new Map();
function tile(tx, ty, rel) { const k = rel + ':' + tx + ',' + ty; if (!cache.has(k)) { const f = path.join(dirOf(rel), `${Z}_${ty}_${tx}.png`); cache.set(k, fs.existsSync(f) ? decodePNG(fs.readFileSync(f)) : null); } return cache.get(k); }
/** RGB at a legacy point (nearest pixel), or null where no tile is cached. */
export function rgbAt(x, z, rel = REL) {
  const [gx, gy] = pxOf(x, z); const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256); const t = tile(tx, ty, rel); if (!t) return null;
  const px = Math.min(255, Math.floor(gx - tx * 256)), py = Math.min(255, Math.floor(gy - ty * 256)); const ch = t.channels || (t.data.length / (t.width * t.height)); const i = (py * t.width + px) * ch;
  return [t.data[i], t.data[i + 1], t.data[i + 2]];
}
export async function releases() {
  const f = path.join(ROOT, 'geobuild/cache/waybackconfig.json');
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); const r = await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Object.entries(c).map(([id, v]) => ({ id, date: (v.itemTitle.match(/(\d{4}-\d{2}-\d{2})/) || [])[1], title: v.itemTitle })).sort((a, b) => a.date < b.date ? -1 : 1);
}
/** The played ground's box with a 150 m margin, from the model's hole lines and greens. */
export function courseBox() { const m = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD, 'course-model.json'), 'utf8')); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const h of m.holes) for (const p of [...h.line, ...h.green.ring]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0 - 150, z0 - 150, x1 + 150, z1 + 150]; }
if (process.argv[1] && process.argv[1].endsWith('wayback.mjs')) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'releases') { for (const r of await releases()) console.log(r.id.padStart(6), r.date); }
  else if (cmd === 'census') {
    const [gx, gy] = pxOf(+a[0], +a[1]); const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256); const crypto = await import('node:crypto'); const seen = new Set();
    for (const r of await releases()) { const res = await fetch(tileURL(r.id, ty, tx)); if (!res.ok) continue; const h = crypto.createHash('md5').update(Buffer.from(await res.arrayBuffer())).digest('hex').slice(0, 8); if (!seen.has(h)) { seen.add(h); console.log(`${r.date} release ${r.id} new capture ${h}`); } }
    console.log(`${seen.size} distinct captures of tile ${ty}/${tx}`);
  } else if (cmd === 'fetch') { const rel = a[0] || REL; const box = a.length >= 5 ? a.slice(1).map(Number) : courseBox(); console.log(await ensure(...box, rel), 'm/px', mPerPx.toFixed(3)); }
  else console.log('usage: releases | census <x> <z> | fetch [release] [x0 z0 x1 z1]');
}
