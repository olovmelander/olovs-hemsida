import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ORIGIN, M_PER_LAT, M_PER_LON, pointInPoly } from '../lib.mjs';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { applyReviewedOrthophoto, orthophotoPointEpsg3006, orthophotoPoint,
  orthophotoRing, verifyOrthophotoSources } from './reviewed-orthophoto.mjs';

// Synthetic traces test mechanics only; they are never accepted course geometry.
const square = [[10, 10], [90, 10], [90, 90], [10, 90], [10, 10]];
const trace = id => ({ id, sourceKey: 'test-window', ringPixels: structuredClone(square) });
function fixture() {
  const source = { horizontalCrs: 'EPSG:3006', sha256: 'a'.repeat(64), requestSha256: 'b'.repeat(64),
    sourceIds: ['synthetic-test-only'], width: 10000, height: 10000,
    geoTransform: [696700, 0.16, 0, 7025800, 0, -0.16], boundsEpsg3006: [696700, 7024200, 698300, 7025800] };
  const model = { version: 1, origin: { ...ORIGIN }, mPerLat: M_PER_LAT, mPerLon: Math.round(M_PER_LON * 100) / 100,
    card: { teeNames: ['Vit', 'Gul', 'Röd', 'Orange'], provisional: false },
    holes: [{ n: 1, par: 4, idx: 15, t: [320, 305, 270, 235],
      line: [[0, 0], [10, -100]], lineLen: 100.5, lenDev: 0, teeSlide: 12, teePadDist: 30,
      green: { ring: [[0, 0], [10, 0], [0, 10]], c: [3, 3], prov: 'osm', area: 50 }, pin: [3, 3],
      fairway: { rings: [structuredClone(square)], prov: 'osm' },
      tees: { pads: [{ ring: structuredClone(square), cx: 50, cz: 50 }],
        marks: [320, 305, 270, 235].map((m, i) => ({ c: [i, 0], b: 0, m, shore: { metres: 4 } })) },
      bunkers: [{ ring: structuredClone(square), prov: 'osm' }],
      elev: { tee: 68.1, green: 71.4, rise: 3.3 } }],
    water: [{ id: 'existing-lake', ring: structuredClone(square), level: 42, laserLevelRH2000: 65, name: 'Test lake' }],
    infra: { paths: [{ id: 'old-path', line: [[0, 0], [2, 2]], surface: 'gravel' }] } };
  const review = { schemaVersion: 1, groundId: 'puttom', sources: { 'test-window': source }, holes: [] };
  return { model, review };
}

test('pixel edges and centres are explicit, and the exact projection agrees with the runtime over the course', () => {
  const { review } = fixture();
  assert.deepEqual(orthophotoPointEpsg3006(review, 'test-window', [0, 0]), [696700, 7025800]);
  assert.deepEqual(orthophotoPointEpsg3006(review, 'test-window', [0.5, 0.5]), [696700.08, 7025799.92]);
  const origin = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006;
  const pixel = [(origin.easting - 696700) / 0.16, (7025800 - origin.northing) / 0.16];
  assert.ok(Math.hypot(...orthophotoPoint(review, 'test-window', pixel)) < 0.01, 'PROJ legacy origin stays within one centimetre');
  const migration = JSON.parse(fs.readFileSync(new URL('../../geo_data/course-v2/puttom/migration/course-model.epsg3006.json', import.meta.url)));
  const bridge = legacyGridBridge(PUTTOM_PREVIEW_CONFIG.legacyFrame);
  let worst = 0, unrotatedWorst = 0;
  for (const hole of migration.geometry.holes) for (const [e, n] of [...hole.line, ...hole.green.ring, ...hole.fairway.rings.flat()]) {
    const actual = orthophotoPoint(review, 'test-window', [(e - 696700) / 0.16, (7025800 - n) / 0.16]);
    const grid = [e - origin.easting, origin.northing - n];
    const bridged = bridge.toLegacy(...grid);
    worst = Math.max(worst, Math.hypot(actual[0] - bridged[0], actual[1] - bridged[1]));
    unrotatedWorst = Math.max(unrotatedWorst, Math.hypot(actual[0] - grid[0], actual[1] - grid[1]));
  }
  assert.ok(worst < 0.16, `runtime deviation ${worst} stays below one native image pixel`);
  assert.ok(unrotatedWorst > 20, 'a translation-only bridge would visibly misalign the course');
});

