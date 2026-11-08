/* Round 4: the laser crowns fused with a learned photo crown detector.

   The photo detector (photo/crowns.py, DeepForest on the June 2025 photo)
   gives boxes where the ORTHOPHOTO draws each crown. A standard orthophoto
   draws a crown top of height h at k x h from its trunk (relief.mjs), so
   every photo crown is first moved back onto the laser: the trunk x solves
   x + f k(x) h(x) = p, where p is the box centre, h the tallest CHM within
   1.5 m of x and f the share of the height at which the box centre sits
   (projectionFraction), by fixed-point iteration.

   The laser still decides whether there is canopy and how tall each tree is.
   The fusion only adds SEEDS to the refined detector's regrowth:
   - a photo crown is snapped to the highest smoothed-CHM cell within
     snapRadiusMetres of its trunk; it becomes a seed only where that cell is
     at least minimumHeightMetres tall and within maximumHeightGapMetres of
     the height the trunk was solved with (the laser shows canopy of
     consistent height there);
   - and only where it stands minimumSeparationMetres from every laser seed
     and earlier photo seed, and minimumDipMetres above the lowest point
     toward the nearest taller seed within 6 m (its own crown in the laser);
   so it splits a laser crown that holds two photo crowns, takes back a
   suppressed laser top the photo confirms (the snap finds that top), and
   adds a tree only on canopy. A photo crown over no laser canopy is never
   placed. Every crown is then regrown from the full set of seeds at once
   (detectTreesTypedWithSeeds), so positions, radii and heights stay the
   laser's.                                                                */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { TYPE_BROADLEAF, TYPE_CONIFER } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { fieldAt } from './relief.mjs';
import { detectTreesTypedWithSeeds, keptTops, recoverTops } from './tree-refine.mjs';

export const FUSE_DEFAULTS = Object.freeze({
  projectionFraction: 0.8,
  minimumScore: 0.3,
  snapRadiusMetres: 1,
  minimumHeightMetres: 3,
  maximumHeightGapMetres: 4,
  minimumSeparationMetres: 2,
  minimumDipMetres: 0.5,
  types: Object.freeze(['conifer', 'broadleaf']),
});

/* the fusion's coordinate descent (calibration only) */
export const FUSE_SEARCH = Object.freeze([
  ['minimumScore', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]],
  ['projectionFraction', [0.5, 0.6, 0.7, 0.8, 0.9, 1]],
  ['minimumSeparationMetres', [1.5, 2, 2.5, 3, 3.5]],
  ['minimumDipMetres', [0, 0.25, 0.5, 0.75, 1, 1.5]],
  ['snapRadiusMetres', [0.5, 1, 1.5, 2]],
  ['maximumHeightGapMetres', [2, 3, 4, 6, 100]],
  ['types', [['conifer'], ['broadleaf'], ['conifer', 'broadleaf']]],
]);

/** A photo-crowns file of crowns.py: every region's boxes, flattened, with the file's sha256. */
export function loadPhotoCrowns(file) {
  const bytes = fs.readFileSync(file);
  const doc = JSON.parse(bytes.toString('utf8'));
  const crowns = [];
  for (const region of doc.regions) for (const [minE, minN, maxE, maxN, score] of region.crowns) crowns.push({ minE, minN, maxE, maxN, score, region: region.id });
  return { crowns, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), meta: { model: doc.model, revision: doc.revision, weights: doc.weights, weightsSha256: doc.weightsSha256, raster: doc.raster, patchMetres: doc.patchMetres, overlap: doc.overlap, scoreThreshold: doc.scoreThreshold, nms: doc.nms } };
}

