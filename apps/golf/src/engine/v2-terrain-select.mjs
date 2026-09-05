import {
  PUTTOM_PREVIEW_CONFIG,
  fallbackTerrainPreviewState,
  loadPuttomTerrainPreview,
} from './v2-puttom-preview.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';

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
export const V2_PUBLISHED_GRAPH_SLUGS = Object.freeze(['angso', 'johannesberg', 'johannesberg-9', 'norrfallsviken', 'puttom', 'ribbingsfors', 'upsala', 'upsala-mellanbanan', 'veckefjarden', 'veckefjarden-korthalsbanan']);

export const V2_GRAPH_RENDERER_GATE = 'graph-renderer-not-activated';

/* Phase 4 of the vegetation plan flipped this on 2026-09-02: the app now has
   the vegetation runtime (engine/v2-vegetation.mjs) that loads a graph's
   object registries and stand fields, plants them, and cuts the legacy
   lattice out of their coverage. The gate itself stays, parameterised, so a
   build that ships without the runtime -- or a future layer the runtime does
   not understand -- fails closed again under ?v2=require and is reported
   under ?v2=1 rather than drawing two populations over the same ground. */
export const V2_OBJECT_LAYER_GATE = 'object-layer-renderer-not-activated';
export const V2_VEGETATION_RUNTIME_ACTIVATED = true;

export function v2ObjectLayerBlocker(graph, { activated = V2_VEGETATION_RUNTIME_ACTIVATED } = {}) {
  const objectTiles = (graph?.summary?.objectTiles || 0) + (graph?.summary?.standTiles || 0);
  if (!Number.isFinite(objectTiles) || objectTiles <= 0 || activated) return null;
  return `${V2_OBJECT_LAYER_GATE}: grafen refererar ${objectTiles} objekt-/beståndslager som renderaren inte stödjer ännu`;
}

export function v2RequestMode(search = globalThis.location?.search || '') {
  const value = new URLSearchParams(search).get('v2');
  if (value === '1') return 'opt-in';
  if (value === 'require') return 'require';
  /* No flag at all means "the course's own default": v2 where a reviewed live
     contract exists, GPK1 everywhere else. Any explicit value that is not a
     documented one -- ?v2=0 above all -- is the opt-out. */
  if (value === null) return 'default';
  return 'off';
}

/* Every "what did the URL ask for" answer lives here, in a module the player
   already loads, precisely so asking the question costs no chunk. Reading this
   flag from the probe's own module instead made main.js a static importer of
   it, and a v2 chunk then reached every ordinary visitor — caught by the
   flagless no-request proof, which is the only gate that could see it. */
export function v2StreamProbeRequested(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('v2stream') === '1';
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

async function defaultGraphFrontierLoader(options) {
  const { loadPublishedGraphTerrainFrontier } = await import('./v2-graph-frontier.mjs');
  return loadPublishedGraphTerrainFrontier(options);
}

/**
 * The one place that decides which v2 terrain source serves a course. Order:
 * a published, verified course/ground graph; then the retained Puttom
 * fixed-frontier preview; then the explicit GPK1 fallback state.
 *
 * Without a flag the course's DEFAULT decides: a slug with a reviewed live
 * contract (a frontier config, or the retained pilot) serves v2 as if ?v2=1
 * had been passed -- failures fall back to GPK1 silently -- and every other
 * course fetches nothing, exactly as before. `?v2=0` is the explicit opt-out
 * and keeps the pure-GPK1 path reachable everywhere. `?v2=require` fails
 * closed instead of quietly serving GPK1: a corrupt or missing published
 * graph, a preview that cannot verify, or a course with no v2 source at all
 * each become a boot error.
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
  graphFrontierLoader = defaultGraphFrontierLoader,
  graphFrontierConfigs = V2_GRAPH_FRONTIER_CONFIGS,
  fetchImpl,
  cacheStorage,
  previewOptions,
  /* async () => ({ bodies, shallows }) -- the model's water, for the fixed
     frontier to carve lake beds into its tiles as they decode */
  waterBeds = null,
} = {}) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('course slug is required');
  const urlMode = v2RequestMode(search);
  /* The default set is derived, never listed: a course serves v2 by default
     exactly when the app could actually RENDER its v2 ground -- a reviewed
     frontier contract in the registry, or the retained pilot. A published
     graph alone stays resolution-only and defaults to GPK1, so a course
     cannot default onto a source that would only report a gate. */
  const hasDefaultV2 = Boolean(graphFrontierConfigs[slug]) || slug === PUTTOM_PREVIEW_CONFIG.slug;
  const requestMode = urlMode === 'default' ? (hasDefaultV2 ? 'opt-in' : 'off') : urlMode;
  const finish = value => frozenSelection({ defaulted: urlMode === 'default', ...value });
  if (requestMode === 'off') {
    return finish({
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
      const objectBlocker = v2ObjectLayerBlocker(graph);
      if (objectBlocker) {
        if (requestMode === 'require') {
          throw new Error(`v2 krävdes men den publicerade v2-grafen för ${slug} kan inte tjäna: ${objectBlocker}`);
        }
        graphError = objectBlocker;
      }
    }
    if (graph && !graphError) {
      const frontierConfig = graphFrontierConfigs[slug] || null;
      if (frontierConfig) {
        try {
          const source = await graphFrontierLoader({
            graph,
            geo,
            config: frontierConfig,
            baseUrl,
            locationHref,
            fetchImpl,
            waterBeds,
          });
          return finish({
            requestMode,
            mode: 'fixed-frontier',
            publishedGraphSlugs,
            graph,
            source,
            frontierConfig,
          });
        } catch (error) {
          const detail = errorText(error);
          if (requestMode === 'require') {
            throw new Error(`v2 krävdes men den verifierade terrängfronten för ${slug} inte kunde tjäna: ${detail}`);
          }
          return finish({
            requestMode,
            mode: 'graph',
            publishedGraphSlugs,
            graph,
            graphError: detail,
            source: fallbackTerrainPreviewState({ slug, reason: V2_GRAPH_RENDERER_GATE }),
            frontierConfig,
          });
        }
      }
      /* A verified graph is not yet a renderable one: the generic streaming
         renderer stays gated until it passes the same adapter contract and
         capture evidence as the retained pilot. Selection reports the graph
         and falls through to the strongest source that can actually serve. */
      if (slug !== PUTTOM_PREVIEW_CONFIG.slug) {
        if (requestMode === 'require') {
          throw new Error(`v2 krävdes men den generella v2-renderaren är inte aktiverad för ${slug} ännu`);
        }
        return finish({
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
  return finish({
    requestMode,
    mode: source.ready ? 'fixed-frontier' : graph ? 'graph' : 'fallback',
    publishedGraphSlugs,
    graph,
    graphError,
    source,
    frontierConfig: source.ready && slug === PUTTOM_PREVIEW_CONFIG.slug
      ? PUTTOM_PREVIEW_CONFIG
      : null,
  });
}
