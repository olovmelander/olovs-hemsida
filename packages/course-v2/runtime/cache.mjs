import { canonicalJson } from '../canonical-json.mjs';
import { abortError } from './decode-web.mjs';

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function isAbort(error) {
  return error?.name === 'AbortError';
}

export class MemoryByteCache {
  constructor() {
    this.entries = new Map();
  }

  async match(key) {
    const value = this.entries.get(key);
    return value ? new Uint8Array(value) : null;
  }

  async put(key, value) {
    this.entries.set(key, new Uint8Array(bytes(value, 'cache value')));
  }

  async delete(key) {
    return this.entries.delete(key);
  }
}

export class CacheStorageByteCache {
  constructor({
    cacheStorage = globalThis.caches,
    cacheName = 'banvy-v2-immutable',
    contentType = 'application/octet-stream',
  } = {}) {
    if (!cacheStorage?.open) throw new Error('Cache Storage is unavailable');
    this.cacheStorage = cacheStorage;
    this.cacheName = cacheName;
    this.contentType = contentType;
  }

  async #cache() {
    return this.cacheStorage.open(this.cacheName);
  }

  async match(key) {
    const response = await (await this.#cache()).match(key);
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  async put(key, value) {
    const data = bytes(value, 'cache value');
    await (await this.#cache()).put(key, new Response(data, {
      status: 200,
      headers: { 'Content-Type': this.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
    }));
  }

  async delete(key) {
    return (await this.#cache()).delete(key);
  }
}

export class VerifiedImmutableStore {
  constructor({ fetchBytes, cache, urlFor = reference => reference.url } = {}) {
    if (typeof fetchBytes !== 'function') throw new TypeError('fetchBytes must be a function');
    if (!cache?.match || !cache?.put || !cache?.delete) throw new TypeError('cache must implement match/put/delete');
    this.fetchBytes = fetchBytes;
    this.cache = cache;
    this.urlFor = urlFor;
  }

  async load(reference, { signal, verify } = {}) {
    if (typeof verify !== 'function') throw new TypeError('verify must be a function');
    checkAbort(signal);
    const key = this.urlFor(reference);
    const cached = await this.cache.match(key);
    checkAbort(signal);
    if (cached) {
      try {
        return { value: await verify(reference, cached, { signal }), cacheHit: true, url: key };
      } catch (error) {
        if (isAbort(error) || /unsupported features|decoded-byte budget/.test(String(error?.message))) throw error;
        await this.cache.delete(key);
      }
    }
    const network = bytes(await this.fetchBytes(key, { signal, expectedBytes: reference.bytes }), 'network response');
    checkAbort(signal);
    /* A real Worker verifier transfers its input ArrayBuffer and therefore
       detaches it. Preserve the exact encoded bytes before verification; only
       this copy is eligible for Cache Storage after the worker has accepted
       both encoded and decoded identities. */
    const cacheCopy = new Uint8Array(network);
    const value = await verify(reference, network, { signal });
    checkAbort(signal);
    await this.cache.put(key, cacheCopy);
    return { value, cacheHit: false, url: key };
  }
}

function parseCanonicalJson(data, validate, label) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes(data, label));
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`${label} is not JSON: ${error.message}`); }
  if (canonicalJson(value) !== text) throw new Error(`${label} is not canonical JSON`);
  const errors = validate(value);
  if (errors.length) throw new Error(`invalid ${label}:\n${errors.join('\n')}`);
  return value;
}

export class NetworkFirstJsonStore {
  constructor({ fetchBytes, cache } = {}) {
    if (typeof fetchBytes !== 'function') throw new TypeError('fetchBytes must be a function');
    if (!cache?.match || !cache?.put) throw new TypeError('cache must implement match/put');
    this.fetchBytes = fetchBytes;
    this.cache = cache;
  }

  async load(url, { signal, validate, label = 'root manifest' } = {}) {
    if (typeof validate !== 'function') throw new TypeError('validate must be a function');
    checkAbort(signal);
    let network;
    try {
      network = await this.fetchBytes(url, { signal });
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw abortError();
      if (error?.allowCachedFallback === false) throw error;
      const cached = await this.cache.match(url);
      if (!cached) throw error;
      return { value: parseCanonicalJson(cached, validate, label), source: 'cache' };
    }
    checkAbort(signal);
    const data = bytes(network, 'network manifest');
    const value = parseCanonicalJson(data, validate, label);
    await this.cache.put(url, data);
    return { value, source: 'network' };
  }
}
