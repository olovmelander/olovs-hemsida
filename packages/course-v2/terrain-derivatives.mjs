/* Geomorphometry from the height grid we already compile. These are pure
   derivatives of bytes already downloaded and verified — no new source, no
   new licence — and they carry the one thing a bare-earth model can say about
   golf that vectors cannot: where the ground was MOVED. A bunker is a cut
   depression with a rim; a tee is a built bench. Mowing boundaries are not
   here and never will be: green against collar is a cutting height, not a
   shape, and belongs to imagery. */

const NEIGHBOURS = Object.freeze([
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]);

function assertGrid(grid) {
  if (!grid || !Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height) ||
      grid.width < 3 || grid.height < 3) {
    throw new TypeError('a height grid at least 3x3 is required');
  }
  if (!Number.isFinite(grid.sampleSpacingMetres) || grid.sampleSpacingMetres <= 0) {
    throw new TypeError('sampleSpacingMetres must be positive and finite');
  }
  if (!grid.heights || grid.heights.length !== grid.width * grid.height) {
    throw new RangeError('heights must contain width * height samples');
  }
  return grid;
}

/** Horn's 3x3 slope, the standard for a regular DEM: it weights the cardinal
    neighbours twice and is far less noisy than a simple central difference. */
export function slopeGrid(grid) {
  assertGrid(grid);
  const { width, height, heights, sampleSpacingMetres } = grid;
  const slope = new Float32Array(width * height).fill(Number.NaN);
  const at = (column, row) => heights[row * width + column];
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const a = at(column - 1, row - 1), b = at(column, row - 1), c = at(column + 1, row - 1);
      const d = at(column - 1, row), f = at(column + 1, row);
      const g = at(column - 1, row + 1), h = at(column, row + 1), i = at(column + 1, row + 1);
      if ([a, b, c, d, f, g, h, i].some(Number.isNaN)) continue;
      const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * sampleSpacingMetres);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * sampleSpacingMetres);
      slope[row * width + column] = Math.hypot(dzdx, dzdy);
    }
  }
  return slope;
}

/** Terrain ruggedness: mean absolute height difference to the eight
    neighbours. Mown, graded ground is smooth at this scale; rough, scrub and
    forest floor are not. */
export function ruggednessGrid(grid) {
  assertGrid(grid);
  const { width, height, heights } = grid;
  const ruggedness = new Float32Array(width * height).fill(Number.NaN);
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const centre = heights[row * width + column];
      if (Number.isNaN(centre)) continue;
      let total = 0;
      let counted = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const neighbour = heights[(row + dy) * width + column + dx];
        if (Number.isNaN(neighbour)) continue;
        total += Math.abs(neighbour - centre);
        counted++;
      }
      if (counted === 8) ruggedness[row * width + column] = total / counted;
    }
  }
  return ruggedness;
}

class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.values = new Int32Array(capacity);
    this.size = 0;
  }

  push(key, value) {
    let index = this.size++;
    this.keys[index] = key;
    this.values[index] = value;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= this.keys[index]) break;
      this.#swap(parent, index);
      index = parent;
    }
  }

  pop() {
    const value = this.values[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.values[0] = this.values[this.size];
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.size && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.size && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === index) break;
        this.#swap(smallest, index);
        index = smallest;
      }
    }
    return value;
  }

  #swap(left, right) {
    const key = this.keys[left]; this.keys[left] = this.keys[right]; this.keys[right] = key;
    const value = this.values[left]; this.values[left] = this.values[right]; this.values[right] = value;
  }
}

/**
 * Priority-flood depression filling (Barnes et al.). Every cell is raised to
 * the level of the lowest rim it would have to spill over to reach the grid
 * edge or a nodata gap; `filled - original` is therefore the depth of water a
 * closed hollow would hold. That is exactly a bunker's signature, and unlike a
 * curvature threshold it cannot be fooled by a slope that merely steepens.
 */
