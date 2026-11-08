#!/usr/bin/env node
/* Benchmark tree placement against the frozen reference sample.

   usage: node tools/johannesberg-tree-pilot/benchmark.mjs --tune      (calibration windows only; writes detector-lock.json)
          node tools/johannesberg-tree-pilot/benchmark.mjs --score     (all methods, calibration and evaluation; writes benchmark.json)

   Matching is the rule declared with the windows before scoring: one-to-one,
   closest pairs first, within 4 m. A scored reference (inside the window,
   outside every ambiguity box, at least 3 m tall) matched by a prediction is
   a true positive, unmatched a miss. A prediction inside the window and
   outside the ambiguity boxes that matches no reference at all -- scored,
   margin or small -- is an extra. Geometry: centre offset of matched pairs and
   the overlap (IoU) of the prediction's crown circle with the reference
   crown's equivalent circle (reference-seeded segment). Tuning reads only the
   calibration windows; `--score` refuses to run until detector-lock.json
   exists, and never changes it.                                            */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT, sampleFile } from './pilot-config.mjs';
import { ROOT, loadRaster } from './panels.mjs';
import { publishedPopulation } from './published-population.mjs';
import { createRaster, fillSingleCellVoids, medianFilter3x3 } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { CROWN_PARAMETERS, deriveCrownCandidates } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { TREE_DETECT_V2_DEFAULTS, circleIoU, detectTreesV2, detectionScores, matchOneToOne } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';

const args = process.argv.slice(2);
const reviewDir = path.join(ROOT, PILOT.reviewDir);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const quantile = (values, q) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const CROP_MARGIN = 25;

export function loadReference() {
  const lock = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('reference-lock')), 'utf8'));
  for (const [name, file] of [['windows', sampleFile('reference-windows')], ['annotations', sampleFile('reference-annotations')], ['reference', sampleFile('reference', 'geojson')]]) {
    if (sha(path.join(reviewDir, file)) !== lock.hashes[name]) throw new Error(`${file} changed after the reference was frozen`);
  }
  const windows = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('reference-windows')), 'utf8'));
  const geojson = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('reference', 'geojson')), 'utf8'));
  const crowns = geojson.features.filter(f => f.properties.heightMetres !== undefined).map(f => ({ ...f.properties, radius: f.properties.segment?.equivalentRadiusMetres || 1 }));
  const ambiguity = geojson.features.filter(f => f.properties.ambiguity).map(f => ({ window: f.properties.window, ring: f.geometry.coordinates[0] }));
  return { lock, windows, crowns, ambiguity };
}

function inBoxes(easting, northing, boxes) {
  return boxes.some(({ ring }) => {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    return easting >= Math.min(...xs) && easting < Math.max(...xs) && northing >= Math.min(...ys) && northing < Math.max(...ys);
  });
}

