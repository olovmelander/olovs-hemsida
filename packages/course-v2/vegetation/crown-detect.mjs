/* Individual crown candidates from a canopy-height model: Stage 4 of the
   vegetation plan, in Node, over the rasters canopy-fields.mjs produces.

   The method is the one the lidR book documents for low-density ALS and the
   one Skogsstyrelsen's own density report is written against: local maxima
   through a height-adaptive circular window that is never narrower than
   3 m, then Dalponte-style region growing from each apex on the SMOOTHED
   model, with heights read from the UNSMOOTHED one. The starting parameters
   are the plan's declared values; a change to them is a recorded decision.

   Nothing here is a stem. A crown centre is labelled as such, an apex is
   kept beside it, and the uncertainty floors are the ones a 1-2 pulse/m²
   source can honestly carry. Dense stands where crowns cannot be separated
   are handed to the stand representation, never forced into one object per
   maximum.                                                                   */
import { assertRaster, cellCentre } from './canopy-fields.mjs';

export const CROWN_PARAMETERS = Object.freeze({
  /* local-maximum window radius in metres: clamp(base + slope * height, min, max) */
  windowBaseMetres: 2,
  windowSlope: 0.10,
  windowMinimumMetres: 3,
  windowMaximumMetres: 6,
  /* a candidate is at least this tall; below it is shrub/young structure */
  minimumCandidateHeightMetres: 3,
  /* region growing: a cell joins if above seed * apex, above crown * running mean, within maxRadius */
  seedFraction: 0.45,
  crownFraction: 0.55,
  maximumCrownRadiusMetres: 10,
  /* uncertainty floors a derived-lidar record may not go below */
  horizontalAccuracyFloorMetres: 1.5,
  verticalAccuracyFloorMetres: 1.5,
});

export function variableWindowRadius(heightMetres, parameters = CROWN_PARAMETERS) {
  const { windowBaseMetres, windowSlope, windowMinimumMetres, windowMaximumMetres } = parameters;
  const radius = windowBaseMetres + windowSlope * heightMetres;
  return Math.min(windowMaximumMetres, Math.max(windowMinimumMetres, radius));
}

/**
 * Local maxima of the detection raster. A cell is an apex when no measured
 * cell inside its circular window is higher, and no equal cell precedes it in
 * scan order -- so a flat-topped crown yields one apex, deterministically.
 * `excludeMask` (1 = excluded) removes cells over buildings, water, turf or
 * anything else the semantic exclusions already know about.
 */
export function detectLocalMaxima(detection, {
  parameters = CROWN_PARAMETERS,
  excludeMask = null,
} = {}) {
  assertRaster(detection, 'detection raster');
  const { width, height, values, sampleSpacingMetres } = detection;
  if (excludeMask && excludeMask.length !== values.length) throw new RangeError('excludeMask must match the raster');
  const maxima = [];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const value = values[index];
      if (Number.isNaN(value) || value < parameters.minimumCandidateHeightMetres) continue;
      if (excludeMask && excludeMask[index]) continue;
      const radiusMetres = variableWindowRadius(value, parameters);
      const radiusCells = radiusMetres / sampleSpacingMetres;
      const reach = Math.ceil(radiusCells);
      let isMaximum = true;
      for (let dy = -reach; dy <= reach && isMaximum; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dx * dx + dy * dy > radiusCells * radiusCells) continue;
          const c = column + dx;
          const r = row + dy;
          if (c < 0 || r < 0 || c >= width || r >= height) continue;
          const other = values[r * width + c];
          if (Number.isNaN(other)) continue;
          if (other > value || (other === value && (r < row || (r === row && c < column)))) { isMaximum = false; break; }
        }
      }
      if (!isMaximum) continue;
      maxima.push(Object.freeze({ column, row, index, height: value, windowRadiusMetres: radiusMetres }));
    }
  }
  /* tallest first: the order region growing claims cells in */
  maxima.sort((left, right) => right.height - left.height || left.index - right.index);
  return maxima;
}

/**
 * Dalponte-style region growing. Returns Int32Array labels (-1 = unassigned)
 * indexing into `maxima`. Growth never crosses an excluded cell, a void, or a
 * campaign boundary when `ownership` is supplied: a crown belongs to one scan.
 */
