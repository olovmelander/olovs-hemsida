/* Blender-authored display meshes in the existing scenery triangle batch.
 * Geographic footprints remain in the course model. Every replacement is
 * checked before any of its triangles or suppression decisions are emitted.
 * This module creates no Three.js objects, materials, textures or GPU resources.
 */
export const UPSALA_ARCHITECTURE_FRAME = Object.freeze({
  origin: Object.freeze({ lat: 59.839, lon: 17.4952 }),
  mPerLat: 111320,
  mPerLon: 55930.68,
  verticalDatum: 'RH2000',
});

const MAX_TRIANGLES = 100000;
const MAX_VERTICES = 300000;
const RING_TOLERANCE_METRES = .001;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new Error(`Upsala architecture: ${message}`); };
const colour = value => Number.isInteger(value) && value >= 0 && value <= 0xffffff;
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 240;

function copyRing(ring, label) {
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > 2048 ||
      ring.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))) fail(`${label} needs a finite XZ ring`);
  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i+1)%ring.length];
    twiceArea += a[0]*b[1]-b[0]*a[1];
  }
  if (Math.abs(twiceArea) < .0001) fail(`${label} has no area`);
  return Object.freeze(ring.map(point => Object.freeze([...point])));
}

function ringMatches(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((point, index) =>
    Array.isArray(point) && point.length === 2 && point.every(finite) &&
    Math.hypot(point[0]-expected[index][0], point[1]-expected[index][1]) <= RING_TOLERANCE_METRES);
}

/** Validate and copy the authored package without accepting arbitrary frames. */
export function validateUpsalaMeshPackage(input) {
  if (input?.schemaVersion !== 1 || input.groundId !== 'upsala') fail('unsupported package identity');
  const f = input.frame, expected = UPSALA_ARCHITECTURE_FRAME;
  if (f?.origin?.lat !== expected.origin.lat || f?.origin?.lon !== expected.origin.lon ||
      f.mPerLat !== expected.mPerLat || f.mPerLon !== expected.mPerLon || f.verticalDatum !== expected.verticalDatum) fail('course frame or height datum differs');
  if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 64) fail('package needs 1..64 authored assets');
  const assetIds = new Set(), replacementIds = new Set();
  let triangles = 0, vertices = 0;
  const assets = input.assets.map(asset => {
    if (!name(asset.id) || assetIds.has(asset.id)) fail('missing or duplicate asset ID');
    assetIds.add(asset.id);
    if (!Array.isArray(asset.replaces) || !asset.replaces.length || asset.replaces.length > 32) fail(`${asset.id} needs explicit replacement records`);
    const replaces = asset.replaces.map(record => {
      if (!name(record.id) || replacementIds.has(record.id)) fail(`duplicate or missing replacement ID ${record.id}`);
      replacementIds.add(record.id);
      return Object.freeze({ id: record.id, ring: copyRing(record.ring, record.id) });
    });
    if (!replaces.some(record => record.id === asset.renderOnBuildingId)) fail(`${asset.id} render owner is not a replaced building`);
    const sourcePoints = replaces.flatMap(record => record.ring);
    // A newly reviewed municipal component can extend beyond an older OSM
    // replacement. Keep that explicit reference separate from suppression IDs.
    if (asset.referenceOutlines !== undefined) {
      if (!Array.isArray(asset.referenceOutlines) || asset.referenceOutlines.length > 64) fail(`${asset.id} has invalid reference outlines`);
      const outlineIds=new Set();
      for (const outline of asset.referenceOutlines) {
        if (!name(outline.sourceId) || outlineIds.has(outline.sourceId)) fail(`${asset.id} has duplicate or missing reference identity`);
        outlineIds.add(outline.sourceId);
        sourcePoints.push(...copyRing(outline.ring,outline.sourceId));
      }
    }
    const bounds = [Math.min(...sourcePoints.map(p=>p[0])), Math.min(...sourcePoints.map(p=>p[1])),
      Math.max(...sourcePoints.map(p=>p[0])), Math.max(...sourcePoints.map(p=>p[1]))];
    const nearSource = (x,z) => x >= bounds[0]-30 && x <= bounds[2]+30 && z >= bounds[1]-30 && z <= bounds[3]+30;
    if (!Array.isArray(asset.parts) || !asset.parts.length || asset.parts.length > 4096) fail(`${asset.id} needs authored mesh parts`);
    const parts = asset.parts.map(part => {
      if (!name(part.name) || !colour(part.color)) fail(`${asset.id} has invalid part metadata`);
      if (!Array.isArray(part.positions) || part.positions.length < 9 || part.positions.length%3 !== 0 || !part.positions.every(finite)) fail(`${asset.id}/${part.name} has invalid XYZ positions`);
      const count = part.positions.length/3;
      vertices += count;
      if (vertices > MAX_VERTICES) fail('vertex budget exceeded');
      for (let i=0; i<part.positions.length; i+=3) {
        const [x,y,z] = part.positions.slice(i,i+3);
        if (!nearSource(x,z) || y < 0 || y > 150) fail(`${asset.id}/${part.name} lies outside source coordinates or RH2000 heights`);
      }
      if (!Array.isArray(part.indices) || !part.indices.length || part.indices.length%3 !== 0 ||
          part.indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)) fail(`${asset.id}/${part.name} has invalid triangle indices`);
      triangles += part.indices.length/3;
      if (triangles > MAX_TRIANGLES) fail('triangle budget exceeded');
      return Object.freeze({ name: part.name, color: part.color,
        positions: Object.freeze([...part.positions]), indices: Object.freeze([...part.indices]) });
    });
    if (!Array.isArray(asset.foundations) || !asset.foundations.length || asset.foundations.length > 1024) fail(`${asset.id} needs explicit ground contact rings`);
    const foundations = asset.foundations.map((foundation,index) => {
      const ring = copyRing(foundation.ring, `${asset.id} foundation ${index}`);
      if (!colour(foundation.color) || !finite(foundation.topHeightRH2000) || foundation.topHeightRH2000 < 0 || foundation.topHeightRH2000 > 150 ||
          ring.some(p => !nearSource(...p))) fail(`${asset.id} has invalid foundation coordinates`);
      const maxGroundGapMetres = foundation.maxGroundGapMetres ?? 3;
      if (!finite(maxGroundGapMetres) || maxGroundGapMetres <= 0 || maxGroundGapMetres > 6) fail(`${asset.id} has invalid foundation gap limit`);
      return Object.freeze({ ring, topHeightRH2000: foundation.topHeightRH2000,
        color: foundation.color, maxGroundGapMetres });
    });
    const lowestContact=Math.min(...foundations.map(f=>f.topHeightRH2000));
    const highestContact=Math.max(...foundations.map(f=>f.topHeightRH2000));
    let lowY=Infinity,highY=-Infinity;
    for(const part of parts)for(let i=1;i<part.positions.length;i+=3) {
      lowY=Math.min(lowY,part.positions[i]);highY=Math.max(highY,part.positions[i]);
    }
    if(lowY<lowestContact-6 || highY<lowestContact+.25 || highY>highestContact+35) fail(`${asset.id} mesh heights disagree with its RH2000 ground contacts`);
    return Object.freeze({ id: asset.id, renderOnBuildingId: asset.renderOnBuildingId,
      replaces: Object.freeze(replaces), parts: Object.freeze(parts), foundations: Object.freeze(foundations),
      evidence: typeof asset.evidence === 'string' ? asset.evidence : 'Blender-authored display model; source geometry preserved' });
  });
  return Object.freeze({ schemaVersion: 1, groundId: 'upsala', frame: expected,
    assets: Object.freeze(assets), authoredTriangles: triangles, authoredVertices: vertices });
}

