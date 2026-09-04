import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySimilarity,
  collectCoordinatePairs,
  fitSimilarity,
  localToLatLon,
  localToProjected,
  migrationResiduals,
} from './migration.mjs';

test('coordinate collection excludes two-value scorecard metadata', () => {
  const model = {
    card: { slope: { tee: [71.2, 130] } },
    holes: [{ t: [115, 95], line: [[1, 2], [3, 4]], green: { c: [5, 6] } }],
  };
  const result = collectCoordinatePairs(model);
  assert.equal(result.coordinates.length, 3);
  assert.equal(result.ignored.length, 2);
  assert.deepEqual(result.coordinates.map(value => value.path), [
    'holes.[].line.[]',
    'holes.[].line.[]',
    'holes.[].green.c',
  ]);
});

test('coordinate collection fails closed for a new numeric-pair field', () => {
  assert.throws(
    () => collectCoordinatePairs({ mystery: [1, 2] }),
    /Unclassified numeric pairs.*mystery/,
  );
});

test('legacy local coordinates invert to latitude/longitude', () => {
  const frame = {
    originWgs84: { latitude: 60, longitude: 15 },
    metresPerLatitude: 100_000,
    metresPerLongitude: 50_000,
  };
  assert.deepEqual(localToLatLon([500, -200], frame), {
    latitude: 60.002,
    longitude: 15.01,
  });
});

test('projected local coordinates use exact EPSG:3006 axis translation', () => {
  assert.deepEqual(localToProjected([469.6, -444.9], {
    projectedOriginEpsg3006: { easting: 448975.5, northing: 6536024.5 },
  }), {
    easting: 449445.1,
    northing: 6536469.4,
  });
});

test('similarity fit recovers translation, rotation and scale', () => {
  const expected = {
    a: 1.0002 * Math.cos(0.01),
    b: 1.0002 * Math.sin(0.01),
    translateX: 2.5,
    translateZ: -4.25,
  };
  const local = [[0, 0], [100, 0], [0, 80], [-50, -20]];
  const samples = local.map(([localX, localZ]) => {
    const target = applySimilarity({ localX, localZ }, expected);
    return { localX, localZ, targetX: target.x, targetZ: target.z };
  });
  const actual = fitSimilarity(samples);
  assert.ok(Math.abs(actual.a - expected.a) < 1e-12);
  assert.ok(Math.abs(actual.b - expected.b) < 1e-12);
  assert.ok(Math.abs(actual.translateX - expected.translateX) < 1e-12);
  assert.ok(Math.abs(actual.translateZ - expected.translateZ) < 1e-12);
});

test('migration residual report separates direct movement from shape error', () => {
  const local = [[0, 0], [100, 0], [0, 100]];
  const projected = local.map(([x, z]) => ({
    easting: 500_000 + 5 + x,
    northing: 6_700_000 - (-3 + z),
  }));
  const result = migrationResiduals(local, projected, {
    easting: 500_000,
    northing: 6_700_000,
  });
  assert.ok(Math.abs(result.direct.rmseMetres - Math.hypot(5, -3)) < 1e-6);
  assert.ok(result.bestFitSimilarity.residuals.maxMetres < 1e-9);
});
