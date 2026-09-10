import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readPack, inflateStream } from '../../../../../packages/course-pack/lib.mjs';
import { ANGSO_FACILITY_REPLACEMENTS, ANGSO_FACILITY_SOURCE_IDS, angsoFacilityVerticalPlacement,
  loadAngsoFacilities, validateAngsoFacilitiesManifest } from './angso-facilities.mjs';
import { isFacilityInterior, isFacilityGroundInterior, isFacilityTreeObstruction,
  loadFacilities, loadFacilitiesBeforeSurfaces, replacesRangeFacilities } from './angso.js';

function glb(document, binary = null) {
  const raw = JSON.stringify(document), json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4));
  const bytes = Buffer.alloc(20 + json.length + (binary ? 8 + binary.length : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  if (binary) {
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
    binary.copy(bytes, 28 + json.length);
  }
  return { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    receipt: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}

function fixture(document = { asset: { version: '2.0' } }) {
  const asset = glb(document), scene = new THREE.Scene(), root = new THREE.Group();
  const materials = [], geometries = [], buildings = [];
  const facilities = [...Object.keys(ANGSO_FACILITY_REPLACEMENTS), 'B12', 'S01'].map((id, index) => {
    const x = -180 + index * 10, z = 290;
    const ring = [[x - 3, z - 3], [x + 3, z - 3], [x + 3, z + 3], [x - 3, z + 3]];
    const source = ANGSO_FACILITY_REPLACEMENTS[id], sourceBuildingIds = source ? [source] : [];
    if (source) buildings.push({ id: source, ring: structuredClone(ring) });
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 10, z), material = new THREE.MeshStandardMaterial();
    geometries.push(geometry); materials.push(material);
    const node = new THREE.Group();
    node.name = id; node.userData = { facilityId: id, sourceBuildingIds: [...sourceBuildingIds] };
    node.add(new THREE.Mesh(geometry, material)); root.add(node);
    return { id, nodeName: id, kind: id === 'S01' ? 'surface' : id === 'B12' ? 'shelter' : 'building',
      sourceBuildingIds, groundAnchorLocal: [x, z], groundAnchorRh2000M: 7, placement: 'absolute-rh2000',
      footprintLocal: ring, vegetationExclusion: id !== 'S01',
      groundSurfaceRingsLocal: id === 'S01' ? [structuredClone(ring)] : [] };
  });
  const parking = [{ id: 'trace-parking-main', ring: structuredClone(facilities.at(-1).footprintLocal) },
    { id: 'trace-caravans', ring: [[-200, 197], [-149, 197], [-149, 264], [-200, 264]] }];
  facilities.at(-1).sourceParkingIndices = [0];
  facilities.at(-1).sourceParkingRingsLocal = [{ index: 0, ring: structuredClone(parking[0].ring) }];
  const manifest = { schemaVersion: 1, groundId: 'angso', courseSlugs: ['angso'],
    coordinateFrame: { kind: 'legacy-local-rh2000', originWgs84: { lat: 59.5739, lon: 16.871 },
      mPerLat: 111320, mPerLon: 56375.41 },
    asset: { url: 'models/angso/facilities-v1.glb', ...asset.receipt }, facilities };
  const fetchImpl = vi.fn(async url => url.endsWith('.json')
    ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => asset.buffer });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'angso', buildings, parking, terrainH: () => 7.4,
    v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/golf/', fetchImpl, parseGlb };
  return { asset, manifest, context, root, scene, materials, geometries, fetchImpl, parseGlb };
}

