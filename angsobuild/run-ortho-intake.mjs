#!/usr/bin/env node
/* Ängsö's photo years for pipeline v2's looks (27 November 2026).

   The September review traced every outline on the 24 April 2025 flight, in 19 pinned windows
   (angsobuild/mapping/lm-ortho-acquire.py, which stays the source of the outlines). The looks of
   pipeline v2 want the whole course in more than one year: a deck rebuilt or a tee moved between two
   flights shows at once. Four flights cover the course at 0.16 m with the infrared band:

     2025-04-24  spring, leaf-off   the tracing photo, at 0.16 m (two windows, north and south)
     2023-05-11  spring             after hole 1 was lengthened (cards of 2020 and 2023), at 0.16 m
     2021-04-14  spring             three weeks after the laser (2021-03-20), at 0.25 m
     2019-07-14  summer, leaf-on    the course before both, at 0.25 m

   Pixels stay in the ignored angsobuild/cache/ortho/<year>/; the acquisition records (sizes, checksums,
   capture times) are committed under geo_data/course-v2/angso/acquisition/.

   node --env-file=.env angsobuild/run-ortho-intake.mjs [--discover] [--only 2025,2019] */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STAC_ENDPOINTS, stacSearch, summarizeFeature, projectedBbox } from '../packages/course-geo/acquisition/stac.mjs';

const ROOT = process.cwd();
const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
const pixiManifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
const script = path.join(ROOT, 'packages/course-geo/intake/acquire-ortho-windows.py');
const CACHE = 'angsobuild/cache/ortho';

/* The pinned ground-overview window of the September plan (lm-ortho-plan-2026-09-09.json): every hole,
   the practice ground and the clubhouse with their margin. */
const BOX = [605118.4, 6604537.6, 606213.6, 6606905.6];
const MID = 6605721.6;
const HALVES = [['south', BOX[1], MID + 40], ['north', MID - 40, BOX[3]]];
const WGS84 = [16.855, 59.56, 16.885, 59.585];

/** One discovery file per flight that covers the box, in the shape acquire-ortho-windows.py reads. */
async function discover() {
  const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: WGS84 });
  const by = new Map();
  for (const f of features) {
    const b = projectedBbox(f);
    if (!b || b[2] <= BOX[0] || b[0] >= BOX[2] || b[3] <= BOX[1] || b[1] >= BOX[3]) continue;
    if (!by.has(f.collection)) by.set(f.collection, []);
    by.get(f.collection).push(f);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [collection, list] of [...by].sort()) {
    const items = list.map(f => {
      const s = summarizeFeature(f);
      return { id: s.id, collection, capturedAt: s.capturedAt, projBbox: s.projBbox, resolutionMetres: s.resolutionMetres,
        spectral: s.spectralType, assets: { data: { href: s.assets.data?.href, bytes: s.assets.data?.bytes, sha256: s.assets.data?.sha256 } } };
    });
    fs.writeFileSync(path.join(CACHE, `stac-${collection}.json`), JSON.stringify({ groundId: 'angso',
      observedOn: new Date().toISOString().slice(0, 10), source: `${STAC_ENDPOINTS.imagery}search`,
      orthophoto: { collection, resolutionMetres: items[0].resolutionMetres, items } }, null, 1) + '\n');
    console.log(collection, items.length, [...new Set(items.map(i => (i.capturedAt || '').slice(0, 10)))].join(' '));
  }
}

function runOrtho(args) {
  const res = spawnSync(pixiExe, ['run', '--manifest-path', pixiManifest, '-e', 'mapping', '--frozen', 'python', script, ...args], {
    stdio: 'inherit', env: process.env,
  });
  if (res.status !== 0) process.exit(res.status || 1);
}

const halves = (year, res, season) => HALVES.map(([name, south, north]) => `${name}-${year}:${BOX[0]},${south},${BOX[2]},${north}:${res}:${year}:${season}`);
const whole = (year, res, season) => [`course-${year}:${BOX.join(',')}:${res}:${year}:${season}`];
const FLIGHTS = {
  2025: { windows: halves(2025, 0.16, 'leaf-off'), record: 'orthophoto-spring-2025.json' },
  2023: { windows: halves(2023, 0.16, 'leaf-out'), record: 'orthophoto-spring-2023.json' },
  2021: { windows: whole(2021, 0.25, 'leaf-off'), record: 'orthophoto-spring-2021.json' },
  2019: { windows: whole(2019, 0.25, 'leaf-on'), record: 'orthophoto-summer-2019.json' },
};

if (process.argv.includes('--discover')) await discover();
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : Object.keys(FLIGHTS);
for (const year of only) {
  const flight = FLIGHTS[year];
  if (!flight) throw new Error(`no flight ${year}: ${Object.keys(FLIGHTS).join(', ')}`);
  runOrtho(['--ground', 'angso', '--discovery', `${CACHE}/stac-orto-o2-${year}.json`, '--out-dir', `${CACHE}/${year}`,
    '--acquisition-out', `geo_data/course-v2/angso/acquisition/${flight.record}`, ...flight.windows.flatMap(w => ['--window', w])]);
}
