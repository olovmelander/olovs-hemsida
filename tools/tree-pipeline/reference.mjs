/* Stage `reference`: the frozen reference sample (from the Johannesberg
   pilot's reference-panels and freeze-reference).

   This is a HUMAN REVIEW stage. The pipeline prepares and freezes; a person
   (or an agent, labelled as such) interprets.

   1. The interpreter declares reference windows in
      reference-windows<suffix>.json: a matching rule (one-to-one within 4 m)
      and a minimum scored height, declared before anything is scored, and
      windows with roles -- calibration for tuning, and a held-out role that
      no tuning may see -- spread over strata (isolated, group, edge, closed;
      conifer, broadleaf; strata.json from `detect` helps) and over holes.
   2. --prepare draws interpretation panels per window into the ignored cache:
      numbered candidate apexes from an over-segmenting 1 m local-maximum
      filter on the lightly smoothed pit-free CHM (sigma 0.3 m, at least 2 m
      tall) -- deliberately NOT any detector under test -- on four
      co-registered panels: CHM hillshade, the presence campaign's colour
      infrared, the leaf-off campaign's natural colour and the presence
      campaign's natural colour, with a 5 m grid labelled from the window's
      south-west corner. Then the stage stops.
   3. The interpreter writes reference-annotations<suffix>.json: per window,
      crowns { from: [candidate numbers] | at: [dE, dN], type, stratum, note },
      rejected candidates and ambiguity boxes.
   4. --freeze writes every reference crown with its window, role, whether it
      is scored (inside the window, outside any ambiguity box, tall enough) or
      only matchable (the margin), type, stratum, laser height and a
      reference-seeded crown segment, and a lock with the hashes of every
      input. The benchmark refuses a reference whose lock does not match, and
      this stage refuses to re-freeze once the round has been scored.     */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { crownStatistics, detectLocalMaxima } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { growCrownsSimultaneous } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { Canvas, loadMosaic, loadRaster, renderLayer, toPixel } from './panels.mjs';
import { HELD_OUT_GATE } from './gate.mjs';
import { writeReceipt } from './receipts.mjs';

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Problems with a declared windows file for a round (empty when it may be used). */
export function windowProblems(windows, roundConfig) {
  const problems = [];
  if (!windows || !Array.isArray(windows.windows) || !windows.windows.length) return ['no windows declared'];
  const rule = windows.matchingRule || {};
  if (!(rule.radiusMetres > 0) || rule.declaredBeforeScoring !== true) problems.push('matchingRule must give radiusMetres and declaredBeforeScoring: true');
  if (!(windows.minimumScoredHeightMetres > 0)) problems.push('minimumScoredHeightMetres must be declared');
  const ids = new Set();
  for (const w of windows.windows) {
    if (ids.has(w.id)) problems.push(`window ${w.id} is declared twice`);
    ids.add(w.id);
    if (!roundConfig.roles.includes(w.role)) problems.push(`window ${w.id} has role ${w.role}, not one of ${roundConfig.roles.join(', ')}`);
    if (!Array.isArray(w.bbox) || w.bbox.length !== 4 || !(w.bbox[0] < w.bbox[2] && w.bbox[1] < w.bbox[3])) problems.push(`window ${w.id} needs bbox [minE, minN, maxE, maxN]`);
  }
  if (!windows.windows.some(w => w.role === 'calibration')) problems.push('no calibration window');
  if (!windows.windows.some(w => w.role === roundConfig.evaluationRole)) problems.push(`no ${roundConfig.evaluationRole} (held-out) window`);
  return problems;
}

export function overSegmentCandidates(chm, bbox, marginMetres = 6) {
  const g = chm.grid;
  const s = g.sampleSpacingMetres;
  const c0 = Math.max(0, Math.floor((bbox[0] - marginMetres - g.minEasting) / s));
  const c1 = Math.min(g.width, Math.ceil((bbox[2] + marginMetres - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - bbox[3] - marginMetres) / s));
  const r1 = Math.min(g.height, Math.ceil((g.maxNorthing - bbox[1] + marginMetres) / s));
  const width = c1 - c0;
  const height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + (c0 + c)];
  const sub = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
  const smooth = smoothChm(sub, values, 0.3);
  const raster = createRaster({ width, height, sampleSpacingMetres: s, originEasting: sub.minEasting, originNorthing: sub.maxNorthing, values: smooth });
  const maxima = detectLocalMaxima(raster, { parameters: { windowBaseMetres: 1, windowSlope: 0, windowMinimumMetres: 1, windowMaximumMetres: 1, minimumCandidateHeightMetres: 2 } });
  return maxima.map(m => ({
    easting: Math.round((sub.minEasting + (m.column + 0.5) * s) * 100) / 100,
    northing: Math.round((sub.maxNorthing - (m.row + 0.5) * s) * 100) / 100,
    heightMetres: Math.round(values[m.index] * 100) / 100,
  })).sort((a, b) => b.northing - a.northing || a.easting - b.easting).map((c, i) => ({ number: i + 1, ...c }));
}


