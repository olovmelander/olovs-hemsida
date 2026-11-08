/* Stage `benchmark`: tune on calibration windows, calibrate the conifer /
   broadleaf rule, score every method on every role, and evaluate the held-out
   gate (from the Johannesberg pilot's benchmark, round2 and classify-types).

   --tune    a v2 round: grid search (TUNING_GRID) of detector v2 on the
             calibration windows only; a typed round: coordinate descent
             (SEARCH) of the type-aware detector from the startFrom round's
             lock, or from TYPED_DEFAULTS. Ranked by F1, then mean crown IoU,
             then median centre offset; a tie keeps the current value. The
             selection is frozen in detector-lock<suffix>.json. Refused once the
             round has been scored: its held-out sample would be tuned on.
   --types   the type rule (type-rule<suffix>.json of typeRule.round): detected
             crowns matched to the interpreter's typed reference crowns give
             labelled examples of leaf-off return structure and the leaf-off
             photo's vegetated share; thresholds and AND/OR pairs are searched
             on calibration examples by balanced accuracy and reported on the
             held-out examples they never saw.
   --score   every method (the baseline generation's records and stand
             trees, the current 1 m detector, earlier rounds' detectors, the
             round's own) on every role, one-to-one within the declared radius;
             benchmark<suffix>.json. Refused if the held-out sample was scored
             against a different lock.
   --gate    the held-out gate on the round's own detector (gate.mjs): PASS,
             or FAIL with the owner exception that covers it, or FAIL: stop.
   With no sub-step the stage runs what is missing, in that order.        */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRaster, fillSingleCellVoids, medianFilter3x3 } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { CROWN_PARAMETERS, deriveCrownCandidates } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import {
  TREE_DETECT_V2_DEFAULTS, TYPED_DEFAULTS, TYPE_BROADLEAF, TYPE_CONIFER, circleIoU, crownReturnMetrics, detectTreesTyped, detectTreesV2,
  detectionScores, matchOneToOne, typeMapFromPhoto,
} from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { REFINE_DEFAULTS, detectTreesTypedWithSeeds, keptTops, overSegmentedTops, recoverTops, suppressedTops } from './tree-refine.mjs';
import { displacementAllowance, firstReturnIndex, loadPointsFor, photoDisc } from './crown-evidence.mjs';
import { nativeBrightness, photoValley } from './relief.mjs';
import { crownSubtypeFeatures, packPixel, writeSubtypeRule } from './subtype.mjs';
import { HELD_OUT_GATE, assertHeldOutUnseen, evaluateGate, ownerExceptionFor, pendingApprovalFor, publicationVerdict, staleExceptions } from './gate.mjs';
import { loadMosaic, loadRaster, openCampaignPacks } from './panels.mjs';
import { publishedPopulation } from './published-population.mjs';
import { writeReceipt } from './receipts.mjs';
import { CONFIRM_DEFAULTS, CONFIRM_SEARCH, CONFIRM_TUNE_GRID, CONFIRM_TUNE_GRID_PRECISION, centresNear, combinations, confirmedFromPrepared, loadPhotoCrowns, photoCentres } from './photo-fusion.mjs';
import { crownsFile, photoRecordPath } from './photo-detect.mjs';

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const quantile = (values, q) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const CROP_MARGIN = 25;
const DETECTOR_CODE = ['packages/course-v2/vegetation/tree-detect-v2.mjs', 'tools/tree-pipeline/tree-refine.mjs', 'packages/course-v2/vegetation/pit-free-chm.mjs', 'packages/course-v2/vegetation/crown-detect.mjs', 'tools/tree-pipeline/relief.mjs', 'tools/tree-pipeline/benchmark.mjs', 'tools/tree-pipeline/photo-fusion.mjs'];

const lockPathOf = (ctx, roundId) => ctx.reviewFile(ctx.sampleFile('detector-lock', 'json', roundId));
const benchmarkPathOf = (ctx, roundId) => ctx.reviewFile(ctx.sampleFile('benchmark', 'json', roundId));
export const typeRulePath = ctx => ctx.reviewFile(ctx.sampleFile('type-rule', 'json', ctx.config.typeRule.round));
const readJsonIf = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

/** The frozen reference of a round; refuses a reference changed after its freeze. */
export function loadReference(ctx, roundId = ctx.round.id) {
  const file = name => ctx.reviewFile(name);
  const names = { windows: ctx.sampleFile('reference-windows', 'json', roundId), annotations: ctx.sampleFile('reference-annotations', 'json', roundId), reference: ctx.sampleFile('reference', 'geojson', roundId) };
  const lock = JSON.parse(fs.readFileSync(file(ctx.sampleFile('reference-lock', 'json', roundId)), 'utf8'));
  for (const [name, f] of Object.entries(names)) {
    if (sha(file(f)) !== lock.hashes[name]) throw new Error(`${f} changed after the reference was frozen`);
  }
  const windows = JSON.parse(fs.readFileSync(file(names.windows), 'utf8'));
  const geojson = JSON.parse(fs.readFileSync(file(names.reference), 'utf8'));
  const crowns = geojson.features.filter(f => f.properties.heightMetres !== undefined).map(f => ({ ...f.properties, radius: f.properties.segment?.equivalentRadiusMetres || 1 }));
  const ambiguity = geojson.features.filter(f => f.properties.ambiguity).map(f => ({ window: f.properties.window, ring: f.geometry.coordinates[0] }));
  return { lock, windows, crowns, ambiguity, lockSha256: sha(file(ctx.sampleFile('reference-lock', 'json', roundId))) };
}

function inBoxes(easting, northing, boxes) {
  return boxes.some(({ ring }) => {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    return easting >= Math.min(...xs) && easting < Math.max(...xs) && northing >= Math.min(...ys) && northing < Math.max(...ys);
  });
}

/** Score one method's predictions [{easting, northing, radius, height}] over windows. */
export function scoreWindows(reference, predictionsByWindow, windowIds, { radius = reference.windows.matchingRule?.radiusMetres ?? 4 } = {}) {
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

/** Crops with a cache of smoothed surfaces per sigma, for the typed detector. */
export function prepareWindows(windows, chm, leafOffMosaic) {
  return windows.map(w => ({ window: w, cropped: crop(chm, w.bbox), sigmaCache: new Map(), m21: leafOffMosaic }));
}

export function typedPredictions(entry, parameters, typeCache = new Map()) {
  const { cropped } = entry;
  const typeKey = JSON.stringify(parameters.type);
  let typeMap = typeCache.get(entry.window.id + typeKey);
  if (!typeMap) { typeMap = typeMapFromPhoto(cropped.grid, cropped.values, entry.m21, parameters.type).type; typeCache.set(entry.window.id + typeKey, typeMap); }
  const smooth = sigma => { if (!entry.sigmaCache.has(sigma)) entry.sigmaCache.set(sigma, smoothChm(cropped.grid, cropped.values, sigma)); return entry.sigmaCache.get(sigma); };
  const surfaces = { [TYPE_CONIFER]: smooth(parameters.conifer.smoothingSigmaMetres), [TYPE_BROADLEAF]: smooth(parameters.broadleaf.smoothingSigmaMetres) };
  const { crowns } = detectTreesTyped(cropped.grid, cropped.values, typeMap, parameters, { surfaces });
  return crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, radius: c.equivalentRadiusMetres, height: c.heightMetres, type: c.type }));
}

