/* Round 5 probe on CALIBRATION only: the round-4 lock with and without a few
   width-split settings, timed, before the benchmark's full search. Never
   reads an evaluation window.
   node tools/tree-pipeline/photo/split-probe-r5.mjs --raw <cache> */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { loadReference, prepareRefined, prepareWindows, refereeInputs, scoreWindows, REFINE_FRACTIONS } from '../benchmark.mjs';
import { SPLIT_DEFAULTS, centresNear, confirmedFromPrepared, loadPhotoCrowns, photoCentres, splitFromPrepared, typicalCrownRadius } from '../photo-fusion.mjs';
import { crownsFile } from '../photo-detect.mjs';

const { values: args } = parseArgs({ options: { raw: { type: 'string' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: 'r5' });
const reference = loadReference(ctx);
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const ids = calibration.map(w => w.id);
const lock = JSON.parse(fs.readFileSync(ctx.reviewFile('detector-lock-r4.json'), 'utf8'));
const { parameters: typed, refine, fuse } = lock.selected;
const chm = loadRaster(ctx, 'chm-pitfree-050');
const entries = prepareWindows(calibration, chm, loadMosaic(ctx, ctx.leafOff.key));
const inputs = refereeInputs(ctx, chm.grid);
const field = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8')).campaigns[ctx.presence.key].field;
const centres = photoCentres(loadPhotoCrowns(crownsFile(ctx, lock.selected.photo.source, 'all')).crowns);
const near = new Map(entries.map(e => [e.window.id, centresNear(centres, e.cropped.grid)]));
const fractions = [...new Set([...REFINE_FRACTIONS, refine.photo?.fraction ?? 0.75])];
let t0 = performance.now();
const prepared = new Map(entries.map(e => [e.window.id, prepareRefined(e, typed, inputs, fractions)]));
console.log(`prepared ${entries.length} windows in ${Math.round(performance.now() - t0)} ms`);
const typical = typicalCrownRadius(reference.crowns.filter(c => ids.includes(c.window) && c.scored));
console.log('typical', JSON.stringify(typical));
const line = (label, s) => console.log(`${label.padEnd(44)} P ${s.precision} R ${s.recall} F1 ${s.f1} tp ${s.tp} miss ${s.missed} extra ${s.extra}`);
t0 = performance.now();
line('round 4 lock', scoreWindows(reference, new Map(entries.map(e => [e.window.id, confirmedFromPrepared(e, typed, prepared.get(e.window.id), refine, near.get(e.window.id), field, fuse)])), ids));
console.log(`  ${Math.round(performance.now() - t0)} ms`);
for (const split of [SPLIT_DEFAULTS, { ...SPLIT_DEFAULTS, widthFactor: 1.2 }, { ...SPLIT_DEFAULTS, widthFactor: 1.7 }, { ...SPLIT_DEFAULTS, photoScore: 0.1 }, { ...SPLIT_DEFAULTS, minimumDipMetres: 0 }, { ...SPLIT_DEFAULTS, protect: false }]) {
  t0 = performance.now();
  const s = scoreWindows(reference, new Map(entries.map(e => [e.window.id, splitFromPrepared(e, typed, prepared.get(e.window.id), refine, near.get(e.window.id), field, fuse, split, typical)])), ids);
  line(JSON.stringify({ w: split.widthFactor, sep: split.minimumSeparationMetres, dip: split.minimumDipMetres, ph: split.photoScore, pr: split.protect }), s);
  console.log(`  ${Math.round(performance.now() - t0)} ms`);
}
