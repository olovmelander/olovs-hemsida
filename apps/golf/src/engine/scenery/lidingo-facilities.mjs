/* Lidingö's Blender mesh uses EPSG:3006 local X/Z and absolute RH2000 heights.
 * Validate the whole asset before publishing any replacement or exclusion;
 * missing, stale, or cancelled assets retain the ordinary course buildings. */
import { ringSD } from '../geom.js';

export const LIDINGO_PRIMARY_BUILDING_IDS = Object.freeze([
  'way/32262183', 'way/32262176', 'way/32262169', 'way/26408210', 'way/26408211',
]);
const MAX_BYTES = 32 * 1024 * 1024;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const triple = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const ringBounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
  minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);

export function validateLidingoFacilitiesManifest(manifest, { courseSlug, buildings }) {
  assert(courseSlug === 'lidingo', 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === 'lidingo'
    && manifest.courseSlugs?.length === 1 && manifest.courseSlugs[0] === courseSlug,
  'Invalid facilities manifest identity');
  const frame = manifest.coordinateFrame;
  assert(frame?.kind === 'epsg3006-local-rh2000' && frame.originEasting === 677700.5
    && frame.originNorthing === 6586399.5
    && frame.axes === 'east-up-south' && frame.heightDatum === 'RH2000', 'Facilities coordinate frame mismatch');
  assert(/^[a-f0-9]{64}$/.test(manifest.asset?.sha256)
    && manifest.asset.url === `models/lidingo/facilities-${manifest.asset.sha256}.glb`
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes <= MAX_BYTES,
  'Invalid facilities asset receipt');
  assert(Array.isArray(manifest.facilities) && manifest.facilities.length > 0 && manifest.facilities.length <= 128,
    'Invalid facilities inventory');
  assert(typeof manifest.replacesRangeFacilities === 'boolean', 'Missing range replacement policy');
  assert(manifest.replacesCourtyard === true, 'Missing courtyard replacement policy');
  assert(Array.isArray(buildings), 'Course building inventory is unavailable');
  const bySource = new Map(buildings.map(b => [b.id, b]));
  const ids = new Set(), names = new Set(), sources = new Set();
  for (const facility of manifest.facilities) {
    assert(typeof facility.id === 'string' && facility.id.length > 0 && !ids.has(facility.id), 'Duplicate facility ID');
    assert(typeof facility.nodeName === 'string' && facility.nodeName.length > 0 && !names.has(facility.nodeName),
      'Duplicate facility node');
    assert(Array.isArray(facility.sourceBuildingIds) && facility.sourceBuildingIds.length <= 16,
      'Invalid facility source building IDs');
    for (const id of facility.sourceBuildingIds) {
      assert(typeof id === 'string' && bySource.has(id) && !sources.has(id), 'Invalid or duplicate replacement source');
      sources.add(id);
    }
    const ring = facility.footprintLocal;
    assert(Array.isArray(ring) && ring.length >= 3 && ring.length <= 2048 && ring.every(pair), 'Invalid facility footprint');
    const bounds = ringBounds(ring);
    assert(bounds.minX >= -2500 && bounds.maxX <= 2500 && bounds.minZ >= -2500 && bounds.maxZ <= 2500
      && bounds.maxX > bounds.minX && bounds.maxZ > bounds.minZ, 'Facility footprint leaves Lidingo');
    const area = Math.abs(ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
    assert(area > .01, 'Facility footprint has no area');
    for (const id of facility.sourceBuildingIds) {
      const source = bySource.get(id).ring;
      assert(Array.isArray(source) && source.length >= 3 && source.every(pair), 'Replacement source footprint is unavailable');
      const sourceBounds = ringBounds(source);
      assert(sourceBounds.minX <= bounds.maxX + 20 && sourceBounds.maxX >= bounds.minX - 20
        && sourceBounds.minZ <= bounds.maxZ + 20 && sourceBounds.maxZ >= bounds.minZ - 20,
      'Facility leaves its replacement source footprint');
    }
    assert(pair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M)
      && facility.groundAnchorRh2000M >= 0 && facility.groundAnchorRh2000M < 200, 'Invalid facility ground anchor');
    const [x, z] = facility.groundAnchorLocal;
    assert(x >= bounds.minX - 20 && x <= bounds.maxX + 20 && z >= bounds.minZ - 20 && z <= bounds.maxZ + 20,
      'Facility anchor leaves its footprint');
    assert(facility.placement === 'absolute-rh2000', 'Lidingo facilities must retain absolute RH2000 heights');
    const declared = facility.boundsLocalRh2000;
    assert(triple(declared?.min) && triple(declared?.max)
      && declared.min.every((v, i) => v <= declared.max[i])
      && declared.min[0] >= bounds.minX - 20 && declared.max[0] <= bounds.maxX + 20
      && declared.min[2] >= bounds.minZ - 20 && declared.max[2] <= bounds.maxZ + 20
      && declared.min[1] >= -10 && declared.max[1] < 220,
    'Invalid facility bounds');
    assert(facility.evidence && typeof facility.evidence === 'object' && !Array.isArray(facility.evidence),
      'Missing facility source evidence');
    assert(typeof facility.excludeVegetation === 'boolean',
      'Invalid facility vegetation policy');
    ids.add(facility.id); names.add(facility.nodeName);
  }
  assert(LIDINGO_PRIMARY_BUILDING_IDS.every(id => sources.has(id)), 'Facilities inventory must include all five primary buildings');
  assert(ids.has('courtyard'), 'Facilities inventory must include the courtyard');
  return manifest;
}

