#!/usr/bin/env node
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

runOrtho([
  '--ground', 'bro-hof',
  '--discovery', 'brohofbuild/cache/ortho/stac-orto-2025.json',
  '--out-dir', 'brohofbuild/cache/ortho/2025',
  '--acquisition-out', 'geo_data/course-v2/bro-hof/acquisition/orthophoto-review.json',
  '--window', 'overview-2025:648050,6597450,650150,6599550:0.32:2025:leaf-on',
  '--window', 'stadium-sw-2025:648200,6597450,649250,6598500:0.16:2025:leaf-on',
  '--window', 'stadium-ne-2025:649000,6598000,650150,6599150:0.16:2025:leaf-on',
  '--window', 'castle-n-2025:648100,6598450,649550,6599550:0.16:2025:leaf-on',
]);

runOrtho([
  '--ground', 'bro-hof',
  '--discovery', 'brohofbuild/cache/ortho/stac-orto-2021.json',
  '--out-dir', 'brohofbuild/cache/ortho/2021',
  '--acquisition-out', 'geo_data/course-v2/bro-hof/acquisition/orthophoto-leafoff-2021.json',
  '--window', 'overview-2021:648050,6597450,650150,6599550:0.32:2021:leaf-off',
]);
