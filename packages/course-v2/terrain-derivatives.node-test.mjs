import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUNKER_CANDIDATE_DEFAULTS,
  detectBunkerCandidates,
  fillDepressions,
  localRelief,
  matchCandidatesToReference,
  reliefSeparability,
  ruggednessGrid,
  slopeGrid,
  summarizeRaster,
} from './terrain-derivatives.mjs';

const ORIGIN_EASTING = 650000;
const ORIGIN_NORTHING = 6640000;

function grid(width, height, fill, spacing = 1) {
  const heights = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) heights[row * width + column] = fill(column, row);
  }
  return {
    width, height, heights,
    sampleSpacingMetres: spacing,
    originEasting: ORIGIN_EASTING,
    originNorthing: ORIGIN_NORTHING,
  };
}

/** A plane tilted by a known gradient, with a bowl cut into it. */
function courseLike({ bowls = [], gradient = 0.02, size = 80 } = {}) {
  return grid(size, size, (column, row) => {
    let height = 40 + column * gradient;
    for (const bowl of bowls) {
      const distance = Math.hypot(column - bowl.column, row - bowl.row);
      if (distance < bowl.radius) {
        height -= bowl.depth * (1 - (distance / bowl.radius) ** 2);
      }
    }
    return height;
  });
}

test('slope reproduces a known plane gradient and ignores the border', () => {
  const slope = slopeGrid(grid(9, 9, column => 40 + column * 0.25));
  assert.ok(Number.isNaN(slope[0]), 'border has no 3x3 neighbourhood');
  for (let row = 1; row < 8; row++) {
    for (let column = 1; column < 8; column++) {
      assert.ok(Math.abs(slope[row * 9 + column] - 0.25) < 1e-9, `slope at ${column},${row}`);
    }
  }
});

test('ruggedness separates smooth ground from a noisy surface', () => {
  const smooth = summarizeRaster(ruggednessGrid(grid(20, 20, column => 40 + column * 0.05)));
  const noisy = summarizeRaster(ruggednessGrid(
    grid(20, 20, (column, row) => 40 + ((column * 7 + row * 13) % 5) * 0.4),
  ));
  assert.ok(smooth.mean < 0.05, `smooth mean ${smooth.mean}`);
  assert.ok(noisy.mean > 0.4, `noisy mean ${noisy.mean}`);
});

test('depression filling raises a bowl to its rim and leaves a slope untouched', () => {
  const plane = grid(20, 20, column => 40 + column * 0.1);
  const filledPlane = fillDepressions(plane);
  for (let index = 0; index < filledPlane.length; index++) {
    assert.ok(Math.abs(filledPlane[index] - plane.heights[index]) < 1e-9, 'a slope holds no water');
  }

  const bowl = courseLike({ bowls: [{ column: 40, row: 40, radius: 5, depth: 1.2 }] });
  const filled = fillDepressions(bowl);
  const centre = 40 * bowl.width + 40;
  assert.ok(filled[centre] - bowl.heights[centre] > 1.0, 'the bowl centre fills to near its full depth');
  const outside = 10 * bowl.width + 10;
  assert.ok(Math.abs(filled[outside] - bowl.heights[outside]) < 1e-9, 'ground outside is unchanged');
});

test('nodata is an opening, not a wall', () => {
  /* A hollow that drains into a nodata gap holds no water: treating the gap as
     a rim would invent a depression wherever the source has a hole. */
  const open = courseLike({ bowls: [{ column: 40, row: 40, radius: 5, depth: 1.2 }] });
  for (let row = 35; row <= 45; row++) open.heights[row * open.width + 45] = Number.NaN;
  const filled = fillDepressions(open);
  const centre = 40 * open.width + 40;
  assert.ok(filled[centre] - open.heights[centre] < 1.0, 'the gap lets the hollow drain');
});

test('bunker candidates find cut hollows and reject the ground around them', () => {
  const scene = courseLike({
    bowls: [
      { column: 20, row: 20, radius: 4, depth: 1.1 },
      { column: 55, row: 30, radius: 3, depth: 0.8 },
      /* too shallow to be a bunker */
      { column: 30, row: 60, radius: 4, depth: 0.15 },
      /* far too deep and wide -- a pond or a quarry, not a bunker */
      { column: 62, row: 62, radius: 14, depth: 6 },
    ],
  });
  const result = detectBunkerCandidates(scene);
  assert.equal(result.settings.minimumDepthMetres, BUNKER_CANDIDATE_DEFAULTS.minimumDepthMetres);
  const found = result.candidates;
  assert.equal(found.length, 2, `expected two candidates, got ${JSON.stringify(found)}`);
  const centres = found.map(candidate => [
    Math.round(candidate.easting - ORIGIN_EASTING),
    Math.round(ORIGIN_NORTHING - candidate.northing),
  ]).sort((left, right) => left[0] - right[0]);
  assert.deepEqual(centres, [[20, 20], [55, 30]]);
  for (const candidate of found) {
    assert.ok(candidate.compactness > 0.35 && candidate.compactness <= 1.0);
    /* The detected region is the part lying deeper than the depth threshold
       below its own rim, so it is always SMALLER than the sand outline a
       surveyor would draw -- the floor of the hollow, not its edge. */
    assert.ok(candidate.areaSquareMetres >= BUNKER_CANDIDATE_DEFAULTS.minimumAreaSquareMetres);
    assert.ok(candidate.maximumDepthMetres >= BUNKER_CANDIDATE_DEFAULTS.minimumDepthMetres);
  }
});

