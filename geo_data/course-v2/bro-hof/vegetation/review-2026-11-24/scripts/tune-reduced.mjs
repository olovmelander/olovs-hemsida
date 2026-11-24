/* Round r1's tuning for Bro Hof (review-2026-11-24), reduced to meet the delivery time: the type-aware detector, on the
   calibration windows only, started from the best of three typed settings (TYPED_DEFAULTS and the locks of Johannesberg
   r2 and Norrfällsviken r1, compared on calibration) and descended over the pipeline's SEARCH without its joint `split`
   entry, at most six passes, and then its joint `split` entry once and a closing pass, within a time budget. The full descent of `benchmark --tune` (with the 216 split settings, up to six passes) was
   started and stopped unfinished; it wrote no lock and nothing was scored. The held-out windows are never read here.
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/tune-reduced.mjs */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadGroundConfig, ROOT } from '../../../../../../tools/tree-pipeline/config.mjs';
import { SEARCH, loadReference, prepareWindows, scoreWindows, typedPredictions, typedStart } from '../../../../../../tools/tree-pipeline/benchmark.mjs';
import { loadMosaic, loadRaster } from '../../../../../../tools/tree-pipeline/panels.mjs';
import { writeReceipt } from '../../../../../../tools/tree-pipeline/receipts.mjs';

const started = Date.now();
const BUDGET_MS = Number(process.argv[2] || 600) * 1000;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ctx = loadGroundConfig(ROOT, 'bro-hof', { round: 'r1' });
if (fs.existsSync(ctx.reviewFile(ctx.sampleFile('benchmark')))) throw new Error('round r1 has been scored: no tuning');
const reference = loadReference(ctx);
const chm = loadRaster(ctx, 'chm-pitfree-050');
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const entries = prepareWindows(calibration, chm, loadMosaic(ctx, ctx.leafOff.key));
const typeCache = new Map();
let evaluations = 0;
const evaluate = parameters => {
  evaluations++;
  const s = scoreWindows(reference, new Map(entries.map(e => [e.window.id, typedPredictions(e, parameters, typeCache)])), calibration.map(w => w.id));
  return { f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra };
};
const better = (a, b) => a.f1 > b.f1 || (a.f1 === b.f1 && (a.iou > b.iou || (a.iou === b.iou && a.offset < b.offset)));
const get = (o, key) => key.split('.').reduce((a, k) => a[k], o);
const set = (o, key, value) => { const copy = JSON.parse(JSON.stringify(o)); const parts = key.split('.'); let t = copy; for (const k of parts.slice(0, -1)) t = t[k]; t[parts.at(-1)] = value; return copy; };
const lockOf = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).selected.parameters;
const seeds = [['TYPED_DEFAULTS', typedStart(null)],
  ['Johannesberg r2 lock', lockOf('geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/detector-lock-r2.json')],
  ['Norrfällsviken r1 lock', lockOf('geo_data/course-v2/norrfallsviken/vegetation/review-2026-11-09/detector-lock.json')]];
/* the end point of the first reduced run (two passes without split, 130 evaluations, 38 s; its log reached calibration F1 0.875); a second run was starved of CPU by other work and reached only its first steps, so the search resumes from here */
const resumed = JSON.parse(JSON.stringify(seeds[1][1]));
Object.assign(resumed.type, { coniferShare: 0.5 });
Object.assign(resumed.conifer, { smoothingSigmaMetres: 0.25, windowBaseMetres: 0.5, windowMinimumMetres: 1.5, windowMaximumMetres: 2, prominenceMetres: 0.5, position: 'apex' });
Object.assign(resumed.broadleaf, { windowBaseMetres: 1, windowSlope: 0.05, windowMinimumMetres: 2, prominenceMetres: 0, prominenceFraction: 0.05 });
Object.assign(resumed.shared, { extentFraction: 0.15, minimumCrownAreaSquareMetres: 1 });
if (process.argv[3] === 'resume') seeds.push(['the first reduced run', resumed]);
const trajectory = [];
let current = null, best = null;
for (const [name, parameters] of seeds) {
  const s = evaluate(parameters);
  trajectory.push({ step: `start: ${name}`, ...s });
  console.log(name, JSON.stringify(s));
  if (!best || better(s, best)) { best = s; current = JSON.parse(JSON.stringify(parameters)); }
}
let stoppedEarly = false, splitPass = 0;
const search = SEARCH.filter(([key]) => key !== 'split');
outer: for (let pass = 1; pass <= 8; pass++) {
  let changed = false;
  for (const [key, values] of (pass === splitPass ? SEARCH : search)) for (const value of values) {
    if (Date.now() - started > BUDGET_MS) { stoppedEarly = true; break outer; }
    if (JSON.stringify(get(current, key)) === JSON.stringify(value)) continue;
    const candidate = set(current, key, value);
    if (candidate.conifer.windowMaximumMetres < candidate.conifer.windowMinimumMetres || candidate.broadleaf.windowMaximumMetres < candidate.broadleaf.windowMinimumMetres) continue;
    const s = evaluate(candidate);
    if (better(s, best)) { current = candidate; best = s; changed = true; trajectory.push({ step: `pass ${pass}: ${key} = ${JSON.stringify(value)}`, ...s }); console.log(`${key} = ${JSON.stringify(value)}`, JSON.stringify(s)); }
  }
  console.log(`pass ${pass} done, ${evaluations} evaluations, ${Math.round((Date.now() - started) / 1000)} s`);
  if (!changed && splitPass) break;
  if (!changed) splitPass = pass + 1;
}
const codeFiles = ['packages/course-v2/vegetation/tree-detect-v2.mjs', 'tools/tree-pipeline/tree-refine.mjs', 'packages/course-v2/vegetation/pit-free-chm.mjs', 'packages/course-v2/vegetation/crown-detect.mjs', 'tools/tree-pipeline/relief.mjs', 'tools/tree-pipeline/benchmark.mjs', 'tools/tree-pipeline/photo-fusion.mjs'];
const lock = {
  schemaVersion: 1, kind: 'detector-lock', round: 'r1', detector: 'typed',
  method: `type-aware detector (tree-detect-v2.mjs detectTreesTyped): leaf-off ${ctx.leafOff.date} conifer map before detection, per-type smoothing / window / merge / position, simultaneous growth`,
  frozenAt: new Date().toISOString(),
  referenceLockSha256: reference.lockSha256,
  chmSha256: chm.sidecar.sha256,
  code: Object.fromEntries(codeFiles.map(f => [f, sha(path.join(ROOT, f))])),
  selection: `calibration windows only; reduced descent (scripts/tune-reduced.mjs) from the best of ${seeds.map(s => s[0]).join(', ')} over SEARCH without split until no change, then with split once and a closing pass${stoppedEarly ? `, stopped at its ${BUDGET_MS / 1000} s budget` : ''}; ranked by F1, then mean crown IoU, then median centre offset; ties keep the current value`,
  search: Object.fromEntries(search),
  evaluations,
  selected: { parameters: current, calibration: best },
  trajectory,
  windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
  photoDetector: 'not run: no GPU work (no deep-learning photo detector)',
};
const lockPath = ctx.reviewFile(ctx.sampleFile('detector-lock'));
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
writeReceipt(ctx, 'benchmark-tune', { inputs: [ctx.reviewFile(ctx.sampleFile('reference-lock')), path.join(ctx.paths.rasters, 'chm-pitfree-050.bin')], outputs: [lockPath], perRound: true, result: { detector: 'typed', calibration: best, reduced: true } });
console.log('locked', JSON.stringify(best));
