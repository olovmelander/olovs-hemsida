import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyChunkAsset } from '../chunk-node.mjs';
import { createTerrainRenderResource, sampleTerrainRenderResource } from './terrain-render-data.mjs';
import { createTerrainRenderView, terrainRenderStride } from './terrain-render-quality.mjs';
import { createTerrainGridTopology } from './terrain-grid-topology.mjs';

function source({ size = 9, x = 0, z = 0, spacing = 1, height = (c, r) => 100 + c * c + r * r } = {}) {
  const payload = new Uint8Array(size * size * 2), view = new DataView(payload.buffer);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) view.setUint16((r * size + c) * 2, height(x + c * spacing, z + r * spacing), true);
  return createTerrainRenderResource({ tileId: 'l1/0/0', decoded: {
    payload, header: { id: 'l1/0/0', kind: 'terrain', payloadFormat: 'terrain-grid-u16-le-v1', decodedSha256: 'fixture',
      bounds: { minEasting: x, maxEasting: x + (size - 1) * spacing, maxNorthing: -z, minNorthing: -z - (size - 1) * spacing },
      grid: { width: size, height: size, heightScaleMetres: 0.01, heightOffsetMetres: 0, noDataValue: 65535,
        sampleSpacingMetres: spacing, geometricErrorMetres: 0.005 } },
  }, frame: { compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
    origin: { easting: 0, northing: 0, heightRH2000: 0 }, axisMapping: {
      worldX: 'easting - originEasting', worldY: 'heightRH2000 - originHeightRH2000', worldZ: 'originNorthing - northing' } } });
}
const q = (resource, c, r, channel = 0) => {
  const p = (r * resource.width + c) * 8 + channel;
  return resource.textureData[p] | resource.textureData[p + 1] << 8;
};

test('stride one preserves the exact resource; invalid policies/grids fail', () => {
  const a = source();
  assert.equal(createTerrainRenderView(a), a);
  for (const value of [0, 3, -1, NaN, '2']) assert.throws(() => terrainRenderStride(value), /stride/);
  assert.throws(() => createTerrainRenderView(source({ size: 4 }), { stride: 2 }), /cannot use/);
});

test('reduced terrain preserves all CPU heights, payload, bounds and sampled normals', () => {
  const a = source(), original = a.textureData.slice();
  const b = createTerrainRenderView(a, { stride: 2, parentStride: 2 });
  assert.equal(b.width, 5); assert.equal(b.sampleSpacingMetres, 2);
  assert.equal(b.payload, a.payload); assert.equal(b.bounds, a.bounds);
  for (let z = 0; z <= 8; z += 0.25) for (let x = 0; x <= 8; x += 0.25) {
    assert.equal(sampleTerrainRenderResource(b, x, z), sampleTerrainRenderResource(a, x, z));
  }
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    assert.equal(q(b, c, r), q(a, c * 2, r * 2));
    assert.deepEqual(b.textureData.slice((r * 5 + c) * 8 + 4, (r * 5 + c) * 8 + 8),
      a.textureData.slice((r * 2 * 9 + c * 2) * 8 + 4, (r * 2 * 9 + c * 2) * 8 + 8));
  }
  assert.deepEqual(a.textureData, original);
  assert.equal(b.gpuBytes, 5 * 5 * 8);
});

test('parent targets follow rendered triangles and survive even-vertex reduction', () => {
  const a = source(), b = createTerrainRenderView(a, { stride: 2, parentStride: 2 });
  // (2,2) lies on the parent NE/SW diagonal. A copied parent channel would
  // equal its fine height (108), giving zero morph; its parent height is 116.
  assert.equal(q(b, 1, 1), 108);
  assert.equal(q(b, 1, 1, 2), 116);
  assert.ok(b.maximumMorphDeltaMetres > 0);
  // A full-resolution course child also morphs to that coarser parent.
  const native = createTerrainRenderView(a, { stride: 1, parentStride: 2 });
  assert.equal(native.width, a.width);
  assert.equal(q(native, 2, 2), 108);
  assert.equal(q(native, 2, 2, 2), 116);
  assert.equal(native.maximumReductionErrorMetres, 0);
  // On the bilinear saddle, triangular and bilinear interpolation disagree.
  const saddle = createTerrainRenderView(source({ height: (x, z) => 100 + x * z }), { stride: 2, parentStride: 2 });
  assert.equal(q(saddle, 1, 1, 2), 100);
});