/* ---------- the refined detector (typed + photo-refereed recovery) ---------- */

/** The referee's inputs: first returns, the relief displacement fields and the native photos, keyed by role (presence, leafOff). */
export function refereeInputs(ctx, chmGrid) {
  const reliefPath = ctx.reviewFile('relief-displacement.json');
  if (!fs.existsSync(reliefPath)) throw new Error(`no ${ctx.rel(reliefPath)}: run --stage verify --relief first`);
  const relief = JSON.parse(fs.readFileSync(reliefPath, 'utf8'));
  const points = loadPointsFor(ctx, chmGrid);
  const index = firstReturnIndex(points, chmGrid);
  const photos = {};
  for (const [role, campaign] of [['presence', ctx.presence], ['leafOff', ctx.leafOff]]) {
    photos[role] = { key: campaign.key, field: relief.campaigns[campaign.key].field, brightness: nativeBrightness(openCampaignPacks(ctx, campaign.key)) };
  }
  return { index, photos, reliefSha256: sha(reliefPath) };
}

/** Callbacks for tree-refine.mjs recoverTops from the referee's inputs. */
export function refereeFor(inputs, refine = REFINE_DEFAULTS) {
  const apex = { ...REFINE_DEFAULTS.apex, ...(refine.apex || {}) };
  return {
    apexReturns: top => inputs.index.apexReturns(top.easting, top.northing, apex.radiusMetres, top.height - apex.depthMetres),
    photoValley: (role, top, other, fraction) => (inputs.photos[role] ? photoValley(inputs.photos[role].field, inputs.photos[role].brightness, top, other, fraction) : null),
  };
}

export const REFINE_FRACTIONS = Object.freeze([0.6, 0.75, 0.9]);

/** The first (typed) pass of a window and its suppressed tops with every referee measure cached, so a search only reruns the second pass. */
export function prepareRefined(entry, typedParameters, inputs, fractions = REFINE_FRACTIONS) {
  const { grid, values } = entry.cropped;
  const typeMap = typeMapFromPhoto(grid, values, entry.m21, typedParameters.type).type;
  const smoothed = sigma => { if (!entry.sigmaCache.has(sigma)) entry.sigmaCache.set(sigma, smoothChm(grid, values, sigma)); return entry.sigmaCache.get(sigma); };
  const surfaces = { [TYPE_CONIFER]: smoothed(typedParameters.conifer.smoothingSigmaMetres), [TYPE_BROADLEAF]: smoothed(typedParameters.broadleaf.smoothingSigmaMetres) };
  const first = detectTreesTyped(grid, values, typeMap, typedParameters, { surfaces });
  const smooth = smoothed(REFINE_DEFAULTS.candidateSigmaMetres);
  const tops = overSegmentedTops(grid, values, { sigmaMetres: REFINE_DEFAULTS.candidateSigmaMetres, windowMetres: REFINE_DEFAULTS.candidateWindowMetres, minimumHeightMetres: REFINE_DEFAULTS.minimumHeightMetres, smoothed: smooth });
  const suppressed = suppressedTops(grid, smooth, tops, keptTops(grid, first), typeMap, REFINE_DEFAULTS);
  const live = refereeFor(inputs);
  for (const t of suppressed) {
    t.apexCount = live.apexReturns(t);
    t.valleys = {};
    if (!t.nearestTaller) continue;
    for (const role of Object.keys(inputs.photos)) {
      t.valleys[role] = {};
      for (const f of fractions) t.valleys[role][f] = live.photoValley(role, t, t.nearestTaller, f);
    }
  }
  return { typeMap, surfaces, suppressed, first, smoothCandidates: smooth };
}

/** Predictions of the refined detector from a prepared window. */
export function refinedFromPrepared(entry, typedParameters, prepared, refine) {
  const { grid, values } = entry.cropped;
  const recovered = recoverTops(prepared.suppressed, { apexReturns: t => t.apexCount, photoValley: (role, t, o, f) => t.valleys?.[role]?.[f] ?? null }, refine);
  const { crowns } = detectTreesTypedWithSeeds(grid, values, prepared.typeMap, typedParameters, { surfaces: prepared.surfaces, extraMaxima: recovered });
  return crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, radius: c.equivalentRadiusMetres, height: c.heightMetres, type: c.type, recovered: Boolean(c.recovered) }));
}

/* the refined coordinate descent; the apex radius (0.75 m) and depth (1.5 m) and the candidate filter are fixed */
export const REFINE_SEARCH = Object.freeze([
  ['types', [['conifer'], ['conifer', 'broadleaf']]],
  ['minimumDipMetres', [0.5, 0.75, 1, 1.25, 1.5, 2]],
  ['minimumSeparationMetres', [1.5, 2, 2.5, 3]],
  ['apex.minimumReturns', [0, 2, 3, 4, 5]],
  ['photo.campaigns', [[], ['presence'], ['leafOff'], ['presence', 'leafOff']]],
  ['photo.combine', ['any', 'all']],
  ['photo.fraction', [...REFINE_FRACTIONS]],
  ['photo.minimumValley', [0, 0.05, 0.1, 0.15, 0.2, 0.3]],
]);
/* where the descent starts: a calibration-only exploration of the same measures (README, round 3) */
export const REFINE_START = Object.freeze({ types: ['conifer', 'broadleaf'], minimumDipMetres: 1, minimumSeparationMetres: 2.5, apex: { minimumReturns: 3 }, photo: { campaigns: ['presence'], combine: 'any', fraction: 0.75, minimumValley: 0.1 } });

