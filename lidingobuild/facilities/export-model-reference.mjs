/* Editable Blender intake, using existing geometry without changing the app.
 * Run: node lidingobuild/facilities/export-model-reference.mjs
 * All exported coordinates are metres: X east, Y north, Z up.
 * Source evidence and architectural appearance estimates stay separate. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadArchitectureFixture } from '../architecture-fixture.mjs';
import { buildingArchitecture, courtyardArchitecture, BUILDING_IDS } from '../../apps/golf/src/engine/scenery/lidingo-architecture.js';
import { readChunk, sha256Bytes } from '../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../packages/course-v2/terrain-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = 'lidingobuild/cache/facilities-reference-2026-09-10';
const E0 = 677700.5, N0 = 6586399.5, H0 = 25;
const requestedBounds = { minEasting: 677390, maxEasting: 677820, minNorthing: 6586060, maxNorthing: 6586620 };
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const inputs = [];
function input(relative) {
  const bytes = read(relative);
  inputs.push({ path: relative, bytes: bytes.length, sha256: sha256Bytes(bytes) });
  return bytes;
}
const fromSource = ([e, n, h]) => [e - E0, n - N0, h - H0];
const fromApp = ([x, h, z]) => [x, -z, h - H0];
const { model, terrainH: fixtureH, terrainChunkSha256: fixtureTerrainHashes } = loadArchitectureFixture();
input('lidingobuild/architecture-fixture.mjs');
input('apps/golf/src/engine/scenery/lidingo-architecture.js');
input('apps/golf/public/courses/lidingo/pack.bin');
const facilitiesSource = JSON.parse(input('lidingobuild/mapping/facilities.geojson'));
const roofsSource = JSON.parse(input('lidingobuild/mapping/building-roof-meshes.json'));
const contextPath = 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson';
const infrastructurePath = 'lidingobuild/mapping/infrastructure.geojson';
const contextSource = JSON.parse(input(contextPath));
const infrastructureSource = JSON.parse(input(infrastructurePath));
const extraIds = ['way/40895787', 'way/32428950', 'way/52583105', 'way/52583080',
  'way/32428969', 'way/32428972', 'way/41197227', 'way/221846977', 'way/79550926',
  'way/427426698', 'way/427426716', 'way/427429857', 'way/836722128', 'way/221846979'];
const extraSources = extraIds.map(id => {
  const normalized = infrastructureSource.features.find(f => f.id === id);
  const feature = normalized ?? contextSource.features.find(f => f.id === id);
  assert.ok(feature, `Missing supplementary context ${id}`);
  return { feature, path: normalized ? infrastructurePath : contextPath };
});
const report = JSON.parse(input('apps/golf/public/lidingo-ground-graph-report.json'));
assert.equal(report.frame.origin.easting, E0);
assert.equal(report.frame.origin.northing, N0);
const manifestPath = `apps/golf/public/grounds/lidingo/ground-v2-${report.graph.groundManifestSha256}.json`;
const manifestBytes = input(manifestPath);
assert.equal(sha256Bytes(manifestBytes), report.graph.groundManifestSha256, 'Ground manifest checksum');
const ground = JSON.parse(manifestBytes);
const buildingIds = [...Object.values(BUILDING_IDS), 'way/221846983'];
const buildings = buildingIds.map(id => {
  const building = model.infra.buildings.find(b => b.id === id);
  assert.ok(building, `Missing retained footprint ${id}`);
  return building;
});
const polygons = geometry => {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported outline geometry ${geometry.type}`);
};
const allMappedPoints = facilitiesSource.features.flatMap(f => polygons(f.geometry).flat(2));
allMappedPoints.push(...buildings.flatMap(b => b.ring.map(([x, z]) => [E0 + x, N0 - z])));
const mappedBounds = {
  minEasting: Math.min(...allMappedPoints.map(p => p[0])),
  maxEasting: Math.max(...allMappedPoints.map(p => p[0])),
  minNorthing: Math.min(...allMappedPoints.map(p => p[1])),
  maxNorthing: Math.max(...allMappedPoints.map(p => p[1])),
};
assert.ok(mappedBounds.minEasting >= requestedBounds.minEasting && mappedBounds.maxEasting <= requestedBounds.maxEasting &&
  mappedBounds.minNorthing >= requestedBounds.minNorthing && mappedBounds.maxNorthing <= requestedBounds.maxNorthing,
  'Terrain bounds must contain every retained facility and footprint');

// The fixture covers all five buildings, but the southern practice green needs
// additional published tiles. Use the same decoder and bilinear height rule.
const tiles = ground.tiles.filter(t => t.lod === 0 && t.bounds.maxEasting > requestedBounds.minEasting &&
  t.bounds.minEasting < requestedBounds.maxEasting && t.bounds.maxNorthing > requestedBounds.minNorthing &&
  t.bounds.minNorthing < requestedBounds.maxNorthing).map(t => {
  const ref = t.layers.terrain, bytes = read(`apps/golf/public/${ref.url}`);
  assert.equal(sha256Bytes(bytes), ref.sha256, `Terrain checksum ${t.id}`);
  const { header, payload } = readChunk(bytes);
  assert.equal(header.grid.sampleSpacingMetres, 1);
  return { ...t, grid: header.grid, heights: decodeTerrainGrid(payload, header.grid) };
});
function terrainH(e, n) {
  const t = tiles.find(t => e >= t.bounds.minEasting && e <= t.bounds.maxEasting &&
    n >= t.bounds.minNorthing && n <= t.bounds.maxNorthing);
  assert.ok(t, `No published terrain at ${e}, ${n}`);
  const { grid: g, heights: h, bounds: b } = t;
  const u = e - b.minEasting, v = b.maxNorthing - n;
  const i = Math.min(g.width - 2, Math.floor(u)), j = Math.min(g.height - 2, Math.floor(v));
  const a = u - i, c = v - j, k = j * g.width + i;
  const height = (h[k] * (1 - a) + h[k + 1] * a) * (1 - c) +
    (h[k + g.width] * (1 - a) + h[k + g.width + 1] * a) * c;
  assert.ok(Number.isFinite(height), `Terrain nodata at ${e}, ${n}`);
  return height;
}
const drape = ring => ring.map(([e, n]) => fromSource([e, n, terrainH(e, n)]));
let maximumFixtureDifferenceMetres = 0;
for (const b of buildings) for (const [x, z] of b.ring) {
  maximumFixtureDifferenceMetres = Math.max(maximumFixtureDifferenceMetres,
    Math.abs(fixtureH(x, z) - terrainH(E0 + x, N0 - z)));
}
assert.equal(maximumFixtureDifferenceMetres, 0, 'Extended terrain matches architecture fixture');

const terrain = {
  id: 'published-dtm-2m-preview', spacingMetres: 2, sourceSpacingMetres: 1,
  boundsEpsg3006: requestedBounds, vertices: [], triangleIndices: [],
  evidence: 'Published 1 m RH2000 terrain, bilinearly sampled at 2 m for an editable preview; no building surface heights.',
  chunks: tiles.map(t => ({ id: t.id, bounds: t.bounds, ...t.layers.terrain })),
};
const nx = (requestedBounds.maxEasting - requestedBounds.minEasting) / 2 + 1;
const ny = (requestedBounds.maxNorthing - requestedBounds.minNorthing) / 2 + 1;
terrain.width = nx; terrain.height = ny; terrain.rowOrder = 'south-to-north';
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const e = requestedBounds.minEasting + i * 2, n = requestedBounds.minNorthing + j * 2;
  terrain.vertices.push(fromSource([e, n, terrainH(e, n)]));
  if (i < nx - 1 && j < ny - 1) {
    const k = j * nx + i;
    terrain.triangleIndices.push(k, k + 1, k + nx + 1, k, k + nx + 1, k + nx);
  }
}
assert.ok(terrain.triangleIndices.length / 3 <= 200000, 'Terrain preview budget');

const architectureMeshes = [], architectureCounts = [];
function splitArchitecture(buildingId, detail) {
  assert.ok(detail?.triangles.length, `Missing architecture for ${buildingId}`);
  const groups = new Map();
  detail.triangles.forEach((triangle, sourceTriangleIndex) => {
    const key = `${triangle.part}:${triangle.color}`;
    if (!groups.has(key)) groups.set(key, {
      id: `${buildingId}:${key}`, buildingId, part: triangle.part, color: triangle.color,
      colorHex: `#${triangle.color.toString(16).padStart(6, '0')}`,
      evidence: 'photo-and-laser-informed-display-approximation',
      vertices: [], triangleIndices: [], sourceTriangleIndices: [], lookup: new Map(),
    });
    const group = groups.get(key);
    for (const point of triangle.points) {
      const transformed = fromApp(point), hash = JSON.stringify(transformed);
      if (!group.lookup.has(hash)) {
        group.lookup.set(hash, group.vertices.length); group.vertices.push(transformed);
      }
      group.triangleIndices.push(group.lookup.get(hash));
    }
    group.sourceTriangleIndices.push(sourceTriangleIndex);
  });
  let count = 0;
  for (const group of groups.values()) {
    // Reconstruct every original triangle to check that part/material splitting
    // has not quantized, dropped, rewound, or moved any existing detail.
    group.sourceTriangleIndices.forEach((sourceIndex, localIndex) => {
      const points = group.triangleIndices.slice(localIndex * 3, localIndex * 3 + 3).map(i => group.vertices[i]);
      assert.deepEqual(points, detail.triangles[sourceIndex].points.map(fromApp));
    });
    count += group.triangleIndices.length / 3;
    delete group.lookup; architectureMeshes.push(group);
  }
  assert.equal(count, detail.triangles.length);
  architectureCounts.push({ buildingId, meshes: groups.size, triangles: count, parts: detail.parts });
}
for (const b of buildings.filter(b => b.roofSurface)) splitArchitecture(b.id, buildingArchitecture(b, fixtureH));
splitArchitecture('courtyard', courtyardArchitecture(model.scenery.mappedFeatures, model.infra.buildings, fixtureH));

const buildingFootprints = buildings.map(b => ({
  id: b.id, rings: [b.ring.map(([x, z]) => fromApp([x, fixtureH(x, z), z]))],
  metadata: { name: b.name, sourceId: b.sourceId, sourceGeometry: 'retained OSM footprint',
    heightStatus: b.heightStatus, notSurveyed: true, hasRoofEvidence: Boolean(b.roofSurface),
    useAssociation: Object.entries(BUILDING_IDS).find(([, id]) => id === b.id)?.[0] ?? 'small ancillary footprint',
    useAssociationStatus: 'descriptive modeling association; exact current use not verified',
    verticalPlacement: 'published terrain sampled at original footprint vertices; no inferred building height' },
}));
const facilities = facilitiesSource.features.map(f => ({
  id: f.id, kind: f.properties.kind,
  polygons: polygons(f.geometry).map(rings => ({ rings: rings.map(drape) })),
  metadata: { ...f.properties, sourceGeometryType: f.geometry.type,
    verticalPlacement: 'published terrain sampled at original outline vertices; unchanged horizontal rings and holes' },
}));
const supplementaryReferences = extraSources.map(({ feature: f, path: sourcePath }) => {
  assert.ok(['Polygon', 'LineString'].includes(f.geometry.type), f.id);
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const ring of rings) for (const [e, n] of ring) {
    assert.ok(e >= requestedBounds.minEasting && e <= requestedBounds.maxEasting &&
      n >= requestedBounds.minNorthing && n <= requestedBounds.maxNorthing, `Supplement outside terrain: ${f.id}`);
  }
  return { id: f.id, geometryType: f.geometry.type, closed: f.geometry.type === 'Polygon', rings: rings.map(drape),
    metadata: { ...f.properties, sourcePath, licence: 'ODbL-1.0', notSurveyed: true,
      evidence: 'Supplementary retained OSM context; original coordinates and tags, current existence and use unverified',
      ...(f.id === 'way/40895787' ? { useAssociation: 'nearby building; ownership, use and height unknown', hasRoofEvidence: false } : {}),
      verticalPlacement: 'published terrain sampled at original vertices; line references do not establish widths or heights' } };
});
const sourceRoofMeshes = roofsSource.buildings.map(b => {
  const mesh = b.mesh, appRoof = buildings.find(x => x.id === b.sourceFootprintId)?.roofSurface;
  assert.ok(appRoof, `Missing shipping roof for ${b.sourceFootprintId}`);
  assert.deepEqual(mesh.triangleIndices, appRoof.triangleIndices);
  const vertices = mesh.verticesEpsg3006RH2000.map(fromSource);
  assert.equal(vertices.length, appRoof.vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    assert.deepEqual(vertices[i], fromApp([appRoof.vertices[i].c[0], appRoof.vertices[i].heightRH2000, appRoof.vertices[i].c[1]]));
  }
  return {
    id: `source-roof:${b.sourceFootprintId}`, buildingId: b.sourceFootprintId,
    vertices, triangleIndices: mesh.triangleIndices,
    boundaryRings: mesh.boundaryRingsEpsg3006RH2000.map(ring => ring.map(fromSource)),
    boundaryWallSegments: mesh.boundaryWallSegmentsEpsg3006RH2000.map(segment => segment.map(fromSource)),
    uncoveredFootprintPolygons: polygons(mesh.uncoveredFootprintGeometryEpsg3006).map(rings => ({ rings: rings.map(drape) })),
    metadata: { sourceId: b.sourceId, sourceEpoch: b.sourceEpoch, state: b.state,
      evidence: 'retained dated source roof TIN; gaps are unsupported, not filled',
      statistics: mesh.statistics, boundaryHeightMethod: mesh.boundaryHeightMethod,
      roofStyle: mesh.roofStyle, eaveHeightRH2000: mesh.eaveHeightRH2000,
      boundaryWallSegmentsMeaning: 'supported source boundary at roof height, without inferred facade surfaces' },
  };
});

const payload = {
  schemaVersion: 1, groundId: 'lidingo', purpose: 'Editable local Blender reference workspace',
  frame: { horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613 / RH2000', units: 'metres',
    eastingOrigin: E0, northingOrigin: N0, heightOriginRH2000: H0,
    axes: { X: 'east', Y: 'north', Z: 'up' },
    transform: 'X=E-677700.5; Y=N-6586399.5; Z=heightRH2000-25',
    appTransform: 'X=app.x; Y=-app.z; Z=app.y-25',
    appTerrainBridgeOriginHeightRH2000: report.frame.origin.heightRH2000,
    note: 'The -0.05 m v2 bridge origin is metadata only; fixture heights already use RH2000. No extra -0.05 m shift.' },
  sourceFiles: inputs, mappedBoundsEpsg3006: mappedBounds,
  terrain, architectureMeshes, sourceRoofMeshes, buildingFootprints, facilities, supplementaryReferences,
  withheldRoofs: roofsSource.withheld,
  limitations: [
    'Architectural details and courtyard terraces are the existing display estimates; importing them does not verify them as measurements.',
    'Facility outlines retain their dated source metadata, including 2019 orthophoto interpretation and its uncertainty.',
    'Source roof TIN is dated 2021-03-23; its unsupported regions and withheld sixth roof remain unknown.',
    'No new range poles, nets, mats, equipment, doors or windows are inferred by this export.',
    'Terrain preview is sampled at 2 m; outline and architecture heights use the published 1 m grid.',
    'Supplementary OSM context contains one nearby building, two parking areas, one fence and ten access lines; club ownership, current use, widths and heights are not inferred.',
  ],
};
assert.equal(buildingFootprints.length, 6);
assert.equal(facilities.length, 14);
assert.equal(sourceRoofMeshes.length, 5);
assert.equal(sourceRoofMeshes.reduce((n, m) => n + m.triangleIndices.length / 3, 0), 7069);
const checks = [
  'Every existing display triangle reconstructed exactly after material/part grouping and coordinate transformation.',
  'Source roof vertex arrays and triangle indices match all five shipping roof meshes exactly.',
  'All 14 facility geometries retain every original polygon, ring and interior hole.',
  'All six retained building footprints have terrain heights; the sixth roof remains withheld.',
  'Every terrain and outline height is finite and covered by checksummed published 1 m terrain.',
  'Extended terrain sampler agrees exactly with the architecture fixture at every building footprint vertex.',
  'Ground manifest hash and every selected encoded/decoded terrain chunk verified.',
  'Supplementary OSM context retains one building footprint, two parking polygons, one fence line and ten access lines within terrain coverage.',
];
let horizontalRoundTripMaximumMetres = 0;
facilities.forEach((f, i) => {
  const original = polygons(facilitiesSource.features[i].geometry);
  assert.equal(f.polygons.length, original.length);
  f.polygons.forEach((p, j) => {
    assert.equal(p.rings.length, original[j].length);
    p.rings.forEach((ring, k) => {
      assert.equal(ring.length, original[j][k].length);
      ring.forEach(([x, y, z], n) => {
        const [e, north] = original[j][k][n];
        assert.ok(Number.isFinite(z));
        horizontalRoundTripMaximumMetres = Math.max(horizontalRoundTripMaximumMetres, Math.abs(x + E0 - e), Math.abs(y + N0 - north));
      });
    });
  });
});
supplementaryReferences.forEach((f, i) => {
  const geometry = extraSources[i].feature.geometry;
  const original = geometry.type === 'Polygon' ? geometry.coordinates : [geometry.coordinates];
  assert.equal(f.rings.length, original.length);
  f.rings.forEach((ring, j) => {
    assert.equal(ring.length, original[j].length);
    ring.forEach(([x, y, z], k) => {
      assert.ok(Number.isFinite(z));
      assert.deepEqual([x + E0, y + N0], original[j][k]);
    });
  });
});
assert.equal(horizontalRoundTripMaximumMetres, 0);
for (const mesh of [terrain, ...architectureMeshes, ...sourceRoofMeshes]) {
  assert.ok(mesh.vertices.every(v => v.length === 3 && v.every(Number.isFinite)), mesh.id);
  assert.equal(mesh.triangleIndices.length % 3, 0);
  assert.ok(mesh.triangleIndices.every(i => Number.isSafeInteger(i) && i >= 0 && i < mesh.vertices.length), mesh.id);
}
const outputPath = `${OUTPUT}/model-reference.json`, bytes = Buffer.from(JSON.stringify(payload));
fs.mkdirSync(path.join(ROOT, OUTPUT), { recursive: true });
fs.writeFileSync(path.join(ROOT, outputPath), bytes);
const validation = {
  schemaVersion: 1, groundId: 'lidingo', status: 'passed',
  output: { path: outputPath, bytes: bytes.length, sha256: sha256Bytes(bytes) },
  frame: payload.frame, mappedBoundsEpsg3006: mappedBounds,
  terrain: { boundsEpsg3006: requestedBounds, sourceSpacingMetres: 1, exportedSpacingMetres: 2,
    vertices: terrain.vertices.length, triangles: terrain.triangleIndices.length / 3,
    chunkCount: tiles.length, chunkSha256: tiles.map(t => t.layers.terrain.sha256),
    fixtureTerrainChunkSha256: fixtureTerrainHashes, maximumFixtureDifferenceMetres },
  architecture: architectureCounts, sourceRoofBuildings: sourceRoofMeshes.length,
  sourceRoofTriangles: sourceRoofMeshes.reduce((n, m) => n + m.triangleIndices.length / 3, 0),
  retainedBuildingFootprints: buildingFootprints.length, facilityOutlines: facilities.length,
  supplementaryReferences: supplementaryReferences.map(f => ({ id: f.id, geometryType: f.geometryType, closed: f.closed })),
  facilityInteriorRings: facilities.reduce((n, f) => n + f.polygons.reduce((n, p) => n + p.rings.length - 1, 0), 0),
  horizontalRoundTripMaximumMetres, checks, sourceFiles: inputs, limitations: payload.limitations,
};
const validationText = JSON.stringify(validation, null, 2) + '\n';
fs.writeFileSync(path.join(ROOT, OUTPUT, 'model-reference-validation.json'), validationText);
fs.writeFileSync(path.join(ROOT, 'lidingobuild/facilities/model-reference-validation.json'), validationText);
console.log(JSON.stringify({ status: validation.status, output: validation.output, terrainTriangles: validation.terrain.triangles,
  architecture: architectureCounts.map(({ buildingId, meshes, triangles }) => ({ buildingId, meshes, triangles })),
  sourceRoofTriangles: validation.sourceRoofTriangles, footprints: buildingFootprints.length,
  facilities: facilities.length, facilityInteriorRings: validation.facilityInteriorRings }, null, 2));
