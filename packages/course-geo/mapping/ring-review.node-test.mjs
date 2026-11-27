import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_HOLDS, RING_SCORE_LINE, carrySecondLook, exportedBuilds, lookHolds, photoOf, recordLook, recordText, reviewErrors, reviewProblems, ringSignature, ringsToLookAt,
  ringsUnderTheLine, secondLook, secondLookErrors, secondLookSummary, tracedBuilds } from './ring-review.mjs';
import { exportErrors } from './export-model-surfaces.mjs';

// a ground far from the origin, as every real one is: the signature must keep its centimetres there
const E = 669400, N = 6611600;
const ring = (id, kind, points, holes = []) => ({ type: 'Feature', id, properties: { kind }, geometry: { type: 'Polygon', coordinates: [points, ...holes].map(r => [...r, r[0]].map(([x, y]) => [E + x, N + y])) } });
const box = (id, kind, x, y, w, h) => ring(id, kind, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const surfacesOf = features => ({ type: 'FeatureCollection', features });
const trace = { slug: 'a', rows: [{ kind: 'tee', id: 'a-tee-01-1', hole: 1, dPrime: 1.4 }, { kind: 'green', hole: 1, dPrime: 5 }] };
const base = () => [box('a-green-01', 'green', 0, 0, 20, 25), box('a-tee-01-1', 'tee', 200, 0, 6, 10), box('a-tee-01-2', 'tee', 220, 0, 6, 10), box('a-bunker-01-1', 'bunker', 30, 0, 8, 6)];
const look = { reviewer: 'A reviewer, on both photo years', reviewedOn: '2026-11-27', accept: { 'a-tee-01-1': 'The laser has a level platform under it; crowns hide the edge.' } };

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
  assert.deepEqual(ringsUnderTheLine({ rows }, 'a').map(r => r.id), ['a-tee-01-1', 'a-tee-01-2', 'a-green-07']);
});

test('a look remembers where a ring lay and how large it was, to the centimetre', () => {
  assert.deepEqual(ringSignature(box('g', 'green', 10, 20, 20, 25)), [E + 20, N + 32.5, 500, 90, E + 10, N + 20, E + 30, N + 45]);
  const holed = ring('f', 'fairway', [[0, 0], [40, 0], [40, 10], [0, 10]], [[[30, 2], [38, 2], [38, 8], [30, 8]]]);
  const [cx, cy, area, edge] = ringSignature(holed);
  assert.deepEqual([area, edge], [400 - 48, 100 + 28], 'a hole takes its area away and adds its edge');
  assert.ok(Math.abs(cx - (E + (400 * 20 - 48 * 34) / 352)) < 0.011 && cy === N + 5, 'and moves the centre away from itself');
  const two = { id: 'm', properties: { kind: 'fairway' }, geometry: { type: 'MultiPolygon', coordinates: [box('x', 'f', 0, 0, 10, 10).geometry.coordinates, box('y', 'f', 30, 0, 10, 10).geometry.coordinates] } };
  assert.deepEqual(ringSignature(two).slice(0, 4), [E + 20, N + 5, 200, 80]);
  assert.deepEqual(ringSignature({ id: 'mark', properties: { kind: 'tee-mark' }, geometry: { type: 'Point', coordinates: [E + 1, N + 2] } }), [E + 1, N + 2, 0, 0, E + 1, N + 2, E + 1, N + 2]);
  assert.throws(() => ringSignature({ id: 'l', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }), /is not a ring/);
  assert.throws(() => ringSignature(ring('flat', 'tee', [[0, 0], [5, 0], [9, 0]])), /without area/);
});

