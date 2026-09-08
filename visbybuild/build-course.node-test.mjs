import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { buildHoles, localRing, makeHeightSampler } from './build-course.mjs';
import { VISBY_FRAME as FRAME, VISBY_FRONTIER_BOUNDS, projected } from './frame.mjs';
import { assertVisbyCanonicalRouting, visbyRuntimeContract } from '../packages/course-v2/compile-visby-ground-graph.mjs';

const card = JSON.parse(readFileSync(new URL('./reference/club-scorecard.json', import.meta.url), 'utf8'));
const box = (x, z, width = 20) => [[x, z], [x + width, z], [x + width, z + width], [x, z + width], [x, z]].map(projected);
const fixture = () => ({ schemaVersion: 1, groundId: 'visby', courseSlug: 'visby', horizontalCrs: 'EPSG:3006', axisOrder: ['easting', 'northing'],
  holes: card.holes.map((row, index) => ({ n: row.number, line: [[index * 35 + 10, -190], [index * 35 + 10, 10]].map(projected),
    green: { ring: box(index * 35, 0) }, tees: { pads: [{ ring: box(index * 35, -200) }, { ring: box(index * 35, -150) }] }, fairway: { rings: [] }, bunkers: [] })) });

test('observed source routes, rings and tee positions are preserved without card-distance stretching', () => {
  const geometry = fixture(), holes = buildHoles(card, geometry, () => 3);
  assert.equal(holes.length, 18);
  holes.forEach((hole, index) => {
    assert.deepEqual(hole.line.map(projected), geometry.holes[index].line);
    assert.deepEqual(hole.green.ring.map(projected), geometry.holes[index].green.ring);
    assert.equal(hole.tees.inferPads, false);
    assert.deepEqual(hole.fairway.rings, []);
    assert.equal(hole.tees.marks.length, 6);
    assert.ok(hole.tees.marks.every(mark => JSON.stringify(mark.c) === JSON.stringify([index * 35 + 10, -190])));
  });
  const revisedCard = structuredClone(card);
  revisedCard.holes[0].lengths['tee-63'] += 20;
  revisedCard.holes[1].lengths['tee-63'] -= 20;
  const revised = buildHoles(revisedCard, geometry, () => 3);
  assert.deepEqual(revised.map(h => h.line), holes.map(h => h.line));
  assert.deepEqual(revised.map(h => h.tees.marks.map(mark => mark.c)), holes.map(h => h.tees.marks.map(mark => mark.c)));
});

test('a missing physical tee, unknown CRS or a camera reference off an observed pad fails', () => {
  let geometry = fixture(); geometry.holes[0].tees.pads = [];
  assert.throws(() => buildHoles(card, geometry, () => 0), /observed physical tee/);
  geometry = fixture(); geometry.horizontalCrs = 'EPSG:4326';
  assert.throws(() => buildHoles(card, geometry, () => 0), /EPSG:3006/);
  geometry = fixture(); geometry.holes[0].tees.references = { 'tee-59': projected([1500, 1500]) };
  assert.throws(() => buildHoles(card, geometry, () => 0), /leaves observed tee/);
  geometry = fixture(); geometry.holes[0].green.ring.pop();
  assert.throws(() => buildHoles(card, geometry, () => 0), /ring must be closed/);
  assert.throws(() => localRing(box(2047, 2047), 'outside'), /leaves acquired terrain/);
});

test('terrain interpolation uses source pixels and refuses invented coverage', () => {
  const fine = new Float32Array(4097 * 4097).fill(2);
  fine[0] = 0; fine[1] = 2; fine[4097] = 4; fine[4098] = 6;
  fine[fine.length - 1] = 7;
  const height = makeHeightSampler(fine);
  assert.equal(height(-2048, -2048), 0);
  assert.equal(height(-2047.5, -2047.5), 3);
  assert.equal(height(2048, 2048), 7);
  assert.throws(() => height(2048.01, 0), /leaves acquired/);
  fine[10] = Number.NaN;
  assert.throws(() => makeHeightSampler(fine), /every finite acquired/);
});

