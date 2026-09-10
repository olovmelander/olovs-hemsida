import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { build, facilityFootprints, isFacilityInterior } from './visby.js';
import { loadVisbyFacilities, validateVisbyFacilitiesManifest,
  visbyFacilityVerticalPlacement } from './visby-facilities.mjs';

const ringAt = (x, z) => [[x - 5, z - 5], [x + 5, z - 5], [x + 5, z + 5], [x - 5, z + 5]];
function glb(document, binary = null) {
  const raw = JSON.stringify(document), json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4));
  const bytes = Buffer.alloc(20 + json.length + (binary ? 8 + binary.length : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  if (binary) {
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
    binary.copy(bytes, 28 + json.length);
  }
  return bytes;
}

function fixture(document = { asset: { version: '2.0' } }) {
  const bytes = glb(document), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buildings = [
    { id: 'way/530655631', ring: ringAt(-521, 206) },
    { id: 'way/530655632', ring: ringAt(-591, 205) },
    { id: 'unrelated', ring: ringAt(900, 300) },
  ];
  const scene = new THREE.Scene(), root = new THREE.Group();
  const facilities = [
    { id: 'clubhouse', sourceBuildingId: 'way/530655631', groundAnchorLocal: [-521, 206] },
    { id: 'keeper-house', sourceBuildingId: 'way/530655632', groundAnchorLocal: [-591, 205] },
    { id: 'lighthouse', sourceLandmarkId: 'skansudde-lighthouse', groundAnchorLocal: [-603.3, 190.4] },
    { id: 'practice-shelter', sourceFeatureId: 'ortho-practice-shelter', groundAnchorLocal: [-420, 185],
      footprintLocal: ringAt(-420, 185) },
  ].map(f => ({ ...f, nodeName: `Visby ${f.id}`, groundAnchorRh2000M: 3.2, placement: 'absolute-rh2000' }));
  const geometries = [], materials = [];
  for (const facility of facilities) {
    const [x, z] = facility.groundAnchorLocal;
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 6.2, z);
    const material = new THREE.MeshStandardMaterial();
    const node = new THREE.Group();
    node.name = facility.nodeName;
    for (const key of ['sourceBuildingId', 'sourceLandmarkId', 'sourceFeatureId']) {
      if (facility[key]) node.userData[key] = facility[key];
    }
    node.add(new THREE.Mesh(geometry, material)); root.add(node);
    geometries.push(geometry); materials.push(material);
  }
  const manifest = { schemaVersion: 1, groundId: 'visby', courseSlugs: ['visby'],
    coordinateFrame: { kind: 'epsg3006-local-rh2000', originEpsg3006: { easting: 687748.5, northing: 6370951.5 },
      axes: 'east-up-south', heightDatum: 'RH2000' },
    asset: { url: 'models/visby/facilities-v1.glb', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    facilities };
  const fetchImpl = vi.fn(async url => url.endsWith('.json')
    ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => buffer });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'visby', buildings, terrainH: () => 3.1,
    v2Active: true, verticalDatumOffsetMetres: -.1, baseUrl: 'https://example.test/olovs-hemsida/', fetchImpl, parseGlb };
  return { manifest, context, buildings, facilities, scene, root, geometries, materials, fetchImpl, parseGlb };
}