export function fillDepressions(grid) {
  assertGrid(grid);
  const { width, height, heights } = grid;
  const count = width * height;
  const filled = new Float64Array(count);
  const visited = new Uint8Array(count);
  const heap = new MinHeap(count);
  for (let index = 0; index < count; index++) {
    filled[index] = heights[index];
    if (Number.isNaN(heights[index])) visited[index] = 1;
  }
  const seed = index => {
    if (visited[index]) return;
    visited[index] = 1;
    heap.push(heights[index], index);
  };
  for (let column = 0; column < width; column++) {
    seed(column);
    seed((height - 1) * width + column);
  }
  for (let row = 0; row < height; row++) {
    seed(row * width);
    seed(row * width + width - 1);
  }
  /* A nodata gap is an opening, not a wall: ground beside it can drain. */
  for (let index = 0; index < count; index++) {
    if (!Number.isNaN(heights[index])) continue;
    const column = index % width;
    const row = (index - column) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = column + dx;
      const ny = row + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      seed(ny * width + nx);
    }
  }
  while (heap.size > 0) {
    const index = heap.pop();
    const level = filled[index];
    const column = index % width;
    const row = (index - column) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = column + dx;
      const ny = row + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbour = ny * width + nx;
      if (visited[neighbour]) continue;
      visited[neighbour] = 1;
      filled[neighbour] = Math.max(heights[neighbour], level);
      heap.push(filled[neighbour], neighbour);
    }
  }
  return filled;
}

function componentStatistics({ grid, depth, minimumDepthMetres, minimumCells, maximumCells }) {
  const { width, height, heights, sampleSpacingMetres, originEasting, originNorthing } = grid;
  const cellArea = sampleSpacingMetres * sampleSpacingMetres;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(maximumCells + 8);
  const components = [];
  for (let start = 0; start < depth.length; start++) {
    if (seen[start] || !(depth[start] >= minimumDepthMetres)) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const cells = [];
    let overflowed = false;
    while (top > 0) {
      const index = stack[--top];
      cells.push(index);
      if (cells.length > maximumCells) { overflowed = true; break; }
      const column = index % width;
      const row = (index - column) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = column + dx;
        const ny = row + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (seen[neighbour] || !(depth[neighbour] >= minimumDepthMetres)) continue;
        seen[neighbour] = 1;
        stack[top++] = neighbour;
      }
    }
    if (overflowed || cells.length < minimumCells) continue;
    let maximumDepthMetres = 0;
    let totalEasting = 0;
    let totalNorthing = 0;
    let minColumn = Infinity, maxColumn = -Infinity, minRow = Infinity, maxRow = -Infinity;
    let floorHeight = Infinity;
    for (const index of cells) {
      const column = index % width;
      const row = (index - column) / width;
      maximumDepthMetres = Math.max(maximumDepthMetres, depth[index]);
      floorHeight = Math.min(floorHeight, heights[index]);
      totalEasting += originEasting + column * sampleSpacingMetres;
      totalNorthing += originNorthing - row * sampleSpacingMetres;
      minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
      minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
    }
    const spanEasting = (maxColumn - minColumn + 1) * sampleSpacingMetres;
    const spanNorthing = (maxRow - minRow + 1) * sampleSpacingMetres;
    components.push(Object.freeze({
      cells: cells.length,
      areaSquareMetres: +(cells.length * cellArea).toFixed(2),
      maximumDepthMetres: +maximumDepthMetres.toFixed(3),
      floorHeightRH2000: +floorHeight.toFixed(3),
      easting: +(totalEasting / cells.length).toFixed(3),
      northing: +(totalNorthing / cells.length).toFixed(3),
      spanEasting: +spanEasting.toFixed(2),
      spanNorthing: +spanNorthing.toFixed(2),
      /* 1 for a filled square, lower for a sprawling or ragged shape. A cut
         bunker is compact; a natural wet hollow in forest usually is not. */
      compactness: +(cells.length * cellArea / (spanEasting * spanNorthing)).toFixed(3),
    }));
  }
  return components;
}

export const BUNKER_CANDIDATE_DEFAULTS = Object.freeze({
  minimumDepthMetres: 0.35,
  maximumDepthMetres: 3.5,
  minimumAreaSquareMetres: 12,
  maximumAreaSquareMetres: 900,
  minimumCompactness: 0.35,
});

