/* Display architecture is an independently reviewed asset. Source footprints
 * and measured roofs remain untouched, including when loading an asset fails.
 * GLB coordinates are metric east/up/south about an explicit EPSG3006/RH2000
 * anchor. Main's building Y is absolute RH2000, not the terrain-frame offset. */
const SHA256 = /^[a-f0-9]{64}$/;
const finiteTuple = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');

export async function sourceFootprintSha256(building) {
  if (!Array.isArray(building?.ring) || building.ring.length < 3 || building.ring.some(point => !finiteTuple(point, 2))) {
    throw new Error('Authored building requires a finite source footprint');
  }
  return digest(new TextEncoder().encode(JSON.stringify(building.ring)));
}

/** Validate before GLTFLoader can fetch a nested URI or install scene extras. */
export function inspectBuildingGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error('Building asset is not a GLB');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('Invalid building GLB header');
  }
  const chunks = [];
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('Truncated building GLB chunk');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || offset + length > buffer.byteLength) throw new Error('Invalid building GLB chunk length');
    chunks.push({ type, bytes: new Uint8Array(buffer, offset, length) }); offset += length;
  }
  if (chunks.length !== 2 || chunks[0].type !== 0x4e4f534a || chunks[1].type !== 0x004e4942) {
    throw new Error('Building GLB requires one JSON and one binary chunk');
  }
  const json = JSON.parse(new TextDecoder().decode(chunks[0].bytes));
  if (json.asset?.version !== '2.0') throw new Error('Building GLB must use glTF 2.0');
  function rejectUris(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') throw new Error('Building GLB must not reference external or embedded URI resources');
      rejectUris(child);
    }
  }
  rejectUris(json);
  for (const field of ['images', 'textures', 'animations', 'skins', 'cameras']) {
    if (json[field]?.length) throw new Error(`Building GLB must be static geometry without ${field}`);
  }
  if (json.extensions?.KHR_lights_punctual) throw new Error('Building GLB must not add lights');
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || !Number.isSafeInteger(json.buffers[0].byteLength)
    || json.buffers[0].byteLength <= 0 || chunks[1].bytes.length < json.buffers[0].byteLength
    || chunks[1].bytes.length - json.buffers[0].byteLength > 3) throw new Error('Invalid building GLB binary buffer');
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives || []) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Building GLB supports triangle meshes only');
    if (primitive.targets?.length) throw new Error('Building GLB must not contain morph targets');
  }
  return json;
}

function descriptorTransform(descriptor) {
  if (typeof descriptor?.buildingId !== 'string' || !descriptor.buildingId || !SHA256.test(descriptor.sourceFootprintSha256 || '')) {
    throw new Error('Authored building requires its exact source ID and footprint checksum');
  }
  const asset = descriptor.asset;
  if (!SHA256.test(asset?.sha256 || '') || !Number.isSafeInteger(asset?.bytes) || asset.bytes <= 0
    || typeof asset.url !== 'string' || !/^[a-zA-Z0-9_/-]+\.glb$/.test(asset.url)
    || asset.url.startsWith('/') || asset.url.split('/').includes('..') || !asset.url.endsWith(`/${asset.sha256}.glb`)) {
    throw new Error('Authored building requires a relative content-addressed GLB URL, size and checksum');
  }
  if (!finiteTuple(descriptor.anchorEpsg3006RH2000, 3) || !finiteTuple(descriptor.courseOriginEpsg3006, 2)
    || !Number.isFinite(descriptor.rotationYRadians) || descriptor.scale !== 1) {
    throw new Error('Authored building requires an explicit metric anchor, course origin, yaw and unit scale');
  }
  const [easting, northing, height] = descriptor.anchorEpsg3006RH2000;
  const [originEasting, originNorthing] = descriptor.courseOriginEpsg3006;
  return { position: [easting - originEasting, height, originNorthing - northing], rotationYRadians: descriptor.rotationYRadians, scale: 1 };
}

async function parseBuildingGlb(bytes) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(bytes, '');
}