export function preparePanels(ctx, { windowsPath, only = [], mpp = 0.12 }) {
  const declared = JSON.parse(fs.readFileSync(windowsPath, 'utf8'));
  const outDir = ctx.paths.referencePanels;
  fs.mkdirSync(outDir, { recursive: true });
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const presence = ctx.presence.key, leafOff = ctx.leafOff.key;
  const m25 = loadMosaic(ctx, presence);
  const m21 = loadMosaic(ctx, leafOff);
  const registration = JSON.parse(fs.readFileSync(ctx.reviewFile('registration.json'), 'utf8'));
  const shiftOf = key => registration.applied?.[key] || null;
  const written = [];
  for (const window of declared.windows.filter(w => !only.length || only.includes(w.id))) {
    const margin = 6;
    const bbox = [window.bbox[0] - margin, window.bbox[1] - margin, window.bbox[2] + margin, window.bbox[3] + margin];
    const candidates = overSegmentCandidates(chm, window.bbox, margin);
    /* never renumber what an interpreter may already have annotated: a window
       carried into a later round keeps the panels and numbering it had */
    const existingPath = path.join(outDir, `${window.id}.candidates.json`);
    if (fs.existsSync(existingPath)) {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      if (JSON.stringify(existing.candidates) !== JSON.stringify(candidates)) {
        throw new Error(`panels for ${window.id} exist with other numbered candidates (${ctx.rel(existingPath)}); annotations may reference them. Declare a new window id instead of re-preparing this one.`);
      }
      console.log(`${window.id}: ${candidates.length} candidates, panels kept (identical numbering)`);
      written.push(path.join(outDir, `${window.id}.png`), existingPath);
      continue;
    }
    const panels = [
      ['CHM', renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp })],
      [`CIR ${presence}`, renderLayer({ kind: 'cir', mosaic: m25, bbox, metresPerPixel: mpp, shift: shiftOf(presence) })],
      [`RGB ${leafOff}`, renderLayer({ kind: 'rgb', mosaic: m21, bbox, metresPerPixel: mpp, shift: shiftOf(leafOff) })],
      [`RGB ${presence}`, renderLayer({ kind: 'rgb', mosaic: m25, bbox, metresPerPixel: mpp, shift: shiftOf(presence) })],
    ];
    for (const [, canvas] of panels) {
      /* the scoring rectangle */
      const [ax, ay] = toPixel(bbox, mpp, window.bbox[0], window.bbox[3]);
      const [bx, by] = toPixel(bbox, mpp, window.bbox[2], window.bbox[1]);
      for (const [x0, y0, x1, y1] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]]) canvas.line(x0, y0, x1, y1, [255, 60, 255]);
      drawGridRelative(canvas, bbox, window.bbox, mpp, 5);
      for (const c of candidates) {
        const [x, y] = toPixel(bbox, mpp, c.easting, c.northing);
        canvas.cross(x, y, 3, [0, 255, 255]);
        canvas.text(x + 3, y - 12, String(c.number), [0, 255, 255], 2);
      }
    }
    const w = panels[0][1].width;
    const h = panels[0][1].height;
    const sheet = new Canvas(2 * w + 6, 2 * h + 6, [40, 40, 40]);
    panels.forEach(([label, canvas], i) => { canvas.text(4, canvas.height - 14, label, [255, 255, 255], 2); sheet.blit(canvas, (i % 2) * (w + 6), Math.floor(i / 2) * (h + 6)); });
    fs.writeFileSync(path.join(outDir, `${window.id}.png`), sheet.png());
    fs.writeFileSync(path.join(outDir, `${window.id}.candidates.json`), JSON.stringify({ window, candidates }, null, 1));
    console.log(`${window.id}: ${candidates.length} candidates -> ${ctx.rel(path.join(outDir, `${window.id}.png`))} (${sheet.width} x ${sheet.height})`);
    written.push(path.join(outDir, `${window.id}.png`), path.join(outDir, `${window.id}.candidates.json`));
  }
  return written;
}