export function growCrowns(detection, maxima, {
  parameters = CROWN_PARAMETERS,
  excludeMask = null,
  ownership = null,
} = {}) {
  assertRaster(detection, 'detection raster');
  const { width, height, values, sampleSpacingMetres } = detection;
  const labels = new Int32Array(values.length).fill(-1);
  const maxRadiusCells = parameters.maximumCrownRadiusMetres / sampleSpacingMetres;
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  maxima.forEach((apex, id) => {
    if (labels[apex.index] !== -1) return;
    labels[apex.index] = id;
    let sum = apex.height;
    let count = 1;
    const queue = [apex.index];
    const minimum = Math.max(parameters.seedFraction * apex.height, parameters.minimumCandidateHeightMetres - 1);
    const owner = ownership ? ownership[apex.index] : null;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const currentRow = Math.floor(current / width);
      const currentColumn = current - currentRow * width;
      for (const [dx, dy] of neighbours) {
        const c = currentColumn + dx;
        const r = currentRow + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const index = r * width + c;
        if (labels[index] !== -1) continue;
        const value = values[index];
        if (Number.isNaN(value)) continue;
        if (excludeMask && excludeMask[index]) continue;
        if (ownership && ownership[index] !== owner) continue;
        const ddx = c - apex.column;
        const ddy = r - apex.row;
        if (ddx * ddx + ddy * ddy > maxRadiusCells * maxRadiusCells) continue;
        if (value > apex.height) continue;
        if (value < minimum) continue;
        if (value < parameters.crownFraction * (sum / count)) continue;
        labels[index] = id;
        sum += value;
        count++;
        queue.push(index);
      }
    }
  });
  return labels;
}

/**
 * Per-crown geometry read from the UNSMOOTHED heights over the grown labels.
 * `centroid` is height-weighted and is the candidate position; `apex` is the
 * detection maximum; both are kept because neither is a stem.
 */
export function crownStatistics(heights, labels, maxima, { voids = null, ownership = null } = {}) {
  assertRaster(heights, 'height raster');
  const { width, height, values, sampleSpacingMetres } = heights;
  if (labels.length !== values.length) throw new RangeError('labels must match the raster');
  const cellArea = sampleSpacingMetres * sampleSpacingMetres;
  const crowns = maxima.map((apex, id) => ({
    id,
    apex,
    cells: 0,
    boundaryCells: 0,
    touchesRasterEdge: false,
    touchesVoid: false,
    sumWeightedEasting: 0,
    sumWeightedNorthing: 0,
    sumWeights: 0,
    sumHeight: 0,
    maxHeight: -Infinity,
    boundaryHeightSum: 0,
    boundaryHeightCount: 0,
    ownership: ownership ? ownership[apex.index] : null,
  }));
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const id = labels[index];
      if (id < 0) continue;
      const crown = crowns[id];
      const value = values[index];
      const measured = !Number.isNaN(value);
      const weight = measured ? Math.max(value, 0.01) : 0.01;
      const centre = cellCentre(heights, column, row);
      crown.cells++;
      crown.sumWeightedEasting += centre.easting * weight;
      crown.sumWeightedNorthing += centre.northing * weight;
      crown.sumWeights += weight;
      if (measured) {
        crown.sumHeight += value;
        if (value > crown.maxHeight) crown.maxHeight = value;
      }
      let boundary = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = column + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) { crown.touchesRasterEdge = true; boundary = true; continue; }
        const other = r * width + c;
        if (labels[other] !== id) boundary = true;
        if (voids && voids[other]) crown.touchesVoid = true;
      }
      if (boundary) {
        crown.boundaryCells++;
        if (measured) { crown.boundaryHeightSum += value; crown.boundaryHeightCount++; }
      }
    }
  }
  return crowns.map(crown => {
    const areaSquareMetres = crown.cells * cellArea;
    const equivalentRadius = Math.sqrt(areaSquareMetres / Math.PI);
    const perimeterMetres = crown.boundaryCells * sampleSpacingMetres;
    const compactness = perimeterMetres > 0 ? Math.min(1, (4 * Math.PI * areaSquareMetres) / (perimeterMetres * perimeterMetres)) : 0;
    const apexHeight = Number.isNaN(values[crown.apex.index]) ? crown.maxHeight : values[crown.apex.index];
    const boundaryMean = crown.boundaryHeightCount ? crown.boundaryHeightSum / crown.boundaryHeightCount : 0;
    const apexCentre = cellCentre(heights, crown.apex.column, crown.apex.row);
    return Object.freeze({
      id: crown.id,
      apex: Object.freeze({ column: crown.apex.column, row: crown.apex.row, easting: round(apexCentre.easting), northing: round(apexCentre.northing), heightMetres: round(apexHeight) }),
      centroid: Object.freeze({
        easting: round(crown.sumWeightedEasting / crown.sumWeights),
        northing: round(crown.sumWeightedNorthing / crown.sumWeights),
      }),
      heightMetres: round(Math.max(apexHeight, crown.maxHeight)),
      meanHeightMetres: round(crown.sumHeight / Math.max(1, crown.cells)),
      cells: crown.cells,
      areaSquareMetres: round(areaSquareMetres, 2),
      equivalentRadiusMetres: round(equivalentRadius),
      compactness: round(compactness),
      prominenceMetres: round(Math.max(0, apexHeight - boundaryMean)),
      touchesRasterEdge: crown.touchesRasterEdge,
      touchesVoid: crown.touchesVoid,
      ownership: crown.ownership,
    });
  });
}

