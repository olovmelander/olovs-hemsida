/* Fetch orthorectified satellite imagery over the cape.

   Esri World Imagery, two levels with two jobs. z17 (~0.55 m/px here) covers the
   tree-cover frame — the course padded out to the two lakes and the village — for the canopy classifier, exactly as at Veckefjärden. z18
   (~0.27 m/px) covers just the course, because HERE the imagery is the only
   source of green/fairway/bunker outlines: OSM has none of them, so the course
   is traced from these tiles, anchored by the club's GPS survey.

   Run:  node nvgkbuild/fetch-sat.mjs   -> nvgkbuild/cache/sat/{17,18}_{x}_{y}.jpg */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ORIGIN, M_PER_LON } from './lib.mjs';

/* tree-cover frame, local metres: course bbox padded ~700 m, stretched to take
   in Storsanden's dunes (north) and the village edge (south-west) */
const FRAME17 = { z: 17, x0: -1300, x1: 1000, z0: -1300, z1: 1100 };
/* tracing frame: the 18 holes with a modest ring */
const FRAME18 = { z: 18, x0: -900, x1: 600, z0: -900, z1: 700 };

const tileOf = (x, z, Z) => {
  const lon = x / M_PER_LON + ORIGIN.lon;
  const lat = ORIGIN.lat - z / 111320;
  const n = 2 ** Z;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)];
};

const dir = path.join(CACHE, 'sat');
fs.mkdirSync(dir, { recursive: true });

const jobs = [];
for (const F of [FRAME17, FRAME18]) {
  const [tx0, ty0] = tileOf(F.x0, F.z0, F.z);
  const [tx1, ty1] = tileOf(F.x1, F.z1, F.z);
  let n = 0;
  for (let ty = Math.min(ty0, ty1) - 1; ty <= Math.max(ty0, ty1) + 1; ty++)
    for (let tx = Math.min(tx0, tx1) - 1; tx <= Math.max(tx0, tx1) + 1; tx++) { jobs.push([F.z, tx, ty]); n++; }
  console.log(`z${F.z}: ${n} tiles over x ${F.x0}..${F.x1}, z ${F.z0}..${F.z1}`);
}

let done = 0, fetched = 0;
const worker = async () => {
  for (;;) {
    const job = jobs.pop();
    if (!job) return;
    const [Z, tx, ty] = job;
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
          if (a === 2) console.error(`z${Z} tile ${tx},${ty}: ${e.message}`);
          await new Promise(res => setTimeout(res, 800 * (a + 1)));
        }
      }
    }
    if (++done % 80 === 0) console.log(`  ${done} done`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`done: ${done} tiles (${fetched} fetched fresh) in ${path.relative(process.cwd(), dir)}`);
