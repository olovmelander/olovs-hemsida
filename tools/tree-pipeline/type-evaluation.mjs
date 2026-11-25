#!/usr/bin/env node
/* Is a crown conifer or broadleaf? The rule in use against the leafless and leafy photo surfaces, on the same crowns.

   node tools/tree-pipeline/type-evaluation.mjs --ground <id> [--write]

   The reference crowns (reference.geojson) were typed by an interpreter in windows declared calibration or
   evaluation before any detector ran. The rule in use (type-rule.json: the laser's ground share and the April
   photo's vegetated share) called each placed tree's type. Two more measures are tried: the share of a crown that
   still stands in the leafless flight's surface compared with the leafy one (species-evidence.py, leaflessShare; a
   conifer keeps its crown, a broadleaf loses most of it), where the photo surfaces have been fetched; and the
   species map's conifer share of the crown's 10 m cell (pine and spruce over all four groups), where it is forest.

   Thresholds are chosen on the calibration windows only, by balanced accuracy, and every rule is reported on the
   evaluation windows. The evaluation crowns were already used to report the rule in use, so this compares rules on
   them; it is not a fresh held-out test for a gate. --write keeps the result as type-evaluation.json in the
   species cache folder. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readCsv(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const columns = head.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((value, i) => [columns[i], value === '' ? null : value])));
}

/** One-to-one matches within `metres`, nearest first: [{ a, b, d }]. */
export function matchOneToOne(as, bs, metres = 4) {
  const pairs = [];
  for (const a of as) for (const b of bs) {
    const d = Math.hypot(a.easting - b.easting, a.northing - b.northing);
    if (d <= metres) pairs.push({ a, b, d });
  }
  pairs.sort((x, y) => x.d - y.d);
  const usedA = new Set(), usedB = new Set(), out = [];
  for (const p of pairs) if (!usedA.has(p.a) && !usedB.has(p.b)) { usedA.add(p.a); usedB.add(p.b); out.push(p); }
  return out;
}

/** Balanced accuracy of calls against truth, over crowns typed conifer or broadleaf; a call of unknown counts as wrong. */
export function balanced(rows, call) {
  const by = { conifer: [0, 0], broadleaf: [0, 0] };
  for (const row of rows) {
    if (!(row.truth in by)) continue;
    by[row.truth][1] += 1;
    if (call(row) === row.truth) by[row.truth][0] += 1;
  }
  const recall = kind => (by[kind][1] ? by[kind][0] / by[kind][1] : null);
  return { balanced: by.conifer[1] && by.broadleaf[1] ? (recall('conifer') + recall('broadleaf')) / 2 : null, coniferRecall: recall('conifer'),
    broadleafRecall: recall('broadleaf'), conifers: by.conifer[1], broadleaves: by.broadleaf[1],
    unknownCalls: rows.filter(row => row.truth in by && call(row) !== 'conifer' && call(row) !== 'broadleaf').length };
}

/** The threshold on one feature that best separates conifer (high) from broadleaf (low) on `rows`, by balanced accuracy. */
export function bestThreshold(rows, feature) {
  const values = [...new Set(rows.map(row => row[feature]).filter(Number.isFinite))].sort((a, b) => a - b);
  let best = null;
  for (let i = 1; i < values.length; i += 1) {
    const t = (values[i - 1] + values[i]) / 2, score = balanced(rows, row => (Number.isFinite(row[feature]) ? (row[feature] >= t ? 'conifer' : 'broadleaf') : 'unknown')).balanced;
    if (best === null || score > best.score) best = { t: Math.round(t * 1000) / 1000, score };
  }
  return best;
}

/** The species map's conifer share at an evidence row: pine and spruce over the four groups, or NaN outside forest. */
export function nmdConiferShare(row) {
  const v = name => Number(row[`nmd_${name}`]);
  const total = v('tall') + v('gran') + v('trivial') + v('adel');
  return Number.isFinite(total) && total > 0 ? (v('tall') + v('gran')) / total : NaN;
}

