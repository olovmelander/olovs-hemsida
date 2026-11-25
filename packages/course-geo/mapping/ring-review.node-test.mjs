import test from 'node:test';
import assert from 'node:assert/strict';
import { RING_SCORE_LINE, reviewErrors, ringsUnderTheLine, tracedBuilds } from './ring-review.mjs';

test('a ring is under the line when the photo did not bear out its edge, unless a reviewer drew it', () => {
  const rows = [
    { kind: 'tee', id: 'a-tee-01-1', hole: 1, dPrime: RING_SCORE_LINE - 0.01 },
    { kind: 'tee', id: 'a-tee-01-2', hole: 1, dPrime: 6, kept: 'start' },
    { kind: 'tee', id: 'a-tee-01-3', hole: 1, dPrime: 0, kept: 'as-drawn' },
    { kind: 'tee', id: 'a-tee-01-4', hole: 1, dPrime: RING_SCORE_LINE },
    { kind: 'green', hole: 7, dPrime: 1.1 },
    { kind: 'fairway', hole: 7, dPrime: 0.2 },
    { kind: 'route', hole: 7, cardResidual: {} },
  ];
  assert.deepEqual(ringsUnderTheLine({ rows }, 'a').map(ring => ring.id), ['a-tee-01-1', 'a-tee-01-2', 'a-green-07']);
});

test('every course traced with the shared tracer has a current look at every ring', () => {
  const builds = tracedBuilds();
  assert.ok(builds.length >= 2);
  for (const build of builds) assert.deepEqual(reviewErrors(build), [], `${build}: draw the sheets (render-ring-sheets.py), look, and record it (ring-review.mjs --record)`);
});
