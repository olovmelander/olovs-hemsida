/* Source-derived compatibility model for Lidingö. The v2 graph keeps the
 * original 1 m grid; GPK1 samples it at 4 m for the explicit fallback. Neither
 * adapter moves/levels terrain to fit a diagram or a scorecard distance. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { centroid, pointInPoly, polyArea, polyLen, quantizeHF } from '../geobuild/lib.mjs';
import { LIDINGO_GROUND_GRAPH_CONFIG as TERRAIN, assertLidingoAcquisition } from '../packages/course-v2/lidingo-ground-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async p => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const write = (p, value) => writeFile(path.join(ROOT, p), JSON.stringify(value, null, 2) + '\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const FRAME = Object.freeze({
  easting: 677700.5, northing: 6586399.5,
  latitude: 59.378715385375614, longitude: 18.12816746741512,
  text: 'local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000',
});
export const local = ([e, n]) => [e - FRAME.easting, FRAME.northing - n];
const r1 = n => Math.round(n * 10) / 10;

function requireProjected(collection, label) {
  if (collection.type !== 'FeatureCollection' || collection.crs?.properties?.name !== 'EPSG:3006') {
    throw new Error(`${label} must be explicitly EPSG:3006`);
  }
  return collection.features;
}
function polygonRing(feature) {
  if (feature.geometry.type !== 'Polygon' || feature.geometry.coordinates.length !== 1) {
    throw new Error(`${feature.id}: compatibility surface requires one outer ring and no discarded holes`);
  }
  const ring = feature.geometry.coordinates[0].map(local);
  if (ring.length < 4 || !ring.flat().every(Number.isFinite) || Math.abs(polyArea(ring)) < 1) {
    throw new Error(`${feature.id}: invalid surface ring`);
  }
  return ring;
}
function nearestOnLine(line, p) {
  let best = { distance: Infinity, along: 0 }, travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length ** 2)) : 0;
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    if (distance < best.distance) best = { distance, along: travelled + t * length };
    travelled += length;
  }
  return best;
}
function centreInside(ring) {
  const c = centroid(ring);
  if (!pointInPoly(c[0], c[1], ring)) throw new Error('Surface centroid lies outside its polygon; explicit interior control required');
  return c;
}

export async function buildCourse() {
  const bytes = await readFile(path.join(ROOT, 'lidingobuild/cache/terrain-review/terrain-1m.f32'));
  assertLidingoAcquisition(await json('geo_data/course-v2/lidingo/acquisition/terrain-window.json'), sha256(bytes));
  const fine = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const heightAt = (x, z) => {
    const col = x + 1024, row = z + 1024;
    if (col < 0 || row < 0 || col > 2048 || row > 2048) throw new Error('Height query leaves acquired 1 m grid');
    const x0 = Math.min(2047, Math.floor(col)), z0 = Math.min(2047, Math.floor(row));
    const u = col - x0, v = row - z0, k = z0 * 2049 + x0;
    return (fine[k] * (1 - u) + fine[k + 1] * u) * (1 - v) +
      (fine[k + 2049] * (1 - u) + fine[k + 2050] * u) * v;
  };
  const card = await json('lidingobuild/reference/club-scorecard.json');
  const golf = requireProjected(await json('geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson'), 'OSM golf');
  const surfaces = requireProjected(await json('lidingobuild/mapping/playing-surfaces.geojson'), 'Playing surfaces');
  const facilities = requireProjected(await json('lidingobuild/mapping/facilities.geojson'), 'Facilities');
  const infrastructure = requireProjected(await json('lidingobuild/mapping/infrastructure.geojson'), 'Normalized infrastructure');
  const roofs = await json('lidingobuild/mapping/building-roof-meshes.json');
  if (roofs.horizontalCrs !== 'EPSG:3006' || roofs.verticalCrs !== 'EPSG:5613' || roofs.groundId !== 'lidingo') throw new Error('Roof source frame differs');
  for (const input of [...roofs.inputs, roofs.evidence]) {
    if (sha256(await readFile(path.join(ROOT, input.path))) !== input.sha256) throw new Error(`Roof evidence changed at ${input.path}`);
  }
  const roofById = new Map(roofs.buildings.map(b => [b.sourceFootprintId, b]));
  const context = requireProjected(await json('geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'), 'OSM context');
  const routes = golf.filter(f => f.properties.tags.golf === 'hole').sort((a, b) => +a.properties.tags.ref - +b.properties.tags.ref);
  if (routes.length !== 18 || card.holes.length !== 18 || card.tees.length !== 5) throw new Error('Lidingö needs all 18 routes and the five-tee card');
  const sourceRings = (kind, hole) => surfaces.filter(f => f.properties.kind === kind && f.properties.hole === hole);
  const holes = card.holes.map((row, index) => {
    const route = routes[index];
    if (+route.properties.tags.ref !== row.number || +route.properties.tags.par !== row.par) throw new Error('Route/card identity mismatch');
    const line = route.geometry.coordinates.map(local), lineLen = polyLen(line);
    const greens = sourceRings('green', row.number), platforms = sourceRings('tee', row.number);
    if (greens.length !== 1 || !platforms.length) throw new Error(`Hole ${row.number} lacks a single observed green or observed tee platforms`);
    const greenRing = polygonRing(greens[0]), pin = centreInside(greenRing);
    const pads = platforms.map(f => ({ ring: polygonRing(f), preserveTerrain: true, sourceFeatureId: f.id }));
    const t = card.tees.map(tee => row.lengths[tee.id]);
    /* These are UI/camera start references, not a claim about today's coloured
     * marker positions. Choose an observed platform nearest the nominal route
     * distance. mapped-only suppresses physical tee marker furniture. */
    const marks = t.map(m => {
      /* The mark is a point ON an observed platform, and which point matters.
         Taking the platform's CENTROID leaves the five card tees of a hole
         stacked on one spot whenever the hole has one pad, and puts every mark
         at whatever distance that pad's middle happens to sit at. Searching the
         platform's own INTERIOR for the point whose remaining distance to the
         green best matches the card takes the residual over the 90 card tees
         from a median 10.6 m to 3.7 m, and the marks more than 20 m out from 33
         to 2.

         Nothing about the observed polygon moves: this chooses a point inside
         it, which is what preserveMappedBoundaries protects and what a tee
         marker actually is - a position on a prepared deck, set by the club to
         play a stated length. It is still a camera reference and still not a
         claim about where today's coloured markers stand. */
      const best = pads.reduce((carry, pad) => {
        const box = pad.ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]),
          Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
        let inner = null;
        for (let x = box[0]; x <= box[2]; x += 0.5) {
          for (let z = box[1]; z <= box[3]; z += 0.5) {
            if (!pointInPoly(x, z, pad.ring)) continue;
            const delta = Math.abs(lineLen - nearestOnLine(line, [x, z]).along - m);
            if (!inner || delta < inner.delta) inner = { c: [r1(x), r1(z)], delta };
          }
        }
        /* a platform too small for a half-metre grid still has its centroid */
        if (!inner) {
          const c = centreInside(pad.ring);
          inner = { c, delta: Math.abs(lineLen - nearestOnLine(line, c).along - m) };
        }
        return !carry || inner.delta < carry.delta ? inner : carry;
      }, null);
      return { c: best.c, b: 0, m, placement: 'nominal-camera-reference-on-observed-platform; colour position unverified' };
    });
    const teeHeight = heightAt(...marks[1].c), greenHeight = heightAt(...pin);
    return {
      n: row.number, par: row.par, idx: row.index, t, line, lineLen, pin,
      green: { ring: greenRing, c: pin, sourceFeatureId: greens[0].id },
      fairway: { rings: sourceRings('fairway', row.number).map(polygonRing) },
      tees: { inferPads: false, pads, marks },
      bunkers: sourceRings('bunker', row.number).map(f => ({ ring: polygonRing(f), sourceFeatureId: f.id })),
      elev: { tee: r1(teeHeight), green: r1(greenHeight), rise: r1(greenHeight - teeHeight) },
      tiers: 1, name: null,
      note: 'Preliminär kartläggning. Terräng: Lantmäteriet 1 m. Spelytor från ortofoto 2019 och kartreferenser; senare ändringar återstår att kontrollera. Flaggposition och tee-färger är visningsreferenser.',
      confidence: 'source-derived-candidate-not-surveyed',
      pinStatus: 'virtual-green-target; daily flag location unknown',
    };
  });
  for (let i = 0; i < 5; i++) if (holes.reduce((s, h) => s + h.t[i], 0) !== card.tees[i].total) throw new Error('Scorecard total differs');
  const water = [];
  for (const f of requireProjected(await json('geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson'), 'LM water')) {
    const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const [part, rings] of polygons.entries()) {
      if (rings.length !== 1) throw new Error('Compatibility water cannot silently discard islands');
      const ring = rings[0].map(local), level = f.properties.heightRH2000;
      if (!Number.isFinite(level)) throw new Error('Water lacks RH 2000 level');
      /* fid14 is the sea, and the break geometry carries it clipped to the
         2,048 m terrain window - three fragments totalling 9.90 ha of a
         20.657 km2 source feature, closed with a straight chord across open
         water. It is superseded here by the united laser plates below, which
         measure the same water at the same level over 607.74 ha. Two rings at
         one level over one body are a z-fight, not a belt and braces, so this
         is a REPLACEMENT: the fragments are skipped rather than joined. */
      if (f.properties.sourceFid === 14) continue;
      water.push({ id: `${f.id}-part-${part + 1}`, sourceFeatureId: f.id,
        ring, level, isLake: true, isSea: false, area: Math.abs(polyArea(ring)),
        waterKind: 'inland-pond',
        sourceId: 'water-breaks-lm-1m', clipBoundaryIsShore: false });
    }
  }
  /* The sea, measured off the 1 m and 2 m laser plates and united into one
     ring per body (lidingobuild/mapping/build-coast-rings.py). isSea stays
     FALSE: that flag is not a description of a body of water, it is an
     instruction about the whole world - the engine answers it by laying one
     plane across the entire heightfield - and this ring, real sea though it is,
     stops at the acquisition edge. A ring draws its own sheet regardless. */
  const coastRings = requireProjected(await json('lidingobuild/mapping/coast-rings.geojson'), 'United sea');
  for (const f of coastRings) {
    if (f.geometry.type !== 'Polygon' || f.geometry.coordinates.length !== 1) {
      throw new Error(`${f.id}: a united sea ring must be one outer ring`);
    }
    const ring = f.geometry.coordinates[0].map(local);
    const level = f.properties.heightRH2000;
    if (!Number.isFinite(level)) throw new Error(`${f.id}: sea ring lacks its RH 2000 level`);
    water.push({ id: f.id, sourceFeatureId: f.id, ring, level, isLake: false, isSea: false,
      area: Math.abs(polyArea(ring)), waterKind: 'sea',
      sourceId: f.properties.sourceId, clipBoundaryIsShore: false });
  }
  if (!water.some(w => w.waterKind === 'sea')) throw new Error('Lidingö is a coastal course and its sea is missing');

  const vegetation = { forest: [], wood: [], scrub: [], wetland: [], sand: [], rock: [] };
  const infra = { paths: [], tracks: [], roads: [], buildings: [], farB: [], parking: [], piers: [], basins: [], pitches: [],
    landuse: [], reserves: [], power: { lines: [], towers: [], poles: [] }, railway: [],
    objectPlacement: 'mapped-only', bridgePlacement: 'mapped-only', vegetationPlacement: 'measured-only',
    terrainPlacement: 'measured-only', preserveMappedBoundaries: true };
  const scenery = { greens: [], fairways: [], tees: [], bunkers: [], grass: [], range: [],
    practiceGreens: [], mappedFeatures: [], rangeFacilities: null, cartPark: null };
  const streams = [];
  for (const f of context) {
    const t = f.properties.tags, g = f.geometry, id = f.id;
    if (g.type === 'Polygon') {
      const ring = polygonRing(f);
      if (t.building) infra.buildings.push({ id, ring, h: Number.parseFloat(t.height) || 5,
        kind: t.building === 'apartments' ? 'block' : 'house', name: t.name || null,
        ...(id === 'way/32262176' ? { amenity: 'clubhouse', name: 'Lidingö Golfklubb' } : {}),
        heightStatus: t.height ? 'OSM-tag-unverified' : 'generic-rendering-height-not-measured', sourceId: f.properties.sourceId });
      if (t.amenity === 'parking') infra.parking.push({ id, ring, surface: t.surface || 'unknown', cars: false });
      if (t.landuse) infra.landuse.push({ id, ring, kind: t.landuse });
      if (t.landuse === 'grass') scenery.grass.push(ring);
      const vegKind = t.landuse === 'forest' ? 'forest' : t.natural;
      if (Object.hasOwn(vegetation, vegKind)) vegetation[vegKind].push(ring);
    } else if (g.type === 'LineString') {
      const line = g.coordinates.map(local);
      if (t.highway && !['platform', 'construction', 'proposed'].includes(t.highway)) {
        const group = ['path', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(t.highway) ? 'paths' : t.highway === 'track' ? 'tracks' : 'roads';
        const width = Number.parseFloat(t.width) || (group === 'paths' ? 2 : group === 'tracks' ? 3 : 5);
        infra[group].push({ id, line, w: width, kind: t.highway, surface: t.surface || 'unknown', widthStatus: t.width ? 'OSM-tag-unverified' : 'generic-rendering-width-not-measured',
          ...(t.bridge ? { bridge: t.bridge } : {}), ...(t.tunnel ? { tunnel: t.tunnel } : {}), ...(t.layer ? { layer: t.layer } : {}) });
      }
      if (t.waterway && !['culvert', 'yes'].includes(t.tunnel) && !t.covered) streams.push({ id, line, w: Number.parseFloat(t.width) || 1, kind: t.waterway, sourceId: f.properties.sourceId });
    }
  }
  const roofPoint = ([e, n, h]) => ({ c: local([e, n]), heightRH2000: h });
  for (const b of infra.buildings) {
    const source = roofById.get(b.id);
    if (!source) continue;
    const mesh = source.mesh;
    b.roofSurface = { sourceId: source.sourceId, sourceEpoch: source.sourceEpoch,
      state: source.state, verticalCrs: 'EPSG:5613', notSurveyed: true,
      coverageFraction: mesh.statistics.footprintCoverageFraction,
      vertices: mesh.verticesEpsg3006RH2000.map(roofPoint), triangleIndices: mesh.triangleIndices,
      boundaryWallSegments: mesh.boundaryWallSegmentsEpsg3006RH2000.map(segment => segment.map(roofPoint)),
      facadeStatus: 'neutral-rendering-material; architecture and unsupported perimeter unmeasured' };
    delete b.h; // A roof-top RH 2000 elevation is never an eave/wall height.
    b.heightStatus = 'measured-2021-roof-TIN; unsupported roof regions remain omitted';
  }
  // Golf-tagged paths are stored in the golf reference, not the context layer.
  // Preserve all six route geometries, including the one without a highway tag.
  const pathIds = new Set([...infra.paths, ...infra.tracks, ...infra.roads].map(p => p.id));
  for (const f of infrastructure) {
    if (f.properties.kind === 'path' && f.geometry.type === 'LineString' && !pathIds.has(f.id)) {
      infra.paths.push({ id: f.id, line: f.geometry.coordinates.map(local), w: 2,
        kind: f.properties.tags.highway || 'footway', surface: f.properties.tags.surface || 'unknown',
        sourceId: f.properties.sourceId, widthStatus: 'generic-rendering-width-not-measured' });
      pathIds.add(f.id);
    } else if (f.properties.kind === 'parking') {
      infra.parking.push({ id: f.id, ring: polygonRing(f), surface: f.properties.tags.surface || 'unknown',
        cars: false, sourceId: f.properties.sourceId, notSurveyed: true });
    }
  }
  // Each physical facility surface has one runtime owner. Keep interior turf
  // islands in the courtyard paving and never synthesize individual range bays.
  const adoptedSurfaceIds = new Set(facilities.map(f => f.properties.sourceFeatureId).filter(Boolean));
  for (const f of surfaces.filter(f => f.properties.hole == null)) {
    if (adoptedSurfaceIds.has(f.id)) continue;
    const category = { green: 'greens', tee: 'tees', fairway: 'fairways', bunker: 'bunkers' }[f.properties.kind];
    if (category) scenery[category].push(polygonRing(f));
  }
  for (const f of facilities) {
    const p = f.properties;
    const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const [part, polygon] of polygons.entries()) {
      const id = polygons.length === 1 ? f.id : `${f.id}-part-${part + 1}`;
      const rings = polygon.map(ring => ring.map(local));
      if (p.kind === 'range_field') {
        if (rings.length !== 1) throw new Error('Range field cannot discard interior exclusions');
        scenery.range.push(rings[0]);
      } else if (p.kind === 'parking') {
        if (rings.length !== 1) throw new Error('Parking cannot discard interior exclusions');
        infra.parking.push({ id, ring: rings[0], surface: 'unknown', cars: false,
          sourceId: p.sourceId, observedYear: p.observedYear, notSurveyed: true });
      } else {
        scenery.mappedFeatures.push({ id, kind: p.kind, rings, material: p.material,
          parentFacilityId: p.parentFacilityId, sourceId: p.sourceId,
          sourceSha256: p.sourceSha256, observedYear: p.observedYear, notSurveyed: true });
        // Marker references are kept apart from ground surfaces; the range
        // target is not a putting green available for walking practice.
        if (p.kind === 'practice_green' && p.parentFacilityId !== 'lidingo-driving-range') {
          scenery.practiceGreens.push(rings[0]);
        }
      }
    }
  }
  const model = { version: 1, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLat: 111320,
    mPerLon: +(111320 * Math.cos(FRAME.latitude * Math.PI / 180)).toFixed(2), frame: FRAME.text,
    seaLevel: 0, holes, water, streams, coast: [], vegetation, infra,
    surround: { clearfells: [], yard: null, hayfields: null, shallows: [] }, scenery, pois: [],
    evidence: { status: 'provisional-source-derived', terrain: TERRAIN.sourceFloat32Sha256,
      surfaces: 'lidingobuild/mapping/playing-surfaces.geojson', terrainModifiedForPlayingSurfaces: false,
      facilities: 'lidingobuild/mapping/facilities.geojson', facilityReview: 'lidingobuild/mapping/facilities-review.json',
      infrastructure: 'lidingobuild/mapping/infrastructure.geojson',
      buildingRoofs: 'lidingobuild/mapping/building-roof-meshes.json',
      flagPositions: 'virtual green targets', colouredTeePositions: 'unknown; camera references only',
      largeObjects: 'source footprints; generic dimensions where source lacks heights',
      canonicalOriginApproval: 'pending-independent-control' } };
  const hf0Values = new Float32Array(513 * 513);
  for (let row = 0; row < 513; row++) for (let col = 0; col < 513; col++) hf0Values[row * 513 + col] = fine[row * 4 * 2049 + col * 4];
  const vistaMeta = await json('lidingobuild/cache/terrain-vista/terrain-vista.json');
  const vistaEvidence = await json('geo_data/course-v2/lidingo/mapping/terrain-vista.json');
  if (JSON.stringify(vistaMeta) !== JSON.stringify(vistaEvidence) ||
      vistaMeta.horizontalCrs !== 'EPSG:3006' || vistaMeta.verticalCrs !== 'EPSG:5613' ||
      vistaMeta.raster.sha256 !== 'd287f250e20617ffd8f21d33bbcd367f6bd09122653569967851afa3db1692cc') {
    throw new Error('Vista CRS or retained source evidence differs');
  }
  const vistaBytes = await readFile(path.join(ROOT, 'lidingobuild/cache/terrain-vista/terrain-vista.f32'));
  if (sha256(vistaBytes) !== vistaMeta.raster.sha256) throw new Error('Vista source checksum differs');
  const v = vistaMeta.lattice;
  if (v.width !== 257 || v.height !== 257 || v.sampleSpacingMetres !== 32 ||
      v.originEasting !== 673604.5 || v.originNorthing !== 6590495.5) throw new Error('Vista lattice shifted');
  const vista = new Float32Array(vistaBytes.buffer, vistaBytes.byteOffset, vistaBytes.byteLength / 4);
  if (vista.length !== v.width * v.height || !vista.every(Number.isFinite)) throw new Error('Incomplete vista DTM');
  const hf = { source: { product: 'Lantmäteriet Markhöjdmodell 1 m', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
    fineInputSha256: TERRAIN.sourceFloat32Sha256, note: 'GPK1 HF0 samples the 1 m source every 4 m; v2 retains every 1 m sample. HF1 uses acquired 32 m context.' },
    hf0: { x0: -1024, z0: -1024, dx: 4, ...quantizeHF(hf0Values, 513, 513, 0.1) },
    hf1: { x0: v.originEasting - FRAME.easting, z0: FRAME.northing - v.originNorthing,
      dx: v.sampleSpacingMetres, ...quantizeHF(vista, v.width, v.height, 0.25) } };
  await write('lidingobuild/card.json', { teeNames: card.tees.map(t => t.name), source: card.source,
    holes: holes.map(h => ({ n: h.n, par: h.par, hcp: h.idx, t: h.t })) });
  await write('lidingobuild/course-model.json', model);
  await write('lidingobuild/heightfields.json', hf);
  console.log(JSON.stringify({ holes: holes.length, par: card.par, surfaces: surfaces.length, facilities: facilities.length, buildings: infra.buildings.length,
    water: water.length, fineSamples: fine.length, vistaSamples: vista.length }));
  return model;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCourse().catch(error => { console.error(error); process.exitCode = 1; });
}
