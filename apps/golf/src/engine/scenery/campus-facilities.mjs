/* One loader for every ground's Blender campus (Bro Hof first; the older per-course
   loaders keep their own contracts). The asset is authored in the ground's EPSG:3006
   local metres with absolute RH 2000 heights (tools/facility-pipeline, docs/
   course-production-workflow.md), and is taken whole or not at all: a missing, stale
   or cancelled asset leaves the course's ordinary buildings drawn. */
import { withinRing } from '../geom.js';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_TRIANGLES = 250_000;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const triple = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);
const ringBounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
  minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const ringArea = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/** The manifest names this ground, this frame and one hash-named GLB, and replaces only mapped buildings. */
export function validateCampusManifest(manifest, { campus, courseSlug, buildings }) {
  assert(campus.courseSlugs.includes(courseSlug), 'Facilities belong to another course');
  assert(manifest?.schemaVersion === 1 && manifest.groundId === campus.groundId && sameIds(manifest.courseSlugs, campus.courseSlugs),
    'Invalid facilities manifest identity');
  const frame = manifest.coordinateFrame;
  assert(frame?.kind === 'epsg3006-local-rh2000' && frame.originEasting === campus.originEasting
    && frame.originNorthing === campus.originNorthing && frame.axes === 'east-up-south' && frame.heightDatum === 'RH2000',
  'Facilities coordinate frame mismatch');
  assert(/^[a-f0-9]{64}$/.test(manifest.asset?.sha256)
    && manifest.asset.url === `models/${campus.groundId}/facilities-${manifest.asset.sha256}.glb`
    && Number.isInteger(manifest.asset.bytes) && manifest.asset.bytes > 20 && manifest.asset.bytes <= MAX_BYTES,
  'Invalid facilities asset receipt');
  assert(Array.isArray(manifest.facilities) && manifest.facilities.length > 0 && manifest.facilities.length <= 128,
    'Invalid facilities inventory');
  assert(typeof manifest.replacesRangeFacilities === 'boolean' && typeof manifest.replacesCourtyard === 'boolean',
    'Missing replacement policy');
  assert(Array.isArray(buildings), 'Course building inventory is unavailable');
  const bySource = new Map(buildings.map(b => [b.id, b]));
  const ids = new Set(), names = new Set(), sources = new Set(), reach = campus.halfExtent ?? 2500;
  for (const facility of manifest.facilities) {
    assert(typeof facility.id === 'string' && facility.id && !ids.has(facility.id), 'Duplicate facility ID');
    assert(typeof facility.nodeName === 'string' && facility.nodeName && !names.has(facility.nodeName), 'Duplicate facility node');
    ids.add(facility.id);
    names.add(facility.nodeName);
    const ring = facility.footprintLocal;
    assert(Array.isArray(ring) && ring.length >= 3 && ring.length <= 2048 && ring.every(pair), 'Invalid facility footprint');
    const b = ringBounds(ring);
    assert(b.minX >= -reach && b.maxX <= reach && b.minZ >= -reach && b.maxZ <= reach && ringArea(ring) > .01,
      'Facility footprint leaves its ground or has no area');
    assert(Array.isArray(facility.sourceBuildingIds) && facility.sourceBuildingIds.length <= 16, 'Invalid facility source building IDs');
    for (const id of facility.sourceBuildingIds) {
      assert(typeof id === 'string' && bySource.has(id) && !sources.has(id), 'Invalid or duplicate replacement source');
      sources.add(id);
      const source = bySource.get(id).ring;
      assert(Array.isArray(source) && source.length >= 3 && source.every(pair), 'Replacement source footprint is unavailable');
      const s = ringBounds(source);
      assert(s.minX <= b.maxX + 5 && s.maxX >= b.minX - 5 && s.minZ <= b.maxZ + 5 && s.maxZ >= b.minZ - 5,
        'Facility leaves its replacement source footprint');
    }
    assert(pair(facility.groundAnchorLocal) && Number.isFinite(facility.groundAnchorRh2000M) && Math.abs(facility.groundAnchorRh2000M) < 1500,
      'Invalid facility ground anchor');
    const [x, z] = facility.groundAnchorLocal;
    assert(x >= b.minX - 20 && x <= b.maxX + 20 && z >= b.minZ - 20 && z <= b.maxZ + 20, 'Facility anchor leaves its footprint');
    assert(facility.placement === 'absolute-rh2000', 'Facilities must keep absolute RH2000 heights');
    const d = facility.boundsLocalRh2000;
    assert(triple(d?.min) && triple(d?.max) && d.min.every((v, i) => v <= d.max[i])
      && d.min[0] >= b.minX - 20 && d.max[0] <= b.maxX + 20 && d.min[2] >= b.minZ - 20 && d.max[2] <= b.maxZ + 20,
    'Invalid facility bounds');
    assert(facility.evidence && typeof facility.evidence === 'object' && !Array.isArray(facility.evidence), 'Missing facility source evidence');
    assert(typeof facility.excludeVegetation === 'boolean', 'Invalid facility vegetation policy');
  }
  assert((campus.requiredSources ?? []).every(id => sources.has(id)), 'Facilities inventory leaves out a required building');
  return manifest;
}

