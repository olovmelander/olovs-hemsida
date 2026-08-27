/* Fetch the AWS Terrarium elevation tiles the terrain is built from.

   z15 over the course (about 2.15 m per pixel at 63.28 N) and z12 for the vista, so
   the hills across the fjord are real hills rather than fog. Keyless public bucket;
   the Lantmäteriet 1 m lidar would be better and slots in here when Geotorget access
   exists, which is why the decode lives in png.mjs rather than in this script.     */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ORIGIN } from './lib.mjs';

const DEM = path.join(CACHE, 'dem');
const force = process.argv.includes('--force');

const lonToTile = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const latToTile = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);

/* core: the course plus a ring, wide enough that the feather into the surround is
   never visible from a camera standing on the course */
const CORE = { z: 15, pad: 1, box: [18.628, 63.268, 18.706, 63.300] };
/* surround: a 12 km vista in every direction */
const WIDE = { z: 12, pad: 0, box: [ORIGIN.lon - 0.14, ORIGIN.lat - 0.075, ORIGIN.lon + 0.14, ORIGIN.lat + 0.075] };

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 1500 * 2 ** i));
    }
  }
}

fs.mkdirSync(DEM, { recursive: true });
const manifest = { levels: {} };

for (const [name, S] of Object.entries({ core: CORE, wide: WIDE })) {
  const [w, s, e, n] = S.box;
  const x0 = lonToTile(w, S.z) - S.pad, x1 = lonToTile(e, S.z) + S.pad;
  const y0 = latToTile(n, S.z) - S.pad, y1 = latToTile(s, S.z) + S.pad;
  const tiles = [];
  let fetched = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const f = path.join(DEM, `${S.z}-${x}-${y}.png`);
    if (!fs.existsSync(f) || force) {
      const buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${S.z}/${x}/${y}.png`);
      fs.writeFileSync(f, buf); fetched++;
    }
    tiles.push([x, y]);
  }
  manifest.levels[name] = { z: S.z, x0, x1, y0, y1, tiles };
  console.log(`${name}: z${S.z} x${x0}..${x1} y${y0}..${y1} = ${tiles.length} tiles (${fetched} fetched)`);
}

fs.writeFileSync(path.join(DEM, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('wrote', path.relative(process.cwd(), path.join(DEM, 'manifest.json')));
