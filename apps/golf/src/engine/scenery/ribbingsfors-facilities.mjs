/* Ribbingsfors' authored Blender facilities: one verified GLB in the course's own
 * EPSG:3006 local frame, installed atomically before the generic building batch.
 * The pack is authored directly in the grid frame (local metres ARE EPSG:3006
 * minus the origin, heights RH 2000), so a facility's mesh heights are absolute
 * and the runtime applies its height bridge exactly once -- which for this
 * ground is zero. A failed or cancelled load leaves every retained source
 * building standing, exactly as the Visby loader this mirrors. */
export const RIBBINGSFORS_CLUBHOUSE_SOURCE_ID = 'ribbingsfors-clubhouse-provisional';
const ORIGIN = Object.freeze({ easting: 448975.5, northing: 6536024.5 });
const MAX_BYTES = 32 * 1024 * 1024;
/* The published 1 m window is 2,048 m across, so a facility beyond +-1024 m
 * local would stand on ground this course never measured. */
const LIMIT = 1024;
const assert = (value, message) => { if (!value) throw new Error(message); };
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const finiteRing = ring => Array.isArray(ring) && ring.length >= 3 && ring.every(finitePair);
const sourceKey = facility => facility.sourceBuildingId ?? facility.sourceFeatureId;
const sourceField = facility => facility.sourceBuildingId ? 'sourceBuildingId' : 'sourceFeatureId';
const ringBounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
  minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const sourceRing = (facility, buildings) => facility.sourceBuildingId
  ? buildings.get(facility.sourceBuildingId)?.ring : facility.footprintLocal;

export function validateRibbingsforsFacilitiesManifest(manifest, { courseSlug, buildings }) {
  assert(courseSlug === 'ribbingsfors', 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === 'ribbingsfors', 'Invalid facilities manifest identity');
  assert(Array.isArray(manifest.courseSlugs) && manifest.courseSlugs.length === 1
    && manifest.courseSlugs[0] === 'ribbingsfors', 'Facilities course mismatch');
  const frame = manifest.coordinateFrame;
  assert(frame?.kind === 'epsg3006-local-rh2000' && frame.originEpsg3006?.easting === ORIGIN.easting
    && frame.originEpsg3006?.northing === ORIGIN.northing && frame.axes === 'east-up-south'
    && frame.heightDatum === 'RH2000', 'Facilities coordinate frame mismatch');
  assert(typeof manifest.asset?.url === 'string' && /^[a-f0-9]{64}$/.test(manifest.asset.sha256)
    && manifest.asset.url === `models/ribbingsfors/facilities-${manifest.asset.sha256}.glb`
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes <= MAX_BYTES,
  'Invalid facilities asset receipt');
  assert(Array.isArray(manifest.facilities) && manifest.facilities.length > 0 && manifest.facilities.length <= 128,
    'Invalid facilities inventory');
  assert(manifest.facilities.some(f => f.sourceBuildingId === RIBBINGSFORS_CLUBHOUSE_SOURCE_ID),
    'Facilities inventory must include the clubhouse');
  const bySource = new Map(buildings.map(b => [b.id, b]));
  const ids = new Set(), names = new Set(), sources = new Set();
  for (const facility of manifest.facilities) {
    assert(typeof facility.id === 'string' && facility.id.length > 0 && !ids.has(facility.id), 'Duplicate facility ID');
    assert(typeof facility.nodeName === 'string' && facility.nodeName.length > 0 && !names.has(facility.nodeName),
      'Duplicate facility node');
    const source = sourceKey(facility);
    assert([facility.sourceBuildingId, facility.sourceFeatureId].filter(value => value !== undefined).length === 1
      && typeof source === 'string' && source.length > 0 && !sources.has(source), 'Invalid facility source');
    if (facility.sourceBuildingId) assert(bySource.has(source), 'Replacement building is unavailable');
    const ring = sourceRing(facility, bySource);
    assert(finiteRing(ring), 'Facility footprint is unavailable');
    const bounds = ringBounds(ring);
    assert(bounds.minX >= -LIMIT && bounds.maxX <= LIMIT && bounds.minZ >= -LIMIT && bounds.maxZ <= LIMIT,
      'Facility footprint leaves Ribbingsfors');
    assert(finitePair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M),
      'Invalid facility ground anchor');
    assert(['absolute-rh2000', 'terrain-anchor'].includes(facility.placement), 'Invalid facility placement');
    const [x, z] = facility.groundAnchorLocal;
    assert(x >= bounds.minX - 20 && x <= bounds.maxX + 20 && z >= bounds.minZ - 20 && z <= bounds.maxZ + 20,
      'Facility anchor leaves its source footprint');
    ids.add(facility.id); names.add(facility.nodeName); sources.add(source);
  }
  const suppressed = manifest.suppressedSourceBuildingIds ?? [];
  assert(Array.isArray(suppressed) && suppressed.length <= 64, 'Invalid suppressed building list');
  for (const entry of suppressed) {
    assert(typeof entry?.id === 'string' && typeof entry.reason === 'string' && entry.reason.length > 0,
      'A suppressed source building needs an id and a reason');
    assert(bySource.has(entry.id), 'Suppressed building is unavailable');
    assert(!sources.has(entry.id), 'A replaced building cannot also be suppressed');
  }
  return manifest;
}