test('reduction error bounds the omitted source triangles and is added to source error', () => {
  const a = source(), b = createTerrainRenderView(a, { stride: 2, parentStride: 2 });
  assert.ok(Math.abs(b.maximumReductionErrorMetres - 0.02) < 1e-12);
  assert.ok(Math.abs(b.geometricErrorMetres - 0.025) < 1e-12);
  const plane = createTerrainRenderView(source({ height: (x, z) => 100 + 2 * x + 3 * z }), { stride: 2, parentStride: 2 });
  assert.equal(plane.maximumReductionErrorMetres, 0);
});

test('adjacent reduced tiles have identical shared edge samples and morph targets', () => {
  const a = createTerrainRenderView(source(), { stride: 2, parentStride: 2 });
  const b = createTerrainRenderView(source({ x: 8 }), { stride: 2, parentStride: 2 });
  for (let r = 0; r < 5; r++) {
    assert.equal(q(a, 4, r), q(b, 0, r));
    assert.equal(q(a, 4, r, 2), q(b, 0, r, 2));
  }
});

test('257 to 129 grids retain skirts and cut per-tile geometry by approximately 75 percent', () => {
  const a = createTerrainGridTopology({ width: 257, height: 257 });
  const b = createTerrainGridTopology({ width: 129, height: 129 });
  assert.equal(a.triangleCount, 133120);
  assert.equal(b.triangleCount, 33792);
  assert.ok(b.triangleCount / a.triangleCount < 0.26);
  assert.ok(b.skirtTriangleCount > 0);
});


test('parent targets below the child offset preserve fine world heights without clipping', () => {
  const a = source();
  const parent = { ...source({ spacing: 2 }), heightOffsetWorld: -4 };
  const b = createTerrainRenderView(a, { stride: 1, parentStride: 2, parentResource: parent });
  assert.ok(b.heightOffsetWorld < a.heightOffsetWorld);
  for (let r = 0; r < b.height; r++) for (let c = 0; c < b.width; c++) {
    assert.ok(Math.abs(q(b, c, r) * b.heightScaleMetres + b.heightOffsetWorld - q(a, c, r) * a.heightScaleMetres) < 1e-12);
    assert.equal(sampleTerrainRenderResource(a, c, r), sampleTerrainRenderResource(b, c, r));
  }
  assert.equal(q(b, 0, 0, 2) * b.heightScaleMetres + b.heightOffsetWorld, -3);
});

test('published ring children morph onto their rendered parents within source quantization', () => {
  const root = new URL('../../../apps/golf/public/', import.meta.url);
  const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const index = json('courses/v2-index.json');
  for (const slug of ['upsala', 'lidingo', 'visby']) {
    const course = json(index.courses.find(c => c.slug === slug).manifest.url);
    const ground = json(course.groundManifest.url);
    const parents = new Set(ground.tiles.map(t => t.parentId).filter(Boolean));
    const load = tile => createTerrainRenderResource({ tileId: tile.id, frame: ground.frame,
      decoded: verifyChunkAsset(tile.layers.terrain, readFileSync(new URL(tile.layers.terrain.url, root))) });
    for (const refinable of [false, true]) {
      const tile = ground.tiles.find(t => t.parentId && parents.has(t.id) === refinable);
      assert.ok(tile, `${slug} has this frontier type`);
      const parent = createTerrainRenderView(load(ground.tiles.find(t => t.id === tile.parentId)), { stride: 2, parentStride: 2 });
      const child = createTerrainRenderView(load(tile), { stride: refinable ? 2 : 1, parentStride: 2, parentResource: parent });
      const at = (c, r) => q(parent, c, r) * parent.heightScaleMetres + parent.heightOffsetWorld;
      let maximum = 0;
      for (let r = 0; r < child.height; r++) for (let c = 0; c < child.width; c++) {
        const x = (child.worldOriginX + c * child.sampleSpacingMetres - parent.worldOriginX) / parent.sampleSpacingMetres;
        const z = (child.worldOriginZ + r * child.sampleSpacingMetres - parent.worldOriginZ) / parent.sampleSpacingMetres;
        const west = Math.min(parent.width - 2, Math.floor(x)), north = Math.min(parent.height - 2, Math.floor(z));
        const u = x - west, v = z - north;
        const target = u + v <= 1
          ? at(west, north) * (1 - u - v) + at(west + 1, north) * u + at(west, north + 1) * v
          : at(west + 1, north) * (1 - v) + at(west, north + 1) * (1 - u) + at(west + 1, north + 1) * (u + v - 1);
        maximum = Math.max(maximum, Math.abs(target - (q(child, c, r, 2) * child.heightScaleMetres + child.heightOffsetWorld)));
      }
      const tolerance = (child.heightScaleMetres + parent.heightScaleMetres) / 2 + 1e-8;
      assert.ok(maximum <= tolerance, `${slug} ${tile.id} morph mismatch ${maximum} exceeds ${tolerance}`);
    }
  }
});
