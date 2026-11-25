import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNKER_BOWL_LINE, DECK_OFF_PLANE_LINE, DECK_SLOPE_LINE, bunkerGround, deckGround, deckGroundErrors, deckGroundRecord, offTheLine } from './deck-ground.mjs';
import { tracedBuilds } from './ring-review.mjs';

const rectangle = (e0, n0, e1, n1) => [[e0, n0], [e1, n0], [e1, n1], [e0, n1], [e0, n0]];

test('a ring on its deck is level, and one over a bank, across a step or on a slope is not', () => {
  // A deck 8 m wide at 20 m, tilted 1% to drain, with a bank falling east of it at 1 in 4.
  const ground = (e, n) => (e <= 108 ? 20 + (e - 100) * 0.01 : 20.08 - (e - 108) * 0.25) + (n - 200) * 0.002;
  const onDeck = deckGround(ground, rectangle(100, 200, 108, 214));
  assert.ok(onDeck.measured && onDeck.cells >= 60);
  assert.ok(onDeck.slope < 1.5 && onDeck.offPlane <= 0.01, JSON.stringify(onDeck));
  assert.equal(offTheLine(onDeck), false);
  assert.ok(Math.abs(onDeck.level - 20.05) < 0.03);
  assert.ok(onDeck.aboveRim > 0, 'a deck beside a bank stands above the ground round it');

  const overTheBank = deckGround(ground, rectangle(103, 200, 111, 214)); // the same ring 3 m too far east
  assert.ok(overTheBank.slope > DECK_SLOPE_LINE && overTheBank.offPlane > DECK_OFF_PLANE_LINE, JSON.stringify(overTheBank));
  assert.equal(offTheLine(overTheBank), true);

  const twoLevels = deckGround((e, n) => (n < 310 ? 12 : 12.9), rectangle(100, 300, 108, 320)); // one ring over two decks
  assert.ok(twoLevels.offPlane > DECK_OFF_PLANE_LINE, JSON.stringify(twoLevels));
  assert.equal(offTheLine(twoLevels), true);

  const hillside = deckGround((e, n) => 30 + (e - 100) * 0.08, rectangle(100, 400, 108, 412)); // a deck newer than the terrain
  assert.ok(Math.abs(hillside.slope - 8) < 0.2 && hillside.offPlane <= 0.01);
  assert.equal(offTheLine(hillside), true);

  const tiny = deckGround(ground, rectangle(100, 200, 103.5, 203.5));
  assert.equal(tiny.measured, false);
  assert.equal(offTheLine(tiny), false, 'a ring too small to measure is named as such, not as a fault');
});

test('a bunker lies in a bowl, on level ground and on a slope; one built after the terrain lies on the ground', () => {
  const pit = (e, n, e0, n0, e1, n1, depth) => (e > e0 && e < e1 && n > n0 && n < n1 ? Math.min(depth, 0.4 * Math.min(e - e0, e1 - e, n - n0, n1 - n)) : 0);
  const level = (e, n) => 10 - pit(e, n, 100, 200, 112, 210, 0.8);
  const inABowl = bunkerGround(level, rectangle(100, 200, 112, 210));
  assert.ok(inABowl.measured && Math.abs(inABowl.depth - 0.8) < 0.15, JSON.stringify(inABowl));
  // The same bowl cut into a hillside of 12%: the plane of the ground round it takes the slope out.
  const hillside = (e, n) => 10 + (e - 100) * 0.12 - pit(e, n, 100, 200, 112, 210, 0.8);
  const onASlope = bunkerGround(hillside, rectangle(100, 200, 112, 210));
  assert.ok(Math.abs(onASlope.depth - 0.8) < 0.2, JSON.stringify(onASlope));
  // Sand laid on a slope the terrain knows nothing of: no bowl.
  const newer = bunkerGround((e, n) => 10 + (e - 100) * 0.12, rectangle(100, 200, 112, 210));
  assert.ok(Math.abs(newer.depth) < 0.02 && newer.depth < BUNKER_BOWL_LINE);
  assert.ok(inABowl.depth > BUNKER_BOWL_LINE && onASlope.depth > BUNKER_BOWL_LINE);
  assert.equal(bunkerGround(level, rectangle(100, 200, 102.5, 202.5)).measured, false, 'a pot too small to hold four cells is not measured');

  const feature = (id, kind, hole, ring) => ({ id, properties: { kind, hole }, geometry: { coordinates: [ring] } });
  const ground = (e, n) => 10 - pit(e, n, 100, 200, 112, 210, 0.8);
  const record = deckGroundRecord({ features: [feature('x-bunker-03-1', 'bunker', 3, rectangle(100, 200, 112, 210)), feature('x-bunker-03-2', 'bunker', 3, rectangle(140, 200, 152, 210)),
    feature('x-bunker-p-1', 'bunker', undefined, rectangle(180, 200, 182, 202))] }, ground, { slug: 'x', surfacesSha256: 'a'.repeat(64), terrainSha256: 'b'.repeat(64) });
  assert.deepEqual([record.bunkers.count, record.bunkers.measured, record.bunkers.bowled], [3, 2, 1]);
  assert.deepEqual(record.bunkers.flat.map(bunker => [bunker.id, bunker.hole, bunker.depth]), [['x-bunker-03-2', 3, 0]]);
});

test('a build\'s record counts every deck once and names the ones off the line', () => {
  const ground = (e, n) => (e < 150 ? 20 : 20 + (e - 150) * 0.1);
  const feature = (id, hole, ring, teeIds) => ({ id, properties: { kind: 'tee', hole, teeIds }, geometry: { coordinates: [ring] } });
  const surfaces = { features: [
    feature('x-tee-01-1', 1, rectangle(100, 200, 108, 212), ['vit']),
    feature('x-tee-01-2', 1, rectangle(152, 200, 160, 212), ['gul', 'bla']),
    feature('x-tee-02-1', 2, rectangle(120, 200, 123, 203), []),
    { id: 'x-green-01', properties: { kind: 'green', hole: 1 }, geometry: { coordinates: [rectangle(300, 300, 320, 320)] } },
  ] };
  const record = deckGroundRecord(surfaces, ground, { slug: 'x', surfacesSha256: 'a'.repeat(64), terrainSha256: 'b'.repeat(64) });
  assert.deepEqual([record.decks, record.measured, record.level], [3, 2, 1]);
  assert.deepEqual(record.tooSmall, ['x-tee-02-1']);
  assert.deepEqual(record.off.map(deck => [deck.id, deck.hole, deck.tees.join('/'), deck.slope]), [['x-tee-01-2', 1, 'gul/bla', 10]]);
});

test('every course traced with the shared tracer has its decks measured for the outlines it has now', () => {
  const builds = tracedBuilds();
  assert.ok(builds.length >= 2);
  for (const build of builds) assert.deepEqual(deckGroundErrors(build), []);
});
