import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ORIGIN, M_PER_LAT, M_PER_LON, pointInPoly } from '../lib.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { ANGSO_V2_CONFIG } from '../../apps/golf/src/engine/v2-angso-config.mjs';
import { applyReviewedOrthophoto, orthophotoPointEpsg3006, orthophotoPoint,
  orthophotoRing, verifyOrthophotoSources } from './reviewed-orthophoto.mjs';

// These invented polygons verify mechanics, never real course acceptance.
const square = (x = 100, y = 100, size = 80) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const trace = (id, ringPixels = square()) => ({ id, sourceKey: 'test-window', ringPixels });
const set = (...accepted) => ({ replaceAll: true, sourceKey: 'test-window', accepted });

function fixture() {
  const source = { horizontalCrs: 'EPSG:3006', sha256: 'a'.repeat(64), requestSha256: 'b'.repeat(64),
    sourceIds: ['synthetic-test-only'], width: 20000, height: 20000,
    geoTransform: [604000, 0.16, 0, 6607500, 0, -0.16], boundsEpsg3006: [604000, 6604300, 607200, 6607500] };
  const review = { schemaVersion: 1, groundId: 'angso', reviewedAt: '2026-09-09', sources: { 'test-window': source }, holes: [] };
  const pixel = p => orthophotoPoint(review, 'test-window', p);
  const model = { version: 1, origin: { ...ORIGIN }, mPerLat: M_PER_LAT,
    mPerLon: Math.round(M_PER_LON * 100) / 100, frame: 'local metres about ORIGIN; north -z, east +x',
    card: { teeNames: ['Vit', 'Gul', 'Bla', 'Rod', 'Orange'], provisional: false },
    holes: [{ n: 1, par: 4, idx: 10, t: [360, 340, 310, 280, 240],
      line: [pixel([45, 140]), pixel([500, 500])], lineLen: 100, teeSlide: 20, lenDev: 0,
      green: { ring: square().map(pixel), c: pixel([140, 140]), area: 163, prov: 'osm' },
      pin: pixel([140, 140]), fairway: { rings: [square().map(pixel)], prov: 'sat' },
      tees: { pads: [{ ring: square().map(pixel) }], marks: [[45, 140], [130, 130], [140, 140], [150, 150], [1000, 140]]
        .map((p, i) => ({ c: pixel(p), b: 0, m: [360, 340, 310, 280, 240][i] })) },
      bunkers: [{ ring: square().map(pixel), prov: 'osm' }], elev: { tee: 2, green: 4, rise: 2 } }],
    water: [{ id: 'old-lake', ring: square().map(pixel), level: 0.76, isLake: true, isSea: false, name: 'Test lake' }], infra: {} };
  return { model, review, pixel };
}

test('native pixel coordinates round-trip through the stored frame without an image offset', () => {
  const { review } = fixture();
  assert.deepEqual(orthophotoPointEpsg3006(review, 'test-window', [0, 0]), [604000, 6607500]);
  assert.deepEqual(orthophotoPointEpsg3006(review, 'test-window', [0.5, 0.5]), [604000.08, 6607499.92]);
  const migration = JSON.parse(fs.readFileSync(new URL('../../geo_data/course-v2/angso/migration/course-model.epsg3006.json', import.meta.url)));
  const bridge = legacyGridBridge(ANGSO_V2_CONFIG.legacyFrame), origin = ANGSO_V2_CONFIG.legacyOriginEpsg3006;
  let worst = 0, bridgeWorst = 0, unrotatedWorst = 0, count = 0;
  for (const hole of migration.geometry.holes) for (const [e, n] of [...hole.line, ...hole.green.ring, ...hole.fairway.rings.flat()]) {
    const local = orthophotoPoint(review, 'test-window', [(e - 604000) / 0.16, (6607500 - n) / 0.16]);
    const actual = latLonToSweref99Tm(ORIGIN.lat - local[1] / M_PER_LAT, ORIGIN.lon + local[0] / (Math.round(M_PER_LON * 100) / 100));
    worst = Math.max(worst, Math.hypot(actual[0] - e, actual[1] - n));
    const grid = [e - origin.easting, origin.northing - n], bridged = bridge.toLegacy(...grid);
    bridgeWorst = Math.max(bridgeWorst, Math.hypot(local[0] - bridged[0], local[1] - bridged[1]));
    unrotatedWorst = Math.max(unrotatedWorst, Math.hypot(local[0] - grid[0], local[1] - grid[1]));
    count++;
  }
  assert.ok(count > 500);
  assert.ok(worst < 0.005, `projection roundtrip ${worst} m`);
  assert.ok(bridgeWorst < 0.16, `runtime bridge ${bridgeWorst} m stays below one native pixel`);
  assert.ok(unrotatedWorst > 10, 'a translation-only authoring frame visibly misaligns Angso');
});