describe('Visby Blender facilities', () => {
  it('excludes vegetation in new roof footprints without clearing the range mat strips or net envelope', () => {
    expect(facilityFootprints.map(f => f.id)).toContain('range-parking-building-2026');
    expect(facilityFootprints.every(f => !/(?:mats|net)/.test(f.id))).toBe(true);
    expect(isFacilityInterior(-348, 125)).toBe(true);
    expect(isFacilityInterior(-294, 100)).toBe(false);
    expect(isFacilityInterior(-197, 40)).toBe(false);
    expect(isFacilityInterior(0, 0)).toBe(false);
  });

  it('loads real embedded GLB bytes, including building, lighthouse, and new traced facility nodes', async () => {
    const f = fixture(), positions = new Float32Array(f.facilities.length * 9);
    const nodes = [], meshes = [], accessors = [], bufferViews = [];
    for (const [i, facility] of f.facilities.entries()) {
      const [x, z] = facility.groundAnchorLocal;
      positions.set([x - 2, 3.2, z - 2, x + 2, 3.2, z + 2, x, 9.2, z], i * 9);
      bufferViews.push({ buffer: 0, byteOffset: i * 36, byteLength: 36 });
      accessors.push({ bufferView: i, componentType: 5126, count: 3, type: 'VEC3',
        min: [x - 2, 3.2, z - 2], max: [x + 2, 9.2, z + 2] });
      meshes.push({ primitives: [{ attributes: { POSITION: i } }] });
      nodes.push({ name: facility.nodeName, mesh: i, extras: { ...f.root.children[i].userData } });
    }
    const bytes = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: positions.byteLength }] }, Buffer.from(positions.buffer));
    f.manifest.asset.bytes = bytes.length;
    f.manifest.asset.sha256 = createHash('sha256').update(bytes).digest('hex');
    const { parseGlb: unused, ...context } = f.context;
    context.fetchImpl = async url => url.endsWith('.json') ? { ok: true, json: async () => f.manifest }
      : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    const result = await loadVisbyFacilities(context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities).toHaveLength(4);
    expect(result.report.triangles).toBe(4);
    expect(new THREE.Box3().setFromObject(result.root.children[0]).min.y).toBeCloseTo(3.1, 5);
    result.dispose();
  });

  it('replaces only modeled source IDs and bridges RH2000 once without moving horizontal coordinates', async () => {
    const f = fixture(), result = await loadVisbyFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds]).toEqual(['way/530655631', 'way/530655632']);
    expect([...result.replacedLandmarkIds]).toEqual(['skansudde-lighthouse']);
    expect(result.replacedBuildingIds.has('unrelated')).toBe(false);
    expect(f.scene.children).toEqual([f.root]);
    expect(f.root.children[0].position.toArray()).toEqual([0, -.1, 0]);
    const bounds = new THREE.Box3().setFromObject(f.root.children[0]);
    expect(bounds.min.x).toBe(-523); expect(bounds.min.z).toBe(204);
    expect(bounds.min.y).toBeCloseTo(3.1, 5);
    expect(f.fetchImpl.mock.calls[1][0]).toBe('https://example.test/olovs-hemsida/models/visby/facilities-v1.glb');
    result.dispose();
    expect(f.scene.children).toEqual([]);
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(result.replacedLandmarkIds.size).toBe(0);
  });

  it('anchors rigid buildings to visible terrain when v2 terrain is unavailable', async () => {
    const f = fixture();
    const result = await loadVisbyFacilities({ ...f.context, v2Active: false, terrainH: () => 4.4 });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities.every(p => p.mode === 'terrain-anchor' && p.groundResidualMetres === 0)).toBe(true);
    expect(new THREE.Box3().setFromObject(f.root.children[0]).min.y).toBeCloseTo(4.4, 5);
    result.dispose();
  });

  it('keeps the old lighthouse only when no authored lighthouse was successfully installed', () => {
    const quad = vi.fn(), tri = vi.fn(), stats = { draws: 0 };
    const context = { quad, tri, stats, demH: () => 3.2, L: color => color };
    build(context); expect(quad).toHaveBeenCalled();
    quad.mockClear(); tri.mockClear();
    stats.facilities = { status: 'loaded', replacedLandmarkIds: ['skansudde-lighthouse'] };
    expect(build(context)).toBe(0); expect(quad).not.toHaveBeenCalled(); expect(tri).not.toHaveBeenCalled();
    stats.facilities.status = 'fallback';
    build(context); expect(quad).toHaveBeenCalled();
  });

  it('keeps all fallbacks and disposes geometry if any source node is missing', async () => {
    const f = fixture(); f.root.children[2].name = 'wrong-tower';
    const disposals = f.geometries.map(g => vi.spyOn(g, 'dispose'));
    const result = await loadVisbyFacilities(f.context);
    expect(result.report.status).toBe('fallback');
    expect(result.report.replacedBuildingIds).toEqual([]); expect(result.report.replacedLandmarkIds).toEqual([]);
    expect(result.report.facilities).toEqual([]); expect(f.scene.children).toEqual([]);
    expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('rejects foreign frames, missing clubhouse coverage, and duplicate source ownership', () => {
    const f = fixture();
    expect(() => validateVisbyFacilitiesManifest(f.manifest, { ...f.context, courseSlug: 'upsala' })).toThrow('another course');
    const frame = structuredClone(f.manifest); frame.coordinateFrame.originEpsg3006.easting += 1;
    expect(() => validateVisbyFacilitiesManifest(frame, f.context)).toThrow('frame');
    const incomplete = structuredClone(f.manifest); incomplete.facilities.shift();
    expect(() => validateVisbyFacilitiesManifest(incomplete, f.context)).toThrow('clubhouse');
    const duplicate = structuredClone(f.manifest); duplicate.facilities[1].sourceBuildingId = 'way/530655631';
    expect(() => validateVisbyFacilitiesManifest(duplicate, f.context)).toThrow('source');
  });

  it('checks integrity and refuses external reference media before parsing', async () => {
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    expect((await loadVisbyFacilities(bad.context)).report.reason).toContain('checksum');
    expect(bad.parseGlb).not.toHaveBeenCalled();
    const external = fixture({ asset: { version: '2.0' }, images: [{ uri: 'reference-photo.jpg' }] });
    expect((await loadVisbyFacilities(external.context)).report.status).toBe('fallback');
    expect(external.parseGlb).not.toHaveBeenCalled();
    const foreign = fixture(); foreign.manifest.asset.url = 'models/johannesberg/facilities-v1.glb';
    expect((await loadVisbyFacilities(foreign.context)).report.reason).toContain('course directory');
  });

  it('rejects misaligned geometry, nonfinite vertices, and source metadata mismatches', async () => {
    const moved = fixture(); moved.root.children[0].position.x = 500;
    expect((await loadVisbyFacilities(moved.context)).report.reason).toContain('bounds');
    const nan = fixture(); nan.geometries[0].attributes.position.setX(0, NaN);
    expect((await loadVisbyFacilities(nan.context)).report.reason).toContain('Non-finite');
    const source = fixture(); source.root.children[1].userData.sourceBuildingId = 'unrelated';
    expect((await loadVisbyFacilities(source.context)).report.reason).toContain('source node');
  });

  it('disposes late geometry after navigation and refuses nonfinite terrain', async () => {
    const f = fixture(), controller = new AbortController();
    const releases = f.materials.map(material => vi.spyOn(material, 'dispose'));
    f.parseGlb.mockImplementation(async () => { controller.abort(); return { scene: f.root }; });
    const result = await loadVisbyFacilities({ ...f.context, signal: controller.signal });
    expect(result.report.status).toBe('fallback'); expect(f.scene.children).toEqual([]);
    result.dispose(); expect(releases.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(() => visbyFacilityVerticalPlacement(f.facilities[0], { ...f.context, terrainH: () => NaN })).toThrow('ground');
  });
});
