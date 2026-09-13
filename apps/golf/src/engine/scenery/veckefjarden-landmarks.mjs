/* Photo-referenced Blender models shared by both Veckefjärden courses.
 * A source landmark is suppressed only after its own asset is verified/added.
 */
import { ringSD } from '../geom.js';

export const LANDMARK_SPECS = Object.freeze([
  { id: 'w104048726', nodeName: 'sjalevads-kyrka', anchor: [-3278.4, -905.3], file: 'sjalevads-kyrka-v1.glb' },
  { id: 'w70606159', nodeName: 'paradiskullen-k90', anchor: [1303.65, -493.1], file: 'paradiskullen-k90-v1.glb' },
]);
const SLUGS = ['veckefjarden', 'veckefjarden-korthalsbanan'];
const JUMP_FAR_BOX = [1344.8, -506, 43.2, 3.1, -.3, 0];
export function isReplacedLandmarkBox(box, replacedIds) {
  return !!replacedIds?.has('w70606159') && box.length === JUMP_FAR_BOX.length
    && box.every((n, i) => Math.abs(n - JUMP_FAR_BOX[i]) < .025);
}
export function isReplacedLandmarkRail(rail, replacedIds) {
  return !!replacedIds?.has('w70606159') && ['w75298818', 'w75298820'].includes(rail.id);
}
const JUMP_RINGS = [
  [[1297, -490], [1301, -499], [1385.1, -521.9], [1386.8, -516.3]],
  [[1385.1,-521.9],[1431.4,-542],[1467.2,-554.6],[1493.6,-563.9],[1589.4,-593.8],
    [1595.5,-594.1],[1599.6,-592.7],[1602.3,-588.9],[1602.9,-583.7],[1602,-579.9],
    [1596.7,-574.6],[1466.9,-535.3],[1386.8,-516.3]],
];
export function isLandmarkTreeObstruction(x, z, radius = 3, replacedIds) {
  if (!replacedIds?.has('w70606159') || x < 1280 || x > 1620 || z < -615 || z > -470) return false;
  return JUMP_RINGS.some(ring => ringSD(x, z, ring) < Math.max(3, radius));
}
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const finiteVector = (p, length) => Array.isArray(p) && p.length === length && p.every(Number.isFinite);

export function validateLandmarkManifest(manifest, courseSlug) {
  assert(SLUGS.includes(courseSlug) && manifest?.schemaVersion === 1
    && manifest.courseSlugs?.includes(courseSlug)
    && manifest.coordinateFrame === 'legacy-local-ground-relative', 'Landmark course/frame mismatch');
  assert(manifest.landmarks?.length === LANDMARK_SPECS.length, 'Incomplete landmark inventory');
  const ids = new Set();
  for (const item of manifest.landmarks) {
    const spec = LANDMARK_SPECS.find(s => s.id === item.id);
    assert(spec && !ids.has(item.id), 'Unknown or duplicate landmark');
    assert(item.nodeName === spec.nodeName && finiteVector(item.anchor, 2)
      && item.anchor.every((n, i) => Math.abs(n - spec.anchor[i]) < .01), 'Landmark placement changed');
    const asset = item.asset;
    assert(asset?.url === `models/veckefjarden/${spec.file}` && /^[a-f0-9]{64}$/.test(asset.sha256)
      && Number.isInteger(asset.bytes) && asset.bytes > 100 && asset.bytes < 12 * 1024 * 1024,
    'Invalid landmark asset receipt');
    assert(finiteVector(asset.bounds?.min, 3) && finiteVector(asset.bounds?.max, 3)
      && asset.bounds.min.every((v, i) => v < asset.bounds.max[i]), 'Invalid landmark bounds');
    assert(Number.isInteger(asset.meshes) && asset.meshes > 0 && asset.meshes <= 24
      && Number.isInteger(asset.triangles) && asset.triangles > 0 && asset.triangles < 150000,
    'Landmark exceeds geometry budget');
    ids.add(item.id);
  }
  return manifest;
}

function disposeObject(root) {
  root.removeFromParent();
  const geometries = new Set(), materials = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of [o.material].flat().filter(Boolean)) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

async function parseAsset(buffer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().parseAsync(buffer, '');
}

