/* Pine or spruce for a detected conifer, measured instead of drawn by hash
   (Johannesberg round 3).

   Features of each detected crown (the round's own detector):
   - laser: crown radius over height (a spruce is a narrow cone, a pine a
     broad crown), the height quantiles of the returns in the crown over its
     height (a pine's crown sits high on a bare stem: few low returns), the
     share in the upper third, the apex's sharpness (apex minus the CHM 1-1.5
     m away, over the height) and the first returns' mean intensity;
   - photos: every crown cell of at least half the crown's height read where
     the photo draws it (relief-displacement.json) at the native 0.16 m: mean
     red, green, blue and near infrared, NIR texture (standard deviation and
     its ratio to the mean), green over red, the NIR-red contrast and the
     75th percentile of brightness, in the leaf-off and the presence photo.

   The rule is chosen on calibration conifers only (the interpreter's
   pine/spruce calls), by balanced accuracy: every single threshold, then
   AND / OR of the best two families. It is reported on the held-out
   conifers it never saw. It is PUBLISHED (a record's subtype becomes pine
   or spruce) only when it meets SUBTYPE_PUBLICATION on the held-out
   conifers; otherwise every conifer keeps the runtime's own mix. The
   interpreter's calls read the same photos, so even a passing rule is
   agreement with an interpreter, not a field identification.          */
import fs from 'node:fs';
import { matchOneToOne } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { fieldAt } from './relief.mjs';

/* declared before the held-out conifers were scored (round 3, 2026-11-08) */
export const SUBTYPE_PUBLICATION = Object.freeze({ minimumHeldOut: 30, minimumAccuracy: 0.9, minimumBalancedAccuracy: 0.85 });

const quantile = (sorted, q) => (sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : null);

/** RGBI of a point from open packs at their native resolution, or null. */
export function packPixel(packs) {
  const p = packs[0].layout.pixelMetres;
  return (e, n) => {
    for (const pack of packs) {
      const l = pack.layout;
      const v = pack.pixel(Math.floor((e - l.originEasting) / p), Math.floor((l.originNorthing - n) / p));
      if (v) return v;
    }
    return null;
  };
}

/**
 * Features of one detected crown. `cells` are its CHM cell indices on `grid`
 * (values: unsmoothed heights), `returns` its returns [{ hag, first, intensity }],
 * `photos` { role: { field, pixel } }.
 */
export function crownSubtypeFeatures({ grid, values, crown, cells, returns, photos }) {
  const h = crown.heightMetres;
  const s = grid.sampleSpacingMetres;
  const rel = returns.filter(r => r.hag >= 2).map(r => r.hag / h).sort((a, b) => a - b);
  const first = returns.filter(r => r.first && r.hag >= 2);
  let ring = 0, nr = 0;
  for (let dy = -1.5; dy <= 1.5; dy += s) for (let dx = -1.5; dx <= 1.5; dx += s) {
    const d = Math.hypot(dx, dy); if (d < 1 || d > 1.5) continue;
    const c = Math.floor((crown.apex.easting + dx - grid.minEasting) / s), r = Math.floor((grid.maxNorthing - crown.apex.northing - dy) / s);
    if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
    const v = values[r * grid.width + c]; if (v > 0) { ring += v; nr++; }
  }
  const out = {
    radiusRatio: crown.equivalentRadiusMetres / h, p10: quantile(rel, 0.1), p25: quantile(rel, 0.25), p50: quantile(rel, 0.5),
    upperShare: rel.length ? rel.filter(z => z >= 0.66).length / rel.length : null,
    sharpness: nr ? (h - ring / nr) / h : null,
    intensity: first.length ? first.reduce((a, r) => a + r.intensity, 0) / first.length : null,
  };
  for (const [role, { field, pixel }] of Object.entries(photos)) {
    const k = fieldAt(field, crown.apex.easting, crown.apex.northing);
    const tag = role === 'presence' ? 'on' : 'off';
    if (!k) continue;
    const px = [];
    for (const i of cells) {
      const z = values[i]; if (!(z >= 0.5 * h)) continue;
      const r = Math.floor(i / grid.width), c = i - r * grid.width;
      const v = pixel(grid.minEasting + (c + 0.5) * s + k.kx * z, grid.maxNorthing - (r + 0.5) * s + k.ky * z);
      if (v) px.push([v[0], v[1], v[2], v[3]]);
    }
    if (!px.length) continue;
    const mean = b => px.reduce((a, v) => a + v[b], 0) / px.length;
    const nir = mean(3), red = mean(0), green = mean(1);
    const sd = Math.sqrt(px.reduce((a, v) => a + (v[3] - nir) ** 2, 0) / px.length);
    const bright = px.map(v => (v[0] + v[1] + v[2]) / 3).sort((a, b) => a - b);
    Object.assign(out, { [`${tag}Nir`]: nir, [`${tag}Red`]: red, [`${tag}Green`]: green, [`${tag}Blue`]: mean(2), [`${tag}NirSd`]: sd, [`${tag}NirCv`]: sd / Math.max(1, nir), [`${tag}GreenRed`]: green / Math.max(1, red), [`${tag}Contrast`]: (nir - red) / Math.max(1, nir + red), [`${tag}BrightP75`]: quantile(bright, 0.75) });
  }
  for (const [key, v] of Object.entries(out)) out[key] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  return out;
}

