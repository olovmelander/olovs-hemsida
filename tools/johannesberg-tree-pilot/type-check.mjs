#!/usr/bin/env node
/* How well the candidate set's conifer/broadleaf type agrees with the
   interpreter's typed reference crowns, per sample role. The type model is
   fitted on round-1 calibration examples only; used-holdout and the round-2
   evaluation sample never informed it. Adds `typeCheck` to
   candidates-summary.json.
   usage: node tools/johannesberg-tree-pilot/type-check.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { PILOT } from './pilot-config.mjs';
import { ROOT } from './panels.mjs';

const reviewDir = path.join(ROOT, PILOT.reviewDir);
const full = JSON.parse(fs.readFileSync(path.join(ROOT, PILOT.cacheDir, 'candidates', 'candidates-full.json'), 'utf8')).filter(t => ['retain', 'adjust', 'add', 'hold'].includes(t.decision));
const reference = JSON.parse(fs.readFileSync(path.join(reviewDir, 'reference-r2.geojson'), 'utf8'));
const summaryPath = path.join(reviewDir, 'candidates-summary.json');
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const result = { method: 'placed or held candidates matched (nearest within 4 m) to reference crowns typed conifer/broadleaf by the interpreter; calibration was used to fit the model, used-holdout and evaluation were not' };
for (const role of ['calibration', 'used-holdout', 'evaluation']) {
  const refs = reference.features.filter(f => f.properties.role === role && ['conifer', 'broadleaf'].includes(f.properties.type) && f.properties.heightMetres >= 3).map(f => f.properties);
  let matched = 0, correct = 0, unknown = 0, high = 0, highCorrect = 0;
  for (const r of refs) {
    let best = null, distance = 4;
    for (const t of full) { const d = Math.hypot(t.easting - r.easting, t.northing - r.northing); if (d < distance) { distance = d; best = t; } }
    if (!best) continue;
    matched++;
    if (best.type === 'unknown') { unknown++; continue; }
    if (best.type === r.type) correct++;
    if (best.typeConfidence >= 0.8) { high++; if (best.type === r.type) highCorrect++; }
  }
  result[role] = { matched, typed: matched - unknown, correct, accuracyOfTyped: Math.round((1000 * correct) / Math.max(1, matched - unknown)) / 1000, unknown, confidence80: { n: high, accuracy: Math.round((1000 * highCorrect) / Math.max(1, high)) / 1000 } };
}
summary.typeCheck = result;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(result));