export function evaluateTypes({ reference, placed, minimumHeight = 3 }) {
  const typed = reference.filter(r => (r.type === 'conifer' || r.type === 'broadleaf') && Number(r.heightMetres ?? 99) >= minimumHeight);
  const matches = new Map(matchOneToOne(typed, placed).map(p => [p.a, p.b]));
  const rows = typed.map(r => ({ id: r.id, role: r.role, truth: r.type, inUse: matches.get(r)?.type ?? 'unplaced', leaflessShare: Number(r.leaflessShare ?? NaN), fillLeafy: Number(r.fillLeafy ?? NaN),
    nmdConiferShare: nmdConiferShare(r) }));
  const calibration = rows.filter(r => r.role === 'calibration'), evaluation = rows.filter(r => r.role === 'evaluation');
  const fit = bestThreshold(calibration, 'leaflessShare');
  const surface = row => (fit && Number.isFinite(row.leaflessShare) && row.fillLeafy > 0.15 ? (row.leaflessShare >= fit.t ? 'conifer' : 'broadleaf') : 'unknown');
  const nmdFit = bestThreshold(calibration, 'nmdConiferShare');
  const map = row => (nmdFit && Number.isFinite(row.nmdConiferShare) ? (row.nmdConiferShare >= nmdFit.t ? 'conifer' : 'broadleaf') : 'unknown');
  // Each rule decides where the other cannot: the surface where the rule in use says unknown, and the reverse.
  const inUse = row => row.inUse;
  const filled = row => (row.inUse === 'conifer' || row.inUse === 'broadleaf' ? row.inUse : surface(row));
  const surfaceFirst = row => (surface(row) !== 'unknown' ? surface(row) : row.inUse);
  // What is drawn: the crowns a tree was placed for. A crown not placed is a placement miss, not a type miss.
  const placedOnly = list => list.filter(r => r.inUse !== 'unplaced');
  const report = (name, call, description) => ({ name, description, calibration: balanced(calibration, call), evaluation: balanced(evaluation, call),
    evaluationPlaced: balanced(placedOnly(evaluation), call) });
  return {
    crowns: { calibration: calibration.length, evaluation: evaluation.length, placedOnes: rows.filter(r => r.inUse !== 'unplaced').length },
    surfaceThreshold: fit,
    nmdThreshold: nmdFit,
    rules: [
      report('in use', inUse, 'type-rule.json as published: groundShare < t OR aprilVegetatedShare >= t, per placed tree; a crown not placed counts as unknown'),
      report('photo surfaces', surface, `leaflessShare >= ${fit?.t} is conifer, where the leafy surface fills at least 15% of the crown`),
      report('in use, surfaces where it is unknown', filled, 'the rule in use, and the photo surfaces only where it says unknown or placed nothing'),
      report('surfaces first', surfaceFirst, 'the photo surfaces, and the rule in use only where they cannot say'),
      report('species map', map, `the species map's conifer share >= ${nmdFit?.t} is conifer, where the cell is forest`),
      report('in use, species map where it is unknown', row => (row.inUse === 'conifer' || row.inUse === 'broadleaf' ? row.inUse : map(row)), 'the rule in use, and the species map only where it says unknown or placed nothing'),
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: type-evaluation.mjs --ground <id> [--write]');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, `course-workflows/${groundId}/trees.json`), 'utf8'));
  const folder = path.join(ROOT, config.cacheDir, 'species');
  const num = rows => rows.map(r => ({ ...r, easting: Number(r.easting), northing: Number(r.northing) }));
  const result = evaluateTypes({ reference: num(readCsv(path.join(folder, 'reference-evidence.csv'))), placed: num(readCsv(path.join(folder, 'species-evidence.csv'))) });
  const out = { schemaVersion: 1, kind: 'conifer-broadleaf-evaluation', groundId, reviewId: config.reviewId, evaluatedOn: new Date().toISOString().slice(0, 10), ...result };
  for (const rule of result.rules) {
    const e = rule.evaluation, c = rule.calibration, p = rule.evaluationPlaced;
    console.log(`${rule.name.padEnd(40)} placed crowns ${p.balanced?.toFixed(3)} (conifer ${p.coniferRecall?.toFixed(3)}, broadleaf ${p.broadleafRecall?.toFixed(3)}, ${p.unknownCalls} unknown of ${p.conifers + p.broadleaves})   all crowns ${e.balanced?.toFixed(3)}   calibration ${c.balanced?.toFixed(3)}`);
  }
  console.log(`crowns: ${JSON.stringify(result.crowns)}; surface threshold ${JSON.stringify(result.surfaceThreshold)}`);
  if (argv.includes('--write')) fs.writeFileSync(path.join(folder, 'type-evaluation.json'), `${JSON.stringify(out, null, 1)}\n`);
}