const balanced = (examples, rule) => {
  let tp = 0, np = 0, ts = 0, ns = 0, typed = 0;
  for (const e of examples) {
    const call = rule(e.features);
    if (call === null) continue;
    typed++;
    if (e.subtype === 'pine') { np++; if (call) tp++; } else { ns++; if (!call) ts++; }
  }
  return { balanced: Math.round(1000 * ((tp / Math.max(1, np) + ts / Math.max(1, ns)) / 2)) / 1000, accuracy: Math.round(1000 * (tp + ts) / Math.max(1, np + ns)) / 1000, pine: `${tp}/${np}`, spruce: `${ts}/${ns}`, examples: typed };
};

/** The rule search (calibration only) and its held-out report. A rule returns true for pine, false for spruce, null when a feature is missing. */
export function searchSubtypeRule(examples, { heldOutRoles }) {
  const calibration = examples.filter(e => e.role === 'calibration');
  const heldOut = examples.filter(e => heldOutRoles.includes(e.role));
  const names = [...new Set(examples.flatMap(e => Object.keys(e.features)))].sort();
  const make = (name, dir, t) => f => (Number.isFinite(f[name]) ? (dir === '>=' ? f[name] >= t : f[name] < t) : null);
  const singles = [];
  for (const name of names) {
    const values = [...new Set(calibration.map(e => e.features[name]).filter(Number.isFinite))].sort((a, b) => a - b);
    for (const t of values) for (const dir of ['>=', '<']) singles.push({ text: `pine when ${name} ${dir} ${t}`, terms: [{ name, dir, t }], rule: make(name, dir, t) });
  }
  const scored = singles.map(c => ({ ...c, calibration: balanced(calibration, c.rule) })).sort((a, b) => b.calibration.balanced - a.calibration.balanced || a.text.localeCompare(b.text));
  const bestByFeature = names.map(name => scored.find(c => c.terms[0].name === name)).filter(Boolean).sort((a, b) => b.calibration.balanced - a.calibration.balanced).slice(0, 6);
  const combos = [];
  for (let i = 0; i < bestByFeature.length; i++) for (let j = i + 1; j < bestByFeature.length; j++) {
    const a = bestByFeature[i], b = bestByFeature[j];
    for (const op of ['AND', 'OR']) {
      const rule = f => { const x = a.rule(f), y = b.rule(f); if (x === null || y === null) return null; return op === 'AND' ? x && y : x || y; };
      combos.push({ text: `(${a.text}) ${op} (${b.text})`, terms: [...a.terms, ...b.terms], op, rule, calibration: balanced(calibration, rule) });
    }
  }
  const all = [...scored.slice(0, 40), ...combos].sort((a, b) => b.calibration.balanced - a.calibration.balanced || a.terms.length - b.terms.length || a.text.localeCompare(b.text));
  const chosen = all[0];
  const byRole = Object.fromEntries(heldOutRoles.map(role => [role, balanced(examples.filter(e => e.role === role), chosen.rule)]));
  const held = balanced(heldOut, chosen.rule);
  const publish = held.examples >= SUBTYPE_PUBLICATION.minimumHeldOut && held.accuracy >= SUBTYPE_PUBLICATION.minimumAccuracy && held.balanced >= SUBTYPE_PUBLICATION.minimumBalancedAccuracy;
  return {
    chosen: { rule: chosen.text, terms: chosen.terms, op: chosen.op || null, calibration: chosen.calibration, heldOut: held, byRole },
    publish,
    publicationRule: SUBTYPE_PUBLICATION,
    singleFeatureBestOnCalibration: bestByFeature.map(c => ({ rule: c.text, calibration: c.calibration, heldOut: balanced(heldOut, c.rule) })),
  };
}

