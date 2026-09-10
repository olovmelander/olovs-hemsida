import architecture from './norrfallsviken-facilities-meshes.json' with { type: 'json' };
import site from './norrfallsviken-facilities-site.json' with { type: 'json' };
import { legacyGridBridge } from '../geodetic-frame.mjs';
import { NORRFALLSVIKEN_FACILITY_FRAME, NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006 } from './norrfallsviken-facility-frame.mjs';

// Architecture-only export of the measured Blender workspace. The ortho boards,
// point cloud and reference ground are deliberately absent from this asset.
const bridge = legacyGridBridge(NORRFALLSVIKEN_FACILITY_FRAME);
const origin = NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const replacementIds = Object.freeze(['w1205924894', 'lm-range-shelter']);
let activeLayout = null;

export function projectFacilityPoint([east, north, height], offset = NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres) {
  const [x, z] = bridge.toLegacy(east - origin.easting, origin.northing - north);
  return [x, height + offset, z];
}

export const facilityFootprints = architecture.facilities.map(f => ({
  id: f.id,
  floorWorld: f.floorRH2000Estimate + NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres,
  roofTopWorld: Math.max(...f.roofHeightRH2000) + NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres,
  ring: f.wallFootprintEpsg3006.map(([e, n]) => {
    const [x, , z] = projectFacilityPoint([e, n, 0]); return [x, z];
  }),
}));
for (const f of facilityFootprints) f.bounds = {
  minX: Math.min(...f.ring.map(p => p[0])), maxX: Math.max(...f.ring.map(p => p[0])),
  minZ: Math.min(...f.ring.map(p => p[1])), maxZ: Math.max(...f.ring.map(p => p[1])),
};

function nearFootprint({ ring, bounds }, x, z, margin) {
    if (x < bounds.minX - margin || x > bounds.maxX + margin || z < bounds.minZ - margin || z > bounds.maxZ + margin) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j], [bx, bz] = ring[i];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) <= margin) return true;
    }
    return inside;
}

export function isFacilityInterior(x, z, margin = .2) {
  return facilityFootprints.some(f => nearFootprint(f, x, z, margin));
}

// Use the rendered crown's lower bound: a tall tree can overhang a roof without
// intersecting it. This only filters display instances, never the laser source.
export function isFacilityTreeObstruction(tree, crownBottomWorld) {
  if (isFacilityInterior(tree.x, tree.z, .3)) return true;
  return facilityFootprints.some(f => crownBottomWorld < f.roofTopWorld
    && tree.y + tree.height > f.floorWorld
    && nearFootprint(f, tree.x, tree.z, tree.radius + .45));
}

const centre = ring => ring.reduce((c, p) => [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length], [0, 0]);

/** Preserve measured RH2000 roofs in v2; only the legacy diagnostic gets a
 * rigid ground anchor. Foundations reach down to the actual 1 m surface. */
export function compileFacilityGeometry({ terrainH, v2Active, verticalDatumOffsetMetres }) {
  assert(architecture.schemaVersion === 1 && site.schemaVersion === 1, 'Invalid Norrfallsviken architecture');
  const datum = NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres;
  if (v2Active) assert(Math.abs(verticalDatumOffsetMetres - datum) < .001, 'Facility height bridge mismatch');
  const batches = new Map(), placements = [], byId = new Map();
  function emit(points, colour, roughness = .75) {
    assert(points.length % 3 === 0 && points.flat().every(Number.isFinite), 'Invalid facility triangles');
    const key = `${colour.join(',')}/${roughness}`;
    if (!batches.has(key)) batches.set(key, { colour, roughness, positions: [] });
    const positions = batches.get(key).positions;
    for (const p of points) positions.push(...p);
  }
  for (const f of architecture.facilities) {
    const { ring } = facilityFootprints.find(p => p.id === f.id);
    const anchor = centre(ring), ground = terrainH(...anchor);
    assert(Number.isFinite(ground), 'Facility ground unavailable');
    const isCross = f.id === 'clubhouse-cross-roof-native';
    const shift = v2Active ? datum : isCross ? placements[0].shift : ground + .12 - f.floorRH2000Estimate;
    const floor = f.floorRH2000Estimate + shift;
    const placement = { id: f.id, mode: v2Active ? 'absolute-rh2000' : 'legacy-terrain-anchor', shift, floor,
      roofHeightWorld: f.roofHeightRH2000.map(h => h + shift), foundationSamples: 0, maximumFoundationDepth: 0 };
    byId.set(f.id, placement); placements.push(placement);
    // Sample every edge at <=1 m, so a sloping site cannot leave floating walls.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      const edge = [];
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + (b[0] - a[0]) * s / steps, z = a[1] + (b[1] - a[1]) * s / steps;
        const h = terrainH(x, z);
        assert(Number.isFinite(h), 'Foundation ground unavailable');
        const base = Math.min(floor - .15, h - .15);
        edge.push({ top: [x, floor, z], base: [x, base, z] });
        placement.foundationSamples++;
        placement.maximumFoundationDepth = Math.max(placement.maximumFoundationDepth, floor - base);
      }
      for (let j = 1; j < edge.length; j++) {
        const a = edge[j - 1], b = edge[j];
        const dx = b.top[0] - a.top[0], dz = b.top[2] - a.top[2];
        const outward = -dz * (a.top[0] - anchor[0]) + dx * (a.top[2] - anchor[1]) > 0;
        emit(outward ? [a.base, b.base, b.top, a.base, b.top, a.top]
          : [a.base, b.top, b.base, a.base, a.top, b.top], [.184475, .171441, .144128]);
      }
    }
  }
  for (const part of architecture.parts) {
    const placement = byId.get(part.facilityId);
    assert(placement && part.indices.length % 3 === 0, 'Unowned architecture part');
    const points = part.indices.map(index => {
      const p = part.positions.slice(index * 3, index * 3 + 3);
      assert(p.length === 3, 'Invalid architecture index');
      return projectFacilityPoint(p.map((v, axis) => v + architecture.originEpsg3006RH2000[axis]), placement.shift);
    });
    // Blender's authored material values are already linear RGB.
    emit(points, part.colour, part.roughness);
  }
  const clubhouseShift = placements[0].shift;
  for (const array of site.solarArrays) {
    const vertices = array.verticesEpsg3006RH2000.map(p => projectFacilityPoint(p, clubhouseShift));
    emit(array.faces.flatMap(face => face.slice(2).flatMap((index, i) =>
      [vertices[face[0]], vertices[face[i + 1]], vertices[index]])), [.018, .034, .047], .34);
  }
  return { batches: [...batches.values()], placements,
    siteHeights: {
      terrace: site.terrace.verticesEpsg3006RH2000[0][2] + clubhouseShift,
      padelCourt: v2Active ? site.padelCourt.verticesEpsg3006RH2000[0][2] + datum : null,
    } };
}

