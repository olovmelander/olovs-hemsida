#!/usr/bin/env node
// Compare original RGB/RGBA captures with the repository's lossless PNG reader.
// node tools/performance-image-diff.mjs shots/report.json [reference-label]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { decodePNG } from '../geobuild/png.mjs';
const file = path.resolve(process.argv[2]), root = path.dirname(file);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(report.kind, 'shots');
const reference = process.argv[3] ?? 'after';
const refs = report.runs.find(r => r.variant === reference)?.views;
assert.ok(refs?.length, 'reference capture missing');
const results = [];
for (const run of report.runs.filter(r => r.variant !== reference)) for (const view of run.views) {
  const ref = refs.find(r => r.id === view.id);
  assert.ok(ref, 'matching reference view missing');
  const a = decodePNG(fs.readFileSync(path.join(root, ref.image)));
  const b = decodePNG(fs.readFileSync(path.join(root, view.image)));
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  const pixels = a.width * a.height;
  let total = 0, max = 0, changed = 0, over2 = 0, over8 = 0, nonblackA = 0, nonblackB = 0;
  let sumA = 0, sumB = 0, squaredA = 0, squaredB = 0;
  for (let i = 0; i < pixels; i++) {
    let peak = 0, brightA = 0, brightB = 0;
    for (let c = 0; c < 3; c++) {
      const av = a.data[i * a.channels + c], bv = b.data[i * b.channels + c];
      const delta = Math.abs(av - bv); total += delta; peak = Math.max(peak, delta);
      brightA = Math.max(brightA, av); brightB = Math.max(brightB, bv);
    }
    max = Math.max(max, peak); changed += peak > 0; over2 += peak > 2; over8 += peak > 8;
    nonblackA += brightA > 8; nonblackB += brightB > 8;
    sumA += brightA; sumB += brightB; squaredA += brightA * brightA; squaredB += brightB * brightB;
  }
  assert.ok(nonblackA > pixels / 10 && nonblackB > pixels / 10, 'black/empty canvas capture');
  const varianceA = squaredA / pixels - (sumA / pixels) ** 2;
  const varianceB = squaredB / pixels - (sumB / pixels) ** 2;
  assert.ok(varianceA > 25 && varianceB > 25, 'flat/empty presented canvas');
  const row = { id: view.id, reference, variant: run.variant, referenceImage: ref.image, image: view.image,
    dimensions: [a.width, a.height], meanChannelError255: total / (pixels * 3), maxChannelError255: max,
    brightnessStddev: [Math.sqrt(varianceA), Math.sqrt(varianceB)],
    changedPixels: changed, changedPercent: changed * 100 / pixels, pixelsOver2Percent: over2 * 100 / pixels,
    pixelsOver8Percent: over8 * 100 / pixels, shadowBitIdentical: ref.shadowMap.sha256 === view.shadowMap.sha256,
    referenceShadow: ref.shadowMap.sha256, shadow: view.shadowMap.sha256 };
  results.push(row);
  console.log(`${view.id} ${run.variant}: mean ${row.meanChannelError255.toFixed(4)}/255; max ${max}; >2 ${row.pixelsOver2Percent.toFixed(4)}%; shadow identical ${row.shadowBitIdentical}`);
}
fs.writeFileSync(path.join(root, 'pixel-diff.json'), JSON.stringify({ report: path.basename(file), reference, results }, null, 2) + '\n');