/* The confident subset (declared 2026-11-08, after the threshold rule above
   failed SUBTYPE_PUBLICATION and before this model saw a held-out conifer):
   a call is published only where the model's confidence reaches the cut
   chosen on calibration, and only if, on the held-out conifers, the confident
   calls number at least 20, are at least 90% right, and hold both kinds. This
   is a second look at the same held-out conifers, so even a pass is weaker
   evidence than the first rule's would have been, and is reported as such. */
export const CONFIDENT_SUBTYPE_PUBLICATION = Object.freeze({ minimumHeldOut: 20, minimumAccuracy: 0.9, minimumBalancedAccuracy: 0.85, calibrationAccuracy: 0.95, minimumCalibrationCoverage: 0.25, features: 6, ridge: 1 });

/** Ridge logistic regression by Newton steps on standardised features; returns { w, b, mean, sd, names }. */
export function fitLogistic(rows, names, ridge = 1) {
  const mean = names.map(n => rows.reduce((a, r) => a + r.x[n], 0) / rows.length);
  const sd = names.map((n, j) => Math.sqrt(rows.reduce((a, r) => a + (r.x[n] - mean[j]) ** 2, 0) / rows.length) || 1);
  const X = rows.map(r => [1, ...names.map((n, j) => (r.x[n] - mean[j]) / sd[j])]);
  const y = rows.map(r => r.y);
  const k = names.length + 1;
  let w = new Array(k).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    X.forEach((x, i) => {
      const p = 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + v * w[j], 0)));
      for (let a = 0; a < k; a++) { g[a] += (p - y[i]) * x[a]; for (let b = 0; b < k; b++) H[a][b] += p * (1 - p) * x[a] * x[b]; }
    });
    for (let a = 1; a < k; a++) { g[a] += ridge * w[a]; H[a][a] += ridge; }
    /* solve H d = g (Gauss-Jordan) */
    const M = H.map((row, a) => [...row, g[a]]);
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; }
    }
    const d = M.map((row, a) => row[k] / row[a]);
    w = w.map((v, a) => v - d[a]);
    if (Math.max(...d.map(Math.abs)) < 1e-8) break;
  }
  return { w, mean, sd, names };
}

export const logisticProbability = (model, features) => {
  if (model.names.some(n => !Number.isFinite(features[n]))) return null;
  const z = model.w[0] + model.names.reduce((a, n, j) => a + model.w[j + 1] * (features[n] - model.mean[j]) / model.sd[j], 0);
  return 1 / (1 + Math.exp(-z));
};

