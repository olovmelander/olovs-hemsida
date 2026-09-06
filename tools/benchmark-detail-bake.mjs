#!/usr/bin/env node
/* CPU-only DETAIL construction comparison, not total app startup or GPU FPS.
 * node tools/benchmark-detail-bake.mjs [--out /tmp/detail-bake.json]
 * The baseline equations are independent of the candidate's disabled path. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fbm, hash2 } from '../apps/golf/src/engine/geom.js';
import { fillGroundDetailPixels } from '../apps/golf/src/engine/ground-detail-texture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const size = 512;
const byteLength = size * size * 4;
function legacy(pixels) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const blade = (Math.sin(x * 2.1 + Math.sin(y * 0.7) * 2) * 0.5 + 0.5) * 0.5
      + hash2(x, y) * 0.5;
    const clump = fbm(x * 0.055, y * 0.055, 3) * 0.5 + 0.5;
    const macro = fbm(x * 0.012, y * 0.012, 2) * 0.5 + 0.5;
    pixels[i] = blade * 255;
    pixels[i + 1] = clump * 255;
    pixels[i + 2] = macro * 255;
    pixels[i + 3] = Math.pow(hash2(x + 977, y + 131), 6) * 255;
  }
}
const modes = {
  baseline: legacy,
  disabled: pixels => fillGroundDetailPixels(pixels, size, { seamless: false }),
  seamless: pixels => fillGroundDetailPixels(pixels, size, { seamless: true }),
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pixels = Object.fromEntries(Object.keys(modes).map(key => [key, new Uint8ClampedArray(byteLength)]));
for (let run = 0; run < 3; run++) for (const [key, bake] of Object.entries(modes)) bake(pixels[key]);
if (!Buffer.from(pixels.baseline).equals(Buffer.from(pixels.disabled))) {
  throw new Error('Disabled helper differs from independent baseline');
}
const samples = [];
for (let round = 0; round < 21; round++) {
  const keys = ['baseline', 'disabled', 'seamless'];
  const order = [...keys.slice(round % 3), ...keys.slice(0, round % 3)];
  if (round % 2) order.reverse();
  for (const key of order) {
    const start = performance.now();
    modes[key](pixels[key]);
    samples.push({ round, mode: key, milliseconds: performance.now() - start });
  }
}
const percentile = (sorted, fraction) => sorted[Math.ceil(fraction * sorted.length) - 1];
const summaries = {};
for (const key of Object.keys(modes)) {
  const sorted = samples.filter(row => row.mode === key).map(row => row.milliseconds).sort((a, b) => a - b);
  summaries[key] = { count: sorted.length, medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99) };
}
const report = {
  scope: 'CPU DETAIL pixel construction only; reused output allocation; warmed, rotating and reversed order across baseline, disabled and seamless. Excludes canvas upload, texture mip generation, full startup, memory peaks and GPU frame times.',
  baselineRevision: 'ce3597883a6c7495fc8204c23acac82413f197b7',
  source: {
    helperSha256: sha256(fs.readFileSync(path.join(root, 'apps/golf/src/engine/ground-detail-texture.mjs'))),
    baselineFunctionSha256: sha256(legacy.toString()),
    baselineRgbaSha256: sha256(pixels.baseline),
    candidateRgbaSha256: sha256(pixels.seamless),
  },
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  width: size, height: size, rgbaBytes: byteLength,
  disabledExactBytes: true, warmupPerMode: 3, summaries, samples,
};
const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error('--out requires a file');
  const destination = path.resolve(process.argv[outIndex + 1]);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
