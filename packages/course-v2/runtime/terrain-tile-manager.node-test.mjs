import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTerrainAssets } from '../terrain-compiler-node.mjs';
import {
  TerrainTileManager,
  terrainTileQualityProfile,
} from './terrain-tile-manager.mjs';

function terrain(width, height) {
  const heights = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      heights[row * width + column] = 35 + row * 0.1 + column * 0.05;
    }
  }
  heights[3 * width + 3] += 1.25;
  return heights;
}

function ground() {
  const compiled = compileTerrainAssets({
    groundId: 'test-ground',
    courseSlugs: ['test-course'],
    heights: terrain(9, 9),
    width: 9,
    height: 9,
    originEasting: 650000,
    originNorthing: 6640008,
    tileSegments: 4,
  });
  return { shell: compiled.shell, tiles: compiled.tiles };
}

function plan(manager, overrides = {}) {
  return manager.plan({
    camera: { easting: 650004, northing: 6640508, heightRH2000: 36 },
    viewportHeightPixels: 1000,
    fieldOfViewYRadians: Math.PI / 2,
    targetErrorPixels: 1,
    maximumSelectedTiles: 8,
    ...overrides,
  });
}

test('screen-space error refines near terrain and hysteresis prevents threshold flicker', () => {
  const manager = new TerrainTileManager({ ground: ground(), courseSlug: 'test-course' });
  const near = plan(manager);
  assert.deepEqual(near.refinedTileIds, ['l1/0/0']);
  assert.deepEqual(near.desiredTileIds, ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']);

  const middleCamera = { easting: 650004, northing: 6640608, heightRH2000: 36 };
  assert.deepEqual(plan(manager, { camera: middleCamera }).refinedTileIds, ['l1/0/0']);
  const fresh = new TerrainTileManager({ ground: ground(), courseSlug: 'test-course' });
  assert.deepEqual(plan(fresh, { camera: middleCamera }).desiredTileIds, ['l1/0/0']);
});

test('active-hole path overrides the normal mobile tile budget', () => {
  const manager = new TerrainTileManager({ ground: ground(), courseSlug: 'test-course' });
  const result = plan(manager, {
    camera: { easting: 650004, northing: 6650008, heightRH2000: 36 },
    maximumSelectedTiles: 2,
    activeTileIds: ['l0/0/0'],
  });
  assert.equal(result.budgetExceededByActive, true);
  assert.equal(result.selectedTiles, 4);
  assert.equal(result.requests.find(item => item.tileId === 'l0/0/0').activePath, true);
});

test('render frontier falls back coherently from children to parent and then shell', () => {
  const data = ground();
  const manager = new TerrainTileManager({ ground: data, courseSlug: 'test-course' });
  const shell = plan(manager, { residentTileIds: ['shell'] });
  assert.deepEqual(shell.renderTileIds, ['shell']);
  assert.equal(shell.shellRequired, true);
  assert.equal(shell.coverageComplete, true);

  const parent = plan(manager, { residentTileIds: ['l1/0/0'] });
  assert.deepEqual(parent.renderTileIds, ['l1/0/0']);
  assert.equal(parent.shellRequired, false);

  const children = ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1'];
  assert.deepEqual(plan(manager, { residentTileIds: children }).renderTileIds, children);
  assert.deepEqual(plan(manager, {
    residentTileIds: ['l1/0/0', 'l0/0/0'],
  }).renderTileIds, ['l1/0/0']);

  const cold = plan(manager);
  assert.equal(cold.coverageComplete, false);
  assert.equal(cold.requests[0].tileId, 'shell');
  assert.equal(cold.requests[1].tileId, 'l1/0/0');
});

test('WebGPU and WebGL2 use the same selector with explicit quality budgets', () => {
  assert.deepEqual(terrainTileQualityProfile({ backend: 'webgpu', mobile: false }), {
    targetErrorPixels: 1,
    maximumSelectedTiles: 48,
  });
  assert.deepEqual(terrainTileQualityProfile({ backend: 'webgl2', mobile: true }), {
    targetErrorPixels: 2.5,
    maximumSelectedTiles: 16,
  });
  assert.throws(() => terrainTileQualityProfile({ backend: 'webgl1' }), /webgpu or webgl2/);
});

test('tile manager rejects inconsistent hierarchy and unknown active-hole tiles', () => {
  const broken = structuredClone(ground());
  const parent = broken.tiles.find(tile => tile.id === 'l1/0/0');
  parent.bounds.maxEasting = parent.bounds.minEasting + 1;
  assert.throws(() => new TerrainTileManager({
    ground: broken,
    courseSlug: 'test-course',
  }), /does not contain child/);

  const manager = new TerrainTileManager({ ground: ground(), courseSlug: 'test-course' });
  assert.throws(() => plan(manager, { activeTileIds: ['l0/9/9'] }), /not in this course/);
});
