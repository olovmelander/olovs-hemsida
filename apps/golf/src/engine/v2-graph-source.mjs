import { CourseV2ManifestLoader } from '../../../../packages/course-v2/runtime/manifest-loader.mjs';

/* Kept behind a dynamic import from v2-terrain-select.mjs so the manifest
   machinery never enters the normal player's critical path. It runs only for
   a course listed in V2_PUBLISHED_GRAPH_SLUGS after an explicit v2 flag. */

const SHA256 = /^[a-f0-9]{64}$/;

function relativePackUrl(value) {
  return String(value || '').replace(/^\//, '');
}

/**
 * Resolve and verify the published v2 course/ground graph for one course.
 * The loader already enforces content addressing, canonical JSON, schema,
 * capability and cross-manifest identity; this boundary additionally refuses
 * a graph whose declared GPK1 fallback is not byte-for-byte the pack the live
 * manifest is serving right now, so v2 selection can never pair new terrain
 * with a stale course identity.
 */
export async function resolvePublishedGraph({
  slug,
  baseUrl = import.meta.env?.BASE_URL || '/',
  locationHref = globalThis.location?.href || 'https://banvy.invalid/',
  packMeta,
  fetchImpl,
  cacheStorage,
  signal,
  rootRelative,
} = {}) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('course slug is required');
  if (!SHA256.test(packMeta?.sha256 || '') || !Number.isSafeInteger(packMeta?.bytes) ||
      !relativePackUrl(packMeta?.packUrl)) {
    throw new Error('the live GPK1 manifest identity is required before v2 graph selection');
  }
  const loader = new CourseV2ManifestLoader({
    baseUrl: new URL(baseUrl, locationHref).href,
    fetchImpl,
    cacheStorage,
  });
  const resolved = await loader.resolve(slug, { signal, rootRelative });
  const fallback = resolved.entry.fallbackV1;
  if (fallback.sha256 !== packMeta.sha256 || fallback.bytes !== packMeta.bytes ||
      relativePackUrl(fallback.packUrl) !== relativePackUrl(packMeta.packUrl)) {
    throw new Error(`v2 graph for ${slug} declares a GPK1 fallback that does not match the live course manifest`);
  }
  const terrainBytes = resolved.ground.shell.bytes +
    resolved.ground.tiles.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0);
  return Object.freeze({
    slug,
    groundId: resolved.entry.groundId,
    rootSource: resolved.rootSource,
    courseCacheHit: resolved.courseCacheHit,
    groundCacheHit: resolved.groundCacheHit,
    entry: resolved.entry,
    course: resolved.course,
    ground: resolved.ground,
    summary: Object.freeze({
      groundId: resolved.entry.groundId,
      frameFingerprint: resolved.ground.frame.fingerprint,
      tiles: resolved.ground.tiles.length,
      holes: resolved.course.holes.length,
      shellBytes: resolved.ground.shell.bytes,
      encodedTerrainBytes: terrainBytes,
    }),
  });
}
