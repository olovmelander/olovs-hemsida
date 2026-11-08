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

/** Write subtype-rule<suffix>.json from crown examples. */
export function writeSubtypeRule(file, examples, meta) {
  const roles = [...new Set(examples.map(e => e.role))].filter(r => r !== 'calibration');
  const result = searchSubtypeRule(examples, { heldOutRoles: roles });
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
