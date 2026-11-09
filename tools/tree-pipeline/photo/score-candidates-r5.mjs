/* Round 5, secondary (declared in reference-windows-r5.json before scoring;
   decides nothing): the decided candidates (placed after the holds, the bank
   rule and the hold review) scored on the evaluation sample Y1-Y8, per window,
   with the same matching rule, against the round-4 detector's own crowns
   recorded in benchmark-r5.json.
   node tools/tree-pipeline/photo/score-candidates-r5.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadReference, scoreWindows } from '../benchmark.mjs';

const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r5' });
const reference = loadReference(ctx);
const evaluation = reference.windows.windows.filter(w => w.role === 'evaluation');
const placed = JSON.parse(fs.readFileSync(path.join(ctx.paths.candidates, 'candidates-full.json'), 'utf8'))
  .filter(t => ['retain', 'adjust', 'add'].includes(t.decision))
  .map(t => ({ easting: t.easting, northing: t.northing, radius: t.radiusMetres, height: t.objectHeightMetres, type: t.type }));
const predictions = new Map(evaluation.map(w => [w.id, placed]));
const all = scoreWindows(reference, predictions, evaluation.map(w => w.id));
const benchmark = JSON.parse(fs.readFileSync(ctx.reviewFile('benchmark-r5.json'), 'utf8'));
const r4 = new Map(benchmark.results['round4-detector'].evaluation.windows.map(w => [w.window, w]));
const out = { what: 'decided candidates (placed records after holds, bank rule and hold review) on Y1-Y8; secondary, decides nothing', total: (({ tp, missed, extra, precision, recall, f1 }) => ({ tp, missed, extra, precision, recall, f1 }))(all), windows: all.windows.map(w => ({ window: w.window, tp: w.tp, missed: w.missed, extra: w.extra, round4Detector: { tp: r4.get(w.window).tp, missed: r4.get(w.window).missed, extra: r4.get(w.window).extra } })) };
console.log(JSON.stringify(out, null, 1));
