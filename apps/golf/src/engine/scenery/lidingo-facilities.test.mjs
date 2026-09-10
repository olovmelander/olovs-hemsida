import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadArchitectureFixture } from '../../../../../lidingobuild/architecture-fixture.mjs';
import { loadLidingoFacilities, lidingoFacilityVerticalPlacement, validateLidingoFacilitiesManifest,
  LIDINGO_PRIMARY_BUILDING_IDS } from './lidingo-facilities.mjs';
import * as scenery from './lidingo.js';

const ringAt = (x, z) => [[x-5,z-5],[x+5,z-5],[x+5,z+5],[x-5,z+5]];
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
function glb(document, binary = null) {
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length/4)*4, 32);
  raw.copy(json);
  const bytes = Buffer.alloc(20 + json.length + (binary ? 8 + binary.length : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  if (binary) {
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
    binary.copy(bytes, 28 + json.length);
  }
  return bytes;
}
const receipt = bytes => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { url: `models/lidingo/facilities-${sha256}.glb`, bytes: bytes.length, sha256 };
};

function fixture(document = { asset: { version: '2.0' } }) {
  const bytes = glb(document), scene = new THREE.Scene(), root = new THREE.Group();
  const anchors = [[-35,-110],[-45,-60],[-55,-30],[-65,130],[-15,115],[-44,-90],[-100,5]];
  const ids = [...LIDINGO_PRIMARY_BUILDING_IDS, 'courtyard', 'range-pad'];
  const facilities = ids.map((id, i) => {
    const [x, z] = anchors[i];
    return { id, nodeName: `Lidingo ${id}`, sourceBuildingIds: i < 5 ? [id] : [],
      footprintLocal: ringAt(x, z), groundAnchorLocal: [x, z], groundAnchorRh2000M: 30,
      placement: 'absolute-rh2000', boundsLocalRh2000: { min: [x-2,30,z-2], max: [x+2,36,z+2] },
      excludeVegetation: id !== 'range-pad', evidence: { geometry: 'retained source footprint', appearance: 'photo-informed display' } };
  });
  const buildings = facilities.flatMap(f => f.sourceBuildingIds.map(id => ({ id, ring: f.footprintLocal })));
  buildings.push({ id: 'unrelated-building', ring: ringAt(700,700) });
  const sharedMaterial = new THREE.MeshStandardMaterial(), geometries = [];
  for (const f of facilities) {
    const [x,z] = f.groundAnchorLocal, geometry = new THREE.BoxGeometry(4,6,4).translate(x,33,z);
    const node = new THREE.Group(); node.name = f.nodeName;
    node.userData = { facilityId: f.id, sourceBuildingIds: [...f.sourceBuildingIds] };
    node.add(new THREE.Mesh(geometry, sharedMaterial)); root.add(node); geometries.push(geometry);
  }
  const manifest = { schemaVersion: 1, groundId: 'lidingo', courseSlugs: ['lidingo'],
    coordinateFrame: { kind: 'epsg3006-local-rh2000', originEasting: 677700.5, originNorthing: 6586399.5,
      axes: 'east-up-south', heightDatum: 'RH2000' },
    asset: receipt(bytes), facilities, replacesRangeFacilities: true, replacesCourtyard: true };
  const fetchImpl = vi.fn(async url => url.endsWith('.json') ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => arrayBuffer(bytes) });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'lidingo', buildings, terrainH: () => 30,
    v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/golf/', fetchImpl, parseGlb };
  return { bytes, scene, root, facilities, buildings, geometries, sharedMaterial, manifest, fetchImpl, parseGlb, context };
}

