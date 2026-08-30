import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJsonBytes } from '../canonical-json.mjs';
import { parseChunkEnvelope } from '../chunk.mjs';
import { assetReferenceForChunk, sha256Bytes, verifyChunkAsset } from '../chunk-node.mjs';
import { validateRootIndex } from '../schema.mjs';
import { createSyntheticAssetGraph } from '../synthetic-fixture.mjs';
import { MemoryByteCache, NetworkFirstJsonStore, VerifiedImmutableStore } from './cache.mjs';
import { CourseV2AssetLoader } from './asset-loader.mjs';
import { installChunkWorker } from './chunk-worker.mjs';
import { verifyChunkAssetWeb } from './decode-web.mjs';
import { HttpStatusError, resolveV2AssetUrl } from './http.mjs';
import { CourseV2ManifestLoader, assertManifestGraph } from './manifest-loader.mjs';
import { verifyCourseManifestWeb } from './manifest-web.mjs';
import { AssetRequestScheduler } from './request-scheduler.mjs';
import { ResourceLeasePool } from './resource-pool.mjs';
import { ChunkWorkerClient } from './worker-client.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixtureChunk(kind = 'terrain') {
  const graph = createSyntheticAssetGraph();
  for (const [url, data] of graph.resources) {
    if (!url.endsWith('.bvch')) continue;
    const parsed = parseChunkEnvelope(data);
    if (parsed.header.kind !== kind) continue;
    return {
      data,
      reference: assetReferenceForChunk(data, { kind, directory: `assets/${kind}` }),
    };
  }
  throw new Error(`missing fixture ${kind}`);
}

class WorkerScope {
  constructor() {
    this.listeners = new Set();
    this.messages = [];
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  async dispatch(message) {
    await Promise.all([...this.listeners].map(listener => listener({ data: message })));
  }
}

class ManualWorker {
  constructor() {
    this.listeners = new Map([['message', new Set()], ['error', new Set()], ['messageerror', new Set()]]);
    this.sent = [];
    this.terminated = false;
  }