test('a look holds for a ring until the ring moves, and a centimetre is not a move', () => {
  const green = box('g', 'green', 0, 0, 20, 25), seen = ringSignature(green);
  const shaken = ring('g', 'green', [[0.01, -0.01], [20, 0.01], [19.99, 25], [-0.01, 25.01]]);
  assert.ok(lookHolds(seen, ringSignature(shaken)), 'a trace again shifts a ring by a centimetre');
  assert.ok(!lookHolds(seen, ringSignature(box('g', 'green', 0.4, 0, 20, 25))), 'moved 0.4 m');
  assert.ok(!lookHolds(seen, ringSignature(box('g', 'green', 0, 0, 20, 25.5))), 'one side out by half a metre');
  // a bite of a metre out of one side, which moves neither the box nor much of the centre
  const bitten = ring('g', 'green', [[0, 0], [20, 0], [20, 10], [19, 10], [19, 14], [20, 14], [20, 25], [0, 25]]);
  assert.ok(!lookHolds(seen, ringSignature(bitten)), 'its area and the length of its edge say so');
  assert.ok(lookHolds(seen, ringSignature(ring('g', 'green', [[0, 0], [20, 0], [20, 12], [19.9, 12.5], [20, 13], [20, 25], [0, 25]]))), 'a dent of a decimetre is under what a look can see');
  assert.ok(!lookHolds(undefined, seen) && !lookHolds([1, 2, 3], seen), 'a ring never seen, or seen in an older form');
  assert.ok(LOOK_HOLDS.movedMetres <= 0.3 && LOOK_HOLDS.sizeMetres <= 0.5, 'looser than this and a look would pass what the photo shows');
});

test('a ring cannot creep away from where it was looked at, a small step a trace', () => {
  const at = shift => surfacesOf([box('a-green-01', 'green', shift, 0, 20, 25), box('a-tee-01-1', 'tee', 200, 0, 6, 10)]);
  let review = recordLook(null, at(0), trace, look);
  for (const shift of [0.2, 0.25]) {
    assert.deepEqual(ringsToLookAt(at(shift), review), [], `${shift} m from where it was looked at`);
    review = recordLook(review, at(shift), trace, look);
    assert.equal(review.seen['a-green-01'][0], E + 10, 'the record keeps what the look saw, not where the ring has got to');
  }
  assert.deepEqual(ringsToLookAt(at(0.4), review), ['a-green-01'], 'the third small step is 0.4 m from the look');
  review = recordLook(review, at(0.4), trace, look);
  assert.equal(review.seen['a-green-01'][0], E + 10.4, 'looked at again, it is remembered where it is now');
});

