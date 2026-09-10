/* Authored Ängsö facilities use east/up/south legacy plan coordinates and
 * absolute RH2000 heights. Only a complete, verified installation replaces
 * source buildings; failed loads retain the original course environment. */
import { applyAngsoGroundMaterials } from './angso-ground-materials.mjs';

export const ANGSO_FACILITY_REPLACEMENTS = Object.freeze({
  B01: 'w516709523', B03: 'w516709525', B04: 'w516709524',
  B09: 'w516709522', B11: 'w516709521', B13: 'w517780252',
});
export const ANGSO_FACILITY_SOURCE_IDS = Object.freeze(Object.values(ANGSO_FACILITY_REPLACEMENTS));
const PARKING_REPLACEMENTS = Object.freeze({ S01: 'trace-parking-main', S02: 'trace-parking-south' });
const MAX_BYTES = 32 * 1024 * 1024;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finitePair = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const finiteRing = ring => Array.isArray(ring) && ring.length >= 3 && ring.every(finitePair);
const ringBounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
  minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const sameStrings = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((value, index) => typeof value === 'string' && value === b[index]);
const includesAnchor = (bounds, [x, z], margin = 20) => x >= bounds.minX - margin && x <= bounds.maxX + margin
  && z >= bounds.minZ - margin && z <= bounds.maxZ + margin;

export function validateAngsoFacilitiesManifest(manifest, { courseSlug, buildings, parking = [] }) {
  assert(courseSlug === 'angso', 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === 'angso', 'Invalid facilities manifest identity');
  assert(sameStrings(manifest.courseSlugs, ['angso']), 'Facilities course mismatch');
  const frame = manifest.coordinateFrame;
  assert(frame?.kind === 'legacy-local-rh2000' && frame.originWgs84?.lat === 59.5739
    && frame.originWgs84?.lon === 16.871 && frame.mPerLat === 111320 && frame.mPerLon === 56375.41,
  'Facilities coordinate frame mismatch');
  assert(typeof manifest.asset?.url === 'string' && /^[a-f0-9]{64}$/.test(manifest.asset.sha256)
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes <= MAX_BYTES,
  'Invalid facilities asset receipt');
  assert(Array.isArray(manifest.facilities) && manifest.facilities.length >= ANGSO_FACILITY_SOURCE_IDS.length
    && manifest.facilities.length <= 128, 'Invalid facilities inventory');
  const bySource = new Map(buildings.map(building => [building.id, building]));
  const ids = new Set(), names = new Set(), sources = new Set(), parkingIndices = new Set();
  for (const facility of manifest.facilities) {
    assert(typeof facility.id === 'string' && facility.id.length > 0 && !ids.has(facility.id), 'Duplicate facility ID');
    assert(typeof facility.nodeName === 'string' && facility.nodeName.length > 0 && !names.has(facility.nodeName),
      'Duplicate facility node');
    assert(Array.isArray(facility.sourceBuildingIds), 'Invalid replacement building IDs');
    const expectedSource = ANGSO_FACILITY_REPLACEMENTS[facility.id];
    assert(sameStrings(facility.sourceBuildingIds, expectedSource ? [expectedSource] : []), 'Facility source identity mismatch');
    assert(finitePair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M),
      'Invalid facility ground anchor');
    assert(['absolute-rh2000', 'terrain-anchor'].includes(facility.placement), 'Invalid facility placement');
    assert(finiteRing(facility.footprintLocal), 'Facility footprint is unavailable');
    const bounds = ringBounds(facility.footprintLocal);
    assert(bounds.minX >= -2048 && bounds.maxX <= 2048 && bounds.minZ >= -2048 && bounds.maxZ <= 2048,
      'Facility footprint leaves Ängsö');
    assert(includesAnchor(bounds, facility.groundAnchorLocal), 'Facility anchor leaves its footprint');
    const groundRings = facility.groundSurfaceRingsLocal ?? [];
    assert(Array.isArray(groundRings) && groundRings.length <= 512 && groundRings.every(ring =>
      finiteRing(ring) && ring.every(point => includesAnchor(bounds, point))), 'Invalid facility ground surface outlines');
    for (const source of facility.sourceBuildingIds) {
      assert(!sources.has(source) && finiteRing(bySource.get(source)?.ring), 'Replacement building is unavailable or duplicated');
      assert(includesAnchor(ringBounds(bySource.get(source).ring), facility.groundAnchorLocal),
        'Facility anchor leaves its source building');
      sources.add(source);
    }
    assert(facility.vegetationExclusion === undefined || typeof facility.vegetationExclusion === 'boolean',
      'Invalid facility vegetation exclusion');
    const replacedParking = facility.sourceParkingIndices ?? [], parkingRings = facility.sourceParkingRingsLocal ?? [];
    assert(Array.isArray(replacedParking) && Array.isArray(parkingRings) && replacedParking.length === parkingRings.length,
      'Invalid parking replacement inventory');
    for (const index of replacedParking) {
      assert(Number.isInteger(index) && index >= 0 && !parkingIndices.has(index), 'Invalid or duplicate parking index');
      const expected = parkingRings.find(receipt => receipt.index === index)?.ring, actual = parking[index];
      assert(PARKING_REPLACEMENTS[facility.id] === actual?.id && typeof actual?.id === 'string'
        && finiteRing(expected) && actual.ring?.length === expected.length
        && actual.ring.every((point, i) => finitePair(point) && Math.hypot(point[0] - expected[i][0], point[1] - expected[i][1]) < .15),
      'Replacement parking footprint changed');
      parkingIndices.add(index);
    }
    ids.add(facility.id); names.add(facility.nodeName);
  }
  assert(ANGSO_FACILITY_SOURCE_IDS.every(id => sources.has(id)), 'Incomplete facilities replacement inventory');
  return manifest;
}

