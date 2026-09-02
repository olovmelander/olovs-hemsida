/* The independent-sensor cross-check: the campaign canopy rasters (laser)
   against the Meta/WRI CHMv2 canopy-height raster (optical, a different
   sensor and a different year) sampled onto the same 1 m grid. Everything
   here is a measurement the evidence records; the only rule stated is how a
   step across the campaign seam is attributed, and that is printed beside
   the numbers it was applied to.

   Rasters are { width, height, sampleSpacingMetres, originEasting,
   originNorthing, values: Float32Array } with NaN for void.                  */

export const DEFAULT_CANOPY_THRESHOLD_METRES = 2;

function assertSameGrid(a, b) {
  for (const key of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
    if (a[key] !== b[key]) throw new Error(`rasters differ in ${key}: ${a[key]} vs ${b[key]}`);
  }
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

/** Canopy presence agreement over cells both rasters measure. */
export function presenceConfusion(laser, other, { threshold = DEFAULT_CANOPY_THRESHOLD_METRES, cells = null } = {}) {
  assertSameGrid(laser, other);
  let n = 0, both = 0, laserOnly = 0, otherOnly = 0, neither = 0;
  const total = laser.width * laser.height;
  for (let i = 0; i < total; i++) {
    if (cells && !cells(i)) continue;
    const a = laser.values[i], b = other.values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++;
    const la = a >= threshold, ot = b >= threshold;
    if (la && ot) both++; else if (la) laserOnly++; else if (ot) otherOnly++; else neither++;
  }
  const agreement = n ? (both + neither) / n : null;
  const pLaser = n ? (both + laserOnly) / n : 0;
  const pOther = n ? (both + otherOnly) / n : 0;
  const expected = pLaser * pOther + (1 - pLaser) * (1 - pOther);
  const kappa = n && expected < 1 ? (agreement - expected) / (1 - expected) : null;
  return {
    n, both, laserOnly, otherOnly, neither, agreement, kappa,
    laserCanopyFraction: n ? pLaser : null, otherCanopyFraction: n ? pOther : null,
  };
}

/** Height agreement over cells both rasters call canopy. */
export function heightAgreement(laser, other, { threshold = DEFAULT_CANOPY_THRESHOLD_METRES, cells = null } = {}) {
  assertSameGrid(laser, other);
  const total = laser.width * laser.height;
  const diffs = [];
  let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0, sumAbs = 0, sumSq = 0;
  for (let i = 0; i < total; i++) {
    if (cells && !cells(i)) continue;
    const a = laser.values[i], b = other.values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < threshold || b < threshold) continue;
    const d = a - b;
    diffs.push(Math.abs(d));
    sumA += a; sumB += b; sumAB += a * b; sumAA += a * a; sumBB += b * b; sumAbs += Math.abs(d); sumSq += d * d;
  }
  const n = diffs.length;
  if (!n) return { n: 0 };
  diffs.sort((x, y) => x - y);
  const meanA = sumA / n, meanB = sumB / n;
  const cov = sumAB / n - meanA * meanB;
  const varA = sumAA / n - meanA * meanA;
  const varB = sumBB / n - meanB * meanB;
  const pearson = varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : null;
  const slope = varB > 0 ? cov / varB : null; /* laser = slope * other + intercept */
  return {
    n, laserMeanMetres: meanA, otherMeanMetres: meanB, biasMetres: meanA - meanB,
    maeMetres: sumAbs / n, rmseMetres: Math.sqrt(sumSq / n), pearson,
    slope, interceptMetres: slope === null ? null : meanA - slope * meanB,
    p50AbsMetres: quantile(diffs, 0.5), p90AbsMetres: quantile(diffs, 0.9),
  };
}

