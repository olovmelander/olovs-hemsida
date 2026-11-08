#!/usr/bin/env node
/* Round 2 of the Johannesberg tree method: the type-aware detector.

   usage: PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/round2.mjs --tune    (calibration windows only)
          PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/round2.mjs --score   (all methods, all roles)

   --tune runs a coordinate descent over the type map and the per-type
   detector parameters, starting from the round-1 lock, on the calibration
   windows only, ranked as in round 1 (F1, then crown IoU, then centre
   offset; a tie keeps the current value). The trajectory and the selection
   are written to detector-lock-r2.json. --score refuses to run without that
   lock and scores the published population, the current 1 m detector, the
   round-1 detector (detector-lock.json, unchanged) and the round-2 detector
   on the calibration, used-holdout (round-1 held-out, now seen) and the new
   evaluation windows, with the same one-to-one 4 m rule. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT, sampleFile } from './pilot-config.mjs';
import { ROOT, loadMosaic, loadRaster } from './panels.mjs';
import { crop, currentDetector, loadReference, newDetector, scoreWindows } from './benchmark.mjs';
import { publishedPopulation } from './published-population.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { TYPE_BROADLEAF, TYPE_CONIFER, detectTreesTyped, typeMapFromPhoto } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';

const args = process.argv.slice(2);
const reviewDir = path.join(ROOT, PILOT.reviewDir);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const quantile = (values, q) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

export const SEARCH = Object.freeze([
  ['type.coniferShare', [0.35, 0.45, 0.5, 0.55, 0.65]],
  ['type.radiusSlope', [0.05, 0.1, 0.15, 0.25]],
  ['conifer.smoothingSigmaMetres', [0, 0.25, 0.4, 0.6]],
  ['conifer.windowBaseMetres', [0.5, 1, 1.5, 2]],
  ['conifer.windowSlope', [0, 0.03, 0.05, 0.08]],
  ['conifer.windowMinimumMetres', [0.75, 1, 1.5]],
  ['conifer.windowMaximumMetres', [2, 2.5, 3, 4]],
  ['conifer.prominenceMetres', [0, 0.5, 1]],
  ['conifer.position', ['apex', 'centroid']],
  ['broadleaf.smoothingSigmaMetres', [0.4, 0.6, 0.8, 1, 1.25]],
  ['broadleaf.windowBaseMetres', [1, 1.5, 2, 2.5, 3]],
  ['broadleaf.windowSlope', [0, 0.05, 0.08, 0.12]],
  ['broadleaf.windowMinimumMetres', [1, 1.5, 2, 3]],
  ['broadleaf.windowMaximumMetres', [3, 4, 5, 6]],
  ['broadleaf.prominenceMetres', [0, 0.5, 1, 1.5, 2.5]],
  ['broadleaf.prominenceFraction', [0, 0.05, 0.1, 0.2]],
  ['broadleaf.position', ['apex', 'centroid']],
  ['shared.extentFraction', [0.15, 0.2, 0.3]],
  ['conifer.minimumCandidateHeightMetres', [2, 2.5, 3]],
  ['broadleaf.minimumCandidateHeightMetres', [2, 2.5, 3]],
  ['shared.minimumCrownAreaSquareMetres', [0.25, 1, 2, 4]],
  /* the oversized-crown split is searched as one joint choice: its settings only act together */
  ['split', [{ areaFactor: 0, allometryBaseMetres: 1, allometrySlope: 0.1, fineSigmaMetres: 0.25, windowMetres: 1.25, minimumSeparationMetres: 2, seedFraction: 0.6 },
    ...[1.5, 2, 3].flatMap(areaFactor => [0.06, 0.1, 0.14].flatMap(allometrySlope => [0, 0.25].flatMap(fineSigmaMetres => [1, 1.5].flatMap(windowMetres => [1.5, 2, 2.5].flatMap(minimumSeparationMetres => [0.5, 0.7, 0.85].map(seedFraction => ({ areaFactor, allometryBaseMetres: 1, allometrySlope, fineSigmaMetres, windowMetres, minimumSeparationMetres, seedFraction }))))))) ]],
]);

function startFromRound1(round1) {
  const p = round1.selected.parameters;
  const typeParams = { smoothingSigmaMetres: p.smoothingSigmaMetres, windowBaseMetres: p.windowBaseMetres, windowSlope: p.windowSlope, windowMinimumMetres: p.windowMinimumMetres, windowMaximumMetres: p.windowMaximumMetres, minimumCandidateHeightMetres: p.minimumCandidateHeightMetres, prominenceMetres: p.minimumProminenceMetres || 0, prominenceFraction: 0, position: round1.selected.position };
  return {
    type: { ndviThreshold: 0.12, coniferShare: 0.5, radiusBaseMetres: 1.5, radiusSlope: 0.15 },
    conifer: { ...typeParams },
    broadleaf: { ...typeParams },
    shared: { seedFraction: p.seedFraction, crownFraction: p.crownFraction, maximumCrownRadiusMetres: p.maximumCrownRadiusMetres, extentFraction: p.extentFraction, minimumCrownAreaSquareMetres: p.minimumCrownAreaSquareMetres },
    split: { areaFactor: 0, allometryBaseMetres: 1, allometrySlope: 0.1, fineSigmaMetres: 0.25, windowMetres: 1.25, minimumSeparationMetres: 2, seedFraction: 0.6 },
  };
}

