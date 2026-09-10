import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { loadPuttomFacilities, puttomFacilityVerticalPlacement, validatePuttomFacilitiesManifest } from './puttom-facilities.mjs';
import * as scenery from './puttom.js';

const ringAt = (x, z) => [[x - 5, z - 5], [x + 5, z - 5], [x + 5, z + 5], [x - 5, z + 5]];
function glb(document, binary = null) {
  const raw = Buffer.from(JSON.stringify(document));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bytes = Buffer.alloc(20 + json.length + (binary ? 8 + binary.length : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  if (binary) {
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
    binary.copy(bytes, 28 + json.length);
  }
  return bytes;
}
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const receipt = bytes => ({ url: 'models/puttom/facilities-v1.glb', bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') });

function fixture(document = { asset: { version: '2.0' } }) {
  const bytes = glb(document), scene = new THREE.Scene(), root = new THREE.Group();
  const facilities = [
    { id: 'clubhouse', sourceBuildingIds: ['trace-clubhouse-main', 'trace-annex-a', 'trace-annex-b'], groundAnchorLocal: [-120, -200] },
    { id: 'range-house', sourceBuildingIds: ['trace-vinkelhus', 'trace-vinkelhus-arm'], groundAnchorLocal: [-70, -260] },
    { id: 'range-apron', sourceBuildingIds: [], groundAnchorLocal: [-60, -285], excludeVegetation: false },
  ].map(f => {
    const [x, z] = f.groundAnchorLocal;
    return { ...f, kind: f.sourceBuildingIds.length ? 'building' : 'site', nodeName: f.id,
      groundAnchorRh2000M: 40, placement: 'absolute-rh2000', footprintLocal: ringAt(x, z),
      boundsLocalRh2000: { min: [x - 2, 40, z - 2], max: [x + 2, 46, z + 2] },
      evidence: { geometry: 'reviewed-orthophoto', appearance: 'club-reference-photos' } };
  });
  const buildings = facilities.flatMap(f => f.sourceBuildingIds.map(id => ({ id, ring: ringAt(...f.groundAnchorLocal) })));
  buildings.push({ id: 'unrelated-building', ring: ringAt(1000, -700) });
  const geometries = [], materials = [];
  for (const facility of facilities) {
    const [x, z] = facility.groundAnchorLocal, node = new THREE.Group();
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 43, z), material = new THREE.MeshStandardMaterial();
    node.name = facility.nodeName;
    node.userData = { facilityId: facility.id, sourceBuildingIds: [...facility.sourceBuildingIds] };
    node.add(new THREE.Mesh(geometry, material)); root.add(node);
    geometries.push(geometry); materials.push(material);
  }
  const manifest = { schemaVersion: 1, groundId: 'puttom', courseSlugs: ['puttom'], replacesRangeFacilities: true,
    coordinateFrame: { kind: 'legacy-local-rh2000', originWgs84: { lat: 63.2992, lon: 18.9413 },
      mPerLat: 111320, mPerLon: 50019.58, axes: 'east-up-south', heightDatum: 'RH2000' },
    asset: receipt(bytes), facilities };
  const fetchImpl = vi.fn(async url => url.endsWith('.json') ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => arrayBuffer(bytes) });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'puttom', buildings, terrainH: () => 63.6263,
    v2Active: true, verticalDatumOffsetMetres: 23.6263, baseUrl: 'https://example.test/golf/', fetchImpl, parseGlb };
  return { bytes, scene, root, facilities, buildings, geometries, materials, manifest, fetchImpl, parseGlb, context };
}

describe('Puttom authored facilities', () => {
  it('installs merged source buildings and additional facilities atomically, keeping unrelated scenery', async () => {
    const f = fixture(), source = structuredClone(f.buildings), terrain = new THREE.Group(); f.scene.add(terrain);
    const result = await loadPuttomFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.replacedBuildingIds).toEqual(f.facilities.flatMap(b => b.sourceBuildingIds));
    expect(result.replacedBuildingIds.has('unrelated-building')).toBe(false);
    expect(result.report.replacesRangeFacilities).toBe(true);
    expect(f.scene.children).toEqual([terrain, f.root]); expect(f.buildings).toEqual(source);
    expect(result.report.triangles).toBe(36);
    expect(f.root.children[0].position.toArray()).toEqual([0, 23.6263, 0]);
    expect(new THREE.Box3().setFromObject(f.root.children[0]).min.toArray()).toEqual([-122, 63.6263, -202]);
    expect(result.report.facilities.every(b => b.groundResidualMetres === 0)).toBe(true);
    expect(f.fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://example.test/golf/models/puttom/facilities-v1.json',
      `https://example.test/golf/models/puttom/facilities-v1.glb?sha256=${f.manifest.asset.sha256}`]);
    expect(f.fetchImpl.mock.calls.every(([, options]) => options.cache === 'no-cache')).toBe(true);
    result.dispose(); expect(f.scene.children).toEqual([terrain]); expect(result.replacedBuildingIds.size).toBe(0);
  });

  it('uses real GLTFLoader parsing for embedded geometry and per-node source arrays', async () => {
    const f = fixture(), positions = new Float32Array(f.facilities.length * 9);
    const nodes = [], meshes = [], accessors = [], bufferViews = [];
    for (const [i, facility] of f.facilities.entries()) {
      const [x, z] = facility.groundAnchorLocal;
      positions.set([x - 2, 40, z - 2, x + 2, 40, z + 2, x, 46, z], i * 9);
      bufferViews.push({ buffer: 0, byteOffset: i * 36, byteLength: 36 });
      accessors.push({ bufferView: i, componentType: 5126, count: 3, type: 'VEC3', ...facility.boundsLocalRh2000 });
      meshes.push({ primitives: [{ attributes: { POSITION: i } }] });
      nodes.push({ name: facility.nodeName, mesh: i, extras: f.root.children[i].userData });
    }
    const payloads = [Buffer.from(positions.buffer)];
    let byteOffset = positions.byteLength;
    for (const [name, data, type] of [
      ['_GROUND_ANCHOR', [-60, 39, -285, -60, 39, -285, -60, 39, -285], 'VEC3'],
      ['_GROUND_MODE', [1, 1, 1], 'SCALAR'], ['_GROUND_CLEARANCE', [0, 0, 0], 'SCALAR'],
    ]) {
      const floats = new Float32Array(data), view = bufferViews.length;
      bufferViews.push({ buffer: 0, byteOffset, byteLength: floats.byteLength });
      meshes[2].primitives[0].attributes[name] = accessors.length;
      accessors.push({ bufferView: view, componentType: 5126, count: 3, type });
      payloads.push(Buffer.from(floats.buffer)); byteOffset += floats.byteLength;
    }
    const bytes = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: byteOffset }] }, Buffer.concat(payloads));
    f.manifest.asset = receipt(bytes);
    const result = await loadPuttomFacilities({ ...f.context, parseGlb: undefined,
      fetchImpl: async url => url.endsWith('.json') ? { ok: true, json: async () => f.manifest }
        : { ok: true, arrayBuffer: async () => arrayBuffer(bytes) } });
    expect(result.report.status, result.report.reason).toBe('loaded'); expect(result.report.triangles).toBe(3);
    expect(result.root.children[0].userData.sourceBuildingIds).toHaveLength(3);
    expect(result.report.facilities[2].groundContact.rigidVertices).toBe(3);
    expect(new THREE.Box3().setFromObject(result.root.children[2]).min.y).toBeCloseTo(64.6263, 5);
    result.dispose();
  });

  it('anchors each rigid building to visible fallback terrain without needing a v2 datum', async () => {
    const f = fixture();
    const result = await loadPuttomFacilities({ ...f.context, v2Active: false, verticalDatumOffsetMetres: NaN, terrainH: () => 65 });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities.every(p => p.mode === 'terrain-anchor' && p.shift === 25 && p.groundResidualMetres === 0)).toBe(true);
    expect(new THREE.Box3().setFromObject(f.root.children[1]).min.y).toBe(65);
    result.dispose();
  });

  it('publishes corrected footprint exclusions only after success and clears them on disposal', async () => {
    const f = fixture(), result = await loadPuttomFacilities(f.context);
    expect(result.facilityFootprints).toHaveLength(2);
    expect(result.isFacilityInterior(-120, -200)).toBe(true);
    expect(result.isFacilityInterior(-114.7, -200)).toBe(false);
    expect(result.isFacilityInterior(-114.7, -200, .4)).toBe(true);
    expect(result.isFacilityInterior(-60, -285)).toBe(false);
    result.dispose(); expect(result.facilityFootprints).toEqual([]); expect(result.isFacilityInterior(-120, -200)).toBe(false);
  });

  it('keeps authored net and apron shadow exclusions while buildings receive and cast shadows', async () => {
    const f = fixture();
    const net = f.root.children[2].children[0];
    net.userData.castShadow = false; net.userData.receiveShadow = false;
    const result = await loadPuttomFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(net.castShadow).toBe(false); expect(net.receiveShadow).toBe(false);
    expect(f.root.children[0].children[0].castShadow).toBe(true);
    expect(f.root.children[0].children[0].receiveShadow).toBe(true);
    result.dispose();
  });

  it('grounds a rigid site item at its own anchor while preserving its dimensions and RH2000 buildings', async () => {
    const f = fixture(), geometry = f.geometries[2], count = geometry.attributes.position.count;
    geometry.setAttribute('_ground_anchor', new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [-61, 40, -285]).flat(), 3));
    geometry.setAttribute('_ground_mode', new THREE.Float32BufferAttribute(Array(count).fill(1), 1));
    geometry.setAttribute('_ground_clearance', new THREE.Float32BufferAttribute(Array(count).fill(0), 1));
    const terrainH = x => x === -61 ? 64.4263 : 63.6263;
    const result = await loadPuttomFacilities({ ...f.context, terrainH });
    expect(result.report.status, result.report.reason).toBe('loaded');
    const bounds = new THREE.Box3().setFromObject(f.root.children[2]);
    expect(bounds.min.x).toBe(-62); expect(bounds.max.z).toBe(-283);
    expect(bounds.min.y).toBeCloseTo(64.4263, 4); expect(bounds.max.y - bounds.min.y).toBeCloseTo(6, 4);
    expect(new THREE.Box3().setFromObject(f.root.children[0]).min.y).toBe(63.6263);
    expect(result.report.facilities[2].groundContact.rigidVertices).toBe(count);
    expect(result.report.facilities[2].groundContact.maximumAdjustmentMetres).toBeCloseTo(.8, 5);
    result.dispose();
  });

  it('drapes only marked paving vertices above visible terrain and recomputes their normals', async () => {
    const f = fixture(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-62, 40, -287, -58, 40, -283, -60, 40.2, -283], 3));
    geometry.setAttribute('_ground_anchor', new THREE.Float32BufferAttribute([-60, 40, -285, -60, 40, -285, -60, 40, -285], 3));
    geometry.setAttribute('_ground_mode', new THREE.Float32BufferAttribute([2, 2, 2], 1));
    geometry.setAttribute('_ground_clearance', new THREE.Float32BufferAttribute([.055, .067, .055], 1));
    geometry.computeVertexNormals();
    f.root.children[2].children[0].geometry = geometry;
    f.facilities[2].boundsLocalRh2000 = { min: [-62, 40, -287], max: [-58, 40.2, -283] };
    const terrainH = (x, z) => 63.6263 + .05 * (x + 60) + .01 * (z + 285);
    const result = await loadPuttomFacilities({ ...f.context, terrainH });
    expect(result.report.status, result.report.reason).toBe('loaded');
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i) + f.root.children[2].position.y)
        .toBeCloseTo(terrainH(positions.getX(i), positions.getZ(i)) + [.055, .067, .055][i], 4);
    }
    expect(Array.from(positions.array).filter((_, i) => i % 3 !== 1)).toEqual([-62, -287, -58, -283, -60, -283]);
    expect(Math.abs(geometry.attributes.normal.getY(0))).toBeGreaterThan(.9);
    expect(result.report.facilities[2].groundContact.drapedVertices).toBe(3);
    expect(geometry.boundingSphere).not.toBeNull();
    result.dispose();
  });

  it('refuses malformed site grounding and any attempt to deform a building', async () => {
    const building = fixture(), geometry = building.geometries[0], count = geometry.attributes.position.count;
    geometry.setAttribute('_ground_mode', new THREE.Float32BufferAttribute(Array(count).fill(1), 1));
    expect((await loadPuttomFacilities(building.context)).report.reason).toContain('limited to site');
    const invalid = fixture(), g = invalid.geometries[2], n = g.attributes.position.count;
    g.setAttribute('_ground_anchor', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [-60, 40, -285]).flat(), 3));
    g.setAttribute('_ground_mode', new THREE.Float32BufferAttribute(Array(n).fill(3), 1));
    g.setAttribute('_ground_clearance', new THREE.Float32BufferAttribute(Array(n).fill(0), 1));
    const rejected = await loadPuttomFacilities(invalid.context);
    expect(rejected.report.reason).toContain('ground-contact values');
    expect(rejected.report.replacedBuildingIds).toEqual([]); expect(invalid.scene.children).toEqual([]);
  });

  it('wires early Puttom loading and switches range replacement off on a failed load', async () => {
    const good = fixture(), result = await scenery.loadFacilities(good.context);
    expect(scenery.loadFacilitiesBeforeSurfaces).toBe(true); expect(scenery.replacesRangeFacilities).toBe(true);
    expect(scenery.isFacilityInterior(-120, -200)).toBe(true); result.dispose();
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    await scenery.loadFacilities(bad.context);
    expect(scenery.replacesRangeFacilities).toBe(false); expect(scenery.isFacilityInterior(-120, -200)).toBe(false);
    expect(scenery.clubhouse.terrace).toBe(true); expect(scenery.buildingLooks['trace-range-hut'].windows).toBe(true);
  });

  it('retains every fallback if the final facility is missing, disposing each shared resource once', async () => {
    const f = fixture(); f.root.children[2].name = 'missing';
    const materials = f.materials.map(m => vi.spyOn(m, 'dispose')), geometries = f.geometries.map(g => vi.spyOn(g, 'dispose'));
    const result = await loadPuttomFacilities(f.context);
    expect(result.report.status).toBe('fallback'); expect(result.report.replacedBuildingIds).toEqual([]);
    expect(result.replacedBuildingIds.size).toBe(0); expect(result.facilityFootprints).toEqual([]);
    expect(result.report.replacesRangeFacilities).toBe(false); expect(f.scene.children).toEqual([]);
    result.dispose();
    expect([...materials, ...geometries].every(s => s.mock.calls.length === 1)).toBe(true);
  });

  it('rejects foreign course frames, missing clubhouse coverage, and duplicate source ownership', () => {
    const f = fixture();
    expect(() => validatePuttomFacilitiesManifest(f.manifest, { ...f.context, courseSlug: 'visby' })).toThrow('another course');
    const frame = structuredClone(f.manifest); frame.coordinateFrame.mPerLon += 1;
    expect(() => validatePuttomFacilitiesManifest(frame, f.context)).toThrow('frame');
    const missing = structuredClone(f.manifest); missing.facilities[0].sourceBuildingIds.shift();
    expect(() => validatePuttomFacilitiesManifest(missing, f.context)).toThrow('clubhouse');
    const duplicate = structuredClone(f.manifest); duplicate.facilities[2].sourceBuildingIds.push('trace-annex-a');
    expect(() => validatePuttomFacilitiesManifest(duplicate, f.context)).toThrow('duplicate replacement');
    const unknown = structuredClone(f.manifest); unknown.facilities[2].sourceBuildingIds.push('not-in-model');
    expect(() => validatePuttomFacilitiesManifest(unknown, f.context)).toThrow('replacement source');
  });

  it('refuses corrupt receipts and external or photographic assets before parsing', async () => {
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    expect((await loadPuttomFacilities(bad.context)).report.reason).toContain('checksum');
    expect(bad.parseGlb).not.toHaveBeenCalled();
    const size = fixture(); size.manifest.asset.bytes += 4;
    expect((await loadPuttomFacilities(size.context)).report.reason).toContain('byte count');
    const foreign = fixture(); foreign.manifest.asset.url = 'https://other.test/facilities-v1.glb';
    expect((await loadPuttomFacilities(foreign.context)).report.reason).toContain('asset receipt');
    const photo = fixture({ asset: { version: '2.0' }, images: [{ uri: 'photo.jpg' }] });
    expect((await loadPuttomFacilities(photo.context)).report.reason).toContain('procedural materials');
    expect(photo.parseGlb).not.toHaveBeenCalled();
  });

  it('rejects displaced, nonfinite, unowned, and misidentified geometry', async () => {
    const moved = fixture(); moved.root.children[0].position.z = 1;
    expect((await loadPuttomFacilities(moved.context)).report.reason).toContain('bounds');
    const nan = fixture(); nan.geometries[0].attributes.position.setX(0, NaN);
    expect((await loadPuttomFacilities(nan.context)).report.reason).toContain('Non-finite');
    const index = fixture(); index.geometries[0].index.setX(0, 65535);
    expect((await loadPuttomFacilities(index.context)).report.reason).toContain('triangle index');
    const source = fixture(); source.root.children[0].userData.sourceBuildingIds.pop();
    expect((await loadPuttomFacilities(source.context)).report.reason).toContain('source node');
    const unowned = fixture(); unowned.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    expect((await loadPuttomFacilities(unowned.context)).report.reason).toContain('Unowned geometry');
  });

  it('disposes a completed parse after navigation and makes no request when already aborted', async () => {
    const f = fixture(), controller = new AbortController(), release = vi.spyOn(f.geometries[0], 'dispose');
    f.parseGlb.mockImplementation(async () => { controller.abort(); return { scene: f.root }; });
    const result = await loadPuttomFacilities({ ...f.context, signal: controller.signal });
    expect(result.report.reason).toContain('cancelled'); expect(f.scene.children).toEqual([]);
    result.dispose(); expect(release).toHaveBeenCalledTimes(1);
    const before = fixture();
    expect((await loadPuttomFacilities({ ...before.context, signal: controller.signal })).report.status).toBe('fallback');
    expect(before.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses unavailable ground and invalid current terrain datum', () => {
    const f = fixture();
    expect(() => puttomFacilityVerticalPlacement(f.facilities[0], { ...f.context, terrainH: () => NaN })).toThrow('ground');
    expect(() => puttomFacilityVerticalPlacement(f.facilities[0], { ...f.context, verticalDatumOffsetMetres: NaN })).toThrow('bridge');
  });
});
