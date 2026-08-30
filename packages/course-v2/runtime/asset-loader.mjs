import { validateRootIndex } from '../schema.mjs';
import {
  CacheStorageByteCache,
  NetworkFirstJsonStore,
  VerifiedImmutableStore,
} from './cache.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from './http.mjs';
import { AssetRequestScheduler } from './request-scheduler.mjs';

export { createHttpByteFetcher } from './http.mjs';

export class CourseV2AssetLoader {
  constructor({
    baseUrl,
    workerClient,
    fetchImpl = globalThis.fetch,
    immutableCache,
    rootCache,
    cacheStorage = globalThis.caches,
    maxConcurrent = 3,
  } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!workerClient?.decode) throw new TypeError('workerClient must implement decode');
    this.baseUrl = new URL(baseUrl).href;
    this.workerClient = workerClient;
    const fetchBytes = createHttpByteFetcher(fetchImpl);
    this.immutableCache = immutableCache || new CacheStorageByteCache({
      cacheStorage,
      cacheName: 'banvy-v2-immutable',
      contentType: 'application/vnd.banvy.chunk-v2',
    });
    this.rootCache = rootCache || new CacheStorageByteCache({
      cacheStorage,
      cacheName: 'banvy-v2-root',
      contentType: 'application/json',
    });
    this.immutableStore = new VerifiedImmutableStore({
      cache: this.immutableCache,
      fetchBytes,
      urlFor: reference => resolveV2AssetUrl(reference.url, this.baseUrl),
    });
    this.rootStore = new NetworkFirstJsonStore({ fetchBytes, cache: this.rootCache });
    this.scheduler = new AssetRequestScheduler({
      maxConcurrent,
      load: async (reference, { signal }) => {
        const loaded = await this.immutableStore.load(reference, {
          signal,
          verify: (ref, data, context) => this.workerClient.decode(ref, data, context),
        });
        return loaded.value;
      },
    });
  }

  loadRoot(relative = 'courses/v2-index.json', options = {}) {
    return this.rootStore.load(resolveV2AssetUrl(relative, this.baseUrl), {
      signal: options.signal,
      validate: validateRootIndex,
      label: 'v2 root manifest',
    });
  }

  request(reference, options = {}) {
    return this.scheduler.request(reference, options);
  }

  cancelScope(scope) {
    return this.scheduler.cancelScope(scope);
  }

  reprioritizeScope(scope, priority) {
    return this.scheduler.reprioritizeScope(scope, priority);
  }

  stats() {
    return this.scheduler.stats();
  }

  dispose({ disposeWorker = false } = {}) {
    this.scheduler.dispose();
    if (disposeWorker) this.workerClient.dispose?.();
  }
}