/** Mean of the other raster per laser-height bin: where the optical model saturates. */
export function binnedHeights(laser, other, { binMetres = 5, maxMetres = 45, threshold = DEFAULT_CANOPY_THRESHOLD_METRES } = {}) {
  assertSameGrid(laser, other);
  const bins = [];
  for (let low = 0; low < maxMetres; low += binMetres) {
    bins.push({ laserFromMetres: low, laserToMetres: low + binMetres, n: 0, sumLaser: 0, sumOther: 0, otherCanopy: 0 });
  }
  const total = laser.width * laser.height;
  for (let i = 0; i < total; i++) {
    const a = laser.values[i], b = other.values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < threshold) continue;
    const bin = bins[Math.min(bins.length - 1, Math.floor(a / binMetres))];
    bin.n++; bin.sumLaser += a; bin.sumOther += b; if (b >= threshold) bin.otherCanopy++;
  }
  return bins.map(bin => ({
    laserFromMetres: bin.laserFromMetres, laserToMetres: bin.laserToMetres, n: bin.n,
    laserMeanMetres: bin.n ? bin.sumLaser / bin.n : null, otherMeanMetres: bin.n ? bin.sumOther / bin.n : null,
    otherCanopyFraction: bin.n ? bin.otherCanopy / bin.n : null,
  }));
}

/** Presence and height agreement per square tile of the grid. */
export function tileCrosscheck(laser, other, { tileCells = 256, threshold = DEFAULT_CANOPY_THRESHOLD_METRES } = {}) {
  assertSameGrid(laser, other);
  const across = Math.ceil(laser.width / tileCells);
  const down = Math.ceil(laser.height / tileCells);
  const tiles = [];
  for (let tr = 0; tr < down; tr++) for (let tc = 0; tc < across; tc++) {
    const cells = i => {
      const column = i % laser.width, row = Math.floor(i / laser.width);
      return Math.floor(column / tileCells) === tc && Math.floor(row / tileCells) === tr;
    };
    const presence = presenceConfusion(laser, other, { threshold, cells });
    const heights = heightAgreement(laser, other, { threshold, cells });
    tiles.push({
      column: tc, row: tr,
      minEasting: laser.originEasting + tc * tileCells * laser.sampleSpacingMetres,
      maxNorthing: laser.originNorthing - tr * tileCells * laser.sampleSpacingMetres,
      n: presence.n, agreement: presence.agreement, kappa: presence.kappa,
      laserCanopyFraction: presence.laserCanopyFraction, otherCanopyFraction: presence.otherCanopyFraction,
      heightN: heights.n, biasMetres: heights.n ? heights.biasMetres : null, pearson: heights.n ? heights.pearson : null,
    });
  }
  return tiles;
}

/**
 * Canopy fraction and mean height in bands parallel to the seam, for both
 * sensors, and the step across it. The attribution rule: if the optical
 * raster shows the same step (within 1 m or a quarter of its own step) the
 * step is forest; otherwise it belongs to the campaigns.
 */
