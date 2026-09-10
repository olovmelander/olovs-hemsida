#!/usr/bin/env node
/* Fetch the wide Örnsköldsvik-basin extract around Veckefjärden from the raw OSM
   map API, tile by tile. The core build's bbox (18.640-18.710 E, 63.270-63.300 N)
   stops at the edge of the town: Örnsköldsvik's centre and harbour, Skyttis and
   the Paradiskullen ski jumps, Varvsberget's ski slope, the trotting track at
   Skyttis, the E4 and Botniabanan beyond the extract and the hills the course
   looks at all lie outside it. This reaches 6.4 km each way about the frame's
   origin -- the landcover record's own window -- so the surroundings model can
   carry the whole basin the course sits in.

   The map API caps a request at 0.25 deg² and 50 000 nodes; the town centre
   passes 50 000 nodes in well under a square kilometre, so the window is tiled
   at 0.02° x 0.01° and any tile the API refuses (400) is split in four and
   retried. Tiles are cached under geobuild/cache/wide/ (gitignored); pass
   --force to refetch.                                                          */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './lib.mjs';

const DIR = path.join(CACHE, 'wide');
fs.mkdirSync(DIR, { recursive: true });
const force = process.argv.includes('--force');

/* 6.4 km about ORIGIN {63.2845, 18.6735}: 0.0575 deg lat, 0.128 deg lon */
export const WIDE = { lon0: 18.545, lon1: 18.805, lat0: 63.227, lat1: 63.342 };
const DLON = 0.02, DLAT = 0.01;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'olovs-hemsida course build (veckefjarden wide)' } });
    if (res.ok) return await res.text();
    if (res.status === 400) return null;                 /* too many nodes: split */
    console.log(`  ${res.status} ${res.statusText}, retry ${i + 1}`);
    await sleep(2000 * (i + 1));
  }
  throw new Error(`gave up on ${url}`);
}

const f = v => v.toFixed(4);
const tiles = [];
for (let lat = WIDE.lat0; lat < WIDE.lat1 - 1e-9; lat += DLAT)
  for (let lon = WIDE.lon0; lon < WIDE.lon1 - 1e-9; lon += DLON)
    tiles.push([lon, lat, Math.min(lon + DLON, WIDE.lon1), Math.min(lat + DLAT, WIDE.lat1)]);

let fetched = 0, cached = 0, split = 0;
async function fetchTile([a, b, c, d], depth = 0) {
  const name = `tile_${f(a)}_${f(b)}_${f(c)}_${f(d)}.xml`;
  const out = path.join(DIR, name);
  if (fs.existsSync(out) && !force) { cached++; return; }
  const xml = await get(`https://api.openstreetmap.org/api/0.6/map?bbox=${f(a)},${f(b)},${f(c)},${f(d)}`);
  if (xml === null) {
    if (depth > 3) throw new Error(`tile ${name} refused four splits deep`);
    split++;
    const mx = (a + c) / 2, mz = (b + d) / 2;
    for (const t of [[a, b, mx, mz], [mx, b, c, mz], [a, mz, mx, d], [mx, mz, c, d]]) await fetchTile(t, depth + 1);
    return;
  }
  if (!/<osm /.test(xml)) throw new Error(`${name}: not an OSM document`);
  fs.writeFileSync(out, xml);
  fetched++;
  process.stdout.write(`  ${name} ${(xml.length / 1e6).toFixed(2)} MB\n`);
}

for (const t of tiles) await fetchTile(t);
console.log(`wide extract: ${tiles.length} tiles, ${fetched} fetched, ${cached} cached, ${split} split`);
