#!/usr/bin/env node
/* Shared, schema-validated EPSG:3006 -> course-model.json + heightfields.json compiler.
 *
 * Replaces per-course copy-pasted `build-course.mjs` scripts for new Banvy v2
 * courses. Key guarantees:
 *  - Consumes explicit EPSG:3006 GeoJSON layers (routes, playing surfaces,
 *    facilities, water breaklines, infrastructure, context) + verified card +
 *    guide-notes + standard Float32 1 m terrain (l0.f32) and coarse vista ring.
 *  - Never warps or levels the 1 m DTM to fit a diagram or scorecard length.
 *  - Preserves polygon innerRings on bunkers (grass islands), water (islands),
 *    and mappedFeatures (`waste_sand`, `mown_approach`, courtyard paving, etc.).
 *  - Supports `infra.bulkheads[]`, `infra.bridges[]`, `infra.piers[]`.
 *  - Automatically injects sibling-course playing surfaces into `M.scenery` on
 *    multi-course shared estates (e.g. Stadium <-> Castle at Bro Hof).
 *  - Runs a strict EPSG:3006-leakage guard rejecting any coordinate pair that
 *    resembles unprojected SWEREF 99 TM coordinates in the local model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { centroid, pointInPoly, polyArea, polyLen, quantizeHF } from '../../../geobuild/lib.mjs';
import { validateOrthoRing } from '../../../geobuild/mapping/apply-ortho-review.mjs';
import { verifyScorecard } from '../intake/verify-scorecard.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const r1 = n => Math.round(n * 10) / 10;

export function makeLocalProjector(frame) {
  if (!Number.isFinite(frame?.easting) || !Number.isFinite(frame?.northing) ||
      !Number.isFinite(frame?.latitude) || !Number.isFinite(frame?.longitude)) {
    throw new Error('frame requires finite easting, northing, latitude, longitude');
  }
  return ([e, n]) => [
    Math.round((e - frame.easting) * 1000) / 1000,
    Math.round((frame.northing - n) * 1000) / 1000,
  ];
}

export function requireEpsg3006Collection(collection, label) {
  if (!collection || collection.type !== 'FeatureCollection' ||
      collection.crs?.properties?.name !== 'EPSG:3006' || !Array.isArray(collection.features)) {
    throw new Error(`${label} must be an EPSG:3006 FeatureCollection`);
  }
  return collection.features;
}

function nearestOnLine(line, p) {
  let best = { distance: Infinity, along: 0 }, travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (length * length))) : 0;
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    if (distance < best.distance) best = { distance, along: travelled + t * length };
    travelled += length;
  }
  return best;
}

function interiorPoint(ring, label) {
  const c = centroid(ring);
  if (pointInPoly(c[0], c[1], ring)) return c;
  // Deterministic interior probe along bounding-box scanlines for concave/L-shaped rings
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75]) {
    const z = minZ + (maxZ - minZ) * fy;
    for (let k = 1; k <= 15; k++) {
      const x = minX + (maxX - minX) * (k / 16);
      if (pointInPoly(x, z, ring)) return [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000];
    }
  }
  throw new Error(`${label}: could not determine an interior reference point`);
}

function projectPolygonRings(feature, local, { allowHoles = false } = {}) {
  const g = feature.geometry;
  if (g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !g.coordinates.length) {
    throw new Error(`${feature.id || 'feature'}: expected Polygon geometry`);
  }
  if (!allowHoles && g.coordinates.length !== 1) {
    throw new Error(`${feature.id || 'feature'}: unexpected interior holes where a simple ring is required`);
  }
  return g.coordinates.map((ring, idx) => {
    const projected = ring.map(local);
    return validateOrthoRing(projected, `${feature.id || 'feature'}[${idx}]`);
  });
}

export function validateGuideNotes(guide, expectedHoles) {
  if (guide?.schemaVersion !== 1 || !Array.isArray(guide.holes) || guide.holes.length !== expectedHoles) {
    throw new Error(`guide-notes requires schemaVersion 1 and ${expectedHoles} holes`);
  }
  const byHole = new Map();
  for (let i = 0; i < expectedHoles; i++) {
    const h = guide.holes[i];
    if (h.n !== i + 1) throw new Error(`guide-notes out of order at index ${i} (got hole ${h.n})`);
    if (typeof h.name !== 'string' || !h.name.trim()) throw new Error(`hole ${h.n} guide-note missing name`);
    if (typeof h.note !== 'string' || h.note.trim().length < 20) throw new Error(`hole ${h.n} guide-note too short`);
    if (typeof h.basis !== 'string' || !h.basis.trim()) throw new Error(`hole ${h.n} guide-note missing basis`);
    byHole.set(h.n, h);
  }
  return byHole;
}

/**
 * Recursively scan a compiled local course model and reject any coordinate pair
 * whose magnitude indicates raw EPSG:3006 SWEREF 99 TM leakage.
 */
