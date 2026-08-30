import { canonicalJson } from '../canonical-json.mjs';
import {
  V2_SUPPORTED_FEATURES,
  assertSupported,
  validateRootIndex,
} from '../schema.mjs';
import {
  CacheStorageByteCache,
  MemoryByteCache,
  NetworkFirstJsonStore,
  VerifiedImmutableStore,
} from './cache.mjs';
import { createHttpByteFetcher, resolveV2AssetUrl } from './http.mjs';
import { verifyCourseManifestWeb, verifyGroundManifestWeb } from './manifest-web.mjs';

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function rethrowAbort(error) {
  if (error?.name === 'AbortError') throw error;
}

function defaultByteCache(cacheStorage, options) {
  return cacheStorage?.open
    ? new CacheStorageByteCache({ cacheStorage, ...options })
    : new MemoryByteCache();
}

function assetReferences(course, ground) {
  const references = [course.routing, ground.shell];
  for (const tile of ground.tiles) {
    references.push(tile.layers.terrain);
    if (tile.layers.surface) references.push(tile.layers.surface);
    if (tile.layers.objects) references.push(tile.layers.objects);
  }
  return references;
}

export function assertManifestGraph(entry, course, ground, supportedFeatures = V2_SUPPORTED_FEATURES) {
  if (course.slug !== entry.slug || course.groundId !== entry.groundId ||
      course.courseFormat !== entry.courseFormat || course.groundFormat !== entry.groundFormat) {
    throw new Error(`course ${entry.slug} identity does not match the v2 root index`);
  }
  if (!same(course.fallbackV1, entry.fallbackV1)) {
    throw new Error(`course ${entry.slug} v1 fallback does not match the v2 root index`);
  }
  if (ground.groundId !== entry.groundId || ground.groundFormat !== entry.groundFormat) {
    throw new Error(`ground ${entry.groundId} identity does not match course ${entry.slug}`);
  }
  assertSupported(`course ${entry.slug}`, course.requiredFeatures, supportedFeatures);
  assertSupported(`ground ${entry.groundId}`, ground.requiredFeatures, supportedFeatures);
  for (const reference of assetReferences(course, ground)) {
    assertSupported(`${reference.kind} asset ${reference.url}`, reference.requiredFeatures, supportedFeatures);
  }

  const tiles = new Map(ground.tiles.map(tile => [tile.id, tile]));
  for (const hole of course.holes) {
    for (const tileId of hole.tileIds) {
      const tile = tiles.get(tileId);
      if (!tile) throw new Error(`course ${entry.slug} hole ${hole.number} references missing tile ${tileId}`);
      if (!tile.courses.includes(entry.slug)) {
        throw new Error(`ground tile ${tileId} does not declare course ${entry.slug}`);
      }
    }
  }
  return { entry, course, ground };
}

export class CourseV2ManifestError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CourseV2ManifestError';
    this.code = code;
  }
}

export class CourseV2ManifestLoader {
  constructor({
    baseUrl,
    fetchImpl = globalThis.fetch,
    rootCache,
    manifestCache,
    cacheStorage = globalThis.caches,
    supportedFeatures = V2_SUPPORTED_FEATURES,
  } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = new URL(baseUrl).href;
    this.supportedFeatures = Object.freeze([...supportedFeatures]);
    const fetchBytes = createHttpByteFetcher(fetchImpl);
    this.rootCache = rootCache || defaultByteCache(cacheStorage, {
      cacheName: 'banvy-v2-root',
      contentType: 'application/json',
    });
    this.manifestCache = manifestCache || defaultByteCache(cacheStorage, {
      cacheName: 'banvy-v2-manifests',
      contentType: 'application/json',
    });
    this.rootStore = new NetworkFirstJsonStore({ fetchBytes, cache: this.rootCache });
    this.manifestStore = new VerifiedImmutableStore({
      fetchBytes,
      cache: this.manifestCache,
      urlFor: reference => resolveV2AssetUrl(reference.url, this.baseUrl),
    });
  }

  loadRoot(relative = 'courses/v2-index.json', options = {}) {
    return this.rootStore.load(resolveV2AssetUrl(relative, this.baseUrl), {
      signal: options.signal,
      validate: validateRootIndex,
      label: 'v2 root manifest',
    });
  }

  loadCourse(reference, options = {}) {
    return this.manifestStore.load(reference, {
      signal: options.signal,
      verify: (ref, data, context) => verifyCourseManifestWeb(ref, data, {
        ...context,
        supportedFeatures: this.supportedFeatures,
      }),
    });
  }

  loadGround(reference, options = {}) {
    return this.manifestStore.load(reference, {
      signal: options.signal,
      verify: (ref, data, context) => verifyGroundManifestWeb(ref, data, {
        ...context,
        supportedFeatures: this.supportedFeatures,
      }),
    });
  }

  async resolve(slug, options = {}) {
    let rootResult;
    try {
      rootResult = await this.loadRoot(options.rootRelative, options);
    } catch (error) {
      rethrowAbort(error);
      throw new CourseV2ManifestError('root-unavailable', 'v2 root manifest could not be loaded', error);
    }
    const entry = rootResult.value.courses.find(course => course.slug === slug);
    if (!entry) {
      throw new CourseV2ManifestError('course-not-found', `v2 root has no course ${slug}`);
    }

    let courseResult;
    try {
      courseResult = await this.loadCourse(entry.manifest, options);
    } catch (error) {
      rethrowAbort(error);
      throw new CourseV2ManifestError(
        'course-manifest-invalid',
        `v2 course manifest for ${slug} could not be verified`,
        error,
      );
    }
    let groundResult;
    try {
      groundResult = await this.loadGround(courseResult.value.groundManifest, options);
    } catch (error) {
      rethrowAbort(error);
      throw new CourseV2ManifestError(
        'ground-manifest-invalid',
        `v2 ground manifest for ${entry.groundId} could not be verified`,
        error,
      );
    }
    try {
      assertManifestGraph(entry, courseResult.value, groundResult.value, this.supportedFeatures);
    } catch (error) {
      throw new CourseV2ManifestError('manifest-graph-invalid', `v2 graph for ${slug} is inconsistent`, error);
    }
    return Object.freeze({
      root: rootResult.value,
      rootSource: rootResult.source,
      entry,
      course: courseResult.value,
      courseCacheHit: courseResult.cacheHit,
      ground: groundResult.value,
      groundCacheHit: groundResult.cacheHit,
    });
  }
}
