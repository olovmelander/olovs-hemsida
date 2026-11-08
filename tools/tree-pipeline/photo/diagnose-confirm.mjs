/* Round 4b diagnosis on CALIBRATION only: every suppressed top the round-4 lock's photo crowns confirm, with its laser and photo measures, and whether the fused detector's crown there matches a reference crown (gain) or is an extra. Never reads a held-out window. */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { loadReference, prepareRefined, prepareWindows, refereeInputs, scoreWindows, REFINE_FRACTIONS } from '../benchmark.mjs';
import { confirmTops, confirmedFromPrepared, centresNear, loadPhotoCrowns, photoCentres } from '../photo-fusion.mjs';
import { keptTops, recoverTops } from '../tree-refine.mjs';
const { values: args } = parseArgs({ options: { raw: { type: 'string' }, crowns: { type: 'string' }, lock: { type: 'string', default: 'detector-lock-r4.json' }, round: { type: 'string', default: 'r4b' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: args.round });
const reference = loadReference(ctx);
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const lock = JSON.parse(fs.readFileSync(ctx.reviewFile(args.lock), 'utf8'));
const typed = lock.selected.parameters, refine = lock.selected.refine, fuse = lock.selected.fuse;
const chm = loadRaster(ctx, 'chm-pitfree-050');
const entries = prepareWindows(calibration, chm, loadMosaic(ctx, ctx.leafOff.key));
const inputs = refereeInputs(ctx, chm.grid);
const field = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8')).campaigns[ctx.presence.key].field;
const crowns = loadPhotoCrowns(args.crowns).crowns;
const centres = crowns.map(c => ({ easting: (c.minE + c.maxE) / 2, northing: (c.minN + c.maxN) / 2, score: c.score, halfSize: ((c.maxE - c.minE) + (c.maxN - c.minN)) / 4 }));
const rows = [];
for (const e of entries) {
  const prep = prepareRefined(e, typed, inputs, [...new Set([...REFINE_FRACTIONS, refine.photo?.fraction ?? 0.75])]);
  const recovered = recoverTops(prep.suppressed, { apexReturns: t => t.apexCount, photoValley: (r, t, o, f) => t.valleys?.[r]?.[f] ?? null }, refine);
  const rs = new Set(recovered.map(t => t.index));
  const kept = [...keptTops(e.cropped.grid, prep.first), ...recovered.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }))];
  const near = centresNear(centres, e.cropped.grid);
  const confirmed = confirmTops(kept, prep.suppressed.filter(t => !rs.has(t.index)), near, field, prep.smoothCandidates, e.cropped.grid, fuse);
  const pred = confirmedFromPrepared(e, typed, prep, refine, near, field, fuse);
  const s = scoreWindows(reference, new Map([[e.window.id, pred]]), [e.window.id]);
  const [we, wn, ee, en] = e.window.bbox;
  const refs = reference.crowns.filter(c => c.window === e.window.id);
  const amb = reference.ambiguity.filter(a => a.window === e.window.id);
  for (const t of confirmed) {
    if (!(t.easting >= we && t.easting < ee && t.northing >= wn && t.northing < en)) continue;
    const inAmb = amb.some(({ ring }) => { const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]); return t.easting >= Math.min(...xs) && t.easting < Math.max(...xs) && t.northing >= Math.min(...ys) && t.northing < Math.max(...ys); });
    const crown = pred.map(p => ({ p, d: Math.hypot(p.easting - t.easting, p.northing - t.northing) })).sort((a, b) => a.d - b.d)[0];
    const pair = s.pairs.find(pp => { const r = refs.find(x => x.id === pp.ref); return r && crown && Math.hypot(r.easting - crown.p.easting, r.northing - crown.p.northing) <= 4 && Math.abs(pp.offset - Math.hypot(r.easting - crown.p.easting, r.northing - crown.p.northing)) < 1e-6; });
    const nearestKept = kept.map(k => Math.hypot(k.easting - t.easting, k.northing - t.northing)).sort((a, b) => a - b)[0];
    rows.push({ window: e.window.id, verdict: inAmb ? 'ambiguous' : pair ? 'match' : 'extra', type: t.type, score: t.photoScore, height: t.height, dip: +t.minimumDipMetres.toFixed(2), nearestKept: +nearestKept.toFixed(2), apex: t.apexCount, radius: crown ? +crown.p.radius.toFixed(2) : null });
  }
}
for (const r of rows) console.log(JSON.stringify(r));
const tally = rows.reduce((o, r) => { o[r.verdict] = (o[r.verdict] || 0) + 1; return o; }, {});
console.log(JSON.stringify(tally));