/** The asset's heights are the laser's own; only the engine's datum bridge is added. Off v2 terrain it stands on its anchor. */
export function campusVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres = 0 }) {
  const terrain = terrainH(...facility.groundAnchorLocal);
  assert(Number.isFinite(terrain), 'Facility ground is unavailable');
  assert(!v2Active || Number.isFinite(verticalDatumOffsetMetres), 'Facility height bridge is unavailable');
  const shift = v2Active ? verticalDatumOffsetMetres : terrain - facility.groundAnchorRh2000M;
  assert(Number.isFinite(shift) && Math.abs(shift) < 80, 'Facility vertical placement is implausible');
  return { shift, mode: v2Active ? 'absolute-rh2000' : 'terrain-anchor', terrainHeight: terrain,
    sourceGroundRh2000M: facility.groundAnchorRh2000M, groundResidualMetres: facility.groundAnchorRh2000M + shift - terrain };
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
  for (const owned of [geometries, textures, materials]) for (const item of owned) item.dispose();
}

function assetUrl(path, baseUrl, groundId) {
  const base = new URL(baseUrl), url = new URL(path, base);
  assert(url.origin === base.origin && url.pathname.startsWith(`${base.pathname.replace(/\/?$/, '/')}models/${groundId}/`),
    'Facilities asset leaves its ground directory');
  return url.href;
}

function assertStaticGlb(buffer) {
  assert(buffer.byteLength > 20, 'Facilities GLB is empty');
  const view = new DataView(buffer);
  assert(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === buffer.byteLength, 'Invalid facilities GLB header');
  const length = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a && length > 0 && 20 + length <= buffer.byteLength, 'Invalid facilities GLB JSON chunk');
  const document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim());
  assert(!document.buffers?.some(b => b.uri) && !document.images?.length && !document.textures?.length && !document.animations?.length
    && !document.skins?.length && !document.cameras?.length && !document.extensions?.KHR_lights_punctual,
  'Facilities GLB must contain static geometry and plain materials only');
}

