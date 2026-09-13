import { canonicalJson } from '../canonical-json.mjs';
import { groundAssetReferences, validateStartupManifest } from '../startup-manifest.mjs';
import { CacheStorageByteCache, VerifiedImmutableStore } from './cache.mjs';
import { CourseGenerationCache } from './course-cache.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from './http.mjs';
import { abortError, sha256Hex } from './decode-web.mjs';

function limiter(count) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < count && queue.length) {
      const { work, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return work => new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); pump(); });
}

function subscribe(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// One course owns immutable transport bytes. CPU water carving and GPU worker
// transfers receive private payload copies; neither can corrupt the next user.
export class CourseChunkSource {
  constructor({ baseUrl, graph, workerClient, fetchImpl = globalThis.fetch, cacheStorage,
    maxConcurrent = 4, decodedBudget = 16 * 1024 * 1024, cache } = {}) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new Error('invalid chunk concurrency');
    this.baseUrl = new URL(baseUrl).href;
    this.graph = graph;
    this.workerClient = workerClient;
    this.controller = new AbortController();
    this.network = limiter(maxConcurrent);
    this.decode = limiter(3);
    this.references = new Map(groundAssetReferences(graph.ground).map(ref => [ref.sha256, ref]));
    this.pending = new Map();
    this.decoded = new Map();
    this.decodedBytes = 0;
    this.decodedBudget = decodedBudget;
    this.verified = new Set();
    this.raw = new Map();
    this.packages = new Map();
    this.manifest = null;
    this.metrics = { networkBytes: 0, networkRequests: 0, cacheHits: 0, sharedHits: 0,
      decodes: 0, complete: false, fallbackReasons: [] };
    const fetchBytes = createHttpByteFetcher(fetchImpl);
    this.cache = cache || (graph.course.groundManifest?.sha256
      ? new CourseGenerationCache({ cacheStorage, generation: graph.course.groundManifest.sha256 })
      : new CacheStorageByteCache({ cacheStorage, cacheName: 'banvy-course-startup-v1' }));
    this.store = new VerifiedImmutableStore({
      cache: this.cache,
      urlFor: ref => resolveV2AssetUrl(ref.url, this.baseUrl),
      fetchBytes: (url, options) => this.network(async () => {
        const bytes = await fetchBytes(url, options);
        this.metrics.networkRequests++; this.metrics.networkBytes += bytes.byteLength;
        return bytes;
      }),
    });
  }

  async #bytes(reference) {
    const loaded = await this.store.load(reference, { signal: this.controller.signal, verify: async (ref, bytes) => {
      if (bytes.byteLength !== ref.bytes || await sha256Hex(bytes) !== ref.sha256) throw new Error('startup transport integrity mismatch');
      return bytes;
    } });
    if (loaded.cacheHit) this.metrics.cacheHits++;
    return loaded.value;
  }

  async initialize(reference) {
    if (!reference) return this;
    try {
      if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 4 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(reference.sha256)) throw new Error('invalid startup manifest reference');
      const bytes = await this.#bytes(reference);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const manifest = JSON.parse(text);
      if (canonicalJson(manifest) !== text) throw new Error('startup manifest is not canonical');
      this.manifest = validateStartupManifest(manifest, { ground: this.graph.ground,
        groundSha256: this.graph.course.groundManifest.sha256, baseUrl: this.baseUrl });
    } catch (error) {
      if (this.controller.signal.aborted) throw error;
      this.metrics.fallbackReasons.push(String(error.message));
    }
    return this;
  }

  #package(index) {
    if (!this.packages.has(index)) {
      // A failed package stays failed for this session. Its entries fall back
      // to the verified original chunks, without repeatedly requesting it.
      const promise = this.#bytes(this.manifest.packs[index]);
      promise.catch(() => {});
      this.packages.set(index, promise);
    }
    return this.packages.get(index);
  }

  async #load(reference) {
    const entry = this.manifest?.entries[reference.sha256];
    let input, startupEntry;
    if (entry) {
      try {
        const pack = await this.#package(entry.pack);
        input = pack.slice(entry.offset, entry.offset + entry.bytes);
        startupEntry = entry.codec === 'terrain-predictor-v1' ? entry : undefined;
      } catch (error) {
        if (this.controller.signal.aborted) throw error;
        const message = `package ${entry.pack}: ${error.message}`;
        if (!this.metrics.fallbackReasons.includes(message)) this.metrics.fallbackReasons.push(message);
      }
    }
    const original = async () => {
      if (!this.raw.has(reference.sha256)) this.raw.set(reference.sha256, await this.#bytes(reference));
      return this.raw.get(reference.sha256).slice();
    };
    if (!input) input = await original();
    const decode = (bytes, transport) => this.decode(() => this.workerClient.decode(reference, bytes, {
      signal: this.controller.signal, startupEntry: transport, prepareTerrain: false,
    }));
    let value;
    try { value = await decode(input, startupEntry); }
    catch (error) {
      if (!entry || this.controller.signal.aborted) throw error;
      this.metrics.fallbackReasons.push(`entry ${reference.sha256.slice(0, 12)}: ${error.message}`);
      value = await decode(await original());
    }
    this.metrics.decodes++;
    this.verified.add(reference.sha256);
    return value;
  }

  #retain(reference, value) {
    // Background verification must not evict the opening view's hot tiles.
    if (reference.kind === 'terrain' && !this.decoded.has(reference.sha256) &&
        value.payload.byteLength <= this.decodedBudget) {
      this.decoded.set(reference.sha256, value);
      this.decodedBytes += value.payload.byteLength;
      while (this.decodedBytes > this.decodedBudget) {
        const [key, first] = this.decoded.entries().next().value;
        this.decoded.delete(key); this.decodedBytes -= first.payload.byteLength;
      }
    }
  }

  load(reference, { signal, retain = true } = {}) {
    if (this.controller.signal.aborted || signal?.aborted) return Promise.reject(abortError());
    const known = this.references.get(reference.sha256);
    if (!known || canonicalJson(known) !== canonicalJson(reference)) return Promise.reject(new Error('chunk is outside the active ground generation'));
    let promise;
    if (this.decoded.has(reference.sha256)) {
      const value = this.decoded.get(reference.sha256);
      this.decoded.delete(reference.sha256); this.decoded.set(reference.sha256, value);
      this.metrics.sharedHits++; promise = Promise.resolve(value);
    } else {
      promise = this.pending.get(reference.sha256);
      if (promise) this.metrics.sharedHits++;
      else {
        promise = this.#load(reference);
        this.pending.set(reference.sha256, promise);
        const remove = () => this.pending.delete(reference.sha256);
        promise.then(remove, remove);
      }
    }
    return subscribe(promise, signal).then(value => {
      if (retain) this.#retain(reference, value);
      return { ...value, header: structuredClone(value.header),
        payload: value.payload.slice(), content: value.content ? structuredClone(value.content) : null };
    });
  }

  async ensureComplete() {
    const remaining = [...this.references.values()].filter(ref => !this.verified.has(ref.sha256));
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < remaining.length) {
        const ref = remaining[next++];
        if (!this.verified.has(ref.sha256)) await this.load(ref, { retain: false });
      }
    }));
    this.metrics.complete = this.verified.size === this.references.size;
    // Cache maintenance does not block rendering or change data readiness.
    this.cache.complete?.().then(result => { this.metrics.cache = result; }).catch(() => {});
    return this.stats();
  }

  stats() {
    return { ...this.metrics, fallbackReasons: [...this.metrics.fallbackReasons],
      packages: this.manifest?.packs.length ?? 0, chunks: this.references.size, verified: this.verified.size,
      decodedResidentBytes: this.decodedBytes };
  }

  dispose() {
    this.controller.abort(); this.workerClient.dispose?.();
    this.decoded.clear(); this.raw.clear(); this.packages.clear(); this.decodedBytes = 0;
  }
}
