#!/usr/bin/env node
/* The height step at the fixed frontier's edge: the pack's own heightfields
   against the published 1 m tiles, along all four sides of the 2048 m window.

     node ribbingsforsbuild/frontier-edge-step.mjs

   Why it exists. The v2 frontier draws 64 one-metre tiles inside the window and
   the legacy CORE rim, MID and FAR outside it, and what the legacy mesh stands
   on there is `demH`: HF0 (4 m) cross-faded to HF1 (32 m) over HF0's last
   130 m. HF0 spans exactly the window, so that cross-fade lies INSIDE the
   frontier and is never drawn; the first legacy vertex outside the window is
   pure 32 m data meeting 1 m data. Measured 2026-09-10 (this file's output):

     hf0 (4 m)  - published (1 m), on the edge:  median -0.02 m, MAD 0.02, worst 0.05
     hf1 (32 m) - published (1 m), on the edge:  median  0.02 m, MAD 0.25,
                                                  p05/p95 -0.81/+0.97, worst 3.10
     hf1 (32 m) - hf0 (4 m),       on the edge:  median  0.05 m, MAD 0.11, worst 1.23

   So the pack agrees with the tiles (one DTM, item 653_44) and the step is the
   32 m resampling alone -- which is what `legacyBoundaryBlendMetres` in
   v2-ribbingsfors-config.mjs eases over 72 m. Ribbingsfors is authored in the
   grid frame (local = EPSG:3006 minus the origin), so no bridge enters here;
   on a flat-earth pack this comparison needs `legacyGridBridge` first. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPublishedGround, createPublishedGroundLookup } from '../packages/course-v2/published-ground-lookup.mjs';
import { decodeHF } from '../geobuild/lib.mjs';
import { RIBBINGSFORS_V2_CONFIG as CFG } from '../apps/golf/src/engine/v2-ribbingsfors-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ground, readAsset } = openPublishedGround(fs, path, path.join(ROOT, 'apps/golf/public'), CFG.groundId);
const look = createPublishedGroundLookup(ground, readAsset);
console.log('published levels:', look.levels.map(l => `lod ${l.lod} ${l.spacing} m x${l.tiles}`).join(', '));

const hf = JSON.parse(fs.readFileSync(path.join(ROOT, 'ribbingsforsbuild/heightfields.json'), 'utf8'));
const O = CFG.legacyOriginEpsg3006;
const grid = spec => {
  const H = decodeHF(spec);
  return (x, z) => {
    const fx = (x - spec.x0) / spec.dx, fz = (z - spec.z0) / spec.dx;
    if (fx < 0 || fz < 0 || fx > spec.nx - 1.001 || fz > spec.nz - 1.001) return NaN;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * spec.nx + i;
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(H[k], H[k + 1], tx), l(H[k + spec.nx], H[k + spec.nx + 1], tx), tz);
  };
};
const hf0 = grid(hf.hf0), hf1 = grid(hf.hf1);
const pub = (x, z) => look.heightAt(O.easting + x, O.northing - z);
const B = CFG.expectedBoundsEpsg5845;
const W = { x0: B.minEasting - O.easting, x1: B.maxEasting - O.easting, z0: O.northing - B.maxNorthing, z1: O.northing - B.minNorthing };
console.log(`window (local metres): x ${W.x0}..${W.x1}, z ${W.z0}..${W.z1}; hf0 ${hf.hf0.dx} m ends at ${hf.hf0.x0 + (hf.hf0.nx - 1) * hf.hf0.dx}`);

const stats = (label, f, inset = 0, step = 8) => {
  const pts = [];
  for (let t = inset; t <= W.x1 - W.x0 - inset; t += step) {
    pts.push([W.x0 + inset, W.z0 + t], [W.x1 - inset, W.z0 + t], [W.x0 + t, W.z0 + inset], [W.x0 + t, W.z1 - inset]);
  }
  const d = pts.map(([x, z]) => f(x, z)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!d.length) { console.log(`${label}: no finite samples`); return; }
  const median = d[d.length >> 1];
  const mad = d.map(v => Math.abs(v - median)).sort((a, b) => a - b)[d.length >> 1];
  const q = p => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  console.log(`${label}: n ${d.length}, median ${median.toFixed(3)}, MAD ${mad.toFixed(3)}, ` +
    `p05/p95 ${q(0.05).toFixed(3)}/${q(0.95).toFixed(3)}, worst ${Math.max(-d[0], d[d.length - 1]).toFixed(3)} m`);
};
for (const inset of [0, 24, 72]) stats(`hf0 (4 m)  - published (1 m), ${inset} m inside the edge`, (x, z) => hf0(x, z) - pub(x, z), inset);
for (const inset of [0, 24, 72]) stats(`hf1 (32 m) - published (1 m), ${inset} m inside the edge`, (x, z) => hf1(x, z) - pub(x, z), inset);
stats('hf1 (32 m) - hf0 (4 m), on the edge', (x, z) => hf1(x, z) - hf0(x, z));
