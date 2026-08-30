import { describe, expect, it } from 'vitest';
import { assetReferenceForChunk, verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { parseChunkEnvelope } from '../../../../packages/course-v2/chunk.mjs';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { TerrainTileBatchSet } from './v2-terrain-batch.mjs';

function fixture() {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
  const course = JSON.parse(graph.resources.get(entry.manifest.url));
  const ground = JSON.parse(graph.resources.get(course.groundManifest.url));
  const resources = new Map();
  for (const [url, bytes] of graph.resources) {
    if (!url.endsWith('.bvch')) continue;
    const header = parseChunkEnvelope(bytes).header;
    if (header.kind !== 'terrain') continue;
    const reference = assetReferenceForChunk(bytes, { kind: 'terrain', directory: 'assets/terrain' });
    const decoded = verifyChunkAsset(reference, bytes);
    resources.set(header.id, createTerrainRenderResource({
      tileId: header.id,
      decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
      frame: ground.frame,
    }));
  }
  return resources;
}

describe('Three r185 v2 terrain batching', () => {
  it('renders regular tiles with one shared topology and one draw call', () => {
    const resources = fixture();
    const layer = new TerrainTileBatchSet({ maximumTiles: 2, morphDurationMilliseconds: 240 });
    const first = resources.get('l0/0/0');
    const second = resources.get('l0/1/0');
    const state = layer.sync([
      { tileId: first.tileId, value: first },
      { tileId: second.tileId, value: second },
    ], { now: 100 });
    expect(state).toEqual({ renderedTiles: 2, morphing: true });
    expect(layer.stats()).toMatchObject({
      renderedTiles: 2,
      residentLayers: 2,
      drawCalls: 1,
      textureUploads: 2,
    });
    const batch = [...layer.batches.values()][0];
    expect(batch.mesh.isInstancedMesh).not.toBe(true);
    expect(batch.geometry.isInstancedBufferGeometry).toBe(true);
    expect(batch.geometry.instanceCount).toBe(2);
    expect(batch.geometry.getAttribute('position')).toBeTruthy();
    expect(batch.geometry.getAttribute('normal')).toBeTruthy();
    expect(batch.geometry.getAttribute('aTerrainFrame').itemSize).toBe(4);
    expect(batch.geometry.getAttribute('aTerrainParams').itemSize).toBe(4);
    expect(Object.keys(batch.geometry.attributes)).toHaveLength(4);
    expect([...batch.attributes.frame.array.subarray(0, 4)]).toEqual([0, 128, 0, 64]);
    expect(batch.attributes.params.array[2]).toBe(1);
    expect(layer.tick(340).morphing).toBe(false);
    expect(batch.attributes.params.array[2]).toBe(0);
    layer.dispose();
  });

  it('updates only new texture layers and keeps shell fallback in a one-layer batch', () => {
    const resources = fixture();
    const layer = new TerrainTileBatchSet({ maximumTiles: 2 });
    const shell = resources.get('shell');
    layer.sync([{ tileId: shell.tileId, value: shell }], { now: 0 });
    expect(layer.stats()).toMatchObject({ drawCalls: 1, renderedTiles: 1, textureUploads: 1 });
    const shellBatch = [...layer.batches.values()][0];
    expect(shellBatch.capacity).toBe(1);
    const version = shellBatch.texture.version;
    layer.sync([{ tileId: shell.tileId, value: shell }], { now: 10 });
    expect(shellBatch.texture.version).toBe(version);
    expect(shellBatch.textureUploads).toBe(1);

    const first = resources.get('l0/0/0');
    layer.sync([{ tileId: first.tileId, value: first }], { now: 20 });
    expect(shellBatch.mesh.visible).toBe(false);
    expect(layer.stats()).toMatchObject({ drawCalls: 1, renderedTiles: 1, textureUploads: 2 });
    expect(layer.batches.size).toBe(2);
    layer.dispose();
  });

  it('bounds mobile residency before allocating the texture array', () => {
    expect(() => new TerrainTileBatchSet({ maximumTiles: 0 })).toThrow(/maximumTiles/);
    const resources = fixture();
    const layer = new TerrainTileBatchSet({ maximumTiles: 1 });
    expect(() => layer.sync([
      resources.get('l0/0/0'),
      resources.get('l0/1/0'),
    ])).toThrow(/capacity is 1/);
    layer.dispose();
  });
});