test('only explicitly unresolved hole 12 can use a sourced camera on observed fairway without inventing a tee', () => {
  const geometry = fixture(), hole = geometry.holes[11];
  hole.fairway.rings = [box(385, -210, 60)];
  hole.tees = { pads: [], status: 'unresolved-physical-platform', cameraReference: projected([400, -185]), sourceIds: ['observed-ortho-fairway'] };
  const output = buildHoles(card, geometry, () => 3)[11];
  assert.deepEqual(output.tees.pads, []);
  assert.equal(output.tees.inferPads, false);
  assert.equal(output.tees.status, 'unresolved-physical-platform');
  assert.ok(output.tees.marks.every(mark => JSON.stringify(mark.c) === JSON.stringify([400, -185])));
  const missingEvidence = structuredClone(geometry); missingEvidence.holes[11].tees.sourceIds = [];
  assert.throws(() => buildHoles(card, missingEvidence, () => 3), /explicit sourced fairway camera/);
  const offFairway = structuredClone(geometry); offFairway.holes[11].tees.cameraReference = projected([900, -185]);
  assert.throws(() => buildHoles(card, offFairway, () => 3), /must lie on an observed fairway/);
  const silent = structuredClone(geometry); delete silent.holes[11].tees.status;
  assert.throws(() => buildHoles(card, silent, () => 3), /observed physical tee/);
  const otherHole = structuredClone(geometry); otherHole.holes[10].tees = structuredClone(hole.tees);
  assert.throws(() => buildHoles(card, otherHole, () => 3), /Hole 11 needs at least/);
});

test('graph checks fallback geometry and canonical routing before publication', () => {
  const geometry = fixture();
  const model = { holes: buildHoles(card, geometry, () => 0), frame: FRAME.text, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLon: 59906.61 };
  const pack = { header: { slug: 'visby', GEO: { frame: model.frame, origin: model.origin, mPerLon: model.mPerLon } }, sv: zlib.deflateRawSync(JSON.stringify({ holes: model.holes })) };
  const routing = assertVisbyCanonicalRouting(geometry, model, pack);
  assert.deepEqual(routing[0].line, geometry.holes[0].line);
  const moved = structuredClone(geometry); moved.holes[0].line[0][0]++;
  assert.throws(() => assertVisbyCanonicalRouting(moved, model, pack), /canonical source route/);
  const stale = structuredClone(model); stale.holes[0].tees.pads[0].ring[0][0]++;
  assert.throws(() => assertVisbyCanonicalRouting(geometry, stale, pack), /fallback differs/);
});

test('64 active source tiles bound the played geometry while the complete source window remains separate', () => {
  const model = { holes: buildHoles(card, fixture(), () => 0), scenery: { greens: [], range: [] }, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLon: 59906.61, frame: FRAME.text };
  const bounds = { minEasting: 685700.5, maxEasting: 689796.5, minNorthing: 6368903.5, maxNorthing: 6372999.5 };
  const contract = visbyRuntimeContract(model, { origin: FRAME }, bounds);
  assert.deepEqual(contract.bounds, bounds);
  assert.deepEqual(contract.frontierBounds, VISBY_FRONTIER_BOUNDS);
  assert.equal(contract.expectedTileCount, 64);
  assert.equal((VISBY_FRONTIER_BOUNDS.maxEasting - VISBY_FRONTIER_BOUNDS.minEasting) / 256, 8);
  assert.equal((VISBY_FRONTIER_BOUNDS.maxNorthing - VISBY_FRONTIER_BOUNDS.minNorthing) / 256, 8);
  model.holes[0].fairway.rings = [[[1025, 0], [1030, 0], [1030, 5], [1025, 0]]];
  assert.throws(() => visbyRuntimeContract(model, { origin: FRAME }, bounds), /leaves the active/);
});
