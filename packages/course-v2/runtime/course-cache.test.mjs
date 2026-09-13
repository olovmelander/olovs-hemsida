import { it, expect } from 'vitest';
import { CourseGenerationCache } from './course-cache.mjs';

function storage() {
  const caches = new Map();
  return { keys: async () => [...caches.keys()], delete: async key => caches.delete(key), open: async name => {
    if (!caches.has(name)) {
      const values = new Map(), url = key => typeof key === 'string' ? key : key.url;
      caches.set(name, { keys: async () => [...values.keys()].map(url => ({ url })),
        match: async key => values.get(url(key))?.clone(),
        put: async (key, response) => { values.set(url(key), response.clone()); },
        delete: async key => values.delete(url(key)) });
    }
    return caches.get(name);
  } };
}

it('evicts whole older generations by bytes while pinning the active ground', async () => {
  const cacheStorage = storage();
  const old = new CourseGenerationCache({ generation: 'a'.repeat(64), cacheStorage, budget: 8 });
  await old.put('https://example.test/old-a', new Uint8Array(4));
  await old.put('https://example.test/old-b', new Uint8Array(4));
  await old.complete();
  const current = new CourseGenerationCache({ generation: 'b'.repeat(64), cacheStorage, budget: 8 });
  await current.put('https://example.test/new', new Uint8Array(8));
  const result = await current.complete();
  expect(result.totalBytes).toBe(8);
  expect(result.evicted).toBe(1);
  expect(await cacheStorage.keys()).toEqual([current.cacheName]);
  expect((await current.match('https://example.test/new')).length).toBe(8);
});

it('reclaims incomplete generations before a completed course', async () => {
  const cacheStorage = storage();
  const interrupted = new CourseGenerationCache({ generation: 'a'.repeat(64), cacheStorage, budget: 10 });
  await interrupted.put('https://example.test/interrupted', new Uint8Array(9));
  const current = new CourseGenerationCache({ generation: 'b'.repeat(64), cacheStorage, budget: 10 });
  await current.put('https://example.test/current', new Uint8Array(2));
  expect((await current.complete()).evicted).toBe(1);
  expect(await cacheStorage.keys()).toEqual([current.cacheName]);
});