const setPath = (object, key, value) => { const [a, b] = key.split('.'); return b === undefined ? { ...object, [a]: value } : { ...object, [a]: { ...object[a], [b]: value } }; };
const getPath = (object, key) => { const [a, b] = key.split('.'); return b === undefined ? object[a] : object[a][b]; };

/** Crops, their photo patch and cached smoothing per sigma. */
export function prepareWindows(windows, chm, m21) {
  return windows.map(w => {
    const cropped = crop(chm, w.bbox);
    return { window: w, cropped, sigmaCache: new Map() };
  }).map(entry => ({ ...entry, m21 }));
}

export function typedPredictions(entry, parameters, typeCache = new Map()) {
  const { cropped } = entry;
  const typeKey = JSON.stringify(parameters.type);
  let typeMap = typeCache.get(entry.window.id + typeKey);
  if (!typeMap) { typeMap = typeMapFromPhoto(cropped.grid, cropped.values, entry.m21, parameters.type).type; typeCache.set(entry.window.id + typeKey, typeMap); }
  const smooth = sigma => { if (!entry.sigmaCache.has(sigma)) entry.sigmaCache.set(sigma, smoothChm(cropped.grid, cropped.values, sigma)); return entry.sigmaCache.get(sigma); };
  const surfaces = { [TYPE_CONIFER]: smooth(parameters.conifer.smoothingSigmaMetres), [TYPE_BROADLEAF]: smooth(parameters.broadleaf.smoothingSigmaMetres) };
  const { crowns } = detectTreesTyped(cropped.grid, cropped.values, typeMap, parameters, { surfaces });
  return crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, radius: c.equivalentRadiusMetres, height: c.heightMetres, type: c.type }));
}

const better = (a, b) => (a.f1 !== b.f1 ? a.f1 > b.f1 : a.iou !== b.iou ? a.iou > b.iou : a.offset < b.offset);

