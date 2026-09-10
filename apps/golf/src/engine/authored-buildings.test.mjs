import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { inspectBuildingGlb, loadAuthoredBuildings, sourceFootprintSha256 } from './authored-buildings.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixtureGlb(change = () => {}) {
  const values = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 4]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [1, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.1, 1], roughnessFactor: 0.8, metallicFactor: 0 } }],
    buffers: [{ byteLength: values.byteLength }], bufferViews: [{ buffer: 0, byteLength: values.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 3, 4] }] };
  change(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new ArrayBuffer(12 + 8 + jsonLength + 8 + values.byteLength), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, jsonLength).fill(32); new Uint8Array(bytes, 20, encoded.length).set(encoded);
  view.setUint32(20 + jsonLength, values.byteLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  new Uint8Array(bytes, 28 + jsonLength).set(new Uint8Array(values.buffer));
  return bytes;
}
const building = () => ({ id: 'source-clubhouse', ring: [[10, 16], [15, 16], [15, 21], [10, 21], [10, 16]],
  roofSurface: { triangleIndices: [0, 1, 2], vertices: [{ c: [10, 16], heightRH2000: 38 }] } });
async function setup(bytes = fixtureGlb()) {
  const source = building(), sha256 = hash(new Uint8Array(bytes));
  const descriptor = { buildingId: source.id,
    asset: { url: `courses/test/architecture/${sha256}.glb`, sha256, bytes: bytes.byteLength },
    sourceFootprintSha256: await sourceFootprintSha256(source),
    anchorEpsg3006RH2000: [597410.5, 6614879.5, 35], courseOriginEpsg3006: [597400.5, 6614899.5],
    rotationYRadians: Math.PI / 2, scale: 1, appearanceStatus: 'photo-informed-display-model', evidence: ['fixture'] };
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }));
  return { descriptor, source, fetchFn, args: { descriptors: [descriptor], buildings: [source], baseUrl: 'https://example.test/site/', fetchFn } };
}