function tallestNear(chm, easting, northing, radius) {
  const g = chm.grid, s = g.sampleSpacingMetres;
  const c0 = Math.floor((easting - radius - g.minEasting) / s), c1 = Math.floor((easting + radius - g.minEasting) / s);
  const r0 = Math.floor((g.maxNorthing - northing - radius) / s), r1 = Math.floor((g.maxNorthing - northing + radius) / s);
  let best = 0;
  for (let r = Math.max(0, r0); r <= Math.min(g.height - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(g.width - 1, c1); c++) {
    const v = chm.values[r * g.width + c];
    if (v > best) best = v;
  }
  return best;
}

/**
 * Trunk positions of photo crowns: x + f k(x) h(x) = p by fixed-point
 * iteration on the full CHM raster (`chm` from loadRaster) and the photo's
 * relief field. Crowns below `minimumScore` are skipped.
 */
export function photoTrunks(crowns, chm, field, { projectionFraction = FUSE_DEFAULTS.projectionFraction, minimumScore = 0, searchRadiusMetres = 1.5, iterations = 6 } = {}) {
  const out = [];
  for (const c of crowns) {
    if (c.score < minimumScore) continue;
    const pe = (c.minE + c.maxE) / 2, pn = (c.minN + c.maxN) / 2;
    let e = pe, n = pn, h = 0, k = null;
    for (let i = 0; i < iterations; i++) {
      k = fieldAt(field, e, n) || k || { kx: 0, ky: 0 };
      h = tallestNear(chm, e, n, searchRadiusMetres);
      const ne = pe - projectionFraction * k.kx * h, nn = pn - projectionFraction * k.ky * h;
      if (Math.hypot(ne - e, nn - n) < 0.05) { e = ne; n = nn; break; }
      e = ne; n = nn;
    }
    h = tallestNear(chm, e, n, searchRadiusMetres);
    out.push({ easting: e, northing: n, height: h, score: c.score, halfSize: ((c.maxE - c.minE) + (c.maxN - c.minN)) / 4 });
  }
  return out;
}

/**
 * Photo seeds for one cropped grid: the trunks that pass the fusion's laser
 * tests, as extra maxima for detectTreesTypedWithSeeds. `existing` are the
 * laser seeds (kept and recovered tops, with easting, northing, height),
 * `smooth` the CHM smoothed for candidates, `typeMap` the leaf-off type map.
 */
export function fusePhotoSeeds(grid, smooth, typeMap, existing, trunks, parameters = FUSE_DEFAULTS) {
  const p = { ...FUSE_DEFAULTS, ...parameters };
  const s = grid.sampleSpacingMetres;
  const cell = 6;
  const buckets = new Map();
  const put = t => { const key = `${Math.floor(t.easting / cell)},${Math.floor(t.northing / cell)}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(t); };
  const around = (e, n) => { const bx = Math.floor(e / cell), by = Math.floor(n / cell), out = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const t of buckets.get(`${bx + dx},${by + dy}`) || []) out.push(t); return out; };
  for (const t of existing) put(t);
  const sample = (e, n) => { const c = Math.floor((e - grid.minEasting) / s), r = Math.floor((grid.maxNorthing - n) / s); return c < 0 || r < 0 || c >= grid.width || r >= grid.height ? Number.NaN : smooth[r * grid.width + c]; };
  const typeOk = index => { const t = typeMap[index]; return (t === TYPE_CONIFER && p.types.includes('conifer')) || (t === TYPE_BROADLEAF && p.types.includes('broadleaf')); };
  const seeds = [];
  const sorted = trunks.filter(t => t.score >= p.minimumScore).sort((a, b) => b.score - a.score);
  const reach = Math.ceil(p.snapRadiusMetres / s);
  for (const t of sorted) {
    const c0 = Math.floor((t.easting - grid.minEasting) / s), r0 = Math.floor((grid.maxNorthing - t.northing) / s);
    if (c0 < 0 || r0 < 0 || c0 >= grid.width || r0 >= grid.height) continue;
    let best = -Infinity, bc = -1, br = -1;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      if (Math.hypot(dr, dc) * s > p.snapRadiusMetres) continue;
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
      const v = smooth[r * grid.width + c];
      if (v > best) { best = v; bc = c; br = r; }
    }
    if (bc < 0 || !(best >= p.minimumHeightMetres)) continue;
    if (Math.abs(best - t.height) > p.maximumHeightGapMetres) continue;
    const index = br * grid.width + bc;
    if (!typeOk(index)) continue;
    const e = grid.minEasting + (bc + 0.5) * s, n = grid.maxNorthing - (br + 0.5) * s;
    const near = around(e, n);
    if (near.some(o => Math.hypot(o.easting - e, o.northing - n) < p.minimumSeparationMetres)) continue;
    /* its own crown in the laser: the dip toward the nearest taller seed within 6 m */
    let nearest = null, nd = Infinity;
    for (const o of near) { if (o.height < best) continue; const d = Math.hypot(o.easting - e, o.northing - n); if (d <= 6 && d < nd) { nd = d; nearest = o; } }
    if (nearest && p.minimumDipMetres > 0) {
      let low = Infinity;
      for (let f = 0; f <= 1.0001; f += 0.04) { const v = sample(e + f * (nearest.easting - e), n + f * (nearest.northing - n)); if (v < low) low = v; }
      if (best - low < p.minimumDipMetres) continue;
    }
    const seed = { index, column: bc, row: br, easting: e, northing: n, height: best, photo: true, score: t.score };
    seeds.push(seed);
    put(seed);
  }
  return seeds;
}

/** The fused detector on one prepared window (benchmark prepareRefined with `first` and `smoothCandidates`). */
export function fusedFromPrepared(entry, typedParameters, prepared, refine, trunks, fuse) {
  const { grid, values } = entry.cropped;
  const recovered = recoverTops(prepared.suppressed, { apexReturns: t => t.apexCount, photoValley: (role, t, o, f) => t.valleys?.[role]?.[f] ?? null }, refine);
  const existing = [...keptTops(grid, prepared.first), ...recovered.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }))];
  const photoSeeds = fusePhotoSeeds(grid, prepared.smoothCandidates, prepared.typeMap, existing, trunks, fuse);
  const { crowns } = detectTreesTypedWithSeeds(grid, values, prepared.typeMap, typedParameters, { surfaces: prepared.surfaces, extraMaxima: [...recovered, ...photoSeeds] });
  return crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, radius: c.equivalentRadiusMetres, height: c.heightMetres, type: c.type, recovered: Boolean(c.recovered) }));
}

/** Trunks inside a cropped grid (plus nothing outside it). */
export function trunksIn(trunks, grid) {
  const maxE = grid.minEasting + grid.width * grid.sampleSpacingMetres, minN = grid.maxNorthing - grid.height * grid.sampleSpacingMetres;
  return trunks.filter(t => t.easting >= grid.minEasting && t.easting < maxE && t.northing >= minN && t.northing < grid.maxNorthing);
}

/* the joint grid the fusion is chosen from (calibration only); a greedy
   descent from FUSE_DEFAULTS falls into "no photo seeds" (a high score
   threshold) before the laser tests can tighten, so the grid is joint */
export const FUSE_GRID = Object.freeze({
  minimumScore: [0.1, 0.15, 0.2, 0.3, 0.4],
  projectionFraction: [0.6, 0.8, 1],
  minimumSeparationMetres: [1.5, 2, 2.5, 3, 3.5],
  minimumDipMetres: [0, 0.5, 1, 1.5, 2],
  maximumHeightGapMetres: [3, 100],
  types: [['conifer'], ['broadleaf'], ['conifer', 'broadleaf']],
});

/** Every combination of a grid, over FUSE_DEFAULTS. */
export function gridCandidates(grid) {
  let out = [{ ...FUSE_DEFAULTS }];
  for (const [key, values] of Object.entries(grid)) out = out.flatMap(o => values.map(v => ({ ...o, [key]: v })));
  return out;
}

/* ---------- the confirm fusion: photo crowns confirm laser tops, matched in PHOTO space ----------
   Every over-segmented laser top (kept, recovered or suppressed) is moved
   forward to where the photo draws it (its own height x f x k), which needs
   no iteration; photo boxes and tops are then paired one-to-one, closest
   first, within matchRadiusMetres. A box claimed by a kept top confirms
   nothing new. A SUPPRESSED top whose box scores at least minimumScore is
   taken back when it stands minimumSeparationMetres from every seed and
   minimumDipMetres above the lowest point toward the nearest taller seed
   within 6 m. The photo never places a seed of its own: every seed is a
   laser maximum, so a photo crown over no laser canopy is never placed.   */
export const CONFIRM_DEFAULTS = Object.freeze({
  mode: 'confirm',
  projectionFraction: 0.8,
  matchRadiusMetres: 2,
  minimumScore: 0.2,
  minimumSeparationMetres: 2,
  minimumDipMetres: 0.5,
  minimumApexReturns: 0,
  types: Object.freeze(['conifer', 'broadleaf']),
});

export const CONFIRM_GRID = Object.freeze({
  projectionFraction: [0.6, 0.8, 1],
  minimumScore: [0.1, 0.2, 0.3, 0.4],
  matchRadiusMetres: [1.5, 2, 2.5, 3],
  minimumSeparationMetres: [1.5, 2, 2.5, 3],
  minimumDipMetres: [0, 0.5, 1],
  types: [['conifer'], ['broadleaf'], ['conifer', 'broadleaf']],
});

/** Photo boxes as centres in photo space with score (no relief removed). */
export function photoCentres(crowns) {
  return crowns.map(c => ({ easting: (c.minE + c.maxE) / 2, northing: (c.minN + c.maxN) / 2, score: c.score }));
}

/** The suppressed tops a photo crown confirms (see above). `kept` and `suppressed` carry easting, northing, height. */
export function confirmTops(kept, suppressed, centres, field, smooth, grid, parameters = CONFIRM_DEFAULTS, { apexReturns = t => t.apexCount } = {}) {
  const p = { ...CONFIRM_DEFAULTS, ...parameters };
  const forward = t => { const k = fieldAt(field, t.easting, t.northing) || { kx: 0, ky: 0 }; return [t.easting + p.projectionFraction * k.kx * t.height, t.northing + p.projectionFraction * k.ky * t.height]; };
  const tops = [...kept.map(t => ({ t, kept: true })), ...suppressed.filter(t => p.types.includes(t.type)).map(t => ({ t, kept: false }))];
  const boxes = centres.filter(c => c.score >= Math.min(0.05, p.minimumScore));
  const cell = 4;
  const buckets = new Map();
  boxes.forEach((b, i) => { const key = `${Math.floor(b.easting / cell)},${Math.floor(b.northing / cell)}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(i); });
  const pairs = [];
  tops.forEach((o, ti) => {
    const [pe, pn] = forward(o.t);
    const bx = Math.floor(pe / cell), by = Math.floor(pn / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const bi of buckets.get(`${bx + dx},${by + dy}`) || []) {
      const d = Math.hypot(boxes[bi].easting - pe, boxes[bi].northing - pn);
      if (d <= p.matchRadiusMetres) pairs.push({ ti, bi, d });
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedT = new Set(), usedB = new Set(), claimed = [];
  for (const pr of pairs) {
    if (usedT.has(pr.ti) || usedB.has(pr.bi)) continue;
    usedT.add(pr.ti); usedB.add(pr.bi);
    if (!tops[pr.ti].kept) claimed.push({ top: tops[pr.ti].t, score: boxes[pr.bi].score });
  }
  /* the laser tests, strongest box first */
  const s = grid.sampleSpacingMetres;
  const sample = (e, n) => { const c = Math.floor((e - grid.minEasting) / s), r = Math.floor((grid.maxNorthing - n) / s); return c < 0 || r < 0 || c >= grid.width || r >= grid.height ? Number.NaN : smooth[r * grid.width + c]; };
  const seeds = kept.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }));
  const accepted = [];
  for (const { top, score } of claimed.filter(c => c.score >= p.minimumScore).sort((a, b) => b.score - a.score)) {
    let nearest = null, nd = Infinity, tooClose = false;
    for (const o of seeds) {
      const d = Math.hypot(o.easting - top.easting, o.northing - top.northing);
      if (d < p.minimumSeparationMetres) { tooClose = true; break; }
      if (o.height >= top.height && d <= 6 && d < nd) { nd = d; nearest = o; }
    }
    if (tooClose) continue;
    /* its own apex in the points (round 4b): first returns near its height */
    if (p.minimumApexReturns > 0 && !(apexReturns(top) >= p.minimumApexReturns)) continue;
    if (nearest && p.minimumDipMetres > 0) {
      let low = Infinity;
      for (let f = 0; f <= 1.0001; f += 0.04) { const v = sample(top.easting + f * (nearest.easting - top.easting), top.northing + f * (nearest.northing - top.northing)); if (v < low) low = v; }
      if (top.height - low < p.minimumDipMetres) continue;
    }
    accepted.push({ ...top, photoScore: score });
    seeds.push({ easting: top.easting, northing: top.northing, height: top.height });
  }
  return accepted;
}

