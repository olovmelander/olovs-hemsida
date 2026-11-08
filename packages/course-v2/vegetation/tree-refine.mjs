/* Recovering treetops the type-aware detector suppressed, with the laser
   deciding and a photo refereeing (Johannesberg round 3).

   In a leaf-off scan of about 2 first returns/m2, a mid-height tree beside a
   taller one, or one of two touching spruces, often has its own maximum on a
   lightly smoothed CHM, but the detector's height-scaled window (2-3 m) finds
   a higher cell of the neighbour's flank inside it and drops the top. Taking
   every such maximum back adds false trees as fast as real ones (round 2);
   this module takes back only a top that

     - is a maximum of the CHM smoothed by 0.3 m in a 1 m window (the
       over-segmenting filter the reference panels number), at least 3 m;
     - stands at least `minimumSeparationMetres` from every kept top that is
       taller, and at least `minimumDipMetres` above the lowest point of the
       CHM on the straight line to each of them (its own cone, not a bump on
       the neighbour's flank);
     - has its own laser apex: at least `apex.minimumReturns` first returns
       within `apex.radiusMetres` that reach to within `apex.depthMetres` of
       its height (a point-cloud test: a real top is hit, a smoothing artefact
       is not);
     - and shows a separate crown in the photo: between this top and the
       nearest taller kept top, each seen where the photo draws it (relief
       displacement k x `photo.fraction` x its height), the photo is darker
       than at both tops by at least `photo.minimumValley` of the dimmer top
       (a shaded gap or crown edge between two crowns).

   The photo never places a tree: the laser decides where there is canopy,
   where the top is and how tall it is. The photo and point tests are passed
   in as callbacks so that this module stays free of file access; the
   coefficients are chosen on calibration windows only (the tree pipeline's
   benchmark), never assumed universal.                                     */
import { createRaster } from './canopy-fields.mjs';
import { detectLocalMaxima } from './crown-detect.mjs';
import { smoothChm } from './pit-free-chm.mjs';
import { TYPE_BROADLEAF, TYPE_CONIFER, detectTreesTyped } from './tree-detect-v2.mjs';

export const REFINE_DEFAULTS = Object.freeze({
  candidateSigmaMetres: 0.3,
  candidateWindowMetres: 1,
  minimumHeightMetres: 3,
  /* a candidate this close to a kept top is that top */
  keptRadiusMetres: 1,
  neighbourRadiusMetres: 6,
  types: Object.freeze(['conifer', 'broadleaf']),
  minimumDipMetres: 1,
  minimumSeparationMetres: 2.5,
  apex: Object.freeze({ radiusMetres: 0.75, depthMetres: 1.5, minimumReturns: 3 }),
  photo: Object.freeze({ campaigns: Object.freeze(['presence']), fraction: 0.75, minimumValley: 0.1, combine: 'any' }),
});

/** Maxima of the CHM smoothed by `sigmaMetres` in a fixed window, at least `minimumHeightMetres` (raw CHM). */
export function overSegmentedTops(grid, chm, { sigmaMetres = 0.3, windowMetres = 1, minimumHeightMetres = 3, smoothed = null } = {}) {
  const smooth = smoothed || smoothChm(grid, chm, sigmaMetres);
  const raster = createRaster({ width: grid.width, height: grid.height, sampleSpacingMetres: grid.sampleSpacingMetres, originEasting: grid.minEasting, originNorthing: grid.maxNorthing, values: smooth });
  const maxima = detectLocalMaxima(raster, { parameters: { windowBaseMetres: windowMetres, windowSlope: 0, windowMinimumMetres: windowMetres, windowMaximumMetres: windowMetres, minimumCandidateHeightMetres: Math.min(2, minimumHeightMetres) } });
  const s = grid.sampleSpacingMetres;
  return maxima.map(m => ({
    index: m.index, column: m.column, row: m.row,
    easting: grid.minEasting + (m.column + 0.5) * s, northing: grid.maxNorthing - (m.row + 0.5) * s,
    height: chm[m.index],
  })).filter(t => t.height >= minimumHeightMetres);
}

/** The kept tops of a detectTreesTyped result: the maxima that still own a crown. */
export function keptTops(grid, detection) {
  const s = grid.sampleSpacingMetres;
  const owning = new Set(detection.crowns.map(c => c.id));
  return detection.maxima.map((m, k) => ({ k, m })).filter(({ k }) => owning.has(k)).map(({ m }) => ({
    index: m.index, easting: grid.minEasting + (m.column + 0.5) * s, northing: grid.maxNorthing - (m.row + 0.5) * s, height: m.height,
  }));
}

/**
 * Candidates the detector suppressed, each with its laser measures: the
 * smallest dip toward a taller kept top within the neighbour radius, the
 * distance to the nearest taller kept top (and that top), and its type.
 */
