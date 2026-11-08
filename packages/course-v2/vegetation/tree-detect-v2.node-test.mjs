import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPits, interpolateLayer, pitFreeChm, PIT_FREE_DEFAULTS, rasterizeReturns, smoothChm } from './pit-free-chm.mjs';
import { circleIoU, convexHull, crownReturnMetrics, detectionScores, detectTreesV2, growCrownsSimultaneous, matchOneToOne, mergeShallowCrowns, TREE_DETECT_V2_DEFAULTS } from './tree-detect-v2.mjs';

const grid = (width, height, s = 0.5) => ({ minEasting: 0, maxNorthing: height * s, width, height, sampleSpacingMetres: s });

/* a deterministic LCG so the synthetic clouds are reproducible */
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Sparse returns over cone crowns: first returns on the crown surface, a share falling through to the ground. */
function syntheticCloud(g, crowns, { density = 1.8, throughShare = 0.25, seed = 7 } = {}) {
  const rand = random(seed);
  const area = g.width * g.height * g.sampleSpacingMetres ** 2;
  const n = Math.round(area * density);
  const x = new Float64Array(n), y = new Float64Array(n), hag = new Float32Array(n);
  const classification = new Uint8Array(n), returnNumber = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    x[i] = rand() * g.width * g.sampleSpacingMetres;
    y[i] = rand() * g.height * g.sampleSpacingMetres;
    let surface = 0;
    for (const c of crowns) {
      const d = Math.hypot(x[i] - c.e, y[i] - c.n);
      if (d < c.r) surface = Math.max(surface, c.h * (1 - 0.6 * (d / c.r)));
    }
    if (surface > 0 && rand() > throughShare) { hag[i] = surface * (0.9 + 0.1 * rand()); classification[i] = 1; }
    else { hag[i] = 0; classification[i] = 2; }
  }
  return { points: { count: n, x, y, classification, returnNumber }, hag };
}

test('a layer fills a cell enclosed by returns on all sides but not one outside a crown edge', () => {
  const g = grid(9, 9, 1);
  const raster = { max: new Float32Array(81).fill(Number.NaN), maxX: new Float64Array(81), maxY: new Float64Array(81) };
  const put = (c, r, h) => { const i = r * 9 + c; raster.max[i] = h; raster.maxX[i] = c + 0.5; raster.maxY[i] = 9 - r - 0.5; };
  /* a ring of tall returns around the centre cell (4, 4) */
  for (const [c, r] of [[3, 3], [5, 3], [3, 5], [5, 5]]) put(c, r, 12);
  const layer = interpolateLayer(g, raster, 10, { radiusMetres: 1.5, minimumQuadrants: 3 });
  assert.ok(Math.abs(layer.values[4 * 9 + 4] - 12) < 1e-6, 'enclosed cell takes the crown height');
  /* (7, 4) has returns only to its west: not inside the crown */
  assert.ok(Number.isNaN(layer.values[4 * 9 + 7]));
});

test('the pit pass lifts an isolated deep cell inside a crown and leaves open ground alone', () => {
  const g = grid(5, 5, 1);
  const values = new Float32Array(25).fill(15);
  values[12] = 2;
  values[0] = 0;
  const { values: out, changed } = fillPits(g, values, { minimumHeightMetres: 2, absoluteMetres: 1.5, relativeFraction: 0.25, passes: 2 });
  assert.equal(out[12], 15);
  assert.ok(changed >= 1);
  const flat = new Float32Array(25).fill(0.2);
  assert.equal(fillPits(g, flat).changed, 0);
});

test('a sparse cloud over a crown gives a pit-free surface whose maximum is the treetop', () => {
  const g = grid(40, 40);
  const crowns = [{ e: 10, n: 10, r: 4, h: 18 }];
  const { points, hag } = syntheticCloud(g, crowns, { density: 1.8, throughShare: 0.3 });
  const raster = rasterizeReturns(g, points, hag);
  const highest = raster.max;
  const result = pitFreeChm(g, raster, PIT_FREE_DEFAULTS);
  /* inside the crown core (2 m) no cell of the pit-free CHM falls below half the crown height */
  let coreCells = 0, coreLow = 0, rawLow = 0;
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const e = (c + 0.5) * 0.5, n = g.maxNorthing - (r + 0.5) * 0.5;
    if (Math.hypot(e - 10, n - 10) > 2) continue;
    coreCells++;
    const v = result.values[r * g.width + c];
    if (!(v >= 9)) coreLow++;
    if (!(highest[r * g.width + c] >= 9)) rawLow++;
  }
  assert.ok(coreCells > 40);
  assert.ok(rawLow > coreLow * 3, `raw surface has many more pits (${rawLow}) than the pit-free one (${coreLow})`);
  assert.ok(coreLow <= 2);
  let max = 0;
  for (const v of result.values) if (v > max) max = v;
  assert.ok(max <= 18 && max > 15);
});

test('smoothing keeps voids void and a constant surface constant', () => {
  const g = grid(6, 6);
  const values = new Float32Array(36).fill(7);
  values[3] = Number.NaN;
  const out = smoothChm(g, values, 0.6);
  assert.ok(Number.isNaN(out[3]));
  for (let i = 0; i < 36; i++) if (i !== 3) assert.ok(Math.abs(out[i] - 7) < 1e-5);
});

