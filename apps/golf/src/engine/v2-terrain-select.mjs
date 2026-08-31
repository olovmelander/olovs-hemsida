import {
  PUTTOM_PREVIEW_CONFIG,
  fallbackTerrainPreviewState,
  loadPuttomTerrainPreview,
} from './v2-puttom-preview.mjs';

/* Course slugs whose real, reviewed v2 course/ground graph is committed under
   the public v2 root. The generic manifest resolver runs ONLY for these slugs,
   so an unpublished course never probes the network for a root that cannot
   exist. check-app-build fails the build when this list and the published root
   disagree in either direction, so the list cannot silently go stale.

   Puttom's graph is the full aligned 2,049 m AOI compiled from the same
   authenticated Lantmäteriet DTM item as the retained pilot, whose 16 verified
   tiles are an exact subgrid of it. Registering a slug publishes its graph for
   RESOLUTION only: the generic streaming renderer stays gated, so a resolved
   graph is reported and the course keeps rendering from the strongest source
   that has passed the adapter contract. */
export const V2_PUBLISHED_GRAPH_SLUGS = Object.freeze(['puttom']);

export const V2_GRAPH_RENDERER_GATE = 'graph-renderer-not-activated';

export function v2RequestMode(search = globalThis.location?.search || '') {
  const value = new URLSearchParams(search).get('v2');
  if (value === '1') return 'opt-in';
  if (value === 'require') return 'require';
  return 'off';
}

function errorText(error) {
  return String(error?.message || error).slice(0, 300);
}

function frozenSelection(value) {
  return Object.freeze({
    graph: null,
    graphError: null,
    ...value,
    require: value.requestMode === 'require',
    requested: value.requestMode !== 'off',
  });
}

async function defaultGraphResolver(options) {
  const { resolvePublishedGraph } = await import('./v2-graph-source.mjs');
  return resolvePublishedGraph(options);
}

/**
 * The one place that decides which v2 terrain source serves a course. Order:
 * a published, verified course/ground graph; then the retained Puttom
 * fixed-frontier preview; then the explicit GPK1 fallback state. Without the
 * v2 flag nothing is fetched. `?v2=require` fails closed instead of quietly
 * serving GPK1: a corrupt or missing published graph, a preview that cannot
 * verify, or a course with no v2 source at all each become a boot error.
 */
export async function selectV2TerrainSource({
  slug,
  geo,
  packMeta,
  search = globalThis.location?.search || '',
  baseUrl,
  locationHref,
  publishedGraphSlugs = V2_PUBLISHED_GRAPH_SLUGS,
  previewLoader = loadPuttomTerrainPreview,
  graphResolver = defaultGraphResolver,
  fetchImpl,
  cacheStorage,
  previewOptions,
} = {}) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('course slug is required');
  const requestMode = v2RequestMode(search);
  if (requestMode === 'off') {
    return frozenSelection({
      requestMode,
      mode: 'off',
      publishedGraphSlugs,
      source: await previewLoader({
        slug, geo, packSha256: packMeta?.sha256, search, baseUrl, locationHref,
        requested: false, ...previewOptions,
      }),
    });
  }

  let graph = null;
  let graphError = null;
  if (publishedGraphSlugs.includes(slug)) {
    try {
      graph = await graphResolver({
        slug, baseUrl, locationHref, packMeta, fetchImpl, cacheStorage,
      });
    } catch (error) {
      if (requestMode === 'require') {
        throw new Error(`v2 krävdes men den publicerade v2-grafen för ${slug} kunde inte verifieras: ${errorText(error)}`);
      }
      graphError = errorText(error);
    }
    if (graph) {
      /* A verified graph is not yet a renderable one: the generic streaming
         renderer stays gated until it passes the same adapter contract and
         capture evidence as the retained pilot. Selection reports the graph
         and falls through to the strongest source that can actually serve. */
      if (slug !== PUTTOM_PREVIEW_CONFIG.slug) {
        if (requestMode === 'require') {
          throw new Error(`v2 krävdes men den generella v2-renderaren är inte aktiverad för ${slug} ännu`);
        }
        return frozenSelection({
          requestMode,
          mode: 'graph',
          publishedGraphSlugs,
          graph,
          source: fallbackTerrainPreviewState({ slug, reason: V2_GRAPH_RENDERER_GATE }),
        });
      }
    }
  }

  const source = await previewLoader({
    slug, geo, packSha256: packMeta?.sha256, search, baseUrl, locationHref,
    requested: true, ...previewOptions,
  });
  if (requestMode === 'require' && !source.ready) {
    const detail = source.error || source.reason || 'okänd orsak';
    throw new Error(`v2 krävdes men ingen verifierad v2-terräng finns för ${slug}: ${detail}`);
  }
  return frozenSelection({
    requestMode,
    mode: source.ready ? 'fixed-frontier' : graph ? 'graph' : 'fallback',
    publishedGraphSlugs,
    graph,
    graphError,
    source,
  });
}
