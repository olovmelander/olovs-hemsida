/* Authored Johannesberg architecture arrives as one verified, self-contained
 * GLB. The generic batch is skipped only after every replacement is installed.
 * Exported positions already use the pack's horizontal frame and absolute
 * RH2000 heights; each building receives one rigid vertical placement. */
export const JOHANNESBERG_FACILITY_SOURCE_IDS = Object.freeze([
  'w296165889', 'w296165891', 'w296165892', 'w296165893', 'w296165894',
  'w296165896', 'w296165897', 'w296165898', 'w296165899', 'w296165900',
  'w296165901', 'w296165903', 'w296165904', 'w296165905', 'w296165906',
  'w296165907', 'w296165908', 'w296165909', 'w378922988', 'w426174582',
  'trace-tower', 'trace-range-shelter',
]);
const SLUGS = ['johannesberg', 'johannesberg-9'];
const MAX_BYTES = 32 * 1024 * 1024;
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function validateJohannesbergFacilitiesManifest(manifest, { courseSlug, buildings }) {
  assert(SLUGS.includes(courseSlug), 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === 'johannesberg', 'Invalid facilities manifest identity');
  assert(Array.isArray(manifest.courseSlugs) && manifest.courseSlugs.includes(courseSlug)
    && manifest.courseSlugs.every(s => SLUGS.includes(s)), 'Facilities course mismatch');
  const f = manifest.coordinateFrame;
  assert(f?.kind === 'legacy-local-rh2000' && f.originWgs84?.lat === 59.72733
    && f.originWgs84?.lon === 18.19202 && f.mPerLat === 111320 && f.mPerLon === 56118.16,
  'Facilities coordinate frame mismatch');
  assert(typeof manifest.asset?.url === 'string' && /^[a-f0-9]{64}$/.test(manifest.asset.sha256)
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes <= MAX_BYTES,
  'Invalid facilities asset receipt');
  assert(Array.isArray(manifest.facilities) && manifest.facilities.length === JOHANNESBERG_FACILITY_SOURCE_IDS.length,
    'Incomplete facilities replacement inventory');
  const bySource = new Map(buildings.map(b => [b.id, b]));
  const names = new Set(), ids = new Set(), sources = new Set();
  for (const facility of manifest.facilities) {
    assert(typeof facility.id === 'string' && facility.id.length > 0 && !ids.has(facility.id), 'Duplicate facility ID');
    assert(typeof facility.nodeName === 'string' && facility.nodeName.length > 0 && !names.has(facility.nodeName), 'Duplicate facility node');
    assert(JOHANNESBERG_FACILITY_SOURCE_IDS.includes(facility.sourceBuildingId)
      && bySource.has(facility.sourceBuildingId) && !sources.has(facility.sourceBuildingId), 'Invalid replacement building ID');
    assert(finitePair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M), 'Invalid facility ground anchor');
    assert(['absolute-rh2000', 'terrain-anchor'].includes(facility.placement), 'Invalid facility placement');
    const ring = bySource.get(facility.sourceBuildingId).ring;
    assert(Array.isArray(ring) && ring.length >= 3 && ring.every(finitePair), 'Replacement footprint is unavailable');
    const [x, z] = facility.groundAnchorLocal;
    assert(x >= Math.min(...ring.map(p => p[0])) - 20 && x <= Math.max(...ring.map(p => p[0])) + 20
      && z >= Math.min(...ring.map(p => p[1])) - 20 && z <= Math.max(...ring.map(p => p[1])) + 20,
    'Facility anchor leaves its source footprint');
    ids.add(facility.id); names.add(facility.nodeName); sources.add(facility.sourceBuildingId);
  }
  return manifest;
}

export function facilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres }) {
  const [x, z] = facility.groundAnchorLocal;
  const terrain = terrainH(x, z);
  assert(Number.isFinite(terrain), 'Facility ground is unavailable');
  assert(Number.isFinite(verticalDatumOffsetMetres), 'Facility height bridge is unavailable');
  const anchored = !v2Active || facility.placement === 'terrain-anchor';
  const shift = anchored ? terrain - facility.groundAnchorRh2000M : verticalDatumOffsetMetres;
  assert(Number.isFinite(shift) && Math.abs(shift) < 40, 'Facility vertical placement is implausible');
  return { shift, mode: anchored ? 'terrain-anchor' : 'absolute-rh2000', terrainHeight: terrain,
    sourceGroundRh2000M: facility.groundAnchorRh2000M,
    groundResidualMetres: facility.groundAnchorRh2000M + shift - terrain };
}

export function disposeFacilityObject(root) {
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
  assert(url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/?$/, '/') + 'models/johannesberg/'),
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
  assert(!document.buffers?.some(b => b.uri) && !document.images?.length && !document.animations?.length
    && !document.skins?.length, 'Facilities GLB must contain static geometry and procedural materials only');
}

