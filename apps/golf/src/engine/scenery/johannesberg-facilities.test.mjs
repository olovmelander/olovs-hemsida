import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { JOHANNESBERG_FACILITY_SOURCE_IDS, facilityVerticalPlacement,
  loadJohannesbergFacilities, validateJohannesbergFacilitiesManifest } from './johannesberg-facilities.mjs';

function fixture(document = { asset: { version: '2.0' } }) {
  const raw = JSON.stringify(document);
  const json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4));
  const bytes = Buffer.alloc(20 + json.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const scene = new THREE.Scene(), root = new THREE.Group();
  const materials = [], geometries = [];
  const buildings = JOHANNESBERG_FACILITY_SOURCE_IDS.map((id, i) => {
    const x = -230 + i * 8, z = -850;
    return { id, ring: [[x - 3, z - 3], [x + 3, z - 3], [x + 3, z + 3], [x - 3, z + 3]] };
  });
  const facilities = buildings.map((b, i) => {
    const x = -230 + i * 8, z = -850;
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 20, z);
    materials.push(material); geometries.push(geometry);
    const node = new THREE.Group();
    node.name = `facility-${i}`; node.userData.sourceBuildingId = b.id;
    node.add(new THREE.Mesh(geometry, material)); root.add(node);
    return { id: node.name, nodeName: node.name, sourceBuildingId: b.id,
      groundAnchorLocal: [x, z], groundAnchorRh2000M: 17, placement: 'absolute-rh2000' };
  });
  const manifest = { schemaVersion: 1, groundId: 'johannesberg', courseSlugs: ['johannesberg', 'johannesberg-9'],
    coordinateFrame: { kind: 'legacy-local-rh2000', originWgs84: { lat: 59.72733, lon: 18.19202 }, mPerLat: 111320, mPerLon: 56118.16 },
    asset: { url: 'models/johannesberg/facilities-v1.glb', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }, facilities };
  const fetchImpl = vi.fn(async url => url.endsWith('.json')
    ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => buffer });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'johannesberg', buildings, terrainH: () => 30,
    v2Active: true, verticalDatumOffsetMetres: 5.6676, baseUrl: 'https://example.test/olovs-hemsida/', fetchImpl, parseGlb };
  return { manifest, buildings, context, root, scene, materials, geometries, fetchImpl, parseGlb };
}

