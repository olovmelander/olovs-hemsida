import test from 'node:test';
import assert from 'node:assert/strict';
import { RING_SCORE_LINE, exportedBuilds, reviewErrors, ringsUnderTheLine, secondLook, secondLookErrors, secondLookSummary, tracedBuilds } from './ring-review.mjs';
import { exportErrors } from './export-model-surfaces.mjs';

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

test('a second look binds once recorded: each doubt is answered, or kept as a fault, and never both', () => {
  const ids = new Set(['a-tee-01-1', 'a-tee-02-1', 'a-bunker-03-1', 'a-green-04']), sha = 'c'.repeat(64);
  const verdicts = { reviewer: 'A second reviewer, blind sheets', reviewedOn: '2026-11-25', sheets: ['a-tee-1.jpg'], looked: { 'a-tee-1.jpg': 4 },
    doubts: { 'a-tee-01-1': 'no deck shows inside the line on either photo', 'a-tee-02-1': 'the line is 8 m west of the mown deck', 'b-tee-09-9': 'a ring of the other routing on the same sheets' },
    cannotTell: { 'a-green-04': 'two tones inside it on the older photo', 'b-green-01': 'another routing' } };
  const second = secondLook(verdicts, sha, ids);
  assert.deepEqual(Object.keys(second.doubts), ['a-tee-01-1', 'a-tee-02-1'], 'only this build\'s rings');
  assert.deepEqual(Object.keys(second.cannotTell), ['a-green-04']);
  assert.throws(() => secondLook({ ...verdicts, doubts: { 'a-tee-01-1': 'wrong' } }, sha, ids), /needs a reason/);

  const review = { surfacesSha256: sha, second };
  const open = secondLookErrors('abuild', review, ids);
  assert.equal(open.length, 2);
  assert.match(open[0], /doubts a-tee-01-1 \(no deck shows.*redraw it, or answer it/);
  second.doubts['a-tee-01-1'].resolution = 'The laser has a flat platform under the ring; crowns hide it.';
  second.doubts['a-tee-02-1'].fault = 'Right: the deck was moved after the terrain was flown. To redraw when it is renewed.';
  assert.deepEqual(secondLookErrors('abuild', review, ids), []);
  assert.deepEqual(secondLookSummary(second), { reviewer: verdicts.reviewer, reviewedOn: '2026-11-25', doubts: 2, stand: ['a-tee-01-1'],
    faults: [{ id: 'a-tee-02-1', fault: second.doubts['a-tee-02-1'].fault }], open: [], cannotTell: 1 });
  assert.equal(secondLookSummary(undefined), null);

  second.doubts['a-tee-02-1'].resolution = 'It also stands, says someone in a hurry.';
  assert.match(secondLookErrors('abuild', review, ids).join('\n'), /both stands and is a fault/);
  second.doubts['a-tee-02-1'].resolution = null;
  second.doubts['a-tee-01-1'].resolution = 'fine';
  assert.match(secondLookErrors('abuild', review, ids).join('\n'), /doubts a-tee-01-1/, 'a word is not an answer');
  assert.match(secondLookErrors('abuild', { surfacesSha256: 'd'.repeat(64), second }, ids).join('\n'), /saw other outlines than the first/);
  assert.match(secondLookErrors('abuild', { surfacesSha256: sha, second: { ...second, reviewer: 'me' } }, ids).join('\n'), /needs a date and who looked/);
  assert.deepEqual(secondLookErrors('abuild', { surfacesSha256: sha }, ids), [], 'a build without a second look is not failed for it');
});

test('every course traced with the shared tracer has a current look at every ring', () => {
  const builds = tracedBuilds();
  assert.ok(builds.length >= 2);
  for (const build of builds) assert.deepEqual(reviewErrors(build), [], `${build}: draw the sheets (render-ring-sheets.py), look, and record it (ring-review.mjs --record)`);
});

test('an older ground whose outlines are exported for the looks has them current, and a current look at every ring', () => {
  for (const build of exportedBuilds()) {
    assert.deepEqual(exportErrors(build), [], `${build}: migrate the model and export its outlines again (export-model-surfaces.mjs)`);
    assert.deepEqual(reviewErrors(build), [], `${build}: draw the sheets (render-ring-sheets.py), look, and record it (ring-review.mjs --record)`);
  }
});
