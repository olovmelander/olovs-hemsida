#!/usr/bin/env node
/* How well can each tree's species be called, against the species truth (species-truth.json)?

   node tools/tree-pipeline/species-evaluation.mjs --ground <id> [--truth <file>] [--write]

   Three questions, each answered on the sample's calibration trees and reported on its evaluation trees, which
   nothing here was tuned on (the sample is split by 150 m blocks):

   1. Conifer or broadleaf: the rule in use (each placed tree's type) against the photo surfaces (the leafless
      flight's share of the leafy crown, threshold from type-evaluation.json on the reference crowns), and the two
      combined. The sample was drawn after both were fixed, so its evaluation half is a fresh test.
   2. Pine or spruce, among the trees the truth calls pine or spruce: every single measure (the spire of the leafy
      surface's top, the species map's pine share, the crown's width over its height, the leafless fill), and the
      best pair joined by AND or OR, chosen by balanced accuracy on calibration. A rule may be published only if it
      meets SUBTYPE_PUBLICATION on the evaluation trees (at least 30, accuracy 0.9, balanced accuracy 0.85), the
      gate the pipeline already holds pine and spruce to.
   3. Which broadleaf the app should draw (birch, alder or oak are the broadleaves it has), among the trees the
      truth calls broadleaf: the ground's stated mix (what is drawn today, scored as its expected accuracy) against
      a context rule (alder within W m of water, oak where the crown is wide for its height or the species map
      gives noble broadleaf, birch otherwise), W and the cuts chosen on calibration.

   The truth is the owner's word where they gave one and the blind agent's where not; each count says which. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, bestThreshold, nmdConiferShare } from './type-evaluation.mjs';
import { SUBTYPE_PUBLICATION } from './subtype.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/* What the app can draw for a broadleaf, for each species the check offers. */
export const DRAWN_AS = Object.freeze({ birch: 'birch', aspen: 'birch', willow: 'alder', alder: 'alder', oak: 'oak', maple: 'oak', lime: 'oak', ash: 'oak', beech: 'oak', 'other-broadleaf': null });

const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
const ratio = (part, whole) => (whole ? part / whole : null);

function tally(rows, call, classes) {
  const by = Object.fromEntries(classes.map(c => [c, [0, 0]]));
  for (const row of rows) if (row.truth in by) { by[row.truth][1] += 1; if (call(row) === row.truth) by[row.truth][0] += 1; }
  const recalls = classes.map(c => ratio(by[c][0], by[c][1])).filter(r => r !== null);
  const n = classes.reduce((s, c) => s + by[c][1], 0), right = classes.reduce((s, c) => s + by[c][0], 0);
  return { trees: n, accuracy: ratio(right, n), balanced: recalls.length === classes.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null,
    byClass: Object.fromEntries(classes.map(c => [c, { trees: by[c][1], recall: ratio(by[c][0], by[c][1]) }])) };
}

