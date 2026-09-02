import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellCentre,
  cellOf,
  createRaster,
  distanceToCells,
  fillSingleCellVoids,
  medianFilter3x3,
  presenceMask,
  rasterSummary,
  roughness3x3,
  seamOwnership,
  standEdgeDistance,
  voidMask,
} from './canopy-fields.mjs';
import {
  CROWN_PARAMETERS,
  classifyCrowns,
  crownConfidence,
  crownStatistics,
  deriveCrownCandidates,
  detectLocalMaxima,
  growCrowns,
  variableWindowRadius,
} from './crown-detect.mjs';

const ORIGIN = { originEasting: 697000, originNorthing: 7025200 };

/* A synthetic canopy: Gaussian crowns of known apex, height and radius on
   a 1 m grid, with the ground at 0. Nothing about the compiler knows these
   numbers; the tests ask whether it recovers them. */
function syntheticCanopy(trees, { width = 120, height = 120, spacing = 1, floor = 0 } = {}) {
  const values = new Float32Array(width * height).fill(floor);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const e = ORIGIN.originEasting + (column + 0.5) * spacing;
      const n = ORIGIN.originNorthing - (row + 0.5) * spacing;
      let best = floor;
      for (const tree of trees) {
        const d2 = (e - tree.easting) ** 2 + (n - tree.northing) ** 2;
        /* crown radius is where the profile falls to 20% of the apex */
        const sigma2 = (tree.radius ** 2) / (2 * Math.log(5));
        const h = tree.height * Math.exp(-d2 / (2 * sigma2));
        if (h > best) best = h;
      }
      values[row * width + column] = best;
    }
  }
  return createRaster({ width, height, sampleSpacingMetres: spacing, ...ORIGIN, values });
}

const TREES = [
  { easting: 697020.5, northing: 7025180.5, height: 22, radius: 4 },
  { easting: 697060.5, northing: 7025170.5, height: 15, radius: 3 },
  { easting: 697095.5, northing: 7025185.5, height: 9, radius: 2 },
  { easting: 697030.5, northing: 7025120.5, height: 18, radius: 3.5 },
  { easting: 697080.5, northing: 7025110.5, height: 12, radius: 2.5 },
  { easting: 697100.5, northing: 7025140.5, height: 25, radius: 4.5 },
];