/** Grid lines every `step` m labelled in metres east/north of the window's SW corner. */
function drawGridRelative(canvas, bbox, windowBbox, mpp, step) {
  const [we, wn] = [windowBbox[0], windowBbox[1]];
  for (let e = we + Math.ceil((bbox[0] - we) / step) * step; e <= bbox[2]; e += step) {
    const [x] = toPixel(bbox, mpp, e, bbox[3]);
    canvas.line(x, 0, x, canvas.height - 1, [255, 255, 255], 0.25);
    canvas.text(x + 2, 2, String(Math.round(e - we)), [255, 255, 0], 1);
  }
  for (let n = wn + Math.ceil((bbox[1] - wn) / step) * step; n <= bbox[3]; n += step) {
    const [, y] = toPixel(bbox, mpp, bbox[0], n);
    canvas.line(0, y, canvas.width - 1, y, [255, 255, 255], 0.25);
    canvas.text(2, y + 2, String(Math.round(n - wn)), [255, 255, 0], 1);
  }
}


/** Reference-seeded crown segments: simultaneous Dalponte growth from the reference crowns only,
    then extended down to a fifth of each apex, so every reference keeps its own visible crown. */
export function referenceSegments(chm, crowns, margin = 14) {
  const g = chm.grid;
  const s = g.sampleSpacingMetres;
  const e0 = Math.min(...crowns.map(c => c.easting)) - margin, e1 = Math.max(...crowns.map(c => c.easting)) + margin;
  const n0 = Math.min(...crowns.map(c => c.northing)) - margin, n1 = Math.max(...crowns.map(c => c.northing)) + margin;
  const c0 = Math.max(0, Math.floor((e0 - g.minEasting) / s)), c1 = Math.min(g.width, Math.ceil((e1 - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - n1) / s)), r1 = Math.min(g.height, Math.ceil((g.maxNorthing - n0) / s));
  const width = c1 - c0, height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + c0 + c];
  const sub = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
  const smooth = smoothChm(sub, values, 0.3);
  const raster = v => createRaster({ width, height, sampleSpacingMetres: s, originEasting: sub.minEasting, originNorthing: sub.maxNorthing, values: v });
  const detection = raster(smooth);
  const seeds = crowns.map(c => {
    const column = Math.min(width - 1, Math.max(0, Math.floor((c.easting - sub.minEasting) / s)));
    const row = Math.min(height - 1, Math.max(0, Math.floor((sub.maxNorthing - c.northing) / s)));
    return { column, row, index: row * width + column, height: Math.max(smooth[row * width + column] || 0, c.heightMetres) };
  });
  const order = seeds.map((seed, i) => i).sort((a, b) => seeds[b].height - seeds[a].height);
  const ordered = order.map(i => seeds[i]);
  const grid = { minEasting: sub.minEasting, maxNorthing: sub.maxNorthing, width, height, sampleSpacingMetres: s };
  const labels = growCrownsSimultaneous(grid, smooth, ordered, { seedFraction: 0.35, crownFraction: 0.5, maximumCrownRadiusMetres: 9, minimumHeightMetres: 2 });
  growCrownsSimultaneous(grid, smooth, ordered, { seedFraction: 0.2, crownFraction: 0, maximumCrownRadiusMetres: 9, minimumHeightMetres: 2, initialLabels: labels });
  const stats = crownStatistics(raster(values), labels, ordered);
  const out = new Array(crowns.length);
  order.forEach((original, k) => { out[original] = stats[k]; });
  return out;
}


