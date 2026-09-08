import assert from 'node:assert/strict';
import test from 'node:test';
import { measurePlatform, validateEvidenceFrame } from './tee-platform-survey.mjs';

function fixture(heightAt, { width = 41, height = 41, ring = [[-8, -8], [8, -8], [8, 8], [-8, 8]] } = {}) {
  const e0 = 640000, n1 = 6636000, heights = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) heights[y * width + x] = heightAt(x - 20, 20 - y);
  return { grid: { width, height, e0, n1, heights }, feature: { id: 'review-tee', hole: 1, ring: ring.map(([e, n]) => [e0 + 20 + e, n1 - 20 + n]) } };
}

test('a drainage plane retains its 5% slope without being mistaken for uneven terrain', () => {
  const { feature, grid } = fixture((e, n) => 30 + .03 * e + .04 * n), out = measurePlatform(feature, grid);
  assert.equal(out.fullPlane.slopePercent, 5);
  assert.equal(out.fullPlane.residuals.rmseM, 0);
  assert.equal(out.corePlane.residuals.rmseM, 0);
  assert.equal(out.centre.sampledHeightRH2000M, 30);
  assert.equal(out.edgeCoreComparison.edgeMinusCoreMeanResidualM, 0);
  assert.equal(out.coverage.interior.complete, true);
  assert.equal(out.automaticAdoption, false);
  assert.equal(out.measurementStatus, 'measured-evidence-only');
});

test('a bowl with zero net slope exposes curvature and raised edges', () => {
  const { feature, grid } = fixture((e, n) => 30 + .012 * (e * e + n * n)), out = measurePlatform(feature, grid);
  assert.equal(out.fullPlane.slopePercent, 0);
  assert(out.fullPlane.residuals.rmseM > .3);
  assert(out.edgeCoreComparison.edgeMinusCoreMeanResidualM > .5);
  assert.equal(out.centre.sampledHeightRH2000M, 30);
  assert(out.centre.fittedHeightRH2000M > 30.5);
});

test('a local mound is detected even when a symmetric ring has no fitted slope', () => {
  const { feature, grid } = fixture((e, n) => 30 + 1.2 * Math.exp(-(e * e + n * n) / 8)), out = measurePlatform(feature, grid);
  assert.equal(out.fullPlane.slopePercent, 0);
  assert(out.fullPlane.residuals.maxAbsoluteM > 1);
  assert(out.edgeCoreComparison.edgeMinusCoreMeanResidualM < -.2);
});

test('NoData is counted and no complete flatness claim survives a partial fit', () => {
  const { feature, grid } = fixture(() => 30);
  grid.heights[20 * grid.width + 20] = NaN;
  const out = measurePlatform(feature, grid);
  assert.equal(out.coverage.interior.noDataSamples, 1);
  assert.equal(out.coverage.interior.finiteSamples, out.coverage.interior.expectedSamples - 1);
  assert.equal(out.coverage.interior.complete, false);
  assert.equal(out.measurementStatus, 'incomplete-terrain-coverage');
  assert.equal(out.centre.sampledHeightRH2000M, null);
  assert.equal(out.fullPlane.residuals.rmseM, 0);
  assert(out.warnings.some(warning => warning.includes('finite samples')));
});

test('coverage denominator includes the part of a polygon outside the loaded DTM', () => {
  const { feature, grid } = fixture(() => 30, { ring: [[-25, -8], [-15, -8], [-15, 8], [-25, 8]] }), out = measurePlatform(feature, grid);
  assert.equal(out.coverage.interior.expectedSamples, 11 * 17);
  assert.equal(out.coverage.interior.outsideGridSamples, 5 * 17);
  assert.equal(out.coverage.interior.finiteSamples, 6 * 17);
  assert.equal(out.measurementStatus, 'incomplete-terrain-coverage');
});

test('a thin strip of collinear samples cannot supply a terrain plane', () => {
  const { feature, grid } = fixture(() => 30, { ring: [[-8, -.2], [8, -.2], [8, .2], [-8, .2]] }), out = measurePlatform(feature, grid);
  assert.equal(out.coverage.interior.finiteSamples, 17);
  assert.equal(out.fullPlane, null);
  assert.equal(out.corePlane, null);
  assert.equal(out.measurementStatus, 'insufficient-spatial-samples');
});

