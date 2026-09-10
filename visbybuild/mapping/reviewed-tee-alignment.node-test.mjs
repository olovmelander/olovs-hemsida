import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedTeeAlignment, teeAlignmentPixel } from './reviewed-tee-alignment.mjs';
import { local } from '../frame.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const review = read('./tee-alignment-review-2026-09-09.json');
const geometry = read('./geometry.json');
function baseline() {
  const value = structuredClone(geometry);
  for (const entry of review.holes) {
    const hole = value.holes[entry.n - 1];
    hole.tees.pads = structuredClone(entry.baseline.pads);
    hole.line = structuredClone(entry.baseline.line);
    hole.tees.references = Object.fromEntries(entry.references.filter(r => r.oldAuthored).map(r => [r.tee, r.oldAuthored]));
    delete hole.tees.referenceReview;
  }
  return value;
}

test('native-image tee review is reproducible, idempotent and limited to reviewed tee geometry', () => {
  const before = baseline(), after = applyReviewedTeeAlignment(before);
  assert.deepEqual(applyReviewedTeeAlignment(after), after);
  assert.equal(after.holes.reduce((sum, h) => sum + h.tees.pads.length, 0), 59);
  assert.deepEqual(after.scenery, before.scenery);
  for (const h of after.holes) {
    const previous = before.holes[h.n - 1];
    assert.deepEqual(h.line.slice(1), previous.line.slice(1));
    assert.deepEqual(h.green, previous.green);
    assert.deepEqual(h.fairway, previous.fairway);
    assert.deepEqual(h.bunkers, previous.bunkers);
    for (const ref of review.holes[h.n - 1].references) {
      if (ref.status === 'source-corroborated') {
        assert.ok(pointInPoly(...local(h.tees.references[ref.tee]), h.tees.pads[ref.targetPadIndex].ring.map(local)));
      } else assert.deepEqual(ref.targetLocal, ref.oldLocal);
    }
  }
  assert.deepEqual(after.holes[11].tees.pads, []);
  assert.equal(Object.keys(after.holes[11].tees.references).length, 0);
  assert.deepEqual(review.holes.filter(h => h.updateRouteStart).map(h => h.n), [2, 6, 10, 11]);
});

test('stale geometry and source hashes cannot silently overwrite later review work', () => {
  let bad = baseline(); bad.holes[1].tees.pads[0].ring[0][0] += 2;
  assert.throws(() => applyReviewedTeeAlignment(bad), /physical pad 0 changed/);
  bad = baseline(); bad.holes[1].line[1][0] += 2;
  assert.throws(() => applyReviewedTeeAlignment(bad), /later route changed/);
  const changed = structuredClone(review); changed.sourceReviews[0].sha256 = '0'.repeat(64);
  assert.throws(() => applyReviewedTeeAlignment(baseline(), changed), /source review changed/);
});

test('numbered pad identity, native pixel coordinates and unresolved retention are enforced', () => {
  let changed = structuredClone(review);
  changed.holes[1].references[0].targetPadIndex = 0;
  assert.throws(() => applyReviewedTeeAlignment(baseline(), changed), /outside its numbered platform/);
  changed = structuredClone(review);
  changed.holes[1].pads[0].pixels[0][0] += 2;
  assert.throws(() => applyReviewedTeeAlignment(baseline(), changed), /ring/);
  changed = structuredClone(review);
  const unresolved = changed.holes[2].references.find(r => r.status === 'retained-unresolved');
  unresolved.targetLocal[0]++; unresolved.target[0]++;
  assert.throws(() => applyReviewedTeeAlignment(baseline(), changed), /unresolved reference must not move/);
  assert.throws(() => teeAlignmentPixel(review.holes[0].sourceImage, [-1, 1]), /outside source image/);
});