export function assertNoEpsg3006Leakage(model, maxLocalAbsMetres = 50_000) {
  const bad = [];
  function walk(node, keyPath) {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length === 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
        if (Math.abs(node[0]) > maxLocalAbsMetres || Math.abs(node[1]) > maxLocalAbsMetres) {
          bad.push(`${keyPath}=[${node[0]},${node[1]}]`);
        }
        return;
      }
      for (let i = 0; i < node.length; i++) walk(node[i], `${keyPath}[${i}]`);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      // Skip explicit metadata/provenance blocks that intentionally describe projection origin
      if (k === 'evidence' || k === 'frame' || k === 'origin' || k === 'mPerLat' || k === 'mPerLon') continue;
      walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }
  walk(model, '');
  if (bad.length) {
    throw new Error(`EPSG:3006 coordinate leakage detected in local model (${bad.length} pairs, first: ${bad.slice(0, 4).join(', ')})`);
  }
}

export function createTerrainSampler(float32, { side, spacing = 1, x0, z0 }) {
  if (float32.length !== side * side) {
    throw new Error(`terrain array length ${float32.length} != ${side}x${side}`);
  }
  return (x, z) => {
    const col = (x - x0) / spacing;
    const row = (z - z0) / spacing;
    if (col < 0 || row < 0 || col > side - 1 || row > side - 1) {
      throw new Error(`height query (${x.toFixed(2)}, ${z.toFixed(2)}) leaves terrain bounds`);
    }
    const c0 = Math.min(side - 2, Math.floor(col));
    const r0 = Math.min(side - 2, Math.floor(row));
    const u = col - c0, v = row - r0;
    const k = r0 * side + c0;
    return (float32[k] * (1 - u) + float32[k + 1] * u) * (1 - v) +
      (float32[k + side] * (1 - u) + float32[k + side + 1] * u) * v;
  };
}

/**
 * Compile one course model + GPK1 compatibility heightfields from EPSG:3006 layers.
 */