function sceneInventory(object) {
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let meshes = 0, vertices = 0, triangles = 0;
  object.updateMatrixWorld(true);
  object.traverse(node => {
    if (node.isLight || node.isCamera || node.isSkinnedMesh || node.isInstancedMesh) throw new Error('Unsupported authored building scene object');
    if (!node.isMesh) return;
    const position = node.geometry?.attributes?.position, index = node.geometry?.index;
    if (!position || position.itemSize !== 3 || !position.count || (index?.count ?? position.count) % 3) {
      throw new Error('Authored building requires nonempty triangle position buffers');
    }
    const matrix = node.matrixWorld.elements;
    if (!matrix.every(Number.isFinite)) throw new Error('Nonfinite authored building transform');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const world = [matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]];
      if (!world.every(Number.isFinite)) throw new Error('Nonfinite authored building vertex');
      for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = Math.min(bounds.min[axis], world[axis]); bounds.max[axis] = Math.max(bounds.max[axis], world[axis]); }
    }
    for (let i = 0; i < (index?.count || 0); i++) {
      const value = index.getX(i);
      if (!Number.isInteger(value) || value < 0 || value >= position.count) throw new Error('Invalid authored building triangle index');
    }
    node.castShadow = true; node.receiveShadow = true;
    node.geometry.computeBoundingBox(); node.geometry.computeBoundingSphere();
    meshes++; vertices += position.count; triangles += (index?.count ?? position.count) / 3;
  });
  if (!meshes) throw new Error('Authored building has no renderable meshes');
  return { bounds, meshes, vertices, triangles };
}

/** Successful entries alone may replace the source renderer. Each asset is
 * fetched/decoded once per preparation; its scene is cloned for each placement.
 * Errors are explicit diagnostics with a source fallback, never hidden geometry. */
export async function loadAuthoredBuildings({ descriptors = [], buildings = [], baseUrl, sourceMode = false,
  fetchFn = globalThis.fetch, parseGlb = parseBuildingGlb } = {}) {
  const byBuildingId = new Map(), diagnostics = [], cache = new Map();
  if (!Array.isArray(descriptors)) return { byBuildingId, diagnostics: [{ status: 'fallback', error: 'Authored building descriptors must be an array' }] };
  const counts = new Map();
  for (const descriptor of descriptors) counts.set(descriptor?.buildingId, (counts.get(descriptor?.buildingId) || 0) + 1);
  const source = new Map(buildings.map(building => [building.id, building]));
  for (const descriptor of descriptors) {
    const record = { buildingId: descriptor?.buildingId ?? null, asset: descriptor?.asset ?? null,
      appearanceStatus: descriptor?.appearanceStatus ?? 'authored-display-model', evidence: descriptor?.evidence ?? [],
      sourceFootprintUnchanged: true, sourceRoofUnchanged: true, status: sourceMode ? 'source-view' : 'fallback' };
    diagnostics.push(record);
    if (sourceMode) continue;
    try {
      const transform = descriptorTransform(descriptor);
      if (counts.get(descriptor.buildingId) !== 1) throw new Error('Duplicate authored building descriptor');
      const building = source.get(descriptor.buildingId);
      if (!building) throw new Error('Authored building source ID is absent');
      const footprintHash = await sourceFootprintSha256(building);
      if (footprintHash !== descriptor.sourceFootprintSha256) throw new Error('Authored building source footprint checksum differs');
      const url = new URL(descriptor.asset.url, baseUrl).href;
      const key = `${url}:${descriptor.asset.sha256}:${descriptor.asset.bytes}`;
      if (!cache.has(key)) cache.set(key, (async () => {
        const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Authored building HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== descriptor.asset.bytes) throw new Error('Authored building byte count differs');
        if (await digest(bytes) !== descriptor.asset.sha256) throw new Error('Authored building asset checksum differs');
        inspectBuildingGlb(bytes);
        const gltf = await parseGlb(bytes);
        if (!gltf?.scene || gltf.animations?.length) throw new Error('Authored building did not decode a static scene');
        return gltf.scene;
      })());
      const template = await cache.get(key);
      const { Group } = await import('three/webgpu');
      const object = new Group();
      object.name = `authored-building:${descriptor.buildingId}`;
      object.position.fromArray(transform.position);
      object.rotation.y = transform.rotationYRadians;
      object.add(template.clone(true));
      const inventory = sceneInventory(object);
      Object.assign(record, { status: 'loaded', sourceFootprintSha256: footprintHash, transform,
        anchorEpsg3006RH2000: descriptor.anchorEpsg3006RH2000,
        sourceRoofTriangles: building.roofSurface?.triangleIndices?.length / 3 || 0, ...inventory });
      object.userData = { tag: 'authored-building', buildingId: descriptor.buildingId, assetSha256: descriptor.asset.sha256,
        appearanceStatus: record.appearanceStatus, sourceFootprintUnchanged: true, sourceRoofUnchanged: true };
      byBuildingId.set(descriptor.buildingId, { object, details: record });
    } catch (error) { record.error = String(error?.message || error); }
  }
  return { byBuildingId, diagnostics };
}