test('adoption updates surfaces, route targets and tee cameras idempotently while keeping the card and measured levels', () => {
  const { model, review } = fixture(), original = structuredClone(model);
  review.holes = [{ n: 1, green: { ...trace('green'), referencePixels: [50, 50] },
    tees: [{ ...trace('tee'), replaceIndex: 0, numberedSourceAssetId: 'synthetic-numbered-plan',
      cameraReferencesPixels: { 'tee-61': [20, 20], 'tee-57': [30, 30] } }],
    fairways: [{ ...trace('fairway'), replaceIndex: 0 }],
    bunkers: { replaceAll: true, sourceKey: 'test-window', accepted: [trace('bunker-1'), trace('bunker-2')] } }];
  review.water = [{ ...trace('lake'), replaceId: 'existing-lake' }];
  review.paths = [{ id: 'path', sourceKey: 'test-window', linePixels: [[0, 0], [20, 20]], replaceId: 'old-path' }];
  const result = applyReviewedOrthophoto(model, review), hole = result.holes[0];
  assert.deepEqual(model, original, 'input is never mutated');
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
  assert.deepEqual(hole.t, original.holes[0].t);
  assert.equal(hole.par, 4); assert.equal(hole.idx, 15);
  assert.deepEqual(hole.tees.marks.map(m => m.m), hole.t);
  assert.deepEqual(result.card, model.card);
  assert.deepEqual(hole.elev, model.holes[0].elev);
  assert.deepEqual(hole.line[0], hole.tees.marks[0].c);
  assert.deepEqual(hole.line.at(-1), hole.green.c);
  assert.deepEqual(hole.pin, hole.green.c);
  assert.ok(pointInPoly(...hole.tees.marks[0].c, hole.tees.pads[0].ring));
  assert.equal(hole.tees.marks[0].sourcePadId, hole.tees.pads[0].id);
  assert.equal(hole.tees.marks[1].sourcePadId, hole.tees.pads[0].id);
  assert.equal(hole.tees.marks[0].platformBoundaryReviewed, true);
  assert.equal(hole.tees.marks[0].shore, undefined);
  assert.equal(hole.bunkers.length, 2);
  assert.equal(hole.fairway.rings.length, 1);
  assert.equal(result.water[0].level, 42);
  assert.equal(result.water[0].laserLevelRH2000, 65);
  assert.equal(result.infra.paths[0].surface, 'gravel');
  assert.equal(hole.green.sourceSha256, review.sources['test-window'].sha256);
});

test('invalid sources, image positions and geometry cannot become accepted traces', () => {
  const { review } = fixture();
  for (const field of ['sha256', 'requestSha256', 'horizontalCrs']) {
    const bad = structuredClone(review); bad.sources['test-window'][field] = 'missing';
    assert.throws(() => orthophotoRing(bad, trace('bad')), /checked native/);
  }
  const affine = structuredClone(review); affine.sources['test-window'].geoTransform[0] += 1;
  assert.throws(() => orthophotoRing(affine, trace('bad')), /disagrees/);
  const outside = trace('outside'); outside.ringPixels[1] = [10001, 20];
  assert.throws(() => orthophotoRing(review, outside), /coordinates/);
  assert.throws(() => orthophotoRing(review, { ...trace('open'), ringPixels: square.slice(0, -1) }), /closed/);
  assert.throws(() => orthophotoRing(review, { ...trace('flat'), ringPixels: [[1, 1], [2, 2], [3, 3], [1, 1]] }), /area/);
  assert.throws(() => orthophotoRing(review, { ...trace('crossed'), ringPixels: [[0, 0], [90, 90], [90, 0], [0, 80], [0, 0]] }), /self-intersections/);
});

test('stale replacements and tee identities fail; an explicitly reviewed absence can remove obsolete bunkers', () => {
  const { model, review } = fixture();
  review.holes = [{ n: 1, tees: [{ ...trace('tee'), replaceIndex: 99 }] }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /stale/);
  review.holes = [{ n: 1, tees: [{ ...trace('tee'), cameraReferencesPixels: { 'tee-61': [50, 50] } }] }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /numbered/);
  review.holes[0].tees[0].numberedSourceAssetId = 'test-plan';
  review.holes[0].tees[0].cameraReferencesPixels['tee-61'] = [95, 95];
  assert.throws(() => applyReviewedOrthophoto(model, review), /leaves/);
  review.holes = [{ n: 1, bunkers: { replaceAll: true, sourceKey: 'test-window', accepted: [] } }];
  assert.equal(applyReviewedOrthophoto(model, review).holes[0].bunkers.length, 0);
  review.holes[0].bunkers.sourceKey = 'unknown';
  assert.throws(() => applyReviewedOrthophoto(model, review), /checked native/);
});