function round(value, decimals = 3) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/**
 * Separation from the nearest other crown, and the individual/stand verdict.
 * A crown is an individual candidate when it stands clear of its neighbours,
 * is compact and prominent, and is not cut by the raster edge; anything else
 * is stand structure. Thresholds are the plan's starting values.
 */
export function classifyCrowns(crowns, {
  minimumSeparationMetres = 0.5,
  minimumCompactness = 0.45,
  minimumProminenceMetres = 2,
  minimumRadiusMetres = 1,
} = {}) {
  return crowns.map(crown => {
    let nearest = Infinity;
    let nearestId = null;
    for (const other of crowns) {
      if (other.id === crown.id) continue;
      const distance = Math.hypot(other.centroid.easting - crown.centroid.easting, other.centroid.northing - crown.centroid.northing);
      const separation = distance - other.equivalentRadiusMetres - crown.equivalentRadiusMetres;
      if (separation < nearest) { nearest = separation; nearestId = other.id; }
    }
    const reasons = [];
    if (crown.touchesRasterEdge) reasons.push('touches-raster-edge');
    if (crown.equivalentRadiusMetres < minimumRadiusMetres) reasons.push('too-small');
    if (crown.compactness < minimumCompactness) reasons.push('not-compact');
    if (crown.prominenceMetres < minimumProminenceMetres) reasons.push('not-prominent');
    if (Number.isFinite(nearest) && nearest < minimumSeparationMetres) reasons.push('crowns-touch');
    return Object.freeze({
      ...crown,
      nearestCrownId: nearestId,
      separationMetres: Number.isFinite(nearest) ? round(nearest) : null,
      representation: reasons.length ? 'stand' : 'individual',
      standReasons: Object.freeze(reasons),
    });
  });
}

/**
 * Confidence from independently inspectable terms in [0, 1]. The components
 * are returned beside the composite so review evidence can show WHY a
 * candidate scored what it did; runtime keeps only the composite.
 */
export function crownConfidence(crown, {
  pulseDensityPerSquareMetre = null,
  referenceDensityPerSquareMetre = 1.5,
  seamDistanceMetres = null,
  tileEdgeDistanceMetres = null,
  independentAgreement = null,
  captureAgeYears = null,
} = {}) {
  const clamp = value => Math.min(1, Math.max(0, value));
  const terms = {
    density: pulseDensityPerSquareMetre === null ? 0.5 : clamp(pulseDensityPerSquareMetre / referenceDensityPerSquareMetre),
    prominence: clamp(crown.prominenceMetres / 6),
    compactness: clamp(crown.compactness),
    separation: crown.separationMetres === null ? 0.7 : clamp((crown.separationMetres + 1) / 3),
    boundaries: clamp(Math.min(
      seamDistanceMetres === null ? 30 : seamDistanceMetres,
      tileEdgeDistanceMetres === null ? 30 : tileEdgeDistanceMetres,
    ) / 30),
    voids: crown.touchesVoid ? 0.5 : 1,
    independent: independentAgreement === null ? 0.6 : clamp(independentAgreement),
    recency: captureAgeYears === null ? 0.6 : clamp(1 - captureAgeYears / 10),
  };
  const weights = { density: 1.5, prominence: 1.5, compactness: 1, separation: 1.5, boundaries: 1, voids: 1, independent: 1, recency: 0.5 };
  let sum = 0;
  let weight = 0;
  for (const [name, value] of Object.entries(terms)) { sum += value * weights[name]; weight += weights[name]; }
  return Object.freeze({ confidence: round(sum / weight), terms: Object.freeze(Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, round(v)]))) });
}

/**
 * The visible extent of an individual crown. Dalponte growth stops at
 * `seedFraction` of the apex, which for a rounded crown profile is well
 * inside the drip line -- measured on synthetic crowns, about 70% of it --
 * and a golfer sees the drip line. For crowns that stand clear of their
 * neighbours the segment is extended outward over connected measured cells
 * still at or above `extentFraction` of the apex and above the canopy
 * threshold, that are nearer to this apex than to any other, so two
 * individuals can never claim the same cell. Stand crowns keep their core
 * radius: their extent is the stand's, not theirs.
 */