describe('Johannesberg authored facility installation', () => {
  it('loads an actual embedded GLB through GLTFLoader with source extras and global vertex coordinates', async () => {
    const f = fixture();
    const values = new Float32Array(22 * 9);
    const nodes = [], meshes = [], accessors = [], bufferViews = [];
    for (let i = 0; i < 22; i++) {
      const [x, z] = f.manifest.facilities[i].groundAnchorLocal;
      values.set([x - 2, 17, z - 2, x + 2, 17, z + 2, x, 23, z], i * 9);
      bufferViews.push({ buffer: 0, byteOffset: i * 36, byteLength: 36 });
      accessors.push({ bufferView: i, componentType: 5126, count: 3, type: 'VEC3', min: [x - 2, 17, z - 2], max: [x + 2, 23, z + 2] });
      meshes.push({ primitives: [{ attributes: { POSITION: i } }] });
      nodes.push({ name: f.manifest.facilities[i].nodeName, mesh: i, extras: { sourceBuildingId: f.buildings[i].id } });
    }
    const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: values.byteLength }] };
    const raw = JSON.stringify(document), json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4));
    const binary = Buffer.from(values.buffer);
    const bytes = Buffer.alloc(28 + json.length + binary.length);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(bytes, 28 + json.length);
    f.manifest.asset.bytes = bytes.length;
    f.manifest.asset.sha256 = createHash('sha256').update(bytes).digest('hex');
    const { parseGlb: unused, ...context } = f.context;
    context.fetchImpl = async url => url.endsWith('.json') ? { ok: true, json: async () => f.manifest }
      : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    const result = await loadJohannesbergFacilities(context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities).toHaveLength(22);
    expect(result.report.triangles).toBe(22);
    result.dispose();
  });

  it('installs every named building atomically, with the measured vertical bridge applied once', async () => {
    const f = fixture();
    const result = await loadJohannesbergFacilities(f.context);
    expect(result.report.status).toBe('loaded');
    expect([...result.replacedBuildingIds]).toEqual([...JOHANNESBERG_FACILITY_SOURCE_IDS]);
    expect(result.replacedBuildingIds.has('unrelated-building')).toBe(false);
    expect(f.scene.children).toEqual([f.root]);
    expect(f.root.children[0].position.y).toBeCloseTo(5.6676, 8);
    expect(new THREE.Box3().setFromObject(f.root.children[0]).min.y).toBeCloseTo(22.6676, 5);
    expect(f.fetchImpl.mock.calls[1][0]).toBe('https://example.test/olovs-hemsida/models/johannesberg/facilities-v1.glb');
    result.dispose();
    expect(f.scene.children).toEqual([]);
    expect(result.replacedBuildingIds.size).toBe(0);
  });

  it('uses the visible terrain for a coarse-surroundings node and for all nodes in v2 fallback', async () => {
    const f = fixture();
    f.manifest.facilities[0].placement = 'terrain-anchor';
    let result = await loadJohannesbergFacilities(f.context);
    expect(f.root.children[0].position.y).toBe(13);
    expect(f.root.children[1].position.y).toBeCloseTo(5.6676);
    expect(result.report.facilities[0].groundResidualMetres).toBe(0);
    result.dispose();
    const fallback = fixture();
    result = await loadJohannesbergFacilities({ ...fallback.context, courseSlug: 'johannesberg-9', v2Active: false });
    expect(result.report.status).toBe('loaded');
    expect(result.report.facilities.every(p => p.mode === 'terrain-anchor' && p.groundResidualMetres === 0)).toBe(true);
    result.dispose();
  });

  it('preserves all generic replacements on a missing node and releases partially parsed resources', async () => {
    const f = fixture();
    f.root.children[9].name = 'missing';
    const disposals = f.geometries.map(g => vi.spyOn(g, 'dispose'));
    const result = await loadJohannesbergFacilities(f.context);
    expect(result.report.status).toBe('fallback');
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(f.scene.children).toEqual([]);
    expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('rejects a source mismatch, incomplete inventory and a foreign course before parsing geometry', async () => {
    const f = fixture();
    expect(() => validateJohannesbergFacilitiesManifest(f.manifest, { courseSlug: 'upsala', buildings: f.buildings })).toThrow('another course');
    const incomplete = structuredClone(f.manifest); incomplete.facilities.pop();
    expect(() => validateJohannesbergFacilitiesManifest(incomplete, f.context)).toThrow('Incomplete');
    f.manifest.facilities[0].sourceBuildingId = 'unrelated-building';
    const result = await loadJohannesbergFacilities(f.context);
    expect(result.report.status).toBe('fallback');
    expect(f.parseGlb).not.toHaveBeenCalled();
    expect(f.scene.children).toEqual([]);
  });

  it('checks byte integrity before parsing, and refuses external images or buffers', async () => {
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    expect((await loadJohannesbergFacilities(bad.context)).report.reason).toContain('checksum');
    expect(bad.parseGlb).not.toHaveBeenCalled();
    const external = fixture({ asset: { version: '2.0' }, buffers: [{ uri: 'https://other.test/data.bin' }] });
    expect((await loadJohannesbergFacilities(external.context)).report.status).toBe('fallback');
    expect(external.parseGlb).not.toHaveBeenCalled();
  });

  it('rejects non-finite vertices and a model translated away from its named footprint', async () => {
    const nan = fixture(); nan.geometries[5].attributes.position.setX(0, NaN);
    expect((await loadJohannesbergFacilities(nan.context)).report.reason).toContain('Non-finite');
    expect(nan.scene.children).toEqual([]);
    const invalidNormal = fixture(); invalidNormal.geometries[5].attributes.normal.setX(0, NaN);
    expect((await loadJohannesbergFacilities(invalidNormal.context)).report.reason).toContain('normal');
    const moved = fixture(); moved.root.children[5].position.x = 100;
    expect((await loadJohannesbergFacilities(moved.context)).report.reason).toContain('bounds');
    expect(moved.scene.children).toEqual([]);
  });

  it('does not attach late async geometry after navigation and disposes it once', async () => {
    const f = fixture();
    const controller = new AbortController();
    const released = f.materials.map(m => vi.spyOn(m, 'dispose'));
    f.parseGlb.mockImplementation(async () => { controller.abort(); return { scene: f.root }; });
    const result = await loadJohannesbergFacilities({ ...f.context, signal: controller.signal });
    expect(result.report.status).toBe('fallback');
    expect(f.scene.children).toEqual([]);
    expect(result.replacedBuildingIds.size).toBe(0);
    result.dispose();
    expect(released.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('rejects a stale course even when the network does not honour cancellation', async () => {
    const f = fixture();
    let current = true;
    f.parseGlb.mockImplementation(async () => { current = false; return { scene: f.root }; });
    const result = await loadJohannesbergFacilities({ ...f.context, isCurrentCourse: () => current });
    expect(result.report.status).toBe('fallback');
    expect(f.scene.children).toEqual([]);
  });

  it('rejects unavailable ground instead of silently planting at zero height', () => {
    const f = fixture();
    expect(() => facilityVerticalPlacement(f.manifest.facilities[0], { v2Active: false,
      terrainH: () => NaN, verticalDatumOffsetMetres: 5.6676 })).toThrow('ground');
  });
});
