import { describe, expect, it, vi } from 'vitest';
import {
  V2_GRAPH_RENDERER_GATE,
  V2_OBJECT_LAYER_GATE,
  V2_PUBLISHED_GRAPH_SLUGS,
  selectV2TerrainSource,
  v2ObjectLayerBlocker,
  v2RequestMode,
  v2StreamProbeRequested,
} from './v2-terrain-select.mjs';

const PACK_META = Object.freeze({
  slug: 'puttom',
  packUrl: 'courses/puttom/pack.bin',
  bytes: 4096,
  sha256: 'a'.repeat(64),
});

function readyPreview(slug) {
  return Object.freeze({ requested: true, ready: true, status: 'ready', reason: null, slug });
}

function neverResolveGraph() {
  return vi.fn(async () => { throw new Error('graph resolver must not run'); });
}

describe('v2RequestMode', () => {
  it('recognises only the documented flag values', () => {
    expect(v2RequestMode('')).toBe('off');
    expect(v2RequestMode('?bana=puttom')).toBe('off');
    expect(v2RequestMode('?v2=1')).toBe('opt-in');
    expect(v2RequestMode('?v2=require')).toBe('require');
    expect(v2RequestMode('?v2=0')).toBe('off');
    expect(v2RequestMode('?v2=2')).toBe('off');
  });
});

describe('v2StreamProbeRequested', () => {
  /* Lives beside v2RequestMode so the player can read it without importing
     the probe -- a static import of the probe module put a v2 chunk in front
     of every ordinary visitor. */
  it('needs its own explicit flag', () => {
    expect(v2StreamProbeRequested('?v2=1')).toBe(false);
    expect(v2StreamProbeRequested('?v2=1&v2stream=1')).toBe(true);
    expect(v2StreamProbeRequested('?v2stream=0')).toBe(false);
    expect(v2StreamProbeRequested('')).toBe(false);
  });
});