function tuneRefined(ctx, reference) {
  const startRound = ctx.round.startFrom;
  if (!startRound) throw new Error('a refined round needs startFrom: the typed round whose lock it refines');
  const startLock = JSON.parse(fs.readFileSync(lockPathOf(ctx, startRound), 'utf8'));
  const typedParameters = startLock.selected.parameters;
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
  const entries = prepareWindows(calibration, chm, m21);
  const inputs = refereeInputs(ctx, chm.grid);
  const prepared = new Map(entries.map(e => [e.window.id, prepareRefined(e, typedParameters, inputs)]));
  const evaluate = refine => {
    const predictions = new Map(entries.map(e => [e.window.id, refinedFromPrepared(e, typedParameters, prepared.get(e.window.id), refine)]));
    const s = scoreWindows(reference, predictions, calibration.map(w => w.id));
    return { f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra };
  };
  const withoutRecovery = (() => {
    const predictions = new Map(entries.map(e => [e.window.id, typedPredictions(e, typedParameters)]));
    const s = scoreWindows(reference, predictions, calibration.map(w => w.id));
    return { f1: s.f1, precision: s.precision, recall: s.recall, tp: s.tp, missed: s.missed, extra: s.extra };
  })();
  const get = (o, key) => key.split('.').reduce((a, k) => a[k], o);
  const put = (o, key, value) => { const copy = JSON.parse(JSON.stringify(o)); const parts = key.split('.'); let t = copy; for (const k of parts.slice(0, -1)) t = t[k]; t[parts.at(-1)] = value; return copy; };
  let current = JSON.parse(JSON.stringify(REFINE_START));
  let best = evaluate(current);
  const trajectory = [{ step: 'start (REFINE_START)', ...best }];
  let evaluations = 1;
  for (let pass = 1; pass <= 4; pass++) {
    let changed = false;
    for (const [key, values] of REFINE_SEARCH) {
      for (const value of values) {
        if (JSON.stringify(get(current, key)) === JSON.stringify(value)) continue;
        const candidate = put(current, key, value);
        const score = evaluate(candidate);
        evaluations++;
        if (better(score, best)) { current = candidate; best = score; changed = true; trajectory.push({ step: `pass ${pass}: ${key} = ${JSON.stringify(value)}`, ...score }); }
      }
    }
    if (!changed) break;
  }
  const suppressedCount = [...prepared.values()].reduce((a, p) => a + p.suppressed.length, 0);
  return {
    schemaVersion: 1,
    kind: 'detector-lock',
    round: ctx.round.id,
    detector: 'refined',
    method: `refined detector: the ${startRound} type-aware lock, then the tops it suppressed taken back only where the laser shows their own cone and apex and the photo shows a separate crown (tree-refine.mjs; relief displacement from relief-displacement.json)`,
    frozenAt: new Date().toISOString(),
    referenceLockSha256: reference.lockSha256,
    chmSha256: chm.sidecar.sha256,
    reliefSha256: inputs.reliefSha256,
    startLockSha256: sha(lockPathOf(ctx, startRound)),
    code: codeHashes(ctx),
    selection: `calibration windows only; the ${startRound} typed settings fixed; coordinate descent over REFINE_SEARCH from REFINE_START, ranked by F1, then mean crown IoU, then median centre offset; ties keep the current value`,
    search: Object.fromEntries(REFINE_SEARCH),
    fixed: { candidateSigmaMetres: REFINE_DEFAULTS.candidateSigmaMetres, candidateWindowMetres: REFINE_DEFAULTS.candidateWindowMetres, minimumHeightMetres: REFINE_DEFAULTS.minimumHeightMetres, keptRadiusMetres: REFINE_DEFAULTS.keptRadiusMetres, neighbourRadiusMetres: REFINE_DEFAULTS.neighbourRadiusMetres, apex: { radiusMetres: REFINE_DEFAULTS.apex.radiusMetres, depthMetres: REFINE_DEFAULTS.apex.depthMetres } },
    suppressedTopsOnCalibration: suppressedCount,
    withoutRecovery,
    evaluations,
    selected: { parameters: typedParameters, refine: current, calibration: best },
    trajectory,
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    photoDetector: 'none: a classical photo test (a brightness valley between two displaced tops); no learned model, no GPU',
  };
}


/* ---------- the fused detector (round 4: refined + learned photo crowns) ---------- */