export function freezeReference(ctx, { note = null, interpreter = null } = {}) {
  const windowsPath = ctx.reviewFile(ctx.sampleFile('reference-windows'));
  const annotationsPath = ctx.reviewFile(ctx.sampleFile('reference-annotations'));
  const windows = JSON.parse(fs.readFileSync(windowsPath, 'utf8'));
  const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const features = [];
  const candidateHashes = {};
  const counts = {};
  for (const window of windows.windows) {
    const entry = annotations.windows.find(w => w.window === window.id);
    if (!entry) throw new Error(`no annotations for ${window.id}`);
    const candidatesPath = path.join(ctx.paths.referencePanels, `${window.id}.candidates.json`);
    const { candidates } = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    candidateHashes[window.id] = sha(candidatesPath);
    const byNumber = new Map(candidates.map(c => [c.number, c]));
    const [we, wn, ee, en] = window.bbox;
    const crowns = entry.crowns.map((crown, i) => {
      let easting, northing, height;
      /* an explicit crown centre wins over the tallest candidate's position;
         the candidates still give the height */
      if (crown.from) {
        const picked = crown.from.map(n => { const c = byNumber.get(n); if (!c) throw new Error(`${window.id}: candidate ${n} does not exist`); return c; });
        const top = picked.reduce((a, b) => (b.heightMetres > a.heightMetres ? b : a));
        easting = top.easting; northing = top.northing; height = top.heightMetres;
        if (crown.at) { easting = we + crown.at[0]; northing = wn + crown.at[1]; }
      } else if (crown.at) {
        easting = we + crown.at[0]; northing = wn + crown.at[1];
        const s = chm.grid.sampleSpacingMetres;
        let best = 0;
        for (let dy = -1; dy <= 1; dy += s) for (let dx = -1; dx <= 1; dx += s) {
          const c = Math.floor((easting + dx - chm.grid.minEasting) / s), r = Math.floor((chm.grid.maxNorthing - northing - dy) / s);
          const v = chm.values[r * chm.grid.width + c];
          if (v > best) best = v;
        }
        height = best;
      } else throw new Error(`${window.id}: crown ${i} has neither from nor at`);
      const inside = easting >= we && easting < ee && northing >= wn && northing < en;
      const ambiguous = (entry.ambiguous || []).some(a => easting >= we + a.box[0] && easting < we + a.box[2] && northing >= wn + a.box[1] && northing < wn + a.box[3]);
      return { id: `${window.id}-${String(i + 1).padStart(2, '0')}`, window: window.id, role: window.role, easting: round(easting), northing: round(northing), heightMetres: round(height), type: crown.type, stratum: crown.stratum, source: crown.from ? { candidates: crown.from } : { placedRelative: crown.at }, scored: inside && !ambiguous && height >= windows.minimumScoredHeightMetres, zone: inside ? (ambiguous ? 'ambiguous' : 'window') : 'margin', note: crown.note || null };
    });
    const segments = crowns.length ? referenceSegments(chm, crowns) : [];
    crowns.forEach((crown, i) => {
      const seg = segments[i];
      crown.segment = seg ? { areaSquareMetres: seg.areaSquareMetres, equivalentRadiusMetres: seg.equivalentRadiusMetres, centroid: seg.centroid } : null;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [crown.easting, crown.northing] }, properties: crown });
      const key = `${window.role}`;
      counts[key] = counts[key] || { scored: 0, window: 0, margin: 0, ambiguous: 0, smallUnder3m: 0 };
      counts[key][crown.zone]++;
      if (crown.scored) counts[key].scored++;
      if (crown.zone === 'window' && crown.heightMetres < windows.minimumScoredHeightMetres) counts[key].smallUnder3m++;
    });
    for (const [n, reason] of Object.entries(entry.rejected || {})) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [byNumber.get(Number(n))?.easting, byNumber.get(Number(n))?.northing] }, properties: { window: window.id, rejectedCandidate: Number(n), reason } });
    for (const a of entry.ambiguous || []) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[we + a.box[0], wn + a.box[1]], [we + a.box[2], wn + a.box[1]], [we + a.box[2], wn + a.box[3]], [we + a.box[0], wn + a.box[3]], [we + a.box[0], wn + a.box[1]]]] }, properties: { window: window.id, ambiguity: a.reason } });
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[we, wn], [ee, wn], [ee, en], [we, en], [we, wn]]] }, properties: { scoringWindow: window.id, role: window.role, holes: window.holes } });
  }
  const geojson = { type: 'FeatureCollection', name: `${ctx.groundId}-reference-${ctx.reviewDate}`, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } }, features };
  const referencePath = ctx.reviewFile(ctx.sampleFile('reference', 'geojson'));
  fs.writeFileSync(referencePath, JSON.stringify(geojson, null, 1) + '\n');
  const lockPath = ctx.reviewFile(ctx.sampleFile('reference-lock'));
  const previous = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  const lock = {
    schemaVersion: 1,
    kind: 'reference-lock',
    frozenAt: new Date().toISOString(),
    history: [...(previous?.history || []), ...(previous ? [{ frozenAt: previous.frozenAt, reference: previous.hashes.reference, annotations: previous.hashes.annotations }] : [])],
    refreezeNote: note,
    interpreter: interpreter || 'agent-led interpretation (Claude), not a survey or human approval',
    evidence: `pit-free CHM ${ctx.config.window.chmCellMetres} m (${ctx.config.laser.capturedOn} laser), ${ctx.presence.date} RGBI (CIR and natural colour), ${ctx.leafOff.date} RGBI (leaf-off natural colour); numbered over-segmentation candidates only save typing positions`,
    matchingRule: windows.matchingRule,
    minimumScoredHeightMetres: windows.minimumScoredHeightMetres,
    counts,
    hashes: { windows: sha(windowsPath), annotations: sha(annotationsPath), reference: sha(referencePath), chm: chm.sidecar.sha256, candidates: candidateHashes },
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(JSON.stringify(counts, null, 1));
  return { counts, files: [referencePath, lockPath], inputs: [windowsPath, annotationsPath, ...windows.windows.map(w => path.join(ctx.paths.referencePanels, `${w.id}.candidates.json`))] };
}