async function defaultParseGlb(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

/** One mesh's triangles, every vertex finite and every face with an area. */
function meshTriangles(mesh) {
  const p = mesh.geometry?.getAttribute('position'), index = mesh.geometry?.index, n = mesh.geometry?.getAttribute('normal');
  assert(p && p.count >= 3, 'Empty facility mesh');
  for (const attribute of [p, n]) if (attribute) for (let i = 0; i < attribute.count; i++) {
    assert(Number.isFinite(attribute.getX(i) + attribute.getY(i) + attribute.getZ(i)), 'Non-finite facility vertex');
  }
  const count = (index?.count ?? p.count) / 3;
  assert(Number.isInteger(count) && count > 0, 'Invalid facility triangles');
  for (let i = 0; i < count * 3; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
    assert(a < p.count && b < p.count && c < p.count, 'Invalid facility triangle index');
    const ux = p.getX(b) - p.getX(a), uy = p.getY(b) - p.getY(a), uz = p.getZ(b) - p.getZ(a);
    const vx = p.getX(c) - p.getX(a), vy = p.getY(c) - p.getY(a), vz = p.getZ(c) - p.getZ(a);
    assert(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 0, 'Degenerate facility triangle');
  }
  return count;
}

/* `campus`: { groundId, courseSlugs, originEasting, originNorthing, name, requiredSources?, halfExtent? } */
export async function loadCampusFacilities(campus, { THREE, scene, courseSlug, buildings, terrainH, v2Active, verticalDatumOffsetMetres,
  baseUrl, signal, isCurrentCourse = () => true, fetchImpl = globalThis.fetch, parseGlb = defaultParseGlb, timeoutMs = 20000 }) {
  const replacedBuildingIds = new Set(), facilityFootprints = [];
  let root = null, disposed = false;
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const none = { replacedBuildingIds: [], replacesRangeFacilities: false, replacesCourtyard: false };
  const report = { status: 'loading', courseSlug, ...none, facilities: [], meshes: 0, triangles: 0 };
  const isFacilityInterior = (x, z, margin = .2) => facilityFootprints.some(f => withinRing(x, z, f.ring, margin));
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort();
    disposeObject(root);
    root = null;
    replacedBuildingIds.clear();
    facilityFootprints.length = 0;
    Object.assign(report, { status: 'disposed', ...none });
  };
  const current = () => assert(!controller.signal.aborted && isCurrentCourse(), 'Facilities load was cancelled');
  const fetched = async (path, what) => {
    const response = await fetchImpl(assetUrl(path, baseUrl, campus.groundId), { signal: controller.signal });
    assert(response.ok, `Facilities ${what} could not be loaded`);
    return response;
  };
  try {
    current();
    const manifest = validateCampusManifest(await (await fetched(`models/${campus.groundId}/facilities-v1.json`, 'manifest')).json(),
      { campus, courseSlug, buildings });
    current();
    const buffer = await (await fetched(manifest.asset.url, 'geometry')).arrayBuffer();
    assert(buffer.byteLength === manifest.asset.bytes, 'Facilities byte count mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), v => v.toString(16).padStart(2, '0')).join('');
    assert(hash === manifest.asset.sha256, 'Facilities checksum mismatch');
    assertStaticGlb(buffer);
    current();
    root = (await parseGlb(buffer)).scene;
    assert(root?.isObject3D, 'Facilities scene is unavailable');
    current();
    root.updateMatrixWorld(true);
    const byName = new Map(), owned = new Set();
    root.traverse(object => {
      assert(!object.isSkinnedMesh && !object.isInstancedMesh && !object.isLight && !object.isCamera, 'Facilities require static meshes');
      const name = object.userData?.name ?? object.name;
      byName.set(name, [...(byName.get(name) ?? []), object]);
    });
    for (const facility of manifest.facilities) {
      const matches = byName.get(facility.nodeName) ?? [];
      assert(matches.length === 1 && matches[0].parent === root, `Facility node is missing, duplicated or nested: ${facility.nodeName}`);
      const object = matches[0];
      assert(object.userData.facilityId === facility.id && sameIds([...(object.userData.sourceBuildingIds ?? [])], facility.sourceBuildingIds),
        'Facilities source node mismatch');
      let meshes = 0, triangles = 0;
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        assert(!owned.has(mesh), 'Facilities share mesh ownership');
        owned.add(mesh);
        triangles += meshTriangles(mesh);
        meshes++;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      assert(meshes > 0, 'Facility has no triangles');
      const bounds = new THREE.Box3().setFromObject(object), declared = facility.boundsLocalRh2000;
      assert(bounds.min.toArray().every((v, i) => Math.abs(v - declared.min[i]) <= .15)
        && bounds.max.toArray().every((v, i) => Math.abs(v - declared.max[i]) <= .15), 'Facility bounds do not match the manifest');
      const placement = campusVerticalPlacement(facility, { v2Active, terrainH, verticalDatumOffsetMetres });
      object.position.y += placement.shift;
      object.userData.placement = placement;
      report.facilities.push({ id: facility.id, nodeName: facility.nodeName, sourceBuildingIds: [...facility.sourceBuildingIds],
        meshes, triangles, ...placement });
      report.meshes += meshes;
      report.triangles += triangles;
    }
    root.traverse(object => assert(!object.isMesh || owned.has(object), 'Unowned geometry in facilities asset'));
    assert(report.triangles <= MAX_TRIANGLES, 'Facilities triangle budget exceeded');
    current();
    root.name = campus.name;
    root.userData = { ...root.userData, groundId: campus.groundId, assetSha256: hash, facilityCount: manifest.facilities.length };
    scene.add(root);
    root.updateMatrixWorld(true);
    for (const facility of manifest.facilities) {
      for (const id of facility.sourceBuildingIds) replacedBuildingIds.add(id);
      if (facility.excludeVegetation) facilityFootprints.push({ id: facility.id, ring: facility.footprintLocal });
    }
    Object.assign(report, { status: 'loaded', assetSha256: hash, replacedBuildingIds: [...replacedBuildingIds],
      replacesRangeFacilities: manifest.replacesRangeFacilities, replacesCourtyard: manifest.replacesCourtyard });
    return { report, replacedBuildingIds, facilityFootprints, isFacilityInterior, get root() { return root; }, dispose };
  } catch (error) {
    dispose();
    Object.assign(report, { status: 'fallback', reason: error instanceof Error ? error.message : 'Facilities unavailable', ...none,
      facilities: [], meshes: 0, triangles: 0 });
    return { report, replacedBuildingIds, facilityFootprints, isFacilityInterior, root: null, dispose };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