describe('authored building GLB display assets', () => {
  it('loads actual GLB geometry, retains node transforms and places exact metric XY with absolute RH2000 Y', async () => {
    const fixture = await setup(), before = structuredClone(fixture.source);
    const result = await loadAuthoredBuildings(fixture.args), loaded = result.byBuildingId.get(fixture.source.id);
    expect(result.diagnostics[0].status).toBe('loaded');
    expect(fixture.fetchFn.mock.calls[0][0]).toBe(`https://example.test/site/${fixture.descriptor.asset.url}`);
    expect(loaded.object.position.toArray()).toEqual([10, 35, 20]);
    expect(loaded.details).toMatchObject({ meshes: 1, vertices: 3, triangles: 1, sourceRoofTriangles: 1 });
    for (const [axis, value] of [10, 35, 17].entries()) expect(loaded.details.bounds.min[axis]).toBeCloseTo(value, 10);
    for (const [axis, value] of [14, 38, 19].entries()) expect(loaded.details.bounds.max[axis]).toBeCloseTo(value, 10);
    const mesh = loaded.object.children[0].children[0];
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(mesh.material.roughness).toBe(0.8);
    expect(fixture.source).toEqual(before);
  });

  it('source inspection never requests or parses display assets', async () => {
    const fixture = await setup(), parseGlb = vi.fn();
    const result = await loadAuthoredBuildings({ ...fixture.args, sourceMode: true, parseGlb });
    expect(result.byBuildingId.size).toBe(0);
    expect(result.diagnostics[0].status).toBe('source-view');
    expect(fixture.fetchFn).not.toHaveBeenCalled(); expect(parseGlb).not.toHaveBeenCalled();
  });

  it('keeps explicit source fallbacks for network, HTTP and parser failures', async () => {
    for (const failure of ['network', 'http', 'parser']) {
      const fixture = await setup(), before = structuredClone(fixture.source);
      const parseGlb = vi.fn(async () => { throw new Error('Decoder rejected fixture'); });
      if (failure === 'network') fixture.args.fetchFn = async () => { throw new Error('Offline'); };
      if (failure === 'http') fixture.args.fetchFn = async () => ({ ok: false, status: 404 });
      const result = await loadAuthoredBuildings({ ...fixture.args, parseGlb });
      expect(result.byBuildingId.size).toBe(0);
      expect(result.diagnostics[0]).toMatchObject({ buildingId: fixture.source.id, status: 'fallback', sourceFootprintUnchanged: true, sourceRoofUnchanged: true });
      expect(result.diagnostics[0].error).toMatch(/Offline|404|Decoder rejected/);
      expect(fixture.source).toEqual(before);
      expect(parseGlb).toHaveBeenCalledTimes(failure === 'parser' ? 1 : 0);
    }
  });

  it('rejects changed source rings, changed bytes, non-unit scale and duplicate descriptors without suppressing source geometry', async () => {
    for (const mutate of [
      f => { f.source.ring[0][0] += 0.01; },
      f => { f.descriptor.asset.sha256 = 'a'.repeat(64); f.descriptor.asset.url = `courses/test/architecture/${'a'.repeat(64)}.glb`; },
      f => { f.descriptor.scale = 100; },
      f => { f.args.descriptors.push(structuredClone(f.descriptor)); },
    ]) {
      const fixture = await setup(); mutate(fixture);
      const parseGlb = vi.fn(), before = structuredClone(fixture.source);
      const result = await loadAuthoredBuildings({ ...fixture.args, parseGlb });
      expect(result.byBuildingId.size).toBe(0);
      expect(result.diagnostics.every(row => row.status === 'fallback' && row.error)).toBe(true);
      expect(parseGlb).not.toHaveBeenCalled(); expect(fixture.source).toEqual(before);
    }
  });

  it('rejects nested resources, textures, lights and animated geometry before invoking the parser', async () => {
    for (const change of [
      json => { json.buffers[0].uri = 'https://example.test/unverified.bin'; },
      json => { json.images = [{ uri: 'data:image/png;base64,AAAA' }]; },
      json => { json.images = [{ bufferView: 0, mimeType: 'image/png' }]; },
      json => { json.animations = [{ channels: [], samplers: [] }]; },
      json => { json.extensions = { KHR_lights_punctual: { lights: [] } }; },
      json => { json.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; },
    ]) {
      const bytes = fixtureGlb(change);
      expect(() => inspectBuildingGlb(bytes)).toThrow();
      const fixture = await setup(bytes), parseGlb = vi.fn();
      const result = await loadAuthoredBuildings({ ...fixture.args, parseGlb });
      expect(result.byBuildingId.size).toBe(0); expect(result.diagnostics[0].status).toBe('fallback');
      expect(parseGlb).not.toHaveBeenCalled();
    }
  });

  it('reuses verified asset bytes while giving each placement independent scene transforms', async () => {
    const fixture = await setup(), second = { ...fixture.source, id: 'second-building' };
    const descriptor = { ...fixture.descriptor, buildingId: second.id, rotationYRadians: 0,
      anchorEpsg3006RH2000: [597415.5, 6614879.5, 35] };
    const result = await loadAuthoredBuildings({ ...fixture.args, descriptors: [fixture.descriptor, descriptor], buildings: [fixture.source, second] });
    expect(result.byBuildingId.size).toBe(2); expect(fixture.fetchFn).toHaveBeenCalledTimes(1);
    const first = result.byBuildingId.get(fixture.source.id).object, other = result.byBuildingId.get(second.id).object;
    expect(first).not.toBe(other); expect(first.children[0]).not.toBe(other.children[0]);
    expect(first.position.toArray()).toEqual([10, 35, 20]); expect(other.position.toArray()).toEqual([15, 35, 20]);
  });

  it('the shipping building loop renders an authored model exactly once and retains TIN and generic fallbacks', async () => {
    const fixture = await setup(), prepared = await loadAuthoredBuildings(fixture.args);
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const start = main.indexOf('  for (const [buildingIndex, b] of M.infra.buildings.entries()) {', main.indexOf('const sourceBuildingView'));
    const end = main.indexOf('    const [cx, cz] = centroidOf(b.ring);', start);
    const loop = main.slice(start, end) + '    generic.push(b.id);\n  }';
    const fallback = { ...building(), id: 'source-fallback' }, generic = { ...building(), id: 'generic-fallback', roofSurface: null };
    const makeContext = prepared => ({ M: { infra: { buildings: [fixture.source, fallback, generic] }, scenery: { mappedFeatures: [] } }, authoredBuildings: prepared,
      sourceBuildingView: false, SCENERY: null, scene: { add: vi.fn() }, generic: [], facilityArchitecture: null,
      stats: { sourceRoofBuildings: 0, sourceRoofTriangles: 0, authoredBuildingModels: 0, authoredBuildingMeshes: 0,
        authoredBuildingTriangles: 0, architecturalBuildings: 0, architecturalTriangles: 0, measuredRoofBuildings: 0,
        measuredRoofTriangles: 0, clubhouseDetails: [], draws: 0, tris: 0, verts: 0,
        sourceBuildingBatchIds: [], sourceBuildingBatchIndices: [] },
      measuredRoofGeometry: vi.fn(() => ({ triangles: [], walls: [] })), terrainH: () => 35,
      L: value => value, tri: vi.fn(), quad: vi.fn() });
    const normal = makeContext(prepared); vm.runInNewContext(loop, normal);
    expect(normal.scene.add).toHaveBeenCalledTimes(1);
    expect(normal.measuredRoofGeometry).toHaveBeenCalledTimes(1);
    expect(normal.stats.sourceRoofBuildings).toBe(2);
    expect(normal.stats.authoredBuildingModels).toBe(1);
    expect(normal.generic).toEqual([generic.id]);
    const source = makeContext(await loadAuthoredBuildings({ ...fixture.args, sourceMode: true }));
    source.sourceBuildingView = true; vm.runInNewContext(loop, source);
    expect(source.scene.add).not.toHaveBeenCalled(); expect(source.measuredRoofGeometry).toHaveBeenCalledTimes(2);
    expect(source.generic).toEqual([generic.id]);
  });
});