/**
 * Closed depressions whose depth, extent and compactness are consistent with a
 * cut bunker. This is a CANDIDATE list — a geometric hypothesis at accuracy
 * tier C until something independent agrees with it — never a claim that a
 * depression is sand.
 */
export function detectBunkerCandidates(grid, options = {}) {
  assertGrid(grid);
  const settings = { ...BUNKER_CANDIDATE_DEFAULTS, ...options };
  const cellArea = grid.sampleSpacingMetres * grid.sampleSpacingMetres;
  const filled = options.filled || fillDepressions(grid);
  const depth = new Float32Array(grid.heights.length);
  for (let index = 0; index < depth.length; index++) {
    depth[index] = Number.isNaN(grid.heights[index]) ? 0 : filled[index] - grid.heights[index];
  }
  const components = componentStatistics({
    grid,
    depth,
    minimumDepthMetres: settings.minimumDepthMetres,
    minimumCells: Math.max(1, Math.round(settings.minimumAreaSquareMetres / cellArea)),
    maximumCells: Math.max(2, Math.round(settings.maximumAreaSquareMetres / cellArea) * 4),
  });
  const candidates = components.filter(component =>
    component.areaSquareMetres >= settings.minimumAreaSquareMetres &&
    component.areaSquareMetres <= settings.maximumAreaSquareMetres &&
    component.maximumDepthMetres <= settings.maximumDepthMetres &&
    component.compactness >= settings.minimumCompactness);
  return Object.freeze({
    settings: Object.freeze({ ...settings }),
    depressions: components.length,
    candidates: Object.freeze(candidates.sort((left, right) =>
      right.maximumDepthMetres - left.maximumDepthMetres)),
  });
}

/**
 * Score candidates against an independent reference set — here the migrated
 * OSM bunker rings, which never entered the height model. Nearest-centroid
 * matching one-to-one, so a single candidate cannot claim several references.
 */
export function matchCandidatesToReference({ candidates, reference, toleranceMetres = 12 }) {
  if (!Array.isArray(candidates) || !Array.isArray(reference)) {
    throw new TypeError('candidates and reference must be arrays');
  }
  if (!Number.isFinite(toleranceMetres) || toleranceMetres <= 0) {
    throw new RangeError('toleranceMetres must be positive and finite');
  }
  const pairs = [];
  for (const [candidateIndex, candidate] of candidates.entries()) {
    for (const [referenceIndex, item] of reference.entries()) {
      const distance = Math.hypot(candidate.easting - item.easting, candidate.northing - item.northing);
      if (distance <= toleranceMetres) pairs.push({ candidateIndex, referenceIndex, distance });
    }
  }
  pairs.sort((left, right) => left.distance - right.distance);
  const usedCandidates = new Set();
  const usedReferences = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (usedCandidates.has(pair.candidateIndex) || usedReferences.has(pair.referenceIndex)) continue;
    usedCandidates.add(pair.candidateIndex);
    usedReferences.add(pair.referenceIndex);
    matches.push(pair);
  }
  const distances = matches.map(match => match.distance).sort((left, right) => left - right);
  return Object.freeze({
    toleranceMetres,
    candidates: candidates.length,
    reference: reference.length,
    matched: matches.length,
    unmatchedCandidates: candidates.length - matches.length,
    unmatchedReference: reference.length - matches.length,
    recall: reference.length ? +(matches.length / reference.length).toFixed(4) : 0,
    precision: candidates.length ? +(matches.length / candidates.length).toFixed(4) : 0,
    medianDistanceMetres: distances.length
      ? +distances[Math.floor(distances.length / 2)].toFixed(2)
      : null,
    maximumDistanceMetres: distances.length ? +distances.at(-1).toFixed(2) : null,
  });
}

export const LOCAL_RELIEF_DEFAULTS = Object.freeze({
  innerRadiusMetres: 4,
  annulusInnerMetres: 9,
  annulusOuterMetres: 14,
});

