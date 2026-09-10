import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTeeReview, reviewPoint, applyReviewedSurfaces, applyReviewedReferences } from './reviewed-tee-alignment.mjs';
import { local } from '../build-course.mjs';
import { canRenderTeeMarker } from '../../apps/golf/src/engine/tee-marker-visibility.mjs';
const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const { review, plan } = loadTeeReview();

test('native pixel edges convert directly to the declared EPSG:3006 frame', () => {
  const window = plan.windows.find(w => w.id === 'lidingo-01-tees');
  assert.deepEqual(reviewPoint([0, 0], window), [window.boundsEpsg3006[0], window.boundsEpsg3006[3]]);
  const p = reviewPoint([10, 20], window);
  assert.ok(Math.abs(p[0] - window.boundsEpsg3006[0] - 1.6) < 1e-8);
  assert.ok(Math.abs(p[1] - window.boundsEpsg3006[3] + 3.2) < 1e-8);
  for (const p of [[-1, 0], [0, NaN], [window.width + 1, 0]]) assert.throws(() => reviewPoint(p, window));
});

test('review replaces tee surfaces idempotently while preserving every other source vertex', () => {
  const surfaces = read('./playing-surfaces.geojson');
  const once = applyReviewedSurfaces(surfaces, review, plan);
  assert.deepEqual(applyReviewedSurfaces(once, review, plan), once);
  const nonTees = x => x.features.filter(f => f.properties.kind !== 'tee');
  assert.deepEqual(nonTees(once), nonTees(surfaces));
  assert.deepEqual([...new Set(review.holes.map(h => h.hole))], Array.from({ length: 18 }, (_, i) => i + 1));
});

test('all colour references retain card order, explicit platform identity and unresolved visibility', () => {
  const model = read('../course-model.json');
  let visible = 0, unresolved = 0;
  for (const hole of model.holes) {
    const originalCard = [...hole.t], route = structuredClone(hole.line);
    const updated = applyReviewedReferences(structuredClone(hole), review, plan, local);
    assert.deepEqual(updated.t, originalCard);
    assert.deepEqual(updated.line, route);
    assert.deepEqual(updated.tees, hole.tees, 'stored model must be reproducible from the review');
    assert.equal(hole.tees.inferPads, false);
    for (const mark of hole.tees.marks) {
      assert.equal(mark.orthophotoReference.dailyMarkerPositionVerified, false);
      if (mark.orthophotoReference.kind === 'unresolved-guide-tee-reference') {
        assert.equal(canRenderTeeMarker(hole, mark, 'mapped-only'), false);
        assert.ok(mark.orthophotoReference.unresolvedReason);
        unresolved++;
      } else {
        assert.equal(canRenderTeeMarker(hole, mark, 'mapped-only'), true);
        visible++;
      }
    }
  }
  assert.equal(visible, 81);
  assert.equal(unresolved, 9);
});

test('a colour cannot silently jump to another pad or outside source coverage', () => {
  const model = read('../course-model.json');
  const changed = structuredClone(review);
  changed.holes[0].markers[0].platformId = changed.holes[1].platforms[0].id;
  assert.throws(() => applyReviewedReferences(structuredClone(model.holes[0]), changed, plan, local), /outside nominated platform/);
  changed.holes[0].markers[0] = { ...review.holes[0].markers[0], pixel: [0, 0] };
  assert.throws(() => applyReviewedReferences(structuredClone(model.holes[0]), changed, plan, local), /outside nominated platform/);
});
