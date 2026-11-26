#!/usr/bin/env node
/* Tjusta's orthophoto windows: the June 2025 leaf-on flight at its native 0.16 m
   for tracing (six windows over the 18 holes and the practice ground), one 0.32 m
   overview of the same box, and the April 2021 leaf-off flight as the second photo
   year. Pixels stay in the ignored tjustabuild/cache/ortho/; the acquisition records
   (sizes, checksums, capture times) are committed.

   node --env-file=.env tjustabuild/run-ortho-intake.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
const pixiManifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
const script = path.join(ROOT, 'packages/course-geo/intake/acquire-ortho-windows.py');

function runOrtho(args) {
  const res = spawnSync(pixiExe, ['run', '--manifest-path', pixiManifest, '-e', 'mapping', '--frozen', 'python', script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) process.exit(res.status || 1);
}

/* The course outline (OSM way 171945030) spans E 668,500-670,115, N 6,609,117-6,612,091;
   the box adds 150-200 m round it. Columns overlap by 50 m, rows by 50 m. */
const BOX = [668350, 6608950, 670300, 6612250];
const COLS = [[668350, 669350], [669300, 670300]];
const ROWS = [['south', 6608950, 6610100], ['mid', 6610050, 6611200], ['north', 6611150, 6612250]];

const leafOn = [`overview-2025:${BOX.join(',')}:0.32:2025:leaf-on`];
for (const [row, south, north] of ROWS) {
  COLS.forEach(([west, east], i) => {
    leafOn.push(`${row}-${i ? 'e' : 'w'}-2025:${west},${south},${east},${north}:0.16:2025:leaf-on`);
  });
}

/* Two more flights over the 18 holes only (the trace box and 50 m), at 0.25 m: May 2023, when the grass has
   started and the rough has not, and July 2019, an ordinary summer. The June 2025 photo was flown in a
   drought, in which the fairways read like the rough. */
const COURSE = [668450, 6610350, 669810, 6612150];

const CAMPAIGNS = {
  2025: () => runOrtho([
    '--ground', 'tjusta',
    '--discovery', 'tjustabuild/cache/ortho/stac-orto-2025.json',
    '--out-dir', 'tjustabuild/cache/ortho/2025',
    '--acquisition-out', 'geo_data/course-v2/tjusta/acquisition/orthophoto-review.json',
    ...leafOn.flatMap(spec => ['--window', spec]),
  ]),
  2021: () => runOrtho([
    '--ground', 'tjusta',
    '--discovery', 'tjustabuild/cache/ortho/stac-orto-2021.json',
    '--out-dir', 'tjustabuild/cache/ortho/2021',
    '--acquisition-out', 'geo_data/course-v2/tjusta/acquisition/orthophoto-leafoff-2021.json',
    '--window', `overview-2021:${BOX.join(',')}:0.32:2021:leaf-off`,
  ]),
  2023: () => runOrtho([
    '--ground', 'tjusta',
    '--discovery', 'tjustabuild/cache/ortho/stac-orto-2023.json',
    '--out-dir', 'tjustabuild/cache/ortho/2023',
    '--acquisition-out', 'geo_data/course-v2/tjusta/acquisition/orthophoto-spring-2023.json',
    '--window', `course-2023:${COURSE.join(',')}:0.25:2023:leaf-out`,
  ]),
  2019: () => runOrtho([
    '--ground', 'tjusta',
    '--discovery', 'tjustabuild/cache/ortho/stac-orto-2019.json',
    '--out-dir', 'tjustabuild/cache/ortho/2019',
    '--acquisition-out', 'geo_data/course-v2/tjusta/acquisition/orthophoto-summer-2019.json',
    '--window', `course-2019:${COURSE.join(',')}:0.25:2019:leaf-on`,
  ]),
};

// `--only 2023,2019` fetches those flights and leaves the other records (and their pinned checksums) alone.
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : Object.keys(CAMPAIGNS);
for (const year of only) {
  if (!CAMPAIGNS[year]) throw new Error(`no campaign ${year}: ${Object.keys(CAMPAIGNS).join(', ')}`);
  CAMPAIGNS[year]();
}
