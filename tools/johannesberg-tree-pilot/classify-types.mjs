#!/usr/bin/env node
/* Conifer / broadleaf from leaf-off structure and the April 2021 photo,
   calibrated on the reference crowns the interpreter typed.

   usage: node tools/johannesberg-tree-pilot/classify-types.mjs

   Every reference window is run through the locked detector; each detected
   crown matched to a typed reference crown (conifer or broadleaf) gives one
   labelled example of: the share of first returns stopped >= 2 m up inside
   the crown (a bare broadleaf lets pulses through in April, an evergreen
   conifer does not), the share of ground returns, and the April 2021
   vegetation contrast (90th percentile in the crown disc widened for relief
   displacement: evergreen needles are green on 18 April, bare twigs are not).
   Single-feature thresholds and their AND/OR pairs are searched on the
   calibration examples by balanced accuracy; the chosen rule is then
   reported on the evaluation examples it never saw. Written to
   type-rule.json.                                                          */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT, sampleFile } from './pilot-config.mjs';
import { ROOT, loadMosaic, loadRaster } from './panels.mjs';
import { loadReference, newDetector } from './benchmark.mjs';
import { displacementAllowance, loadPointsFor, photoDisc } from './crown-evidence.mjs';
import { crownReturnMetrics, detectTreesV2, matchOneToOne } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';

const reviewDir = path.join(ROOT, PILOT.reviewDir);
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function crop(raster, bbox, margin = 25) {
  const g = raster.grid, s = g.sampleSpacingMetres;
  const c0 = Math.max(0, Math.floor((bbox[0] - margin - g.minEasting) / s)), c1 = Math.min(g.width, Math.ceil((bbox[2] + margin - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - bbox[3] - margin) / s)), r1 = Math.min(g.height, Math.ceil((g.maxNorthing - bbox[1] + margin) / s));
  const width = c1 - c0, height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = raster.values[(r0 + r) * g.width + c0 + c];
  return { grid: { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s }, values, c0, r0 };
}

/** Features of every detected crown in a cropped CHM. */
export function crownFeatures({ cropped, parameters, points, m21, m25 }) {
  const { grid } = cropped;
  const result = detectTreesV2(grid, cropped.values, { parameters });
  /* points re-indexed to the crop lattice */
  const sub = { count: points.count, column: new Int32Array(points.count), row: new Int32Array(points.count), hag: points.hag, ground: points.ground, returnNumber: points.returnNumber, intensity: points.intensity };
  for (let i = 0; i < points.count; i++) {
    sub.column[i] = Math.floor((points.easting[i] - grid.minEasting) / grid.sampleSpacingMetres);
    sub.row[i] = Math.floor((grid.maxNorthing - points.northing[i]) / grid.sampleSpacingMetres);
  }
  const metrics = crownReturnMetrics(grid, result.labels, result.crowns, sub);
  return result.crowns.map(crown => {
    const radius = crown.equivalentRadiusMetres + displacementAllowance(crown.heightMetres);
    const april = photoDisc(m21, crown.apex.easting, crown.apex.northing, radius);
    const june = photoDisc(m25, crown.apex.easting, crown.apex.northing, radius);
    return { crown, returns: metrics.get(crown.id), april, june };
  });
}

export const TYPE_FEATURES = Object.freeze({
  firstCanopyShare: f => f.returns?.firstCanopyShare,
  groundShare: f => f.returns?.groundShare,
  aprilContrastP90: f => f.april?.contrastP90,
  aprilVegetatedShare: f => f.april?.vegetatedShare,
});

function balancedAccuracy(examples, rule) {
  let tc = 0, nc = 0, tb = 0, nb = 0;
  for (const e of examples) {
    const conifer = rule(e.features);
    if (e.type === 'conifer') { nc++; if (conifer) tc++; } else { nb++; if (!conifer) tb++; }
  }
  return { balanced: (tc / Math.max(1, nc) + tb / Math.max(1, nb)) / 2, coniferRecall: tc / Math.max(1, nc), broadleafRecall: tb / Math.max(1, nb), conifers: nc, broadleaves: nb };
}

