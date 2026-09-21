import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { V2_PUBLISHED_GRAPH_SLUGS, V2_OBJECT_LAYER_GATE,
  selectV2TerrainSource, v2ObjectLayerBlocker, v2RequestMode, v2StreamProbeRequested } from './v2-terrain-select.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';
import { PUTTOM_PREVIEW_CONFIG } from './v2-puttom-preview.mjs';

const ready = slug => Object.freeze({ slug, ready: true, requested: true, status: 'ready' });
function fixture(slug = 'ribbingsfors') {
  const graph = { slug, summary: { objectTiles: 0, standTiles: 0 } };
  return {
    slug, graph,
    options: { slug, geo: { frame: 'fixture' }, packMeta: { slug, sha256: 'a'.repeat(64) },
      graphResolver: vi.fn(async () => graph),
      graphFrontierLoader: vi.fn(async () => ready(slug)),
      previewLoader: vi.fn(async () => ready(slug)),
      publishedGraphSlugs: [slug], graphFrontierConfigs: { [slug]: { slug } } },
  };
}

describe('v2 as the only terrain setup', () => {
  it.each(['', '?v2=0', '?v2=1', '?v2=require', '?v2=unknown'])
  ('requires verified v2 even for historical link %s', async search => {
    expect(v2RequestMode(search)).toBe('require');
    const { graph, options } = fixture();
    const selection = await selectV2TerrainSource({ ...options, search });
    expect(selection).toMatchObject({ requestMode: 'require', require: true, requested: true,
      mode: 'fixed-frontier', graph, graphError: null, source: { ready: true } });
    expect(options.previewLoader).not.toHaveBeenCalled();
    expect(options.graphFrontierLoader).toHaveBeenCalledWith(expect.objectContaining({
      graph, geo: options.geo, config: options.graphFrontierConfigs[options.slug] }));
    expect(Object.isFrozen(selection)).toBe(true);
  });

  it('keeps diagnostics opt-in', () => {
    expect(v2StreamProbeRequested('')).toBe(false);
    expect(v2StreamProbeRequested('?v2=require')).toBe(false);
    expect(v2StreamProbeRequested('?v2stream=1')).toBe(true);
  });

  it('covers every public course with a published graph and a reviewed renderer', () => {
    const root = JSON.parse(fs.readFileSync(new URL('../../public/courses/v2-index.json', import.meta.url)));
    const catalog = JSON.parse(fs.readFileSync(new URL('../../public/courses/index.json', import.meta.url)));
    const slugs = catalog.courses.map(c => c.slug).sort();
    expect([...V2_PUBLISHED_GRAPH_SLUGS].sort()).toEqual(slugs);
    expect(root.courses.map(c => c.slug).sort()).toEqual(slugs);
    expect([...Object.keys(V2_GRAPH_FRONTIER_CONFIGS), PUTTOM_PREVIEW_CONFIG.slug].sort()).toEqual(slugs);
  });

  it('requires a slug and never probes an unpublished course', async () => {
    await expect(selectV2TerrainSource()).rejects.toThrow(/slug/);
    const { options } = fixture('unpublished');
    await expect(selectV2TerrainSource({ ...options, publishedGraphSlugs: [] })).rejects.toThrow(/ingen publicerad/);
    expect(options.graphResolver).not.toHaveBeenCalled();
  });

  it('rejects a published course lacking a reviewed renderer', async () => {
    const { options } = fixture();
    await expect(selectV2TerrainSource({ ...options, graphFrontierConfigs: {} })).rejects.toThrow(/ingen verifierad v2-renderare/);
    expect(options.graphResolver).not.toHaveBeenCalled();
  });

  it.each(['', '?v2=0', '?v2=1', '?v2=require'])
  ('reports graph verification failure without legacy fallback for %s', async search => {
    const { options } = fixture();
    const cause = new Error('root not canonical');
    options.graphResolver.mockRejectedValue(new Error('root verification failed', { cause }));
    await expect(selectV2TerrainSource({ ...options, search })).rejects.toThrow(/root verification failed: root not canonical/);
    expect(options.graphFrontierLoader).not.toHaveBeenCalled();
    expect(options.previewLoader).not.toHaveBeenCalled();
  });

  it('rejects an empty graph resolver result', async () => {
    const { options } = fixture(); options.graphResolver.mockResolvedValue(null);
    await expect(selectV2TerrainSource(options)).rejects.toThrow(/grafen saknas/);
  });

  it('reports tile failure and disposes the course transport without invoking the pilot', async () => {
    const { graph, options } = fixture();
    const chunkSource = { dispose: vi.fn() };
    options.createChunkSource = vi.fn(async () => chunkSource);
    options.graphFrontierLoader.mockRejectedValue(new Error('tile hash mismatch'));
    await expect(selectV2TerrainSource(options)).rejects.toThrow(/tile hash mismatch/);
    expect(options.createChunkSource).toHaveBeenCalledWith(graph);
    expect(chunkSource.dispose).toHaveBeenCalledOnce();
    expect(options.previewLoader).not.toHaveBeenCalled();
  });

  it('rejects an unready frontier instead of allowing legacy rendering', async () => {
    const { options } = fixture();
    options.graphFrontierLoader.mockResolvedValue({ ready: false, reason: 'missing terrain tile' });
    await expect(selectV2TerrainSource(options)).rejects.toThrow(/missing terrain tile/);
  });

  it('keeps Puttom on its verified v2 adapter with the published graph attached', async () => {
    const { graph, options } = fixture('puttom');
    const selection = await selectV2TerrainSource({ ...options, search: '?v2=0',
      graphFrontierConfigs: {}, previewOptions: { requested: false } });
    expect(selection.graph).toBe(graph);
    expect(selection.frontierConfig).toBe(PUTTOM_PREVIEW_CONFIG);
    expect(selection.source.ready).toBe(true);
    expect(selection.require).toBe(true);
    expect(options.previewLoader).toHaveBeenCalledWith(expect.objectContaining({ requested: true, packSha256: options.packMeta.sha256 }));
    expect(options.graphFrontierLoader).not.toHaveBeenCalled();
  });

  it('does not fall back when the Puttom adapter fails verification', async () => {
    const { options } = fixture('puttom');
    options.previewLoader.mockResolvedValue({ ready: false, error: 'surface hash mismatch' });
    await expect(selectV2TerrainSource({ ...options, graphFrontierConfigs: {} })).rejects.toThrow(/surface hash mismatch/);
  });

  it('accepts declared vegetation only when its runtime is supported', () => {
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 3, standTiles: 4 } })).toBe(null);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 3 } }, { activated: false })).toContain(V2_OBJECT_LAYER_GATE);
    expect(v2ObjectLayerBlocker({ summary: { standTiles: 1 } }, { activated: false })).toContain(V2_OBJECT_LAYER_GATE);
    expect(v2ObjectLayerBlocker({ summary: { objectTiles: 0 } }, { activated: false })).toBe(null);
  });
});
