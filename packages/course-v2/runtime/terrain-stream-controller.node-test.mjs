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

test('a tile the plan stops wanting stays resident through the release grace, and is drawn at once when wanted back', async () => {
  const data = fixture();
  const loader = new ManualLoader(data.idsByUrl);
  const disposed = [];
  let now = 0;
  const controller = new TerrainStreamController({
    manager: data.manager,
    loader,
    createResource: ({ tileId }) => ({ tileId }),
    disposeResource: value => disposed.push(value.tileId),
    releaseGraceMilliseconds: 1000,
    maximumRetainedTiles: 8,
    clock: () => now,
  });
  const fine = ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1'];
  const refine = async () => {
    controller.update(options());
    await tick();
    loader.resolve('shell'); await tick();
    loader.resolve('l1/0/0'); await tick();
    for (const tileId of fine) loader.resolve(tileId);
    await tick(); await tick();
    assert.deepEqual(controller.renderResources().map(item => item.tileId), fine);
  };
  await refine();
  const callsBefore = loader.calls.length;

  /* the camera moves away: the fine tiles are no longer wanted, and nothing is released yet */
  const far = options({ camera: { easting: 650004, northing: 6650008, heightRH2000: 36 } });
  now = 100;
  controller.update(far);
  await tick();
  assert.equal(controller.renderResources().some(item => fine.includes(item.tileId)), false, 'the parent is drawn while the fine tiles are unwanted');
  assert.deepEqual(disposed, [], 'nothing released inside the grace');
  assert.deepEqual(controller.snapshot().readyTileIds.filter(id => fine.includes(id)), fine, 'all four wait out the grace, resident');

  /* the camera comes back inside the grace: the retained tiles draw on the first plan back, and nothing is requested again */
  now = 600;
  controller.update(options());
  await tick();
  assert.deepEqual(controller.renderResources().map(item => item.tileId), fine, 'the retained fine tiles are drawn on the first plan back');
  assert.deepEqual(loader.calls.slice(callsBefore), [], 'no request for a tile that never left');

  /* away again, and past the grace: released */
  now = 700;
  controller.update(far);
  await tick();
  now = 2300;
  controller.update(far);
  await tick();
  assert.equal(controller.snapshot().readyTileIds.some(id => fine.includes(id)), false, 'released once the grace has run out');
  /* a released lease goes back to the pool's cache; disposal is the pool's eviction, not the release */
  assert.deepEqual([...controller.entries.keys()].sort(), ['l1/0/0', 'shell'], 'only the parent and the shell remain resident');
  controller.dispose();
});

test('the retained-tile cap releases the longest-unwanted tiles first, whatever the grace', async () => {
  const data = fixture();
  const loader = new ManualLoader(data.idsByUrl);
  const disposed = [];
  let now = 0;
  const controller = new TerrainStreamController({
    manager: data.manager,
    loader,
    createResource: ({ tileId }) => ({ tileId }),
    disposeResource: value => disposed.push(value.tileId),
    releaseGraceMilliseconds: 60_000,
    maximumRetainedTiles: 2,
    clock: () => now,
  });
  const fine = ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1'];
  controller.update(options());
  await tick();
  loader.resolve('shell'); await tick();
  loader.resolve('l1/0/0'); await tick();
  for (const tileId of fine) loader.resolve(tileId);
  await tick(); await tick();
  now = 100;
  controller.update(options({ camera: { easting: 650004, northing: 6650008, heightRH2000: 36 } }));
  await tick();
  assert.equal(controller.snapshot().readyTileIds.filter(id => fine.includes(id)).length, 2, 'two of four unwanted tiles go at once under a cap of two, two wait out the grace');
  assert.equal(controller.entries.size, 4, 'the shell, the parent and the two retained');
  controller.dispose();
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

test('a loader that answers at once cannot make the controller chase its own ancestors', async () => {
  /* Once the fine tiles were resident their ancestors fell out of the keep
     set, the next plan requested them again, the pool answered at once, and
     the resolve/reconcile chain never yielded. With an instant loader the
     controller must settle in a bounded number of requests and keep the
     ancestors of every desired tile resident. */
  const { ground, idsByUrl, manager } = fixture();
  const calls = [];
  const loader = {
    request: reference => { calls.push(idsByUrl.get(reference.url)); return Promise.resolve({ url: reference.url }); },
  };
  const controller = new TerrainStreamController({
    manager, loader, createResource: ({ tileId }) => ({ tileId }), maximumCachedResources: 32,
  });
  controller.update({
    camera: { easting: 650004, northing: 6640004, heightRH2000: 36 },
    viewportHeightPixels: 1000, fieldOfViewYRadians: Math.PI / 2, targetErrorPixels: 1, maximumSelectedTiles: 8,
  });
  for (let i = 0; i < 20; i++) await tick();
  const snapshot = controller.snapshot();
  const unique = new Set(calls);
  assert.ok(calls.length <= unique.size + 1, `requested ${calls.length} times for ${unique.size} tiles: ${calls.join(' ')}`);
  assert.ok(snapshot.readyTileIds.includes('l1/0/0'), `the parent of the desired tiles stays resident: ${snapshot.readyTileIds}`);
  assert.ok(snapshot.plan.desiredTileIds.every(id => snapshot.readyTileIds.includes(id)));
  assert.deepEqual(snapshot.loadingTileIds, []);
  controller.dispose();
});