export function compileGridCourse({
  groundId,
  slug,
  frame,
  seaLevel = 0,
  card,
  requireRated = true,
  guideNotes,
  routesGeoJson,
  surfacesGeoJson,
  siblingSurfacesGeoJson = null,
  facilitiesGeoJson = null,
  waterGeoJson = null,
  infrastructureGeoJson = null,
  contextGeoJson = null,
  fineTerrain, // { float32, side, spacing, x0, z0, sha256 }
  vistaTerrain = null, // { float32, side, spacing, x0, z0, sha256 }
  defaultTeeIndex = 1,
  /* Runtime placement policies. A key set to null is left out, which is how the living ground
     (grass round the ball, reeds, furniture, the measured shore) is turned on for a course. */
  placement = {},
  farBuildings = null, // far boxes: [cx, cz, half width, half depth, angle, kind, height?]
  hf0SpanMetres = 2048,
  evidence = {},
}) {
  const local = makeLocalProjector(frame);
  const cardCheck = verifyScorecard(card, { requireRated });
  if (!cardCheck.valid) {
    throw new Error(`Invalid scorecard for ${slug}: ${cardCheck.errors.join('; ')}`);
  }
  const expectedHoles = card.holes.length;
  const notes = validateGuideNotes(guideNotes, expectedHoles);

  const heightAt = createTerrainSampler(fineTerrain.float32, fineTerrain);
  const routes = requireEpsg3006Collection(routesGeoJson, 'routes')
    .filter(f => f.geometry?.type === 'LineString')
    .sort((a, b) => Number(a.properties.hole ?? a.properties.tags?.ref) - Number(b.properties.hole ?? b.properties.tags?.ref));
  if (routes.length !== expectedHoles) {
    throw new Error(`${slug}: expected ${expectedHoles} route centerlines, found ${routes.length}`);
  }

  const surfaces = requireEpsg3006Collection(surfacesGeoJson, 'playing surfaces');
  const byKindHole = (kind, holeNum) => surfaces.filter(f => f.properties?.kind === kind && Number(f.properties?.hole) === holeNum);

  const holes = card.holes.map((row, index) => {
    const route = routes[index];
    const routeHole = Number(route.properties.hole ?? route.properties.tags?.ref);
    if (routeHole !== row.number) {
      throw new Error(`${slug}: route hole ${routeHole} != scorecard hole ${row.number}`);
    }
    const line = route.geometry.coordinates.map(local);
    const lineLen = polyLen(line);
    const greens = byKindHole('green', row.number);
    const teeFeatures = byKindHole('tee', row.number);
    if (greens.length !== 1 || !teeFeatures.length) {
      throw new Error(`${slug} hole ${row.number}: requires 1 green (got ${greens.length}) and >=1 tee pad (got ${teeFeatures.length})`);
    }
    const [greenRing] = projectPolygonRings(greens[0], local, { allowHoles: false });
    const pin = interiorPoint(greenRing, `${slug} h${row.number} green`);

    const pads = teeFeatures.map(f => {
      const [ring] = projectPolygonRings(f, local, { allowHoles: false });
      return {
        ...(f.id ? { id: f.id } : {}),
        ring,
        preserveTerrain: true,
        sourceFeatureId: f.id || null,
        ...(f.properties?.teeIds ? { teeIds: f.properties.teeIds } : {}),
        ...(f.properties?.teeMarks ? { teeMarks: Object.fromEntries(Object.entries(f.properties.teeMarks).map(([id, c]) => [id, local(c)])) } : {}),
      };
    });

    const t = card.tees.map(tee => row.lengths[tee.id]);
    const marks = card.tees.map((tee, ti) => {
      const m = t[ti];
      // Prefer explicitly tagged tee platform when mapped, else nearest observed platform by route length
      const explicit = pads.find(p => Array.isArray(p.teeIds) && p.teeIds.includes(tee.id));
      const reviewed = pads.find(p => p.teeMarks?.[tee.id]);
      if (reviewed) {
        const c = reviewed.teeMarks[tee.id];
        if (!pointInPoly(c[0], c[1], reviewed.ring)) throw new Error(`${slug} h${row.number} tee ${tee.id}: reviewed mark lies outside its platform`);
        return {
          c,
          b: 0,
          m,
          sourcePadId: reviewed.id,
          placement: 'representative-start-on-named-platform; daily-marker-position-unknown',
          orthophotoReference: { kind: 'orthophoto-platform-reference', sourceId: reviewed.sourceId || evidence.imagerySourceId || null, captureDate: evidence.imageryCaptured || null, dailyMarkerPositionVerified: false },
        };
      }
      if (explicit) {
        return {
          c: interiorPoint(explicit.ring, `${slug} h${row.number} tee ${tee.id}`),
          b: 0,
          m,
          placement: 'reviewed-platform-start',
        };
      }
      const ranked = pads.map(pad => {
        const c = interiorPoint(pad.ring, `${slug} h${row.number} tee`);
        return { c, delta: Math.abs(lineLen - nearestOnLine(line, c).along - m) };
      }).sort((a, b) => a.delta - b.delta);
      return {
        c: ranked[0].c,
        b: 0,
        m,
        placement: 'nominal-camera-reference-on-observed-platform; colour position unverified',
      };
    });

    const fairwayRings = byKindHole('fairway', row.number).map(f => projectPolygonRings(f, local, { allowHoles: false })[0]);
    const bunkers = byKindHole('bunker', row.number).map(f => {
      const rings = projectPolygonRings(f, local, { allowHoles: true });
      return {
        ring: rings[0],
        ...(rings.length > 1 ? { innerRings: rings.slice(1) } : {}),
        sourceFeatureId: f.id || null,
      };
    });

    const teeMark = marks[Math.min(defaultTeeIndex, marks.length - 1)];
    const teeHeight = heightAt(teeMark.c[0], teeMark.c[1]);
    const greenHeight = heightAt(pin[0], pin[1]);
    const guide = notes.get(row.number);

    return {
      n: row.number,
      par: row.par,
      idx: row.index,
      t,
      line,
      lineLen: r1(lineLen),
      pin,
      green: { ring: greenRing, c: pin, sourceFeatureId: greens[0].id || null },
      fairway: { rings: fairwayRings },
      tees: {
        inferPads: false,
        pads: pads.map(({ teeMarks, ...pad }) => pad),
        marks,
        ...(marks.every(mark => mark.sourcePadId) ? { markerPlacement: 'reviewed', markerLayout: 'separate-reviewed-colours' } : {}),
      },
      bunkers,
      elev: { tee: r1(teeHeight), green: r1(greenHeight), rise: r1(greenHeight - teeHeight) },
      tiers: 1,
      name: guide.name,
      note: guide.note,
      confidence: 'source-derived-candidate-not-surveyed',
      pinStatus: 'virtual-green-target; daily flag location unknown',
    };
  });

  // Water polygons (preserving islands as innerRings)
  const water = [];
  if (waterGeoJson) {
    for (const f of requireEpsg3006Collection(waterGeoJson, 'water')) {
      const level = f.properties?.heightRH2000;
      if (!Number.isFinite(level)) throw new Error(`water ${f.id}: missing finite heightRH2000`);
      const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      for (let part = 0; part < polygons.length; part++) {
        const rings = polygons[part].map((r, idx) => validateOrthoRing(r.map(local), `${f.id}-p${part}[${idx}]`));
        water.push({
          id: polygons.length === 1 ? f.id : `${f.id}-part-${part + 1}`,
          sourceFeatureId: f.id,
          ring: rings[0],
          ...(rings.length > 1 ? { innerRings: rings.slice(1) } : {}),
          level,
          isLake: Boolean(f.properties.isLake ?? !f.properties.isSea),
          isSea: Boolean(f.properties.isSea),
          area: Math.round(Math.abs(polyArea(rings[0])) * 10) / 10,
          waterKind: f.properties.waterKind || 'inland-pond',
          sourceId: f.properties.sourceId || 'water-breaks-lm-1m',
          clipBoundaryIsShore: Boolean(f.properties.clipBoundaryIsShore),
        });
      }
    }
  }

  const vegetation = { forest: [], wood: [], scrub: [], wetland: [], sand: [], rock: [] };
  const infra = {
    paths: [], tracks: [], roads: [], buildings: [], farB: [], parking: [],
    piers: [], bridges: [], bulkheads: [], basins: [], pitches: [],
    landuse: [], reserves: [], power: { lines: [], towers: [], poles: [] }, railway: [],
    ...Object.fromEntries(Object.entries({
      objectPlacement: 'mapped-only',
      bridgePlacement: 'mapped-only',
      vegetationPlacement: 'measured-only',
      terrainPlacement: 'measured-only',
      ...placement,
    }).filter(([, value]) => value !== null)),
    preserveMappedBoundaries: true,
  };
  if (farBuildings) infra.farB = farBuildings.map(item => [...item]);
  const mappedOnly = infra.objectPlacement === 'mapped-only';
  const scenery = {
    greens: [], fairways: [], tees: [], bunkers: [], grass: [], range: [],
    practiceGreens: [], mappedFeatures: [], rangeFacilities: null, cartPark: null, cartParks: [],
  };
  const streams = [];

  // Process hole-level approaches (`mown_approach`), `waste_sand`, and unowned surfaces
  for (const f of surfaces) {
    const kind = f.properties?.kind;
    if (kind === 'mown_approach' || kind === 'waste_sand') {
      const rings = projectPolygonRings(f, local, { allowHoles: true });
      scenery.mappedFeatures.push({
        id: f.id || `${kind}-${scenery.mappedFeatures.length + 1}`,
        kind,
        rings,
        hole: f.properties?.hole ?? null,
        material: f.properties?.material || (kind === 'waste_sand' ? 'waste_sand' : 'approach_turf'),
        sourceId: f.properties?.sourceId || 'orthophoto-mapped',
      });
    } else if (f.properties?.hole == null) {
      const cat = { green: 'greens', tee: 'tees', fairway: 'fairways', bunker: 'bunkers' }[kind];
      if (cat) {
        const rings = projectPolygonRings(f, local, { allowHoles: kind === 'bunker' });
        scenery[cat].push(rings.length > 1 ? { ring: rings[0], innerRings: rings.slice(1) } : rings[0]);
      }
    }
  }

  // Automatic sibling-course scenery injection (e.g. Stadium <-> Castle on shared estate)
  let siblingCount = 0;
  if (siblingSurfacesGeoJson) {
    for (const f of requireEpsg3006Collection(siblingSurfacesGeoJson, 'sibling surfaces')) {
      const kind = f.properties?.kind;
      if (kind === 'waste_sand' || kind === 'mown_approach') {
        const rings = projectPolygonRings(f, local, { allowHoles: true });
        scenery.mappedFeatures.push({
          id: `sibling-${f.id || siblingCount}`,
          kind,
          rings,
          siblingCourse: f.properties?.course || 'sibling',
          material: f.properties?.material || (kind === 'waste_sand' ? 'waste_sand' : 'approach_turf'),
        });
        siblingCount++;
        continue;
      }
      const cat = { green: 'greens', tee: 'tees', fairway: 'fairways', bunker: 'bunkers' }[kind];
      if (!cat) continue;
      const rings = projectPolygonRings(f, local, { allowHoles: kind === 'bunker' });
      scenery[cat].push(rings.length > 1 ? { ring: rings[0], innerRings: rings.slice(1) } : rings[0]);
      siblingCount++;
    }
  }

  // Facilities (range, practice greens, Puttingbanan, courtyard paving, etc.)
  if (facilitiesGeoJson) {
    for (const f of requireEpsg3006Collection(facilitiesGeoJson, 'facilities')) {
      const p = f.properties || {};
      /* A range's tee line, as a line: the engine lays a strip, a mat in every bay and a divider between bays along it
         (scenery.rangeFacilities.bays), and the phone map draws a mat at each bay. Kept as points one bay apart, so both
         read the same bays. */
      if (p.kind === 'range_bay_line') {
        if (f.geometry.type !== 'LineString' || f.geometry.coordinates.length < 2) throw new Error(`${f.id}: a bay line is a LineString`);
        const pitch = Number.isFinite(p.bayPitch) && p.bayPitch > 1 ? p.bayPitch : 3;
        const line = f.geometry.coordinates.map(local);
        const bays = [line[0]];
        let carry = 0;
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let s = pitch - carry; s <= length + 1e-9; s += pitch) bays.push([a[0] + (b[0] - a[0]) * s / length, a[1] + (b[1] - a[1]) * s / length]);
          carry = (carry + length) % pitch;
        }
        scenery.rangeFacilities = { ...(scenery.rangeFacilities || {}), bays: bays.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]),
          bayPitch: pitch, prov: p.sourceId || 'mapped', evidence: `${f.id}: traced on the orthophoto` };
        continue;
      }
      const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      for (let part = 0; part < polygons.length; part++) {
        const id = polygons.length === 1 ? f.id : `${f.id}-part-${part + 1}`;
        const rings = polygons[part].map((r, idx) => validateOrthoRing(r.map(local), `${id}[${idx}]`));
        if (p.kind === 'range_field') {
          scenery.range.push(rings[0]);
        } else if (p.kind === 'parking') {
          infra.parking.push({ id, ring: rings[0], surface: p.surface || 'unknown', ...(mappedOnly ? { cars: false } : {}), sourceId: p.sourceId || 'mapped' });
        } else if (p.kind === 'range_fairway') {
          scenery.fairways.push(rings[0]);
        } else {
          scenery.mappedFeatures.push({
            id, kind: p.kind, rings,
            material: p.material || null,
            parentFacilityId: p.parentFacilityId || null,
            sourceId: p.sourceId || 'mapped',
          });
          if (p.kind === 'practice_green' || p.kind === 'putting_course') {
            scenery.practiceGreens.push(rings[0]);
          }
        }
      }
    }
  }

  // Dedicated mapped infrastructure: bulkheads, bridges, piers, paths, parking
  if (infrastructureGeoJson) {
    for (const f of requireEpsg3006Collection(infrastructureGeoJson, 'infrastructure')) {
      const p = f.properties || {};
      const g = f.geometry;
      if (p.kind === 'bulkhead' && g.type === 'LineString') {
        infra.bulkheads.push({
          id: f.id,
          line: g.coordinates.map(local),
          kind: p.material || p.style || 'timber',
          waterId: p.waterId || null,
          heightAboveWater: Number.isFinite(p.heightAboveWater) ? p.heightAboveWater : null,
          provenance: p.provenance || 'mapped-orthophoto',
        });
      } else if (p.kind === 'bridge' && g.type === 'LineString') {
        infra.bridges.push({
          id: f.id,
          line: g.coordinates.map(local),
          w: Number.isFinite(p.width) ? p.width : 2.6,
          kind: p.style || 'timber_footbridge',
          waterId: p.waterId || null,
          provenance: p.provenance || 'mapped-orthophoto',
        });
      } else if (p.kind === 'pier' && (g.type === 'LineString' || g.type === 'Polygon')) {
        infra.piers.push({
          id: f.id,
          ...(g.type === 'LineString' ? { line: g.coordinates.map(local), w: Number.isFinite(p.width) ? p.width : 2.4 } : { ring: projectPolygonRings(f, local)[0] }),
          kind: p.style || 'timber_pier',
          provenance: p.provenance || 'mapped-orthophoto',
        });
      } else if (p.kind === 'cart_park' && g.type === 'LineString') {
        scenery.cartParks.push({ id: f.id, line: g.coordinates.map(local), count: p.count, fleet: p.fleet || null, provenance: p.provenance || 'mapped-orthophoto' });
      } else if (p.kind === 'path' && g.type === 'LineString') {
        infra.paths.push({
          id: f.id,
          line: g.coordinates.map(local),
          w: Number.isFinite(p.width) ? p.width : 2.2,
          widthMetres: Number.isFinite(p.width) ? p.width : 2.2,
          kind: p.highway || 'cartpath',
          surface: p.surface || 'asphalt',
          sourceId: p.sourceId || 'mapped',
        });
      }
    }
  }

  // OSM context (buildings, roads, streams, parking, landcover)
  if (contextGeoJson) {
    for (const f of requireEpsg3006Collection(contextGeoJson, 'context')) {
      const t = f.properties?.tags || {};
      const g = f.geometry;
      const id = f.id;
      if (g.type === 'Polygon') {
        const rings = projectPolygonRings(f, local, { allowHoles: true });
        const ring = rings[0];
        if (t.building) {
          infra.buildings.push({
            id, ring,
            /* the source's own tag and height; the house kit types what OSM only calls a building */
            h: Number.parseFloat(t.height) || (Number.parseFloat(t['building:levels']) > 0 ? Math.round((Number.parseFloat(t['building:levels']) * 2.8 + 1.2) * 10) / 10 : null),
            kind: t.building,
            name: t.name || null,
            ...(t.amenity ? { amenity: t.amenity } : {}),
            historic: t.historic || null,
            heightStatus: t.height ? 'OSM-tag-unverified' : 'generic-rendering-height-not-measured',
          });
        }
        if (t.amenity === 'parking') infra.parking.push({ id, ring, surface: t.surface || 'unknown', ...(mappedOnly ? { cars: false } : {}) });
        if (t.landuse) infra.landuse.push({ id, ring, kind: t.landuse });
        const vegKind = t.landuse === 'forest' ? 'forest' : t.natural === 'bare_rock' ? 'rock' : t.natural;
        if (Object.hasOwn(vegetation, vegKind)) vegetation[vegKind].push(ring);
      } else if (g.type === 'LineString') {
        const line = g.coordinates.map(local);
        if (t.highway && !['platform', 'construction', 'proposed'].includes(t.highway)) {
          const group = ['path', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(t.highway) ? 'paths' : ['track', 'service'].includes(t.highway) ? 'tracks' : 'roads';
          const width = Number.parseFloat(t.width) || (group === 'paths' ? 2 : group === 'tracks' ? 3.4 : 5);
          infra[group].push({ id, line, w: width, widthMetres: width, kind: t.highway, surface: t.surface || 'unknown', ...(t.name ? { name: t.name } : {}), ...(t.oneway === 'yes' ? { oneway: true } : {}) });
        }
        if (t.waterway && !['culvert', 'yes'].includes(t.tunnel) && !t.covered) {
          streams.push({ id, line, w: Number.parseFloat(t.width) / 2 || 1, kind: t.waterway });
        }
        if (['wall', 'fence', 'hedge', 'retaining_wall'].includes(t.barrier)) (infra.barriers ??= []).push({ id, line, kind: t.barrier === 'retaining_wall' ? 'wall' : t.barrier, sourceId: 'osm' });
        if (['line', 'minor_line'].includes(t.power)) infra.power.lines.push({ id, line, kind: t.power });
      } else if (g.type === 'Point' && t.power) {
        infra.power[t.power === 'tower' ? 'towers' : 'poles'].push(mappedOnly ? { id, c: local(g.coordinates), sourceId: 'osm' } : local(g.coordinates));
      }
    }
  }

  const mPerLon = +(111320 * Math.cos(frame.latitude * Math.PI / 180)).toFixed(2);
  const model = {
    version: 1,
    origin: { lat: frame.latitude, lon: frame.longitude },
    mPerLat: 111320,
    mPerLon,
    frame: frame.text || `local metres from EPSG:3006; east +x, north -z; origin E${frame.easting} N${frame.northing}; heights RH 2000`,
    seaLevel,
    holes,
    water,
    streams,
    coast: [],
    vegetation,
    infra,
    surround: { clearfells: [], yard: null, hayfields: null, shallows: [] },
    scenery,
    pois: [],
    evidence: {
      status: 'provisional-source-derived',
      groundId,
      slug,
      terrain: fineTerrain.sha256 || null,
      terrainModifiedForPlayingSurfaces: false,
      siblingSceneryFeatures: siblingCount,
      ...evidence,
    },
  };

  // Hard guard: refuse to emit if ANY EPSG:3006 coordinate leaked into the local model
  assertNoEpsg3006Leakage(model);

  // Build GPK1 compatibility HF0 (4 m) + HF1 (vista) directly from measured Float32 arrays
  const hf0Span = Math.min(hf0SpanMetres, (fineTerrain.side - 1) * fineTerrain.spacing);
  const hf0Step = Math.max(1, Math.round(4 / fineTerrain.spacing));
  const hf0Side = Math.floor(hf0Span / 4) + 1;
  const startOffsetSamples = Math.round(((fineTerrain.side - 1) - (hf0Side - 1) * hf0Step) / 2);
  const hf0X0 = fineTerrain.x0 + startOffsetSamples * fineTerrain.spacing;
  const hf0Z0 = fineTerrain.z0 + startOffsetSamples * fineTerrain.spacing;
  const hf0Values = new Float32Array(hf0Side * hf0Side);
  for (let r = 0; r < hf0Side; r++) {
    for (let c = 0; c < hf0Side; c++) {
      const sr = startOffsetSamples + r * hf0Step;
      const sc = startOffsetSamples + c * hf0Step;
      hf0Values[r * hf0Side + c] = fineTerrain.float32[sr * fineTerrain.side + sc];
    }
  }

  const vistaSource = vistaTerrain || {
    float32: hf0Values,
    side: hf0Side,
    spacing: 4,
    x0: hf0X0,
    z0: hf0Z0,
  };
  const heightfields = {
    source: {
      product: 'Lantmäteriet Markhöjdmodell 1 m',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      fineInputSha256: fineTerrain.sha256 || null,
      note: 'GPK1 HF0 subsamples 1 m source at 4 m; v2 runtime retains full 1 m grid.',
    },
    hf0: { x0: hf0X0, z0: hf0Z0, dx: 4, ...quantizeHF(hf0Values, hf0Side, hf0Side, 0.1) },
    hf1: { x0: vistaSource.x0, z0: vistaSource.z0, dx: vistaSource.spacing, ...quantizeHF(vistaSource.float32, vistaSource.side, vistaSource.side, 0.25) },
  };

  const outCard = {
    teeNames: card.tees.map(t => t.name),
    source: card.source || null,
    holes: holes.map(h => ({ n: h.n, par: h.par, hcp: h.idx, t: h.t })),
  };

  return { model, heightfields, card: outCard, siblingCount };
}