function tune(reference) {
  const round1 = JSON.parse(fs.readFileSync(path.join(reviewDir, 'detector-lock.json'), 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const m21 = loadMosaic('2021');
  const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
  const entries = prepareWindows(calibration, chm, m21);
  const typeCache = new Map();
  const evaluate = parameters => {
    const predictions = new Map(entries.map(e => [e.window.id, typedPredictions(e, parameters, typeCache)]));
    const s = scoreWindows(reference, predictions, calibration.map(w => w.id));
    return { f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra };
  };
  let current = startFromRound1(round1);
  let best = evaluate(current);
  const trajectory = [{ step: 'start (round-1 settings for both types)', ...best }];
  let evaluations = 1;
  for (let pass = 1; pass <= 6; pass++) {
    let changed = false;
    for (const [key, values] of SEARCH) {
      for (const value of values) {
        if (JSON.stringify(getPath(current, key)) === JSON.stringify(value)) continue;
        const candidate = setPath(current, key, value);
        if (getPath(candidate, 'conifer.windowMaximumMetres') < getPath(candidate, 'conifer.windowMinimumMetres')) continue;
        if (getPath(candidate, 'broadleaf.windowMaximumMetres') < getPath(candidate, 'broadleaf.windowMinimumMetres')) continue;
        const score = evaluate(candidate);
        evaluations++;
        if (better(score, best)) { current = candidate; best = score; changed = true; trajectory.push({ step: `pass ${pass}: ${key} = ${JSON.stringify(value)}`, ...score }); }
      }
    }
    if (!changed) break;
  }
  const lock = {
    schemaVersion: 1,
    kind: 'detector-lock',
    round: 2,
    method: 'type-aware detector (tree-detect-v2.mjs detectTreesTyped): April-2021 conifer map before detection, per-type smoothing / window / merge / position, simultaneous growth',
    frozenAt: new Date().toISOString(),
    referenceLockSha256: sha(path.join(reviewDir, sampleFile('reference-lock'))),
    chmSha256: chm.sidecar.sha256,
    code: Object.fromEntries(['packages/course-v2/vegetation/tree-detect-v2.mjs', 'packages/course-v2/vegetation/pit-free-chm.mjs', 'packages/course-v2/vegetation/crown-detect.mjs', 'tools/johannesberg-tree-pilot/round2.mjs', 'tools/johannesberg-tree-pilot/benchmark.mjs'].map(f => [f, sha(path.join(ROOT, f))])),
    selection: 'calibration windows only; coordinate descent from the round-1 lock over SEARCH, ranked by F1, then mean crown IoU, then median centre offset; ties keep the current value',
    search: Object.fromEntries(SEARCH.map(([k, v]) => [k, k === 'split' ? `${v.length} joint settings (areaFactor 0 | 1.5, 2, 3 x slope 0.06, 0.1, 0.14 x fine sigma 0, 0.25 x window 1, 1.5 x separation 1.5, 2, 2.5 x seed fraction 0.5, 0.7, 0.85)` : v])),
    evaluations,
    selected: { parameters: current, calibration: best },
    trajectory,
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    photoDetector: 'not run: the owner deferred the GPU photo-detector experiment',
  };
  fs.writeFileSync(path.join(reviewDir, sampleFile('detector-lock')), JSON.stringify(lock, null, 2) + '\n');
  console.log(JSON.stringify({ selected: lock.selected, evaluations, steps: trajectory.length }, null, 1));
}

function score(reference) {
  const lock = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('detector-lock')), 'utf8'));
  if (lock.referenceLockSha256 !== sha(path.join(reviewDir, sampleFile('reference-lock')))) throw new Error('round-2 detector lock belongs to another reference');
  const round1 = JSON.parse(fs.readFileSync(path.join(reviewDir, 'detector-lock.json'), 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const legacy = loadRaster('chm-legacy-100');
  const m21 = loadMosaic('2021');
  const windows = reference.windows.windows;
  const all = windows.map(w => w.bbox).reduce((a, b) => [Math.min(a[0], b[0]) - 10, Math.min(a[1], b[1]) - 10, Math.max(a[2], b[2]) + 10, Math.max(a[3], b[3]) + 10]);
  const published = publishedPopulation({ bbox: all });
  const byWindow = fn => new Map(windows.map(w => [w.id, fn(w)]));
  const entries = new Map(prepareWindows(windows, chm, m21).map(e => [e.window.id, e]));
  const methods = {
    'published-individuals': byWindow(() => published.records.map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres }))),
    'published-individuals+stands': byWindow(() => [...published.records, ...published.standTrees].map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres }))),
    'current-detector-all-crowns': byWindow(w => currentDetector(crop(legacy, w.bbox))),
    'round1-detector': byWindow(w => newDetector(crop(chm, w.bbox), round1.selected.parameters, { position: round1.selected.position })),
    'round2-detector': byWindow(w => typedPredictions(entries.get(w.id), lock.selected.parameters)),
  };
  const roles = Object.fromEntries(['calibration', 'used-holdout', 'evaluation'].map(role => [role, windows.filter(w => w.role === role).map(w => w.id)]));
  const out = { schemaVersion: 1, kind: 'tree-benchmark', round: 2, scoredAt: new Date().toISOString(), referenceLock: reference.lock.hashes, detectorLockSha256: sha(path.join(reviewDir, sampleFile('detector-lock'))), round1DetectorLockSha256: sha(path.join(reviewDir, 'detector-lock.json')), publishedGroundManifest: published.groundManifestUrl, matchingRule: reference.windows.matchingRule, gate: { precision: 0.9, recall: 0.9, on: 'evaluation (new, unseen held-out)' }, roles, results: {} };
  for (const [name, predictions] of Object.entries(methods)) {
    out.results[name] = {};
    for (const [role, ids] of Object.entries(roles)) {
      const { pairs, ...rest } = scoreWindows(reference, predictions, ids);
      out.results[name][role] = { ...rest, matchedReferenceIds: pairs.map(p => p.ref) };
      out.results[name][`${role}Pairs`] = pairs.map(p => ({ ref: p.ref, offset: round(p.offset, 2), iou: round(p.iou, 3), heightError: round(p.heightError, 2) }));
    }
  }
  out.paired = {};
  for (const role of Object.keys(roles)) {
    for (const baseline of ['published-individuals+stands', 'current-detector-all-crowns', 'round1-detector']) {
      const a = new Map(out.results[baseline][`${role}Pairs`].map(p => [p.ref, p]));
      const b = new Map(out.results['round2-detector'][`${role}Pairs`].map(p => [p.ref, p]));
      const both = [...a.keys()].filter(id => b.has(id)).sort();
      const stat = map => ({ offsetMedian: round(quantile(both.map(id => map.get(id).offset), 0.5), 2), offsetP95: round(quantile(both.map(id => map.get(id).offset), 0.95), 2), iouMean: round(both.reduce((s, id) => s + map.get(id).iou, 0) / Math.max(1, both.length), 3) });
      out.paired[`${role}:${baseline}-vs-round2`] = { references: both.length, baseline: stat(a), candidate: stat(b), ids: both };
    }
  }
  fs.writeFileSync(path.join(reviewDir, sampleFile('benchmark')), JSON.stringify(out, null, 1) + '\n');
  for (const [name, r] of Object.entries(out.results)) for (const role of Object.keys(roles)) {
    const s = r[role];
    console.log(`${name.padEnd(30)} ${role.padEnd(12)} TP ${String(s.tp).padStart(3)} miss ${String(s.missed).padStart(3)} extra ${String(s.extra).padStart(3)}  P ${s.precision} R ${s.recall} F1 ${s.f1}  off ${s.centreOffsetMedianMetres}/${s.centreOffsetP95Metres}  IoU ${s.crownIoUMean}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.PILOT_SAMPLE) throw new Error('round 2 runs on its own sample: set PILOT_SAMPLE=-r2');
  const reference = loadReference();
  if (args.includes('--tune')) tune(reference);
  if (args.includes('--score')) score(reference);
}
