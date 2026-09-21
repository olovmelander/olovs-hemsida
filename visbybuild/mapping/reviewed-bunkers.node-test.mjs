import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedBunkers } from './reviewed-bunkers.mjs';
import { applyReviewedOrthophoto, orthophotoRing } from './reviewed-orthophoto.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { local } from '../frame.mjs';
import { inRing, ringSD, distToLine, smooth } from '../../apps/golf/src/engine/geom.js';
import { pointInBunker, bunkerSignedDistance } from '../../apps/golf/src/engine/bunker-geometry.mjs';
import { createClassifier, SURFACE } from '../../apps/golf/src/engine/surface.js';
import { buildGroundSurfaceFeatures } from '../../apps/golf/src/engine/surface-features.mjs';
import { rasterizeGroundAtlas } from '../../apps/golf/src/engine/atlas.js';
import { excludeReviewedStandCells } from './orthophoto-vegetation.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const review = read('./bunker-review-2026-09-21.json'), geometry = read('./geometry.json');
const model = read('../course-model.json');
const vectors = JSON.parse(inflateStream(readPack(fs.readFileSync(new URL('../../apps/golf/public/courses/visby/pack.bin', import.meta.url))).sv));
const rings = b => [b.ring, ...(b.innerRings ?? [])];

test('all 18 audited holes, including five H3 bunkers, survive historical regeneration', () => {
  assert.deepEqual(review.audit.map(h => h.hole), Array.from({ length: 18 }, (_, i) => i + 1));
  const current = applyReviewedBunkers(applyReviewedOrthophoto(geometry, read('./orthophoto-review-2026.json')));
  assert.deepEqual(current, geometry);
  assert.deepEqual(applyReviewedBunkers(current), current);
  assert.equal(current.holes[2].bunkers.length, 5);
  assert.equal(current.holes.reduce((sum, h) => sum + h.bunkers.length, 0), 81);
  assert.equal(current.scenery.bunkers.length, 15);
  for (const transfer of review.ownershipTransfers) {
    assert.ok(!current.scenery.bunkers.some(r => JSON.stringify(r) === JSON.stringify(transfer.ring)));
    assert.equal(current.holes.flatMap(h => h.bunkers).filter(b => b.reviewId === transfer.id).length, 1);
  }
});

test('accepted native-pixel outlines and islands survive canonical, local and packed coordinates', () => {
  let islands = 0;
  for (const entry of review.holes) for (const trace of entry.bunkers.accepted) {
    const source = review.sources[trace.sourceKey];
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(source.captureDate, null, 'public WMS does not prove the capture epoch');
    const canonical = orthophotoRing(review, trace);
    const index = geometry.holes[entry.n - 1].bunkers.findIndex(b => b.reviewId === trace.id);
    assert.ok(index >= 0);
    assert.deepEqual(geometry.holes[entry.n - 1].bunkers[index], canonical);
    const expected = rings(canonical).map(ring => ring.map(local));
    assert.deepEqual(rings(model.holes[entry.n - 1].bunkers[index]), expected);
    assert.deepEqual(rings(vectors.holes[entry.n - 1].bunkers[index]), expected);
    islands += canonical.innerRings?.length ?? 0;
  }
  assert.equal(islands, 3);
  const bad = structuredClone(review.holes.find(h => h.n === 8).bunkers.accepted.find(b => b.islandPixels));
  bad.islandPixels[0].pop();
  assert.throws(() => orthophotoRing(review, bad), /closed pixel ring/);
});

test('grass islands stay out of sand in atlas, fallback classifier and point queries', () => {
  const rect = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d],[a,b]];
  const bunker = { ring: rect(0,0,16,16), innerRings: [rect(4,4,12,12)] };
  const holes = [{ n: 3, line: [[0,0],[16,16]], bunkers: [bunker] }];
  const features = buildGroundSurfaceFeatures({ holes, model: { infra: { preserveMappedBoundaries: true } } });
  const raster = rasterizeGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 16, z1: 16 }, features, res: 1, classesOnly: true });
  assert.equal(raster.classes[2 * 16 + 2], SURFACE.SAND);
  assert.equal(raster.classes[8 * 16 + 8], SURFACE.ROUGH);
  const classify = createClassifier({ BI: { at: () => [bunker] }, ringSD, distToLine, smooth, HOLES: holes });
  assert.equal(classify(8,8).sand, 0);
  assert.equal(classify(2,2).sand, 1);
  assert.equal(pointInBunker(8,8,bunker,inRing), false);
  assert.equal(pointInBunker(2,2,bunker,inRing), true);
  assert.ok(bunkerSignedDistance(8,8,bunker,ringSD) > 0);
  const payload = new Uint8Array(4 * 4 * 4);
  for (let i = 3; i < payload.length; i += 4) payload[i] = 1;
  const result = excludeReviewedStandCells({ bounds: { minEasting: 0, maxEasting: 16, minNorthing: 0, maxNorthing: 16 },
    standField: { width: 4, height: 4, cellMetres: 4 } }, payload,
  [{ ...bunker, innerRings: [rect(2,2,14,14)], bounds: [0,0,16,16] }]);
  assert.equal(result.payload[(1*4+1)*4+3], 1, 'stand wholly inside a grass island is retained');
  assert.equal(result.payload[3], 5, 'stand touching sand is excluded');
});

test('the actual Visby atlas paints all five H3 bunkers and excludes the three grass islands', () => {
  const features = buildGroundSurfaceFeatures({ holes: vectors.holes, model: vectors });
  function interior(ring) {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    const x0 = Math.min(...xs), z0 = Math.min(...zs), dx = Math.max(...xs)-x0, dz = Math.max(...zs)-z0;
    let best = null, distance = 0;
    for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
      const p = [x0 + dx*i/30, z0 + dz*j/30], d = ringSD(...p, ring);
      if (d < distance) { best = p; distance = d; }
    }
    assert.ok(best && distance < -0.5, 'sample must lie clearly inside the source outline');
    return best;
  }
  const sample = ([x,z]) => rasterizeGroundAtlas({ CORE: { x0:x-32.125, z0:z-32.125, x1:x+32.125, z1:z+32.125 },
    features, res:.25, classesOnly:true }).classes[128*257+128];
  for (const bunker of vectors.holes[2].bunkers) assert.equal(sample(interior(bunker.ring)), SURFACE.SAND);
  let islands = 0;
  for (const hole of vectors.holes) for (const bunker of hole.bunkers) for (const ring of bunker.innerRings ?? []) {
    assert.notEqual(sample(interior(ring)), SURFACE.SAND, `H${hole.n} grass island`); islands++;
  }
  assert.equal(islands, 3);
});
