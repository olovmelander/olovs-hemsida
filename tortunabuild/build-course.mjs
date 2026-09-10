/* Deterministic source authoring. Master input remains projected; the GPK1
 * model is an exact-offset adapter, never a second interpretation of geography. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { centroid, pointInPoly, polyArea, polyLen, quantizeHF } from '../geobuild/lib.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';
import { TORTUNA_GROUND_GRAPH_CONFIG as TERRAIN, assertTortunaAcquisition } from '../packages/course-v2/tortuna-ground-graph.mjs';
import { TORTUNA_FRAME as FRAME, local, projected } from './frame.mjs';
import { measuredRoofGeometry } from '../apps/golf/src/engine/measured-roof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const round = value => Math.round(value * 10) / 10;
const sourceId = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: source feature identity is required`); return value; };
const provenance = feature => Object.fromEntries(['sourceFeatureId', 'sourceSha256', 'sourceTimestamp', 'reviewStatus', 'horizontalUncertaintyMetres', 'widthStatus', 'appearanceStatus', 'dimensionStatus', 'teeRole', 'clippedToMeasuredTerrain', 'clippedBoundaryIsPhysicalEdge'].filter(key => feature[key] !== undefined).map(key => [key, feature[key]]));

function sourceLine(feature) {
  if (!Array.isArray(feature.line) || feature.line.length < 2 || (feature.widthMetres !== undefined && (!Number.isFinite(feature.widthMetres) || feature.widthMetres <= 0 || feature.widthMetres > 30))) throw new Error(`${feature.id}: line geometry or width is invalid`);
  return { ...provenance(feature), id: sourceId(feature.id, 'line'), sourceId: sourceId(feature.sourceId, feature.id),
    line: feature.line.map(value => localPoint(value, feature.id)),
    ...(feature.widthMetres !== undefined ? { widthMetres: feature.widthMetres } : {}) };
}

export function adoptMeasuredRoof(source, heightAt) {
  if (!source?.sourceEpoch || !source.mesh || source.verticalCrs && source.verticalCrs !== 'EPSG:5613') throw new Error('Measured roof requires dated RH 2000 source geometry');
  const roofPoint = value => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error('Measured roof requires finite EPSG:3006/RH2000 coordinates');
    const c = localPoint(value.slice(0, 2), source.id);
    const ground = heightAt(...c);
    if (!Number.isFinite(ground) || value[2] <= ground || value[2] - ground > 80) throw new Error(`${source.id}: measured roof has invalid terrain clearance`);
    return { c, heightRH2000: value[2] };
  };
  const surface = { sourceId: sourceId(source.sourceId, source.id), sourceEpoch: source.sourceEpoch,
    state: source.state, verticalCrs: 'EPSG:5613', notSurveyed: true,
    coverageFraction: source.mesh.statistics?.footprintCoverageFraction,
    vertices: source.mesh.verticesEpsg3006RH2000.map(roofPoint), triangleIndices: [...source.mesh.triangleIndices],
    boundaryWallSegments: source.mesh.boundaryWallSegmentsEpsg3006RH2000.map(segment => segment.map(roofPoint)),
    facadeStatus: 'neutral-rendering-material; architecture and unsupported perimeter unmeasured' };
  if (!surface.triangleIndices.length) throw new Error('Measured roof has no supported triangles');
  measuredRoofGeometry(surface, heightAt);
  return surface;
}

export function localPoint(value, label) {
  if (!point(value)) throw new Error(`${label}: expected finite EPSG:3006 point`);
  const result = local(value);
  if (result.some(coordinate => Math.abs(coordinate) > 2048)) throw new Error(`${label}: point leaves acquired terrain`);
  return result;
}

export function localRing(ring, label) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point) || ring[0].some((value, index) => value !== ring.at(-1)[index])) throw new Error(`${label}: source ring must be closed finite EPSG:3006 coordinates`);
  const converted = ring.map(value => localPoint(value, label));
  if (Math.abs(polyArea(converted)) < 1) throw new Error(`${label}: source ring has negligible area`);
  return converted;
}

function interior(ring, label) {
  const value = centroid(ring);
  if (!pointInPoly(...value, ring)) throw new Error(`${label}: an explicit interior reference is required`);
  return value;
}

export async function verifyInputSources(input, root = ROOT) {
  if (!Array.isArray(input.inputs) || !input.inputs.length) throw new Error('Tortuna input must retain source checksums');
  for (const source of input.inputs) {
    const target = path.resolve(root, source.path || '');
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !/^[a-f0-9]{64}$/.test(source.sha256 || '')) throw new Error('Tortuna source input path or checksum is invalid');
    if (sha256(await readFile(target)) !== source.sha256) throw new Error(`Tortuna source input changed at ${source.path}`);
  }
}

export function createTerrainSampler(fine) {
  if (!(fine instanceof Float32Array) || fine.length !== TERRAIN.width * TERRAIN.height) throw new Error('Tortuna native terrain raster size differs');
  return (x, z) => {
    const col = x + 2048, row = z + 2048;
    if (![col, row].every(Number.isFinite) || col < 0 || row < 0 || col > 4096 || row > 4096) throw new Error('Height query leaves acquired Tortuna grid');
    const c = Math.min(4095, Math.floor(col)), r = Math.min(4095, Math.floor(row)), u = col - c, v = row - r;
    const k = r * 4097 + c;
    const value = (fine[k] * (1 - u) + fine[k + 1] * u) * (1 - v) + (fine[k + 4097] * (1 - u) + fine[k + 4098] * u) * v;
    if (!Number.isFinite(value)) throw new Error('Tortuna sampled a missing native terrain height');
    return value;
  };
}

export function createCourseModel(input, heightAt) {
  if (input?.schemaVersion !== 1 || input.groundId !== 'tortuna' || input.horizontalCrs !== 'EPSG:3006') throw new Error('Tortuna course input requires the explicit projected frame');
  const card = input.card;
  if (!card || typeof card.source !== 'string' || !Array.isArray(card.teeNames) || !card.teeNames.length || card.teeNames.some(name => typeof name !== 'string' || !name.trim())) throw new Error('Tortuna needs sourced card metadata and tee names');
  if (!Array.isArray(input.holes) || input.holes.length !== 18) throw new Error('Tortuna needs every hole 1–18');
  const sourceRings = (features, label) => (features || []).map(feature => ({ ...provenance(feature), ring: localRing(feature.ring, label), sourceFeatureId: sourceId(feature.sourceFeatureId, label) }));
  const holes = input.holes.map((h, index) => {
    const label = `Tortuna hole ${index + 1}`;
    if (h.number !== index + 1 || !Number.isInteger(h.par) || h.par < 3 || h.par > 6 || !['verified', 'unverified'].includes(h.strokeIndexStatus)) throw new Error(`${label}: routing/card identity differs`);
    if (h.strokeIndex !== null && (!Number.isInteger(h.strokeIndex) || h.strokeIndex < 1 || h.strokeIndex > 18)) throw new Error(`${label}: invalid stroke index`);
    if (h.strokeIndexStatus === 'verified' && h.strokeIndex === null) throw new Error(`${label}: verified stroke index is missing`);
    if (!Array.isArray(h.teeLengths) || h.teeLengths.length !== card.teeNames.length || h.teeLengths.some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`${label}: card tee lengths differ`);
    if (!Array.isArray(h.line) || h.line.length < 2) throw new Error(`${label}: source route is missing`);
    const line = h.line.map(value => localPoint(value, label));
    if (polyLen(line) < 1) throw new Error(`${label}: source route has negligible length`);
    const green = sourceRings([h.green], `${label} green`)[0];
    const pin = h.pin ? localPoint(h.pin, `${label} target`) : interior(green.ring, `${label} green`);
    if (!pointInPoly(...pin, green.ring)) throw new Error(`${label}: virtual target must be inside its source green`);
    const pads = sourceRings(h.teePlatforms, `${label} tee`).map(pad => ({ ...pad, preserveTerrain: true }));
    const fairways = sourceRings(h.fairways, `${label} fairway`);
    const references = h.teeReferences || (pads.length === 1 ? card.teeNames.map(() => projected(interior(pads[0].ring, `${label} tee`))) : null);
    if (!Array.isArray(references) || references.length !== card.teeNames.length) throw new Error(`${label}: explicit sourced tee camera references are required`);
    const marks = references.map((value, tee) => ({ c: localPoint(value, `${label} tee reference`), b: 0, m: h.teeLengths[tee], placement: h.teeReferenceStatus || 'nominal-camera-reference-on-observed-platform; colour position unverified' }));
    if (!pads.length && !h.teeReferenceStatus) throw new Error(`${label}: unverified tee references need source/status description`);
    const teeHeight = heightAt(...marks[Math.min(1, marks.length - 1)].c), greenHeight = heightAt(...pin);
    return { n: h.number, par: h.par, idx: h.strokeIndex, strokeIndexStatus: h.strokeIndexStatus, t: [...h.teeLengths],
      line, lineLen: polyLen(line), sourceFeatureId: sourceId(h.sourceFeatureId, label), pin,
      green: { ...green, c: pin }, fairway: { rings: fairways.map(feature => feature.ring), sourceFeatureIds: fairways.map(feature => feature.sourceFeatureId) },
      tees: { inferPads: false, pads, marks }, bunkers: sourceRings(h.bunkers, `${label} bunker`),
      elev: { tee: round(teeHeight), green: round(greenHeight), rise: round(greenHeight - teeHeight) },
      tiers: 1, name: h.name || null, note: h.note || 'Preliminär källbaserad karta. Flaggposition och färgade teemarkeringar är inte inmätta.',
      confidence: 'source-derived-candidate-not-surveyed', pinStatus: 'virtual-green-target; daily flag location unknown' };
  });
  if (holes.reduce((total, hole) => total + hole.par, 0) !== card.par) throw new Error('Tortuna scorecard par total differs');
  if (card.teeTotals && (card.teeTotals.length !== card.teeNames.length || card.teeTotals.some((total, tee) => total !== holes.reduce((sum, hole) => sum + hole.t[tee], 0)))) throw new Error('Tortuna scorecard tee totals differ');
  const verifiedIndices = holes.filter(hole => hole.strokeIndexStatus === 'verified').map(hole => hole.idx);
  if (new Set(verifiedIndices).size !== verifiedIndices.length) throw new Error('Tortuna verified stroke indices repeat');
  const water = (input.water || []).map(feature => {
    if (feature.rings?.length !== 1) throw new Error(`${feature.id}: compatibility water cannot discard islands`);
    if (!Number.isFinite(feature.heightRH2000)) throw new Error(`${feature.id}: source water level is required`);
    const ring = localRing(feature.rings[0], feature.id);
    return { id: feature.id, sourceId: sourceId(feature.sourceId, feature.id), ring, level: feature.heightRH2000, isLake: true, isSea: false, area: Math.abs(polyArea(ring)), clipBoundaryIsShore: false };
  });
  const infra = { paths: [], tracks: [], roads: [], buildings: [], farB: [], parking: [], piers: [], basins: [], pitches: [], landuse: [], reserves: [], power: { lines: [], towers: [], poles: [] }, railway: [], objectPlacement: 'mapped-only', bridgePlacement: 'mapped-only', vegetationPlacement: 'measured-only', terrainPlacement: 'measured-only', preserveMappedBoundaries: true };
  for (const b of input.buildings || []) {
    if (b.heightMetres !== undefined && (!Number.isFinite(b.heightMetres) || b.heightMetres <= 0 || b.heightMetres > 80)) throw new Error(`${b.id}: building height is invalid`);
    infra.buildings.push({ ...provenance(b), id: b.id, ring: localRing(b.ring, b.id), sourceId: sourceId(b.sourceId, b.id), h: b.heightMetres ?? 5, kind: b.kind || 'house', name: b.name || null, ...(b.amenity ? { amenity: b.amenity } : {}), heightStatus: b.heightStatus || 'generic-rendering-height-not-measured' });
  }
  for (const p of input.paths || []) {
    const network = p.network || 'paths';
    if (!['paths', 'tracks', 'roads'].includes(network)) throw new Error(`${p.id}: unsupported transport network`);
    infra[network].push({ ...sourceLine(p), kind: p.kind || p.highway || 'path', surface: p.surface || p.material || 'unknown', widthStatus: p.widthStatus || 'generic-rendering-width-not-measured' });
  }
  for (const f of input.landuse || []) infra.landuse.push({ ...provenance(f), id: f.id, ring: localRing(f.ring, f.id), kind: f.kind, sourceId: sourceId(f.sourceId, f.id),
    // Exact hole-preserving partitions of one field share one display colour.
    appearanceSeed: parseInt(sha256(f.sourceFeatureId || f.id).slice(0, 8), 16) / 0xffffffff });
  for (const f of input.railways || []) {
    if (f.inferMasts !== false) throw new Error(`${f.id}: railway must not infer unsupported masts`);
    infra.railway.push({ ...sourceLine(f), kind: 'rail', inferMasts: false });
  }
  for (const f of input.powerLines || []) infra.power.lines.push({ ...sourceLine(f), ...(f.voltage ? { voltage: f.voltage } : {}) });
  for (const f of input.powerSupports || []) {
    if (!['tower', 'pole'].includes(f.kind)) throw new Error(`${f.id}: explicit power support type required`);
    infra.power[f.kind === 'tower' ? 'towers' : 'poles'].push({ ...provenance(f), id: f.id, c: localPoint(f.c, f.id), sourceId: sourceId(f.sourceId, f.id) });
  }
  const streams = (input.streams || []).map(f => ({ ...sourceLine(f), kind: f.kind || f.waterway || 'stream', w: (f.widthMetres || 2) / 2,
    waterSurfaceStatus: f.waterSurfaceStatus || 'unknown; source centreline context only', contextOnly: true }));
  const clearfells = (input.clearfells || []).map(f => {
    if (f.canopyExclusion !== false) throw new Error(`${f.id}: ground-cover observation cannot erase measured canopy`);
    return localRing(f.ring, f.id);
  });
  const vegetation = Object.fromEntries(['forest', 'wood', 'scrub', 'wetland', 'sand', 'rock'].map(kind => [kind, sourceRings(input.vegetation?.[kind], kind).map(feature => feature.ring)]));
  const scenery = { greens: [], fairways: [], tees: [], bunkers: [], grass: [], range: [], practiceGreens: [], mappedFeatures: [], rangeFacilities: null, cartPark: null };
  for (const f of input.facilities || []) {
    const rings = f.rings.map(ring => localRing(ring, f.id));
    sourceId(f.sourceId, f.id);
    const provenance = Object.fromEntries(['parentFacilityId', 'sourceSha256', 'observedYear', 'reviewStatus', 'horizontalUncertaintyMetres', 'materialStatus'].filter(key => f[key] !== undefined).map(key => [key, f[key]]));
    if (f.kind === 'range_field') { if (rings.length !== 1) throw new Error(`${f.id}: range cannot discard exclusions`); scenery.range.push(rings[0]); }
    else if (f.kind === 'parking') {
      if (rings.length !== 1) throw new Error(`${f.id}: parking cannot discard exclusions`);
      infra.parking.push({ id: f.id, ring: rings[0], sourceId: f.sourceId, surface: f.material || 'unknown', cars: false, notSurveyed: true, ...provenance });
    } else if (f.kind === 'range_shelter') {
      if (rings.length !== 1) throw new Error(`${f.id}: shelter cannot discard exclusions`);
      const height = f.heightMetres ?? f.displayHeightMetres ?? 3;
      if (!Number.isFinite(height) || height <= 0 || height > 20) throw new Error(`${f.id}: shelter display height is invalid`);
      infra.buildings.push({ id: f.id, ring: rings[0], sourceId: f.sourceId, h: height, kind: 'shed', name: 'Driving range shelter', heightStatus: f.heightStatus || 'estimated-rendering-height-not-measured', notSurveyed: true, ...provenance });
    } else {
      scenery.mappedFeatures.push({ id: f.id, kind: f.kind === 'range_target' ? 'range_target_surface' : f.kind, rings, material: f.material, sourceId: f.sourceId, notSurveyed: true, ...provenance });
      if (f.kind === 'practice_green') scenery.practiceGreens.push(rings[0]);
    }
  }
  const roofIds = new Set();
  for (const source of input.buildingRoofs || []) {
    if (roofIds.has(source.id)) throw new Error(`Duplicate measured roof ${source.id}`);
    roofIds.add(source.id);
    const building = infra.buildings.find(b => b.id === source.id);
    if (!building) throw new Error(`Measured roof has no source building ${source.id}`);
    building.roofSurface = adoptMeasuredRoof(source, heightAt);
    delete building.h;
    building.heightStatus = 'measured-2021-roof-TIN; unsupported regions remain omitted';
  }
  return { version: 1, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLat: 111320, mPerLon: +(111320 * Math.cos(FRAME.latitude * Math.PI / 180)).toFixed(2), frame: FRAME.text,
    seaLevel: 0, holes, water, streams, coast: [], vegetation, infra, surround: { clearfells, yard: null, hayfields: null, shallows: [] }, scenery, pois: [],
    evidence: { status: 'provisional-source-derived', terrain: TERRAIN.sourceFloat32Sha256, input: 'tortunabuild/mapping/course-input.json', terrainModifiedForPlayingSurfaces: false, flagPositions: 'virtual green targets', colouredTeePositions: 'unknown; source camera references only', canonicalOriginApproval: 'pending-independent-control', limitations: input.notes || [] } };
}

export function projectedCourseModel(model, modelSha256) {
  const geometry = { holes: structuredClone(model.holes) };
  // Live models can share a pin with the green centre. structuredClone retains
  // those references, so each coordinate array must be projected only once.
  const transformed = new Set();
  for (const { pair } of collectCoordinatePairs(geometry).coordinates) {
    if (transformed.has(pair)) continue;
    transformed.add(pair);
    [pair[0], pair[1]] = projected(pair);
  }
  return { schemaVersion: 1, generator: 'tortuna/source-authoring@1', groundId: 'tortuna', source: { path: 'tortunabuild/course-model.json', sha256: modelSha256 },
    target: { horizontalCrs: 'EPSG:3006', coordinateOrder: ['easting', 'northing'], verticalStatus: 'RH2000-from-native-DTM', approvalStatus: 'provisional-pending-independent-control' }, geometry };
}

export async function buildCourse({ root = ROOT } = {}) {
  const inputPath = path.join(root, 'tortunabuild/mapping/course-input.json');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  await verifyInputSources(input, root);
  const bytes = await readFile(path.join(root, 'tortunabuild/cache/terrain/terrain-1m.f32'));
  const receipt = JSON.parse(await readFile(path.join(root, 'geo_data/course-v2/tortuna/acquisition/terrain-window.json'), 'utf8'));
  assertTortunaAcquisition(receipt, sha256(bytes));
  const fine = new Float32Array(TERRAIN.width * TERRAIN.height);
  for (let i = 0; i < fine.length; i++) fine[i] = bytes.readFloatLE(i * 4);
  const model = createCourseModel(input, createTerrainSampler(fine));
  const field = spacing => { const size = 4096 / spacing + 1, values = new Float32Array(size * size); for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) values[r * size + c] = fine[r * spacing * 4097 + c * spacing]; return { x0: -2048, z0: -2048, dx: spacing, ...quantizeHF(values, size, size, 0.1) }; };
  const modelText = JSON.stringify(model, null, 2) + '\n';
  const outputs = [
    ['tortunabuild/course-model.json', modelText],
    ['tortunabuild/card.json', { teeNames: input.card.teeNames, source: input.card.source, holes: model.holes.map(h => ({ n: h.n, par: h.par, hcp: h.idx, t: h.t })) }],
    ['tortunabuild/heightfields.json', { source: { product: 'Lantmäteriet Markhöjdmodell 1 m', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', fineInputSha256: TERRAIN.sourceFloat32Sha256, note: 'Both compatibility levels sample the same retained native raster; v2 retains all 1 m samples.' }, hf0: field(4), hf1: field(16) }],
    ['geo_data/course-v2/tortuna/migration/course-model.epsg3006.json', projectedCourseModel(model, sha256(modelText))],
  ];
  for (const [relative, value] of outputs) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); }
  console.log(JSON.stringify({ holes: model.holes.length, par: input.card.par, nativeSamples: fine.length, modelSha256: sha256(modelText), status: 'provisional-source-derived' }));
  return model;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCourse().catch(error => { console.error(error); process.exitCode = 1; });