/** The confirm fused detector on one prepared window. `centres` are photo-space box centres. */
export function confirmedFromPrepared(entry, typedParameters, prepared, refine, centres, field, fuse) {
  const { grid, values } = entry.cropped;
  const recovered = recoverTops(prepared.suppressed, { apexReturns: t => t.apexCount, photoValley: (role, t, o, f) => t.valleys?.[role]?.[f] ?? null }, refine);
  const recoveredSet = new Set(recovered.map(t => t.index));
  const kept = [...keptTops(grid, prepared.first), ...recovered.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }))];
  const confirmed = confirmTops(kept, prepared.suppressed.filter(t => !recoveredSet.has(t.index)), centres, field, prepared.smoothCandidates, grid, fuse);
  const { crowns } = detectTreesTypedWithSeeds(grid, values, prepared.typeMap, typedParameters, { surfaces: prepared.surfaces, extraMaxima: [...recovered, ...confirmed] });
  return crowns.map(c => ({ easting: c.position.easting, northing: c.position.northing, radius: c.equivalentRadiusMetres, height: c.heightMetres, type: c.type, recovered: Boolean(c.recovered) }));
}

/** Photo centres that may claim a top in a cropped grid (the grid grown by the largest displacement). */
export function centresNear(centres, grid, reach = 20) {
  const maxE = grid.minEasting + grid.width * grid.sampleSpacingMetres, minN = grid.maxNorthing - grid.height * grid.sampleSpacingMetres;
  return centres.filter(c => c.easting >= grid.minEasting - reach && c.easting < maxE + reach && c.northing >= minN - reach && c.northing < grid.maxNorthing + reach);
}