/** Score one method's predictions [{easting, northing, radius, height}] over windows. */
export function scoreWindows(reference, predictionsByWindow, windowIds, { radius = 4 } = {}) {
  const rows = [];
  const pairs = [];
  let tp = 0, missed = 0, extra = 0;
  const strata = {};
  const add = (key, hit) => { strata[key] = strata[key] || { tp: 0, missed: 0 }; strata[key][hit ? 'tp' : 'missed']++; };
  for (const id of windowIds) {
    const window = reference.windows.windows.find(w => w.id === id);
    const [we, wn, ee, en] = window.bbox;
    const refs = reference.crowns.filter(c => c.window === id);
    const boxes = reference.ambiguity.filter(a => a.window === id);
    const predicted = (predictionsByWindow.get(id) || []).filter(p => p.easting >= we - radius && p.easting < ee + radius && p.northing >= wn - radius && p.northing < en + radius);
    const { matches, unmatchedReference, unmatchedPredicted } = matchOneToOne(refs, predicted, radius);
    let wtp = 0, wmissed = 0, wextra = 0;
    const matchedRef = new Set(matches.map(m => m.ri));
    for (const m of matches) {
      const ref = refs[m.ri];
      if (!ref.scored) continue;
      wtp++;
      const p = predicted[m.pi];
      pairs.push({ ref: ref.id, offset: m.d, iou: circleIoU({ easting: p.easting, northing: p.northing, radius: Math.max(0.5, p.radius) }, { easting: ref.easting, northing: ref.northing, radius: ref.radius }), heightError: Number.isFinite(p.height) ? p.height - ref.heightMetres : null });
    }
    for (const ri of unmatchedReference) if (refs[ri].scored) wmissed++;
    for (const ref of refs.filter(r => r.scored)) { const hit = matchedRef.has(refs.indexOf(ref)); add(`stratum:${ref.stratum}`, hit); add(`type:${ref.type}`, hit); add(`height:${ref.heightMetres < 8 ? '3-8' : ref.heightMetres < 15 ? '8-15' : '15+'}`, hit); }
    for (const pi of unmatchedPredicted) {
      const p = predicted[pi];
      if (p.easting < we || p.easting >= ee || p.northing < wn || p.northing >= en) continue;
      if (inBoxes(p.easting, p.northing, boxes)) continue;
      wextra++;
    }
    tp += wtp; missed += wmissed; extra += wextra;
    rows.push({ window: id, role: window.role, ...detectionScores(wtp, wextra, wmissed) });
  }
  const offsets = pairs.map(p => p.offset);
  const ious = pairs.map(p => p.iou);
  const heightErrors = pairs.map(p => p.heightError).filter(Number.isFinite);
  return {
    ...detectionScores(tp, extra, missed),
    centreOffsetMedianMetres: round(quantile(offsets, 0.5), 2),
    centreOffsetP95Metres: round(quantile(offsets, 0.95), 2),
    crownIoUMean: round(ious.reduce((a, b) => a + b, 0) / Math.max(1, ious.length), 3),
    heightErrorMedianMetres: round(quantile(heightErrors, 0.5), 2),
    recallBy: Object.fromEntries(Object.entries(strata).sort().map(([k, v]) => [k, { ...v, recall: round(v.tp / Math.max(1, v.tp + v.missed)) }])),
    windows: rows,
    pairs,
  };
}

/* ---------- croppers and methods ---------- */
export function crop(raster, bbox, margin = CROP_MARGIN) {
  const g = raster.grid;
  const s = g.sampleSpacingMetres;
  const c0 = Math.max(0, Math.floor((bbox[0] - margin - g.minEasting) / s));
  const c1 = Math.min(g.width, Math.ceil((bbox[2] + margin - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - bbox[3] - margin) / s));
  const r1 = Math.min(g.height, Math.ceil((g.maxNorthing - bbox[1] + margin) / s));
  const width = c1 - c0, height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = raster.values[(r0 + r) * g.width + c0 + c];
  return { grid: { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s }, values };
}

export function currentDetector(legacyCrop, { individualsOnly = false } = {}) {
  const { grid, values } = legacyCrop;
  const raster = createRaster({ width: grid.width, height: grid.height, sampleSpacingMetres: grid.sampleSpacingMetres, originEasting: grid.minEasting, originNorthing: grid.maxNorthing, values });
  const { raster: filled } = fillSingleCellVoids(raster);
  const detection = medianFilter3x3(filled);
  const derived = deriveCrownCandidates({ heights: filled, detection, parameters: CROWN_PARAMETERS });
  return derived.crowns.filter(c => !individualsOnly || c.representation === 'individual')
    .map(c => ({ easting: c.centroid.easting, northing: c.centroid.northing, radius: c.radiusMetres ?? c.equivalentRadiusMetres, height: c.heightMetres }));
}

export function newDetector(cropped, parameters, { smoothed = null, position = 'apex' } = {}) {
  const { crowns } = detectTreesV2(cropped.grid, cropped.values, { parameters, smoothed });
  return crowns.map(c => ({
    easting: position === 'centroid' ? c.centroid.easting : c.apex.easting,
    northing: position === 'centroid' ? c.centroid.northing : c.apex.northing,
    radius: c.equivalentRadiusMetres, height: c.heightMetres, apex: c.apex, centroid: c.centroid,
  }));
}

/* the calibration grid; every combination is a recorded candidate */
export const TUNING_GRID = Object.freeze({
  smoothingSigmaMetres: [0.3, 0.4, 0.6, 0.8],
  windowBaseMetres: [0.5, 1.0, 1.5],
  windowSlope: [0.02, 0.05, 0.1],
  windowMinimumMetres: [1.0, 1.5, 2.0],
  windowMaximumMetres: [3, 5],
  minimumCrownAreaSquareMetres: [0.25, 2],
  minimumProminenceMetres: [0, 0.75, 1.5, 2.5],
  extentFraction: [0, 0.2, 0.3, 0.4],
  position: ['apex', 'centroid'],
});