export function seamProfile(laser, other, { seamNorthing, bandMetres = 100, stepMetres = 10, threshold = DEFAULT_CANOPY_THRESHOLD_METRES } = {}) {
  assertSameGrid(laser, other);
  const spacing = laser.sampleSpacingMetres;
  const bands = new Map();
  const band = offset => Math.floor(offset / stepMetres) * stepMetres;
  for (let row = 0; row < laser.height; row++) {
    const offset = (laser.originNorthing - (row + 0.5) * spacing) - seamNorthing; /* north positive */
    if (offset < -bandMetres || offset >= bandMetres) continue;
    const key = band(offset);
    if (!bands.has(key)) bands.set(key, { offsetMetres: key, n: 0, laserCanopy: 0, laserSum: 0, otherCanopy: 0, otherSum: 0 });
    const entry = bands.get(key);
    for (let column = 0; column < laser.width; column++) {
      const i = row * laser.width + column;
      const a = laser.values[i], b = other.values[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      entry.n++;
      if (a >= threshold) { entry.laserCanopy++; entry.laserSum += a; }
      if (b >= threshold) { entry.otherCanopy++; entry.otherSum += b; }
    }
  }
  const profile = [...bands.values()].sort((x, y) => x.offsetMetres - y.offsetMetres).map(entry => ({
    offsetMetres: entry.offsetMetres, n: entry.n,
    laserCanopyFraction: entry.n ? entry.laserCanopy / entry.n : null,
    laserMeanHeightMetres: entry.laserCanopy ? entry.laserSum / entry.laserCanopy : null,
    otherCanopyFraction: entry.n ? entry.otherCanopy / entry.n : null,
    otherMeanHeightMetres: entry.otherCanopy ? entry.otherSum / entry.otherCanopy : null,
  }));
  const side = predicate => {
    const rows = profile.filter(predicate);
    const n = rows.reduce((s, r) => s + r.n, 0);
    const weighted = key => (n ? rows.reduce((s, r) => s + (r[key] ?? 0) * r.n, 0) / n : null);
    const heightOf = (fractionKey, heightKey) => {
      const canopyCells = rows.reduce((s, r) => s + (r[fractionKey] ?? 0) * r.n, 0);
      return canopyCells ? rows.reduce((s, r) => s + (r[heightKey] ?? 0) * (r[fractionKey] ?? 0) * r.n, 0) / canopyCells : null;
    };
    return {
      n, laserCanopyFraction: weighted('laserCanopyFraction'), otherCanopyFraction: weighted('otherCanopyFraction'),
      laserMeanHeightMetres: heightOf('laserCanopyFraction', 'laserMeanHeightMetres'),
      otherMeanHeightMetres: heightOf('otherCanopyFraction', 'otherMeanHeightMetres'),
    };
  };
  const north = side(r => r.offsetMetres >= 0);
  const south = side(r => r.offsetMetres < 0);
  const step = key => (north[key] !== null && south[key] !== null ? north[key] - south[key] : null);
  const laserFractionStep = step('laserCanopyFraction'), otherFractionStep = step('otherCanopyFraction');
  const laserHeightStep = step('laserMeanHeightMetres'), otherHeightStep = step('otherMeanHeightMetres');
  const attribute = (laserStep, otherStep, unit) => {
    if (laserStep === null || otherStep === null) return 'unmeasured';
    const tolerance = Math.max(unit, 0.25 * Math.abs(otherStep));
    return Math.abs(laserStep - otherStep) <= tolerance ? 'forest' : 'campaign';
  };
  return {
    seamNorthing, bandMetres, stepMetres, threshold, profile, north, south,
    steps: {
      canopyFraction: { laser: laserFractionStep, other: otherFractionStep, attribution: attribute(laserFractionStep, otherFractionStep, 0.05) },
      meanHeightMetres: { laser: laserHeightStep, other: otherHeightStep, attribution: attribute(laserHeightStep, otherHeightStep, 1) },
    },
    rule: 'a step is forest when the optical raster shows it too, within 1 m (height) or 0.05 (fraction) or a quarter of its own step; otherwise it belongs to the campaigns',
  };
}

/**
 * What the disagreeing cells look like: their heights, and whether they sit
 * beside canopy the other sensor does see (edge blur, a resolution effect)
 * or stand alone (a real difference between the two acquisitions).
 */
export function disagreementProfile(laser, other, { threshold = DEFAULT_CANOPY_THRESHOLD_METRES, neighbourhoodMetres = 2 } = {}) {
  assertSameGrid(laser, other);
  const { width, height, sampleSpacingMetres: spacing } = laser;
  const reach = Math.max(1, Math.round(neighbourhoodMetres / spacing));
  const histogram = () => ({ '2-3': 0, '3-5': 0, '5-10': 0, '10+': 0 });
  const bucket = value => (value < 3 ? '2-3' : value < 5 ? '3-5' : value < 10 ? '5-10' : '10+');
  const canopyNear = (values, column, row) => {
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      if (!dr && !dc) continue;
      const c = column + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const value = values[r * width + c];
      if (Number.isFinite(value) && value >= threshold) return true;
    }
    return false;
  };
  const laserOnly = { n: 0, heights: histogram(), besideOtherCanopy: 0 };
  const otherOnly = { n: 0, heights: histogram(), besideLaserCanopy: 0 };
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const i = row * width + column;
    const a = laser.values[i], b = other.values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const la = a >= threshold, ot = b >= threshold;
    if (la && !ot) {
      laserOnly.n++; laserOnly.heights[bucket(a)]++;
      if (canopyNear(other.values, column, row)) laserOnly.besideOtherCanopy++;
    } else if (ot && !la) {
      otherOnly.n++; otherOnly.heights[bucket(b)]++;
      if (canopyNear(laser.values, column, row)) otherOnly.besideLaserCanopy++;
    }
  }
  return {
    neighbourhoodMetres,
    laserOnly: { ...laserOnly, besideOtherCanopyFraction: laserOnly.n ? laserOnly.besideOtherCanopy / laserOnly.n : null },
    otherOnly: { ...otherOnly, besideLaserCanopyFraction: otherOnly.n ? otherOnly.besideLaserCanopy / otherOnly.n : null },
  };
}