test('adoption verifies actual cached image bytes and pins the recorded affine', t => {
  const { review } = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puttom-orthophoto-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic image payload for hash verification, not a real orthophoto');
  const source = review.sources['test-window'];
  source.sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dir, 'test-window.tif'), bytes);
  const sidecar = { ...source, sources: source.sourceIds.map(id => ({ id })) };
  fs.writeFileSync(path.join(dir, 'test-window.json'), JSON.stringify(sidecar));
  assert.deepEqual(verifyOrthophotoSources(review, { sourceDirectory: dir }), ['test-window']);
  source.sources = [{ id: source.sourceIds[0], capturedAt: '2022-07-03T07:37:52Z' }];
  assert.throws(() => verifyOrthophotoSources(review, { sourceDirectory: dir }), /capture timestamp/);
  delete source.sources;
  fs.appendFileSync(path.join(dir, 'test-window.tif'), 'tampered');
  assert.throws(() => verifyOrthophotoSources(review, { sourceDirectory: dir }), /image SHA-256/);
  sidecar.geoTransform[0] += 1;
  fs.writeFileSync(path.join(dir, 'test-window.json'), JSON.stringify(sidecar));
  assert.throws(() => verifyOrthophotoSources(review, { sourceDirectory: dir }), /disagrees|changed geoTransform/);
});

test('bunker reassignment preserves original indices during replacements and remains idempotent', () => {
  const { model, review } = fixture();
  const original = structuredClone(model.holes[0].bunkers[0].ring);
  model.holes[0].bunkers.push({ ring: original.map(([x, z]) => [x + 100, z]) });
  review.holes = [{ n: 1, bunkers: [{ ...trace('retained-local-bunker'), replaceIndex: 1 }],
    removeBunkers: [{ id: 'reassigned-away', sourceKey: 'test-window', ringLegacy: original }] }];
  const result = applyReviewedOrthophoto(model, review);
  assert.equal(result.holes[0].bunkers.length, 1);
  assert.equal(result.holes[0].bunkers[0].reviewId, 'retained-local-bunker');
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
});

test('visible interior references preserve unverified platform boundaries and reject ambiguous identity', () => {
  const { model, review } = fixture();
  const camera = { id: 'visible-camera', sourceKey: 'test-window', teeKey: 'tee-61',
    pointPixels: [500, 500], numberedSourceAssetId: 'synthetic-numbered-plan',
    geometryBasis: 'visible-interior-anchor', existingPadIndex: 0,
    reviewNotes: 'Synthetic test: visible interior with an obscured perimeter.' };
  review.holes = [{ n: 1, cameraReferences: [camera] }];
  const result = applyReviewedOrthophoto(model, review), hole = result.holes[0];
  assert.deepEqual(hole.tees.pads, model.holes[0].tees.pads);
  assert.deepEqual(hole.tees.marks[0].c, orthophotoPoint(review, 'test-window', camera.pointPixels));
  assert.deepEqual(hole.line[0], hole.tees.marks[0].c);
  assert.deepEqual(hole.t, model.holes[0].t);
  assert.equal(hole.tees.marks[0].platformBoundaryReviewed, false);
  assert.equal(hole.tees.marks[0].sourcePadId, undefined);
  assert.equal(hole.tees.marks[0].sourceSha256, review.sources['test-window'].sha256);
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
  const bad = structuredClone(review);
  bad.holes[0].cameraReferences[0].numberedSourceAssetId = null;
  assert.throws(() => applyReviewedOrthophoto(model, bad), /numbered/);
  bad.holes[0].cameraReferences[0] = { ...camera, existingPadIndex: 99 };
  assert.throws(() => applyReviewedOrthophoto(model, bad), /stale/);
  bad.holes[0].cameraReferences[0] = { ...camera, geometryBasis: 'card-distance' };
  assert.throws(() => applyReviewedOrthophoto(model, bad), /visible interior/);
  bad.holes[0].cameraReferences[0] = { ...camera };
  bad.holes[0].tees = [{ ...trace('paired-platform'), numberedSourceAssetId: 'test-plan',
    cameraReferencesPixels: { 'tee-61': [50, 50] } }];
  assert.throws(() => applyReviewedOrthophoto(model, bad), /unique numbered/);
});