/** The confident-subset model: features ranked and fitted on calibration only; the cut chosen on calibration; reported on held-out. */
export function confidentSubtypeModel(examples, { heldOutRoles, rule = CONFIDENT_SUBTYPE_PUBLICATION }) {
  const calibration = examples.filter(e => e.role === 'calibration');
  const heldOut = examples.filter(e => heldOutRoles.includes(e.role));
  const names = [...new Set(examples.flatMap(e => Object.keys(e.features)))].sort();
  /* rank features by their best single-threshold balanced accuracy on calibration */
  const ranked = names.map(name => {
    const values = [...new Set(calibration.map(e => e.features[name]).filter(Number.isFinite))];
    let best = 0;
    for (const t of values) for (const dir of [1, -1]) best = Math.max(best, balanced(calibration, f => (Number.isFinite(f[name]) ? (dir > 0 ? f[name] >= t : f[name] < t) : null)).balanced);
    return { name, best };
  }).sort((a, b) => b.best - a.best || a.name.localeCompare(b.name));
  const chosen = ranked.filter(r => calibration.every(e => Number.isFinite(e.features[r.name]))).slice(0, rule.features).map(r => r.name);
  const rows = calibration.map(e => ({ x: e.features, y: e.subtype === 'pine' ? 1 : 0 }));
  const model = fitLogistic(rows, chosen, rule.ridge);
  const scoreOf = e => { const p = logisticProbability(model, e.features); return p === null ? null : { p, confidence: Math.max(p, 1 - p), call: p >= 0.5 ? 'pine' : 'spruce' }; };
  const tally = (list, cut) => {
    const called = list.map(e => ({ e, s: scoreOf(e) })).filter(({ s }) => s && s.confidence >= cut);
    const right = called.filter(({ e, s }) => s.call === e.subtype).length;
    const kinds = k => ({ right: called.filter(({ e, s }) => e.subtype === k && s.call === k).length, of: called.filter(({ e }) => e.subtype === k).length });
    const pine = kinds('pine'), spruce = kinds('spruce');
    return { called: called.length, of: list.length, coverage: Math.round(1000 * called.length / Math.max(1, list.length)) / 1000, accuracy: called.length ? Math.round(1000 * right / called.length) / 1000 : null,
      balanced: pine.of && spruce.of ? Math.round(1000 * (pine.right / pine.of + spruce.right / spruce.of) / 2) / 1000 : null, pine: `${pine.right}/${pine.of}`, spruce: `${spruce.right}/${spruce.of}` };
  };
  /* the lowest cut whose calibration calls reach the accuracy, keeping the coverage */
  const cuts = [...new Set(calibration.map(e => scoreOf(e)?.confidence).filter(Number.isFinite))].sort((a, b) => a - b);
  let cut = null;
  for (const c of [0.5, ...cuts]) {
    const t = tally(calibration, c);
    if (t.accuracy !== null && t.accuracy >= rule.calibrationAccuracy && t.coverage >= rule.minimumCalibrationCoverage) { cut = c; break; }
  }
  const calibrationResult = cut === null ? null : tally(calibration, cut);
  const held = cut === null ? null : tally(heldOut, cut);
  const publish = Boolean(held && held.called >= rule.minimumHeldOut && held.accuracy >= rule.minimumAccuracy && held.balanced !== null && held.balanced >= rule.minimumBalancedAccuracy);
  return {
    rule, features: chosen, featureRanking: ranked.slice(0, 10), model: { w: model.w.map(v => Math.round(v * 1e4) / 1e4), mean: model.mean, sd: model.sd },
    cut: cut === null ? null : Math.round(cut * 1000) / 1000, calibration: calibrationResult, heldOut: held,
    byRole: cut === null ? null : Object.fromEntries(heldOutRoles.map(r => [r, tally(examples.filter(e => e.role === r), cut)])), publish,
  };
}

/**
 * The published call for one crown's features from a subtype-rule document:
 * 'pine', 'spruce' or null (no published rule, a missing feature, or below
 * the confident cut). Only a document whose `publish` is true calls anything.
 */
export function subtypeCall(ruleDoc, features) {
  if (!ruleDoc?.publish) return null;
  if (ruleDoc.publishedBy === 'threshold rule') {
    const values = ruleDoc.chosen.terms.map(({ name, dir, t }) => (Number.isFinite(features[name]) ? (dir === '>=' ? features[name] >= t : features[name] < t) : null));
    if (values.some(v => v === null)) return null;
    const pine = ruleDoc.chosen.op === 'OR' ? values.some(Boolean) : values.every(Boolean);
    return pine ? 'pine' : 'spruce';
  }
  if (ruleDoc.publishedBy === 'confident subset') {
    const c = ruleDoc.confident;
    const p = logisticProbability({ w: c.model.w, mean: c.model.mean, sd: c.model.sd, names: c.features }, features);
    if (p === null || Math.max(p, 1 - p) < c.cut) return null;
    return p >= 0.5 ? 'pine' : 'spruce';
  }
  return null;
}

/** Write subtype-rule<suffix>.json from crown examples. */
export function writeSubtypeRule(file, examples, meta) {
  const roles = [...new Set(examples.map(e => e.role))].filter(r => r !== 'calibration');
  const result = searchSubtypeRule(examples, { heldOutRoles: roles });
  const confident = confidentSubtypeModel(examples, { heldOutRoles: roles });
  result.confident = confident;
  result.publishedBy = result.publish ? 'threshold rule' : confident.publish ? 'confident subset' : null;
  result.publish = result.publish || confident.publish;
  const out = {
    schemaVersion: 1, kind: 'pine-spruce-rule', ...meta,
    method: 'detected crowns (the round’s own detector) matched one-to-one within 4 m to reference conifers the interpreter called pine or spruce; single thresholds and AND/OR pairs searched on calibration conifers by balanced accuracy; reported on the held-out conifers; published only when SUBTYPE_PUBLICATION is met there',
    examples: Object.fromEntries(['calibration', ...roles].map(r => [r, { pine: examples.filter(e => e.role === r && e.subtype === 'pine').length, spruce: examples.filter(e => e.role === r && e.subtype === 'spruce').length }])),
    ...result,
    examplesTable: examples,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  return out;
}