/**
 * Cells the optical model reads as tall where the laser reads bare, per
 * tile, with their largest 4-connected block. A contiguous block of a
 * hectare is a stand felled after the imagery was taken (the laser is the
 * newer record); scattered cells are the model smearing crowns outward.
 */
export function clearedBlocks(laser, other, { tileCells = 256, tallMetres = 8, bareMetres = 1, minBlockCells = 100 } = {}) {
  assertSameGrid(laser, other);
  const { width, height, sampleSpacingMetres: spacing } = laser;
  const cellHectares = (spacing * spacing) / 10000;
  const across = Math.ceil(width / tileCells);
  const down = Math.ceil(height / tileCells);
  const tiles = [];
  for (let tr = 0; tr < down; tr++) for (let tc = 0; tc < across; tc++) {
    const rows = Math.min(tileCells, height - tr * tileCells);
    const columns = Math.min(tileCells, width - tc * tileCells);
    const mark = new Uint8Array(rows * columns);
    let compared = 0, marked = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const i = (tr * tileCells + r) * width + tc * tileCells + c;
      const a = laser.values[i], b = other.values[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      compared++;
      if (b >= tallMetres && a < bareMetres) { mark[r * columns + c] = 1; marked++; }
    }
    const seen = new Uint8Array(rows * columns);
    let largest = 0, blocks = 0;
    for (let k = 0; k < mark.length; k++) {
      if (!mark[k] || seen[k]) continue;
      let size = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const q = stack.pop();
        size++;
        const r = Math.floor(q / columns), c = q % columns;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= columns) continue;
          const j = rr * columns + cc;
          if (mark[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (size >= minBlockCells) blocks++;
      largest = Math.max(largest, size);
    }
    tiles.push({
      column: tc, row: tr, compared,
      tallImageryBareLaserFraction: compared ? marked / compared : null,
      largestBlockHectares: largest * cellHectares,
      blocksOverMinimum: blocks,
    });
  }
  return tiles;
}

/** For each published individual, whether the other raster sees canopy within its crown. */
export function recordAgreement(records, other, { threshold = DEFAULT_CANOPY_THRESHOLD_METRES } = {}) {
  const spacing = other.sampleSpacingMetres;
  const byCampaign = new Map();
  let n = 0, agree = 0, sumBias = 0;
  for (const record of records) {
    const column0 = Math.floor((record.easting - other.originEasting) / spacing);
    const row0 = Math.floor((other.originNorthing - record.northing) / spacing);
    const reach = Math.max(1, Math.ceil(record.crownRadiusMetres / spacing));
    let max = Number.NaN, any = false;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      const column = column0 + dc, row = row0 + dr;
      if (column < 0 || row < 0 || column >= other.width || row >= other.height) continue;
      if (Math.hypot(dc * spacing, dr * spacing) > record.crownRadiusMetres + spacing) continue;
      const value = other.values[row * other.width + column];
      if (!Number.isFinite(value)) continue;
      any = true;
      if (!(value <= max)) max = value;
    }
    if (!any) continue;
    n++;
    const ok = max >= threshold;
    const key = record.campaignId || 'unknown';
    if (!byCampaign.has(key)) byCampaign.set(key, { n: 0, agree: 0, sumBias: 0 });
    const entry = byCampaign.get(key);
    entry.n++;
    if (ok) {
      agree++; sumBias += record.heightMetres - max;
      entry.agree++; entry.sumBias += record.heightMetres - max;
    }
  }
  return {
    n, agree, fraction: n ? agree / n : null,
    heightBiasMetres: agree ? sumBias / agree : null,
    byCampaign: Object.fromEntries([...byCampaign].map(([key, entry]) => [key, {
      n: entry.n, agree: entry.agree, fraction: entry.n ? entry.agree / entry.n : null,
      heightBiasMetres: entry.agree ? entry.sumBias / entry.agree : null,
    }])),
  };
}