export function lidingoFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres = 0 }) {
  const terrain = terrainH(...facility.groundAnchorLocal);
  assert(Number.isFinite(terrain), 'Facility ground is unavailable');
  // Export bakes Blender's +25 m datum restoration into the GLB positions.
  // Only the engine bridge is added here; never restore that 25 m a second time.
  const anchored = !v2Active;
  assert(anchored || Number.isFinite(verticalDatumOffsetMetres), 'Facility height bridge is unavailable');
  const shift = anchored ? terrain - facility.groundAnchorRh2000M : verticalDatumOffsetMetres;
  assert(Number.isFinite(shift) && Math.abs(shift) < 80, 'Facility vertical placement is implausible');
  return { shift, mode: anchored ? 'terrain-anchor' : 'absolute-rh2000', terrainHeight: terrain,
    sourceGroundRh2000M: facility.groundAnchorRh2000M,
    groundResidualMetres: facility.groundAnchorRh2000M + shift - terrain };
}

function disposeObject(root) {
  if (!root?.isObject3D) return;
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
  assert(url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/?$/, '/') + 'models/lidingo/'),
    'Facilities asset leaves its course directory');
  return url.href;
}

function validateGlbBytes(buffer) {
  assert(buffer.byteLength > 20, 'Facilities GLB is empty');
  const view = new DataView(buffer);
  assert(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === buffer.byteLength, 'Invalid facilities GLB header');
  const length = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a && length > 0 && 20 + length <= buffer.byteLength,
    'Invalid facilities GLB JSON chunk');
  const document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim());
  assert(!document.buffers?.some(b => b.uri) && !document.images?.length && !document.textures?.length && !document.animations?.length
    && !document.skins?.length && !document.cameras?.length && !document.extensions?.KHR_lights_punctual,
  'Facilities GLB must contain static geometry and procedural materials only');
}

