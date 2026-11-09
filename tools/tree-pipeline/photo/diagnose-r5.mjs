/* Round 5 diagnosis on CALIBRATION only (C, K, W, X): for every reference
   crown the round-4 lock misses, what lies near it - a suppressed laser top
   (and why the confirm fusion did not take it back), a photo box (claimed by
   a kept top or free), and the drawn crown that swallowed it. Never reads an
   evaluation window.
   node tools/tree-pipeline/photo/diagnose-r5.mjs --raw <cache> */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { fieldAt } from '../relief.mjs';
import { loadReference, prepareRefined, prepareWindows, refereeInputs, scoreWindows, REFINE_FRACTIONS } from '../benchmark.mjs';
import { centresNear, confirmTops, confirmedFromPrepared, loadPhotoCrowns, photoCentres } from '../photo-fusion.mjs';
import { keptTops, recoverTops } from '../tree-refine.mjs';
import { crownsFile } from '../photo-detect.mjs';

const { values: args } = parseArgs({ options: { raw: { type: 'string' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: 'r5' });
const reference = loadReference(ctx);
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const lock = JSON.parse(fs.readFileSync(ctx.reviewFile('detector-lock-r4.json'), 'utf8'));
const typed = lock.selected.parameters, refine = lock.selected.refine, fuse = lock.selected.fuse;
const chm = loadRaster(ctx, 'chm-pitfree-050');
const entries = prepareWindows(calibration, chm, loadMosaic(ctx, ctx.leafOff.key));
const inputs = refereeInputs(ctx, chm.grid);
const field = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8')).campaigns[ctx.presence.key].field;
const centres = photoCentres(loadPhotoCrowns(crownsFile(ctx, lock.selected.photo.source, 'all')).crowns);
const fractions = [...new Set([...REFINE_FRACTIONS, refine.photo?.fraction ?? 0.75])];
const tally = {};
const rows = [];
for (const e of entries) {
  const prep = prepareRefined(e, typed, inputs, fractions);
  const recovered = recoverTops(prep.suppressed, { apexReturns: t => t.apexCount, photoValley: (r, t, o, f) => t.valleys?.[r]?.[f] ?? null }, refine);
  const rs = new Set(recovered.map(t => t.index));
  const kept = [...keptTops(e.cropped.grid, prep.first), ...recovered.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }))];
  const near = centresNear(centres, e.cropped.grid);
  const suppressed = prep.suppressed.filter(t => !rs.has(t.index));
  const confirmed = confirmTops(kept, suppressed, near, field, prep.smoothCandidates, e.cropped.grid, fuse);
  const pred = confirmedFromPrepared(e, typed, prep, refine, near, field, fuse);
  const s = scoreWindows(reference, new Map([[e.window.id, pred]]), [e.window.id]);
  const matched = new Set(s.pairs.map(p => p.ref));
  const forward = t => { const k = fieldAt(field, t.easting, t.northing) || { kx: 0, ky: 0 }; return [t.easting + fuse.projectionFraction * k.kx * t.height, t.northing + fuse.projectionFraction * k.ky * t.height]; };
  for (const ref of reference.crowns.filter(c => c.window === e.window.id && c.scored && !matched.has(c.id))) {
    const d = o => Math.hypot(o.easting - ref.easting, o.northing - ref.northing);
    const sup = suppressed.map(t => ({ t, d: d(t) })).sort((a, b) => a.d - b.d)[0];
    const keptNear = kept.map(t => ({ t, d: d(t) })).sort((a, b) => a.d - b.d)[0];
    const crown = pred.map(p => ({ p, d: d(p) })).sort((a, b) => a.d - b.d)[0];
    const [fe, fn] = forward({ easting: ref.easting, northing: ref.northing, height: ref.heightMetres });
    const box = near.map(c => ({ c, d: Math.hypot(c.easting - fe, c.northing - fn) })).sort((a, b) => a.d - b.d)[0];
    const boxClaimedByKept = box && kept.some(k => { const [ke, kn] = forward(k); return Math.hypot(box.c.easting - ke, box.c.northing - kn) < box.d; });
    const cause = !sup || sup.d > 1.5
      ? (box && box.d <= 2 ? (boxClaimedByKept ? 'no laser top; its photo box is nearer a kept top' : 'no laser top; a free photo box') : 'no laser top; no photo box')
      : confirmed.some(c => c.index === sup.t.index) ? 'confirmed but lost in the regrowth'
      : !(box && box.d <= fuse.matchRadiusMetres) ? 'laser top; no photo box near'
      : box.c.score < fuse.minimumScore ? 'laser top; box below the score'
      : !fuse.types.includes(sup.t.type) ? 'laser top; type not fused'
      : 'laser top; box paired elsewhere or too close to a seed';
    tally[cause] = (tally[cause] || 0) + 1;
    rows.push({ window: e.window.id, id: ref.id, h: ref.heightMetres, type: ref.type, stratum: ref.stratum, cause, top: sup ? +sup.d.toFixed(2) : null, kept: keptNear ? +keptNear.d.toFixed(2) : null, crown: crown ? +crown.d.toFixed(2) : null, crownR: crown ? +crown.p.radius.toFixed(2) : null, crownH: crown ? +crown.p.height.toFixed(1) : null, box: box ? +box.d.toFixed(2) : null, score: box ? +box.c.score.toFixed(2) : null });
  }
}
for (const r of rows) console.log(JSON.stringify(r));
console.log(JSON.stringify(tally, null, 1));
