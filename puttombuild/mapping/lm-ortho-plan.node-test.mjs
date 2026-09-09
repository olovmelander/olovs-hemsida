import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOrthoReviewPlan, nativeWindow, projectedPoint } from './lm-ortho-plan.mjs';
import { rectangleUnionArea } from '../../packages/course-geo/acquisition/stac.mjs';

const model = JSON.parse(fs.readFileSync(new URL('../course-model.json', import.meta.url)));
const discovery = JSON.parse(fs.readFileSync(new URL('./lm-ortho-discovery.json', import.meta.url)));
const plan = buildOrthoReviewPlan(model, discovery);
const area = b => (b[2] - b[0]) * (b[3] - b[1]);

test('pixel-edge snapping preserves both sides of the four-source seam', () => {
  const bounds = nativeWindow([[697499.99, 7024999.99], [697500.01, 7025000.01]], discovery, 0);
  assert.deepEqual(bounds, [697499.84, 7024999.84, 697500.16, 7025000.16]);
  const anchored = nativeWindow([[697500, 7025000], [697500.32, 7025000.32]], discovery, 0);
  assert.deepEqual(anchored, [697500, 7025000, 697500.32, 7025000.32]);
});

test('context is a nonoverlapping complete native-grid cover of every playing hole', () => {
  const context = plan.windows.filter(w => w.priority === 'context');
  const bounds = context.map(w => w.boundsEpsg3006);
  assert.ok(Math.abs(rectangleUnionArea(bounds) - area(plan.courseBoundsEpsg3006)) < 0.01);
  assert.ok(Math.abs(bounds.reduce((n, b) => n + area(b), 0) - area(plan.courseBoundsEpsg3006)) < 0.01);
  for (const h of model.holes) {
    for (const point of [...h.line, ...h.green.ring, ...h.fairway.rings.flat(), ...h.tees.pads.flatMap(p => p.ring), ...h.tees.marks.map(m => m.c), ...h.bunkers.flatMap(b => b.ring)]) {
      const [e, n] = projectedPoint(model, point);
      assert.ok(bounds.some(b => e >= b[0] && e <= b[2] && n >= b[1] && n <= b[3]), `hole ${h.n} lacks imagery`);
    }
  }
  for (const w of plan.windows) {
    assert.ok(w.width * w.height <= 16e6);
    assert.ok(Math.abs(w.width * 0.16 - (w.boundsEpsg3006[2] - w.boundsEpsg3006[0])) < 1e-6);
    assert.ok(Math.abs(w.height * 0.16 - (w.boundsEpsg3006[3] - w.boundsEpsg3006[1])) < 1e-6);
  }
  assert.equal(plan.windows.filter(w => w.id.endsWith('-tees')).length, 18);
  assert.equal(plan.windows.filter(w => w.id.endsWith('-green')).length, 18);
  assert.ok(context.some(w => w.sourceIds.length === 4), 'seam window must read all four tiles');
});

test('legacy true north projects with Puttom grid convergence', () => {
  const origin = projectedPoint(model, [0, 0]);
  // Independent pyproj EPSG:4326 -> EPSG:3006 reference, always_xy=True.
  assert.ok(Math.abs(origin[0] - 697498.0217078414) < 0.02);
  assert.ok(Math.abs(origin[1] - 7024997.739458614) < 0.02);
  const north = projectedPoint(model, [0, -1000]);
  assert.ok(north[0] - origin[0] < -60 && north[0] - origin[0] > -63);
  assert.ok(north[1] - origin[1] > 998 && north[1] - origin[1] < 1002);
});

test('missing coverage, non-native grids and oversized windows fail before acquisition', () => {
  const shifted = structuredClone(discovery);
  shifted.orthophoto.items[1].projBbox[0] += 0.08;
  assert.throws(() => buildOrthoReviewPlan(model, shifted), /pixel lattice/);
  const gap = structuredClone(discovery);
  gap.orthophoto.items.splice(3, 1);
  assert.throws(() => buildOrthoReviewPlan(model, gap), /incomplete source coverage/);
  assert.throws(() => nativeWindow([[695000, 7022500]], discovery, 0), /exceeds discovered/);
  const oversized = structuredClone(model);
  oversized.holes[0].tees.marks.push({ c: [1000, 1000] });
  assert.throws(() => buildOrthoReviewPlan(oversized, discovery), /window budget/);
});

test('full AOI option covers the discovery interior without requesting outside it', () => {
  const full = buildOrthoReviewPlan(model, discovery, { fullAoi: true });
  const b = full.courseBoundsEpsg3006, a = discovery.aoi.bboxEpsg3006;
  for (const i of [0, 1]) assert.ok(b[i] >= a[i] && b[i] - a[i] < 0.16);
  for (const i of [2, 3]) assert.ok(b[i] <= a[i] && a[i] - b[i] < 0.16);
  assert.ok(Math.abs(rectangleUnionArea(full.windows.filter(w => w.priority === 'context').map(w => w.boundsEpsg3006)) - area(b)) < 0.01);
});