function tune(reference) {
  const pitFree = loadRaster('chm-pitfree-050');
  const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
  const crops = new Map(calibration.map(w => [w.id, crop(pitFree, w.bbox)]));
  const smoothedBySigma = new Map();
  for (const sigma of TUNING_GRID.smoothingSigmaMetres) smoothedBySigma.set(sigma, new Map(calibration.map(w => [w.id, smoothChm(crops.get(w.id).grid, crops.get(w.id).values, sigma)])));
  const results = [];
  for (const sigma of TUNING_GRID.smoothingSigmaMetres) for (const base of TUNING_GRID.windowBaseMetres) for (const slope of TUNING_GRID.windowSlope)
    for (const wmin of TUNING_GRID.windowMinimumMetres) for (const wmax of TUNING_GRID.windowMaximumMetres) for (const area of TUNING_GRID.minimumCrownAreaSquareMetres) for (const prominence of TUNING_GRID.minimumProminenceMetres) for (const extent of TUNING_GRID.extentFraction) {
      if (wmax <= wmin) continue;
      const parameters = { ...TREE_DETECT_V2_DEFAULTS, smoothingSigmaMetres: sigma, windowBaseMetres: base, windowSlope: slope, windowMinimumMetres: wmin, windowMaximumMetres: wmax, minimumCrownAreaSquareMetres: area, minimumProminenceMetres: prominence, extentFraction: extent };
      const raw = new Map(calibration.map(w => [w.id, newDetector(crops.get(w.id), parameters, { smoothed: smoothedBySigma.get(sigma).get(w.id) })]));
      for (const position of TUNING_GRID.position) {
        const predictions = new Map([...raw].map(([id, list]) => [id, list.map(p => ({ ...p, easting: position === 'centroid' ? p.centroid.easting : p.apex.easting, northing: position === 'centroid' ? p.centroid.northing : p.apex.northing }))]));
        const score = scoreWindows(reference, predictions, calibration.map(w => w.id));
        results.push({ parameters, position, f1: score.f1, precision: score.precision, recall: score.recall, iou: score.crownIoUMean, offset: score.centreOffsetMedianMetres });
      }
    }
  /* rank: detection F1, then crown overlap, then centre offset (the workflow's order) */
  results.sort((a, b) => b.f1 - a.f1 || b.iou - a.iou || a.offset - b.offset);
  const best = results[0];
  const lock = {
    schemaVersion: 1,
    kind: 'detector-lock',
    frozenAt: new Date().toISOString(),
    referenceLockSha256: sha(path.join(reviewDir, sampleFile('reference-lock'))),
    chmSha256: pitFree.sidecar.sha256,
    code: Object.fromEntries(['packages/course-v2/vegetation/tree-detect-v2.mjs', 'packages/course-v2/vegetation/pit-free-chm.mjs', 'packages/course-v2/vegetation/crown-detect.mjs', 'tools/johannesberg-tree-pilot/benchmark.mjs'].map(f => [f, sha(path.join(ROOT, f))])),
    selection: 'calibration windows only; ranked by F1, then mean crown IoU, then median centre offset',
    grid: TUNING_GRID,
    candidatesEvaluated: results.length,
    selected: { parameters: best.parameters, position: best.position, calibration: { f1: best.f1, precision: best.precision, recall: best.recall, crownIoUMean: best.iou, centreOffsetMedianMetres: best.offset } },
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    top10: results.slice(0, 10).map(r => ({ ...r.parameters, position: r.position, f1: r.f1, precision: r.precision, recall: r.recall, iou: r.iou, offset: r.offset })),
  };
  fs.writeFileSync(path.join(reviewDir, sampleFile('detector-lock')), JSON.stringify(lock, null, 2) + '\n');
  console.log(JSON.stringify(lock.selected, null, 1));
  console.log(lock.top10.slice(0, 5).map(r => JSON.stringify(r)).join('\n'));
}

