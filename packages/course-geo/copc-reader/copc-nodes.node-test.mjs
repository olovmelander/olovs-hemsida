import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeCache, nodeFootprint, nodeKey, nodesForWindow, safeCopcUrl } from './copc-nodes.mjs';

/* a half-tile item: 10 km wide, 5 km tall, like Puttom's south scan */
const DATA = [690000, 7020000, 699999.99, 7024999.99];

test('footprints subdivide the header extent per axis, so nodes are rectangular', () => {
  const root = nodeFootprint(DATA, { d: 0, x: 0, y: 0, z: 0 });
  assert.deepEqual(root, DATA);
  const node = nodeFootprint(DATA, { d: 5, x: 23, y: 19, z: 15 });
  assert.ok(Math.abs(node[0] - 697187.49) < 0.01);
  assert.ok(Math.abs(node[1] - 7022968.74) < 0.01);
  assert.ok(Math.abs((node[2] - node[0]) - 312.5) < 0.01);
  assert.ok(Math.abs((node[3] - node[1]) - 156.25) < 0.01);
});

test('a window selects every node whose padded footprint touches it, at every depth', () => {
  const entries = [
    { d: 0, x: 0, y: 0, z: 0, pointCount: 1 },
    { d: 5, x: 23, y: 19, z: 15, pointCount: 1 },
    { d: 5, x: 24, y: 19, z: 15, pointCount: 1 },
    { d: 5, x: 23, y: 21, z: 15, pointCount: 1 },
    { d: 6, x: 46, y: 39, z: 30, pointCount: 1 },
    { d: 6, x: 47, y: 39, z: 30, pointCount: 1 },
  ];
  const window = [697400, 7023000, 697520, 7023100];
  const selected = nodesForWindow(DATA, entries, window).map(nodeKey);
  assert.ok(selected.includes('0-0-0-0'), 'the root always can hold a point');
  assert.ok(selected.includes('5-23-19-15'));
  assert.ok(selected.includes('5-24-19-15'), 'the window crosses into the next column');
  assert.ok(!selected.includes('5-23-21-15'), 'two rows north is out of reach');
  assert.ok(!selected.includes('6-46-39-30'), 'depth-6 column 46 ends at 697343.7, well short of the window');
  assert.ok(selected.includes('6-47-39-30'), 'depth-6 column 47 spans 697343.7..697500 and row 39 spans 7023046.9..7023125');
  /* the pad reaches a node that ends one metre short of the window */
  const shy = nodesForWindow(DATA, [{ d: 5, x: 22, y: 19, z: 15, pointCount: 1 }], [697188.5, 7023000, 697300, 7023100], { padMetres: 2 });
  assert.equal(shy.length, 1);
  assert.equal(nodesForWindow(DATA, [{ d: 5, x: 22, y: 19, z: 15, pointCount: 1 }], [697188.5, 7023000, 697300, 7023100], { padMetres: 0.5 }).length, 0);
});

test('the cache evicts oldest nodes past its point budget and never double-counts', () => {
  const cache = createNodeCache({ maxPoints: 10 });
  cache.set('a', { count: 4 });
  cache.set('b', { count: 4 });
  cache.set('b', { count: 4 });
  assert.equal(cache.points, 8);
  cache.set('c', { count: 4 });
  assert.equal(cache.get('a'), null, 'the oldest node left');
  assert.ok(cache.get('c'));
  assert.equal(cache.size, 2);
});

test('only Laserdata Skog COPC assets are opened', () => {
  assert.ok(safeCopcUrl('https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/26f015/m26f015-702_69.copc.laz'));
  assert.throws(() => safeCopcUrl('https://dl1.lantmateriet.se/hojd/data/grid/mhm/70_6/m702_69.tif'), /refusing/);
  assert.throws(() => safeCopcUrl('https://example.org/x.copc.laz'), /refusing/);
});
