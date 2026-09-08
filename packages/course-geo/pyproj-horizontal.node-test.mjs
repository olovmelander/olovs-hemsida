import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { horizontalProjectionBackend, latLonToSweref99Tm, sweref99TmToLatLon, sha256Bytes } from './proj.mjs';
import { collectCoordinatePairs, localToLatLon } from './migration.mjs';

// Opt in with COURSE_GEO_PYPROJ_PYTHON=/path/to/python. Ordinary CI keeps cs2cs.
const optedIn = Boolean(process.env.COURSE_GEO_PYPROJ_PYTHON);
const adapter = { skip: optedIn ? false : 'explicit Python PROJ adapter not selected' };
const root = fileURLToPath(new URL('../../', import.meta.url));

test('horizontal backend identifies its actual implementation and axis policy', () => {
  const backend = horizontalProjectionBackend();
  assert.equal(backend.axisOrder, 'authority');
  assert.equal(backend.network, 'OFF');
  assert.equal(backend.scope, 'horizontal-only');
  if (optedIn) {
    assert.match(backend.implementation, /pyproj/);
    assert.match(backend.projVersion, /^\d+\.\d+\.\d+/);
    assert.equal(backend.alwaysXY, false);
  } else assert.equal(backend.implementation, 'PROJ cs2cs');
});

test('Python PROJ matches published SWEREF controls and inverse authority axes', adapter, () => {
  // Lantmateriet: Kontrollpunkter for SWEREF 99 TM (2007-11-20), also
  // independently pinned in proj-controls.node-test.mjs. Metres are rounded.
  const controls = [[55, 12.75, 6097106.672, 356083.438],
    [59, 19.5, 6548757.206, 758410.519], [69, 21, 7666089.698, 739639.195]];
  const geographic = controls.map(([latitude, longitude]) => ({ latitude, longitude }));
  const projected = latLonToSweref99Tm(geographic, { sourceCrs: 'EPSG:4619', decimals: 6 });
  projected.forEach(({ northing, easting }, i) => {
    assert.ok(Math.abs(northing - controls[i][2]) < .002);
    assert.ok(Math.abs(easting - controls[i][3]) < .002);
  });
  const inverse = sweref99TmToLatLon(projected, { targetCrs: 'EPSG:4619', decimals: 10 });
  inverse.forEach(({ latitude, longitude }, i) => {
    assert.ok(Math.abs(latitude - geographic[i].latitude) < 1e-9);
    assert.ok(Math.abs(longitude - geographic[i].longitude) < 1e-9);
  });
});

test('Python PROJ reproduces representative committed cs2cs migration coordinates', adapter, () => {
  const migration = JSON.parse(readFileSync(`${root}geo_data/course-v2/puttom/migration/course-model.epsg3006.json`, 'utf8'));
  assert.equal(migration.generator, 'course-geo/legacy-vector-migrator@1');
  const sourceBytes = readFileSync(`${root}${migration.source.path}`);
  assert.equal(sha256Bytes(sourceBytes), migration.source.sha256, 'fixture must be the source that cs2cs actually read');
  const source = JSON.parse(sourceBytes);
  const local = collectCoordinatePairs(source).coordinates;
  const target = collectCoordinatePairs(migration.geometry).coordinates;
  assert.equal(local.length, target.length);
  const indexes = Array.from({ length: 25 }, (_, i) => Math.floor(i * (local.length - 1) / 24));
  const projected = latLonToSweref99Tm(indexes.map(i => localToLatLon(local[i].pair, migration.source.localFrame)));
  projected.forEach(({ easting, northing }, i) => {
    assert.deepEqual([Number(easting.toFixed(3)), Number(northing.toFixed(3))], target[indexes[i]].pair);
  });
});
