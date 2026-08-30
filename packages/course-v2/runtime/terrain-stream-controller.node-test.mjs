import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTerrainAssets } from '../terrain-compiler-node.mjs';
import { TerrainStreamController } from './terrain-stream-controller.mjs';
import { TerrainTileManager } from './terrain-tile-manager.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

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

function fixture() {
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
  const ground = { shell: compiled.shell, tiles: compiled.tiles };
  const idsByUrl = new Map([['shell', compiled.shell], ...compiled.tiles.map(tile => [tile.id, tile.layers.terrain])]
    .map(([tileId, reference]) => [reference.url, tileId]));
  return {
    ground,
    idsByUrl,
    manager: new TerrainTileManager({ ground, courseSlug: 'test-course' }),
  };
}

class ManualLoader {
  constructor(idsByUrl) {
    this.idsByUrl = idsByUrl;
    this.pending = new Map();
    this.calls = [];
    this.aborted = [];
    this.reprioritized = [];
  }

  request(reference, options) {
    const tileId = this.idsByUrl.get(reference.url);
    this.calls.push(tileId);
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, options };
      this.pending.set(tileId, item);
      const aborted = () => {
        this.aborted.push(tileId);
        this.pending.delete(tileId);
        reject(abortError());
      };
      if (options.signal.aborted) aborted();
      else options.signal.addEventListener('abort', aborted, { once: true });
    });
  }

  resolve(tileId) {
    const item = this.pending.get(tileId);
    if (!item) throw new Error(`no pending ${tileId}`);
    this.pending.delete(tileId);
    item.resolve({ header: { id: tileId }, payload: new ArrayBuffer(8) });
  }

  reject(tileId, error = new Error(`failed ${tileId}`)) {
    const item = this.pending.get(tileId);
    if (!item) throw new Error(`no pending ${tileId}`);
    this.pending.delete(tileId);
    item.reject(error);
  }

  reprioritizeScope(scope, priority) {
    this.reprioritized.push([scope, priority]);
  }
}

function options(overrides = {}) {
  return {
    camera: { easting: 650004, northing: 6640508, heightRH2000: 36 },
    viewportHeightPixels: 1000,
    fieldOfViewYRadians: Math.PI / 2,
    targetErrorPixels: 1,
    maximumSelectedTiles: 8,
    ...overrides,
  };
}

test('stream controller progresses shell to parent to fine frontier and disposes bounded resources', async () => {
  const data = fixture();
  const loader = new ManualLoader(data.idsByUrl);
  const disposed = [];
  const changes = [];
  const controller = new TerrainStreamController({
    manager: data.manager,
    loader,
    maximumCachedResources: 8,
    createResource: ({ tileId }) => ({ tileId }),
    disposeResource: value => disposed.push(value.tileId),
    onChange: snapshot => changes.push(snapshot.renderResources.map(item => item.tileId)),
  });

  const cold = controller.update(options());
  assert.equal(cold.coverageComplete, false);
  await tick();
  assert.equal(loader.calls[0], 'shell');
  assert.equal(loader.calls[1], 'l1/0/0');

  loader.resolve('shell');
  await tick();
  assert.deepEqual(controller.renderResources().map(item => item.tileId), ['shell']);

  loader.resolve('l1/0/0');
  await tick();
  assert.deepEqual(controller.renderResources().map(item => item.tileId), ['l1/0/0']);

  for (const tileId of ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']) loader.resolve(tileId);
  await tick();
  await tick();
  assert.deepEqual(controller.renderResources().map(item => item.tileId),
    ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']);
  assert.ok(changes.some(rendered => rendered.includes('shell')));
  assert.ok(changes.some(rendered => rendered.includes('l1/0/0')));

  controller.dispose();
  assert.deepEqual(disposed.sort(), ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1', 'l1/0/0', 'shell']);
  assert.throws(() => controller.update(options()), /disposed/);
});

test('camera coarsening aborts obsolete fine-tile transports', async () => {
  const data = fixture();
  const loader = new ManualLoader(data.idsByUrl);
  const controller = new TerrainStreamController({
    manager: data.manager,
    loader,
    createResource: ({ tileId }) => ({ tileId }),
  });
  controller.update(options());
  await tick();
  controller.update(options({
    camera: { easting: 650004, northing: 6650008, heightRH2000: 36 },
  }));
  await tick();
  assert.deepEqual(loader.aborted.sort(), ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']);
  assert.equal(loader.pending.has('shell'), true);
  assert.equal(loader.pending.has('l1/0/0'), true);
  controller.dispose();
});

test('failed assets use bounded exponential backoff instead of retrying every frame', async () => {
  const data = fixture();
  const loader = new ManualLoader(data.idsByUrl);
  let now = 0;
  const controller = new TerrainStreamController({
    manager: data.manager,
    loader,
    createResource: ({ tileId }) => ({ tileId }),
    retryBaseMilliseconds: 100,
    retryMaximumMilliseconds: 400,
    clock: () => now,
  });
  controller.update(options());
  await tick();
  loader.reject('shell');
  await tick();
  assert.deepEqual(controller.snapshot().failedTileIds, ['shell']);
  assert.equal(loader.calls.filter(tileId => tileId === 'shell').length, 1);

  now = 99;
  controller.update(options());
  await tick();
  assert.equal(loader.calls.filter(tileId => tileId === 'shell').length, 1);
  now = 100;
  controller.update(options());
  await tick();
  assert.equal(loader.calls.filter(tileId => tileId === 'shell').length, 2);
  controller.dispose();
});