test('a new trace asks for a look at the rings that moved and at no others, and the answers given stay', () => {
  const first = recordLook(null, surfacesOf(base()), trace, look);
  assert.deepEqual(reviewProblems('abuild', first, surfacesOf(base()), trace), []);
  assert.equal(recordText(first).split('\n').filter(line => /^  "a-[^"]+": \[.*\],?$/.test(line)).length, 4, 'a ring a line');
  assert.deepEqual(JSON.parse(recordText(first)), first);

  // a second reviewer doubts three rings; two are answered and one is left open
  const verdicts = { reviewer: 'A second reviewer, blind sheets', reviewedOn: '2026-11-27', sheets: ['a-tee-1.jpg'], looked: { 'a-tee-1.jpg': 4 },
    doubts: { 'a-tee-01-1': 'no deck shows inside the line on either photo', 'a-bunker-01-1': 'grass on the older photo', 'a-green-01': 'a spur on its north side', 'b-tee-09-9': 'a ring of the other routing on the same sheets' },
    cannotTell: { 'a-tee-01-2': 'under crowns on both years', 'b-green-01': 'another routing' } };
  const ids = new Set(base().map(f => f.id));
  first.second = secondLook(verdicts, ids);
  assert.deepEqual(Object.keys(first.second.doubts), ['a-tee-01-1', 'a-bunker-01-1', 'a-green-01'], 'only this build\'s rings');
  first.second.doubts['a-tee-01-1'].resolution = 'The laser has a flat platform under the ring; crowns hide it.';
  first.second.doubts['a-bunker-01-1'].fault = 'Right: built after the terrain was flown. To reshape when it is renewed.';
  assert.match(reviewProblems('abuild', first, surfacesOf(base()), trace).join('\n'), /doubts a-green-01 \(a spur on its north side\)/);

  // the green is redrawn (its spur taken off), the bunker shifts by a centimetre, a tee is added and one is removed
  const next = surfacesOf([box('a-green-01', 'green', 0, 0, 20, 23), box('a-tee-01-1', 'tee', 200, 0, 6, 10), box('a-bunker-01-1', 'bunker', 30.01, 0, 8, 6), box('a-tee-01-3', 'tee', 240, 0, 5, 8)]);
  assert.deepEqual(ringsToLookAt(next, first), ['a-green-01', 'a-tee-01-3']);
  const problems = reviewProblems('abuild', first, next, trace).join('\n');
  assert.match(problems, /2 of 4 rings are new or have moved since the look of 2026-11-27 \(a-green-01, a-tee-01-3\)/);
  assert.doesNotMatch(problems, /a-bunker-01-1 .*moved/);

  const again = recordLook(first, next, trace, { reviewer: 'A reviewer, on the two rings that moved', reviewedOn: '2026-11-28' });
  assert.deepEqual(reviewProblems('abuild', again, next, trace), [], 'the redraw answered the open doubt');
  assert.deepEqual(Object.keys(again.seen), ['a-bunker-01-1', 'a-green-01', 'a-tee-01-1', 'a-tee-01-3']);
  assert.equal(again.accepted['a-tee-01-1'], look.accept['a-tee-01-1'], 'a verdict on a ring under the line is kept');
  assert.deepEqual(again.second.unseen, ['a-green-01', 'a-tee-01-3'], 'the second reviewer has not seen these');
  assert.deepEqual(Object.keys(again.second.doubts), ['a-tee-01-1', 'a-bunker-01-1'], 'the answers stay; the open doubt went with the line it doubted');
  assert.deepEqual(again.second.cannotTell, {}, 'what was said of a ring that is gone goes with it');
  assert.deepEqual(secondLookSummary(again.second).unseen, ['a-green-01', 'a-tee-01-3']);

  // the second reviewer looks at the two, and raises the bunker again: its answer stands, for the same line
  const later = secondLook({ ...verdicts, reviewedOn: '2026-11-28', doubts: { 'a-bunker-01-1': 'grass on the older photo, again', 'a-tee-01-3': 'half of it lies on the path' }, cannotTell: {} },
    new Set(next.features.map(f => f.id)), again.second);
  assert.deepEqual(later.unseen, []);
  assert.match(later.doubts['a-bunker-01-1'].fault, /built after the terrain/);
  assert.deepEqual(later.doubts['a-tee-01-3'], { reason: 'half of it lies on the path', resolution: null, fault: null });
  assert.ok(later.doubts['a-tee-01-1'].resolution, 'an answered doubt it did not raise again is kept');

  // an answer was for the line that was doubted: once the ring has moved, the same doubt is a new one
  const moved = carrySecondLook(later, ['a-bunker-01-1'], new Set(next.features.map(f => f.id)));
  assert.ok(moved.doubts['a-bunker-01-1'].fault, 'a fault is not lost because its ring was nudged');
  const reraised = secondLook({ ...verdicts, doubts: { 'a-bunker-01-1': 'the new line cuts the lip on its east side' } }, new Set(next.features.map(f => f.id)), moved);
  assert.deepEqual(reraised.doubts['a-bunker-01-1'], { reason: 'the new line cuts the lip on its east side', resolution: null, fault: null });
});

test('a look is of a ring on a photo: outlines traced again on another photo are looked at whole', () => {
  const on = rasters => ({ ...surfacesOf(base()), provenance: { imagery: 'orto', imagerySha256: rasters } });
  const summer = on({ 'north.tif': 'a'.repeat(64), 'south.tif': 'b'.repeat(64) });
  const review = recordLook(null, summer, trace, look);
  assert.equal(photoOf(summer), photoOf(on({ 'south.tif': 'b'.repeat(64), 'north.tif': 'a'.repeat(64) })), 'the same rasters, named in another order');
  assert.deepEqual(reviewProblems('abuild', review, summer, trace), []);
  const newer = on({ 'north.tif': 'c'.repeat(64), 'south.tif': 'b'.repeat(64) });
  assert.equal(ringsToLookAt(newer, review).length, 4, 'not one ring moved, and every one is on a photo nobody looked at');
  assert.match(reviewProblems('abuild', review, newer, trace).join('\n'), /traced on another photo than the one they were looked at on \(2026-11-27\); look at every ring/);
  const again = recordLook({ ...review, second: secondLook({ reviewer: 'A second reviewer, blind sheets', reviewedOn: '2026-11-27', doubts: {} }, new Set(base().map(f => f.id))) }, newer, trace, look);
  assert.equal(again.second.unseen.length, 4, 'and the second reviewer has seen none of them on it');
  assert.equal(photoOf(surfacesOf(base())), null, 'an older ground\'s exported outlines name no photo');
});

test('a second look binds once recorded: each doubt is answered, or kept as a fault, and never both', () => {
  const ids = new Set(['a-tee-01-1', 'a-tee-02-1', 'a-bunker-03-1', 'a-green-04']);
  const verdicts = { reviewer: 'A second reviewer, blind sheets', reviewedOn: '2026-11-25', sheets: ['a-tee-1.jpg'], looked: { 'a-tee-1.jpg': 4 },
    doubts: { 'a-tee-01-1': 'no deck shows inside the line on either photo', 'a-tee-02-1': 'the line is 8 m west of the mown deck' }, cannotTell: { 'a-green-04': 'two tones inside it on the older photo' } };
  const second = secondLook(verdicts, ids);
  assert.deepEqual(Object.keys(second.cannotTell), ['a-green-04']);
  assert.throws(() => secondLook({ ...verdicts, doubts: { 'a-tee-01-1': 'wrong' } }, ids), /needs a reason/);

  const review = { second };
  const open = secondLookErrors('abuild', review, ids);
  assert.equal(open.length, 2);
  assert.match(open[0], /doubts a-tee-01-1 \(no deck shows.*redraw it, or answer it/);
  second.doubts['a-tee-01-1'].resolution = 'The laser has a flat platform under the ring; crowns hide it.';
  second.doubts['a-tee-02-1'].fault = 'Right: the deck was moved after the terrain was flown. To redraw when it is renewed.';
  assert.deepEqual(secondLookErrors('abuild', review, ids), []);
  assert.deepEqual(secondLookSummary(second), { reviewer: verdicts.reviewer, reviewedOn: '2026-11-25', doubts: 2, stand: ['a-tee-01-1'],
    faults: [{ id: 'a-tee-02-1', fault: second.doubts['a-tee-02-1'].fault }], open: [], cannotTell: 1, unseen: [] });
  assert.equal(secondLookSummary(undefined), null);

  second.doubts['a-tee-02-1'].resolution = 'It also stands, says someone in a hurry.';
  assert.match(secondLookErrors('abuild', review, ids).join('\n'), /both stands and is a fault/);
  second.doubts['a-tee-02-1'].resolution = null;
  second.doubts['a-tee-01-1'].resolution = 'fine';
  assert.match(secondLookErrors('abuild', review, ids).join('\n'), /doubts a-tee-01-1/, 'a word is not an answer');
  assert.match(secondLookErrors('abuild', { second: { ...second, reviewer: 'me' } }, ids).join('\n'), /needs a date and who looked/);
  assert.match(secondLookErrors('abuild', review, new Set(['a-tee-01-1'])).join('\n'), /doubts a-tee-02-1, which is not in the outlines/);
  assert.deepEqual(secondLookErrors('abuild', {}, ids), [], 'a build without a second look is not failed for it');
});

test('every course traced with the shared tracer has a current look at every ring', () => {
  const builds = tracedBuilds();
  assert.ok(builds.length >= 2);
  for (const build of builds) assert.deepEqual(reviewErrors(build), [], `${build}: ring-review.mjs --build ${build} says which rings to draw and look at; then record the look`);
});

test('an older ground whose outlines are exported for the looks has them current, and a current look at every ring', () => {
  for (const build of exportedBuilds()) {
    assert.deepEqual(exportErrors(build), [], `${build}: migrate the model and export its outlines again (export-model-surfaces.mjs)`);
    assert.deepEqual(reviewErrors(build), [], `${build}: ring-review.mjs --build ${build} says which rings to draw and look at; then record the look`);
  }
});
