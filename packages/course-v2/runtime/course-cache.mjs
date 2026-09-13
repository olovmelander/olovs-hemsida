import { CacheStorageByteCache } from './cache.mjs';

const PREFIX = 'banvy-course-generation-v1-';
const META_URL = 'https://banvy-cache.invalid/generation';
export const COURSE_CACHE_BUDGET = 128 * 1024 * 1024;

// Evict whole old grounds rather than a random subset of the next offline
// course. Current-session transport is also pinned in memory by its source.
export class CourseGenerationCache extends CacheStorageByteCache {
  constructor({ generation, cacheStorage = globalThis.caches, budget = COURSE_CACHE_BUDGET } = {}) {
    if (!/^[a-f0-9]{64}$/.test(generation)) throw new Error('invalid cache generation');
    super({ cacheStorage, cacheName: PREFIX + generation });
    this.budget = budget;
  }

  async complete() {
    if (!this.cacheStorage?.keys) return { persistent: false };
    try {
      const active = await this.cacheStorage.open(this.cacheName);
      let bytes = 0;
      for (const request of await active.keys()) {
        if (request.url === META_URL) continue;
        const response = await active.match(request);
        bytes += Number(response?.headers.get('X-Banvy-Bytes')) || 0;
      }
      await active.put(META_URL, Response.json({ bytes, usedAt: Date.now() }));
      const generations = [];
      for (const name of await this.cacheStorage.keys()) {
        if (!name.startsWith(PREFIX)) continue;
        const cache = await this.cacheStorage.open(name);
        const response = await cache.match(META_URL);
        let meta;
        try { meta = response ? await response.json() : null; } catch { meta = null; }
        // Interrupted generations have no completion receipt. Count their
        // actual stored bytes too, and reclaim them before complete courses.
        if (!meta || !Number.isFinite(meta.bytes) || meta.bytes < 0 || !Number.isFinite(meta.usedAt)) {
          let size = 0;
          for (const key of await cache.keys()) size += Number((await cache.match(key))?.headers.get('X-Banvy-Bytes')) || 0;
          meta = { bytes: size, usedAt: 0 };
        }
        generations.push({ name, ...meta });
      }
      let total = generations.reduce((n, item) => n + item.bytes, 0), evicted = 0;
      for (const item of generations.sort((a, b) => a.usedAt - b.usedAt)) {
        if (total <= this.budget) break;
        if (item.name === this.cacheName) continue;
        if (await this.cacheStorage.delete(item.name)) { total -= item.bytes; evicted++; }
      }
      return { persistent: true, bytes, totalBytes: total, evicted };
    } catch { return { persistent: false }; }
  }
}
