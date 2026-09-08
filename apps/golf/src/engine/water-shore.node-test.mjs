import test from 'node:test';
import assert from 'node:assert/strict';
import { waterShoreDistance } from './water-shore.mjs';
import { runtimeWater } from '../../../../packages/course-pack/runtime-water.mjs';
import { collectCoordinatePairs } from '../../../../packages/course-geo/migration.mjs';

const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];

test('partition cuts do not become shores while outer and island shores remain', () => {
  const original = box(0, 0, 100, 100), island = box(40, 40, 60, 60);
  const lowerPiece = { ring: box(0, 0, 100, 40), level: 2, isLake: true, area: 4000,
    shoreline: { rings: [original, island] } };
  const rendered = runtimeWater(lowerPiece);
  assert.equal(waterShoreDistance(20, 40, { ring: lowerPiece.ring }), 0);
  assert.equal(waterShoreDistance(20, 40, rendered), 20);
  assert.equal(waterShoreDistance(50, 39, rendered), 1);
  assert.equal(waterShoreDistance(1, 20, rendered), 1);
  assert.deepEqual(rendered.ring, lowerPiece.ring);
  assert.deepEqual(JSON.parse(JSON.stringify(rendered)).shoreline.rings, [original, island]);
  assert.equal(collectCoordinatePairs({ water: [rendered] }).coordinates.length, 15);
});

test('explicit source lines omit artificial source or acquisition bounds', () => {
  const water = { ring: box(0, 0, 100, 100), shoreline: { lines: [{ line: [[0, 0], [0, 100]] }] } };
  assert.equal(waterShoreDistance(100, 50, water), 100);
  assert.equal(waterShoreDistance(1, 50, water), 1);
  assert.equal(waterShoreDistance(100, 50, { ...water, shoreline: { lines: [] } }), 1e6);
  assert.equal(collectCoordinatePairs({ water: [water] }).coordinates.length, 7);
});

test('existing unpartitioned water keeps its serialized shape and distance behavior', () => {
  const water = { ring: box(0, 0, 100, 100), level: 2, isLake: true, area: 10000 };
  assert.equal(JSON.stringify(runtimeWater(water)), JSON.stringify({ ring: water.ring, level: 2, isLake: true, isSea: false, area: 10000 }));
  assert.equal(waterShoreDistance(20, 40, water), 20);
  assert.equal(waterShoreDistance(-1, 40, water), 0);
});
