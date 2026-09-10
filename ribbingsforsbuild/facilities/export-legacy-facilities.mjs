/* Read-only source snapshot and 1 m terrain extraction for the Blender workspace. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from '../laser-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'reference');
fs.mkdirSync(out, { recursive: true });
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const model = read('ribbingsforsbuild/course-model.json');
const traces = read('ribbingsforsbuild/surroundings-traces.json');
const heightfields = read('ribbingsforsbuild/heightfields.json');
const terrain = loadTerrain();
const round = x => Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
const centre = ring => {
  const p = JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1)) ? ring.slice(0, -1) : ring;
  return [0, 1].map(i => round(p.reduce((s, q) => s + q[i], 0) / p.length));
};
const area = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - p[1] * q[0];
}, 0) / 2);
const bounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
  minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const sampled = ring => {
  const c = centre(ring); const heights = ring.map(p => round(terrain.hAt(...p)));
  const valid = heights.filter(Number.isFinite);
  return { anchorLocalXZ: c, anchorBlenderXY: [c[0], -c[1]], anchorGroundRH2000M: round(terrain.hAt(...c)),
    vertexGroundRH2000M: heights, minimumVertexGroundRH2000M: valid.length ? Math.min(...valid) : null,
    maximumVertexGroundRH2000M: valid.length ? Math.max(...valid) : null };
};
const geometry = ring => ({ ringLocalXZ: ring, footprintBlenderXY: ring.map(([x, z]) => [x, -z]),
  boundsLocalXZ: bounds(ring), areaM2: round(area(ring)), ...sampled(ring) });
const frame = { kind: 'epsg3006-local-rh2000', originEpsg3006: { easting: 448975.5, northing: 6536024.5 },
  blenderAxes: 'X east, Y north, Z absolute RH2000 metres', runtimeAxes: 'X east, Y absolute RH2000, Z south',
  blenderFromRuntime: '[x, -z, heightRH2000]', runtimeFromBlender: '[X, Z, -Y]',
  horizontalRotationRadians: 0, verticalDatumOffsetMetres: 0 };
const traceById = new Map(traces.features.buildings.map(b => [b.id, b]));
traces.features.yard.buildings.forEach((b, i) => traceById.set(`ribbingsfors-yard-${i}`,
  { ...b, confidence: traces.features.yard.confidence }));
const buildings = model.infra.buildings.map(b => {
  const source = traceById.get(b.id);
  return { id: b.id, kind: b.kind, name: b.name, amenity: b.amenity,
    modelPriority: b.id.startsWith('ribbingsfors-') ? 'facilities' : 'surrounding-context',
    source: b.prov || 'OpenStreetMap footprint; no measured architectural height',
    confidence: source?.confidence ?? (b.id.startsWith('ribbingsfors-yard-') ? traces.features.yard.confidence : 'unreviewed-osm'),
    legacyWallHeightEstimateM: b.h, legacyDimensionsEstimateM: source ? [source.w, source.d] : null,
    legacyRuntimeRotationRadians: source?.rot ?? null, legacyBlenderRotationRadians: source ? -source.rot : null,
    ...geometry(b.ring) };
});
const facilityGround = buildings.filter(b => b.modelPriority === 'facilities').map(b => ({ id: b.id,
  anchorLocalXZ: b.anchorLocalXZ, anchorBlenderXY: b.anchorBlenderXY, anchorGroundRH2000M: b.anchorGroundRH2000M,
  vertexGroundRH2000M: b.vertexGroundRH2000M, minimumVertexGroundRH2000M: b.minimumVertexGroundRH2000M,
  maximumVertexGroundRH2000M: b.maximumVertexGroundRH2000M }));
const near = p => (p[0] >= 400 && p[0] <= 1000 && p[1] >= -720 && p[1] <= -100)
  || (p[0] >= -425 && p[0] <= -255 && p[1] >= 90 && p[1] <= 280);
const lineFeatures = key => (model.infra[key] || []).filter(f => f.line?.some(near)).map(f => ({ ...f,
  lineLocalXZ: f.line, lineBlenderXY: f.line.map(([x, z]) => [x, -z]),
  vertexGroundRH2000M: f.line.map(p => round(terrain.hAt(...p))) }));
const legacy = { schemaVersion: 1, groundId: 'ribbingsfors', generatedAt: new Date().toISOString(), coordinateFrame: frame,
  purpose: 'Source snapshot for reference-based Blender modelling; legacy imagery geometry is provisional and must be checked against new orthophoto.',
  receipts: ['ribbingsforsbuild/course-model.json', 'ribbingsforsbuild/surroundings-traces.json'].map(p => ({ path: p, sha256: hash(p) })),
  buildingCount: buildings.length, priorityBuildingCount: facilityGround.length, buildings,
  practiceGreens: model.scenery.greens.map((ring, i) => ({ id: `ribbingsfors-practice-green-${i}`,
    source: traces.features.practiceGreens[i]?.prov, shapeStatus: 'Circle derived from detected area; boundary is not a traced green contour', ...geometry(ring) })),
  drivingRange: { id: 'ribbingsfors-driving-range', ...geometry(model.scenery.range[0]),
    source: traces.features.range.prov, areaFromSourceM2: 40163,
    rangeTee: model.scenery.rangeTee, rangeFacilities: model.scenery.rangeFacilities,
    baysStatus: 'Unresolved: raw bench candidate [600.5,-446.2] was rejected by reviewed surroundings-traces.json',
    baysNote: traces.features.range.baysNote,
    deprecatedSourceRing: traces.features.range.sourceRing,
    caution: 'Correct field is EAST of hole 1. Deprecated field between holes 9 and 1 was a hayfield and must not be restored.' },
  parking: model.infra.parking.map(p => ({ id: p.id, surface: p.surface, ...geometry(p.ring) })),
  maintenanceYard: { id: 'ribbingsfors-maintenance-yard', source: traces.features.yard.prov, ...geometry(traces.features.yard.ring) },
  manorPrecinct: { id: 'ribbingsfors-manor-precinct', source: traces.features.manorPrecinct.prov,
    buildingStatus: 'Precinct landuse is present, but manor house and wings have no model.infra.buildings polygons in this snapshot.', ...geometry(traces.features.manorPrecinct.ring) },
  roads: lineFeatures('roads'), tracks: lineFeatures('tracks'), paths: lineFeatures('paths'),
  walls: traces.features.walls.map((f, i) => ({ id: `ribbingsfors-wall-${i}`, ...f,
    lineBlenderXY: f.line.map(([x, z]) => [x, -z]), vertexGroundRH2000M: f.line.map(p => round(terrain.hAt(...p))) })),
};
fs.writeFileSync(path.join(out, 'legacy-facilities.json'), JSON.stringify(legacy, null, 2) + '\n');

const panels = [
  { id: 'clubhouse-range-estate', x0: 400, x1: 1000, z0: -720, z1: -100 },
  { id: 'maintenance-yard', x0: -425, x1: -255, z0: 90, z1: 280 },
].map(p => {
  const width = p.x1 - p.x0 + 1, height = p.z1 - p.z0 + 1; const heightsRH2000M = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const h = round(terrain.hAt(p.x0 + c, p.z0 + r));
    if (!Number.isFinite(h)) throw new Error(`Missing terrain in ${p.id} at ${c},${r}`);
    heightsRH2000M.push(h);
  }
  return { ...p, width, height, spacingM: 1, sampleOrder: 'row-major; column increases east, row increases south',
    blenderSample: '[x0 + column, -(z0 + row), heightsRH2000M[row * width + column]]', heightsRH2000M };
});
const ground = { schemaVersion: 1, groundId: 'ribbingsfors', generatedAt: new Date().toISOString(), coordinateFrame: frame,
  source: { ...heightfields.source, usedSource: 'Published course v2 level-0 terrain chunks decoded by ribbingsforsbuild/laser-lib.mjs',
    level0Tiles: terrain.tiles, sourceGridMetres: 1, sampleRoundingMetres: .001, fallbackUsed: false,
    note: 'Authoritative ground surface, not roof elevations. Architectural eave/ridge heights remain estimates unless separately measured.' },
  panels, facilityGround };
fs.writeFileSync(path.join(out, 'facility-ground.json'), JSON.stringify(ground) + '\n');
console.log(JSON.stringify({ buildings: buildings.length, priorityBuildings: facilityGround.length,
  panels: panels.map(({ id, width, height }) => ({ id, width, height })),
  files: ['legacy-facilities.json', 'facility-ground.json'].map(name => ({ name, bytes: fs.statSync(path.join(out, name)).size })) }));