export function ribbingsforsFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres }) {
  const terrain = terrainH(...facility.groundAnchorLocal);
  assert(Number.isFinite(terrain), 'Facility ground is unavailable');
  assert(Number.isFinite(verticalDatumOffsetMetres), 'Facility height bridge is unavailable');
  const anchored = !v2Active || facility.placement === 'terrain-anchor';
  const shift = anchored ? terrain - facility.groundAnchorRh2000M : verticalDatumOffsetMetres;
  assert(Number.isFinite(shift) && Math.abs(shift) < 40, 'Facility vertical placement is implausible');
  return { shift, mode: anchored ? 'terrain-anchor' : 'absolute-rh2000', terrainHeight: terrain,
    sourceGroundRh2000M: facility.groundAnchorRh2000M,
    groundResidualMetres: facility.groundAnchorRh2000M + shift - terrain };
}

/** Roof footprints only: the range mats, dividers and the picnic table must
 * never clear a woodland or a scatter, and the clubhouse's own source ring
 * already excludes what stands on it. */
export function roofFootprints(manifest, buildings) {
  const bySource = new Map(buildings.map(b => [b.id, b]));
  return manifest.facilities.filter(f => f.kind === 'roof').map(f => ({ id: f.id, ring: sourceRing(f, bySource) }))
    .filter(f => finiteRing(f.ring));
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
  assert(url.origin === base.origin
    && url.pathname.startsWith(base.pathname.replace(/\/?$/, '/') + 'models/ribbingsfors/'),
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
    && !document.skins?.length && !document.cameras?.length && !document.extensions?.KHR_lights_punctual,
  'Facilities GLB must contain static geometry and procedural materials only');
}