describe('Ängsö authored facility installation', () => {
  it('loads the published Blender asset against the actual course pack and its complete reviewed facility inventory', async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../../public/models/angso/facilities-v1.json', import.meta.url)));
    const packed = readPack(fs.readFileSync(new URL('../../../public/courses/angso/pack.bin', import.meta.url)));
    const model = JSON.parse(inflateStream(packed.sv));
    const bytes = fs.readFileSync(new URL('../../../public/' + manifest.asset.url, import.meta.url));
    const scene = new THREE.Scene();
    const result = await loadAngsoFacilities({ THREE, scene, courseSlug: packed.header.slug,
      buildings: model.infra.buildings, parking: model.infra.parking, v2Active: true, verticalDatumOffsetMetres: 0,
      terrainH: (x, z) => manifest.facilities.reduce((nearest, facility) =>
        Math.hypot(x - facility.groundAnchorLocal[0], z - facility.groundAnchorLocal[1])
          < Math.hypot(x - nearest.groundAnchorLocal[0], z - nearest.groundAnchorLocal[1]) ? facility : nearest)
        .groundAnchorRh2000M,
      baseUrl: 'https://example.test/golf/', fetchImpl: async url => url.endsWith('.json')
        ? { ok: true, json: async () => manifest }
        : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.assetSha256).toBe(manifest.asset.sha256);
    expect(result.root.parent).toBe(scene);
    expect(result.report.facilities.map(facility => facility.id)).toEqual(expect.arrayContaining([
      'B01', 'B03', 'B04', 'B04a', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13',
      'S01', 'S02', 'S04', 'S05', 'S06', 'S07',
    ]));
    expect(result.report.facilities.map(facility => facility.id)).not.toContain('B02'); // reviewed roof shadow, no physical canopy
    expect([...result.replacedBuildingIds].sort()).toEqual([...ANGSO_FACILITY_SOURCE_IDS].sort());
    expect([...result.replacedParkingIndices].sort()).toEqual([2, 3]);
    expect(result.facilityFootprints.every(facility => facility.id.startsWith('B'))).toBe(true);
    expect(result.groundSurfaceFootprints.some(facility => facility.id.startsWith('S04-ground-'))).toBe(true);
    result.dispose();
    expect(scene.children).toEqual([]);
  });

  it('replaces exactly the six source buildings and identified parking, retaining absolute RH2000 architecture', async () => {
    const f = fixture(), result = await loadAngsoFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.root.parent).toBe(f.scene);
    expect([...result.replacedBuildingIds]).toEqual(ANGSO_FACILITY_SOURCE_IDS);
    expect([...result.replacedParkingIndices]).toEqual([0]);
    expect(result.replacedParkingIndices.has(1)).toBe(false);
    expect(result.report.facilities).toHaveLength(8);
    expect(result.report.triangles).toBe(96);
    expect(result.facilityFootprints.map(facility => facility.id)).toContain('B12');
    expect(result.facilityFootprints.map(facility => facility.id)).not.toContain('S01');
    for (const facility of result.report.facilities) {
      expect(facility.shift).toBe(0);
      expect(facility.mode).toBe('absolute-rh2000');
      expect(facility.groundResidualMetres).toBeCloseTo(-.4);
      const bounds = new THREE.Box3().setFromObject(result.root.getObjectByName(facility.nodeName));
      expect(bounds.min.toArray()).toEqual(facility.boundsBeforePlacement.min);
      expect(bounds.max.toArray()).toEqual(facility.boundsBeforePlacement.max);
    }
    expect(f.fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://example.test/golf/models/angso/facilities-v1.json', 'https://example.test/golf/models/angso/facilities-v1.glb',
    ]);
    result.dispose();
  });

  it('loads an embedded GLB with real GLTFLoader, preserving source extras and procedural materials', async () => {
    const f = fixture(), values = new Float32Array(f.manifest.facilities.length * 18);
    const nodes = [], meshes = [], accessors = [], bufferViews = [];
    f.manifest.facilities.forEach((facility, index) => {
      const [x, z] = facility.groundAnchorLocal;
      values.set([x - 2, 7, z - 2, x + 2, 7, z + 2, x, 13, z, 0, 1, 0, 0, 1, 0, 0, 1, 0], index * 18);
      bufferViews.push({ buffer: 0, byteOffset: index * 72, byteLength: 36 },
        { buffer: 0, byteOffset: index * 72 + 36, byteLength: 36 });
      accessors.push({ bufferView: index * 2, componentType: 5126, count: 3, type: 'VEC3',
        min: [x - 2, 7, z - 2], max: [x + 2, 13, z + 2] },
      { bufferView: index * 2 + 1, componentType: 5126, count: 3, type: 'VEC3' });
      meshes.push({ primitives: [{ attributes: { POSITION: index * 2, NORMAL: index * 2 + 1 }, material: 0 }] });
      nodes.push({ name: facility.nodeName, mesh: index,
        extras: { facilityId: facility.id, sourceBuildingIds: facility.sourceBuildingIds } });
    });
    const asset = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }],
      nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: values.byteLength }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [.5, .1, .05, 1], metallicFactor: 0, roughnessFactor: .85 } }] },
    Buffer.from(values.buffer));
    Object.assign(f.manifest.asset, asset.receipt);
    const result = await loadAngsoFacilities({ ...f.context, parseGlb: undefined,
      fetchImpl: async url => url.endsWith('.json') ? { ok: true, json: async () => f.manifest }
        : { ok: true, arrayBuffer: async () => asset.buffer } });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.triangles).toBe(8);
    expect(result.root.children[0].material.isMeshStandardMaterial).toBe(true);
    expect(result.root.children[0].userData.sourceBuildingIds).toEqual(['w516709523']);
    result.dispose();
  });

  it('uses one rigid anchor shift on legacy terrain and rejects a foreign datum bridge', () => {
    const f = fixture(), facility = f.manifest.facilities[0];
    expect(angsoFacilityVerticalPlacement(facility, { ...f.context, v2Active: false }).shift).toBeCloseTo(.4);
    expect(() => angsoFacilityVerticalPlacement(facility, { ...f.context, verticalDatumOffsetMetres: 20.9924 })).toThrow('bridge');
    expect(() => angsoFacilityVerticalPlacement(facility, { ...f.context, terrainH: () => NaN })).toThrow('ground');
  });

  it('rejects incomplete source inventory, foreign courses, wrong frames and unrelated replacement IDs before parsing', async () => {
    const f = fixture();
    expect(() => validateAngsoFacilitiesManifest(f.manifest, { ...f.context, courseSlug: 'visby' })).toThrow('another course');
    const incomplete = structuredClone(f.manifest); incomplete.facilities.splice(0, 1);
    expect(() => validateAngsoFacilitiesManifest(incomplete, f.context)).toThrow('Incomplete');
    const wrongFrame = structuredClone(f.manifest); wrongFrame.coordinateFrame.mPerLon = 56118.16;
    expect(() => validateAngsoFacilitiesManifest(wrongFrame, f.context)).toThrow('frame');
    f.manifest.facilities[0].sourceBuildingIds = ['unrelated-building'];
    const result = await loadAngsoFacilities(f.context);
    expect(result.report.reason).toContain('identity');
    expect(f.parseGlb).not.toHaveBeenCalled();
    expect(f.scene.children).toHaveLength(0);
  });

  it('requires matching source parking rings and refuses to replace the retained motorhome lot', async () => {
    const changed = fixture(); changed.context.parking[0].ring[0][0] += 1;
    expect((await loadAngsoFacilities(changed.context)).report.reason).toContain('parking footprint');
    const motorhomes = fixture(); motorhomes.context.parking[0].id = 'trace-caravans';
    expect((await loadAngsoFacilities(motorhomes.context)).report.reason).toContain('parking footprint');
    const wrongOwner = fixture(), parking = wrongOwner.manifest.facilities.at(-1), range = wrongOwner.manifest.facilities.at(-2);
    range.sourceParkingIndices = parking.sourceParkingIndices;
    range.sourceParkingRingsLocal = parking.sourceParkingRingsLocal;
    delete parking.sourceParkingIndices; delete parking.sourceParkingRingsLocal;
    expect((await loadAngsoFacilities(wrongOwner.context)).report.reason).toContain('parking footprint');
  });

  it('checks the checksum, byte count and local asset location before parsing', async () => {
    for (const alter of [f => { f.manifest.asset.sha256 = '0'.repeat(64); },
      f => { f.manifest.asset.bytes++; }, f => { f.manifest.asset.url = 'https://other.test/facilities.glb'; },
      f => { f.manifest.asset.url = 'models/angso/../visby/facilities.glb'; }]) {
      const f = fixture(); alter(f);
      const result = await loadAngsoFacilities(f.context);
      expect(result.report.status).toBe('fallback');
      expect(f.parseGlb).not.toHaveBeenCalled();
      expect(result.replacedBuildingIds.size + result.replacedParkingIndices.size).toBe(0);
      expect(result.facilityFootprints).toEqual([]);
    }
  });

  it('refuses external buffers, image dependencies and animated assets', async () => {
    for (const addition of [{ buffers: [{ uri: 'https://other.test/geometry.bin' }] },
      { images: [{ bufferView: 0 }] }, { animations: [{}] }, { cameras: [{}] }]) {
      const f = fixture({ asset: { version: '2.0' }, ...addition });
      expect((await loadAngsoFacilities(f.context)).report.reason).toContain('static geometry');
      expect(f.parseGlb).not.toHaveBeenCalled();
    }
  });

  it('does not partially install a missing, duplicated or misidentified building node', async () => {
    for (const alter of [f => { f.root.children[3].name = 'missing'; },
      f => { f.root.children[3].userData.sourceBuildingIds = []; },
      f => { const duplicate = new THREE.Group(); duplicate.name = 'B01'; f.root.add(duplicate); }]) {
      const f = fixture(); alter(f);
      const released = f.geometries.map(geometry => vi.spyOn(geometry, 'dispose'));
      const result = await loadAngsoFacilities(f.context);
      expect(result.report.status).toBe('fallback');
      expect(result.replacedBuildingIds.size).toBe(0);
      expect(result.facilityFootprints).toEqual([]);
      expect(f.scene.children).toEqual([]);
      expect(released.every(spy => spy.mock.calls.length === 1)).toBe(true);
    }
  });

  it('rejects non-finite geometry and nodes translated outside their own footprint', async () => {
    for (const alter of [f => { f.geometries[2].attributes.position.setX(0, NaN); },
      f => { f.geometries[2].attributes.normal.setZ(0, Infinity); },
      f => { f.root.children[2].position.x = 200; }]) {
      const f = fixture(); alter(f);
      expect((await loadAngsoFacilities(f.context)).report.status).toBe('fallback');
      expect(f.scene.children).toHaveLength(0);
    }
  });

  it('disposes late geometry after navigation and does not attach stale loads', async () => {
    for (const bySignal of [true, false]) {
      const f = fixture(), controller = new AbortController();
      let current = true;
      const released = f.materials.map(material => vi.spyOn(material, 'dispose'));
      f.parseGlb.mockImplementation(async () => {
        if (bySignal) controller.abort(); else current = false;
        return { scene: f.root };
      });
      const result = await loadAngsoFacilities({ ...f.context, signal: controller.signal, isCurrentCourse: () => current });
      expect(result.report.reason).toContain('cancelled');
      expect(f.scene.children).toHaveLength(0);
      expect(result.replacedBuildingIds.size).toBe(0);
      result.dispose(); result.dispose();
      expect(released.every(spy => spy.mock.calls.length === 1)).toBe(true);
    }
  });

  it('does not request assets when navigation or cancellation already invalidates the course', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    expect((await loadAngsoFacilities({ ...f.context, signal: controller.signal })).report.status).toBe('fallback');
    expect((await loadAngsoFacilities({ ...f.context, isCurrentCourse: () => false })).report.status).toBe('fallback');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('activates vegetation exclusions through the scenery hook only after successful installation and clears them on disposal', async () => {
    const f = fixture(), [x, z] = f.manifest.facilities[0].groundAnchorLocal;
    expect(loadFacilitiesBeforeSurfaces && replacesRangeFacilities).toBe(true);
    expect(isFacilityInterior(x, z)).toBe(false);
    const result = await loadFacilities(f.context);
    expect(result.report.status).toBe('loaded');
    expect(isFacilityInterior(x, z)).toBe(true);
    expect(isFacilityInterior(...f.manifest.facilities.at(-1).groundAnchorLocal)).toBe(false);
    const released = vi.spyOn(f.geometries[0], 'dispose');
    result.dispose(); result.dispose();
    expect(isFacilityInterior(x, z)).toBe(false);
    expect(result.facilityFootprints).toEqual([]);
    expect(released).toHaveBeenCalledTimes(1);
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    await loadFacilities(bad.context);
    expect(isFacilityInterior(x, z)).toBe(false);
  });

  it('uses exact surface rings for clutter and trunk exclusion without treating the site export bounds as a clearing', async () => {
    const f = fixture(), site = f.manifest.facilities.at(-1), [x, z] = site.groundAnchorLocal;
    site.footprintLocal = [[x - 50, z - 50], [x + 50, z - 50], [x + 50, z + 50], [x - 50, z + 50]];
    const result = await loadFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(isFacilityGroundInterior(x, z)).toBe(true);
    expect(isFacilityGroundInterior(x + 3.05, z)).toBe(true);
    expect(isFacilityGroundInterior(x + 3.2, z)).toBe(false);
    expect(isFacilityGroundInterior(x + 30, z)).toBe(false);
    expect(isFacilityTreeObstruction({ x, y: 7, z, height: 12, radius: 1 }, 16)).toBe(true);
    result.dispose();
    expect(isFacilityGroundInterior(x, z)).toBe(false);
    expect(result.groundSurfaceFootprints).toEqual([]);
  });

  it('removes crowns that intersect roofs while allowing high branches to overhang from outside the footprint', async () => {
    const f = fixture(), [x, z] = f.manifest.facilities[0].groundAnchorLocal;
    const result = await loadFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    const tree = { x: x + 4, y: 7, z, height: 8, radius: 2 };
    expect(isFacilityInterior(tree.x, tree.z)).toBe(false);
    expect(isFacilityTreeObstruction(tree, 8)).toBe(true);
    expect(isFacilityTreeObstruction(tree, 14)).toBe(false);
    expect(isFacilityTreeObstruction({ ...tree, x: x - 12 }, 8)).toBe(false);
    result.dispose();
    expect(isFacilityTreeObstruction(tree, 8)).toBe(false);
  });
});
