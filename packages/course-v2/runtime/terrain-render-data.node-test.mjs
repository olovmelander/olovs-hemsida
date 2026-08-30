import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetReferenceForChunk, verifyChunkAsset } from '../chunk-node.mjs';
import { parseChunkEnvelope } from '../chunk.mjs';
import { createSyntheticAssetGraph } from '../synthetic-fixture.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
  sampleTerrainRenderResource,
} from './terrain-render-data.mjs';

function syntheticTerrain(id = 'l0/0/0') {
  const graph = createSyntheticAssetGraph();
  for (const [url, bytes] of graph.resources) {
    if (!url.endsWith('.bvch')) continue;
    const header = parseChunkEnvelope(bytes).header;
    if (header.id !== id) continue;
    const reference = assetReferenceForChunk(bytes, { kind: 'terrain', directory: 'assets/terrain' });
    return verifyChunkAsset(reference, bytes);
  }
  throw new Error(`missing synthetic terrain ${id}`);
}

function syntheticFrame() {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
  const course = JSON.parse(graph.resources.get(entry.manifest.url));
  return JSON.parse(graph.resources.get(course.groundManifest.url)).frame;
}

function uint16At(bytes, offset) {
  return bytes[offset] | bytes[offset + 1] << 8;
}

test('terrain render preparation packs height, parent morph and octahedral normal in portable RGBA8 texels', () => {
  const decoded = syntheticTerrain();
  const prepared = prepareTerrainRenderData(decoded);
  assert.equal(prepared.layout, 'rgba8x2-height-parent-octnormal-v1');
  assert.equal(prepared.width, 3);
  assert.equal(prepared.height, 3);
  assert.ok(prepared.textureData instanceof Uint8Array);
  assert.equal(prepared.textureData.length, 3 * 3 * 8);
  assert.equal(prepared.noDataCount, 0);
  assert.equal(prepared.gpuBytes, 72);

  const source = new DataView(decoded.payload.buffer, decoded.payload.byteOffset, decoded.payload.byteLength);
  const quantized = index => source.getUint16(index * 2, true);
  const centreOffset = 4 * 8;
  assert.equal(uint16At(prepared.textureData, centreOffset), quantized(4));
  assert.equal(uint16At(prepared.textureData, centreOffset + 2), Math.round(
    (quantized(0) + quantized(2) + quantized(6) + quantized(8)) / 4,
  ));
  assert.ok(prepared.maximumMorphDeltaMetres > 0);
  assert.ok(prepared.maximumNormalEncodingErrorDegrees < 0.01);
});

test('terrain render resource applies the approved EPSG:5845 frame and samples visible height', () => {
  const decoded = syntheticTerrain();
  const resource = createTerrainRenderResource({
    tileId: decoded.header.id,
    decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
    frame: syntheticFrame(),
  });
  assert.equal(resource.worldOriginX, 0);
  assert.equal(resource.worldOriginZ, 128);
  assert.equal(resource.heightOffsetWorld, 0);
  assert.equal(resource.gpuBytes, 72);
  assert.equal(sampleTerrainRenderResource(resource, 64, 192), 0.5);
  assert.ok(Number.isNaN(sampleTerrainRenderResource(resource, -1, 192)));
});

test('renderer refuses incomplete authoritative coverage instead of drawing a nodata pit', () => {
  const decoded = syntheticTerrain();
  const corruptPayload = new Uint8Array(decoded.payload);
  new DataView(corruptPayload.buffer).setUint16(4 * 2, decoded.header.grid.noDataValue, true);
  const terrainRenderData = prepareTerrainRenderData({ ...decoded, payload: corruptPayload });
  assert.equal(terrainRenderData.noDataCount, 1);
  assert.throws(() => createTerrainRenderResource({
    tileId: decoded.header.id,
    decoded: { ...decoded, payload: corruptPayload, terrainRenderData },
    frame: syntheticFrame(),
  }), /nodata samples/);
});

test('worker render preparation bounds derived GPU allocations independently of the chunk limit', () => {
  const decoded = syntheticTerrain();
  assert.throws(() => prepareTerrainRenderData({
    ...decoded,
    header: {
      ...decoded.header,
      grid: { ...decoded.header.grid, width: 1026 },
    },
  }), /may not exceed 1025/);
});