async function defaultParseGlb(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

export async function loadRibbingsforsFacilities({ THREE, scene, courseSlug, buildings, terrainH,
  v2Active, verticalDatumOffsetMetres, baseUrl, signal, isCurrentCourse = () => true,
  fetchImpl = globalThis.fetch, parseGlb = defaultParseGlb, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set();
  let root = null, disposed = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], suppressedBuildingIds: [],
    facilities: [], meshes: 0, triangles: 0, replacesRangeFacilities: false };
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
    assert(courseSlug === 'ribbingsfors', 'Facilities belong to another course');
    const response = await fetchImpl(localAssetUrl('models/ribbingsfors/facilities-v1.json', baseUrl), { signal: controller.signal });
    assert(response.ok, 'Facilities manifest could not be loaded');
    const manifest = validateRibbingsforsFacilitiesManifest(await response.json(), { courseSlug, buildings });
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
    const byName = new Map(), bySource = new Map(buildings.map(b => [b.id, b]));
    root.traverse(object => {
      // GLTFLoader sanitizes Object3D.name for animation bindings and keeps the
      // exact authored node name in userData.
      const authoredName = object.userData?.name ?? object.name;
      if (!byName.has(authoredName)) byName.set(authoredName, []);
      byName.get(authoredName).push(object);
      assert(!object.isSkinnedMesh && !object.isInstancedMesh && !object.isLight && !object.isCamera,
        'Facilities require static meshes');
    });
    const ownedMeshes = new Set();
    for (const facility of manifest.facilities) {
      const matches = byName.get(facility.nodeName) || [];
      assert(matches.length === 1, 'Facilities node is missing or duplicated: ' + facility.nodeName);
      const object = matches[0];
      assert(object !== root && object.userData?.[sourceField(facility)] === sourceKey(facility),
        'Facilities source node mismatch');
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
        meshes++;
        triangles += (mesh.geometry.index?.count ?? positions.count) / 3;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      assert(meshes > 0 && Number.isInteger(triangles) && triangles > 0, 'Facility has no triangles');
      const bounds = new THREE.Box3().setFromObject(object), footprint = ringBounds(sourceRing(facility, bySource));
      assert(bounds.min.x >= footprint.minX - 30 && bounds.max.x <= footprint.maxX + 30
        && bounds.min.z >= footprint.minZ - 30 && bounds.max.z <= footprint.maxZ + 30
        && bounds.min.y > 40 && bounds.max.y < 140 && bounds.max.y - bounds.min.y > .01,
      'Facility bounds leave their source footprint');
      const placement = ribbingsforsFacilityVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres });
      object.position.y += placement.shift;
      object.userData.facilityId = facility.id;
      object.userData.placement = placement;
      report.facilities.push({ id: facility.id, [sourceField(facility)]: sourceKey(facility), nodeName: facility.nodeName,
        kind: facility.kind, meshes, triangles, ...placement,
        boundsBeforePlacement: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
      report.meshes += meshes;
      report.triangles += triangles;
    }
    root.traverse(object => assert(!object.isMesh || ownedMeshes.has(object), 'Unowned geometry in facilities asset'));
    assert(report.triangles <= 750000, 'Facilities triangle budget exceeded');
    current();
    root.name = 'Ribbingsfors authored facilities';
    root.userData = { ...root.userData, groundId: 'ribbingsfors', assetSha256: hash, facilityCount: manifest.facilities.length };
    scene.add(root);
    root.updateMatrixWorld(true);
    for (const facility of manifest.facilities) if (facility.sourceBuildingId) replacedBuildingIds.add(facility.sourceBuildingId);
    for (const entry of manifest.suppressedSourceBuildingIds ?? []) replacedBuildingIds.add(entry.id);
    report.status = 'loaded';
    report.assetSha256 = hash;
    report.replacedBuildingIds = [...replacedBuildingIds];
    report.suppressedBuildingIds = (manifest.suppressedSourceBuildingIds ?? []).map(entry => entry.id);
    report.replacesRangeFacilities = manifest.replacesRangeFacilities === true;
    report.limitations = manifest.evidence?.architecturalHeights ?? null;
    return { report, replacedBuildingIds, root, dispose, facilityFootprints: roofFootprints(manifest, buildings) };
  } catch (error) {
    dispose();
    Object.assign(report, { status: 'fallback', reason: error instanceof Error ? error.message : 'Facilities unavailable',
      replacedBuildingIds: [], suppressedBuildingIds: [], facilities: [], meshes: 0, triangles: 0,
      replacesRangeFacilities: false });
    return { report, replacedBuildingIds, root: null, dispose, facilityFootprints: [] };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
