import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { buildOrthoReviewPlan, nativeWindow } from './lm-ortho-plan.mjs';
import { VISBY_FRAME } from '../frame.mjs';
const model = JSON.parse(fs.readFileSync(new URL('../course-model.json', import.meta.url)));
const discovery = JSON.parse(fs.readFileSync(new URL('../../geo_data/course-v2/visby/acquisition/d2-discovery.json', import.meta.url)));

test('all 108 references are reviewed, with unresolved H12 and altered H3 first', () => {
  const plan = buildOrthoReviewPlan(model, discovery);
  assert.equal(plan.windows.length, 22);
  assert.deepEqual(plan.windows.slice(0, 3).map(w => w.hole), [12, 3, 9]);
  assert.equal(plan.summary.unresolvedTeeReferences, 40);
  assert.equal(plan.windows.filter(w => w.unresolvedTees).length, 18);
  const h12 = plan.windows.find(w => w.id === 'hole-12-tees');
  assert.equal(h12.mappedPlatforms, 0);
  assert.equal(h12.unresolvedTees.length, 6);
  assert.ok(h12.boundsEpsg3006[3] - h12.boundsEpsg3006[1] >= 300);
  assert.ok(plan.windows.every(w => w.megapixels <= 16 && w.sourceIds.length > 0));
});

test('fractional game coordinates snap outwards on the source lattice', () => {
  const point = [VISBY_FRAME.easting + 294.25, VISBY_FRAME.northing - 216.75];
  const box = nativeWindow([point], discovery, 45);
  const r = discovery.orthophoto.resolutionMetres, anchor = discovery.orthophoto.items[0].projBbox;
  for (let i = 0; i < 4; i++) {
    const pixel = (box[i] - anchor[i % 2]) / r;
    assert.ok(Math.abs(pixel - Math.round(pixel)) < 1e-6);
  }
  assert.ok(box[0] <= point[0] - 45 && box[2] >= point[0] + 45);
  assert.ok(box[1] <= point[1] - 45 && box[3] >= point[1] + 45);
});

test('discovery and frame mismatches fail before any source download', () => {
  assert.throws(() => buildOrthoReviewPlan({...model, frame:'legacy degrees'}, discovery), /grid-authored/);
  assert.throws(() => nativeWindow([[0, 0]], discovery), /coverage/);
  assert.throws(() => nativeWindow([[NaN, 1]], discovery), /finite/);
});