function prepareAsset(asset, buildings, terrainH) {
  if (!Array.isArray(buildings) || typeof terrainH !== 'function') fail('source buildings and terrain sampler are required');
  for (const record of asset.replaces) {
    const matches = buildings.filter(building => building.id === record.id);
    if (matches.length !== 1 || !ringMatches(matches[0].ring, record.ring)) fail(`${asset.id} source footprint ${record.id} changed or is missing`);
    if (matches[0].amenity === 'place_of_worship') fail(`${asset.id} cannot suppress a separately rendered landmark`);
  }
  const triangles = [];
  let foundationSegments=0;
  const push = (a,b,c,color) => {
    const ab=b.map((v,i)=>v-a[i]), ac=c.map((v,i)=>v-a[i]);
    if (Math.hypot(ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]) < 1e-9) return;
    triangles.push({ points: [a,b,c], color });
  };
  for (const part of asset.parts) {
    const vertex = index => part.positions.slice(index*3,index*3+3);
    for (let i=0; i<part.indices.length; i+=3) push(...part.indices.slice(i,i+3).map(vertex), part.color);
  }
  const meshTriangles = triangles.length;
  if (!meshTriangles) fail(`${asset.id} contains no non-degenerate triangles`);
  let maximumGroundGapMetres = 0;
  for (const foundation of asset.foundations) {
    const { ring, topHeightRH2000: top } = foundation;
    const sample = p => {
      const ground = terrainH(...p);
      if (!finite(ground)) fail(`${asset.id} terrain sample is unavailable`);
      const gap = Math.abs(top-ground);
      maximumGroundGapMetres = Math.max(maximumGroundGapMetres,gap);
      if (gap > foundation.maxGroundGapMetres) fail(`${asset.id} foundation and terrain differ by ${gap.toFixed(3)} m`);
      // Keep a buried skirt when a later terrain LOD refines the sample. This
      // changes only unseen foundation depth, never the authored floor/roof.
      return Math.min(top-1.2, ground-.2);
    };
    for (let i=0; i<ring.length; i++) {
      const a=ring[i], b=ring[(i+1)%ring.length], length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const steps=Math.max(1,Math.ceil(length));
      if (steps > 2048) fail(`${asset.id} foundation edge is too long`);
      foundationSegments+=steps;
      if (foundationSegments>20000) fail(`${asset.id} foundation sampling budget exceeded`);
      for (let k=0; k<steps; k++) {
        const at=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
        const p=at(k/steps),q=at((k+1)/steps),p0=[p[0],sample(p),p[1]],q0=[q[0],sample(q),q[1]];
        const p1=[p[0],top,p[1]],q1=[q[0],top,q[1]];
        push(p0,q0,q1,foundation.color);push(p0,q1,p1,foundation.color);
        if (triangles.length > MAX_TRIANGLES) fail(`${asset.id} foundation triangle budget exceeded`);
      }
    }
  }
  return { triangles, meshTriangles, foundationTriangles: triangles.length-meshTriangles, maximumGroundGapMetres };
}

