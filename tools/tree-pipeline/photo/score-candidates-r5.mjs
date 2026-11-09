/* Round 5, secondary (declared in reference-windows-r5.json before scoring;
   decides nothing): the decided candidates (placed after the holds, the bank
   rule and the hold review) scored on the evaluation sample Y1-Y8, per window,
   with the same matching rule, against the round-4 detector's own crowns
   recorded in benchmark-r5.json.
   node tools/tree-pipeline/photo/score-candidates-r5.mjs [--round r6]  (round 6: on Z1-Z6, against benchmark-r6)
   node tools/tree-pipeline/photo/score-candidates-r5.mjs --ground norrfallsviken --round r4 --method r1-typed
     (another ground: its round's sample, against the named method's own crowns in that round's benchmark) */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadReference, scoreWindows } from '../benchmark.mjs';

const { values: args } = parseArgs({ options: { ground: { type: 'string', default: 'johannesberg' }, round: { type: 'string', default: 'r5' }, method: { type: 'string', default: 'round4-detector' } } });
const ctx = loadGroundConfig(ROOT, args.ground, { round: args.round });
const reference = loadReference(ctx);
const evaluation = reference.windows.windows.filter(w => w.role === 'evaluation');
const placed = JSON.parse(fs.readFileSync(path.join(ctx.paths.candidates, 'candidates-full.json'), 'utf8'))
  .filter(t => ['retain', 'adjust', 'add'].includes(t.decision))
  .map(t => ({ easting: t.easting, northing: t.northing, radius: t.radiusMetres, height: t.objectHeightMetres, type: t.type }));
const predictions = new Map(evaluation.map(w => [w.id, placed]));
const all = scoreWindows(reference, predictions, evaluation.map(w => w.id));
const benchmark = JSON.parse(fs.readFileSync(ctx.reviewFile(ctx.sampleFile('benchmark')), 'utf8'));
const r4 = new Map(benchmark.results[args.method].evaluation.windows.map(w => [w.window, w]));
const out = { what: `decided candidates (placed records after holds, bank rule and hold review) on round ${args.round}'s evaluation sample; secondary, decides nothing`, total: (({ tp, missed, extra, precision, recall, f1 }) => ({ tp, missed, extra, precision, recall, f1 }))(all), windows: all.windows.map(w => ({ window: w.window, tp: w.tp, missed: w.missed, extra: w.extra, [args.method === 'round4-detector' ? 'round4Detector' : args.method]: { tp: r4.get(w.window).tp, missed: r4.get(w.window).missed, extra: r4.get(w.window).extra } })) };
console.log(JSON.stringify(out, null, 1));