/** The best single threshold or pair on calibration rows for two classes: `high` is the class above the cut. */
function bestRule(calibration, features, high, low) {
  const binary = rows => rows.map(r => ({ ...r, truth: r.truth === high ? 'conifer' : 'broadleaf' })); // bestThreshold's labels
  const fits = features.map(f => {
    const up = bestThreshold(binary(calibration), f);
    const flipped = bestThreshold(binary(calibration).map(r => ({ ...r, [f]: -r[f] })), f);
    if (!up && !flipped) return null;
    return (up?.score ?? 0) >= (flipped?.score ?? 0) ? { feature: f, dir: '>=', t: up.t, score: up.score } : { feature: f, dir: '<', t: -flipped.t, score: flipped.score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  const term = fit => row => (Number.isFinite(row[fit.feature]) ? (fit.dir === '>=' ? row[fit.feature] >= fit.t : row[fit.feature] < fit.t) : null);
  const single = fits[0] && { terms: [fits[0]], op: null, call: row => { const v = term(fits[0])(row); return v === null ? 'unknown' : v ? high : low; } };
  let best = single;
  const score = rule => tally(calibration, rule.call, [high, low]).balanced ?? 0;
  for (let i = 0; i < Math.min(4, fits.length); i += 1) for (let j = i + 1; j < Math.min(4, fits.length); j += 1) {
    for (const op of ['AND', 'OR']) {
      const a = term(fits[i]), b = term(fits[j]);
      const rule = { terms: [fits[i], fits[j]], op, call: row => { const x = a(row), y = b(row); if (x === null || y === null) return 'unknown'; return (op === 'AND' ? x && y : x || y) ? high : low; } };
      if (score(rule) > score(best) + 0.01) best = rule;
    }
  }
  return { rule: best, singles: fits };
}

export function evaluateSpecies({ truth, evidence, typeThreshold = null, mapThreshold = null, mix }) {
  const byTree = new Map(evidence.map(e => [e.id, e]));
  const rows = truth.trees.filter(t => byTree.has(t.treeId)).map(t => {
    const e = byTree.get(t.treeId), height = num(e.objectHeightMetres);
    const pineShare = Number.isFinite(num(e.nmd_tall)) && num(e.nmd_tall) + num(e.nmd_gran) > 0 ? num(e.nmd_tall) / (num(e.nmd_tall) + num(e.nmd_gran)) : NaN;
    return { ...t, called: e.type || 'unknown', leaflessShare: num(e.leaflessShare), fillLeafy: num(e.fillLeafy), fillLeafless: num(e.fillLeafless), spire: num(e.spire), spireLaser: num(e.spireLaser),
      mapConifer: nmdConiferShare(e), pineShare, noble: Number.isFinite(num(e.nmd_adel)) ? num(e.nmd_adel) : NaN, water: num(e.waterMetres), width: 2 * num(e.radiusMetres) / height, height };
  });
  const cal = rows.filter(r => r.role === 'calibration'), ev = rows.filter(r => r.role === 'evaluation');
  const sources = list => ({ owner: list.filter(r => r.source === 'owner').length, agent: list.filter(r => r.source === 'agent').length });

  // 1. conifer or broadleaf
  const typed = list => list.filter(r => r.type === 'conifer' || r.type === 'broadleaf').map(r => ({ ...r, truth: r.type }));
  const surface = r => (typeThreshold !== null && Number.isFinite(r.leaflessShare) && r.fillLeafy > 0.15 ? (r.leaflessShare >= typeThreshold ? 'conifer' : 'broadleaf') : 'unknown');
  const map = r => (mapThreshold !== null && Number.isFinite(r.mapConifer) ? (r.mapConifer >= mapThreshold ? 'conifer' : 'broadleaf') : 'unknown');
  const known = r => r.called === 'conifer' || r.called === 'broadleaf';
  const typeRules = { 'in use': r => r.called, 'species map': map, 'in use, species map where it is unknown': r => (known(r) ? r.called : map(r)),
    ...(typeThreshold !== null ? { 'photo surfaces': surface, 'in use, surfaces where it is unknown': r => (known(r) ? r.called : surface(r)) } : {}) };
  const types = Object.entries(typeRules).map(([name, call]) => ({ name, calibration: tally(typed(cal), call, ['conifer', 'broadleaf']), evaluation: tally(typed(ev), call, ['conifer', 'broadleaf']) }));

  // 2. pine or spruce
  const ps = list => list.filter(r => r.species === 'pine' || r.species === 'spruce').map(r => ({ ...r, truth: r.species }));
  const { rule, singles } = bestRule(ps(cal), ['spire', 'spireLaser', 'pineShare', 'width', 'fillLeafless', 'height'], 'pine', 'spruce');
  const held = rule ? tally(ps(ev), rule.call, ['pine', 'spruce']) : null;
  const publish = Boolean(held && held.trees >= SUBTYPE_PUBLICATION.minimumHeldOut && held.accuracy >= SUBTYPE_PUBLICATION.minimumAccuracy && (held.balanced ?? 0) >= SUBTYPE_PUBLICATION.minimumBalancedAccuracy);

  // 3. which broadleaf to draw
  const bl = list => list.filter(r => r.type === 'broadleaf' && DRAWN_AS[r.species]).map(r => ({ ...r, truth: DRAWN_AS[r.species] }));
  const expected = list => (list.length ? list.reduce((s, r) => s + (mix[r.truth] ?? 0), 0) / list.length : null);
  let context = null;
  for (const W of [5, 10, 15, 20, 30]) for (const wide of [0.5, 0.6, 0.7, 0.8, 0.9, 99]) for (const noble of [20, 40, 60, 101]) {
    const call = r => (r.water <= W ? 'alder' : r.width >= wide || r.noble >= noble ? 'oak' : 'birch');
    const score = tally(bl(cal), call, ['birch', 'alder', 'oak']).accuracy ?? 0;
    if (!context || score > context.score) context = { W, wide, noble, score, call };
  }
  const majority = (() => { const counts = {}; for (const r of bl(cal)) counts[r.truth] = (counts[r.truth] ?? 0) + 1; return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; })();

  return {
    trees: { calibration: cal.length, evaluation: ev.length, truthFrom: { calibration: sources(cal), evaluation: sources(ev) } },
    coniferOrBroadleaf: types,
    pineOrSpruce: { trees: { calibration: ps(cal).length, evaluation: ps(ev).length },
      chosen: rule ? { terms: rule.terms.map(t => ({ feature: t.feature, dir: t.dir, t: t.t })), op: rule.op, calibration: tally(ps(cal), rule.call, ['pine', 'spruce']), evaluation: held } : null,
      singles: singles.map(s => ({ feature: s.feature, dir: s.dir, t: s.t, calibrationBalanced: Math.round(s.score * 1000) / 1000 })), gate: SUBTYPE_PUBLICATION, publish },
    whichBroadleaf: { trees: { calibration: bl(cal).length, evaluation: bl(ev).length }, drawnAs: DRAWN_AS, statedMix: mix,
      statedMixExpectedAccuracy: { calibration: expected(bl(cal)), evaluation: expected(bl(ev)) },
      majority: { species: majority, evaluation: tally(bl(ev), () => majority, ['birch', 'alder', 'oak']) },
      context: context && { W: context.W, wideAt: context.wide, nobleAt: context.noble, rule: 'alder within W m of water; oak where width/height >= wideAt or noble broadleaf >= nobleAt; else birch',
        calibration: tally(bl(cal), context.call, ['birch', 'alder', 'oak']), evaluation: tally(bl(ev), context.call, ['birch', 'alder', 'oak']) } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: species-evaluation.mjs --ground <id> [--truth <file>] [--write]');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, `course-workflows/${groundId}/trees.json`), 'utf8'));
  const folder = path.join(ROOT, config.cacheDir, 'species');
  const truth = JSON.parse(fs.readFileSync(flag('truth') ?? path.join(ROOT, config.reviewDir, 'species-truth.json'), 'utf8'));
  const types = JSON.parse(fs.readFileSync(path.join(folder, 'type-evaluation.json'), 'utf8'));
  const typeThreshold = types.surfaceThreshold?.t ?? null, mapThreshold = types.nmdThreshold?.t ?? null; // chosen on the reference crowns' calibration windows
  const mix = config.broadleafMix ?? { birch: 0.32, alder: 0.13, oak: 0.55 }; // Bro Hof's stated rule away from the shore (scenery/bro-hof.js)
  const result = evaluateSpecies({ truth, evidence: readCsv(path.join(folder, 'species-evidence.csv')), typeThreshold, mapThreshold, mix });
  console.log(JSON.stringify(result, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 1));
  if (argv.includes('--write')) fs.writeFileSync(path.join(folder, 'species-evaluation.json'), `${JSON.stringify({ schemaVersion: 1, kind: 'species-evaluation', groundId, evaluatedOn: new Date().toISOString().slice(0, 10), ...result }, null, 1)}\n`);
}
