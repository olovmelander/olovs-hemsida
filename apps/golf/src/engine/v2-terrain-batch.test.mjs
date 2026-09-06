import { describe, expect, it } from 'vitest';
import { assetReferenceForChunk, verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { parseChunkEnvelope } from '../../../../packages/course-v2/chunk.mjs';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { StaticDrawUsage } from 'three/webgpu';
import { TerrainTextureBatch, TerrainTileBatchSet } from './v2-terrain-batch.mjs';

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
  it('skips settled tile work but honors resync, time rewind and morph-duration edits', () => {
    const resource = fixture().get('l0/0/0');
    const batch = new TerrainTextureBatch({ width: resource.width, height: resource.height, capacity: 2 });
    batch.sync([resource], { now: 0 });
    const settled = batch.tick(240), revision = batch.renderRevision;
    expect(batch.tick(1000)).toBe(settled);
    expect(batch.sync([resource], { now: 1000 })).toBe(settled);
    expect(batch.renderRevision).toBe(revision);
    expect(batch.tick(120).morphing).toBe(true);
    expect(batch.attributes.params.array[2]).toBeCloseTo(0.5);
    batch.tick(1000);
    batch.morphDurationMilliseconds = 2000;
    expect(batch.tick(1000).morphing).toBe(true);
    expect(batch.attributes.params.array[2]).toBeCloseTo(0.5);
    batch.tick(2000);
    batch.sync([{ ...resource, worldOriginX: 17.25 }], { now: 2100 });
    expect(batch.attributes.frame.array[0]).toBe(17.25);
    batch.sync([], { now: 2200 });
    expect(batch.tick(2300)).toEqual({ count: 0, morphing: false });
    expect(batch.mesh.visible).toBe(false);
    batch.dispose();
  });
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

  it('advances later batch buffers even while an earlier batch is still morphing', () => {
    const resources = fixture(), first = resources.get('l0/0/0'), second = resources.get('l0/1/0');
    const layer = new TerrainTileBatchSet({ maximumTiles: 2, morphDurationMilliseconds: 400 });
    layer.sync([first], { now: 0 });
    // Exercise the aggregate tick boundary with two real, independently timed
    // batches. A later batch must finish even if an earlier one returns true.
    const later = new TerrainTextureBatch({ width: second.width, height: second.height, capacity: 1,
      morphDurationMilliseconds: 100 });
    later.sync([second], { now: 0 });
    layer.batches.set('later', later);
    const earlier = [...layer.batches.values()][0];
    const textureVersion = later.texture.version;
    expect(layer.tick(100).morphing).toBe(true);
    expect(earlier.attributes.params.array[2]).toBeGreaterThan(0);
    expect(later.attributes.params.array[2]).toBe(0);
    expect(later.texture.version).toBe(textureVersion);
    expect(layer.tick(400).morphing).toBe(false);
    expect(earlier.attributes.params.array[2]).toBe(0);
    layer.dispose();
  });

  it('uploads changing morph parameters, then leaves settled Float32 buffers clean', () => {
    const resource = { ...fixture().get('l0/0/0'), worldOriginX: 0.1, worldOriginZ: -0.2,
      heightOffsetWorld: 1 / 3, sampleSpacingMetres: 0.7, heightScaleMetres: 0.01 };
    const layer = new TerrainTileBatchSet({ maximumTiles: 2 });
    layer.sync([resource], { now: 0 });
    const batch = [...layer.batches.values()][0], frame = batch.attributes.frame, params = batch.attributes.params;
    const initial = { frame: frame.version, params: params.version, texture: batch.texture.version };
    expect(frame.usage).toBe(StaticDrawUsage);
    expect(params.usage).toBe(StaticDrawUsage);
    layer.tick(120);
    expect(params.array[2]).toBe(0.5);
    expect(params.version).toBe(initial.params + 1);
    expect(frame.version).toBe(initial.frame);
    const middleRevision = layer.renderRevision;
    layer.tick(120);
    expect(layer.renderRevision).toBe(middleRevision);
    layer.tick(1000);
    expect(params.array[2]).toBe(0);
    expect(layer.renderRevision).toBeGreaterThan(middleRevision);
    const settled = { frame: frame.version, params: params.version, revision: layer.renderRevision };
    const bytes = [new Uint8Array(frame.array.buffer).slice(), new Uint8Array(params.array.buffer).slice()];
    for (let t = 1000; t < 3000; t += 16) layer.tick(t);
    layer.sync([resource], { now: 3000 });
    expect({ frame: frame.version, params: params.version, revision: layer.renderRevision }).toEqual(settled);
    expect(batch.texture.version).toBe(initial.texture);
    expect(new Uint8Array(frame.array.buffer)).toEqual(bytes[0]);
    expect(new Uint8Array(params.array.buffer)).toEqual(bytes[1]);
    expect(layer.inventory()[0].morph).toBe(0);
    layer.dispose();
  });

  it('invalidates same-count texture replacements, reordered instances and empty frontiers', () => {
    const resources = fixture(), a = resources.get('l0/0/0'), b = resources.get('l0/1/0');
    const layer = new TerrainTileBatchSet({ maximumTiles: 2, morphDurationMilliseconds: 0 });
    layer.sync([a, b], { now: 0 });
    const batch = [...layer.batches.values()][0];
    let revision = layer.renderRevision, uploads = batch.textureUploads;
    layer.sync([b, a], { now: 10 });
    expect(layer.renderRevision).toBeGreaterThan(revision);
    expect(batch.textureUploads).toBe(uploads);
    expect(batch.attributes.frame.array[0]).toBe(Math.fround(b.worldOriginX));
    revision = layer.renderRevision;
    const replacement = { ...b, decodedSha256: 'replacement', textureData: b.textureData.slice() };
    replacement.textureData[0] ^= 1;
    layer.sync([replacement, a], { now: 10 });
    expect(layer.renderRevision).toBeGreaterThan(revision);
    expect(batch.textureUploads).toBe(uploads + 1);
    revision = layer.renderRevision;
    layer.sync([], { now: 10 });
    expect(layer.renderRevision).toBeGreaterThan(revision);
    expect(layer.group.visible).toBe(false);
    expect(batch.mesh.visible).toBe(false);
    revision = layer.renderRevision;
    layer.tick(10);
    expect(layer.renderRevision).toBe(revision);
    layer.dispose();
    expect(layer.renderRevision).toBeGreaterThan(revision);
  });
});