describe('Lidingö Blender facilities installation', () => {
  it('publishes replacement IDs and exclusions only after the complete asset is installed', async () => {
    const f = fixture(), original = structuredClone(f.buildings), existing = new THREE.Group(); f.scene.add(existing);
    const result = await loadLidingoFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds]).toEqual(LIDINGO_PRIMARY_BUILDING_IDS);
    expect(f.scene.children).toEqual([existing, f.root]); expect(f.buildings).toEqual(original);
    expect(result.report.replacesRangeFacilities).toBe(true); expect(result.report.replacesCourtyard).toBe(true);
    expect(result.report.triangles).toBe(84); expect(result.facilityFootprints).toHaveLength(6);
    expect(result.isFacilityInterior(-35,-110)).toBe(true);
    expect(result.isFacilityInterior(-29.7,-110)).toBe(false);
    expect(result.isFacilityInterior(-29.7,-110,.4)).toBe(true);
    expect(result.isFacilityInterior(-100,5)).toBe(false);
    expect(f.fetchImpl.mock.calls.map(c => c[0])).toEqual([
      'https://example.test/golf/models/lidingo/facilities-v1.json', `https://example.test/golf/${f.manifest.asset.url}`]);
    result.dispose(); expect(result.root).toBeNull(); expect(f.scene.children).toEqual([existing]);
    expect(result.replacedBuildingIds.size).toBe(0); expect(result.facilityFootprints).toEqual([]);
    expect(result.report.replacesCourtyard).toBe(false); expect(result.isFacilityInterior(-35,-110)).toBe(false);
  });

  it('preserves absolute RH2000 and applies the runtime bridge once without another 25 metre shift', async () => {
    const f = fixture(), result = await loadLidingoFacilities({ ...f.context, verticalDatumOffsetMetres: .05, terrainH: () => 30.05 });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities.every(p => p.shift === .05 && p.mode === 'absolute-rh2000')).toBe(true);
    expect(new THREE.Box3().setFromObject(result.root).min.y).toBeCloseTo(30.05, 8);
    expect(result.report.facilities.every(p => Math.abs(p.groundResidualMetres) < 1e-8)).toBe(true);
    result.dispose();
    const legacy = fixture(), fallback = await loadLidingoFacilities({ ...legacy.context, v2Active: false,
      verticalDatumOffsetMetres: NaN, terrainH: () => 34 });
    expect(fallback.report.status, fallback.report.reason).toBe('loaded');
    expect(fallback.report.facilities.every(p => p.shift === 4 && p.mode === 'terrain-anchor')).toBe(true);
    fallback.dispose();
    expect(() => lidingoFacilityVerticalPlacement(f.facilities[0], { v2Active: true, terrainH: () => NaN })).toThrow('ground');
  });

  it('parses embedded GLB geometry through the actual GLTFLoader', async () => {
    const f = fixture(), positions = new Float32Array(f.facilities.length*9);
    const nodes = [], meshes = [], accessors = [], bufferViews = [];
    for (const [i, facility] of f.facilities.entries()) {
      const [x,z] = facility.groundAnchorLocal;
      positions.set([x-2,30,z-2,x+2,30,z+2,x,36,z], i*9);
      bufferViews.push({ buffer: 0, byteOffset: i*36, byteLength: 36 });
      accessors.push({ bufferView: i, componentType: 5126, count: 3, type: 'VEC3', ...facility.boundsLocalRh2000 });
      meshes.push({ primitives: [{ attributes: { POSITION: i } }] });
      nodes.push({ name: facility.nodeName, mesh: i, extras: f.root.children[i].userData });
    }
    const bytes = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_,i) => i) }],
      nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: positions.byteLength }] }, Buffer.from(positions.buffer));
    f.manifest.asset = receipt(bytes);
    const result = await loadLidingoFacilities({ ...f.context, parseGlb: undefined,
      fetchImpl: async url => url.endsWith('.json') ? { ok: true, json: async () => f.manifest }
        : { ok: true, arrayBuffer: async () => arrayBuffer(bytes) } });
    expect(result.report.status, result.report.reason).toBe('loaded'); expect(result.report.triangles).toBe(7);
    expect(result.root.children[0].userData.sourceBuildingIds).toEqual([LIDINGO_PRIMARY_BUILDING_IDS[0]]);
    result.dispose();
  });

  it('accepts real flat parking paint while refusing collapsed triangles', async () => {
    const flat = fixture(), facility = flat.facilities[6], [x,z] = facility.groundAnchorLocal;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([x-2,30,z-2,x+2,30,z-2,x+2,30,z+2,x-2,30,z+2],3));
    geometry.setIndex([0,1,2,0,2,3]);
    flat.root.children[6].children[0].geometry = geometry;
    flat.geometries[6].dispose();
    facility.boundsLocalRh2000.max[1] = 30;
    const result = await loadLidingoFacilities(flat.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities[6].triangles).toBe(2);
    expect(result.report.facilities[6].boundsBeforePlacement.min[1]).toBe(30);
    expect(result.report.facilities[6].boundsBeforePlacement.max[1]).toBe(30);
    result.dispose();
    const collapsed = fixture();
    const index = collapsed.geometries[0].index; index.setX(1,index.getX(0));
    const failure = await loadLidingoFacilities(collapsed.context);
    expect(failure.report.status).toBe('fallback'); expect(failure.report.reason).toContain('Degenerate');
    expect(failure.replacedBuildingIds.size).toBe(0); expect(collapsed.scene.children).toEqual([]);
  });

  it('keeps all fallback geometry when the courtyard is missing and disposes shared resources once', async () => {
    const f = fixture(); f.root.children[5].name = 'missing courtyard';
    const geometryDisposals = f.geometries.map(g => vi.spyOn(g,'dispose')), materialDisposal = vi.spyOn(f.sharedMaterial,'dispose');
    const result = await loadLidingoFacilities(f.context);
    expect(result.report.status).toBe('fallback'); expect(result.report.reason).toContain('node');
    expect(result.replacedBuildingIds.size).toBe(0); expect(result.facilityFootprints).toEqual([]);
    expect(result.report.replacesCourtyard).toBe(false); expect(result.report.replacesRangeFacilities).toBe(false);
    expect(f.scene.children).toEqual([]); result.dispose();
    expect(materialDisposal).toHaveBeenCalledTimes(1);
    expect(geometryDisposals.every(s => s.mock.calls.length === 1)).toBe(true);
  });

  it('cancels a parsed asset before attaching it and releases its geometry', async () => {
    const f = fixture(), controller = new AbortController(); let release;
    const parseGlb = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const dispose = vi.spyOn(f.sharedMaterial, 'dispose');
    const pending = loadLidingoFacilities({ ...f.context, signal: controller.signal, parseGlb });
    await vi.waitFor(() => expect(parseGlb).toHaveBeenCalledOnce());
    controller.abort(); release({ scene: f.root });
    const result = await pending;
    expect(result.report.status).toBe('fallback'); expect(result.report.reason).toContain('cancelled');
    expect(f.scene.children).toEqual([]); expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects stale frame, partial source inventory, missing courtyard and displaced source ownership', () => {
    const f = fixture();
    expect(() => validateLidingoFacilitiesManifest(f.manifest, { ...f.context, courseSlug: 'visby' })).toThrow('another course');
    for (const [mutate, message] of [
      [m => { m.coordinateFrame.originNorthing += 1; }, 'frame'],
      [m => { m.facilities[0].sourceBuildingIds = []; }, 'five primary'],
      [m => { m.facilities = m.facilities.filter(f => f.id !== 'courtyard'); }, 'courtyard'],
      [m => { m.replacesCourtyard = false; }, 'courtyard'],
      [m => { m.facilities[6].sourceBuildingIds = [LIDINGO_PRIMARY_BUILDING_IDS[0]]; }, 'duplicate replacement'],
      [m => { m.facilities[6].sourceBuildingIds = ['not-in-model']; }, 'replacement source'],
      [m => { m.facilities[6].sourceBuildingIds = ['unrelated-building']; }, 'source footprint'],
      [m => { m.facilities[0].placement = 'terrain-anchor'; }, 'absolute RH2000'],
    ]) {
      const manifest = structuredClone(f.manifest); mutate(manifest);
      expect(() => validateLidingoFacilitiesManifest(manifest, f.context)).toThrow(message);
    }
  });

  it('refuses corrupt, external, photographic and non-finite assets without changing the scene', async () => {
    const corrupt = fixture(); corrupt.manifest.asset.sha256 = '0'.repeat(64);
    corrupt.manifest.asset.url = `models/lidingo/facilities-${corrupt.manifest.asset.sha256}.glb`;
    expect((await loadLidingoFacilities(corrupt.context)).report.reason).toContain('checksum');
    expect(corrupt.parseGlb).not.toHaveBeenCalled();
    const foreign = fixture(); foreign.manifest.asset.url = 'https://other.test/model.glb';
    expect((await loadLidingoFacilities(foreign.context)).report.reason).toContain('asset receipt');
    for (const extension of [{ images: [{ uri: 'private-photo.jpg' }] }, { buffers: [{ uri: 'external.bin' }] },
      { cameras: [{}] }, { extensions: { KHR_lights_punctual: { lights: [{}] } } }]) {
      const f = fixture({ asset: { version: '2.0' }, ...extension });
      expect((await loadLidingoFacilities(f.context)).report.reason).toContain('procedural');
      expect(f.parseGlb).not.toHaveBeenCalled(); expect(f.scene.children).toEqual([]);
    }
    const invalid = fixture(); invalid.geometries[0].getAttribute('position').setX(0, NaN);
    expect((await loadLidingoFacilities(invalid.context)).report.reason).toContain('Non-finite');
    expect(invalid.scene.children).toEqual([]);
    const wrongBounds = fixture(); wrongBounds.manifest.facilities[0].boundsLocalRh2000.max[1] += 1;
    expect((await loadLidingoFacilities(wrongBounds.context)).report.reason).toContain('bounds do not match');
  });

  it('switches fallback decorations atomically and prevents stale concurrent loads replacing the latest course', async () => {
    const first = fixture(), second = fixture(); let release;
    const parseGlb = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const stale = scenery.loadFacilities({ ...first.context, parseGlb });
    await vi.waitFor(() => expect(parseGlb).toHaveBeenCalledOnce());
    const current = await scenery.loadFacilities(second.context);
    release({ scene: first.root }); const obsolete = await stale;
    expect(obsolete.report.status).not.toBe('loaded'); expect(first.scene.children).toEqual([]);
    expect(scenery.replacesRangeFacilities).toBe(true); expect(scenery.architectureStatus().replacesCourtyard).toBe(true);
    const { model, terrainH } = loadArchitectureFixture(), emit = vi.fn();
    const courtyard = { features: model.scenery.mappedFeatures, buildings: model.infra.buildings, terrainH, tri: emit, L: c => c };
    expect(scenery.renderCourtyard(courtyard)).toBeNull(); expect(emit).not.toHaveBeenCalled();
    current.dispose();
    expect(scenery.replacesRangeFacilities).toBe(false); expect(scenery.isFacilityInterior(-35,-110)).toBe(false);
    expect(scenery.renderCourtyard(courtyard).triangles).toBeGreaterThan(0);
    const failed = fixture(); failed.manifest.asset.sha256 = '0'.repeat(64);
    const fallback = await scenery.loadFacilities(failed.context);
    expect(fallback.report.status).toBe('fallback'); expect(scenery.replacesRangeFacilities).toBe(false);
    expect(scenery.renderCourtyard(courtyard).triangles).toBeGreaterThan(0);
    fallback.dispose();
  });

  it('uses the shared early-load and source-inspection gates without changing retained source surfaces', () => {
    const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
    expect(scenery.loadFacilitiesBeforeSurfaces).toBe(true);
    expect(main).toContain("get('buildingGeometry') !== 'source'");
    expect(main).toContain('!SCENERY?.loadFacilities || !authoredFacilityView');
    expect(main.indexOf('if (SCENERY?.loadFacilitiesBeforeSurfaces)')).toBeLessThan(main.indexOf('const legacySurfaceOverlays'));
    expect(main).toContain('facilityArchitecture?.replacedBuildingIds?.has(b.id)');
    expect(main).toContain('SCENERY?.replacesRangeFacilities && facilityArchitecture?.report.status');
  });
});
