import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { loadRibbingsforsFacilities, ribbingsforsFacilityVerticalPlacement, roofFootprints,
  validateRibbingsforsFacilitiesManifest } from './ribbingsfors-facilities.mjs';

const CLUBHOUSE = 'ribbingsfors-clubhouse-provisional', ANNEX = 'ribbingsfors-clubhouse-annex';
const ringAt = (x, z, half = 5) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
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
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const buildings = [
    { id: CLUBHOUSE, ring: ringAt(479, -456.5) },
    { id: ANNEX, ring: ringAt(478.7, -464.5) },
    { id: 'ribbingsfors-manor-farm-0', ring: ringAt(730, -494) },
    { id: 'unrelated', ring: ringAt(-300, 600) },
  ];
  const scene = new THREE.Scene(), root = new THREE.Group();
  const facilities = [
    { id: 'clubhouse-main', sourceBuildingId: CLUBHOUSE, groundAnchorLocal: [482, -458], kind: 'roof' },
    { id: 'range-shelter', sourceFeatureId: 'range-shelter', groundAnchorLocal: [665, -437], kind: 'roof',
      footprintLocal: ringAt(665, -437, 8) },
    { id: 'range-mat-01', sourceFeatureId: 'range-mat-01', groundAnchorLocal: [628.5, -431.5], kind: 'range-mat',
      footprintLocal: ringAt(628.5, -431.5, 1) },
  ].map(f => ({ ...f, nodeName: `Ribbingsfors ${f.id}`, groundAnchorRh2000M: 77.2, placement: 'absolute-rh2000' }));
  const geometries = [], materials = [];
  for (const facility of facilities) {
    const [x, z] = facility.groundAnchorLocal;
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 80.2, z);
    const material = new THREE.MeshStandardMaterial();
    const node = new THREE.Group();
    node.name = facility.nodeName;
    for (const key of ['sourceBuildingId', 'sourceFeatureId']) if (facility[key]) node.userData[key] = facility[key];
    node.add(new THREE.Mesh(geometry, material)); root.add(node);
    geometries.push(geometry); materials.push(material);
  }
  const manifest = { schemaVersion: 1, groundId: 'ribbingsfors', courseSlugs: ['ribbingsfors'],
    coordinateFrame: { kind: 'epsg3006-local-rh2000', originEpsg3006: { easting: 448975.5, northing: 6536024.5 },
      axes: 'east-up-south', heightDatum: 'RH2000' },
    asset: { url: `models/ribbingsfors/facilities-${sha256}.glb`, sha256, bytes: bytes.length },
    facilities,
    suppressedSourceBuildingIds: [{ id: ANNEX, reason: 'The orthophoto shows the clubhouse shadow here, not a building.' }],
    replacesRangeFacilities: true };
  const fetchImpl = vi.fn(async url => url.endsWith('.json')
    ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => buffer });
  const parseGlb = vi.fn(async () => ({ scene: root }));
  const context = { THREE, scene, courseSlug: 'ribbingsfors', buildings, terrainH: () => 77.2,
    v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/olovs-hemsida/', fetchImpl, parseGlb };
  return { manifest, context, buildings, facilities, scene, root, geometries, materials, fetchImpl, parseGlb, sha256 };
}