export function crownExtents(detection, crowns, maxima, {
  extentFraction = 0.2,
  minimumHeightMetres = 2,
  maximumRadiusMetres = CROWN_PARAMETERS.maximumCrownRadiusMetres,
  excludeMask = null,
  ownership = null,
  /* when supplied, every cell of an individual's extent is labelled with its
     crown id, so the stand field can leave those cells to the individual */
  extentLabels = null,
} = {}) {
  assertRaster(detection, 'detection raster');
  const { width, height, values, sampleSpacingMetres } = detection;
  const maxRadiusCells = maximumRadiusMetres / sampleSpacingMetres;
  /* bucket the apices so the nearest-apex test is local */
  const bucket = Math.max(1, Math.ceil(maxRadiusCells));
  const buckets = new Map();
  maxima.forEach((apex, id) => {
    const key = `${Math.floor(apex.column / bucket)},${Math.floor(apex.row / bucket)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ id, column: apex.column, row: apex.row });
  });
  const nearestApex = (column, row) => {
    const bc = Math.floor(column / bucket);
    const br = Math.floor(row / bucket);
    let best = Infinity;
    let bestId = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const apex of buckets.get(`${bc + dx},${br + dy}`) || []) {
          const d = (apex.column - column) ** 2 + (apex.row - row) ** 2;
          if (d < best || (d === best && apex.id < bestId)) { best = d; bestId = apex.id; }
        }
      }
    }
    return bestId;
  };
  const visited = new Uint8Array(values.length);
  const touched = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  return crowns.map(crown => {
    if (crown.representation !== 'individual') {
      return Object.freeze({ ...crown, coreRadiusMetres: crown.equivalentRadiusMetres, radiusMetres: crown.equivalentRadiusMetres, extentCells: crown.cells });
    }
    const apex = maxima[crown.id];
    const floor = Math.max(minimumHeightMetres, extentFraction * apex.height);
    const owner = ownership ? ownership[apex.index] : null;
    const queue = [apex.index];
    visited[apex.index] = 1;
    touched.push(apex.index);
    let cells = 0;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      cells++;
      if (extentLabels) extentLabels[current] = crown.id;
      const currentRow = Math.floor(current / width);
      const currentColumn = current - currentRow * width;
      for (const [dx, dy] of neighbours) {
        const c = currentColumn + dx;
        const r = currentRow + dy;
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const index = r * width + c;
        if (visited[index]) continue;
        visited[index] = 1;
        touched.push(index);
        const value = values[index];
        if (Number.isNaN(value) || value < floor || value > apex.height) continue;
        if (excludeMask && excludeMask[index]) continue;
        if (ownership && ownership[index] !== owner) continue;
        const ddx = c - apex.column;
        const ddy = r - apex.row;
        if (ddx * ddx + ddy * ddy > maxRadiusCells * maxRadiusCells) continue;
        if (nearestApex(c, r) !== crown.id) continue;
        queue.push(index);
      }
    }
    for (const index of touched) visited[index] = 0;
    touched.length = 0;
    const extentArea = cells * sampleSpacingMetres * sampleSpacingMetres;
    const extentRadius = Math.sqrt(extentArea / Math.PI);
    return Object.freeze({
      ...crown,
      coreRadiusMetres: crown.equivalentRadiusMetres,
      radiusMetres: round(Math.max(extentRadius, crown.equivalentRadiusMetres)),
      extentCells: cells,
    });
  });
}

/**
 * The whole Stage 4 chain over one campaign's rasters. `excludeMask` removes
 * cells from detection AND growth; `growthExcludeMask` constrains growth and
 * extent only, so a maximum inside an excluded area is still returned and
 * can be rejected with a stated reason downstream.
 */
export function deriveCrownCandidates({
  heights, detection, voids = null, excludeMask = null, growthExcludeMask = null, ownership = null, parameters = CROWN_PARAMETERS,
}) {
  const growthMask = growthExcludeMask || excludeMask;
  const maxima = detectLocalMaxima(detection, { parameters, excludeMask });
  const labels = growCrowns(detection, maxima, { parameters, excludeMask: growthMask, ownership });
  const statistics = crownStatistics(heights, labels, maxima, { voids, ownership });
  const classified = classifyCrowns(statistics);
  const extentLabels = new Int32Array(detection.values.length).fill(-1);
  const crowns = crownExtents(detection, classified, maxima, {
    maximumRadiusMetres: parameters.maximumCrownRadiusMetres, excludeMask: growthMask, ownership, extentLabels,
  });
  return Object.freeze({ maxima, labels, crowns, extentLabels });
}