async function defaultParseGlb(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

/** Failure returns an empty replacement set so every generic building survives. */
export async function loadJohannesbergFacilities({ THREE, scene, courseSlug, buildings, terrainH,
  v2Active, verticalDatumOffsetMetres, baseUrl, signal, isCurrentCourse = () => true,
  fetchImpl = globalThis.fetch, parseGlb = defaultParseGlb, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set();
  let root = null, disposed = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], facilities: [], meshes: 0, triangles: 0 };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort();
    disposeFacilityObject(root);
    root = null;
    replacedBuildingIds.clear();
  };
  const current = () => assert(!controller.signal.aborted && isCurrentCourse(), 'Facilities load was cancelled');
  try {
    current();
    assert(SLUGS.includes(courseSlug), 'Facilities belong to another course');
    const manifestUrl = localAssetUrl('models/johannesberg/facilities-v1.json', baseUrl);
    const response = await fetchImpl(manifestUrl, { signal: controller.signal });
    assert(response.ok, 'Facilities manifest could not be loaded');
    const manifest = validateJohannesbergFacilitiesManifest(await response.json(), { courseSlug, buildings });
    current();
    const assetResponse = await fetchImpl(localAssetUrl(manifest.asset.url, baseUrl), { signal: controller.signal });
    assert(assetResponse.ok, 'Facilities geometry could not be loaded');
    const buffer = await assetResponse.arrayBuffer();
    assert(buffer.byteLength === manifest.asset.bytes, 'Facilities byte count mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), v => v.toString(16).padStart(2, '0')).join('');
    assert(hash === manifest.asset.sha256, 'Facilities checksum mismatch');
    validateGlbBytes(buffer);
    current();
    const gltf = await parseGlb(buffer);
    root = gltf.scene;
    assert(root?.isObject3D, 'Facilities scene is unavailable');
    current();
    root.updateMatrixWorld(true);
    const byName = new Map(), bySource = new Map(buildings.map(b => [b.id, b]));
    root.traverse(object => {
      if (!byName.has(object.name)) byName.set(object.name, []);
      byName.get(object.name).push(object);
      assert(!object.isSkinnedMesh && !object.isInstancedMesh, 'Facilities require static meshes');
    });
    const ownedMeshes = new Set();
    for (const facility of manifest.facilities) {
      const matches = byName.get(facility.nodeName) || [];
      assert(matches.length === 1, 'Facilities node is missing or duplicated: ' + facility.nodeName);
      const object = matches[0];
      assert(object !== root && object.userData?.sourceBuildingId === facility.sourceBuildingId, 'Facilities source node mismatch');
      assert(object.parent === root, 'Facilities need independent top-level building nodes');
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
        if (normals) for (let i = 0; i < normals.count; i++) assert(Number.isFinite(normals.getX(i))
          && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)), 'Non-finite facility normal');
        meshes++;
        triangles += (mesh.geometry.index?.count ?? positions.count) / 3;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      assert(meshes > 0 && Number.isInteger(triangles) && triangles > 0, 'Facility has no triangles');
      const bounds = new THREE.Box3().setFromObject(object);
      const ring = bySource.get(facility.sourceBuildingId).ring;
      assert(bounds.min.x >= Math.min(...ring.map(p => p[0])) - 30 && bounds.max.x <= Math.max(...ring.map(p => p[0])) + 30
        && bounds.min.z >= Math.min(...ring.map(p => p[1])) - 30 && bounds.max.z <= Math.max(...ring.map(p => p[1])) + 30
        && bounds.min.y > -10 && bounds.max.y < 100 && bounds.max.y - bounds.min.y > .2, 'Facility bounds leave their source building');
      const placement = facilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres });
      object.position.y += placement.shift;
      object.userData.facilityId = facility.id;
      object.userData.placement = placement;
      report.facilities.push({ id: facility.id, sourceBuildingId: facility.sourceBuildingId, nodeName: facility.nodeName,
        meshes, triangles, ...placement, boundsBeforePlacement: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
      report.meshes += meshes;
      report.triangles += triangles;
    }
    root.traverse(object => assert(!object.isMesh || ownedMeshes.has(object), 'Unowned geometry in facilities asset'));
    assert(report.triangles <= 750000, 'Facilities triangle budget exceeded');
    current();
    root.name = 'Johannesberg authored facilities';
    root.userData = { ...root.userData, groundId: 'johannesberg', assetSha256: hash, facilityCount: manifest.facilities.length };
    scene.add(root);
    root.updateMatrixWorld(true);
    for (const facility of manifest.facilities) replacedBuildingIds.add(facility.sourceBuildingId);
    report.status = 'loaded';
    report.assetSha256 = hash;
    report.replacedBuildingIds = [...replacedBuildingIds];
    return { report, replacedBuildingIds, root, dispose };
  } catch (error) {
    dispose();
    report.status = 'fallback';
    report.reason = error instanceof Error ? error.message : 'Facilities unavailable';
    report.replacedBuildingIds = [];
    report.facilities = [];
    report.meshes = 0;
    report.triangles = 0;
    return { report, replacedBuildingIds, root: null, dispose };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