test('two separate crowns are two trees and a pitted crown is one tree', () => {
  const g = grid(60, 40);
  const crowns = [{ e: 8, n: 10, r: 3.5, h: 16 }, { e: 20, n: 10, r: 3, h: 12 }];
  const { points, hag } = syntheticCloud(g, crowns, { density: 2, throughShare: 0.3, seed: 11 });
  const raster = rasterizeReturns(g, points, hag);
  const chm = pitFreeChm(g, raster).values;
  const { crowns: found } = detectTreesV2(g, chm, { parameters: TREE_DETECT_V2_DEFAULTS });
  assert.equal(found.length, 2, `found ${found.length} trees`);
  for (const truth of crowns) {
    const nearest = Math.min(...found.map(c => Math.hypot(c.apex.easting - truth.e, c.apex.northing - truth.n)));
    assert.ok(nearest < 1, `apex within 1 m of the synthetic top (${nearest.toFixed(2)} m)`);
  }
});

test('one-to-one matching takes closest pairs first and never reuses a tree', () => {
  const reference = [{ easting: 0, northing: 0 }, { easting: 3, northing: 0 }];
  const predicted = [{ easting: 2.5, northing: 0 }, { easting: 10, northing: 0 }];
  const { matches, unmatchedReference, unmatchedPredicted } = matchOneToOne(reference, predicted, 4);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].ri, 1);
  assert.deepEqual(unmatchedReference, [0]);
  assert.deepEqual(unmatchedPredicted, [1]);
  const scores = detectionScores(9, 1, 3);
  assert.equal(scores.precision, 0.9);
  assert.equal(scores.recall, 0.75);
  assert.ok(Math.abs(scores.f1 - 0.818) < 1e-3);
});

test('circle overlap, hull and leaf-off return shares', () => {
  assert.equal(circleIoU({ easting: 0, northing: 0, radius: 2 }, { easting: 0, northing: 0, radius: 2 }), 1);
  assert.equal(circleIoU({ easting: 0, northing: 0, radius: 1 }, { easting: 5, northing: 0, radius: 1 }), 0);
  const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
  assert.equal(hull.length, 5);
  const g = grid(2, 1, 1);
  const labels = new Int32Array([0, -1]);
  const pts = { count: 4, column: [0, 0, 0, 1], row: [0, 0, 0, 0], hag: [10, 0, 6, 9], ground: [0, 1, 0, 0], returnNumber: [1, 1, 2, 1], intensity: [100, 50, 80, 90] };
  const metrics = crownReturnMetrics(g, labels, [{ id: 0, heightMetres: 10 }], pts).get(0);
  assert.equal(metrics.firstReturns, 2);
  assert.equal(metrics.firstCanopyShare, 0.5);
  assert.equal(metrics.groundShare, 0.333);
});

test('simultaneous growth keeps a shorter neighbour that tallest-first growth swallows', () => {
  /* two touching cones, 18 m and 12 m, apexes 5 m apart */
  const g = grid(40, 20);
  const values = new Float32Array(g.width * g.height);
  const cones = [{ e: 7, n: 5, r: 4, h: 18 }, { e: 12, n: 5, r: 3.5, h: 12 }];
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const e = (c + 0.5) * 0.5, n = g.maxNorthing - (r + 0.5) * 0.5;
    let v = 0;
    for (const k of cones) { const d = Math.hypot(e - k.e, n - k.n); if (d < k.r) v = Math.max(v, k.h * (1 - 0.5 * d / k.r)); }
    values[r * g.width + c] = v;
  }
  const params = { ...TREE_DETECT_V2_DEFAULTS, smoothingSigmaMetres: 0.25, maximumCrownRadiusMetres: 10, minimumProminenceMetres: 0 };
  const simultaneous = detectTreesV2(g, values, { parameters: params });
  const sequential = detectTreesV2(g, values, { parameters: params, growth: 'sequential' });
  assert.equal(simultaneous.crowns.length, 2);
  assert.ok(sequential.crowns.length < simultaneous.crowns.length, 'tallest-first growth loses the shorter crown');
  const short = simultaneous.crowns.find(c => c.heightMetres < 13);
  assert.ok(Math.hypot(short.apex.easting - 12, short.apex.northing - 5) < 0.6);
  /* every label belongs to a seed and no cell exceeds its seed's apex */
  const labels = growCrownsSimultaneous(g, simultaneous.smoothed, simultaneous.maxima, {});
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) assert.ok(simultaneous.smoothed[i] <= simultaneous.maxima[labels[i]].height + 1e-6);
});

test('a shallow bump on a broad crown merges, a real neighbour with a dip stays', () => {
  const g = grid(30, 10, 1);
  /* a 1-D profile: crown A peak 15 at x=5, a bump 14.6 at x=8 (saddle 14.2), then a dip to 6 and crown B peak 12 at x=20 */
  const profile = x => (x <= 6 ? 15 - Math.abs(x - 5) * 0.4 : x <= 10 ? (x === 8 ? 14.6 : x === 7 ? 14.2 : x === 9 ? 14.0 : 13) : x <= 15 ? 6 + (15 - x) * 1.2 : 12 - Math.abs(x - 20) * 0.6);
  const surface = new Float32Array(g.width * g.height);
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) surface[r * g.width + c] = profile(c) - Math.abs(r - 5) * 0.05;
  const maxima = [{ column: 5, row: 5, index: 5 * 30 + 5, height: surface[5 * 30 + 5] }, { column: 20, row: 5, index: 5 * 30 + 20, height: surface[5 * 30 + 20] }, { column: 8, row: 5, index: 5 * 30 + 8, height: surface[5 * 30 + 8] }];
  const labels = growCrownsSimultaneous(g, surface, maxima, { seedFraction: 0.3, crownFraction: 0.3 });
  const merged = mergeShallowCrowns(g, surface, labels, maxima, 1);
  assert.equal(merged, 1);
  assert.ok(!labels.includes(2), 'the bump no longer owns cells');
  assert.ok(labels.includes(1), 'the separate crown keeps its cells');
});