export function angsoFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres }) {
  const terrain = terrainH(...facility.groundAnchorLocal);
  assert(Number.isFinite(terrain), 'Facility ground is unavailable');
  // Ängsö's legacy terrain was re-grounded to RH2000. Another course's bridge
  // would move every roof even though the horizontal coordinates are correct.
  assert(Number.isFinite(verticalDatumOffsetMetres) && Math.abs(verticalDatumOffsetMetres) < .001,
    'Facility height bridge mismatch');
  const anchored = !v2Active || facility.placement === 'terrain-anchor';
  const shift = anchored ? terrain - facility.groundAnchorRh2000M : verticalDatumOffsetMetres;
  assert(Number.isFinite(shift) && Math.abs(shift) < 40, 'Facility vertical placement is implausible');
  return { shift, mode: anchored ? 'terrain-anchor' : 'absolute-rh2000', terrainHeight: terrain,
    groundAnchorLocal: [...facility.groundAnchorLocal], sourceGroundRh2000M: facility.groundAnchorRh2000M,
    groundResidualMetres: facility.groundAnchorRh2000M + shift - terrain };
}

function disposeFacilityObject(root) {
  if (!root) return;
  root.removeFromParent();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

function localAssetUrl(path, baseUrl) {
  const base = new URL(baseUrl), url = new URL(path, base);
  assert(url.origin === base.origin && !url.username && !url.password
    && url.pathname.startsWith(base.pathname.replace(/\/?$/, '/') + 'models/angso/'),
  'Facilities asset leaves its course directory');
  return url.href;
}

function validateGlbBytes(buffer) {
  assert(buffer.byteLength > 20, 'Facilities GLB is empty');
  const view = new DataView(buffer);
  assert(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === buffer.byteLength, 'Invalid facilities GLB header');
  const jsonLength = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a && jsonLength > 0 && 20 + jsonLength <= buffer.byteLength,
    'Invalid facilities GLB JSON chunk');
  const document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).trim());
  assert(!document.buffers?.some(buffer => buffer.uri) && !document.images?.length && !document.textures?.length
    && !document.animations?.length && !document.skins?.length && !document.cameras?.length
    && !document.extensions?.KHR_lights_punctual,
  'Facilities GLB must contain static geometry and procedural materials only');
}

