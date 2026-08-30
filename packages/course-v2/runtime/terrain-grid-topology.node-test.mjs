import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTerrainGridTopology } from './terrain-grid-topology.mjs';

test('shared terrain topology builds an upward surface and closed boundary skirt', () => {
  const topology = createTerrainGridTopology({ width: 3, height: 3 });
  assert.equal(topology.surfaceVertexCount, 9);
  assert.equal(topology.boundaryVertexCount, 8);
  assert.equal(topology.vertexCount, 17);
  assert.equal(topology.surfaceTriangleCount, 8);
  assert.equal(topology.skirtTriangleCount, 16);
  assert.equal(topology.triangleCount, 24);
  assert.equal(topology.indices.length, 72);
  assert.deepEqual([...topology.indices.subarray(0, 6)], [0, 3, 1, 1, 3, 4]);
  assert.equal(topology.positions[9 * 3 + 1], -1);
  assert.equal(Math.max(...topology.indices), 16);
});

test('257-square production topology uses one shared uint32 index buffer', () => {
  const topology = createTerrainGridTopology({ width: 257, height: 257 });
  assert.ok(topology.indices instanceof Uint32Array);
  assert.equal(topology.surfaceVertexCount, 66_049);
  assert.equal(topology.boundaryVertexCount, 1_024);
  assert.equal(topology.triangleCount, 133_120);
  assert.ok(topology.cpuBytes < 3 * 1024 * 1024);
});

test('topology dimensions are bounded before large browser allocations', () => {
  assert.throws(() => createTerrainGridTopology({ width: 1, height: 3 }), /width/);
  assert.throws(() => createTerrainGridTopology({ width: 2049, height: 3 }), /width/);
});
