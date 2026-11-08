/* Round 4 exploration on CALIBRATION windows only: the photo detector alone
   (crowns moved to their trunks) and fused with the round-3 lock, for one or
   more photo-crowns files; optionally the fusion's coordinate descent.
   Never reads a held-out window.

   node tools/tree-pipeline/photo/explore-cal.mjs --raw <cache> --crowns a.json[,b.json] [--descent] [--fuse '{"minimumScore":0.3}'] */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { better, loadReference, prepareRefined, prepareWindows, refereeInputs, refinedFromPrepared, scoreWindows, REFINE_FRACTIONS } from '../benchmark.mjs';
import { FUSE_DEFAULTS, FUSE_SEARCH, fusedFromPrepared, loadPhotoCrowns, photoTrunks, trunksIn } from '../photo-fusion.mjs';

const { values: args } = parseArgs({ options: { raw: { type: 'string' }, crowns: { type: 'string' }, descent: { type: 'boolean', default: false }, fuse: { type: 'string', default: '{}' }, scores: { type: 'string', default: '0.1,0.2,0.3,0.4,0.5,0.6' }, fractions: { type: 'string', default: '0.6,0.8,1' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: 'r4' });
const reference = loadReference(ctx);
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const ids = calibration.map(w => w.id);
const r3 = JSON.parse(fs.readFileSync(ctx.reviewFile('detector-lock-r3.json'), 'utf8'));
const typed = r3.selected.parameters;
const chm = loadRaster(ctx, 'chm-pitfree-050');
const m21 = loadMosaic(ctx, ctx.leafOff.key);
const inputs = refereeInputs(ctx, chm.grid);
const entries = prepareWindows(calibration, chm, m21);
const prepared = new Map(entries.map(e => [e.window.id, prepareRefined(e, typed, inputs, [...new Set([...REFINE_FRACTIONS, r3.selected.refine.photo?.fraction ?? 0.75])])]));
const relief = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8'));
const field = relief.campaigns[ctx.presence.key].field;
const short = s => `P ${s.precision} R ${s.recall} F1 ${s.f1} (tp ${s.tp} miss ${s.missed} extra ${s.extra})`;
const base = scoreWindows(reference, new Map(entries.map(e => [e.window.id, refinedFromPrepared(e, typed, prepared.get(e.window.id), r3.selected.refine)])), ids);
console.log('round-3 lock on calibration:', short(base), JSON.stringify(Object.fromEntries(Object.entries(base.recallBy).map(([k, v]) => [k, `${v.tp}/${v.tp + v.missed}`]))));
for (const file of args.crowns.split(',')) {
  const photo = loadPhotoCrowns(file);
  console.log(`\n== ${file} (${photo.crowns.length} boxes, patch ${photo.meta.patchMetres} m, weights ${photo.meta.weights})`);
  for (const f of args.fractions.split(',').map(Number)) {
    const all = photoTrunks(photo.crowns, chm, field, { projectionFraction: f });
    for (const s of args.scores.split(',').map(Number)) {
      const pred = new Map(entries.map(e => [e.window.id, trunksIn(all, e.cropped.grid).filter(t => t.score >= s && t.height >= 3).map(t => ({ easting: t.easting, northing: t.northing, radius: t.halfSize, height: t.height }))]));
      const sc = scoreWindows(reference, pred, ids);
      const fused = scoreWindows(reference, new Map(entries.map(e => [e.window.id, fusedFromPrepared(e, typed, prepared.get(e.window.id), r3.selected.refine, trunksIn(all, e.cropped.grid), { ...FUSE_DEFAULTS, ...JSON.parse(args.fuse), minimumScore: s, projectionFraction: f })])), ids);
      console.log(`f ${f} score>=${s}: photo only ${short(sc)} | fused ${short(fused)}`);
    }
  }
  if (args.descent) {
    const trunkCache = new Map();
    const trunksFor = f => { if (!trunkCache.has(f)) trunkCache.set(f, photoTrunks(photo.crowns, chm, field, { projectionFraction: f })); return trunkCache.get(f); };
    const evaluate = fuse => { const all = trunksFor(fuse.projectionFraction); const s = scoreWindows(reference, new Map(entries.map(e => [e.window.id, fusedFromPrepared(e, typed, prepared.get(e.window.id), r3.selected.refine, trunksIn(all, e.cropped.grid), fuse)])), ids); return { f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra, recallBy: s.recallBy }; };
    let current = { ...FUSE_DEFAULTS, ...JSON.parse(args.fuse) };
    let best = evaluate(current);
    console.log('start', JSON.stringify(current), short(best));
    for (let pass = 1; pass <= 4; pass++) {
      let changed = false;
      for (const [key, values] of FUSE_SEARCH) for (const value of values) {
        if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
        const cand = { ...current, [key]: value };
        const sc = evaluate(cand);
        if (better(sc, best)) { current = cand; best = sc; changed = true; console.log(`pass ${pass}: ${key}=${JSON.stringify(value)} ${short(best)}`); }
      }
      if (!changed) break;
    }
    console.log('best', JSON.stringify(current), short(best), JSON.stringify(Object.fromEntries(Object.entries(best.recallBy).map(([k, v]) => [k, `${v.tp}/${v.tp + v.missed}`]))));
  }
}

/* --grid: the joint grid FUSE_GRID (photo-fusion.mjs) on calibration, for the last crowns file */
if (process.env.FUSE_GRID_RUN) {
  const { FUSE_GRID, gridCandidates } = await import('../photo-fusion.mjs');
  for (const file of args.crowns.split(',')) {
    const photo = loadPhotoCrowns(file);
    const trunkCache = new Map();
    const trunksFor = f => { if (!trunkCache.has(f)) trunkCache.set(f, photoTrunks(photo.crowns, chm, field, { projectionFraction: f })); return trunkCache.get(f); };
    const results = [];
    for (const fuse of gridCandidates(FUSE_GRID)) {
      const all = trunksFor(fuse.projectionFraction);
      const s = scoreWindows(reference, new Map(entries.map(e => [e.window.id, fusedFromPrepared(e, typed, prepared.get(e.window.id), r3.selected.refine, trunksIn(all, e.cropped.grid), fuse)])), ids);
      results.push({ fuse, f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra });
    }
    results.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    console.log(`\n== grid ${file}: ${results.length} candidates`);
    for (const r of results.slice(0, 12)) console.log(JSON.stringify(r.fuse), short(r));
  }
}

/* CONFIRM_GRID_RUN=1: the confirm fusion's joint grid on calibration */
if (process.env.CONFIRM_GRID_RUN) {
  const { CONFIRM_GRID, CONFIRM_DEFAULTS, confirmedFromPrepared, photoCentres, centresNear } = await import('../photo-fusion.mjs');
  const grid = Object.entries(CONFIRM_GRID).reduce((acc, [k, vs]) => acc.flatMap(o => vs.map(v => ({ ...o, [k]: v }))), [{ ...CONFIRM_DEFAULTS }]);
  for (const file of args.crowns.split(',')) {
    const centres = photoCentres(loadPhotoCrowns(file).crowns);
    const near = new Map(entries.map(e => [e.window.id, centresNear(centres, e.cropped.grid)]));
    const results = [];
    for (const fuse of grid) {
      const s = scoreWindows(reference, new Map(entries.map(e => [e.window.id, confirmedFromPrepared(e, typed, prepared.get(e.window.id), r3.selected.refine, near.get(e.window.id), field, fuse)])), ids);
      results.push({ fuse, f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra });
    }
    results.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    console.log(`\n== confirm grid ${file}: ${results.length} candidates`);
    for (const r of results.slice(0, 10)) console.log(JSON.stringify(r.fuse), short(r));
  }
}