/** The photo detector record of a fused round and its relief field (presence photo). */
function fusedInputs(ctx, roundId = ctx.round.id) {
  const recordPath = ctx.reviewFile(ctx.sampleFile('photo-detect', 'json', roundId));
  if (!fs.existsSync(recordPath)) throw new Error(`no ${ctx.rel(recordPath)}: run --stage photo-detect first`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const relief = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8'));
  return { record, recordPath, field: relief.campaigns[ctx.presence.key].field };
}

/** Photo centres of one source part, checked against the record's sha256. */
function sourceCentres(ctx, record, source, part) {
  const file = crownsFile(ctx, source, part);
  const expected = record.sources[source]?.[part]?.sha256;
  if (!fs.existsSync(file) || sha(file) !== expected) throw new Error(`${ctx.rel(file)} is missing or differs from photo-detect's record: rerun --stage photo-detect`);
  return photoCentres(loadPhotoCrowns(file).crowns);
}

function tuneFused(ctx, reference) {
  const startRound = ctx.round.startFrom;
  const startLock = JSON.parse(fs.readFileSync(lockPathOf(ctx, startRound), 'utf8'));
  if (!startLock.selected?.refine) throw new Error('a fused round needs startFrom: a refined round whose lock it extends');
  const typedParameters = startLock.selected.parameters, refine = startLock.selected.refine;
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
  const ids = calibration.map(w => w.id);
  const entries = prepareWindows(calibration, chm, m21);
  const inputs = refereeInputs(ctx, chm.grid);
  const fractions = [...new Set([...REFINE_FRACTIONS, refine.photo?.fraction ?? REFINE_DEFAULTS.photo.fraction])];
  const prepared = new Map(entries.map(e => [e.window.id, prepareRefined(e, typedParameters, inputs, fractions)]));
  const { record, recordPath, field } = fusedInputs(ctx);
  /* a round may declare its own tuning (photoDetect.tuning.<round>): which sources, which detections (the scored whole-window run or the calibration run), and a precision floor */
  const tuning = ctx.config.photoDetect?.tuning?.[ctx.round.id] || null;
  const summary = s => ({ f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra });
  const startScore = summary(scoreWindows(reference, new Map(entries.map(e => [e.window.id, refinedFromPrepared(e, typedParameters, prepared.get(e.window.id), refine)])), ids));
  let evaluations = 0;
  const perSource = {};
  let best = null;
  const floor = tuning?.precisionAtLeastStart ? startScore.precision : -Infinity;
  const ok = s => s.precision >= floor;
  const grid = tuning ? CONFIRM_TUNE_GRID_PRECISION : CONFIRM_TUNE_GRID;
  for (const source of Object.keys(record.sources).filter(id => !tuning?.sources || tuning.sources.includes(id))) {
    const centres = sourceCentres(ctx, record, source, tuning?.crowns || 'calibration');
    const near = new Map(entries.map(e => [e.window.id, centresNear(centres, e.cropped.grid)]));
    const evaluate = fuse => { evaluations++; return summary(scoreWindows(reference, new Map(entries.map(e => [e.window.id, confirmedFromPrepared(e, typedParameters, prepared.get(e.window.id), refine, near.get(e.window.id), field, fuse)])), ids)); };
    let current = null, score = null;
    for (const fuse of combinations(grid, CONFIRM_DEFAULTS)) {
      const s = evaluate(fuse);
      if (!ok(s)) continue;
      if (!score || better(s, score)) { current = fuse; score = s; }
    }
    if (!score) { perSource[source] = { fuse: null, calibration: null, note: 'no setting kept the precision floor' }; continue; }
    const trajectory = [{ step: 'best of CONFIRM_TUNE_GRID', fuse: current, ...score }];
    for (let pass = 1; pass <= 3; pass++) {
      let changed = false;
      for (const [key, values] of CONFIRM_SEARCH) for (const value of values) {
        if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
        const candidate = { ...current, [key]: value };
        const s = evaluate(candidate);
        if (ok(s) && better(s, score)) { current = candidate; score = s; changed = true; trajectory.push({ step: `pass ${pass}: ${key} = ${JSON.stringify(value)}`, ...s }); }
      }
      if (!changed) break;
    }
    perSource[source] = { fuse: current, calibration: score, trajectory };
    console.log(`${source.padEnd(8)} calibration P ${score.precision} R ${score.recall} F1 ${score.f1} (tp ${score.tp} miss ${score.missed} extra ${score.extra}) ${JSON.stringify(current)}`);
    if (!best || better(score, best.calibration)) best = { source, fuse: current, calibration: score };
  }
  return {
    schemaVersion: 1,
    kind: 'detector-lock',
    round: ctx.round.id,
    detector: 'fused',
    method: `fused detector: the ${startRound} refined lock (type-aware detector, then laser- and photo-refereed recovery), then the suppressed laser tops a learned photo crown confirms (DeepForest on the ${ctx.presence.date} photo; photo-fusion.mjs, confirm mode): tops moved to where the photo draws them by the relief field, paired one-to-one with photo boxes, and taken back only when their box scores high enough and the laser shows their own crown; the photo never places a seed of its own`,
    frozenAt: new Date().toISOString(),
    referenceLockSha256: reference.lockSha256,
    chmSha256: chm.sidecar.sha256,
    reliefSha256: inputs.reliefSha256,
    startLockSha256: sha(lockPathOf(ctx, startRound)),
    photoDetectSha256: sha(recordPath),
    code: codeHashes(ctx),
    tuning: tuning || null,
    selection: `${tuning ? `round tuning ${JSON.stringify({ sources: tuning.sources, crowns: tuning.crowns, precisionFloor: tuning.precisionAtLeastStart ? startScore.precision : null })}; ` : ''}calibration windows only; the ${startRound} typed and refine settings fixed; per photo source (photo-detect's calibration crowns, cross-fitted for fine-tuned weights) the joint CONFIRM_TUNE_GRID, then a coordinate polish over CONFIRM_SEARCH; the source and settings with the best calibration F1 (then mean crown IoU, then median centre offset) are locked`,
    grid,
    search: Object.fromEntries(CONFIRM_SEARCH),
    withoutPhoto: startScore,
    evaluations,
    perSource,
    selected: { parameters: typedParameters, refine, photo: { source: best.source, model: record.model, allCrownsSha256: record.sources[best.source].all.sha256, calibrationCrownsSha256: record.sources[best.source].calibration.sha256, tunedOn: tuning?.crowns || 'calibration' }, fuse: best.fuse, calibration: best.calibration },
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    photoDetector: `learned: ${record.model.id} at ${record.model.revision.slice(0, 12)} (weights sha256 ${record.model.sha256.slice(0, 12)}...), source ${best.source}, on the GPU (photo-detect stage)`,
  };
}

/* ---------- pine or spruce (subtype.mjs) ---------- */

export const subtypeRulePath = ctx => ctx.reviewFile(ctx.sampleFile('subtype-rule'));

/** Pine/spruce examples: the round's detector on every window, matched to the interpreter's pine/spruce calls. */
function subtypeExamples(ctx, reference, lock) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const inputs = refereeInputs(ctx, chm.grid);
  const points = loadPointsFor(ctx, chm.grid);
  const relief = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8'));
  const photos = Object.fromEntries([['presence', ctx.presence], ['leafOff', ctx.leafOff]].map(([role, c]) => [role, { field: relief.campaigns[c.key].field, pixel: packPixel(openCampaignPacks(ctx, c.key)) }]));
  const refined = Boolean(lock.selected.refine);
  const examples = [];
  for (const w of reference.windows.windows) {
    const refs = reference.crowns.filter(c => c.window === w.id && c.scored && c.type === 'conifer' && (c.subtype === 'pine' || c.subtype === 'spruce'));
    if (!refs.length) continue;
    const [entry] = prepareWindows([w], chm, m21);
    const { grid, values } = entry.cropped;
    const typed = lock.selected.parameters;
    const prepared = prepareRefined(entry, typed, inputs);
    const recovered = refined ? recoverTops(prepared.suppressed, { apexReturns: t => t.apexCount, photoValley: (r, t, o, f) => t.valleys?.[r]?.[f] ?? null }, lock.selected.refine) : [];
    const det = detectTreesTypedWithSeeds(grid, values, prepared.typeMap, typed, { surfaces: prepared.surfaces, extraMaxima: recovered });
    const cellsOf = new Map();
    for (let i = 0; i < det.labels.length; i++) { const k = det.labels[i]; if (k < 0) continue; if (!cellsOf.has(k)) cellsOf.set(k, []); cellsOf.get(k).push(i); }
    const s = grid.sampleSpacingMetres;
    const returnsOf = new Map();
    for (let i = 0; i < points.count; i++) {
      const c = Math.floor((points.easting[i] - grid.minEasting) / s), r = Math.floor((grid.maxNorthing - points.northing[i]) / s);
      if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
      const k = det.labels[r * grid.width + c]; if (k < 0) continue;
      if (!returnsOf.has(k)) returnsOf.set(k, []);
      returnsOf.get(k).push({ hag: points.hag[i], first: points.returnNumber[i] === 1, intensity: points.intensity[i] });
    }
    const predicted = det.crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, crown: c }));
    const { matches } = matchOneToOne(refs, predicted, reference.windows.matchingRule?.radiusMetres ?? 4);
    for (const m of matches) {
      const crown = predicted[m.pi].crown;
      examples.push({ ref: refs[m.ri].id, role: w.role, subtype: refs[m.ri].subtype, heightMetres: round(crown.heightMetres, 2), features: crownSubtypeFeatures({ grid, values, crown, cells: cellsOf.get(crown.id) || [], returns: returnsOf.get(crown.id) || [], photos }) });
    }
  }
  return examples;
}

/* ---------- tuning ---------- */

/* the v2 calibration grid; every combination is a recorded candidate */
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

/* the typed coordinate descent */
export const SEARCH = Object.freeze([
  ['type.coniferShare', [0.35, 0.45, 0.5, 0.55, 0.65]],
  ['type.radiusSlope', [0.05, 0.1, 0.15, 0.25]],
  ['conifer.smoothingSigmaMetres', [0, 0.25, 0.4, 0.6]],
  ['conifer.windowBaseMetres', [0.5, 1, 1.5, 2]],
  ['conifer.windowSlope', [0, 0.03, 0.05, 0.08]],
  ['conifer.windowMinimumMetres', [0.75, 1, 1.5]],
  ['conifer.windowMaximumMetres', [2, 2.5, 3, 4]],
  ['conifer.prominenceMetres', [0, 0.5, 1]],
  ['conifer.position', ['apex', 'centroid']],
  ['broadleaf.smoothingSigmaMetres', [0.4, 0.6, 0.8, 1, 1.25]],
  ['broadleaf.windowBaseMetres', [1, 1.5, 2, 2.5, 3]],
  ['broadleaf.windowSlope', [0, 0.05, 0.08, 0.12]],
  ['broadleaf.windowMinimumMetres', [1, 1.5, 2, 3]],
  ['broadleaf.windowMaximumMetres', [3, 4, 5, 6]],
  ['broadleaf.prominenceMetres', [0, 0.5, 1, 1.5, 2.5]],
  ['broadleaf.prominenceFraction', [0, 0.05, 0.1, 0.2]],
  ['broadleaf.position', ['apex', 'centroid']],
  ['shared.extentFraction', [0.15, 0.2, 0.3]],
  ['conifer.minimumCandidateHeightMetres', [2, 2.5, 3]],
  ['broadleaf.minimumCandidateHeightMetres', [2, 2.5, 3]],
  ['shared.minimumCrownAreaSquareMetres', [0.25, 1, 2, 4]],
  /* the oversized-crown split is searched as one joint choice: its settings only act together */
  ['split', [{ areaFactor: 0, allometryBaseMetres: 1, allometrySlope: 0.1, fineSigmaMetres: 0.25, windowMetres: 1.25, minimumSeparationMetres: 2, seedFraction: 0.6 },
    ...[1.5, 2, 3].flatMap(areaFactor => [0.06, 0.1, 0.14].flatMap(allometrySlope => [0, 0.25].flatMap(fineSigmaMetres => [1, 1.5].flatMap(windowMetres => [1.5, 2, 2.5].flatMap(minimumSeparationMetres => [0.5, 0.7, 0.85].map(seedFraction => ({ areaFactor, allometryBaseMetres: 1, allometrySlope, fineSigmaMetres, windowMetres, minimumSeparationMetres, seedFraction }))))))) ]],
]);