export async function loadLandmarks({ THREE, scene, courseSlug, demH, baseUrl, signal,
  fetchImpl = globalThis.fetch, parseGlb = parseAsset, timeoutMs = 20000 }) {
  const replacedLandmarkIds = new Set(), roots = [];
  const report = { status: 'loading', courseSlug, landmarks: [], replacedLandmarkIds: [], meshes: 0, triangles: 0 };
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; abort();
    for (const root of roots) disposeObject(root);
    roots.length = 0; replacedLandmarkIds.clear();
  };
  const current = () => assert(!disposed && !controller.signal.aborted, 'Landmark load cancelled');
  try {
    const response = await fetchImpl(new URL('models/veckefjarden/landmarks-v1.json', baseUrl), { signal: controller.signal, cache: 'no-cache' });
    assert(response.ok, `Landmark manifest HTTP ${response.status}`);
    const manifest = validateLandmarkManifest(await response.json(), courseSlug);
    for (const item of manifest.landmarks) {
      let root;
      try {
        current();
        const assetUrl = new URL(item.asset.url, baseUrl);
        assetUrl.searchParams.set('v', item.asset.sha256.slice(0, 16));
        const response = await fetchImpl(assetUrl, { signal: controller.signal });
        assert(response.ok, `Landmark asset HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        assert(buffer.byteLength === item.asset.bytes, 'Landmark asset length mismatch');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
          .map(n => n.toString(16).padStart(2, '0')).join('');
        assert(hash === item.asset.sha256, 'Landmark asset checksum mismatch');
        current();
        const gltf = await parseGlb(buffer);
        root = gltf.scene;
        current();
        assert(root?.getObjectByName(item.nodeName), 'Landmark model node missing');
        let meshes = 0, triangles = 0;
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          const positions = mesh.geometry.getAttribute('position');
          assert(positions?.count > 0 && Array.from(positions.array).every(Number.isFinite), 'Invalid landmark positions');
          triangles += (mesh.geometry.index?.count ?? positions.count) / 3;
          meshes++;
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.userData.tag = 'authored-landmark'; mesh.userData.landmarkId = item.id;
        });
        assert(meshes === item.asset.meshes && triangles === item.asset.triangles, 'Landmark geometry receipt mismatch');
        root.updateMatrixWorld(true);
        const localBounds = new THREE.Box3().setFromObject(root);
        for (const side of ['min', 'max']) assert(localBounds[side].toArray().every((v, i) =>
          Math.abs(v - item.asset.bounds[side][i]) < .15), 'Landmark export bounds mismatch');
        const height = demH(...item.anchor);
        assert(Number.isFinite(height), 'Landmark ground unavailable');
        root.name = `landmark-${item.nodeName}`;
        root.position.set(item.anchor[0], height, item.anchor[1]);
        root.userData.landmarkId = item.id; root.userData.assetSha256 = hash;
        root.updateMatrixWorld(true);
        current();
        scene.add(root); roots.push(root); replacedLandmarkIds.add(item.id);
        const bounds = new THREE.Box3().setFromObject(root);
        report.landmarks.push({ id: item.id, status: 'loaded', name: root.name,
          anchor: [...item.anchor], ground: height, meshes, triangles,
          min: bounds.min.toArray(), max: bounds.max.toArray(), assetSha256: hash });
        report.meshes += meshes; report.triangles += triangles;
      } catch (error) {
        if (root && !roots.includes(root)) disposeObject(root);
        report.landmarks.push({ id: item.id, status: 'fallback', reason: error.message });
      }
    }
    if (controller.signal.aborted) {
      dispose();
      report.meshes = 0; report.triangles = 0;
      report.landmarks = report.landmarks.map(item => ({ id: item.id, status: 'fallback', reason: 'Landmark load cancelled' }));
      throw new Error('Landmark load cancelled');
    }
    report.status = roots.length === manifest.landmarks.length ? 'loaded' : roots.length ? 'partial' : 'fallback';
  } catch (error) {
    report.status = 'fallback'; report.reason = error.message;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
  report.replacedLandmarkIds = [...replacedLandmarkIds];
  return { roots, replacedLandmarkIds, report, dispose };
}
