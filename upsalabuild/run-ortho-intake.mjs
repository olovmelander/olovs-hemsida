#!/usr/bin/env node
/* Upsala's orthophoto windows for pipeline v2: the June 2025 leaf-on flight at its native 0.16 m for tracing
   (six windows over both routings and the practice ground), one 0.32 m overview of the same box, and older
   flights as further photo years (a leaf-off spring flight, and a summer one) over the holes only. Pixels stay
   in the ignored upsalabuild/cache/ortho/; the acquisition records (sizes, checksums, capture times) are
   committed under geo_data/course-v2/upsala/acquisition/.

   node --env-file=.env upsalabuild/run-ortho-intake.mjs --discover          # STAC search for each flight, no pixels
   node --env-file=.env upsalabuild/run-ortho-intake.mjs [--only 2025,2021]   # the windows */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STAC_ENDPOINTS, stacSearch } from '../packages/course-geo/acquisition/stac.mjs';

const ROOT = process.cwd();
const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
const pixiManifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
const script = path.join(ROOT, 'packages/course-geo/intake/acquire-ortho-windows.py');
const CACHE = 'upsalabuild/cache/ortho';

function runOrtho(args) {
  const res = spawnSync(pixiExe, ['run', '--manifest-path', pixiManifest, '-e', 'mapping', '--frozen', 'python', script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) process.exit(res.status || 1);
}

/* Both routings' played extent (the two committed EPSG:3006 migrations) is E 639,300-640,986,
   N 6,635,567-6,636,724; the box adds about 200 m round it. Three columns and two rows, overlapping 50 m. */
const BOX = [639100, 6635350, 641200, 6636950];
const COLS = [[639100, 639850], [639800, 640550], [640500, 641200]];
const ROWS = [['south', 6635350, 6636200], ['north', 6636150, 6636950]];
/* The holes only, for the other photo years: the box less 100 m. */
const COURSE = [639200, 6635450, 641100, 6636850];

/* WGS 84 box for the STAC search: generously round BOX (the search only chooses 2.5 km items). */
const BBOX_WGS84 = [17.47, 59.83, 17.53, 59.853];

const FLIGHTS = {
  2025: { collection: 'orto-o2-2025', resolution: 0.16 },
  2023: { collection: 'orto-o2-2023', resolution: 0.16 },
  2021: { collection: 'orto-o2-2021', resolution: 0.16 },
  2019: { collection: 'orto-o2-2019', resolution: 0.25 },
};

function itemSummary(feature) {
  const props = feature.properties || {};
  const data = feature.assets?.data || {};
  return {
    id: feature.id,
    collection: feature.collection,
    capturedAt: props.datetime || props.start_datetime || null,
    projBbox: props['proj:bbox'] || data['proj:bbox'] || null,
    resolutionMetres: props.upplosning || props.gsd || null,
    spectral: props.spektral || props.spectral || null,
    flightAltitudeMetres: props.flyghojd || null,
    assets: { data: { href: data.href, bytes: data['file:size'] || null, sha256: null } },
  };
}

async function discover(year) {
  const flight = FLIGHTS[year];
  const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: BBOX_WGS84, collections: [flight.collection] });
  const doc = {
    groundId: 'upsala',
    observedOn: new Date().toISOString().slice(0, 10),
    source: `${STAC_ENDPOINTS.imagery}search`,
    orthophoto: {
      collection: flight.collection,
      resolutionMetres: flight.resolution,
      items: features.map(itemSummary),
    },
  };
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `stac-orto-${year}.json`);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
  const dates = [...new Set(doc.orthophoto.items.map(item => String(item.capturedAt).slice(0, 10)))];
  console.log(`${year}: ${doc.orthophoto.items.length} items, flown ${dates.join(', ')} -> ${file}`);
}

const leafOn = [`overview-2025:${BOX.join(',')}:0.32:2025:leaf-on`];
for (const [row, south, north] of ROWS) {
  COLS.forEach(([west, east], i) => {
    leafOn.push(`${row}-${['w', 'm', 'e'][i]}-2025:${west},${south},${east},${north}:0.16:2025:leaf-on`);
  });
}

const CAMPAIGNS = {
  2025: () => runOrtho([
    '--ground', 'upsala',
    '--discovery', `${CACHE}/stac-orto-2025.json`,
    '--out-dir', `${CACHE}/2025`,
    '--acquisition-out', 'geo_data/course-v2/upsala/acquisition/orthophoto-review.json',
    ...leafOn.flatMap(spec => ['--window', spec]),
  ]),
  2023: () => runOrtho([
    '--ground', 'upsala',
    '--discovery', `${CACHE}/stac-orto-2023.json`,
    '--out-dir', `${CACHE}/2023`,
    '--acquisition-out', 'geo_data/course-v2/upsala/acquisition/orthophoto-2023.json',
    '--window', `course-2023:${COURSE.join(',')}:0.25:2023:${process.env.UPSALA_LEAF_2023 || 'leaf-on'}`,
  ]),
  2021: () => runOrtho([
    '--ground', 'upsala',
    '--discovery', `${CACHE}/stac-orto-2021.json`,
    '--out-dir', `${CACHE}/2021`,
    '--acquisition-out', 'geo_data/course-v2/upsala/acquisition/orthophoto-2021.json',
    '--window', `course-2021:${COURSE.join(',')}:0.25:2021:${process.env.UPSALA_LEAF_2021 || 'leaf-off'}`,
  ]),
  2019: () => runOrtho([
    '--ground', 'upsala',
    '--discovery', `${CACHE}/stac-orto-2019.json`,
    '--out-dir', `${CACHE}/2019`,
    '--acquisition-out', 'geo_data/course-v2/upsala/acquisition/orthophoto-2019.json',
    '--window', `course-2019:${COURSE.join(',')}:0.25:2019:${process.env.UPSALA_LEAF_2019 || 'leaf-on'}`,
  ]),
};

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : Object.keys(CAMPAIGNS);
for (const year of only) if (!CAMPAIGNS[year]) throw new Error(`no flight ${year}: ${Object.keys(CAMPAIGNS).join(', ')}`);
if (process.argv.includes('--discover')) {
  for (const year of only) await discover(year);
} else {
  for (const year of only) CAMPAIGNS[year]();
}
