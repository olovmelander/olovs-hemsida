import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyTeePlacementReview } from './apply-tee-placement-review.mjs';
import { applyObPlacementReview } from './apply-ob-placement-review.mjs';
import { inRing, rightOf, ringSD, centroidOf } from '../../apps/golf/src/engine/geom.js';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
const read = file => JSON.parse(fs.readFileSync(file));
const model = read('johannesbergbuild/course-model.json');
const review = read('johannesbergbuild/mapping/tee-placement-review.json');
test('reviewed tee assignments are stable and reject platform drift without mutation', () => {
  const applied = applyTeePlacementReview(model, review);
  assert.deepEqual(applied, model);
  const changed = structuredClone(model);
  changed.holes[0].tees.pads[0].ring[0][0] += 1;
  const before = structuredClone(changed);
  assert.throws(() => applyTeePlacementReview(changed, review), /platform drift/);
  assert.deepEqual(changed, before);
  const wrong = structuredClone(review);
  wrong.holes[0].marks[0].padId = wrong.holes[0].pads[1].padId;
  assert.throws(() => applyTeePlacementReview(model, wrong), /association/);
});
test('OB display posts retain every reviewed corner and carry unsurveyed placement policy', () => {
  const ledger = read('johannesbergbuild/mapping/ob-placement-review.json');
  const applied = applyObPlacementReview(model, ledger);
  assert.deepEqual(applyObPlacementReview(applied, ledger), applied);
  for (const feature of ledger.features) {
    const marking = applied.marking.find(m => m.id === feature.id);
    for (const p of feature.line) assert.ok(marking.pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < .002));
    for (let i = 1; i < marking.pts.length; i++) assert.ok(Math.hypot(marking.pts[i][0] - marking.pts[i - 1][0], marking.pts[i][1] - marking.pts[i - 1][1]) <= 12.002);
    for (const p of marking.pts) assert.ok(!model.water.some(w => inRing(...p, w.ring)),
      `${feature.id}: illustrative OB post placed in mapped open water`);
    assert.equal(marking.physicalPostPositionsObserved, false);
  }
});
test('standalone and app render exactly the same reviewed marker pairs', () => {
  const html = fs.readFileSync('johannesberg3d.html', 'utf8');
  const source = html.split('/*@TEE_PLACEMENT_RUNTIME*/')[1].split('/*@/TEE_PLACEMENT_RUNTIME*/')[0];
  const context = vm.createContext({ inRing, rightOf, ringSD, centroidOf });
  vm.runInContext(source + ';globalThis.place=reviewedTeeMarkerPositions;', context);
  for (const h of model.holes) for (const mark of h.tees.marks) {
    assert.equal(JSON.stringify(context.place(h, mark)), JSON.stringify(reviewedTeeMarkerPositions(h, mark)));
  }
});
