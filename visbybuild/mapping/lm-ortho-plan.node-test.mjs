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
  assert.equal(plan.summary.unresolvedTeeReferences, 37);
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

test('complete review covers every green and tiles the AOI without gaps or overlap', () => {
  const plan = buildOrthoReviewPlan(model, discovery, { fullCourse:true });
  assert.equal(plan.windows.filter(w => /-green$/.test(w.id)).length, 18);
  assert.equal(new Set(plan.windows.map(w => w.id)).size, plan.windows.length);
  const tiles = plan.windows.filter(w => w.priority === 'context');
  const area = b => (b[2]-b[0]) * (b[3]-b[1]);
  const total = tiles.reduce((sum, w) => sum + area(w.boundsEpsg3006), 0);
  assert.ok(total / area(discovery.aoi.bboxEpsg3006) > 0.999);
  for (let i=0; i<tiles.length; i++) for (let j=i+1; j<tiles.length; j++) {
    const a=tiles[i].boundsEpsg3006, b=tiles[j].boundsEpsg3006;
    assert.ok(Math.min(a[2],b[2])-Math.max(a[0],b[0]) < 1e-6 || Math.min(a[3],b[3])-Math.max(a[1],b[1]) < 1e-6);
  }
  assert.ok(plan.windows.every(w => w.width*w.height <= 16e6));
  assert.ok(plan.summary.totalMegapixels < 370);
});