export function suppressedTops(grid, smoothed, tops, kept, typeMap, { keptRadiusMetres = 1, neighbourRadiusMetres = 6 } = {}) {
  const s = grid.sampleSpacingMetres;
  const cell = neighbourRadiusMetres;
  const buckets = new Map();
  for (const t of kept) {
    const key = `${Math.floor(t.easting / cell)},${Math.floor(t.northing / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const around = (e, n) => {
    const bx = Math.floor(e / cell), by = Math.floor(n / cell), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const t of buckets.get(`${bx + dx},${by + dy}`) || []) out.push(t);
    return out;
  };
  const sample = (e, n) => {
    const c = Math.floor((e - grid.minEasting) / s), r = Math.floor((grid.maxNorthing - n) / s);
    return c < 0 || r < 0 || c >= grid.width || r >= grid.height ? Number.NaN : smoothed[r * grid.width + c];
  };
  const out = [];
  for (const top of tops) {
    const near = around(top.easting, top.northing);
    if (near.some(t => Math.hypot(t.easting - top.easting, t.northing - top.northing) < keptRadiusMetres)) continue;
    let minDip = Infinity, minD = Infinity, nearestTaller = null;
    for (const t of near) {
      if (t.height < top.height) continue;
      const d = Math.hypot(t.easting - top.easting, t.northing - top.northing);
      if (d > neighbourRadiusMetres) continue;
      let low = Infinity;
      for (let f = 0; f <= 1.0001; f += 0.04) {
        const v = sample(top.easting + f * (t.easting - top.easting), top.northing + f * (t.northing - top.northing));
        if (v < low) low = v;
      }
      minDip = Math.min(minDip, top.height - low);
      if (d < minD) { minD = d; nearestTaller = t; }
    }
    const t = typeMap[top.index];
    out.push({ ...top, type: t === TYPE_CONIFER ? 'conifer' : t === TYPE_BROADLEAF ? 'broadleaf' : 'none', minimumDipMetres: minDip, nearestTallerMetres: minD, nearestTaller });
  }
  return out;
}

/**
 * The referee's decision for each suppressed top. `apexReturns(top)` counts
 * first returns at the top; `photoValley(campaign, top, taller, fraction)`
 * gives the relative brightness valley between the two tops in a photo, or
 * null where that photo cannot judge (no measured displacement, no pixels).
 * Returns the accepted tops; `trace` (optional array) receives every verdict.
 */
export function recoverTops(suppressed, { apexReturns, photoValley }, parameters = REFINE_DEFAULTS, trace = null) {
  const p = { ...REFINE_DEFAULTS, ...parameters, apex: { ...REFINE_DEFAULTS.apex, ...(parameters.apex || {}) }, photo: { ...REFINE_DEFAULTS.photo, ...(parameters.photo || {}) } };
  const accepted = [];
  for (const top of suppressed) {
    let reason = null;
    if (!p.types.includes(top.type)) reason = 'type';
    else if (top.height < p.minimumHeightMetres) reason = 'height';
    /* a top with no taller kept top within reach was not hidden by a
       neighbour (merged, too small, or cut at a window edge): left out */
    else if (!top.nearestTaller) reason = 'alone';
    else if (top.nearestTallerMetres < p.minimumSeparationMetres) reason = 'separation';
    else if (top.minimumDipMetres < p.minimumDipMetres) reason = 'dip';
    else if (apexReturns(top) < p.apex.minimumReturns) reason = 'apex';
    else if (p.photo.campaigns.length) {
      const valleys = p.photo.campaigns.map(c => photoValley(c, top, top.nearestTaller, p.photo.fraction));
      const judged = valleys.filter(v => v !== null && Number.isFinite(v));
      const pass = v => v !== null && Number.isFinite(v) && v >= p.photo.minimumValley;
      const ok = judged.length > 0 && (p.photo.combine === 'all' ? valleys.every(pass) : valleys.some(pass));
      if (!ok) reason = judged.length ? 'photo' : 'no-photo';
    }
    if (trace) trace.push({ easting: top.easting, northing: top.northing, height: top.height, type: top.type, verdict: reason ? `kept-out:${reason}` : 'recovered' });
    if (!reason) accepted.push(top);
  }
  return accepted;
}

/**
 * The refined detector: the type-aware detector, the referee over the tops it
 * suppressed, then the type-aware detector again with the recovered tops as
 * extra seeds (every crown regrown from the full set at once).
 */
export function detectTreesRefined(grid, chm, typeMap, typedParameters, refineParameters, referee, { surfaces = null, excludeMask = null, trace = null } = {}) {
  const first = detectTreesTyped(grid, chm, typeMap, typedParameters, { surfaces, excludeMask });
  const p = { ...REFINE_DEFAULTS, ...refineParameters };
  const smooth = smoothChm(grid, chm, p.candidateSigmaMetres);
  const tops = overSegmentedTops(grid, chm, { sigmaMetres: p.candidateSigmaMetres, windowMetres: p.candidateWindowMetres, minimumHeightMetres: p.minimumHeightMetres, smoothed: smooth });
  const kept = keptTops(grid, first);
  /* in 80 m tiles, row by row, so that a photo read through a tile cache
     stays local; the decisions do not depend on the order */
  const tileOf = t => [Math.floor(t.row * grid.sampleSpacingMetres / 80), Math.floor(t.column * grid.sampleSpacingMetres / 80)];
  const suppressed = suppressedTops(grid, smooth, tops, kept, typeMap, p).filter(t => !excludeMask || !excludeMask[t.index])
    .sort((a, b) => { const [ar, ac] = tileOf(a), [br, bc] = tileOf(b); return ar - br || ac - bc || a.index - b.index; });
  const recovered = recoverTops(suppressed, referee, p, trace);
  const second = detectTreesTyped(grid, chm, typeMap, typedParameters, { surfaces, excludeMask, extraMaxima: recovered });
  return { ...second, first, suppressed: suppressed.length, recovered: recovered.length };
}