/** The typed start: an earlier v2 lock's settings for both types, or TYPED_DEFAULTS. */
export function typedStart(v2Lock) {
  if (!v2Lock) {
    return JSON.parse(JSON.stringify({ type: TYPED_DEFAULTS.type, conifer: TYPED_DEFAULTS.conifer, broadleaf: TYPED_DEFAULTS.broadleaf, shared: TYPED_DEFAULTS.shared, split: TYPED_DEFAULTS.split }));
  }
  const p = v2Lock.selected.parameters;
  const typeParams = { smoothingSigmaMetres: p.smoothingSigmaMetres, windowBaseMetres: p.windowBaseMetres, windowSlope: p.windowSlope, windowMinimumMetres: p.windowMinimumMetres, windowMaximumMetres: p.windowMaximumMetres, minimumCandidateHeightMetres: p.minimumCandidateHeightMetres, prominenceMetres: p.minimumProminenceMetres || 0, prominenceFraction: 0, position: v2Lock.selected.position };
  return {
    type: { ndviThreshold: 0.12, coniferShare: 0.5, radiusBaseMetres: 1.5, radiusSlope: 0.15 },
    conifer: { ...typeParams },
    broadleaf: { ...typeParams },
    shared: { seedFraction: p.seedFraction, crownFraction: p.crownFraction, maximumCrownRadiusMetres: p.maximumCrownRadiusMetres, extentFraction: p.extentFraction, minimumCrownAreaSquareMetres: p.minimumCrownAreaSquareMetres },
    split: { areaFactor: 0, allometryBaseMetres: 1, allometrySlope: 0.1, fineSigmaMetres: 0.25, windowMetres: 1.25, minimumSeparationMetres: 2, seedFraction: 0.6 },
  };
}

const setPath = (object, key, value) => { const [a, b] = key.split('.'); return b === undefined ? { ...object, [a]: value } : { ...object, [a]: { ...object[a], [b]: value } }; };
const getPath = (object, key) => { const [a, b] = key.split('.'); return b === undefined ? object[a] : object[a][b]; };
/** Ranking: detection F1, then crown overlap, then centre offset; a tie keeps the current value. */
export const better = (a, b) => (a.f1 !== b.f1 ? a.f1 > b.f1 : a.iou !== b.iou ? a.iou > b.iou : a.offset < b.offset);

function codeHashes(ctx) {
  return Object.fromEntries(DETECTOR_CODE.map(f => [f, sha(path.join(ctx.root, f))]));
}

function tuneV2(ctx, reference) {
  const pitFree = loadRaster(ctx, 'chm-pitfree-050');
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
  results.sort((a, b) => b.f1 - a.f1 || b.iou - a.iou || a.offset - b.offset);
  const best = results[0];
  return {
    schemaVersion: 1,
    kind: 'detector-lock',
    round: ctx.round.id,
    detector: 'v2',
    frozenAt: new Date().toISOString(),
    referenceLockSha256: reference.lockSha256,
    chmSha256: pitFree.sidecar.sha256,
    code: codeHashes(ctx),
    selection: 'calibration windows only; ranked by F1, then mean crown IoU, then median centre offset',
    grid: TUNING_GRID,
    candidatesEvaluated: results.length,
    selected: { parameters: best.parameters, position: best.position, calibration: { f1: best.f1, precision: best.precision, recall: best.recall, crownIoUMean: best.iou, centreOffsetMedianMetres: best.offset } },
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    top10: results.slice(0, 10).map(r => ({ ...r.parameters, position: r.position, f1: r.f1, precision: r.precision, recall: r.recall, iou: r.iou, offset: r.offset })),
  };
}

function tuneTyped(ctx, reference) {
  const startLock = ctx.round.startFrom ? JSON.parse(fs.readFileSync(lockPathOf(ctx, ctx.round.startFrom), 'utf8')) : null;
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const calibration = reference.windows.windows.filter(w => w.role === 'calibration');
  const entries = prepareWindows(calibration, chm, m21);
  const typeCache = new Map();
  const evaluate = parameters => {
    const predictions = new Map(entries.map(e => [e.window.id, typedPredictions(e, parameters, typeCache)]));
    const s = scoreWindows(reference, predictions, calibration.map(w => w.id));
    return { f1: s.f1, precision: s.precision, recall: s.recall, iou: s.crownIoUMean, offset: s.centreOffsetMedianMetres, tp: s.tp, missed: s.missed, extra: s.extra };
  };
  let current = typedStart(startLock);
  let best = evaluate(current);
  const trajectory = [{ step: startLock ? `start (${ctx.round.startFrom} settings for both types)` : 'start (TYPED_DEFAULTS)', ...best }];
  let evaluations = 1;
  for (let pass = 1; pass <= 6; pass++) {
    let changed = false;
    for (const [key, values] of SEARCH) {
      for (const value of values) {
        if (JSON.stringify(getPath(current, key)) === JSON.stringify(value)) continue;
        const candidate = setPath(current, key, value);
        if (getPath(candidate, 'conifer.windowMaximumMetres') < getPath(candidate, 'conifer.windowMinimumMetres')) continue;
        if (getPath(candidate, 'broadleaf.windowMaximumMetres') < getPath(candidate, 'broadleaf.windowMinimumMetres')) continue;
        const score = evaluate(candidate);
        evaluations++;
        if (better(score, best)) { current = candidate; best = score; changed = true; trajectory.push({ step: `pass ${pass}: ${key} = ${JSON.stringify(value)}`, ...score }); }
      }
    }
    if (!changed) break;
  }
  return {
    schemaVersion: 1,
    kind: 'detector-lock',
    round: ctx.round.id,
    detector: 'typed',
    method: `type-aware detector (tree-detect-v2.mjs detectTreesTyped): leaf-off ${ctx.leafOff.date} conifer map before detection, per-type smoothing / window / merge / position, simultaneous growth`,
    frozenAt: new Date().toISOString(),
    referenceLockSha256: reference.lockSha256,
    chmSha256: chm.sidecar.sha256,
    code: codeHashes(ctx),
    selection: `calibration windows only; coordinate descent from ${startLock ? `the ${ctx.round.startFrom} lock` : 'TYPED_DEFAULTS'} over SEARCH, ranked by F1, then mean crown IoU, then median centre offset; ties keep the current value`,
    search: Object.fromEntries(SEARCH.map(([k, v]) => [k, k === 'split' ? `${v.length} joint settings (areaFactor 0 | 1.5, 2, 3 x slope 0.06, 0.1, 0.14 x fine sigma 0, 0.25 x window 1, 1.5 x separation 1.5, 2, 2.5 x seed fraction 0.5, 0.7, 0.85)` : v])),
    evaluations,
    selected: { parameters: current, calibration: best },
    trajectory,
    windowRadiusIs: 'radius (not diameter) of the circular local-maximum window, metres',
    photoDetector: 'not run: no GPU work (no deep-learning photo detector)',
  };
}

