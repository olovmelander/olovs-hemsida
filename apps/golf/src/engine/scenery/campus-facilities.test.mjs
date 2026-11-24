import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { campusVerticalPlacement, loadCampusFacilities, validateCampusManifest } from './campus-facilities.mjs';
import { campusSlot } from './campus-slot.mjs';
import * as broHof from './bro-hof.js';

const CAMPUS = { groundId: 'demo', name: 'Demo facilities', courseSlugs: ['demo-a', 'demo-b'], originEasting: 600000, originNorthing: 6600000,
  requiredSources: ['w1'] };
const ringAt = (x, z) => [[x - 5, z - 5], [x + 5, z - 5], [x + 5, z + 5], [x - 5, z + 5]];
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
function glb(document) {
  const text = Buffer.from(JSON.stringify(document)), body = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(body);
  const out = Buffer.alloc(20 + body.length);
  [0x46546c67, 2, out.length, body.length, 0x4e4f534a].forEach((v, i) => out.writeUInt32LE(v, i * 4));
  body.copy(out, 20);
  return out;
}

function fixture(document = { asset: { version: '2.0' } }) {
  const bytes = glb(document), sha256 = createHash('sha256').update(bytes).digest('hex');
  const scene = new THREE.Scene(), root = new THREE.Group(), geometries = [];
  const facilities = [['house', ['w1'], 0, 0, true], ['hedge', [], 40, 20, false]].map(([id, sources, x, z, exclude]) => {
    const geometry = new THREE.BoxGeometry(4, 6, 4).translate(x, 33, z), node = new THREE.Group();
    node.name = `Demo-${id}`;
    node.userData = { facilityId: id, sourceBuildingIds: sources };
    node.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    root.add(node);
    geometries.push(geometry);
    return { id, nodeName: node.name, sourceBuildingIds: sources, footprintLocal: ringAt(x, z), groundAnchorLocal: [x, z], groundAnchorRh2000M: 30,
      placement: 'absolute-rh2000', boundsLocalRh2000: { min: [x - 2, 30, z - 2], max: [x + 2, 36, z + 2] }, excludeVegetation: exclude,
      evidence: { plan: 'orthophoto' } };
  });
  const manifest = { schemaVersion: 1, groundId: 'demo', courseSlugs: [...CAMPUS.courseSlugs], replacesRangeFacilities: false, replacesCourtyard: false,
    coordinateFrame: { kind: 'epsg3006-local-rh2000', originEasting: 600000, originNorthing: 6600000, axes: 'east-up-south', heightDatum: 'RH2000' },
    asset: { url: `models/demo/facilities-${sha256}.glb`, bytes: bytes.length, sha256 }, facilities };
  const buildings = [{ id: 'w1', ring: ringAt(0, 0) }, { id: 'w2', ring: ringAt(300, 300) }];
  const context = { THREE, scene, courseSlug: 'demo-b', buildings, terrainH: () => 30, v2Active: true, verticalDatumOffsetMetres: 0,
    baseUrl: 'https://example.test/golf/', parseGlb: vi.fn(async () => ({ scene: root })),
    fetchImpl: vi.fn(async url => (url.endsWith('.json') ? { ok: true, json: async () => manifest }
      : { ok: true, arrayBuffer: async () => arrayBuffer(bytes) })) };
  return { bytes, scene, root, manifest, buildings, context, geometries };
}