test('reference matching is one-to-one and reports both error directions', () => {
  const candidates = [
    { easting: 100, northing: 100 },
    { easting: 140, northing: 100 },
    { easting: 400, northing: 400 },
  ];
  const reference = [
    { easting: 103, northing: 101 },
    { easting: 137, northing: 104 },
    { easting: 900, northing: 900 },
  ];
  const score = matchCandidatesToReference({ candidates, reference, toleranceMetres: 12 });
  assert.equal(score.matched, 2);
  assert.equal(score.unmatchedCandidates, 1);
  assert.equal(score.unmatchedReference, 1);
  assert.equal(score.recall, 0.6667);
  assert.equal(score.precision, 0.6667);
  assert.ok(score.medianDistanceMetres <= 6);

  /* Two references crowding one candidate may claim it only once. */
  const crowded = matchCandidatesToReference({
    candidates: [{ easting: 0, northing: 0 }],
    reference: [{ easting: 1, northing: 0 }, { easting: 2, northing: 0 }],
    toleranceMetres: 12,
  });
  assert.equal(crowded.matched, 1);
  assert.equal(crowded.unmatchedReference, 1);
});

test('local relief measures how much lower the middle is than its surroundings', () => {
  const flat = grid(60, 60, () => 40);
  assert.ok(Math.abs(localRelief(flat, { easting: ORIGIN_EASTING + 30, northing: ORIGIN_NORTHING - 30 })) < 1e-9);

  const bowl = courseLike({ bowls: [{ column: 30, row: 30, radius: 5, depth: 1.0 }], gradient: 0, size: 60 });
  const depth = localRelief(bowl, { easting: ORIGIN_EASTING + 30, northing: ORIGIN_NORTHING - 30 });
  assert.ok(depth > 0.9 && depth <= 1.01, `bowl relief ${depth}`);

  /* Tolerant of a few metres of registration error, which is the whole point:
     it is asked about features whose recorded position is approximate. */
  const offset = localRelief(bowl, { easting: ORIGIN_EASTING + 33, northing: ORIGIN_NORTHING - 28 });
  assert.ok(offset > 0.8, `relief three metres off centre ${offset}`);
});

test('separability refuses to call a signal detectable when ordinary ground reaches it', () => {
  /* Shallow features on rough ground: real but indistinguishable. */
  const rough = grid(200, 200, (column, row) =>
    40 + Math.sin(column / 3) * 0.5 + Math.cos(row / 4) * 0.5);
  for (const [column, row] of [[50, 50], [120, 60], [80, 140]]) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.hypot(dx, dy) <= 3) rough.heights[(row + dy) * 200 + column + dx] -= 0.4;
    }
  }
  const reference = [[50, 50], [120, 60], [80, 140]].map(([column, row]) => ({
    easting: ORIGIN_EASTING + column, northing: ORIGIN_NORTHING - row,
  }));
  const control = [];
  for (let index = 0; index < 60; index++) {
    control.push({
      easting: ORIGIN_EASTING + 20 + (index * 37) % 160,
      northing: ORIGIN_NORTHING - (20 + (index * 53) % 160),
    });
  }
  const noisy = reliefSeparability({ grid: rough, reference, control });
  assert.equal(noisy.separable, false, 'rough ground reaches past the features');
  assert.ok(noisy.control.p90 >= noisy.reference.median);

  /* The same features on smooth ground are decisively separable. */
  const smooth = grid(200, 200, () => 40);
  for (const [column, row] of [[50, 50], [120, 60], [80, 140]]) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.hypot(dx, dy) <= 3) smooth.heights[(row + dy) * 200 + column + dx] -= 0.4;
    }
  }
  const clean = reliefSeparability({ grid: smooth, reference, control });
  assert.equal(clean.separable, true);
  assert.ok(clean.medianExcessMetres > 0.3);
});

test('validators refuse a malformed grid', () => {
  assert.throws(() => slopeGrid({ width: 2, height: 2, heights: new Float64Array(4), sampleSpacingMetres: 1 }),
    /at least 3x3/);
  assert.throws(() => slopeGrid({ width: 4, height: 4, heights: new Float64Array(9), sampleSpacingMetres: 1 }),
    /width \* height/);
  assert.throws(() => slopeGrid({ width: 4, height: 4, heights: new Float64Array(16), sampleSpacingMetres: 0 }),
    /sampleSpacingMetres/);
});