function score(reference) {
  const lock = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('detector-lock')), 'utf8'));
  if (lock.referenceLockSha256 !== sha(path.join(reviewDir, sampleFile('reference-lock')))) throw new Error('detector lock belongs to another reference');
  const pitFree = loadRaster('chm-pitfree-050');
  const legacy = loadRaster('chm-legacy-100');
  const windows = reference.windows.windows;
  const all = windows.map(w => w.bbox).reduce((a, b) => [Math.min(a[0], b[0]) - 10, Math.min(a[1], b[1]) - 10, Math.max(a[2], b[2]) + 10, Math.max(a[3], b[3]) + 10]);
  const published = publishedPopulation({ bbox: all });
  const methods = {};
  const byWindow = fn => new Map(windows.map(w => [w.id, fn(w)]));
  methods['published-individuals'] = byWindow(() => published.records.map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres })));
  methods['published-individuals+stands'] = byWindow(() => [...published.records.map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres })), ...published.standTrees.map(s => ({ easting: s.easting, northing: s.northing, radius: s.radiusMetres, height: s.objectHeightMetres }))]);
  methods['current-detector-all-crowns'] = byWindow(w => currentDetector(crop(legacy, w.bbox)));
  methods['current-detector-individuals'] = byWindow(w => currentDetector(crop(legacy, w.bbox), { individualsOnly: true }));
  methods['new-detector'] = byWindow(w => newDetector(crop(pitFree, w.bbox), lock.selected.parameters, { position: lock.selected.position }));
  const roles = { calibration: windows.filter(w => w.role === 'calibration').map(w => w.id), evaluation: windows.filter(w => w.role === 'evaluation').map(w => w.id) };
  const out = { schemaVersion: 1, kind: 'tree-benchmark', scoredAt: new Date().toISOString(), referenceLock: reference.lock.hashes, detectorLockSha256: sha(path.join(reviewDir, sampleFile('detector-lock'))), publishedGroundManifest: published.groundManifestUrl, matchingRule: reference.windows.matchingRule, gate: { precision: 0.9, recall: 0.9 }, results: {} };
  for (const [name, predictions] of Object.entries(methods)) {
    out.results[name] = {};
    for (const [role, ids] of Object.entries(roles)) {
      const { pairs, ...rest } = scoreWindows(reference, predictions, ids);
      out.results[name][role] = { ...rest, matchedReferenceIds: pairs.map(p => p.ref) };
      out.results[name][`${role}Pairs`] = pairs.map(p => ({ ref: p.ref, offset: round(p.offset, 2), iou: round(p.iou, 3), heightError: round(p.heightError, 2) }));
    }
  }
  /* paired geometry: references matched by both the published individuals+stands and the new detector */
  out.paired = {};
  for (const role of Object.keys(roles)) {
    for (const baseline of ['published-individuals+stands', 'current-detector-all-crowns']) {
      const a = new Map(out.results[baseline][`${role}Pairs`].map(p => [p.ref, p]));
      const b = new Map(out.results['new-detector'][`${role}Pairs`].map(p => [p.ref, p]));
      const both = [...a.keys()].filter(id => b.has(id)).sort();
      const stat = map => ({ offsetMedian: round(quantile(both.map(id => map.get(id).offset), 0.5), 2), offsetP95: round(quantile(both.map(id => map.get(id).offset), 0.95), 2), iouMean: round(both.reduce((s, id) => s + map.get(id).iou, 0) / Math.max(1, both.length), 3) });
      out.paired[`${role}:${baseline}-vs-new`] = { references: both.length, baseline: stat(a), candidate: stat(b), ids: both };
    }
  }
  fs.writeFileSync(path.join(reviewDir, sampleFile('benchmark')), JSON.stringify(out, null, 1) + '\n');
  for (const [name, r] of Object.entries(out.results)) for (const role of Object.keys(roles)) {
    const s = r[role];
    console.log(`${name.padEnd(30)} ${role.padEnd(11)} TP ${String(s.tp).padStart(3)} miss ${String(s.missed).padStart(3)} extra ${String(s.extra).padStart(3)}  P ${s.precision} R ${s.recall} F1 ${s.f1}  off ${s.centreOffsetMedianMetres}/${s.centreOffsetP95Metres}  IoU ${s.crownIoUMean}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reference = loadReference();
  if (args.includes('--tune')) tune(reference);
  if (args.includes('--score')) score(reference);
}