  addEventListener(type, listener) { this.listeners.get(type)?.add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  emit(type, data) { for (const listener of this.listeners.get(type) || []) listener({ data }); }
}

test('browser verifier matches the Node verifier for every synthetic chunk', async () => {
  const graph = createSyntheticAssetGraph();
  let checked = 0;
  for (const [url, data] of graph.resources) {
    if (!url.endsWith('.bvch')) continue;
    const header = parseChunkEnvelope(data).header;
    const reference = assetReferenceForChunk(data, { kind: header.kind, directory: `assets/${header.kind}` });
    const node = verifyChunkAsset(reference, data);
    const web = await verifyChunkAssetWeb(reference, data);
    assert.equal(web.header.decodedSha256, node.header.decodedSha256);
    assert.equal(sha256Bytes(web.payload), node.header.decodedSha256);
    assert.deepEqual(web.content, node.content);
    assert.deepEqual(web.inspection, node.inspection);
    checked++;
  }
  assert.equal(checked, 5);
});

test('browser verifier fails closed on abort and corrupted encoded bytes', async () => {
  const { data, reference } = fixtureChunk();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyChunkAssetWeb(reference, data, { signal: controller.signal }), error => error.name === 'AbortError');
  const corrupt = Buffer.from(data); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(verifyChunkAssetWeb(reference, corrupt), /integrity mismatch/);
});

test('worker protocol returns transferable verified payloads and explicit protocol errors', async () => {
  const scope = new WorkerScope();
  const uninstall = installChunkWorker(scope);
  const { data, reference } = fixtureChunk('routing');
  const exact = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await scope.dispatch({ type: 'decode', id: 7, reference, buffer: exact });
  assert.equal(scope.messages[0].type, 'decoded');
  assert.equal(scope.messages[0].id, 7);
  assert.ok(scope.messages[0].payload instanceof ArrayBuffer);
  assert.equal(scope.messages[0].content.courseSlug, 'synthetic-main');
  await scope.dispatch({ type: 'decode', id: 'bad', reference, buffer: exact });
  assert.equal(scope.messages[1].type, 'protocol-error');
  uninstall();
});

test('worker prepares compact terrain GPU texels off the main thread', async () => {
  const scope = new WorkerScope();
  const uninstall = installChunkWorker(scope);
  const { data, reference } = fixtureChunk('terrain');
  const exact = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await scope.dispatch({ type: 'decode', id: 8, reference, buffer: exact });
  const message = scope.messages[0];
  assert.equal(message.type, 'decoded');
  assert.equal(message.terrainRenderData.layout, 'rgba8x2-height-parent-octnormal-v1');
  assert.ok(message.terrainRenderData.textureData instanceof ArrayBuffer);
  assert.equal(message.terrainRenderData.textureData.byteLength, 3 * 3 * 8);
  uninstall();
});

test('worker client aborts one request, ignores its late reply and disposes all pending work', async () => {
  const worker = new ManualWorker();
  const client = new ChunkWorkerClient(worker);
  const { data, reference } = fixtureChunk();
  const controller = new AbortController();
  const aborted = client.decode(reference, new Uint8Array(data), { signal: controller.signal });
  const firstId = worker.sent[0].id;
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  assert.deepEqual(worker.sent.at(-1), { type: 'cancel', id: firstId });
  worker.emit('message', { type: 'decoded', id: firstId, payload: new ArrayBuffer(2) });

  const pending = client.decode(reference, new Uint8Array(data));
  client.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(worker.terminated, true);
});

test('scheduler honors stable priority after the active request and suppresses cancelled scope work', async () => {
  const gate = deferred();
  const order = [];
  const scheduler = new AssetRequestScheduler({
    maxConcurrent: 1,
    load: async reference => {
      order.push(reference.url);
      if (reference.url === 'active') await gate.promise;
      return reference.url;
    },
  });
  const reference = url => ({ url, bytes: 1, sha256: url, decodedBytes: 1, decodedSha256: url, kind: 'terrain' });
  const active = scheduler.request(reference('active'), { priority: 0, scope: 'hole-1' });
  await tick();
  const low = scheduler.request(reference('low'), { priority: 100, scope: 'prefetch' });
  const cancelled = scheduler.request(reference('cancelled'), { priority: 2, scope: 'old-hole' });
  const high = scheduler.request(reference('high'), { priority: 1, scope: 'hole-2' });
  assert.equal(scheduler.cancelScope('old-hole'), 1);
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  gate.resolve();
  assert.deepEqual(await Promise.all([active, high, low]), ['active', 'high', 'low']);
  assert.deepEqual(order, ['active', 'high', 'low']);
  assert.deepEqual(scheduler.stats(), { queued: 0, running: 0, jobs: 0 });
});

test('scheduler deduplicates consumers and aborts transport only after the last consumer leaves', async () => {
  const gate = deferred();
  let calls = 0;
  let transportAborted = false;
  const scheduler = new AssetRequestScheduler({
    load: async (reference, { signal }) => {
      calls++;
      signal.addEventListener('abort', () => { transportAborted = true; });
      await gate.promise;
      return reference.url;
    },
  });
  const reference = { url: 'shared', bytes: 1, sha256: 'a', decodedBytes: 1, decodedSha256: 'b', kind: 'terrain' };
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = scheduler.request(reference, { signal: firstController.signal, scope: 'a' });
  const second = scheduler.request(reference, { signal: secondController.signal, scope: 'b' });
  await tick();
  firstController.abort();
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal(transportAborted, false);
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal(await second, 'shared');

  const hanging = deferred();
  const scheduler2 = new AssetRequestScheduler({
    load: async (ref, { signal }) => {
      signal.addEventListener('abort', () => hanging.resolve('aborted'));
      await hanging.promise;
      throw signal.reason;
    },
  });
  const controller = new AbortController();
  const promise = scheduler2.request(reference, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(promise, error => error.name === 'AbortError');
  assert.equal(await hanging.promise, 'aborted');
});

test('verified immutable store evicts a corrupt cache entry, retries network once and then hits cache', async () => {
  const { data, reference } = fixtureChunk();
  const cache = new MemoryByteCache();
  const bad = Buffer.from(data); bad[bad.length - 1] ^= 1;
  await cache.put(reference.url, bad);
  let fetches = 0;
  const store = new VerifiedImmutableStore({
    cache,
    fetchBytes: async () => { fetches++; return data; },
  });
  const verify = (ref, bytes, options) => verifyChunkAssetWeb(ref, bytes, options);
  const repaired = await store.load(reference, { verify });
  assert.equal(repaired.cacheHit, false);
  assert.equal(fetches, 1);
  const cached = await store.load(reference, { verify });
  assert.equal(cached.cacheHit, true);
  assert.equal(fetches, 1);
});

test('invalid network chunks are never committed to immutable cache', async () => {
  const { data, reference } = fixtureChunk();
  const cache = new MemoryByteCache();
  const bad = Buffer.from(data); bad[bad.length - 1] ^= 1;
  const store = new VerifiedImmutableStore({ cache, fetchBytes: async () => bad });
  await assert.rejects(store.load(reference, {
    verify: (ref, bytes, options) => verifyChunkAssetWeb(ref, bytes, options),
  }), /integrity mismatch/);
  assert.equal(await cache.match(reference.url), null);
});

test('immutable store preserves encoded bytes when a Worker verifier transfers its input', async () => {
  const { data, reference } = fixtureChunk();
  const cache = new MemoryByteCache();
  const store = new VerifiedImmutableStore({ cache, fetchBytes: async () => new Uint8Array(data) });
  await store.load(reference, {
    verify: async (ref, input) => {
      assert.equal(input.byteOffset, 0);
      assert.equal(input.byteLength, input.buffer.byteLength);
      structuredClone(input.buffer, { transfer: [input.buffer] });
      return { sha256: ref.sha256 };
    },
  });
  const stored = await cache.match(reference.url);
  assert.equal(stored.byteLength, reference.bytes);
  assert.equal(sha256Bytes(stored), reference.sha256);
});

test('root manifest is network-first, uses cache only on fetch failure and rejects invalid fresh data', async () => {
  const graph = createSyntheticAssetGraph();
  const data = canonicalJsonBytes(graph.root);
  const cache = new MemoryByteCache();
  await cache.put('courses/v2-index.json', data);
  const offline = new NetworkFirstJsonStore({ cache, fetchBytes: async () => { throw new Error('offline'); } });
  const fallback = await offline.load('courses/v2-index.json', { validate: validateRootIndex });
  assert.equal(fallback.source, 'cache');
  assert.equal(fallback.value.courses.length, 2);

  const online = new NetworkFirstJsonStore({ cache, fetchBytes: async () => data });
  assert.equal((await online.load('courses/v2-index.json', { validate: validateRootIndex })).source, 'network');

  const invalid = canonicalJsonBytes({ schemaVersion: 2, courses: [] });
  const broken = new NetworkFirstJsonStore({ cache, fetchBytes: async () => invalid });
  await assert.rejects(broken.load('courses/v2-index.json', { validate: validateRootIndex }), /invalid root manifest/);
});

test('a real HTTP error never resurrects a stale v2 root from offline cache', async () => {
  const graph = createSyntheticAssetGraph();
  const cache = new MemoryByteCache();
  const url = 'https://banvy.test/app/courses/v2-index.json';
  await cache.put(url, canonicalJsonBytes(graph.root));
  const removed = new NetworkFirstJsonStore({
    cache,
    fetchBytes: async () => { throw new HttpStatusError(404, url); },
  });
  await assert.rejects(removed.load(url, { validate: validateRootIndex }), error => {
    assert.equal(error.status, 404);
    return true;
  });

  const transient = new NetworkFirstJsonStore({
    cache,
    fetchBytes: async () => { throw new HttpStatusError(503, url); },
  });
  assert.equal((await transient.load(url, { validate: validateRootIndex })).source, 'cache');
});

test('v2 URL resolution is app-base scoped and rejects encoded traversal', () => {
  const base = 'https://banvy.test/olovs-hemsida/';
  assert.equal(
    resolveV2AssetUrl('courses/v2-index.json', base),
    'https://banvy.test/olovs-hemsida/courses/v2-index.json',
  );
  assert.throws(() => resolveV2AssetUrl('../outside.json', base), /traversal/);
  assert.throws(() => resolveV2AssetUrl('%2e%2e/outside.json', base), /traversal/);
  assert.throws(() => resolveV2AssetUrl('courses%5coutside.json', base), /encoded delimiter/);
  assert.throws(() => resolveV2AssetUrl('courses/index.json', 'https://banvy.test/app'), /directory URL/);
});

test('browser manifest verifier enforces size, SHA, canonical JSON and feature support', async () => {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses[0];
  const data = graph.resources.get(entry.manifest.url);
  const course = await verifyCourseManifestWeb(entry.manifest, data);
  assert.equal(course.slug, entry.slug);

  const corrupt = Buffer.from(data);
  corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(verifyCourseManifestWeb(entry.manifest, corrupt), /integrity mismatch/);

  const pretty = Buffer.from(JSON.stringify(course, null, 2));
  const prettySha = sha256Bytes(pretty);
  const prettyReference = {
    ...entry.manifest,
    url: `courses/${entry.slug}/course-v2-${prettySha}.json`,
    bytes: pretty.byteLength,
    sha256: prettySha,
  };
  await assert.rejects(verifyCourseManifestWeb(prettyReference, pretty), /not canonical JSON/);

  const future = structuredClone(course);
  future.requiredFeatures = [
    'chunk-envelope-v2', 'course-routing-json-v1', 'future-mesh-v9', 'terrain-grid-u16-v1',
  ];
  const futureData = Buffer.from(canonicalJsonBytes(future));
  const futureSha = sha256Bytes(futureData);
  const futureReference = {
    ...entry.manifest,
    url: `courses/${entry.slug}/course-v2-${futureSha}.json`,
    bytes: futureData.byteLength,
    sha256: futureSha,
  };
  await assert.rejects(verifyCourseManifestWeb(futureReference, futureData), /unsupported features: future-mesh-v9/);
});

test('manifest loader verifies root, course and parent ground without fetching chunks', async () => {
  const graph = createSyntheticAssetGraph();
  const base = 'https://banvy.test/app/';
  const rootUrl = new URL('courses/v2-index.json', base).href;
  const rootCache = new MemoryByteCache();
  const manifestCache = new MemoryByteCache();
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(url);
    if (url === rootUrl) return new Response(canonicalJsonBytes(graph.root));
    const relative = new URL(url).pathname.replace('/app/', '');
    const resource = graph.resources.get(relative);
    return resource ? new Response(resource) : new Response('missing', { status: 404 });
  };
  const online = new CourseV2ManifestLoader({
    baseUrl: base,
    fetchImpl,
    rootCache,
    manifestCache,
  });
  const first = await online.resolve('synthetic-main');
  assert.equal(first.rootSource, 'network');
  assert.equal(first.courseCacheHit, false);
  assert.equal(first.groundCacheHit, false);
  assert.equal(first.ground.groundId, 'synthetic-ground');
  assert.equal(fetched.length, 3);
  assert.equal(fetched.some(url => url.endsWith('.bvch')), false);

  const offline = new CourseV2ManifestLoader({
    baseUrl: base,
    fetchImpl: async () => { throw new Error('offline'); },
    rootCache,
    manifestCache,
  });
  const cached = await offline.resolve('synthetic-main');
  assert.equal(cached.rootSource, 'cache');
  assert.equal(cached.courseCacheHit, true);
  assert.equal(cached.groundCacheHit, true);
});

test('manifest graph rejects undeclared course tiles and asset features before streaming', () => {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses[0];
  const course = JSON.parse(graph.resources.get(entry.manifest.url));
  const ground = JSON.parse(graph.resources.get(course.groundManifest.url));
  const undeclared = structuredClone(ground);
  undeclared.tiles[0].courses = ['synthetic-short'];
  assert.throws(() => assertManifestGraph(entry, course, undeclared), /does not declare course/);

  const future = structuredClone(ground);
  future.shell.requiredFeatures = ['chunk-envelope-v2', 'future-terrain-v9', 'terrain-grid-u16-v1'];
  assert.throws(() => assertManifestGraph(entry, course, future), /unsupported features: future-terrain-v9/);
});

test('resource pool deduplicates creation, reference-counts leases and evicts LRU unused resources', async () => {
  const disposed = [];
  const pool = new ResourceLeasePool({ maxEntries: 1, dispose: (value, key) => disposed.push([key, value]) });
  let creates = 0;
  const [a1, a2] = await Promise.all([
    pool.acquire('a', async () => { creates++; return { id: 'A' }; }),
    pool.acquire('a', async () => { creates++; return { id: 'wrong' }; }),
  ]);
  assert.equal(creates, 1);
  assert.equal(a1.value, a2.value);
  assert.equal(a1.release(), true);
  assert.equal(a1.release(), false);
  assert.deepEqual(pool.stats(), { entries: 1, referenced: 1, loading: 0 });
  a2.release();
  const b = await pool.acquire('b', async () => ({ id: 'B' }));
  b.release();
  assert.deepEqual(disposed, [['a', { id: 'A' }]]);
  assert.deepEqual(pool.stats(), { entries: 1, referenced: 0, loading: 0 });
  assert.equal(pool.evictUnused(), 1);
  assert.deepEqual(disposed.at(-1), ['b', { id: 'B' }]);
});

test('composed loader keeps root network-first and deduplicates immutable worker requests', async () => {
  const graph = createSyntheticAssetGraph();
  const base = 'https://banvy.test/app/';
  const rootUrl = new URL('courses/v2-index.json', base).href;
  const rootBytes = canonicalJsonBytes(graph.root);
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(url);
    if (url === rootUrl) return new Response(rootBytes);
    const relative = new URL(url).pathname.replace('/app/', '');
    const resource = graph.resources.get(relative);
    return resource ? new Response(resource) : new Response('missing', { status: 404 });
  };
  let decodes = 0;
  const workerClient = {
    decode: async (reference, data, options) => {
      decodes++;
      return verifyChunkAssetWeb(reference, data, options);
    },
  };
  const loader = new CourseV2AssetLoader({
    baseUrl: base,
    fetchImpl,
    workerClient,
    immutableCache: new MemoryByteCache(),
    rootCache: new MemoryByteCache(),
    maxConcurrent: 2,
  });
  assert.equal((await loader.loadRoot()).source, 'network');
  const { data, reference } = fixtureChunk();
  assert.equal(graph.resources.get(reference.url).byteLength, data.byteLength);
  const [first, second] = await Promise.all([
    loader.request(reference, { scope: 'hole-1', priority: 0 }),
    loader.request(reference, { scope: 'hole-1', priority: 0 }),
  ]);
  assert.equal(first.header.decodedSha256, second.header.decodedSha256);
  assert.equal(decodes, 1);
  assert.equal(fetched.filter(url => url.endsWith(reference.url)).length, 1);
  loader.dispose();
});