async function defaultParseGlb(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

/** Source IDs and vegetation footprints become active together, after validation. */
export async function loadAngsoFacilities({ THREE, scene, courseSlug, buildings, parking, terrainH,
  v2Active, verticalDatumOffsetMetres, baseUrl, detailTexture, signal, isCurrentCourse = () => true,
  fetchImpl = globalThis.fetch, parseGlb = defaultParseGlb, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set(), replacedParkingIndices = new Set(), facilityFootprints = [], groundSurfaceFootprints = [];
  let root = null, disposed = false;
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], replacedParkingIndices: [],
    facilities: [], meshes: 0, triangles: 0 };
  const dispose = () => {
    if (disposed) return;
    disposed = true; abort(); disposeFacilityObject(root); root = null;
    replacedBuildingIds.clear(); replacedParkingIndices.clear(); facilityFootprints.length = 0; groundSurfaceFootprints.length = 0;
  };
  const current = () => assert(!controller.signal.aborted && isCurrentCourse(), 'Facilities load was cancelled');
  try {
    current();
    assert(courseSlug === 'angso', 'Facilities belong to another course');
    const response = await fetchImpl(localAssetUrl('models/angso/facilities-v1.json', baseUrl), { signal: controller.signal });
    assert(response.ok, 'Facilities manifest could not be loaded');
    const manifest = validateAngsoFacilitiesManifest(await response.json(), { courseSlug, buildings, parking });
    current();
    const assetResponse = await fetchImpl(localAssetUrl(manifest.asset.url, baseUrl), { signal: controller.signal });
    assert(assetResponse.ok, 'Facilities geometry could not be loaded');
    const buffer = await assetResponse.arrayBuffer();
    assert(buffer.byteLength === manifest.asset.bytes, 'Facilities byte count mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    assert(hash === manifest.asset.sha256, 'Facilities checksum mismatch');
    validateGlbBytes(buffer); current();
    root = (await parseGlb(buffer)).scene;
    assert(root?.isObject3D, 'Facilities scene is unavailable');
    current(); root.updateMatrixWorld(true);
    const byName = new Map();
    root.traverse(object => {
      // GLTFLoader preserves the original name in extras when sanitizing its
      // animation-binding name; lookup must use the authored glTF identity.
      const name = object.userData?.name ?? object.name;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(object);
      assert(!object.isSkinnedMesh && !object.isInstancedMesh && !object.isLight && !object.isCamera,
        'Facilities require static meshes');
    });
    const ownedMeshes = new Set();
    for (const facility of manifest.facilities) {
      const matches = byName.get(facility.nodeName) || [];
      assert(matches.length === 1, 'Facilities node is missing or duplicated: ' + facility.nodeName);
      const object = matches[0];
      assert(object !== root && object.parent === root, 'Facilities need independent top-level nodes');
      assert(object.userData.facilityId === facility.id
        && sameStrings(object.userData.sourceBuildingIds, facility.sourceBuildingIds), 'Facilities source node mismatch');
      let meshes = 0, triangles = 0;
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        assert(!ownedMeshes.has(mesh), 'Facilities nodes share geometry ownership');
        ownedMeshes.add(mesh);
        const positions = mesh.geometry?.getAttribute('position');
        assert(positions && positions.count >= 3, 'Empty facility mesh');
        for (let i = 0; i < positions.count; i++) assert(Number.isFinite(positions.getX(i))
          && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)), 'Non-finite facility vertex');
        const normals = mesh.geometry.getAttribute('normal');
        assert(normals?.count === positions.count, 'Missing facility normals');
        for (let i = 0; i < normals.count; i++) assert(Number.isFinite(normals.getX(i))
          && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)), 'Non-finite facility normal');
        meshes++; triangles += (mesh.geometry.index?.count ?? positions.count) / 3;
        mesh.castShadow = true; mesh.receiveShadow = true;
      });
      assert(meshes > 0 && Number.isInteger(triangles) && triangles > 0, 'Facility has no triangles');
      const bounds = new THREE.Box3().setFromObject(object), footprint = ringBounds(facility.footprintLocal);
      assert(bounds.min.x >= footprint.minX - 20 && bounds.max.x <= footprint.maxX + 20
        && bounds.min.z >= footprint.minZ - 20 && bounds.max.z <= footprint.maxZ + 20
        && bounds.min.y > -10 && bounds.max.y < 100 && bounds.max.y - bounds.min.y > .005,
      'Facility bounds leave their source footprint: ' + facility.id);
      const placement = angsoFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres });
      object.position.y += placement.shift;
      object.userData.placement = placement;
      report.facilities.push({ id: facility.id, sourceBuildingIds: [...facility.sourceBuildingIds], nodeName: facility.nodeName,
        meshes, triangles, ...placement, boundsBeforePlacement: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
      report.meshes += meshes; report.triangles += triangles;
    }
    root.traverse(object => assert(!object.isMesh || ownedMeshes.has(object), 'Unowned geometry in facilities asset'));
    assert(report.triangles <= 750000 && report.meshes <= 1500, 'Facilities geometry budget exceeded');
    current();
    root.name = 'Ängsö authored facilities';
    root.userData = { ...root.userData, groundId: 'angso', assetSha256: hash, facilityCount: manifest.facilities.length };
    report.groundSurfaceMaterials = applyAngsoGroundMaterials(root, detailTexture);
    scene.add(root); root.updateMatrixWorld(true);
    for (const facility of manifest.facilities) {
      for (const source of facility.sourceBuildingIds) replacedBuildingIds.add(source);
      for (const index of facility.sourceParkingIndices ?? []) replacedParkingIndices.add(index);
      if (facility.vegetationExclusion ?? ['building', 'shelter', 'canopy'].includes(facility.kind)) {
        const placement = report.facilities.find(item => item.id === facility.id);
        facilityFootprints.push({ id: facility.id, ring: facility.footprintLocal.map(point => [...point]),
          bounds: ringBounds(facility.footprintLocal),
          floorWorld: placement.boundsBeforePlacement.min[1] + placement.shift,
          roofTopWorld: placement.boundsBeforePlacement.max[1] + placement.shift });
      }
      for (const [index, ring] of (facility.groundSurfaceRingsLocal ?? []).entries()) {
        groundSurfaceFootprints.push({ id: facility.id + '-ground-' + index,
          ring: ring.map(point => [...point]), bounds: ringBounds(ring) });
      }
    }
    Object.assign(report, { status: 'loaded', assetSha256: hash, replacedBuildingIds: [...replacedBuildingIds],
      replacedParkingIndices: [...replacedParkingIndices],
      groundSurfaceExclusionCount: groundSurfaceFootprints.length,
      vegetationExclusionIds: facilityFootprints.map(facility => facility.id) });
    return { root, report, replacedBuildingIds, replacedParkingIndices, facilityFootprints, groundSurfaceFootprints, dispose };
  } catch (error) {
    dispose();
    Object.assign(report, { status: 'fallback', reason: error instanceof Error ? error.message : 'Facilities unavailable',
      replacedBuildingIds: [], replacedParkingIndices: [], facilities: [], meshes: 0, triangles: 0 });
    return { root: null, report, replacedBuildingIds, replacedParkingIndices, facilityFootprints, groundSurfaceFootprints, dispose };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort);
  }
}
