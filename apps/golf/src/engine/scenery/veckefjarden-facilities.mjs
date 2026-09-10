/* Blender architecture in the pack's horizontal frame and absolute RH2000.
 * Only a fully verified asset can replace the corresponding source buildings. */
import footprints from './veckefjarden-facility-footprints.json' with { type: 'json' };
import { ringSD } from '../geom.js';
import { applyFacilityGroundMaterials } from './veckefjarden-ground-materials.mjs';
import { buildParkingCars } from './veckefjarden-parking.mjs';

export const FACILITY_IDS = Object.freeze([
  ...Array.from({ length: 12 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
]);
export const facilityFootprints = footprints;
export const isFacilityInterior = (x, z, margin = .2) => footprints.some(f => ringSD(x, z, f.ring) <= margin);
const SLUGS = ['veckefjarden', 'veckefjarden-korthalsbanan'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const triple = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

export function validateFacilitiesManifest(manifest, { courseSlug, buildings, parking = [] }) {
  assert(SLUGS.includes(courseSlug), 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === 'veckefjarden'
    && manifest.courseSlugs?.includes(courseSlug), 'Facilities course mismatch');
  const f = manifest.legacyFrame;
  assert(manifest.coordinateFrame === 'legacy-local-rh2000' && f?.latitude === 63.2845
    && f.longitude === 18.6735 && f.metresPerLatitude === 111320 && f.metresPerLongitude === 50045.09,
  'Facilities coordinate frame mismatch');
  assert(manifest.asset?.url === 'models/veckefjarden/facilities-v1.glb'
    && /^[a-f0-9]{64}$/.test(manifest.asset.sha256)
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes < 8 * 1024 * 1024,
  'Invalid facilities asset receipt');
  assert(manifest.facilities?.length === 20, 'Incomplete facility inventory');
  const ids = new Set(), names = new Set(), indices = new Set(), parkingIndices = new Set();
  for (const facility of manifest.facilities) {
    assert(FACILITY_IDS.includes(facility.id) && !ids.has(facility.id), 'Invalid or duplicate facility');
    assert(typeof facility.nodeName === 'string' && facility.nodeName && !names.has(facility.nodeName), 'Invalid facility node');
    assert(pair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M), 'Invalid ground anchor');
    assert(Array.isArray(facility.planRingLocal) && facility.planRingLocal.length >= 3
      && facility.planRingLocal.every(pair), 'Invalid facility footprint');
    assert(triple(facility.boundsLocalRh2000?.min) && triple(facility.boundsLocalRh2000?.max), 'Invalid facility bounds');
    assert(Array.isArray(facility.sourceBuildingIndices) && Array.isArray(facility.sourceBuildingRingsLocal)
      && facility.sourceBuildingIndices.length === facility.sourceBuildingRingsLocal.length, 'Invalid replacement inventory');
    for (const index of facility.sourceBuildingIndices) {
      assert(Number.isInteger(index) && index >= 0 && !indices.has(index), 'Duplicate replacement index');
      const expected = facility.sourceBuildingRingsLocal.find(r => r.index === index)?.ring;
      const actual = buildings[index]?.ring;
      assert(expected?.length >= 3 && expected.every(pair) && actual?.length === expected.length
        && actual.every((p, i) => pair(p) && Math.hypot(p[0] - expected[i][0], p[1] - expected[i][1]) < .15),
      'Replacement footprint changed at building ' + index);
      indices.add(index);
    }
    assert(Array.isArray(facility.sourceParkingIndices) && Array.isArray(facility.sourceParkingRingsLocal)
      && facility.sourceParkingIndices.length === facility.sourceParkingRingsLocal.length, 'Invalid parking replacement inventory');
    for (const index of facility.sourceParkingIndices) {
      assert(Number.isInteger(index) && index >= 0 && !parkingIndices.has(index), 'Duplicate parking index');
      const expected = facility.sourceParkingRingsLocal.find(r => r.index === index)?.ring;
      const actual = parking[index]?.ring;
      assert(expected?.length >= 3 && expected.every(pair) && actual?.length === expected.length
        && actual.every((p, i) => pair(p) && Math.hypot(p[0] - expected[i][0], p[1] - expected[i][1]) < .15),
      'Replacement parking changed at index ' + index);
      parkingIndices.add(index);
    }
    ids.add(facility.id); names.add(facility.nodeName);
  }
  return manifest;
}

function disposeObject(root) {
  if (!root) return;
  root.removeFromParent();
  const geometries = new Set(), materials = new Set();
  root.traverse(o => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry) geometries.add(o.geometry);
    for (const material of [o.material].flat().filter(Boolean)) materials.add(material);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

function validateGlb(buffer) {
  const v = new DataView(buffer);
  assert(buffer.byteLength > 20 && v.getUint32(0, true) === 0x46546c67 && v.getUint32(4, true) === 2
    && v.getUint32(8, true) === buffer.byteLength && v.getUint32(16, true) === 0x4e4f534a, 'Invalid facilities GLB');
  const length = v.getUint32(12, true);
  assert(length > 0 && length + 20 <= buffer.byteLength, 'Invalid facilities JSON chunk');
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim());
  assert(!doc.buffers?.some(b => b.uri) && !doc.images?.length && !doc.textures?.length
    && !doc.animations?.length && !doc.skins?.length, 'Facilities must contain static geometry and procedural materials');
}

async function parseAsset(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

// The editable Blender paving samples a 2 m grid. The live ground has 1 m
// triangles, so its small ridges can pierce that paving between model samples.
// Lift only tagged ground surfaces enough to cover the visible terrain. The
// roof, deck, furniture and stairs keep their authored RH2000 coordinates.
export function fitGroundContact(geometry, terrainH, shift, clearance = .10) {
  const p = geometry.getAttribute('position'), index = geometry.index;
  const corrections = new Map();
  const key = i => `${p.getX(i)},${p.getZ(i)}`;
  const count = index?.count ?? p.count;
  let samples = 0, maximumLiftMetres = 0;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const points = ids.map(j => [p.getX(j), p.getY(j), p.getZ(j)]);
    const edge = Math.max(...points.map((a, j) => {
      const b = points[(j + 1) % 3]; return Math.hypot(a[0] - b[0], a[2] - b[2]);
    }));
    const steps = Math.max(2, Math.ceil(edge / .5));
    assert(steps <= 100, 'Ground contact triangle exceeds its local sampling budget');
    let lift = 0;
    for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps - a; b++) {
      const weights = [a / steps, b / steps, 1 - (a + b) / steps];
      const at = axis => points.reduce((v, point, j) => v + point[axis] * weights[j], 0);
      const ground = terrainH(at(0), at(2));
      assert(Number.isFinite(ground), 'Ground contact terrain is unavailable');
      lift = Math.max(lift, ground + clearance - (at(1) + shift));
      samples++;
    }
    for (const j of ids) corrections.set(key(j), Math.max(corrections.get(key(j)) || 0, lift));
  }
  for (let i = 0; i < p.count; i++) {
    const lift = corrections.get(key(i)) || 0;
    p.setY(i, p.getY(i) + lift);
    maximumLiftMetres = Math.max(maximumLiftMetres, lift);
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { samples, maximumLiftMetres, clearanceMetres: clearance };
}

export async function loadFacilities({ THREE, scene, courseSlug, buildings, parking, terrainH,
  v2Active, verticalDatumOffsetMetres, baseUrl, detailTexture, signal, isCurrentCourse = () => true,
  fetchImpl = globalThis.fetch, parseGlb = parseAsset, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set(), replacedBuildingIndices = new Set(), replacedParkingIndices = new Set();
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], replacedBuildingIndices: [],
    replacedParkingIndices: [], facilities: [], meshes: 0, triangles: 0 };
  let root = null, parkingCarsRoot = null, disposed = false;
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  const current = () => assert(!controller.signal.aborted && isCurrentCourse(), 'Facilities load cancelled');
  const dispose = () => {
    if (disposed) return;
    disposed = true; abort(); disposeObject(parkingCarsRoot); parkingCarsRoot = null;
    disposeObject(root); root = null;
    replacedBuildingIds.clear(); replacedBuildingIndices.clear(); replacedParkingIndices.clear();
  };
  try {
    current();
    assert(SLUGS.includes(courseSlug), 'Facilities belong to another course');
    const base = new URL(baseUrl);
    const get = async path => {
      const response = await fetchImpl(new URL(path, base).href, { signal: controller.signal });
      assert(response.ok, 'Facilities could not load: ' + path);
      return response;
    };
    const manifest = validateFacilitiesManifest(await (await get('models/veckefjarden/facilities-v1.json')).json(), { courseSlug, buildings, parking });
    current();
    const buffer = await (await get(manifest.asset.url)).arrayBuffer();
    assert(buffer.byteLength === manifest.asset.bytes, 'Facilities byte count mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('');
    assert(hash === manifest.asset.sha256, 'Facilities checksum mismatch');
    validateGlb(buffer); current();
    root = (await parseGlb(buffer)).scene;
    assert(root?.isObject3D && root.children.length === 20, 'Invalid facilities scene');
    current(); root.updateMatrixWorld(true);
    if (v2Active) assert(Math.abs(verticalDatumOffsetMetres - 20.9924) < .001, 'Facility height bridge mismatch');
    const meshesOwned = new Set();
    for (const f of manifest.facilities) {
      const matches = root.children.filter(n => n.name === f.nodeName);
      assert(matches.length === 1, 'Missing facility node: ' + f.id);
      const node = matches[0];
      assert(node.userData.facilityId === f.id, 'Facility node identity mismatch');
      let meshes = 0, triangles = 0;
      node.traverse(m => {
        assert(!m.isSkinnedMesh && !m.isInstancedMesh, 'Only static facilities are supported');
        if (!m.isMesh) return;
        const p = m.geometry?.getAttribute('position');
        assert(p?.count >= 3 && !meshesOwned.has(m), 'Empty or shared facility mesh');
        for (let i = 0; i < p.count; i++) assert(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), 'Non-finite facility vertex');
        const n = m.geometry.getAttribute('normal');
        assert(n?.count === p.count, 'Missing facility normals');
        for (let i = 0; i < n.count; i++) assert(Number.isFinite(n.getX(i)) && Number.isFinite(n.getY(i)) && Number.isFinite(n.getZ(i)), 'Non-finite facility normal');
        meshesOwned.add(m); meshes++; triangles += (m.geometry.index?.count ?? p.count) / 3;
        m.castShadow = true; m.receiveShadow = true;
      });
      assert(meshes > 0 && triangles > 0 && Number.isInteger(triangles), 'Facility has no geometry');
      const bounds = new THREE.Box3().setFromObject(node);
      const before = { min: bounds.min.toArray(), max: bounds.max.toArray() };
      for (const k of ['min', 'max']) for (let a = 0; a < 3; a++) {
        assert(Math.abs(before[k][a] - f.boundsLocalRh2000[k][a]) < .002, 'Facility bounds differ from receipt');
      }
      const terrain = terrainH(...f.groundAnchorLocal);
      assert(Number.isFinite(terrain), 'Facility ground unavailable');
      const shift = v2Active ? verticalDatumOffsetMetres : terrain - f.groundAnchorRh2000M;
      assert(Number.isFinite(shift) && Math.abs(shift) < 60, 'Invalid facility height placement');
      const groundContact = { meshes: 0, samples: 0, maximumLiftMetres: 0, clearanceMetres: .10 };
      node.traverse(mesh => {
        if (!mesh.isMesh || mesh.userData.groundContact !== true) return;
        const fit = fitGroundContact(mesh.geometry, terrainH, shift);
        groundContact.meshes++; groundContact.samples += fit.samples;
        groundContact.maximumLiftMetres = Math.max(groundContact.maximumLiftMetres, fit.maximumLiftMetres);
      });
      const fitted = new THREE.Box3().setFromObject(node);
      const boundsAfterGroundContact = { min: fitted.min.toArray(), max: fitted.max.toArray() };
      node.position.y += shift;
      node.userData.sourceBuildingIndices = f.sourceBuildingIndices;
      node.userData.placement = { shift, mode: v2Active ? 'absolute-rh2000' : 'terrain-anchor' };
      report.facilities.push({ id: f.id, meshes, triangles, sourceBuildingIndices: f.sourceBuildingIndices,
        ...node.userData.placement, boundsBeforePlacement: before,
        boundsAfterGroundContact, groundContact,
        groundAnchorLocal: f.groundAnchorLocal, sourceGroundRh2000M: f.groundAnchorRh2000M,
        terrainHeight: terrain, groundResidualMetres: f.groundAnchorRh2000M + shift - terrain });
      report.meshes += meshes; report.triangles += triangles;
    }
    root.traverse(o => assert(!o.isMesh || meshesOwned.has(o), 'Unowned facility mesh'));
    assert(report.triangles === 44422 && report.meshes <= 160, 'Facility geometry budget mismatch');
    report.groundSurfaceMaterials = applyFacilityGroundMaterials(root, detailTexture);
    current();
    root.name = 'Veckefjarden authored facilities';
    root.userData.assetSha256 = hash;
    scene.add(root); root.updateMatrixWorld(true);
    const parked = buildParkingCars({ THREE, facilitiesRoot: root, facilities: manifest.facilities });
    parkingCarsRoot = parked.root;
    scene.add(parkingCarsRoot);
    report.parkingCars = parked.report;
    for (const f of manifest.facilities) for (const index of f.sourceBuildingIndices) replacedBuildingIndices.add(index);
    for (const f of manifest.facilities) for (const index of f.sourceParkingIndices) replacedParkingIndices.add(index);
    report.status = 'loaded'; report.assetSha256 = hash;
    report.replacedBuildingIndices = [...replacedBuildingIndices];
    report.replacedParkingIndices = [...replacedParkingIndices];
    return { root, report, replacedBuildingIds, replacedBuildingIndices, replacedParkingIndices, dispose };
  } catch (error) {
    dispose(); Object.assign(report, { status: 'fallback', reason: error.message, replacedBuildingIds: [],
      replacedBuildingIndices: [], replacedParkingIndices: [], facilities: [], parkingCars: null, meshes: 0, triangles: 0 });
    return { root: null, report, replacedBuildingIds, replacedBuildingIndices, replacedParkingIndices, dispose };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
