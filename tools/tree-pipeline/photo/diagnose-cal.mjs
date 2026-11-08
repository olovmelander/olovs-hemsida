/* Round 4 diagnosis on CALIBRATION only: each reference crown the round-3 lock misses, with the nearest photo trunk (distance, score, height), and every photo seed the fusion adds with what it matched. */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { loadReference, prepareRefined, prepareWindows, refereeInputs, refinedFromPrepared, scoreWindows, REFINE_FRACTIONS } from '../benchmark.mjs';
import { FUSE_DEFAULTS, fusePhotoSeeds, loadPhotoCrowns, photoTrunks, trunksIn } from '../photo-fusion.mjs';
import { keptTops, recoverTops } from '../tree-refine.mjs';
const { values: args } = parseArgs({ options: { raw: { type: 'string' }, crowns: { type: 'string' }, fuse: { type: 'string', default: '{}' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: 'r4' });
const reference = loadReference(ctx);
const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
const r3 = JSON.parse(fs.readFileSync(ctx.reviewFile('detector-lock-r3.json'), 'utf8'));
const typed = r3.selected.parameters;
const chm = loadRaster(ctx, 'chm-pitfree-050');
const entries = prepareWindows(calibration, chm, loadMosaic(ctx, ctx.leafOff.key));
const inputs = refereeInputs(ctx, chm.grid);
const field = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8')).campaigns[ctx.presence.key].field;
const fuse = { ...FUSE_DEFAULTS, ...JSON.parse(args.fuse) };
const trunks = photoTrunks(loadPhotoCrowns(args.crowns).crowns, chm, field, { projectionFraction: fuse.projectionFraction });
for (const e of entries) {
  const prep = prepareRefined(e, typed, inputs, [...new Set([...REFINE_FRACTIONS, 0.75])]);
  const pred = refinedFromPrepared(e, typed, prep, r3.selected.refine);
  const s = scoreWindows(reference, new Map([[e.window.id, pred]]), [e.window.id]);
  const hit = new Set(s.pairs.map(p => p.ref));
  const tr = trunksIn(trunks, e.cropped.grid);
  for (const ref of reference.crowns.filter(c => c.window === e.window.id && c.scored && !hit.has(c.id))) {
    const near = tr.map(t => ({ d: Math.hypot(t.easting - ref.easting, t.northing - ref.northing), t })).sort((a, b) => a.d - b.d)[0];
    const np = pred.map(p => Math.hypot(p.easting - ref.easting, p.northing - ref.northing)).sort((a, b) => a - b)[0];
    console.log(`MISS ${ref.id} ${ref.type} ${ref.stratum} h ${ref.heightMetres} | nearest pred ${np?.toFixed(1)} m | nearest photo ${near ? `${near.d.toFixed(1)} m score ${near.t.score} h ${near.t.height.toFixed(1)}` : 'none'}`);
  }
  const recovered = recoverTops(prep.suppressed, { apexReturns: t => t.apexCount, photoValley: (role, t, o, f) => t.valleys?.[role]?.[f] ?? null }, r3.selected.refine);
  const existing = [...keptTops(e.cropped.grid, prep.first), ...recovered];
  const seeds = fusePhotoSeeds(e.cropped.grid, prep.smoothCandidates, prep.typeMap, existing, tr, fuse);
  const [we, wn, ee, en] = e.window.bbox;
  for (const sd of seeds.filter(x => x.easting >= we && x.easting < ee && x.northing >= wn && x.northing < en)) {
    const refs = reference.crowns.filter(c => c.window === e.window.id).map(c => ({ c, d: Math.hypot(c.easting - sd.easting, c.northing - sd.northing) })).sort((a, b) => a.d - b.d);
    console.log(`SEED ${e.window.id} score ${sd.score} h ${sd.height.toFixed(1)} nearest ref ${refs[0]?.c.id} ${refs[0]?.d.toFixed(1)} m ${hit.has(refs[0]?.c.id) ? '(already found)' : '(missed by r3)'}`);
  }
}
