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

test('a refined quad wants its children out of view too, so turning reveals a tile and not a hole in the quad', () => {
  const data = ground();
  const manager = new TerrainTileManager({ ground: data, courseSlug: 'test-course' });
  const seen = ['l0/0/0', 'l0/0/1', 'l0/1/0'];
  /* three children in the frustum and resident, the fourth out of it */
  const partial = plan(manager, { residentTileIds: [...seen, 'l1/0/0', 'shell'], visible: tile => tile.id !== 'l0/1/1' });
  assert.deepEqual(partial.desiredTileIds, seen);
  assert.deepEqual(partial.renderTileIds, seen, 'the three fine tiles draw');
  assert.ok(partial.retainTileIds.includes('l0/1/1'), 'the unseen child is kept once it arrives');
  const prefetch = partial.requests.find(request => request.tileId === 'l0/1/1');
  assert.ok(prefetch, 'and requested');
  assert.ok(partial.requests.every(request => request.tileId === 'l0/1/1' || request.priority < prefetch.priority), 'behind everything the camera can see');
  /* the camera turns: with the fourth resident the quad renders whole; without it the
     render rule stands the parent in for all four -- the flip this prefetch exists to prevent */
  assert.deepEqual(plan(manager, { residentTileIds: [...seen, 'l0/1/1', 'l1/0/0'] }).renderTileIds, [...seen, 'l0/1/1'].sort());
  assert.deepEqual(plan(manager, { residentTileIds: [...seen, 'l1/0/0'] }).renderTileIds, ['l1/0/0']);
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

test('explicit parent ids from a ring compilation drive refinement across unaligned lattices', async () => {
  const { compileTerrainRings } = await import('../terrain-rings.mjs');
  /* a smooth field refines nowhere at any budget; the knoll near the course
     centre is what gives the finer levels an error worth refining to */
  const field = (e, n) => 40 + 0.004 * (e - 1000) + Math.sin((n - 2000) / 90) * 3 +
    (Math.hypot(e - 1007, n - 1995) < 6 ? 4 : 0);
  const level = ({ lod, spacing, originEasting, originNorthing, tilesPerSide }) => {
    const size = tilesPerSide * 8 + 1;
    const heights = new Float64Array(size * size);
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      heights[row * size + column] = field(originEasting + column * spacing, originNorthing - row * spacing);
    }
    return { lod, sampleSpacingMetres: spacing, originEasting, originNorthing, tilesPerSide, heightScaleMetres: 0.01 * 2 ** lod, heights };
  };
  const compiled = compileTerrainRings({
    groundId: 'ring-ground', courseSlugs: ['ring-course'], tileSegments: 8,
    levels: [
      level({ lod: 0, spacing: 1, originEasting: 984, originNorthing: 2016, tilesPerSide: 4 }),
      level({ lod: 1, spacing: 2, originEasting: 968, originNorthing: 2032, tilesPerSide: 4 }),
      level({ lod: 2, spacing: 4, originEasting: 936, originNorthing: 2064, tilesPerSide: 4 }),
      level({ lod: 3, spacing: 8, originEasting: 936, originNorthing: 2064, tilesPerSide: 2 }),
      level({ lod: 4, spacing: 16, originEasting: 936, originNorthing: 2064, tilesPerSide: 1 }),
    ],
  });
  const manager = new TerrainTileManager({ ground: { shell: compiled.shell, tiles: compiled.tiles }, courseSlug: 'ring-course' });
  assert.deepEqual(manager.roots.map(tile => tile.id), ['l4/0/0']);
  assert.equal(manager.parentById.get('l0/0/0'), 'l1/1/1');
  assert.equal(manager.parentById.get('l1/0/0'), 'l2/1/1');
  assert.equal(manager.childrenById.get('l1/1/1').length, 4);
  /* a camera over the course refines all the way to the 1 m tiles under it */
  const result = manager.plan({
    camera: { easting: 1007, northing: 1995, heightRH2000: 55 },
    viewportHeightPixels: 1000, fieldOfViewYRadians: Math.PI / 2, targetErrorPixels: 1, maximumSelectedTiles: 64,
  });
  assert.ok(result.desiredTileIds.some(id => id.startsWith('l0/')), `expected 1 m tiles in ${result.desiredTileIds}`);
  assert.ok(result.desiredTileIds.some(id => id.startsWith('l3/') || id.startsWith('l2/')), 'the far ring stays coarse');
  /* a graph whose explicit parent is missing is refused */
  const broken = compiled.tiles.map(tile => (tile.id === 'l0/0/0' ? { ...tile, parentId: 'l1/9/9' } : tile));
  assert.throws(() => new TerrainTileManager({ ground: { shell: compiled.shell, tiles: broken }, courseSlug: 'ring-course' }), /names parent/);
});