describe('the campus loader', () => {
  it('publishes replacements and exclusions only once the whole asset stands', async () => {
    const f = fixture(), result = await loadCampusFacilities(CAMPUS, f.context);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds]).toEqual(['w1']);
    expect(result.facilityFootprints.map(x => x.id)).toEqual(['house']);   // a hedge keeps its plants
    expect(result.isFacilityInterior(0, 0)).toBe(true);
    expect(result.isFacilityInterior(40, 20)).toBe(false);
    expect(result.report.triangles).toBe(24);
    expect(f.scene.children).toEqual([f.root]);
    expect(f.context.fetchImpl.mock.calls.map(c => c[0])).toEqual([
      'https://example.test/golf/models/demo/facilities-v1.json', `https://example.test/golf/${f.manifest.asset.url}`]);
    result.dispose();
    expect(f.scene.children).toEqual([]);
    expect(result.replacedBuildingIds.size + result.facilityFootprints.length).toBe(0);
  });

  it('keeps RH 2000 heights, adds the bridge once, and stands on its anchor off v2 terrain', () => {
    const facility = fixture().manifest.facilities[0];
    expect(campusVerticalPlacement(facility, { v2Active: true, terrainH: () => 30.05, verticalDatumOffsetMetres: 0.05 }))
      .toMatchObject({ shift: 0.05, mode: 'absolute-rh2000' });
    expect(campusVerticalPlacement(facility, { v2Active: false, terrainH: () => 34, verticalDatumOffsetMetres: NaN }))
      .toMatchObject({ shift: 4, mode: 'terrain-anchor' });
    expect(() => campusVerticalPlacement(facility, { v2Active: true, terrainH: () => NaN })).toThrow('ground');
  });

  it.each([
    ['another course', () => {}, { courseSlug: 'demo-c' }, 'another course'],
    ['another ground', m => { m.groundId = 'x'; }, {}, 'identity'],
    ['another frame', m => { m.coordinateFrame.originEasting += 1; }, {}, 'frame'],
    ['an unhashed asset', m => { m.asset.url = 'models/demo/facilities.glb'; }, {}, 'receipt'],
    ['an unmapped source', m => { m.facilities[1].sourceBuildingIds = ['w9']; }, {}, 'replacement source'],
    ['a far source', m => { m.facilities[1].sourceBuildingIds = ['w2']; }, {}, 'source footprint'],
    ['a missing required building', m => { m.facilities[0].sourceBuildingIds = []; }, {}, 'required'],
    ['a repeated node', m => { m.facilities[1].nodeName = m.facilities[0].nodeName; }, {}, 'Duplicate'],
    ['a footprint without area', m => { m.facilities[0].footprintLocal = [[0, 0], [1, 0], [2, 0]]; }, {}, 'area'],
    ['a terrain anchor', m => { m.facilities[0].placement = 'terrain'; }, {}, 'absolute'],
    ['no evidence', m => { delete m.facilities[0].evidence; }, {}, 'evidence'],
  ])('refuses %s', (_, change, extra, reason) => {
    const f = fixture();
    change(f.manifest);
    expect(() => validateCampusManifest(f.manifest, { campus: CAMPUS, courseSlug: 'demo-a', buildings: f.buildings, ...extra })).toThrow(reason);
  });

  it.each([
    ['changed bytes', f => { f.manifest.asset.sha256 = 'a'.repeat(64); f.manifest.asset.url = `models/demo/facilities-${'a'.repeat(64)}.glb`; }, 'checksum'],
    ['a missing manifest', f => { f.context.fetchImpl = async () => ({ ok: false }); }, 'manifest'],
    ['a nested node', f => { const g = new THREE.Group(); g.add(f.root.children[0]); f.root.add(g); }, 'nested'],
    ['geometry nothing owns', f => { f.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())); }, 'Unowned'],
    ['bounds that moved', f => { f.geometries[0].translate(0, 1, 0); }, 'bounds'],
    ['a collapsed triangle', f => { f.geometries[1].index.setX(0, f.geometries[1].index.getX(1)); }, 'Degenerate'],
    ['a cancelled course', f => { f.context.isCurrentCourse = () => false; }, 'cancelled'],
  ])('falls back on %s and leaves the scene as it was', async (_, change, reason) => {
    const f = fixture();
    change(f);
    const result = await loadCampusFacilities(CAMPUS, f.context);
    expect(result.report).toMatchObject({ status: 'fallback', replacedBuildingIds: [], triangles: 0 });
    expect(result.report.reason).toContain(reason);
    expect(f.scene.children).toEqual([]);
    expect(result.isFacilityInterior(0, 0)).toBe(false);
  });

  it('refuses a GLB that carries images', async () => {
    const f = fixture({ asset: { version: '2.0' }, images: [{ uri: 'x.png' }] });
    expect((await loadCampusFacilities(CAMPUS, f.context)).report.reason).toContain('static geometry');
  });

  it('keeps the newest load and disposes one that finishes late', async () => {
    const f = fixture(), g = fixture();
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const slot = campusSlot(async context => {
      if (context.slow) await waiting;
      return loadCampusFacilities(CAMPUS, context);
    });
    const late = slot.load({ ...f.context, slow: true });
    const now = await slot.load(g.context);
    release();
    expect((await late).report.status).not.toBe('loaded');
    expect(f.scene.children).toEqual([]);
    expect(slot.status()).toMatchObject({ status: 'loaded', buildings: 1, facilities: 2 });
    expect(slot.isFacilityInterior(0, 0)).toBe(true);
    now.dispose();
    expect(slot.isFacilityInterior(0, 0)).toBe(false);
    expect(slot.status().status).toBe('fallback');
  });
});

const PUBLIC = new URL('../../../public/', import.meta.url);
const published = new URL('models/bro-hof/facilities-v1.json', PUBLIC);
describe.skipIf(!existsSync(published))('the published campus at Bro Hof', () => {
  it.each(broHof.BRO_HOF_CAMPUS.courseSlugs)('loads whole on %s', async courseSlug => {
    const manifest = JSON.parse(readFileSync(published, 'utf8')), data = readFileSync(new URL(manifest.asset.url, PUBLIC));
    const build = courseSlug === 'bro-hof-stadium' ? 'brohofbuild' : 'brohofcastlebuild';
    const { buildings } = JSON.parse(readFileSync(new URL(`../../../../../${build}/course-model.json`, import.meta.url), 'utf8')).infra;
    const scene = new THREE.Scene();
    const result = await loadCampusFacilities(broHof.BRO_HOF_CAMPUS, { THREE, scene, courseSlug, buildings, terrainH: () => 12, v2Active: true,
      verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/golf/',
      fetchImpl: async url => (url.endsWith('.json') ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => arrayBuffer(data) }) });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds].sort()).toEqual(['ortho-halfway-house-castle', 'w1235353673', 'w319035128']);
    expect(result.report.triangles).toBeLessThan(80_000);
    const box = new THREE.Box3().setFromObject(result.root.children.find(c => c.userData.facilityId === 'castle'));
    expect(box.max.y).toBeCloseTo(41.75, 1);                              // the spire, in RH 2000
    expect(result.isFacilityInterior(648636.91 - 649094.5, 6598568.5 - 6598165.06)).toBe(true);
    result.dispose();
    expect(scene.children).toEqual([]);
  });
});
