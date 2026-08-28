/* Fetch orthorectified satellite imagery over the course and its surroundings.

   Esri World Imagery tiles, Web Mercator z17 (~0.54 m/px at this latitude). Unlike
   the club's hole plans, these need no registration at all -- a tile's coordinates
   ARE its georeference -- so the canopy raster built from them carries no similarity-
   fit error. The extent matches tree-cover.json's frame exactly, so the labelled
   probe set keeps meaning what it meant.

   Run:  node geobuild/fetch-sat.mjs        -> geobuild/cache/sat/17_{x}_{y}.jpg     */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './lib.mjs';

const Z = 17;
const LON0 = 18.6735, LAT0 = 63.2845;
/* the tree-cover frame: course bbox padded 700 m, plus a margin tile each way */
const X0 = -1440, X1 = 912, Z0 = -1880, Z1 = 955;

const tileOf = (x, z) => {
  const lon = x / 50045.09 + LON0;
  const lat = LAT0 - z / 111320;
  const n = 2 ** Z;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)];
};
const [tx0, ty0] = tileOf(X0, Z0);
const [tx1, ty1] = tileOf(X1, Z1);
const dir = path.join(CACHE, 'sat');
fs.mkdirSync(dir, { recursive: true });

const jobs = [];
for (let ty = Math.min(ty0, ty1) - 1; ty <= Math.max(ty0, ty1) + 1; ty++)
  for (let tx = Math.min(tx0, tx1) - 1; tx <= Math.max(tx0, tx1) + 1; tx++)
    jobs.push([tx, ty]);
console.log(`${jobs.length} tiles at z${Z} over x ${X0}..${X1}, z ${Z0}..${Z1}`);

let done = 0, fetched = 0;
const worker = async () => {
  for (;;) {
    const job = jobs.pop();
    if (!job) return;
    const [tx, ty] = job;
    const f = path.join(dir, `${Z}_${tx}_${ty}.jpg`);
    if (!fs.existsSync(f) || fs.statSync(f).size < 500) {
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;
      for (let a = 0; a < 3; a++) {
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error('http ' + r.status);
          fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
          fetched++;
          break;
        } catch (e) {
          if (a === 2) console.error(`tile ${tx},${ty}: ${e.message}`);
          await new Promise(res => setTimeout(res, 800 * (a + 1)));
        }
      }
    }
    if (++done % 60 === 0) console.log(`  ${done} done`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`done: ${done} tiles (${fetched} fetched fresh) in ${path.relative(process.cwd(), dir)}`);