/**
 * How much lower the middle of a place is than the ground ringing it: the
 * mean of an annulus minus the minimum inside. Deliberately tolerant of a few
 * metres of registration error, so it can be asked about a feature whose
 * recorded position is only approximately known.
 */
export function localRelief(grid, point, options = {}) {
  assertGrid(grid);
  const { innerRadiusMetres, annulusInnerMetres, annulusOuterMetres } =
    { ...LOCAL_RELIEF_DEFAULTS, ...options };
  const { width, height, heights, sampleSpacingMetres, originEasting, originNorthing } = grid;
  const reach = Math.ceil(annulusOuterMetres / sampleSpacingMetres);
  const centreColumn = Math.round((point.easting - originEasting) / sampleSpacingMetres);
  const centreRow = Math.round((originNorthing - point.northing) / sampleSpacingMetres);
  let inner = Infinity;
  let annulusTotal = 0;
  let annulusCount = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const column = centreColumn + dx;
      const row = centreRow + dy;
      if (column < 0 || row < 0 || column >= width || row >= height) continue;
      const value = heights[row * width + column];
      if (Number.isNaN(value)) continue;
      const distance = Math.hypot(dx, dy) * sampleSpacingMetres;
      if (distance <= innerRadiusMetres) inner = Math.min(inner, value);
      else if (distance >= annulusInnerMetres && distance <= annulusOuterMetres) {
        annulusTotal += value;
        annulusCount++;
      }
    }
  }
  if (!annulusCount || !Number.isFinite(inner)) return Number.NaN;
  return annulusTotal / annulusCount - inner;
}

function quantiles(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    count: sorted.length,
    median: +at(0.5).toFixed(3),
    p90: +at(0.9).toFixed(3),
    maximum: +sorted.at(-1).toFixed(3),
  };
}

/**
 * Can this height model tell the recorded features apart from ordinary
 * ground at all? Compare local relief at the reference points against the
 * same statistic at control points. A finding without its control is not a
 * finding: if the control's upper tail reaches past the features' deepest,
 * no threshold can separate them and the model simply does not resolve them.
 */
export function reliefSeparability({ grid, reference, control, options }) {
  assertGrid(grid);
  if (!Array.isArray(reference) || !reference.length) throw new TypeError('reference points are required');
  if (!Array.isArray(control) || !control.length) throw new TypeError('control points are required');
  const measure = points => points
    .map(point => localRelief(grid, point, options))
    .filter(Number.isFinite);
  const referenceRelief = measure(reference);
  const controlRelief = measure(control);
  if (!referenceRelief.length || !controlRelief.length) {
    throw new Error('relief separability needs finite samples on both sides');
  }
  const referenceStats = quantiles(referenceRelief);
  const controlStats = quantiles(controlRelief);
  return Object.freeze({
    reference: Object.freeze(referenceStats),
    control: Object.freeze(controlStats),
    medianExcessMetres: +(referenceStats.median - controlStats.median).toFixed(3),
    /* The plain-language verdict: a threshold can only isolate the features
       if ordinary ground stays below their typical depth. */
    separable: controlStats.p90 < referenceStats.median,
  });
}

/** Summarise a derivative raster without retaining it. */
export function summarizeRaster(values, { percentiles = [0.5, 0.9, 0.99] } = {}) {
  const finite = [];
  for (const value of values) if (Number.isFinite(value)) finite.push(value);
  if (!finite.length) return Object.freeze({ finite: 0 });
  finite.sort((left, right) => left - right);
  const at = fraction => finite[Math.min(finite.length - 1, Math.floor(fraction * finite.length))];
  return Object.freeze({
    finite: finite.length,
    minimum: +finite[0].toFixed(4),
    maximum: +finite.at(-1).toFixed(4),
    mean: +(finite.reduce((total, value) => total + value, 0) / finite.length).toFixed(4),
    percentiles: Object.freeze(Object.fromEntries(
      percentiles.map(fraction => [String(fraction), +at(fraction).toFixed(4)]),
    )),
  });
}