async function defaultParseGlb(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

export async function loadLidingoFacilities({ THREE, scene, courseSlug, buildings, terrainH,
  v2Active, verticalDatumOffsetMetres, baseUrl, signal, isCurrentCourse = () => true,
  fetchImpl = globalThis.fetch, parseGlb = defaultParseGlb, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set(), facilityFootprints = [];
  let root = null, disposed = false;
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], replacesRangeFacilities: false, replacesCourtyard: false,
    facilities: [], meshes: 0, triangles: 0 };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort();
    disposeObject(root);
    root = null;
    replacedBuildingIds.clear();
    facilityFootprints.length = 0;
    Object.assign(report, { status: 'disposed', replacedBuildingIds: [], replacesRangeFacilities: false, replacesCourtyard: false });
  };
  const current = () => assert(!controller.signal.aborted && isCurrentCourse(), 'Facilities load was cancelled');
  const isFacilityInterior = (x, z, margin = .2) => facilityFootprints.some(f => ringSD(x, z, f.ring) <= margin);
  try {
    current();
    assert(courseSlug === 'lidingo', 'Facilities belong to another course');
    const response = await fetchImpl(localAssetUrl('models/lidingo/facilities-v1.json', baseUrl), { signal: controller.signal });
    assert(response.ok, 'Facilities manifest could not be loaded');
    const manifest = validateLidingoFacilitiesManifest(await response.json(), { courseSlug, buildings });
    current();
    const assetResponse = await fetchImpl(localAssetUrl(manifest.asset.url, baseUrl), { signal: controller.signal });
    assert(assetResponse.ok, 'Facilities geometry could not be loaded');
    const buffer = await assetResponse.arrayBuffer();
    assert(buffer.byteLength === manifest.asset.bytes, 'Facilities byte count mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
      v => v.toString(16).padStart(2, '0')).join('');
    assert(hash === manifest.asset.sha256, 'Facilities checksum mismatch');
    validateGlbBytes(buffer);
    current();
    const gltf = await parseGlb(buffer);
    root = gltf.scene;
    assert(root?.isObject3D, 'Facilities scene is unavailable');
    current();
    root.updateMatrixWorld(true);
    const byName = new Map(), ownedMeshes = new Set();
    root.traverse(object => {
      const name = object.userData?.name ?? object.name;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(object);
      assert(!object.isSkinnedMesh && !object.isInstancedMesh && !object.isLight && !object.isCamera,
        'Facilities require static meshes');
    });
    for (const facility of manifest.facilities) {
      const matches = byName.get(facility.nodeName) || [];
      assert(matches.length === 1, 'Facility node is missing or duplicated: ' + facility.nodeName);
      const object = matches[0];
      assert(object.parent === root, 'Facilities need independent top-level nodes');
      assert(object.userData.facilityId === facility.id && sameIds(object.userData.sourceBuildingIds, facility.sourceBuildingIds),
        'Facilities source node mismatch');
      let meshes = 0, triangles = 0;
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        assert(!ownedMeshes.has(mesh), 'Facilities share mesh ownership');
        ownedMeshes.add(mesh);
        const positions = mesh.geometry?.getAttribute('position');
        assert(positions && positions.count >= 3, 'Empty facility mesh');
        for (let i = 0; i < positions.count; i++) assert(Number.isFinite(positions.getX(i))
          && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)), 'Non-finite facility vertex');
        const normals = mesh.geometry.getAttribute('normal');
        if (normals) for (let i = 0; i < normals.count; i++) assert(Number.isFinite(normals.getX(i))
          && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)), 'Non-finite facility normal');
        const index = mesh.geometry.index;
        if (index) for (let i = 0; i < index.count; i++) assert(Number.isInteger(index.getX(i))
          && index.getX(i) >= 0 && index.getX(i) < positions.count, 'Invalid facility triangle index');
        const count = (index?.count ?? positions.count) / 3;
        assert(Number.isInteger(count) && count > 0, 'Invalid facility triangles');
        // Painted parking markings can have zero vertical extent. Their faces
        // must still span real area; a collapsed mesh must not suppress fallback.
        for (let i = 0; i < count * 3; i += 3) {
          const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1,
            c = index ? index.getX(i + 2) : i + 2;
          const ux = positions.getX(b) - positions.getX(a), uy = positions.getY(b) - positions.getY(a),
            uz = positions.getZ(b) - positions.getZ(a), vx = positions.getX(c) - positions.getX(a),
            vy = positions.getY(c) - positions.getY(a), vz = positions.getZ(c) - positions.getZ(a);
          assert(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 0,
            'Degenerate facility triangle');
        }
        meshes++; triangles += count;
        mesh.castShadow = true; mesh.receiveShadow = true;
      });
      assert(meshes > 0, 'Facility has no triangles');
      const bounds = new THREE.Box3().setFromObject(object), declared = facility.boundsLocalRh2000;
      assert(bounds.min.toArray().every((v, i) => Math.abs(v - declared.min[i]) <= .15)
        && bounds.max.toArray().every((v, i) => Math.abs(v - declared.max[i]) <= .15), 'Facility bounds do not match the manifest');
      const placement = lidingoFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres });
      object.position.y += placement.shift;
      object.userData.placement = placement;
      report.facilities.push({ id: facility.id, sourceBuildingIds: [...facility.sourceBuildingIds], nodeName: facility.nodeName,
        meshes, triangles, ...placement, boundsBeforePlacement: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
      report.meshes += meshes; report.triangles += triangles;
    }
    root.traverse(object => assert(!object.isMesh || ownedMeshes.has(object), 'Unowned geometry in facilities asset'));
    assert(report.triangles <= 750000, 'Facilities triangle budget exceeded');
    current();
    root.name = 'Lidingö authored facilities';
    root.userData = { ...root.userData, groundId: 'lidingo', assetSha256: hash, facilityCount: manifest.facilities.length };
    scene.add(root);
    root.updateMatrixWorld(true);
    current();
    for (const facility of manifest.facilities) {
      for (const id of facility.sourceBuildingIds) replacedBuildingIds.add(id);
      if (facility.excludeVegetation !== false) facilityFootprints.push({ id: facility.id, ring: facility.footprintLocal });
    }
    Object.assign(report, { status: 'loaded', assetSha256: hash, replacedBuildingIds: [...replacedBuildingIds],
      replacesRangeFacilities: manifest.replacesRangeFacilities, replacesCourtyard: true });
    return { report, replacedBuildingIds, facilityFootprints, isFacilityInterior, get root() { return root; }, dispose };
  } catch (error) {
    dispose();
    Object.assign(report, { status: 'fallback', reason: error instanceof Error ? error.message : 'Facilities unavailable',
      replacedBuildingIds: [], replacesRangeFacilities: false, replacesCourtyard: false, facilities: [], meshes: 0, triangles: 0 });
    return { report, replacedBuildingIds, facilityFootprints, isFacilityInterior, root: null, dispose };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