async function main() {
  const reference = loadReference();
  const lock = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('detector-lock')), 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const points = loadPointsFor(chm.grid);
  const m21 = loadMosaic('2021');
  const m25 = loadMosaic('2025');
  const examples = [];
  for (const window of reference.windows.windows) {
    const cropped = crop(chm, window.bbox);
    /* keep only the points of this crop for speed */
    const [x0, y0, x1, y1] = [cropped.grid.minEasting, cropped.grid.maxNorthing - cropped.grid.height * 0.5, cropped.grid.minEasting + cropped.grid.width * 0.5, cropped.grid.maxNorthing];
    const keep = [];
    for (let i = 0; i < points.count; i++) if (points.easting[i] >= x0 && points.easting[i] < x1 && points.northing[i] >= y0 && points.northing[i] < y1) keep.push(i);
    const local = { count: keep.length };
    for (const key of ['easting', 'northing', 'hag', 'ground', 'returnNumber', 'intensity']) local[key] = points[key].constructor.from(keep, i => points[key][i]);
    const features = crownFeatures({ cropped, parameters: lock.selected.parameters, points: local, m21, m25 });
    const predicted = features.map(f => ({ easting: lock.selected.position === 'centroid' ? f.crown.centroid.easting : f.crown.apex.easting, northing: lock.selected.position === 'centroid' ? f.crown.centroid.northing : f.crown.apex.northing, f }));
    const refs = reference.crowns.filter(c => c.window === window.id && (c.type === 'conifer' || c.type === 'broadleaf'));
    const { matches } = matchOneToOne(refs, predicted, 4);
    for (const m of matches) {
      const f = predicted[m.pi].f;
      examples.push({ ref: refs[m.ri].id, role: window.role, type: refs[m.ri].type, heightMetres: f.crown.heightMetres, features: Object.fromEntries(Object.entries(TYPE_FEATURES).map(([k, fn]) => [k, round(fn(f))])) });
    }
  }
  const calibration = examples.filter(e => e.role === 'calibration');
  const evaluation = examples.filter(e => e.role === 'evaluation');
  /* single thresholds, both directions, then AND / OR of the two best families */
  const candidates = [];
  const values = name => [...new Set(calibration.map(e => e.features[name]).filter(Number.isFinite))].sort((a, b) => a - b);
  for (const name of Object.keys(TYPE_FEATURES)) {
    for (const t of values(name)) {
      for (const dir of ['>=', '<']) {
        const rule = f => (Number.isFinite(f[name]) ? (dir === '>=' ? f[name] >= t : f[name] < t) : false);
        candidates.push({ text: `${name} ${dir} ${t}`, terms: [{ name, dir, t }], rule });
      }
    }
  }
  const scored = candidates.map(c => ({ ...c, ...balancedAccuracy(calibration, c.rule) })).sort((a, b) => b.balanced - a.balanced);
  const bestByFeature = Object.keys(TYPE_FEATURES).map(name => scored.find(c => c.terms[0].name === name)).filter(Boolean);
  const combos = [];
  for (let i = 0; i < bestByFeature.length; i++) for (let j = i + 1; j < bestByFeature.length; j++) {
    const a = bestByFeature[i], b = bestByFeature[j];
    for (const op of ['AND', 'OR']) {
      const rule = f => (op === 'AND' ? a.rule(f) && b.rule(f) : a.rule(f) || b.rule(f));
      combos.push({ text: `(${a.text}) ${op} (${b.text})`, terms: [...a.terms, ...b.terms], op, rule, ...balancedAccuracy(calibration, rule) });
    }
  }
  const all = [...scored.slice(0, 40), ...combos].sort((a, b) => b.balanced - a.balanced || a.terms.length - b.terms.length);
  const chosen = all[0];
  const out = {
    schemaVersion: 1,
    kind: 'conifer-broadleaf-rule',
    method: 'detected crowns matched (4 m, one-to-one) to reference crowns typed conifer or broadleaf by the interpreter; thresholds searched on calibration examples by balanced accuracy; reported on evaluation examples',
    examples: { calibration: calibration.length, evaluation: evaluation.length },
    chosen: { rule: chosen.text, terms: chosen.terms, op: chosen.op || null, calibration: balancedAccuracy(calibration, chosen.rule), evaluation: balancedAccuracy(evaluation, chosen.rule) },
    singleFeatureBest: bestByFeature.map(c => ({ rule: c.text, calibration: balancedAccuracy(calibration, c.rule), evaluation: balancedAccuracy(evaluation, c.rule) })),
    examplesTable: examples,
  };
  fs.writeFileSync(path.join(reviewDir, sampleFile('type-rule')), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ chosen: out.chosen, singleFeatureBest: out.singleFeatureBest }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