export function architectureStatus() {
  return { status: activeLayout ? 'loaded' : 'fallback', source: 'measured-blender-workspace',
    sourceBlendSha256: architecture.sourceBlendSha256, roofAssemblies: activeLayout ? architecture.facilities.length : 0 };
}
export const authoredSiteHeights = () => activeLayout?.siteHeights ?? null;

export async function loadFacilities({ THREE, scene, courseSlug, buildings, terrainH,
  v2Active, verticalDatumOffsetMetres, signal, isCurrentCourse = () => true }) {
  let root = null, layout = null, disposed = false;
  const replacedBuildingIds = new Set();
  const report = { status: 'loading', courseSlug, replacedBuildingIds: [], facilities: [], meshes: 0, triangles: 0 };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    root?.removeFromParent();
    root?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    if (activeLayout === layout) activeLayout = null;
    replacedBuildingIds.clear();
  };
  try {
    assert(!signal?.aborted && isCurrentCourse(), 'Facilities load cancelled');
    assert(courseSlug === 'norrfallsviken', 'Facilities belong to another course');
    assert(replacementIds.every(id => buildings.some(b => b.id === id && b.ring?.length >= 3)), 'Replacement footprint missing');
    layout = compileFacilityGeometry({ terrainH, v2Active, verticalDatumOffsetMetres });
    root = new THREE.Group(); root.name = 'Norrfallsviken authored facilities';
    root.userData = { groundId: courseSlug, sourceBlendSha256: architecture.sourceBlendSha256, facilityCount: layout.placements.length };
    for (const batch of layout.batches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
      geometry.computeVertexNormals();
      const Material = THREE.MeshStandardNodeMaterial ?? THREE.MeshStandardMaterial;
      const material = new Material({ color: new THREE.Color(...batch.colour), roughness: batch.roughness,
        side: THREE.DoubleSide, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'Measured facility material batch'; mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
      report.triangles += batch.positions.length / 9;
    }
    assert(!signal?.aborted && isCurrentCourse(), 'Facilities load cancelled');
    scene.add(root);
    activeLayout = layout;
    for (const id of replacementIds) replacedBuildingIds.add(id);
    Object.assign(report, { status: 'loaded', replacedBuildingIds: [...replacedBuildingIds], facilities: layout.placements,
      meshes: root.children.length, sourceParts: architecture.parts.length, solarArrays: site.solarArrays.length,
      siteHeights: layout.siteHeights, sourceBlendSha256: architecture.sourceBlendSha256,
      limitations: 'Wall offsets, floor levels and facade divisions are interpretations; practice shed retains its existing model.' });
    signal?.addEventListener('abort', dispose, { once: true });
    return { root, report, replacedBuildingIds, dispose };
  } catch (error) {
    dispose();
    Object.assign(report, { status: 'fallback', reason: error.message, meshes: 0, triangles: 0 });
    return { root: null, report, replacedBuildingIds, dispose };
  }
}