/* ---------- the type rule ---------- */

export const TYPE_FEATURES = Object.freeze({
  firstCanopyShare: f => f.returns?.firstCanopyShare,
  groundShare: f => f.returns?.groundShare,
  aprilContrastP90: f => f.april?.contrastP90,
  aprilVegetatedShare: f => f.april?.vegetatedShare,
});

function cropWithOrigin(raster, bbox, margin = 25) {
  const g = raster.grid, s = g.sampleSpacingMetres;
  const c0 = Math.max(0, Math.floor((bbox[0] - margin - g.minEasting) / s)), c1 = Math.min(g.width, Math.ceil((bbox[2] + margin - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - bbox[3] - margin) / s)), r1 = Math.min(g.height, Math.ceil((g.maxNorthing - bbox[1] + margin) / s));
  const width = c1 - c0, height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = raster.values[(r0 + r) * g.width + c0 + c];
  return { grid: { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s }, values, c0, r0 };
}

/** Features of every detected crown in a cropped CHM (v2 or typed lock). */
export function crownFeatures({ cropped, lock, points, m21, m25 }) {
  const { grid } = cropped;
  /* a typed lock carries per-type settings (the pilot's round-2 lock predates the `detector` field) */
  const typed = Boolean(lock.selected?.parameters?.conifer);
  const result = typed
    ? detectTreesTyped(grid, cropped.values, typeMapFromPhoto(grid, cropped.values, m21, lock.selected.parameters.type).type, lock.selected.parameters)
    : detectTreesV2(grid, cropped.values, { parameters: lock.selected.parameters });
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
    const at = typed ? crown.position : lock.selected.position === 'centroid' ? crown.centroid : crown.apex;
    return { crown, at, returns: metrics.get(crown.id), april, june };
  });
}

function balancedAccuracy(examples, rule) {
  let tc = 0, nc = 0, tb = 0, nb = 0;
  for (const e of examples) {
    const conifer = rule(e.features);
    if (e.type === 'conifer') { nc++; if (conifer) tc++; } else { nb++; if (!conifer) tb++; }
  }
  return { balanced: (tc / Math.max(1, nc) + tb / Math.max(1, nb)) / 2, coniferRecall: tc / Math.max(1, nc), broadleafRecall: tb / Math.max(1, nb), conifers: nc, broadleaves: nb };
}

function classifyTypes(ctx) {
  const typeRound = ctx.roundOf(ctx.config.typeRule.round);
  const reference = loadReference(ctx, typeRound.id);
  const lock = JSON.parse(fs.readFileSync(lockPathOf(ctx, typeRound.id), 'utf8'));
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const points = loadPointsFor(ctx, chm.grid);
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const m25 = loadMosaic(ctx, ctx.presence.key);
  const examples = [];
  for (const window of reference.windows.windows) {
    const cropped = cropWithOrigin(chm, window.bbox);
    /* keep only the points of this crop for speed */
    const [x0, y0, x1, y1] = [cropped.grid.minEasting, cropped.grid.maxNorthing - cropped.grid.height * 0.5, cropped.grid.minEasting + cropped.grid.width * 0.5, cropped.grid.maxNorthing];
    const keep = [];
    for (let i = 0; i < points.count; i++) if (points.easting[i] >= x0 && points.easting[i] < x1 && points.northing[i] >= y0 && points.northing[i] < y1) keep.push(i);
    const local = { count: keep.length };
    for (const key of ['easting', 'northing', 'hag', 'ground', 'returnNumber', 'intensity']) local[key] = points[key].constructor.from(keep, i => points[key][i]);
    const features = crownFeatures({ cropped, lock, points: local, m21, m25 });
    const predicted = features.map(f => ({ easting: f.at.easting, northing: f.at.northing, f }));
    const refs = reference.crowns.filter(c => c.window === window.id && (c.type === 'conifer' || c.type === 'broadleaf'));
    const { matches } = matchOneToOne(refs, predicted, reference.windows.matchingRule?.radiusMetres ?? 4);
    for (const m of matches) {
      const f = predicted[m.pi].f;
      examples.push({ ref: refs[m.ri].id, role: window.role, type: refs[m.ri].type, heightMetres: f.crown.heightMetres, features: Object.fromEntries(Object.entries(TYPE_FEATURES).map(([k, fn]) => [k, round(fn(f))])) });
    }
  }
  const calibration = examples.filter(e => e.role === 'calibration');
  const evaluation = examples.filter(e => e.role === typeRound.evaluationRole);
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
  return {
    schemaVersion: 1,
    kind: 'conifer-broadleaf-rule',
    method: 'detected crowns matched (4 m, one-to-one) to reference crowns typed conifer or broadleaf by the interpreter; thresholds searched on calibration examples by balanced accuracy; reported on evaluation examples',
    examples: { calibration: calibration.length, evaluation: evaluation.length },
    chosen: { rule: chosen.text, terms: chosen.terms, op: chosen.op || null, calibration: balancedAccuracy(calibration, chosen.rule), evaluation: balancedAccuracy(evaluation, chosen.rule) },
    singleFeatureBest: bestByFeature.map(c => ({ rule: c.text, calibration: balancedAccuracy(calibration, c.rule), evaluation: balancedAccuracy(evaluation, c.rule) })),
    examplesTable: examples,
  };
}

/* ---------- scoring ---------- */

