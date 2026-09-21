import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTerrainDifference } from './terrain-difference.mjs';

test('terrain difference summary records magnitude and the worst geographic sample', () => {
  const report = summarizeTerrainDifference({
    level: { sampleSpacingMetres: 1 },
    read: { extent: { minEasting: 100, maxNorthing: 203 }, size: 4,
      values: Float32Array.from([0, 0, 0, 0, 0, 10.01, 10.2, 0, 0, 9.9, 12, 0, 0, 0, 0, 0]) },
    tiles: [{ id: 'l0-0-0', bounds: { minEasting: 101, maxNorthing: 202 },
      grid: { width: 2, height: 2, sampleSpacingMetres: 1, heightScaleMetres: 0.02 },
      heights: Float32Array.from([10, 10, 10, 10]) }],
    thresholdsMetres: [0.011, 0.5, 1],
  });
  assert.equal(report.samples, 4);
  assert.equal(report.withinQuantum, 1);
  assert.equal(report.outsideQuantum, 3);
  assert.equal(report.thresholdExceedances['0.011'], 3);
  assert.equal(report.thresholdExceedances['0.5'], 1);
  assert.equal(report.thresholdExceedances['1'], 1);
  assert(Math.abs(report.meanAbsoluteDifferenceMetres - 0.5775) < 1e-6);
  assert(Math.abs(report.rootMeanSquareDifferenceMetres - Math.sqrt(4.0501 / 4)) < 1e-6);
  assert.deepEqual(report.worstSample, {
    tileId: 'l0-0-0', row: 1, column: 1, easting: 102, northing: 201,
    baselineHeightRH2000: 10, candidateHeightRH2000: 12, differenceMetres: 2,
  });
});

test('terrain difference thresholds must be deterministic and increasing', () => {
  assert.throws(() => summarizeTerrainDifference({ level: {}, read: {}, tiles: [], thresholdsMetres: [1, 1] }),
    /increasing/);
});