describe('selectV2TerrainSource', () => {
  /* The registry is the one value here that tracks published data, so it is
     asserted in exactly one place; every other test pins it explicitly rather
     than inheriting it, so publishing a course cannot quietly change what
     those tests mean. check-app-build is what keeps this list honest against
     the built root. */
  it('registers exactly the courses whose graph is published', () => {
    expect(V2_PUBLISHED_GRAPH_SLUGS).toEqual(['puttom']);
    expect(Object.isFrozen(V2_PUBLISHED_GRAPH_SLUGS)).toBe(true);
  });

  it('requires a course slug', async () => {
    await expect(selectV2TerrainSource({ search: '?v2=1' })).rejects.toThrow(/slug/);
  });

  it('makes no request and loads nothing without the flag', async () => {
    const graphResolver = neverResolveGraph();
    const selection = await selectV2TerrainSource({
      slug: 'puttom',
      packMeta: PACK_META,
      search: '?bana=puttom',
      publishedGraphSlugs: Object.freeze(['puttom']),
      graphResolver,
    });
    expect(selection.mode).toBe('off');
    expect(selection.requested).toBe(false);
    expect(selection.require).toBe(false);
    expect(selection.source.requested).toBe(false);
    expect(selection.source.status).toBe('off');
    expect(Number.isNaN(selection.source.heightAt(0, 0))).toBe(true);
    expect(graphResolver).not.toHaveBeenCalled();
  });

  it('keeps an unpublished non-pilot course on the explicit fallback without probing the network', async () => {
    const graphResolver = neverResolveGraph();
    /* The real registry, not a stub: a course with no published graph must
       stay off the network even while another course has one. */
    const selection = await selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=1',
      graphResolver,
    });
    expect(V2_PUBLISHED_GRAPH_SLUGS).not.toContain('angso');
    expect(selection.mode).toBe('fallback');
    expect(selection.requested).toBe(true);
    expect(selection.graph).toBe(null);
    expect(selection.graphError).toBe(null);
    expect(selection.source.status).toBe('fallback');
    expect(selection.source.reason).toBe('course-not-enabled');
    expect(graphResolver).not.toHaveBeenCalled();
  });

  it('routes the retained pilot through the preview loader with an explicit request decision', async () => {
    const previewLoader = vi.fn(async options => readyPreview(options.slug));
    const selection = await selectV2TerrainSource({
      slug: 'puttom',
      geo: { origin: { lat: 63.2992, lon: 18.9413 } },
      packMeta: PACK_META,
      search: '?v2=1',
      publishedGraphSlugs: Object.freeze([]),
      previewLoader,
      graphResolver: neverResolveGraph(),
    });
    expect(selection.mode).toBe('fixed-frontier');
    expect(selection.require).toBe(false);
    expect(previewLoader).toHaveBeenCalledTimes(1);
    expect(previewLoader.mock.calls[0][0]).toMatchObject({
      slug: 'puttom',
      packSha256: PACK_META.sha256,
      requested: true,
    });
  });

  it('fails closed under ?v2=require when no v2 source can serve', async () => {
    await expect(selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=require',
      publishedGraphSlugs: Object.freeze([]),
    })).rejects.toThrow(/v2 krävdes men ingen verifierad v2-terräng finns för angso/);

    const failedPreview = vi.fn(async options => Object.freeze({
      requested: true, ready: false, status: 'fallback', reason: 'load-failed',
      error: 'descriptor hash mismatch', slug: options.slug,
    }));
    await expect(selectV2TerrainSource({
      slug: 'puttom',
      packMeta: PACK_META,
      search: '?v2=require',
      publishedGraphSlugs: Object.freeze([]),
      previewLoader: failedPreview,
    })).rejects.toThrow(/descriptor hash mismatch/);

    /* And with the graph published: a pilot whose preview cannot verify is
       still a boot error under require, even though its graph resolved. */
    await expect(selectV2TerrainSource({
      slug: 'puttom',
      packMeta: PACK_META,
      search: '?v2=require',
      publishedGraphSlugs: Object.freeze(['puttom']),
      graphResolver: vi.fn(async () => ({ slug: 'puttom', summary: { tiles: 85 } })),
      previewLoader: failedPreview,
    })).rejects.toThrow(/descriptor hash mismatch/);
  });

  it('reports a verified published graph and gates its renderer explicitly', async () => {
    const graph = Object.freeze({
      slug: 'angso',
      summary: Object.freeze({ groundId: 'angso', tiles: 2, holes: 18 }),
    });
    const graphResolver = vi.fn(async () => graph);
    const previewLoader = vi.fn(async () => { throw new Error('preview must not load for a graph course'); });
    const selection = await selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=1',
      publishedGraphSlugs: Object.freeze(['angso']),
      graphResolver,
      previewLoader,
    });
    expect(selection.mode).toBe('graph');
    expect(selection.graph).toBe(graph);
    expect(selection.source.requested).toBe(true);
    expect(selection.source.ready).toBe(false);
    expect(selection.source.status).toBe('fallback');
    expect(selection.source.reason).toBe(V2_GRAPH_RENDERER_GATE);
    expect(previewLoader).not.toHaveBeenCalled();
    expect(graphResolver).toHaveBeenCalledWith(expect.objectContaining({ slug: 'angso' }));
  });

  it('fails closed under ?v2=require when the graph is verified but its renderer is gated', async () => {
    await expect(selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=require',
      publishedGraphSlugs: Object.freeze(['angso']),
      graphResolver: vi.fn(async () => ({ slug: 'angso', summary: {} })),
    })).rejects.toThrow(/generella v2-renderaren är inte aktiverad/);
  });

  /* The vegetation plan's object-layer gate: with the vegetation runtime
     present (Phase 4) a graph may declare object and stand layers; without
     it, such a graph must never render the legacy planter over ground whose
     registry says which trees stand there. */
  it('accepts object and stand layers with the vegetation runtime, and blocks them without it', async () => {
    expect(v2ObjectLayerBlocker(null)).toBe(null);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 0 } })).toBe(null);
    expect(v2ObjectLayerBlocker({ summary: {} })).toBe(null);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 3, standTiles: 4 } })).toBe(null);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 3 } }, { activated: false })).toContain(V2_OBJECT_LAYER_GATE);
    expect(v2ObjectLayerBlocker({ summary: { standTiles: 1 } }, { activated: false })).toContain(V2_OBJECT_LAYER_GATE);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 0 } }, { activated: false })).toBe(null);

    /* the pilot: a ready preview pairs with a graph that carries objects */
    const graph = Object.freeze({ slug: 'puttom', summary: Object.freeze({ tiles: 85, objectTiles: 64, standTiles: 64 }) });
    const selection = await selectV2TerrainSource({
      slug: 'puttom',
      packMeta: PACK_META,
      search: '?v2=require',
      graphResolver: vi.fn(async () => graph),
      previewLoader: vi.fn(async () => readyPreview('puttom')),
    });
    expect(selection.mode).toBe('fixed-frontier');
    expect(selection.graph).toBe(graph);
    expect(selection.graphError).toBe(null);
  });

  it('records a graph failure and falls through under ?v2=1, but fails closed under ?v2=require', async () => {
    const graphResolver = vi.fn(async () => { throw new Error('root sha mismatch'); });
    const optIn = await selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=1',
      publishedGraphSlugs: Object.freeze(['angso']),
      graphResolver,
    });
    expect(optIn.mode).toBe('fallback');
    expect(optIn.graph).toBe(null);
    expect(optIn.graphError).toContain('root sha mismatch');
    expect(optIn.source.reason).toBe('course-not-enabled');

    await expect(selectV2TerrainSource({
      slug: 'angso',
      packMeta: { ...PACK_META, slug: 'angso' },
      search: '?v2=require',
      publishedGraphSlugs: Object.freeze(['angso']),
      graphResolver,
    })).rejects.toThrow(/publicerade v2-grafen för angso kunde inte verifieras: root sha mismatch/);
  });

  it('prefers the ready pilot and still attaches a verified pilot graph', async () => {
    const graph = Object.freeze({ slug: 'puttom', summary: Object.freeze({ groundId: 'puttom' }) });
    const selection = await selectV2TerrainSource({
      slug: 'puttom',
      packMeta: PACK_META,
      search: '?v2=1',
      publishedGraphSlugs: Object.freeze(['puttom']),
      graphResolver: vi.fn(async () => graph),
      previewLoader: vi.fn(async options => readyPreview(options.slug)),
    });
    expect(selection.mode).toBe('fixed-frontier');
    expect(selection.graph).toBe(graph);
  });
});
