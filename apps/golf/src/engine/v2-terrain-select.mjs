import {
  PUTTOM_PREVIEW_CONFIG,
  loadPuttomTerrainPreview,
} from './v2-puttom-preview.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';

/* Every published course must resolve a verified v2 graph and a reviewed
   renderer contract. The build gate checks this registry against the catalogue. */
export const V2_PUBLISHED_GRAPH_SLUGS = Object.freeze(['angso', 'johannesberg', 'johannesberg-9', 'lidingo', 'norrfallsviken', 'puttom', 'ribbingsfors', 'tortuna', 'upsala', 'upsala-mellanbanan', 'veckefjarden', 'veckefjarden-korthalsbanan', 'visby']);

export const V2_GRAPH_RENDERER_GATE = 'graph-renderer-not-activated';

/* Phase 4 of the vegetation plan flipped this on 2026-09-02: the app now has
   the vegetation runtime (engine/v2-vegetation.mjs) that loads a graph's
   object registries and stand fields, plants them, and cuts the legacy
   lattice out of their coverage. The gate itself stays, parameterised, so a
   build that ships without the runtime -- or a future layer the runtime does
   not understand -- fails closed rather than drawing two populations over
   the same ground. */
export const V2_OBJECT_LAYER_GATE = 'object-layer-renderer-not-activated';
export const V2_VEGETATION_RUNTIME_ACTIVATED = true;

export function v2ObjectLayerBlocker(graph, { activated = V2_VEGETATION_RUNTIME_ACTIVATED } = {}) {
  const objectTiles = (graph?.summary?.objectTiles || 0) + (graph?.summary?.standTiles || 0);
  if (!Number.isFinite(objectTiles) || objectTiles <= 0 || activated) return null;
  return `${V2_OBJECT_LAYER_GATE}: grafen refererar ${objectTiles} objekt-/beståndslager som renderaren inte stödjer ännu`;
}

// Historical v2 flags remain valid links, but cannot select another renderer.
export function v2RequestMode() { return 'require'; }

/* Every "what did the URL ask for" answer lives here, in a module the player
   already loads, precisely so asking the question costs no chunk. Reading this
   flag from the probe's own module instead made main.js a static importer of
   it, and a v2 chunk then reached every ordinary visitor — caught by the
   flagless no-request proof, which is the only gate that could see it. */
export function v2StreamProbeRequested(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('v2stream') === '1';
}

function errorText(error) {
  const parts = [], seen = new Set();
  for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    parts.push(String(cause.message || cause));
  }
  return parts.join(': ').slice(0, 600);
}

async function defaultGraphResolver(options) {
  const { resolvePublishedGraph } = await import('./v2-graph-source.mjs');
  return resolvePublishedGraph(options);
}

async function defaultGraphFrontierLoader(options) {
  const { loadPublishedGraphTerrainFrontier } = await import('./v2-graph-frontier.mjs');
  return loadPublishedGraphTerrainFrontier(options);
}

/** Resolve the only supported terrain. Integrity failures never select GPK1.
 * Puttom retains its verified v2 preview adapter on the published graph;
 * other courses use their reviewed graph frontier before world activation.
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
  waterBeds = null,
  createChunkSource = null,
} = {}) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('course slug is required');
  if (!publishedGraphSlugs.includes(slug)) {
    throw new Error(`ingen publicerad v2-terräng finns för ${slug}. Välj en annan bana.`);
  }
  const frontierConfig = graphFrontierConfigs[slug] ||
    (slug === PUTTOM_PREVIEW_CONFIG.slug ? PUTTOM_PREVIEW_CONFIG : null);
  if (!frontierConfig) throw new Error(`ingen verifierad v2-renderare finns för ${slug}`);

  let graph;
  try {
    graph = await graphResolver({ slug, baseUrl, locationHref, packMeta, fetchImpl, cacheStorage });
    if (!graph) throw new Error('v2-grafen saknas');
  } catch (error) {
    throw new Error(`banans v2-terräng kunde inte verifieras. Kontrollera anslutningen och ladda om. ${slug}: ${errorText(error)}`, { cause: error });
  }
  const objectBlocker = v2ObjectLayerBlocker(graph);
  if (objectBlocker) throw new Error(`banans v2-vegetation kan inte visas: ${objectBlocker}`);

  let chunkSource = null;
  try {
    if (createChunkSource) chunkSource = await createChunkSource(graph);
    const source = graphFrontierConfigs[slug]
      ? await graphFrontierLoader({ graph, geo, config: frontierConfig, baseUrl,
        locationHref, fetchImpl, waterBeds, chunkSource })
      : await previewLoader({ ...previewOptions, slug, geo, packSha256: packMeta?.sha256,
        search, baseUrl, locationHref, requested: true });
    if (!source?.ready) throw new Error(source?.error || source?.reason || 'terrängkällan är inte redo');
    return Object.freeze({
      requestMode: 'require', require: true, requested: true,
      defaulted: !new URLSearchParams(search).has('v2'),
      mode: 'fixed-frontier', publishedGraphSlugs, graph, graphError: null,
      source, frontierConfig, chunkSource,
    });
  } catch (error) {
    chunkSource?.dispose?.();
    throw new Error(`banans v2-terräng kunde inte läsas. Kontrollera anslutningen och ladda om. ${slug}: ${errorText(error)}`, { cause: error });
  }
}