export async function run(ctx, options) {
  const windowsPath = options.windows ? path.resolve(ctx.root, options.windows) : ctx.reviewFile(ctx.sampleFile('reference-windows'));
  const annotationsPath = ctx.reviewFile(ctx.sampleFile('reference-annotations'));
  const lockPath = ctx.reviewFile(ctx.sampleFile('reference-lock'));
  const benchmarkPath = ctx.reviewFile(ctx.sampleFile('benchmark'));
  if (!fs.existsSync(windowsPath)) {
    return { status: 'stop', message: `declare the round's reference windows first: ${ctx.rel(windowsPath)} (matchingRule, minimumScoredHeightMetres, windows with id, role (${ctx.round.roles.join(', ')}), bbox, holes, note). Use strata.json from the detect stage to cover isolated, group, edge and closed canopy, conifer and broadleaf, near play and woodland; at least ${HELD_OUT_GATE.minimumScoredCrowns} held-out crowns in spatially separate windows the tuning never sees.` };
  }
  const windows = JSON.parse(fs.readFileSync(windowsPath, 'utf8'));
  const problems = windowProblems(windows, ctx.round);
  if (problems.length) return { status: 'stop', message: `${ctx.rel(windowsPath)}: ${problems.join('; ')}` };
  const action = options.prepare ? 'prepare' : options.freeze ? 'freeze' : !fs.existsSync(annotationsPath) ? 'prepare' : !fs.existsSync(lockPath) ? 'freeze' : 'check';
  if (action === 'prepare') {
    const written = preparePanels(ctx, { windowsPath, only: (options.only || '').split(',').filter(Boolean), mpp: Number(options.mpp || 0.12) });
    writeReceipt(ctx, 'reference-panels', { inputs: [windowsPath, path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), ctx.reviewFile('registration.json')], outputs: written, perRound: true, result: { windows: windows.windows.length } });
    return { status: 'stop', message: `interpretation panels for ${windows.windows.length} windows are in ${ctx.rel(ctx.paths.referencePanels)} (photo pixels: cache only).
HUMAN REVIEW: interpret every window on its four panels and write ${ctx.rel(annotationsPath)}:
  { "windows": [ { "window": "<id>", "crowns": [ { "from": [<candidate numbers>] | "at": [<dE>, <dN> from the window's SW corner], "type": "conifer|broadleaf|unknown", "stratum": "isolated|group|edge|closed", "note": "..." } ], "rejected": { "<n>": "reason" }, "ambiguous": [ { "box": [x0, y0, x1, y1], "reason": "..." } ] } ] }
Label who interpreted (agent-led interpretation is not a survey). Then run --stage reference --freeze.` };
  }
  if (action === 'freeze') {
    if (fs.existsSync(benchmarkPath)) {
      return { status: 'stop', message: `round ${ctx.round.id} has been scored (${ctx.rel(benchmarkPath)}): its reference cannot be re-frozen. Declare a new round with a new sample.` };
    }
    const result = freezeReference(ctx, { note: options.note || null, interpreter: options.interpreter || null });
    writeReceipt(ctx, 'reference', { inputs: result.inputs, outputs: result.files, perRound: true, result: { counts: result.counts } });
    const held = result.counts[ctx.round.evaluationRole]?.scored ?? 0;
    const calibration = result.counts.calibration?.scored ?? 0;
    const warn = held < HELD_OUT_GATE.minimumScoredCrowns ? `\nWARNING: only ${held} scored ${ctx.round.evaluationRole} crowns; the gate needs at least ${HELD_OUT_GATE.minimumScoredCrowns}.` : '';
    return { status: 'done', message: `reference frozen: ${calibration} scored calibration crowns, ${held} scored ${ctx.round.evaluationRole} crowns${warn}` };
  }
  /* check: the lock still matches its inputs */
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const changed = [['windows', windowsPath], ['annotations', annotationsPath], ['reference', ctx.reviewFile(ctx.sampleFile('reference', 'geojson'))]].filter(([name, file]) => !fs.existsSync(file) || sha(file) !== lock.hashes[name]).map(([name]) => name);
  if (changed.length) return { status: 'stop', message: `the frozen reference changed after it was frozen (${changed.join(', ')}): restore it, or re-freeze before any scoring` };
  return { status: 'done', message: `reference ${ctx.round.id} frozen at ${lock.frozenAt}: ${JSON.stringify(lock.counts)}` };
}
