import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedReferences, loadTeeReview } from './reviewed-tee-alignment.mjs';
import { local } from '../build-course.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

test('forward tee markers face along play even when the original route start lies behind them', () => {
  const model = JSON.parse(fs.readFileSync(new URL('../course-model.json', import.meta.url)));
  const { review, plan } = loadTeeReview();
  for (const hole of model.holes) {
    const result = applyReviewedReferences(structuredClone(hole), review, plan, local);
    for (const mark of result.tees.marks) {
      const expected = lineBearingAt(hole.line, mark.c);
      const actual = mark.b * Math.PI / 180;
      assert.ok(Math.cos(actual - expected) > 1 - 1e-10, `Hole ${hole.n}: marker direction reversed`);
    }
    assert.deepEqual(result.line, hole.line);
    assert.deepEqual(result.t, hole.t);
  }
});