test('raster helpers: centres, cell lookup, void mask and summary', () => {
  const raster = createRaster({ width: 4, height: 3, sampleSpacingMetres: 2, ...ORIGIN });
  assert.deepEqual(cellCentre(raster, 0, 0), { easting: 697001, northing: 7025199 });
  assert.deepEqual(cellOf(raster, 697001, 7025199), { column: 0, row: 0 });
  assert.deepEqual(cellOf(raster, 697007.9, 7025194.1), { column: 3, row: 2 });
  raster.values.set([1, 2, 3, 4, Number.NaN, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([...voidMask(raster)], [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  const summary = rasterSummary(raster, { canopyThresholdMetres: 5 });
  assert.equal(summary.voidCells, 1);
  assert.equal(summary.measuredCells, 11);
  assert.equal(summary.canopyCells, 7);
  assert.equal(summary.maxHeightMetres, 12);
  assert.throws(() => createRaster({ width: 2, height: 2, sampleSpacingMetres: 0, ...ORIGIN }), /positive/);
});

test('single-cell voids fill from their neighbours; wider voids stay void', () => {
  const raster = createRaster({ width: 6, height: 6, sampleSpacingMetres: 1, ...ORIGIN, fill: 10 });
  raster.values[2 * 6 + 2] = Number.NaN;                      // one isolated void
  raster.values[4 * 6 + 4] = Number.NaN; raster.values[4 * 6 + 5] = Number.NaN; // a two-cell void at the edge
  const { raster: filled, filled: count } = fillSingleCellVoids(raster);
  assert.equal(count, 1);
  assert.equal(filled.values[2 * 6 + 2], 10);
  assert.ok(Number.isNaN(filled.values[4 * 6 + 4]));
  assert.ok(Number.isNaN(filled.values[4 * 6 + 5]));
  assert.ok(Number.isNaN(raster.values[2 * 6 + 2]), 'the input is not mutated');
});

test('median smoothing removes a spike, keeps voids, and heights stay in the unsmoothed copy', () => {
  const raster = createRaster({ width: 5, height: 5, sampleSpacingMetres: 1, ...ORIGIN, fill: 8 });
  raster.values[12] = 30;
  raster.values[0] = Number.NaN;
  const smooth = medianFilter3x3(raster);
  assert.equal(smooth.values[12], 8);
  assert.ok(Number.isNaN(smooth.values[0]));
  assert.equal(raster.values[12], 30);
  assert.equal(smooth.values[1], 8);
});

test('presence mask never marks a void as canopy', () => {
  const raster = createRaster({ width: 3, height: 1, sampleSpacingMetres: 1, ...ORIGIN });
  raster.values.set([1.9, 2, Number.NaN]);
  assert.deepEqual([...presenceMask(raster, 2)], [0, 1, 0]);
});

test('the distance transform is exact and the stand-edge distance is signed', () => {
  const width = 7;
  const height = 5;
  const target = new Set([2 * width + 3]);
  const distance = distanceToCells(width, height, i => target.has(i));
  assert.equal(distance[2 * width + 3], 0);
  assert.equal(distance[2 * width + 0], 3);
  assert.ok(Math.abs(distance[0] - Math.hypot(3, 2)) < 1e-9);
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < 3; column++) mask[row * width + column] = 1;
  const voids = new Uint8Array(width * height);
  voids[2 * width + 6] = 1;
  const edge = standEdgeDistance(mask, voids, { width, height, sampleSpacingMetres: 2 });
  assert.equal(edge[2 * width + 2], 2);      // last canopy column: one cell to open ground
  assert.equal(edge[2 * width + 0], 6);      // three cells inside
  assert.equal(edge[2 * width + 3], -2);     // first open column
  assert.equal(edge[2 * width + 5], -6);
  assert.ok(Number.isNaN(edge[2 * width + 6]), 'a void is neither side');
});

test('roughness and seam ownership', () => {
  const raster = createRaster({ width: 3, height: 3, sampleSpacingMetres: 1, ...ORIGIN, fill: 5 });
  assert.equal(roughness3x3(raster)[4], 0);
  raster.values[4] = 8;
  assert.ok(roughness3x3(raster)[4] > 0);
  const seam = { axis: 'northing', value: ORIGIN.originNorthing - 1.5 };
  const owned = seamOwnership(raster, seam);
  assert.deepEqual([...owned], [1, 1, 1, 0, 0, 0, 0, 0, 0], 'row 0 centres (n - 0.5) are north, row 1 centres (n - 1.5) sit ON the seam and go south');
  assert.throws(() => seamOwnership(raster, { axis: 'diagonal', value: 1 }), /seam must be/);
});

test('the window radius follows the declared parameters', () => {
  assert.equal(variableWindowRadius(0), 3);
  assert.equal(variableWindowRadius(10), 3);
  assert.equal(variableWindowRadius(20), 4);
  assert.equal(variableWindowRadius(60), 6);
  assert.equal(CROWN_PARAMETERS.minimumCandidateHeightMetres, 3);
});

test('planted crowns are recovered as maxima, grown, measured and classified as individuals', () => {
  const heights = syntheticCanopy(TREES);
  const detection = medianFilter3x3(heights);
  const result = deriveCrownCandidates({ heights, detection, voids: voidMask(heights) });
  assert.equal(result.maxima.length, TREES.length, 'one apex per planted tree, no extras');
  /* maxima are found on the SMOOTHED copy, so their height is below the true
     apex; the crown's height is read from the unsmoothed raster and is exact */
  assert.ok(result.maxima[0].height < 25 && result.maxima[0].height > 20);
  assert.ok(Math.abs(result.crowns[0].heightMetres - 25) < 0.05, 'tallest crown first, at its true apex height');
  for (const tree of TREES) {
    const crown = result.crowns.find(c => Math.hypot(c.apex.easting - tree.easting, c.apex.northing - tree.northing) < 1.5);
    assert.ok(crown, `tree at ${tree.easting},${tree.northing} was detected`);
    assert.ok(Math.abs(crown.heightMetres - tree.height) < 0.05, `height ${crown.heightMetres} vs ${tree.height}`);
    /* the Dalponte core stops near 45% of the apex, about 0.7 of the drip
       line on a rounded profile; the extent pass recovers the drip line */
    assert.ok(crown.coreRadiusMetres < tree.radius, `core ${crown.coreRadiusMetres} inside the drip line ${tree.radius}`);
    assert.ok(Math.abs(crown.radiusMetres - tree.radius) < 0.75, `radius ${crown.radiusMetres} vs ${tree.radius}`);
    assert.ok(crown.extentCells >= crown.cells);
    assert.ok(Math.hypot(crown.centroid.easting - tree.easting, crown.centroid.northing - tree.northing) < 1.0, 'centroid near the apex for a symmetric crown');
    assert.equal(crown.representation, 'individual', `${crown.standReasons.join(',')}`);
    assert.ok(crown.compactness > 0.5);
    assert.ok(crown.prominenceMetres > 2);
    assert.equal(crown.touchesRasterEdge, false);
    assert.equal(crown.touchesVoid, false);
  }
  /* determinism: byte-identical labels and identical crowns on a second run */
  const again = deriveCrownCandidates({ heights, detection, voids: voidMask(heights) });
  assert.deepEqual([...again.labels], [...result.labels]);
  assert.deepEqual(again.crowns, result.crowns);
});

test('two overlapping crowns become stand structure, not two confident individuals', () => {
  const pair = [
    { easting: 697050.5, northing: 7025150.5, height: 20, radius: 4 },
    { easting: 697054.5, northing: 7025150.5, height: 19, radius: 4 },
  ];
  const heights = syntheticCanopy(pair);
  const detection = medianFilter3x3(heights);
  const result = deriveCrownCandidates({ heights, detection });
  assert.ok(result.crowns.length >= 1 && result.crowns.length <= 2);
  assert.ok(result.crowns.every(crown => crown.representation === 'stand' || crown.separationMetres === null || crown.separationMetres < 0.5),
    'touching crowns are not both confident individuals');
});

test('excluded cells and voids block detection and growth; ownership stops a crown at the seam', () => {
  const heights = syntheticCanopy(TREES.slice(0, 1));
  const detection = medianFilter3x3(heights);
  const exclude = new Uint8Array(heights.values.length).fill(1);
  assert.equal(detectLocalMaxima(detection, { excludeMask: exclude }).length, 0);
  const maxima = detectLocalMaxima(detection);
  assert.equal(maxima.length, 1);
  /* a seam one metre south of the apex: the crown may not grow across it */
  const seam = { axis: 'northing', value: TREES[0].northing - 1 };
  const ownership = seamOwnership(heights, seam);
  const labels = growCrowns(detection, maxima, { ownership });
  const crowns = crownStatistics(heights, labels, maxima, { ownership });
  for (let row = 0; row < heights.height; row++) {
    for (let column = 0; column < heights.width; column++) {
      const index = row * heights.width + column;
      if (labels[index] === 0) assert.equal(ownership[index], ownership[maxima[0].index]);
    }
  }
  assert.equal(crowns[0].ownership, 1);
  assert.ok(crowns[0].equivalentRadiusMetres < TREES[0].radius, 'the half crown is smaller than the whole one');
});

test('confidence exposes its terms and respects the declared reference density', () => {
  const heights = syntheticCanopy(TREES.slice(0, 1));
  const detection = medianFilter3x3(heights);
  const { crowns } = deriveCrownCandidates({ heights, detection });
  const strong = crownConfidence(crowns[0], { pulseDensityPerSquareMetre: 1.5, seamDistanceMetres: 100, tileEdgeDistanceMetres: 100, independentAgreement: 1, captureAgeYears: 0 });
  const weak = crownConfidence(crowns[0], { pulseDensityPerSquareMetre: 0.3, seamDistanceMetres: 2, tileEdgeDistanceMetres: 2, independentAgreement: 0, captureAgeYears: 8 });
  assert.ok(strong.confidence > weak.confidence);
  assert.ok(strong.confidence <= 1 && weak.confidence >= 0);
  assert.equal(strong.terms.density, 1);
  assert.equal(weak.terms.density, 0.2);
  assert.ok(Object.keys(strong.terms).length >= 7);
  const classified = classifyCrowns(crowns);
  assert.equal(classified[0].nearestCrownId, null);
});
