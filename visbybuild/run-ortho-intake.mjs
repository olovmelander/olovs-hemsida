#!/usr/bin/env node
/* Kronholmen's orthophoto windows for pipeline v2 (27 November 2026): the newest flight,
   10 April 2026 (leaf-off), at its native 0.16 m for tracing, in four windows over the 18
   holes and 200 m, with a 0.32 m overview of the same box; the 14 May 2024 flight at
   0.16 m as the second photo year (leaf-out); and the 4 June 2022 summer flight, the one
   the September model was traced from (through the municipality's copy), at 0.25 m.
   Pixels stay in the ignored visbybuild/cache/ortho/; the acquisition records (sizes,
   checksums, capture times) are committed. The STAC records come from
   stac-ortho-discovery.mjs, which this account could read for every flight on that day.

   node --env-file=<checkout>/.env visbybuild/run-ortho-intake.mjs [--only 2026,2024,2022] */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
/* a worktree uses its main checkout's environment: BANVY_PIXI_MANIFEST=<checkout>/packages/course-geo/toolchain/pixi.toml */
const pixiManifest = process.env.BANVY_PIXI_MANIFEST ?? path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
const script = path.join(ROOT, 'packages/course-geo/intake/acquire-ortho-windows.py');

function runOrtho(args) {
  const res = spawnSync(pixiExe, ['run', '--manifest-path', pixiManifest, '-e', 'mapping', '--frozen', 'python', script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) process.exit(res.status || 1);
}

/* The 18 holes span E 687,165-688,307, N 6,370,568-6,371,918 (the model's hole lines and
   greens); the box adds about 200 m. Columns and rows overlap by 50 m. */
const BOX = [686950, 6370350, 688550, 6372150];
const COLS = [[686950, 687800], [687750, 688550]];
const ROWS = [['south', 6370350, 6371300], ['north', 6371250, 6372150]];
const tiles = (year, resolution, leaf) => ROWS.flatMap(([row, south, north]) =>
  COLS.map(([west, east], i) => `${row}-${i ? 'e' : 'w'}-${year}:${west},${south},${east},${north}:${resolution}:${year}:${leaf}`));

const CAMPAIGNS = {
  2026: () => runOrtho([
    '--ground', 'visby',
    '--discovery', 'visbybuild/cache/ortho/stac-orto-f2-2026.json',
    '--out-dir', 'visbybuild/cache/ortho/2026',
    '--acquisition-out', 'geo_data/course-v2/visby/acquisition/orthophoto-2026.json',
    '--window', `overview-2026:${BOX.join(',')}:0.32:2026:leaf-off`,
    ...tiles(2026, 0.16, 'leaf-off').flatMap(spec => ['--window', spec]),
  ]),
  2024: () => runOrtho([
    '--ground', 'visby',
    '--discovery', 'visbybuild/cache/ortho/stac-orto-f2-2024.json',
    '--out-dir', 'visbybuild/cache/ortho/2024',
    '--acquisition-out', 'geo_data/course-v2/visby/acquisition/orthophoto-2024.json',
    ...tiles(2024, 0.16, 'leaf-out').flatMap(spec => ['--window', spec]),
  ]),
  2022: () => runOrtho([
    '--ground', 'visby',
    '--discovery', 'visbybuild/cache/ortho/stac-orto-f2-2022.json',
    '--out-dir', 'visbybuild/cache/ortho/2022',
    '--acquisition-out', 'geo_data/course-v2/visby/acquisition/orthophoto-2022.json',
    '--window', `course-2022:${BOX.join(',')}:0.25:2022:leaf-on`,
  ]),
};

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : Object.keys(CAMPAIGNS);
for (const year of only) {
  if (!CAMPAIGNS[year]) throw new Error(`no campaign ${year}: ${Object.keys(CAMPAIGNS).join(', ')}`);
  CAMPAIGNS[year]();
}
