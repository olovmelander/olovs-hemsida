import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyObPlacementReview, OB_REVIEW_PATH } from './apply-ob-placement.mjs';

const review = JSON.parse(fs.readFileSync(new URL('./ob-placement-review.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(review);

test('reviewed road edges preserve pixel coordinates and do not create physical stakes or modify terrain', () => {
  const model = { holes: [{ n: 1, tee: [2, 3] }], water: [{ level: 12.7 }], seaLevel: 0 };
  const before = structuredClone(model);
  assert.deepEqual(applyObPlacementReview(model, review), { boundarySegments: 6, observedWhiteStakes: 0 });
  assert.deepEqual(model.holes, before.holes);
  assert.deepEqual(model.water, before.water);
  assert.equal(model.seaLevel, before.seaLevel);
  assert.deepEqual(model.marking, []);
  for (let i = 0; i < model.outOfBounds.lines.length; i++) {
    const line = model.outOfBounds.lines[i];
    assert.equal(line.virtual, true);
    assert.equal(line.completeBoundary, false);
    assert.equal(line.kind, 'asphalt-edge');
    assert.deepEqual(line.line.map(([x, z]) => [x + 677700.5, 6586399.5 - z]), review.boundaries[i].lineEpsg3006);
  }
});

test('pixel transform mismatch and property boundaries are rejected before any mutation', () => {
  for (const corrupt of [r => { r.boundaries.at(-1).lineEpsg3006[0][0] += 3; },
    r => { r.boundaries.at(-1).kind = 'property-boundary'; },
    r => { r.boundaries.at(-1).completeBoundary = true; }]) {
    const input = fresh(), model = { marking: [{ c: 'r', pts: [[0, 1]] }] }, before = structuredClone(model);
    corrupt(input);
    assert.throws(() => applyObPlacementReview(model, input), /Lidingo OB review/);
    assert.deepEqual(model, before);
  }
});

test('one observed stake stays one point, unrelated markings survive and reapplication is idempotent', () => {
  const input = fresh(), boundary = input.boundaries[0];
  input.stakes.push({ ...boundary, id: 'observed-stake-test', kind: 'white-stake', observation: 'individual-visible-stake',
    lineEpsg3006: undefined, sourcePixelLine: undefined,
    pointEpsg3006: boundary.lineEpsg3006[0], sourcePixelPoint: boundary.sourcePixelLine[0] });
  const existing = { c: 'r', pts: [[2, 3], [4, 5]] }, model = { marking: [existing] };
  applyObPlacementReview(model, input);
  const first = structuredClone(model);
  applyObPlacementReview(model, input);
  assert.deepEqual(model, first);
  assert.deepEqual(model.marking[0], existing);
  assert.equal(model.marking[1].sourceReview, OB_REVIEW_PATH);
  assert.equal(model.marking[1].pts.length, 1);
  input.stakes[0].observation = 'equally-spaced-along-boundary';
  assert.throws(() => applyObPlacementReview({}, input), /individually observed/);
});

test('unresolved markers remain in the review without acquiring physical coordinates', () => {
  assert.deepEqual(review.stakes, []);
  assert.ok(review.unresolved.some(record => record.kind === 'white-stakes' && [1, 2, 5, 6].every(n => record.holes.includes(n))));
  assert.ok(review.unresolved.some(record => record.kind === 'fence' && record.holes.includes(10)));
});