/* ---------- the fused round's tuning grid and the whole-window detector ---------- */

/* the joint grid the benchmark's fused tuning searches per photo source
   (calibration only), then a coordinate polish over CONFIRM_SEARCH */
export const CONFIRM_TUNE_GRID = Object.freeze({
  projectionFraction: [0.4, 0.5, 0.6, 0.8],
  minimumScore: [0.2, 0.3, 0.4],
  matchRadiusMetres: [2, 2.5, 3],
  minimumSeparationMetres: [1.5, 2, 2.5, 3],
  minimumDipMetres: [0, 0.5],
  types: [['conifer'], ['conifer', 'broadleaf']],
});
/* round 4b (precision): the apex test joins the grid; the match radius and dip keep their round-4 range */
export const CONFIRM_TUNE_GRID_PRECISION = Object.freeze({
  projectionFraction: [0.5, 0.6, 0.8],
  minimumScore: [0.2, 0.3, 0.4, 0.5],
  matchRadiusMetres: [2.5, 3],
  minimumSeparationMetres: [1.5, 2, 2.5, 3],
  minimumDipMetres: [0, 0.5],
  minimumApexReturns: [0, 2, 3, 4],
  types: [['conifer'], ['conifer', 'broadleaf']],
});
export const CONFIRM_SEARCH = Object.freeze([
  ['projectionFraction', [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]],
  ['minimumScore', [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5]],
  ['matchRadiusMetres', [1.5, 2, 2.5, 3, 3.5]],
  ['minimumSeparationMetres', [1.5, 2, 2.5, 3, 3.5]],
  ['minimumDipMetres', [0, 0.25, 0.5, 0.75, 1]],
  ['minimumApexReturns', [0, 1, 2, 3, 4, 5]],
  ['types', [['conifer'], ['broadleaf'], ['conifer', 'broadleaf']]],
]);