function readJson(p) { return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')); }

function loadRawTerrain(spec, frame) {
  const bytes = fs.readFileSync(path.resolve(spec.path));
  const actualSha = sha256(bytes);
  if (spec.sha256 && spec.sha256 !== actualSha) {
    throw new Error(`terrain SHA-256 mismatch at ${spec.path}: expected ${spec.sha256}, got ${actualSha}`);
  }
  const float32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const side = spec.side ?? Math.round(Math.sqrt(float32.length));
  const spacing = spec.spacing ?? 1;
  const x0 = spec.x0 ?? (spec.originEasting !== undefined ? spec.originEasting - frame.easting : -((side - 1) * spacing) / 2);
  const z0 = spec.z0 ?? (spec.originNorthing !== undefined ? frame.northing - spec.originNorthing : -((side - 1) * spacing) / 2);
  return { float32, side, spacing, x0, z0, sha256: actualSha };
}

function main() {
  const idx = process.argv.indexOf('--config');
  if (idx < 0 || !process.argv[idx + 1]) {
    throw new Error('Usage: compile-grid-course.mjs --config course-input.json');
  }
  const configPath = path.resolve(process.argv[idx + 1]);
  const baseDir = path.dirname(configPath);
  const cfg = readJson(configPath);
  const rel = p => p ? path.resolve(baseDir, p) : null;

  const { model, heightfields, card, siblingCount } = compileGridCourse({
    groundId: cfg.groundId,
    slug: cfg.slug,
    frame: cfg.frame,
    seaLevel: cfg.seaLevel ?? 0,
    card: readJson(rel(cfg.card)),
    requireRated: cfg.requireRated ?? true,
    guideNotes: readJson(rel(cfg.guideNotes)),
    routesGeoJson: readJson(rel(cfg.routes)),
    surfacesGeoJson: readJson(rel(cfg.surfaces)),
    siblingSurfacesGeoJson: cfg.siblingSurfaces ? readJson(rel(cfg.siblingSurfaces)) : null,
    facilitiesGeoJson: cfg.facilities ? readJson(rel(cfg.facilities)) : null,
    waterGeoJson: cfg.water ? readJson(rel(cfg.water)) : null,
    infrastructureGeoJson: cfg.infrastructure ? readJson(rel(cfg.infrastructure)) : null,
    contextGeoJson: cfg.context ? readJson(rel(cfg.context)) : null,
    fineTerrain: loadRawTerrain({ ...cfg.fineTerrain, path: rel(cfg.fineTerrain.path) }, cfg.frame),
    vistaTerrain: cfg.vistaTerrain ? loadRawTerrain({ ...cfg.vistaTerrain, path: rel(cfg.vistaTerrain.path) }, cfg.frame) : null,
    defaultTeeIndex: cfg.defaultTeeIndex ?? 1,
    placement: cfg.placement || {},
    farBuildings: cfg.farBuildings ? readJson(rel(cfg.farBuildings)).boxes : null,
    hf0SpanMetres: cfg.hf0SpanMetres ?? 2048,
    evidence: cfg.evidence || {},
  });

  const outDir = rel(cfg.outDir || '.');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'course-model.json'), JSON.stringify(model, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'heightfields.json'), JSON.stringify(heightfields, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'card.json'), JSON.stringify(card, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    slug: cfg.slug,
    holes: model.holes.length,
    water: model.water.length,
    bulkheads: model.infra.bulkheads.length,
    bridges: model.infra.bridges.length,
    siblingSceneryFeatures: siblingCount,
    outDir,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