function predictorFor(ctx, roundConfig, lock, { chm, entries, referee }) {
  if (roundConfig.detector === 'fused') {
    const { record, field } = fusedInputs(ctx, roundConfig.id);
    if (record.sources[lock.selected.photo.source]?.all?.sha256 !== lock.selected.photo.allCrownsSha256) throw new Error('the photo crowns the fused lock names are not the ones photo-detect recorded');
    const centres = sourceCentres(ctx, record, lock.selected.photo.source, 'all');
    return w => {
      const entry = entries.get(w.id);
      const fractions = [...new Set([...REFINE_FRACTIONS, lock.selected.refine.photo?.fraction ?? REFINE_DEFAULTS.photo.fraction])];
      return confirmedFromPrepared(entry, lock.selected.parameters, prepareRefined(entry, lock.selected.parameters, referee(), fractions), lock.selected.refine, centresNear(centres, entry.cropped.grid), field, lock.selected.fuse);
    };
  }
  if (roundConfig.detector === 'refined') {
    return w => {
      const entry = entries.get(w.id);
      const fractions = [...new Set([...REFINE_FRACTIONS, lock.selected.refine.photo?.fraction ?? REFINE_DEFAULTS.photo.fraction])];
      return refinedFromPrepared(entry, lock.selected.parameters, prepareRefined(entry, lock.selected.parameters, referee(), fractions), lock.selected.refine);
    };
  }
  return roundConfig.detector === 'typed'
    ? w => typedPredictions(entries.get(w.id), lock.selected.parameters)
    : w => newDetector(crop(chm, w.bbox), lock.selected.parameters, { position: lock.selected.position });
}

function score(ctx, reference, lock, lockSha256) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const legacy = loadRaster(ctx, 'chm-legacy-100');
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const windows = reference.windows.windows;
  const all = windows.map(w => w.bbox).reduce((a, b) => [Math.min(a[0], b[0]) - 10, Math.min(a[1], b[1]) - 10, Math.max(a[2], b[2]) + 10, Math.max(a[3], b[3]) + 10]);
  const published = publishedPopulation(ctx, { bbox: all, groundManifestUrl: ctx.config.published.baselineGroundManifest });
  const byWindow = fn => new Map(windows.map(w => [w.id, fn(w)]));
  const entries = new Map(prepareWindows(windows, chm, m21).map(e => [e.window.id, e]));
  let inputs = null;
  const referee = () => (inputs ||= refereeInputs(ctx, chm.grid));
  const methods = {
    'published-individuals': byWindow(() => published.records.map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres }))),
    'published-individuals+stands': byWindow(() => [...published.records, ...published.standTrees].map(r => ({ easting: r.easting, northing: r.northing, radius: r.radiusMetres, height: r.objectHeightMetres }))),
    'current-detector-all-crowns': byWindow(w => currentDetector(crop(legacy, w.bbox))),
  };
  /* every earlier round with a lock, under the name later rounds compare it by */
  const earlier = ctx.config.rounds.slice(0, ctx.config.rounds.findIndex(r => r.id === ctx.round.id)).filter(r => fs.existsSync(lockPathOf(ctx, r.id)));
  const comparedLocks = {};
  for (const r of earlier) {
    const earlierLock = JSON.parse(fs.readFileSync(lockPathOf(ctx, r.id), 'utf8'));
    comparedLocks[r.id] = sha(lockPathOf(ctx, r.id));
    methods[r.comparedAs || r.methodName] = byWindow(predictorFor(ctx, r, earlierLock, { chm, entries, referee }));
  }
  methods[ctx.round.methodName] = byWindow(predictorFor(ctx, ctx.round, lock, { chm, entries, referee }));
  const roles = Object.fromEntries(ctx.round.roles.map(role => [role, windows.filter(w => w.role === role).map(w => w.id)]));
  const out = { schemaVersion: 1, kind: 'tree-benchmark', round: ctx.round.id, scoredAt: new Date().toISOString(), referenceLock: reference.lock.hashes, detectorLockSha256: lockSha256, comparedLocks, publishedGroundManifest: published.groundManifestUrl, matchingRule: reference.windows.matchingRule,
    gate: { precision: HELD_OUT_GATE.precision, recall: HELD_OUT_GATE.recall, minimumScoredCrowns: HELD_OUT_GATE.minimumScoredCrowns, on: `${ctx.round.evaluationRole} (unseen held-out)`, method: ctx.round.methodName }, roles, results: {} };
  for (const [name, predictions] of Object.entries(methods)) {
    out.results[name] = {};
    for (const [role, ids] of Object.entries(roles)) {
      const { pairs, ...rest } = scoreWindows(reference, predictions, ids);
      out.results[name][role] = { ...rest, matchedReferenceIds: pairs.map(p => p.ref) };
      out.results[name][`${role}Pairs`] = pairs.map(p => ({ ref: p.ref, offset: round(p.offset, 2), iou: round(p.iou, 3), heightError: round(p.heightError, 2) }));
    }
  }
  /* paired geometry: the same references matched by a baseline and the round's detector */
  out.paired = {};
  for (const role of Object.keys(roles)) {
    for (const baseline of ['published-individuals+stands', 'current-detector-all-crowns', ...earlier.map(r => r.comparedAs || r.methodName)]) {
      const a = new Map(out.results[baseline][`${role}Pairs`].map(p => [p.ref, p]));
      const b = new Map(out.results[ctx.round.methodName][`${role}Pairs`].map(p => [p.ref, p]));
      const both = [...a.keys()].filter(id => b.has(id)).sort();
      const stat = map => ({ offsetMedian: round(quantile(both.map(id => map.get(id).offset), 0.5), 2), offsetP95: round(quantile(both.map(id => map.get(id).offset), 0.95), 2), iouMean: round(both.reduce((s, id) => s + map.get(id).iou, 0) / Math.max(1, both.length), 3) });
      out.paired[`${role}:${baseline}-vs-${ctx.round.methodName}`] = { references: both.length, baseline: stat(a), candidate: stat(b), ids: both };
    }
  }
  for (const [name, r] of Object.entries(out.results)) for (const role of Object.keys(roles)) {
    const s = r[role];
    console.log(`${name.padEnd(30)} ${role.padEnd(12)} TP ${String(s.tp).padStart(3)} miss ${String(s.missed).padStart(3)} extra ${String(s.extra).padStart(3)}  P ${s.precision} R ${s.recall} F1 ${s.f1}  off ${s.centreOffsetMedianMetres}/${s.centreOffsetP95Metres}  IoU ${s.crownIoUMean}`);
  }
  return out;
}

/** The gate report for the active round from its benchmark file. */
export function gateReport(ctx) {
  const file = benchmarkPathOf(ctx, ctx.round.id);
  const benchmark = JSON.parse(fs.readFileSync(file, 'utf8'));
  const benchmarkSha256 = sha(file);
  const gate = evaluateGate(benchmark, ctx.round);
  const exception = gate.status === 'PASS' ? null : ownerExceptionFor(ctx.config, gate, benchmarkSha256);
  const verdict = publicationVerdict(gate, exception);
  const stale = gate.status === 'PASS' || exception ? [] : staleExceptions(ctx.config, gate, benchmarkSha256);
  const pending = gate.status === 'PASS' || exception ? null : pendingApprovalFor(ctx.config, gate, benchmarkSha256);
  return { gate, verdict, pending, benchmark: { path: ctx.rel(file), sha256: benchmarkSha256 }, staleExceptions: stale, recallBy: benchmark.results[ctx.round.methodName]?.[ctx.round.evaluationRole]?.recallBy ?? null };
}