describe('Ribbingsfors Blender facilities', () => {
  it('replaces the claimed clubhouse, suppresses the shadow annex, and leaves every other source building alone', async () => {
    const f = fixture(), result = await loadRibbingsforsFacilities(f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds].sort()).toEqual([ANNEX, CLUBHOUSE].sort());
    expect(result.report.suppressedBuildingIds).toEqual([ANNEX]);
    expect(result.replacedBuildingIds.has('ribbingsfors-manor-farm-0')).toBe(false);
    expect(result.report.replacesRangeFacilities).toBe(true);
    expect(f.scene.children).toEqual([f.root]);
    // The grid-frame bridge is zero: nothing moves, horizontally or vertically.
    expect(f.root.children[0].position.toArray()).toEqual([0, 0, 0]);
    const bounds = new THREE.Box3().setFromObject(f.root.children[0]);
    expect(bounds.min.x).toBe(480); expect(bounds.min.z).toBe(-460);
    expect(bounds.min.y).toBeCloseTo(77.2, 5);
    expect(f.fetchImpl.mock.calls[1][0]).toBe(`https://example.test/olovs-hemsida/models/ribbingsfors/facilities-${f.sha256}.glb`);
    // Only roofs exclude vegetation: a hitting mat must not clear a woodland.
    expect(result.facilityFootprints.map(r => r.id)).toEqual(['clubhouse-main', 'range-shelter']);
    expect(result.facilityFootprints[0].ring).toEqual(f.buildings[0].ring);
    result.dispose();
    expect(f.scene.children).toEqual([]);
    expect(result.replacedBuildingIds.size).toBe(0);
  });

  it('anchors rigid buildings to visible terrain when v2 terrain is unavailable', async () => {
    const f = fixture();
    const result = await loadRibbingsforsFacilities({ ...f.context, v2Active: false, terrainH: () => 78.4 });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.report.facilities.every(p => p.mode === 'terrain-anchor' && Math.abs(p.groundResidualMetres) < 1e-9)).toBe(true);
    expect(new THREE.Box3().setFromObject(f.root.children[0]).min.y).toBeCloseTo(78.4, 5);
    result.dispose();
  });

  it('rejects foreign frames, a missing clubhouse, duplicate ownership, and a suppressed building that is also replaced', () => {
    const f = fixture();
    expect(() => validateRibbingsforsFacilitiesManifest(f.manifest, { ...f.context, courseSlug: 'visby' })).toThrow('another course');
    const frame = structuredClone(f.manifest); frame.coordinateFrame.originEpsg3006.easting += 1;
    expect(() => validateRibbingsforsFacilitiesManifest(frame, f.context)).toThrow('frame');
    const incomplete = structuredClone(f.manifest); incomplete.facilities.shift();
    expect(() => validateRibbingsforsFacilitiesManifest(incomplete, f.context)).toThrow('clubhouse');
    const duplicate = structuredClone(f.manifest); duplicate.facilities[1] = { ...duplicate.facilities[1], sourceBuildingId: CLUBHOUSE };
    delete duplicate.facilities[1].sourceFeatureId;
    expect(() => validateRibbingsforsFacilitiesManifest(duplicate, f.context)).toThrow('source');
    const both = structuredClone(f.manifest); both.suppressedSourceBuildingIds.push({ id: CLUBHOUSE, reason: 'x' });
    expect(() => validateRibbingsforsFacilitiesManifest(both, f.context)).toThrow('also be suppressed');
    const unnamed = structuredClone(f.manifest); unnamed.asset.url = 'models/ribbingsfors/facilities-v1.glb';
    expect(() => validateRibbingsforsFacilitiesManifest(unnamed, f.context)).toThrow('asset receipt');
    const far = structuredClone(f.manifest); far.facilities[1].footprintLocal = ringAt(1500, 0);
    far.facilities[1].groundAnchorLocal = [1500, 0];
    expect(() => validateRibbingsforsFacilitiesManifest(far, f.context)).toThrow('leaves Ribbingsfors');
    expect(roofFootprints(f.manifest, f.buildings).map(r => r.id)).toEqual(['clubhouse-main', 'range-shelter']);
  });

  it('checks integrity and refuses external reference media before parsing', async () => {
    const bad = fixture(); bad.manifest.asset.sha256 = '0'.repeat(64);
    bad.manifest.asset.url = `models/ribbingsfors/facilities-${'0'.repeat(64)}.glb`;
    expect((await loadRibbingsforsFacilities(bad.context)).report.reason).toContain('checksum');
    expect(bad.parseGlb).not.toHaveBeenCalled();
    const external = fixture({ asset: { version: '2.0' }, images: [{ uri: 'reference-photo.jpg' }] });
    expect((await loadRibbingsforsFacilities(external.context)).report.status).toBe('fallback');
    expect(external.parseGlb).not.toHaveBeenCalled();
    const foreign = fixture(); foreign.manifest.asset.url = `models/visby/facilities-${foreign.sha256}.glb`;
    expect((await loadRibbingsforsFacilities(foreign.context)).report.reason).toContain('asset receipt');
  });

  it('keeps all fallbacks and disposes geometry if any source node is missing or misplaced', async () => {
    const missing = fixture(); missing.root.children[1].name = 'wrong-shelter';
    const disposals = missing.geometries.map(g => vi.spyOn(g, 'dispose'));
    const result = await loadRibbingsforsFacilities(missing.context);
    expect(result.report.status).toBe('fallback');
    expect(result.report.replacedBuildingIds).toEqual([]);
    expect(result.report.facilities).toEqual([]); expect(missing.scene.children).toEqual([]);
    expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
    const moved = fixture(); moved.root.children[0].position.x = 500;
    expect((await loadRibbingsforsFacilities(moved.context)).report.reason).toContain('bounds');
    const nan = fixture(); nan.geometries[0].attributes.position.setX(0, NaN);
    expect((await loadRibbingsforsFacilities(nan.context)).report.reason).toContain('Non-finite');
    const source = fixture(); source.root.children[0].userData.sourceBuildingId = 'unrelated';
    expect((await loadRibbingsforsFacilities(source.context)).report.reason).toContain('source node');
  });

  it('disposes late geometry after navigation and refuses nonfinite terrain', async () => {
    const f = fixture(), controller = new AbortController();
    const releases = f.materials.map(material => vi.spyOn(material, 'dispose'));
    f.parseGlb.mockImplementation(async () => { controller.abort(); return { scene: f.root }; });
    const result = await loadRibbingsforsFacilities({ ...f.context, signal: controller.signal });
    expect(result.report.status).toBe('fallback'); expect(f.scene.children).toEqual([]);
    result.dispose(); expect(releases.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(() => ribbingsforsFacilityVerticalPlacement(f.facilities[0], { ...f.context, terrainH: () => NaN })).toThrow('ground');
  });
});