function guideFixture() {
  const f = fixture(), { review } = f;
  review.teeEvidenceAssets = { 'guide-1': { hole: 1, role: 'club-linked-schematic', sha256: 'c'.repeat(64) } };
  review.holes = [{ n: 1, tees: set(trace('physical-tee')), fairways: set(trace('fairway', square(800, 100, 400))),
    teeReferences: [null, [125, 130], [145, 140], [160, 150], [1010, 240]].map((pixel, index) => ({ index,
      sourceKey: 'test-window', pixel, padReviewId: index === 0 || index === 4 ? null : 'physical-tee',
      kind: index === 4 ? 'fairway' : 'platform', ...(pixel ? {} : { status: 'unresolved', candidatePixel: [150, 150] }),
      evidence: { assetIds: ['guide-1', 'test-window'], note: 'Synthetic correspondence test.', confidence: pixel ? 'high' : 'unresolved' } })) }];
  return f;
}

test('guide references use explicit native pixels, keep fairway tees and retain unresolved originals', () => {
  const { model, review, pixel } = guideFixture(), result = applyReviewedOrthophoto(model, review);
  const hole = result.holes[0];
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
  assert.deepEqual(hole.tees.marks[0].c, model.holes[0].tees.marks[0].c);
  assert.equal(hole.tees.marks[0].orthophotoReference.kind, 'unresolved-guide-tee-reference');
  assert.deepEqual(hole.tees.marks[4].c, pixel([1010, 240]));
  assert.equal(hole.tees.marks[4].referenceSurfaceKind, 'fairway');
  assert.equal(hole.tees.pads.length, 1, 'fairway reference creates no synthetic deck');
  assert.notDeepEqual(hole.tees.marks[1].c, hole.tees.marks[2].c);
  assert.deepEqual(hole.t, model.holes[0].t);
  assert.equal(result.orthophotoReview.summary.guideTeeReferences, 4);
  assert.equal(result.orthophotoReview.summary.unresolvedTeeReferences, 1);
  assert.equal(result.orthophotoReview.summary.provisionalTeeReferences, 0);
  assert.ok(!JSON.stringify(hole.tees.marks).includes('candidatePixel'), 'diagnostic source pixels never enter model geometry');
});

test('guide reference validation rejects wrong evidence, guessed surfaces and duplicate colour anchors', () => {
  for (const corrupt of [
    r => { r.teeEvidenceAssets['guide-1'].hole = 2; },
    r => { r.teeEvidenceAssets['guide-1'].sha256 = 'invalid'; },
    r => { r.holes[0].teeReferences[1].evidence.assetIds = ['test-window']; },
    r => { r.holes[0].teeReferences[4].pixel = [700, 700]; },
    r => { r.holes[0].teeReferences[1].padReviewId = 'wrong-pad'; },
    r => { r.holes[0].teeReferences[2].pixel = [125, 130]; },
    r => { r.holes[0].teeReferences[0].pixel = [150, 150]; },
    r => { r.holes[0].teeReferences[1].index = 2; },
  ]) {
    const { model, review } = guideFixture(); corrupt(review);
    assert.throws(() => applyReviewedOrthophoto(model, review));
  }
});

