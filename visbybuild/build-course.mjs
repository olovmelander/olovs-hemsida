/* Visby source authoring adapter. Canonical vectors remain in EPSG:3006.
   This compatibility model uses exact projected offsets and samples the actual
   acquired DTM; scorecard lengths never move geometry or alter terrain. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { centroid, pointInPoly, polyArea, polyLen, quantizeHF } from '../geobuild/lib.mjs';
import { VISBY_GROUND_GRAPH_CONFIG as TERRAIN, assertVisbyAcquisition } from '../packages/course-v2/visby-ground-graph.mjs';
import { VISBY_FRAME as FRAME, local } from './frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
const write = (relative, value) => writeFile(path.join(ROOT, relative), `${JSON.stringify(value, null, 2)}\n`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const r1 = value => Math.round(value * 10) / 10;

export function localRing(ring, label, minimumAreaSquareMetres = 1) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point) ||
      ring[0].some((value, index) => Math.abs(value - ring.at(-1)[index]) > 1e-6)) throw new Error(`${label}: observed ring must be closed finite EPSG:3006 coordinates`);
  const result = ring.map(local);
  if (Math.abs(polyArea(result)) < minimumAreaSquareMetres) throw new Error(`${label}: observed ring has negligible area`);
  if (result.some(([x, z]) => Math.abs(x) > 2048 || Math.abs(z) > 2048)) throw new Error(`${label}: observed ring leaves acquired terrain`);
  return result;
}

function interiorCentre(ring, label) {
  const centre = centroid(ring);
  if (!pointInPoly(...centre, ring)) throw new Error(`${label}: centroid is outside its ring; provide an explicit interior reference`);
  return centre;
}

export function makeHeightSampler(fine) {
  if (!(fine instanceof Float32Array) || fine.length !== TERRAIN.width * TERRAIN.height || !fine.every(Number.isFinite)) throw new Error('Visby terrain must retain every finite acquired source sample');
  return (x, z) => {
    const col = x + 2048, row = z + 2048;
    if (!Number.isFinite(col) || !Number.isFinite(row) || col < 0 || row < 0 || col > 4096 || row > 4096) throw new Error('Height query leaves acquired 1 m Visby terrain');
    const c0 = Math.min(4095, Math.floor(col)), r0 = Math.min(4095, Math.floor(row));
    const u = col - c0, v = row - r0, k = r0 * 4097 + c0;
    return (fine[k] * (1 - u) + fine[k + 1] * u) * (1 - v) + (fine[k + 4097] * (1 - u) + fine[k + 4098] * u) * v;
  };
}

export function buildHoles(card, geometry, heightAt) {
  if (geometry?.groundId !== 'visby' || geometry.courseSlug !== 'visby' || geometry.horizontalCrs !== 'EPSG:3006' ||
      JSON.stringify(geometry.axisOrder) !== JSON.stringify(['easting', 'northing'])) throw new Error('Visby geometry requires its declared ground, course and EPSG:3006 axis order');
  if (card.holes?.length !== 18 || geometry.holes?.length !== 18 ||
      JSON.stringify(card.tees?.map(tee => tee.name)) !== JSON.stringify(['63', '59', '55', '51', '46', '41'])) throw new Error('Visby requires all 18 holes and its six actual numeric tees');
  const seen = new Set();
  const holes = card.holes.map((row, index) => {
    const matches = geometry.holes.filter(hole => hole.n === row.number);
    if (matches.length !== 1 || row.number !== index + 1 || !Number.isInteger(row.index) || row.index < 1 || row.index > 18 || seen.has(row.index) || ![3, 4, 5].includes(row.par)) throw new Error(`Invalid Visby card/geometry identity at hole ${index + 1}`);
    seen.add(row.index);
    const input = matches[0];
    if (!Array.isArray(input.line) || input.line.length < 2 || !input.line.every(point)) throw new Error(`Hole ${row.number} lacks an observed route`);
    const line = input.line.map(local), lineLen = polyLen(line);
    if (line.some(([x, z]) => Math.abs(x) > 2048 || Math.abs(z) > 2048) || lineLen < 20) throw new Error(`Hole ${row.number} route is outside the terrain or too short`);
    const greenRing = localRing(input.green?.ring, `Hole ${row.number} green`);
    if (input.green.reference && !point(input.green.reference)) throw new Error(`Hole ${row.number} has an invalid green reference`);
    const pin = input.green.reference ? local(input.green.reference) : interiorCentre(greenRing, `Hole ${row.number} green`);
    if (!pointInPoly(...pin, greenRing)) throw new Error(`Hole ${row.number} virtual green target must remain on its observed green`);
    const fairwayRings = (input.fairway?.rings ?? []).map((ring, number) => localRing(ring, `Hole ${row.number} fairway ${number + 1}`));
    const unresolvedPlatform = !input.tees?.pads?.length && row.number === 12 && input.tees?.status === 'unresolved-physical-platform';
    if (!input.tees?.pads?.length && !unresolvedPlatform) throw new Error(`Hole ${row.number} needs at least one observed physical tee platform`);
    let approximateCamera = null;
    if (unresolvedPlatform) {
      if (!point(input.tees.cameraReference) || !Array.isArray(input.tees.sourceIds) || !input.tees.sourceIds.length || !input.tees.sourceIds.every(id => typeof id === 'string' && id.trim()) || Object.keys(input.tees.references ?? {}).length) throw new Error('Hole 12 unresolved platform needs an explicit sourced fairway camera, without numeric tee references');
      approximateCamera = local(input.tees.cameraReference);
      if (!fairwayRings.some(ring => pointInPoly(...approximateCamera, ring))) throw new Error('Hole 12 approximate camera must lie on an observed fairway');
    }
    const pads = input.tees.pads.map((pad, number) => ({ ring: localRing(pad.ring, `Hole ${row.number} tee ${number + 1}`), preserveTerrain: true, sourceIds: pad.sourceIds ?? [] }));
    const centres = pads.map((pad, number) => interiorCentre(pad.ring, `Hole ${row.number} tee ${number + 1}`));
    const nearest = approximateCamera ?? [...centres].sort((a, b) => Math.hypot(a[0] - line[0][0], a[1] - line[0][1]) - Math.hypot(b[0] - line[0][0], b[1] - line[0][1]))[0];
    const t = card.tees.map(tee => row.lengths[tee.id]);
    if (t.some(length => !Number.isInteger(length) || length <= 0)) throw new Error(`Hole ${row.number} official lengths are invalid`);
    const marks = card.tees.map((tee, number) => {
      const reference = input.tees.references?.[tee.id];
      if (reference && !point(reference)) throw new Error(`Hole ${row.number} has an invalid tee reference`);
      const c = reference ? local(reference) : [...nearest];
      if (!unresolvedPlatform && !pads.some(pad => pointInPoly(...c, pad.ring))) throw new Error(`Hole ${row.number} camera reference leaves observed tee platforms`);
      return { c, b: 0, m: t[number], placement: unresolvedPlatform ? 'approximate-flyover-start-on-observed-fairway; physical platform and numeric tee positions unknown' : reference ? 'source-declared-camera-reference; daily marker location unverified' : 'shared-camera-reference-on-observed-platform; numeric tee position unknown' };
    });
    const teeHeight = heightAt(...marks[1].c), greenHeight = heightAt(...pin);
    return { n: row.number, par: row.par, idx: row.index, t, line, lineLen, pin,
      green: { ring: greenRing, c: pin, sourceIds: input.green.sourceIds ?? [] },
      fairway: { rings: fairwayRings },
      tees: { inferPads: false, pads, marks, ...(unresolvedPlatform ? { status: 'unresolved-physical-platform', sourceIds: input.tees.sourceIds } : {}) },
      bunkers: (input.bunkers ?? []).map((bunker, number) => ({ ring: localRing(bunker.ring, `Hole ${row.number} bunker ${number + 1}`), sourceIds: bunker.sourceIds ?? [] })),
      elev: { tee: r1(teeHeight), green: r1(greenHeight), rise: r1(greenHeight - teeHeight) }, tiers: 1, name: null,
      note: (input.notes ?? 'Preliminär 3D-bana från källunderlag. Terräng: Lantmäteriet 1 m. Spelytor och hålrutter behöver fortsatt kontroll. Flaggor och utslagsreferenser är visningspunkter.') + (unresolvedPlatform ? ' Hål 12: utslagsplatsen är ännu inte identifierad. Flygningen startar ungefärligt på observerad fairway.' : ''),
      sourceIds: input.sourceIds ?? [], confidence: 'source-derived-candidate-not-surveyed', pinStatus: 'virtual-green-target; daily flag location unknown' };
  });
  if (holes.reduce((sum, h) => sum + h.par, 0) !== card.par || card.par !== 72) throw new Error('Visby card par must reconcile to 72');
  card.tees.forEach((tee, index) => {
    if (holes.reduce((sum, h) => sum + h.t[index], 0) !== tee.total) throw new Error(`Visby ${tee.name} tee total differs`);
  });
  return holes;
}

function projectedFeatures(collection, label) {
  if (collection?.type !== 'FeatureCollection' || collection.crs?.properties?.name !== 'EPSG:3006') throw new Error(`${label} must declare EPSG:3006`);
  return collection.features;
}

export async function buildCourse() {
  const bytes = await readFile(path.join(ROOT, 'visbybuild/cache/terrain-review/terrain-1m.f32'));
  assertVisbyAcquisition(await json('geo_data/course-v2/visby/acquisition/terrain-window.json'), hash(bytes), await json('geo_data/course-v2/visby/acquisition/d2-discovery.json'));
  const fine = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const heightAt = makeHeightSampler(fine);
  const card = await json('visbybuild/reference/club-scorecard.json');
  const geometry = await json('visbybuild/mapping/geometry.json');
  const holes = buildHoles(card, geometry, heightAt);
  const context = projectedFeatures(await json(geometry.contextPath ?? 'geo_data/course-v2/visby/mapping/osm-context-epsg3006.geojson'), 'Visby context');
  const vegetation = { forest: [], wood: [], scrub: [], wetland: [], sand: [], rock: [] };
  const infra = { paths: [], tracks: [], roads: [], buildings: [], farB: [], parking: [], piers: [], basins: [], pitches: [], landuse: [], reserves: [], power: { lines: [], towers: [], poles: [] }, railway: [], objectPlacement: 'mapped-only', bridgePlacement: 'mapped-only', vegetationPlacement: 'measured-only', terrainPlacement: 'measured-only', preserveMappedBoundaries: true };
  const scenery = { greens: [], fairways: [], tees: [], bunkers: [], grass: [], range: [], rangeFacilities: null, cartPark: null };
  for (const key of ['greens', 'fairways', 'tees', 'bunkers', 'grass', 'range']) scenery[key] = (geometry.scenery?.[key] ?? []).map((ring, index) => localRing(ring, `${key} ${index + 1}`));
  const streams = [], skippedContext = [];
  for (const feature of context) {
    const tags = feature.properties?.tags ?? {}, g = feature.geometry, id = feature.id;
    const localPoints = g.type === 'Point' ? [local(g.coordinates)] : g.type === 'Polygon' ? g.coordinates.flat().map(local) : g.type === 'LineString' ? g.coordinates.map(local) : [];
    if (localPoints.some(([x, z]) => Math.abs(x) > 2048 || Math.abs(z) > 2048)) { skippedContext.push({ id, reason: 'source geometry extends beyond acquired terrain; not adopted' }); continue; }
    if (g.type === 'Polygon') {
      const relevant = tags.building || tags.amenity === 'parking' || tags.landuse || Object.hasOwn(vegetation, tags.natural) || tags.golf === 'driving_range';
      if (!relevant) continue;
      if (g.coordinates.length !== 1) { skippedContext.push({ id, reason: 'polygon contains interior rings not yet supported by this compatibility context layer' }); continue; }
      const ring = localRing(g.coordinates[0], id);
      if (tags.building) infra.buildings.push({ id, ring, h: Number.parseFloat(tags.height) || 5, kind: tags.building === 'apartments' ? 'block' : 'house', name: tags.name || null, sourceId: feature.properties.sourceId, heightStatus: tags.height ? 'OSM-tag-unverified' : 'generic-rendering-height-not-measured' });
      if (tags.amenity === 'parking') infra.parking.push({ id, ring, surface: tags.surface || 'unknown', cars: false });
      if (tags.landuse) infra.landuse.push({ id, ring, kind: tags.landuse });
      if (tags.landuse === 'grass') scenery.grass.push(ring);
      const kind = tags.landuse === 'forest' ? 'forest' : tags.natural;
      if (Object.hasOwn(vegetation, kind)) vegetation[kind].push(ring);
      if (tags.golf === 'driving_range' && !geometry.scenery?.range?.length) scenery.range.push(ring);
    } else if (g.type === 'LineString') {
      const line = g.coordinates.map(local);
      if (tags.highway && !['platform', 'construction', 'proposed'].includes(tags.highway)) {
        const group = ['path', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(tags.highway) ? 'paths' : tags.highway === 'track' ? 'tracks' : 'roads';
        infra[group].push({ id, line, w: Number.parseFloat(tags.width) || (group === 'paths' ? 2 : group === 'tracks' ? 3 : 5), kind: tags.highway, surface: tags.surface || 'unknown', widthStatus: tags.width ? 'OSM-tag-unverified' : 'generic-rendering-width-not-measured', ...(tags.bridge ? { bridge: tags.bridge } : {}), ...(tags.tunnel ? { tunnel: tags.tunnel } : {}) });
      }
      if (tags.waterway && !tags.tunnel && !tags.covered) streams.push({ id, line, w: Number.parseFloat(tags.width) || 1, kind: tags.waterway, sourceId: feature.properties.sourceId });
    }
  }
  const water = [];
  if (geometry.waterPath) {
    const canonicalWater = new Map(projectedFeatures(await json('geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson'), 'Visby canonical water').map(feature => [feature.id, feature]));
    for (const feature of projectedFeatures(await json(geometry.waterPath), 'Visby water')) {
      const parent = canonicalWater.get(feature.properties.parentWaterId ?? feature.id);
      if (!parent || parent.geometry.type !== 'Polygon') throw new Error(`${feature.id}: missing original water boundary for partition-independent shores`);
      if (!Array.isArray(parent.properties.shoreline?.lines)) throw new Error(`${parent.id}: missing source shoreline with artificial map and source-tile edges removed`);
      const shoreline = { lines: parent.properties.shoreline.lines.map((coordinates, index) => {
        const line = coordinates.map(coordinate => coordinate.slice(0, 2));
        if (line.length < 2 || !line.every(point)) throw new Error(`${parent.id} shoreline ${index + 1}: invalid projected source line`);
        return { line: line.map(local) };
      }) };
      const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
      for (const [index, rings] of polygons.entries()) {
        if (rings.length !== 1) throw new Error(`${feature.id}: compatibility water cannot discard islands; preserve via an approved polygon adapter`);
        const ring = localRing(rings[0].map(coordinate => coordinate.slice(0, 2)), `${feature.id} water`, 1e-6);
        const level = feature.properties.heightRH2000;
        if (!Number.isFinite(level)) throw new Error(`${feature.id} water lacks RH2000 level`);
        // These are finite source polygons, including offshore fragments. The
        // legacy isSea switch also enables an unbounded height-based ocean
        // interpretation; a clipped source polygon cannot establish that mask.
        water.push({ id: `${feature.id}-part-${index + 1}`, ring, shoreline, level, isLake: feature.properties.isSea !== true, isSea: false,
          sourceIsSea: feature.properties.isSea === true, area: Math.abs(polyArea(ring)), sourceId: feature.properties.sourceId,
          sourceFeatureId: feature.properties.sourceFeatureId, parentWaterId: feature.properties.parentWaterId,
          waterKind: feature.properties.waterKind ?? 'source-flattened-water', heightTreatment: feature.properties.heightTreatment,
          artificialCutEdgeCount: feature.properties.artificialCutEdgesEpsg3006?.length ?? 0,
          clipBoundaryIsShore: false, bathymetry: null });
      }
    }
  }
  const model = { version: 1, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLat: 111320,
    mPerLon: +(111320 * Math.cos(FRAME.latitude * Math.PI / 180)).toFixed(2), frame: FRAME.text,
    seaLevel: water.find(body => body.sourceIsSea)?.level ?? 0.23, holes, water, streams, coast: [], vegetation, infra,
    surround: { clearfells: [], yard: null, hayfields: null, shallows: [] }, scenery, pois: [],
    evidence: { status: 'provisional-source-derived', terrain: TERRAIN.sourceFloat32Sha256, geometryPath: 'visbybuild/mapping/geometry.json', terrainModifiedForPlayingSurfaces: false,
      flagPositions: 'virtual green targets', numericTeePositions: 'unknown unless source reference supplied; camera references only', largeObjects: 'source footprints; generic dimensions where heights are absent', canonicalOriginApproval: 'pending-independent-control', skippedContext } };
  const downsample = step => {
    const size = 4096 / step + 1, values = new Float32Array(size * size);
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) values[row * size + col] = fine[row * step * 4097 + col * step];
    return { x0: -2048, z0: -2048, dx: step, ...quantizeHF(values, size, size, 0.01) };
  };
  const hf = { source: { product: 'Lantmäteriet Markhöjdmodell 1 m', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', fineInputSha256: TERRAIN.sourceFloat32Sha256,
    note: 'GPK1 samples retained 1 m source at 4 m and 16 m over the same 4096 m extent. No terrain outside acquired coverage is claimed.' }, hf0: downsample(4), hf1: downsample(16) };
  await write('visbybuild/card.json', { teeNames: card.tees.map(tee => tee.name), source: card.source, holes: holes.map(h => ({ n: h.n, par: h.par, hcp: h.idx, t: h.t })) });
  await write('visbybuild/course-model.json', model);
  await write('visbybuild/heightfields.json', hf);
  console.log(JSON.stringify({ holes: holes.length, par: card.par, greenRings: holes.length, physicalTeePlatforms: holes.reduce((n, h) => n + h.tees.pads.length, 0), fairwayRings: holes.reduce((n, h) => n + h.fairway.rings.length, 0), bunkers: holes.reduce((n, h) => n + h.bunkers.length, 0), buildings: infra.buildings.length, water: water.length, skippedContext: skippedContext.length, sourceSamples: fine.length, frame: FRAME }, null, 2));
  return model;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCourse().catch(error => { console.error(`Visby model build failed: ${error.message}`); process.exitCode = 1; });