/** Every combination of a grid over a base. */
export function combinations(grid, base) {
  return Object.entries(grid).reduce((acc, [k, vs]) => acc.flatMap(o => vs.map(v => ({ ...o, [k]: v }))), [{ ...base }]);
}

/**
 * The fused detector over a whole grid (the candidates stage): the refined
 * detector's first pass, referee and recovery (tree-refine.mjs), then the
 * suppressed tops a photo crown confirms, then every crown regrown from the
 * full set of seeds.
 */
export function detectTreesFused(grid, chm, typeMap, typedParameters, refineParameters, referee, centres, field, fuse, { surfaces = null, smoothChmFn, overSegmentedTops, suppressedTops, REFINE_DEFAULTS }) {
  const first = detectTreesTypedWithSeeds(grid, chm, typeMap, typedParameters, { surfaces });
  const p = { ...REFINE_DEFAULTS, ...refineParameters };
  const smooth = smoothChmFn(grid, chm, p.candidateSigmaMetres);
  const tops = overSegmentedTops(grid, chm, { sigmaMetres: p.candidateSigmaMetres, windowMetres: p.candidateWindowMetres, minimumHeightMetres: p.minimumHeightMetres, smoothed: smooth });
  const kept = keptTops(grid, first);
  /* in 80 m tiles, as detectTreesRefined does, so the referee's photo reads stay local; decisions do not depend on the order */
  const tileOf = t => [Math.floor(t.row * grid.sampleSpacingMetres / 80), Math.floor(t.column * grid.sampleSpacingMetres / 80)];
  const suppressed = suppressedTops(grid, smooth, tops, kept, typeMap, p).sort((a, b) => { const [ar, ac] = tileOf(a), [br, bc] = tileOf(b); return ar - br || ac - bc || a.index - b.index; });
  const recovered = recoverTops(suppressed, referee, p);
  const recoveredSet = new Set(recovered.map(t => t.index));
  const seeds = [...kept, ...recovered.map(t => ({ easting: t.easting, northing: t.northing, height: t.height }))];
  const confirmed = confirmTops(seeds, suppressed.filter(t => !recoveredSet.has(t.index)), centres, field, smooth, grid, fuse, { apexReturns: t => referee.apexReturns(t) });
  const second = detectTreesTypedWithSeeds(grid, chm, typeMap, typedParameters, { surfaces, extraMaxima: [...recovered, ...confirmed] });
  return { ...second, first, suppressed: suppressed.length, recovered: recovered.length, confirmed: confirmed.length };
}