export async function run(ctx, options) {
  const lockPath = lockPathOf(ctx, ctx.round.id);
  const benchmarkPath = benchmarkPathOf(ctx, ctx.round.id);
  const explicit = options.tune || options.types || options.subtypes || options.score || options.gate;
  const steps = explicit
    ? ['tune', 'types', 'subtypes', 'score', 'gate'].filter(s => options[s])
    : [...(fs.existsSync(lockPath) ? [] : ['tune']), ...(ctx.config.typeRule.round === ctx.round.id && !fs.existsSync(typeRulePath(ctx)) ? ['types'] : []), ...(fs.existsSync(benchmarkPath) ? [] : ['score']), 'gate'];
  const messages = [];
  for (const step of steps) {
    if (step === 'tune') {
      assertHeldOutUnseen({ action: 'tune', existing: readJsonIf(benchmarkPath), roundId: ctx.round.id });
      const reference = loadReference(ctx);
      const lock = ctx.round.detector === 'fused' ? tuneFused(ctx, reference) : ctx.round.detector === 'refined' ? tuneRefined(ctx, reference) : ctx.round.detector === 'typed' ? tuneTyped(ctx, reference) : tuneV2(ctx, reference);
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
      writeReceipt(ctx, 'benchmark-tune', { inputs: [ctx.reviewFile(ctx.sampleFile('reference-lock')), path.join(ctx.paths.rasters, 'chm-pitfree-050.bin')], outputs: [lockPath], perRound: true, result: { detector: ctx.round.detector, calibration: lock.selected.calibration } });
      messages.push(`tuned ${ctx.round.detector} on calibration windows only: ${JSON.stringify(lock.selected.calibration)}`);
    } else if (step === 'types') {
      if (ctx.config.typeRule.round !== ctx.round.id) { messages.push(`the type rule belongs to round ${ctx.config.typeRule.round}; run it there (--round ${ctx.config.typeRule.round})`); continue; }
      const rule = classifyTypes(ctx);
      fs.writeFileSync(typeRulePath(ctx), JSON.stringify(rule, null, 1) + '\n');
      writeReceipt(ctx, 'benchmark-types', { inputs: [lockPath, ctx.reviewFile(ctx.sampleFile('reference', 'geojson'))], outputs: [typeRulePath(ctx)], perRound: true, result: { chosen: rule.chosen.rule, calibration: rule.chosen.calibration.balanced, evaluation: rule.chosen.evaluation.balanced } });
      messages.push(`type rule: ${rule.chosen.rule}; balanced accuracy ${round(rule.chosen.calibration.balanced)} calibration, ${round(rule.chosen.evaluation.balanced)} held-out`);
    } else if (step === 'subtypes') {
      if (!fs.existsSync(benchmarkPath)) throw new Error('score the round first: the pine/spruce rule is reported on held-out conifers of a round whose detector is locked');
      const reference = loadReference(ctx);
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const examples = subtypeExamples(ctx, reference, lock);
      const file = subtypeRulePath(ctx);
      const rule = writeSubtypeRule(file, examples, { round: ctx.round.id, detectorLockSha256: sha(lockPath), referenceLockSha256: reference.lockSha256 });
      writeReceipt(ctx, 'benchmark-subtypes', { inputs: [lockPath, ctx.reviewFile(ctx.sampleFile('reference', 'geojson')), ctx.reviewFile('relief-displacement.json')], outputs: [file], perRound: true, result: { chosen: rule.chosen.rule, calibration: rule.chosen.calibration, heldOut: rule.chosen.heldOut, publish: rule.publish } });
      messages.push(`pine/spruce rule: ${rule.chosen.rule}; calibration balanced ${rule.chosen.calibration.balanced} (${rule.chosen.calibration.pine} pine, ${rule.chosen.calibration.spruce} spruce); held-out accuracy ${rule.chosen.heldOut.accuracy}, balanced ${rule.chosen.heldOut.balanced} (${rule.chosen.heldOut.pine} pine, ${rule.chosen.heldOut.spruce} spruce); ${rule.publish ? 'PUBLISHED as record subtypes' : 'NOT published: every conifer keeps the runtime mix'}`);
    } else if (step === 'score') {
      const reference = loadReference(ctx);
      if (!fs.existsSync(lockPath)) throw new Error(`no detector lock for round ${ctx.round.id}: run --tune first`);
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const lockSha256 = sha(lockPath);
      if (lock.referenceLockSha256 !== reference.lockSha256) throw new Error(`the detector lock of round ${ctx.round.id} belongs to another reference`);
      const existing = readJsonIf(benchmarkPath);
      assertHeldOutUnseen({ action: 'score', existing, lockSha256, roundId: ctx.round.id });
      const out = score(ctx, reference, lock, lockSha256);
      if (existing) {
        /* the same lock on the same sample: a reproduction. Keep the recorded
           file (an owner exception may pin its bytes); differing results mean
           the code or the data changed under the lock. */
        if (JSON.stringify(existing.results) !== JSON.stringify(out.results)) {
          throw new Error(`round ${ctx.round.id} scored differently against the same detector lock: code or data changed since ${existing.scoredAt}. Investigate; a changed detector needs a new round.`);
        }
        messages.push(`re-scored round ${ctx.round.id}: results identical to the recorded benchmark of ${existing.scoredAt}; the recorded file is kept`);
        continue;
      }
      fs.writeFileSync(benchmarkPath, JSON.stringify(out, null, 1) + '\n');
      writeReceipt(ctx, 'benchmark-score', { inputs: [lockPath, ctx.reviewFile(ctx.sampleFile('reference-lock')), path.join(ctx.paths.rasters, 'chm-pitfree-050.bin')], outputs: [benchmarkPath], perRound: true, result: { [ctx.round.evaluationRole]: out.results[ctx.round.methodName][ctx.round.evaluationRole] && (({ tp, missed, extra, precision, recall, f1 }) => ({ tp, missed, extra, precision, recall, f1 }))(out.results[ctx.round.methodName][ctx.round.evaluationRole]) } });
      messages.push(`scored ${Object.keys(out.results).length} methods on ${Object.keys(out.roles).join(', ')}`);
    } else if (step === 'gate') {
      const report = gateReport(ctx);
      const m = report.gate.measured;
      const line = `HELD-OUT GATE ${report.gate.status} (round ${ctx.round.id}, ${ctx.round.methodName} on ${ctx.round.evaluationRole}): ${m ? `P ${m.precision} R ${m.recall} over ${m.scored} scored crowns (TP ${m.tp}, miss ${m.missed}, extra ${m.extra})` : 'no score'}; thresholds P >= ${HELD_OUT_GATE.precision}, R >= ${HELD_OUT_GATE.recall}, >= ${HELD_OUT_GATE.minimumScoredCrowns} crowns`;
      messages.push(line);
      if (report.recallBy) messages.push(`recall by stratum: ${Object.entries(report.recallBy).map(([k, v]) => `${k} ${v.tp}/${v.tp + v.missed}`).join(', ')}`);
      if (report.gate.status === 'FAIL') {
        messages.push(report.verdict.note);
        for (const s of report.staleExceptions) messages.push(`a recorded owner exception of ${s.decidedOn} does not apply: ${s.why}`);
        if (!report.verdict.allowed) return { status: 'gate-fail', message: messages.join('\n') };
      }
    }
  }
  return { status: 'done', message: messages.join('\n') };
}