test('complete replacements preserve card/levels and remain idempotent while documenting uncertain tee identities', () => {
  const { model, review, pixel } = fixture(), original = structuredClone(model);
  review.holes = [{ n: 1, green: trace('green', square(450, 450)),
    fairways: set(trace('fairway', square(200, 200, 150))),
    tees: set(trace('tee-a'), trace('tee-b', square(950, 100))),
    bunkers: set(trace('bunker', square(550, 400))) }];
  review.water = [{ ...trace('water', square(600, 700)), replaceId: 'old-lake' }];
  const result = applyReviewedOrthophoto(model, review), hole = result.holes[0];
  assert.deepEqual(model, original);
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
  assert.deepEqual(hole.t, original.holes[0].t); assert.deepEqual(result.card, model.card);
  assert.equal(hole.par, original.holes[0].par); assert.equal(hole.idx, original.holes[0].idx);
  assert.equal(hole.tees.inferPads, false); assert.equal(result.infra.preserveMappedBoundaries, true);
  assert.ok(hole.tees.pads.every(p => p.preserveTerrain === true));
  assert.equal(hole.tees.marks[0].orthophotoReference.kind, 'provisional-virtual-tee-reference');
  assert.equal(hole.tees.marks[0].orthophotoReference.identityStatus, 'unverified-colour-association');
  assert.ok(hole.tees.marks[0].orthophotoReference.distanceMetres > 10);
  assert.deepEqual(hole.tees.marks[0].orthophotoReference.originalPosition, pixel([45, 140]));
  assert.deepEqual(hole.tees.marks[1].c, original.holes[0].tees.marks[1].c, 'an existing in-pad reference does not move');
  assert.equal(hole.tees.marks[1].orthophotoReference.kind, 'legacy-reference-inside-reviewed-pad');
  assert.ok(hole.tees.marks.every(m => hole.tees.pads.some(p => pointInPoly(...m.c, p.ring))));
  assert.deepEqual(hole.line[0], hole.tees.marks[0].c); assert.deepEqual(hole.line.at(-1), hole.green.c);
  assert.deepEqual(hole.pin, hole.green.c); assert.equal(hole.teeSlide, undefined);
  assert.notEqual(hole.lineLen, hole.t[0], 'image geometry is not stretched to the scorecard');
  assert.equal(hole.fairway.rings.length, 1); assert.equal(hole.bunkers.length, 1);
  assert.equal(result.water[0].level, 0.76); assert.equal(result.water[0].isLake, true);
  assert.equal(result.water[0].isSea, false); assert.equal(result.water[0].name, 'Test lake');
  assert.equal(hole.green.sourceSha256, review.sources['test-window'].sha256);
});

test('distant orange and white virtual references retain their coordinates instead of borrowing a physical platform', () => {
  const { model, review, pixel } = fixture();
  model.holes[0].tees.marks[0].c = pixel([20, 140]);
  model.holes[0].line[0] = pixel([20, 140]);
  review.holes = [{ n: 1, tees: set(trace('only-known-platform')) }];
  const result = applyReviewedOrthophoto(model, review), hole = result.holes[0];
  for (const index of [0, 4]) {
    const mark = hole.tees.marks[index], before = model.holes[0].tees.marks[index];
    assert.deepEqual(mark.c, before.c);
    assert.equal(mark.orthophotoReference.kind, 'unresolved-virtual-tee-reference');
    assert.equal(mark.orthophotoReference.selectedPadReviewId, null);
    assert.equal(mark.orthophotoReference.identityStatus, 'unsupported-platform-association');
    assert.equal(mark.orthophotoReference.positionStatus, 'retained-unverified-virtual-reference');
    assert.ok(mark.orthophotoReference.nearestPadEdgeDistanceMetres > 10);
    assert.equal(mark.orthophotoReference.distanceMetres, 0);
  }
  assert.equal(result.orthophotoReview.summary.unresolvedTeeReferences, 2);
  assert.equal(hole.tees.pads.length, 1, 'unresolved references never manufacture a turf platform');
  assert.equal(hole.tees.inferPads, false);
  assert.deepEqual(hole.line[0], model.holes[0].line[0], 'white route start does not jump to an unsupported platform');
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
});

test('the provisional association limit measures the polygon edge, rather than its remote centroid', () => {
  const { model, review, pixel } = fixture();
  const longPad = [[100,100],[1100,100],[1100,180],[100,180],[100,100]];
  model.holes[0].tees.marks[0].c = pixel([45,140]);
  review.holes = [{ n: 1, tees: set(trace('long-platform', longPad)) }];
  const result = applyReviewedOrthophoto(model, review), ref = result.holes[0].tees.marks[0].orthophotoReference;
  assert.equal(ref.kind, 'provisional-virtual-tee-reference');
  assert.ok(ref.nearestPadEdgeDistanceMetres < 10);
  assert.ok(ref.distanceMetres > 80, 'long platform centroid is not the association threshold');
});