test('sub-cell and fully missing polygons do not become zero-residual flat pads', () => {
  const tiny = fixture(() => 30, { ring: [[.1, .1], [.3, .1], [.3, .3], [.1, .3]] });
  const sparse = measurePlatform(tiny.feature, tiny.grid);
  assert.equal(sparse.coverage.interior.expectedSamples, 0);
  assert.equal(sparse.coverage.interior.finiteFraction, null);
  assert.equal(sparse.fullPlane, null);
  const missing = fixture(() => NaN), out = measurePlatform(missing.feature, missing.grid);
  assert.equal(out.fullPlane, null);
  assert.equal(out.centre.sampledHeightRH2000M, null);
  assert.equal(out.edgeCoreComparison, null);
});

test('outer terrace relief is measured against the inner drainage plane without modifying heights', () => {
  const { feature, grid } = fixture((e, n) => 30 + .02 * e - (Math.max(Math.abs(e), Math.abs(n)) > 8 ? .8 : 0));
  const before = grid.heights.slice(), original = JSON.stringify(feature), out = measurePlatform(feature, grid);
  assert.equal(out.fullPlane.slopePercent, 2);
  assert.equal(out.fullPlane.residuals.rmseM, 0);
  assert.equal(out.edgeCoreComparison.exteriorMinusCoreMeanResidualM, -.8);
  assert.deepEqual(grid.heights, before);
  assert.equal(JSON.stringify(feature), original);
});

test('rotated sloping pad preserves east/north slope and winding does not change measurements', () => {
  const { feature, grid } = fixture((e, n) => 30 + .03 * e - .04 * n, { ring: [[-9, -2], [-2, 9], [9, 2], [2, -9]] });
  const first = measurePlatform(feature, grid), second = measurePlatform({ ...feature, ring: [...feature.ring].reverse() }, grid);
  assert.equal(first.fullPlane.slopePercent, 5);
  assert.equal(first.fullPlane.eastGradientMPerM, .03);
  assert.equal(first.fullPlane.northGradientMPerM, -.04);
  assert.equal(first.fullPlane.residuals.rmseM, 0);
  assert.deepEqual(first.coverage, second.coverage);
  assert.deepEqual(first.fullPlane, second.fullPlane);
});

test('fractional centre height requires every positively weighted DTM corner', () => {
  const { feature, grid } = fixture((e, n) => 30 + .03 * e + .04 * n, { ring: [[-7.75, -7.75], [8.25, -7.75], [8.25, 8.25], [-7.75, 8.25]] });
  const before = measurePlatform(feature, grid);
  assert.equal(before.centre.sampledHeightRH2000M, 30.0175);
  grid.heights[19 * grid.width + 21] = NaN;
  const after = measurePlatform(feature, grid);
  assert.equal(after.centre.sampledHeightRH2000M, null);
  assert.equal(after.centre.fittedHeightRH2000M, 30.0175);
  assert.equal(after.coverage.interior.noDataSamples, 1);
});

test('a crossing outline cannot produce deceptively plausible terrain statistics', () => {
  const { feature, grid } = fixture(() => 30, { ring: [[-5, -5], [5, 5], [-5, 5], [5, -4]] });
  assert.throws(() => measurePlatform(feature, grid), /self-intersecting/);
});

test('declared evidence frame rejects nearby but displaced local rings before projection', () => {
  const model = { origin: { lat: 59.839, lon: 17.4952 }, mPerLat: 111320, mPerLon: 55930.68 };
  const evidence = { frame: structuredClone(model), features: [{ id: 'tee-1', hole: 1, ring: [[0, 0], [10, 0], [10, 10], [0, 10]] }] };
  assert.equal(validateEvidenceFrame(evidence, model), true);
  for (const altered of [
    { ...model, origin: { ...model.origin, lat: 59.841 } },
    { ...model, origin: { ...model.origin, lon: 17.4972 } },
    { ...model, mPerLat: 111000 },
    { ...model, mPerLon: 56000 },
    { origin: model.origin, mPerLat: model.mPerLat },
    null,
  ]) assert.throws(() => validateEvidenceFrame({ ...evidence, frame: altered }, model), /evidence frame/);
  assert.equal(validateEvidenceFrame({ features: evidence.features }, model), false);
  assert.equal(validateEvidenceFrame(evidence.features, model), false);
});
