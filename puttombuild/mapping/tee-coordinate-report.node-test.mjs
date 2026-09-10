import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTeeCoordinateReport } from './tee-coordinate-report.mjs';
import { orthophotoPoint } from './reviewed-orthophoto.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';

// A compact in-memory frame fixture exercises the actual conversion and report
// gates without a generated pack, acquisition cache or current course rebuild.
function fixture() {
  const origin = { lat: 63.2992, lon: 18.9413 };
  const review = { schemaVersion: 1, groundId: 'puttom', sources: {
    'fixture-native': { horizontalCrs: 'EPSG:3006', sha256: 'a'.repeat(64), requestSha256: 'b'.repeat(64),
      sourceIds: ['fixture-orthophoto'], sources: [{ id: 'fixture-orthophoto', capturedAt: '2024-06-27T15:07:43Z' }],
      width: 1000, height: 1000, geoTransform: [697418.021708, .16, 0, 7025077.739459, 0, -.16] },
  }, holes: [{ n: 1, tees: [{ id: 'fixture-reviewed-pad', sourceKey: 'fixture-native',
    cameraReferencesPixels: { 'tee-61': [500, 500] }, numberedSourceAssetId: 'fixture-numbered-plan' }] }] };
  const observed = orthophotoPoint(review, 'fixture-native', [500, 500]);
  const holes = Array.from({ length: 18 }, (_, i) => {
    const n = i + 1, id = `fixture-platform-${n}`, t = [350, 330, 300, 240];
    const marks = [[0, 0], [0, 2], [0, 4], [0, 6]].map((c, j) => ({ c, b: 0, m: t[j] }));
    if (n === 1) { marks[0].c = [...observed]; marks[0].sourcePadId = id; }
    return { n, t, line: [[...marks[0].c], [0, 100]], pin: [0, 100],
      tees: { inferPads: false, marks, pads: [{ id,
        ...(n === 1 ? { reviewId: 'fixture-reviewed-pad' } : {}),
        ring: [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]] }] } };
  });
  const model = { origin, mPerLat: 111320, mPerLon: 50019.58, holes, infra: {} };
  const pack = { header: { slug: 'puttom', GEO: { origin: { ...origin }, mPerLon: model.mPerLon } },
    model: structuredClone(model) };
  const routing = { holes: holes.map(h => ({ number: h.n, line: h.line.map(([x, z]) =>
    latLonToSweref99Tm(origin.lat - z / model.mPerLat, origin.lon + x / model.mPerLon)) })) };
  return { model, review, pack, routing };
}

test('coordinate report checks all 72 in-memory references without acquisition assets', () => {
  const report = makeTeeCoordinateReport(fixture());
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  assert.equal(report.rows.length, 72);
  assert.equal(report.summary.maximumPackPositionErrorMetres, 0);
  assert.equal(report.summary.maximumBootPositionErrorMetres, 0);
  assert.deepEqual(report.rows[0].sourceCapturedAt, ['2024-06-27T15:07:43Z']);
});

test('a shifted serialized tee fails even when its decorative pair still fits the platform', () => {
  const input = fixture();
  input.pack.model.holes[0].tees.marks[0].c[0] += .5;
  const report = makeTeeCoordinateReport(input);
  assert.equal(report.passed, false);
  assert.equal(report.rows[0].serializedPositionErrorMetres, .5);
  assert.ok(report.issues.some(i => i.gate === 'pack-position' && i.hole === 1 && i.tee === 'tee-61'));
  assert.ok(!report.issues.some(i => i.gate === 'physical-markers'));
});

test('a reviewed paired reference must retain its source platform binding through serialization', () => {
  const input = fixture();
  delete input.pack.model.holes[0].tees.marks[0].sourcePadId;
  const report = makeTeeCoordinateReport(input);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some(i => i.gate === 'marker-platform-binding' && i.hole === 1));
  assert.equal(report.rows[0].serializedPositionErrorMetres, 0);
});

test('back reference, authoring route start and published route start are checked independently', () => {
  const input = fixture();
  input.model.holes[0].line[0][0] += .25;
  input.routing.holes[1].line[0][0] += .25;
  const report = makeTeeCoordinateReport(input);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some(i => i.gate === 'route-start' && i.hole === 1));
  assert.ok(report.issues.some(i => i.gate === 'published-routing' && i.hole === 2));
  assert.equal(report.rows[0].serializedPositionErrorMetres, 0);
});