test('source-affine, frame, stale identifiers and invalid or duplicate geometry are refused', () => {
  const { model, review } = fixture();
  for (const field of ['sha256', 'requestSha256', 'horizontalCrs']) {
    const bad = structuredClone(review); bad.sources['test-window'][field] = 'missing';
    assert.throws(() => orthophotoRing(bad, trace('bad')), /checked native/);
  }
  const badFrame = structuredClone(model); badFrame.origin.lon += 0.01;
  assert.throws(() => applyReviewedOrthophoto(badFrame, review), /immutable/);
  const badScale = structuredClone(model); badScale.mPerLon += 0.001;
  assert.throws(() => applyReviewedOrthophoto(badScale, review), /immutable/);
  const badAffine = structuredClone(review); badAffine.sources['test-window'].geoTransform[0] += 1;
  assert.throws(() => applyReviewedOrthophoto(model, badAffine), /disagrees/);
  for (const ring of [square().slice(0, -1), [[0, 0], [50, 50], [0, 50], [50, 0], [0, 0]],
    [[0, 0], [50, 0], [20, 0], [20, 50], [0, 0]], square(19999, 100),
    [[0, 0], [50, 0], [50, 50], [0, 0], [0, 50], [0, 0]]]) {
    assert.throws(() => orthophotoRing(review, trace('bad', ring)), /closed|intersections|overlapping|coordinates|repeated/);
  }
  review.water = [{ ...trace('water'), replaceId: 'stale' }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /stale/); delete review.water;
  review.holes = [{ n: 19, green: trace('unknown') }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /Unknown/);
  review.holes = [{ n: 1, green: trace('duplicate'), bunkers: set(trace('duplicate')) }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /Duplicate/);
  review.holes = [{ n: 1, fairways: { replaceAll: false, accepted: [] } }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /complete/);
  review.holes = [{ n: 1, bunkers: set(), fairways: set() }];
  const empty = applyReviewedOrthophoto(model, review);
  assert.equal(empty.holes[0].bunkers.length, 0); assert.equal(empty.holes[0].fairway.rings.length, 0);
  review.holes = [{ n: 1, tees: set() }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /at least one/);
});

test('reviewed numbered references need their association evidence and remain inside their physical pad', () => {
  const { model, review, pixel } = fixture();
  const tee = { ...trace('tee'), cameraReferencesPixels: { '0': [120, 120] } };
  review.holes = [{ n: 1, tees: set(tee) }];
  assert.throws(() => applyReviewedOrthophoto(model, review), /numbered/);
  tee.numberedSourceAssetId = 'synthetic-numbered-plan';
  const result = applyReviewedOrthophoto(model, review);
  assert.deepEqual(result.holes[0].line[0], pixel([120, 120]));
  assert.equal(result.holes[0].tees.marks[0].orthophotoReference.identityStatus, 'source-associated');
  assert.deepEqual(applyReviewedOrthophoto(result, review), result);
  tee.cameraReferencesPixels['0'] = [190, 190];
  assert.throws(() => applyReviewedOrthophoto(model, review), /leaves/);
});

test('cached image bytes and georeferencing are verified before adoption', t => {
  const { review } = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angso-orthophoto-test-'));
  // This is the resolved temporary directory just created by this test.
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic hash fixture; not actual imagery'), source = review.sources['test-window'];
  source.sha256 = createHash('sha256').update(bytes).digest('hex');
  delete source.sourceIds; source.sources = [{ id: 'synthetic-test-only' }];
  fs.writeFileSync(path.join(dir, 'test-window.tif'), bytes);
  const sidecar = structuredClone(source);
  fs.writeFileSync(path.join(dir, 'test-window.json'), JSON.stringify(sidecar));
  assert.deepEqual(verifyOrthophotoSources(review, { sourceDirectory: dir }), ['test-window']);
  fs.appendFileSync(path.join(dir, 'test-window.tif'), 'changed');
  assert.throws(() => verifyOrthophotoSources(review, { sourceDirectory: dir }), /image SHA-256/);
  sidecar.geoTransform[0] += 1;
  fs.writeFileSync(path.join(dir, 'test-window.json'), JSON.stringify(sidecar));
  assert.throws(() => verifyOrthophotoSources(review, { sourceDirectory: dir }), /changed geoTransform/);
});