/** One renderer may serve both routings; each triangle batch owns its own state. */
export function createUpsalaArchitecture(input) {
  const packet = validateUpsalaMeshPackage(input);
  const assetForBuilding = new Map(packet.assets.flatMap(asset => asset.replaces.map(record => [record.id,asset])));
  const batches = new WeakMap();
  const failures = new Map();
  let emittedAssetCount = 0;
  function render({ building, buildings, terrainH, tri, L, sourceView = false }) {
    if (sourceView || typeof tri !== 'function' || typeof L !== 'function') return null;
    const asset = assetForBuilding.get(building?.id);
    if (!asset) return null;
    let batch = batches.get(tri);
    if (!batch) { batch = new Map(); batches.set(tri,batch); }
    let state = batch.get(asset.id);
    if (!state) {
      try {
        // Complete validation and terrain contact before suppressing any ID.
        const prepared = prepareAsset(asset,buildings,terrainH), colours = new Map();
        for (const triangle of prepared.triangles) if (!colours.has(triangle.color)) {
          const value = L(triangle.color);
          if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) fail(`${asset.id} material conversion is invalid`);
          colours.set(triangle.color,value);
        }
        state = { prepared, colours, emitted: false };
      } catch (error) {
        state = { error: error.message };
        failures.set(asset.id,error.message);
      }
      batch.set(asset.id,state);
    }
    if (state.error) return null;
    if (building.id !== asset.renderOnBuildingId || state.emitted) {
      return { buildingId: building.id, assetId: asset.id, triangles: 0, parts: [],
        disposition: 'source-suppressed', sourceGeometryPreserved: true, renderOnBuildingId: asset.renderOnBuildingId };
    }
    for (const triangle of state.prepared.triangles) tri(...triangle.points,state.colours.get(triangle.color));
    state.emitted=true;emittedAssetCount++;
    const prepared=state.prepared;
    // CPU preparation is released once copied into the existing scene batch.
    state.prepared=null;state.colours=null;
    return { buildingId: building.id, assetId: asset.id, triangles: prepared.triangles.length,
      meshTriangles: prepared.meshTriangles, foundationTriangles: prepared.foundationTriangles,
      maximumGroundGapMetres: +prepared.maximumGroundGapMetres.toFixed(4),
      parts: asset.parts.map(part=>part.name), replaces: asset.replaces.map(record=>record.id),
      disposition: 'authored', sourceGeometryPreserved: true, roofHeightsPreserved: true, evidence: asset.evidence };
  }
  return Object.freeze({ render,
    status: () => ({ state: failures.size ? 'partial-fallback' : 'ready', assetCount: packet.assets.length,
      authoredTriangles: packet.authoredTriangles, emittedAssetCount,
      failures: [...failures].map(([assetId,reason])=>({assetId,reason})),
      resourceOwnership: 'existing-scenery-batch; no separate GPU resources' }) });
}

/** A missing, malformed or incompatible optional mesh chunk leaves the source fallback. */
export async function loadUpsalaArchitecture(load) {
  try {
    const module = await load();
    return createUpsalaArchitecture(module.default ?? module);
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0,400);
    return Object.freeze({ render: () => null, status: () => ({ state: 'fallback', assetCount: 0, emittedAssetCount: 0, reason }) });
  }
}
