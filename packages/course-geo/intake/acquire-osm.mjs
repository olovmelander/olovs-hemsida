#!/usr/bin/env node
/* Ground-agnostic OpenStreetMap golf & context intake.
 *
 * Queries the primary Overpass endpoint (refusing lagging mirrors when
 * freshness bounds are declared), isolates the target golf club's geometry from
 * neighbouring golf courses, projects all features into EPSG:3006, and writes a
 * per-hole gap report + ODbL provenance receipt.
 *
 * Usage:
 *   node packages/course-geo/intake/acquire-osm.mjs \
 *     --ground bro-hof --bbox-wgs84 17.595,59.475,17.665,59.515 \
 *     --target-relation 5509342 --out-dir geo_data/course-v2/bro-hof/reference
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../chmv2/projection.mjs';

export const PRIMARY_OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function ringBbox(ring) {
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
  for (const [e, n] of ring) {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  return [minE, minN, maxE, maxN];
}

export function elementRingsEpsg3006(el) {
  const project = pts => pts.map(p => latLonToSweref99Tm(p.lat, p.lon).map(v => Math.round(v * 1000) / 1000));
  if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
    return [project(el.geometry)];
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    const outers = el.members
      .filter(m => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length >= 2 && m.role !== 'inner')
      .map(m => project(m.geometry));
    return stitchRings(outers);
  }
  return [];
}

/** Stitch open OSM relation member ways into closed rings where endpoints match. */
export function stitchRings(segments, eps = 0.05) {
  const remaining = segments.map(s => [...s]);
  const rings = [];
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
  while (remaining.length) {
    const cur = remaining.shift();
    let changed = true;
    while (changed && !same(cur[0], cur[cur.length - 1])) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        if (same(cur[cur.length - 1], seg[0])) {
          cur.push(...seg.slice(1));
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        if (same(cur[cur.length - 1], seg[seg.length - 1])) {
          cur.push(...seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (cur.length >= 2) rings.push(cur);
  }
  return rings;
}

export function isClosedRing(coords, eps = 0.05) {
  return coords.length >= 4 && Math.hypot(coords[0][0] - coords.at(-1)[0], coords[0][1] - coords.at(-1)[1]) <= eps;
}

export function toGeoJsonFeature(el) {
  const tags = el.tags || {};
  const props = { osmType: el.type, osmId: el.id, tags };
  if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    const pt = latLonToSweref99Tm(el.lat, el.lon).map(v => Math.round(v * 1000) / 1000);
    return { type: 'Feature', id: `n${el.id}`, properties: props, geometry: { type: 'Point', coordinates: pt } };
  }
  if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
    const coords = el.geometry.map(p => latLonToSweref99Tm(p.lat, p.lon).map(v => Math.round(v * 1000) / 1000));
    const closed = isClosedRing(coords);
    const linearTag = tags.golf === 'hole' || tags.golf === 'cartpath' || tags.golf === 'path' ||
      tags.highway || tags.waterway || tags.barrier || tags.power === 'line' || tags.power === 'minor_line' || tags.railway;
    const isArea = closed && (!linearTag || tags.area === 'yes');
    if (isArea) {
      coords[coords.length - 1] = [...coords[0]];
      return { type: 'Feature', id: `w${el.id}`, properties: props, geometry: { type: 'Polygon', coordinates: [coords] } };
    }
    return { type: 'Feature', id: `w${el.id}`, properties: props, geometry: { type: 'LineString', coordinates: coords } };
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    const project = pts => pts.map(p => latLonToSweref99Tm(p.lat, p.lon).map(v => Math.round(v * 1000) / 1000));
    const outerSegs = el.members.filter(m => m.type === 'way' && m.geometry?.length >= 2 && m.role !== 'inner').map(m => project(m.geometry));
    const innerSegs = el.members.filter(m => m.type === 'way' && m.geometry?.length >= 2 && m.role === 'inner').map(m => project(m.geometry));
    const outers = stitchRings(outerSegs).filter(r => isClosedRing(r));
    const inners = stitchRings(innerSegs).filter(r => isClosedRing(r));
    if (!outers.length) return null;
    for (const r of [...outers, ...inners]) r[r.length - 1] = [...r[0]];
    if (outers.length === 1) {
      return { type: 'Feature', id: `r${el.id}`, properties: props, geometry: { type: 'Polygon', coordinates: [outers[0], ...inners] } };
    }
    const polys = outers.map(outer => {
      const bb = ringBbox(outer);
      const holes = inners.filter(inner => {
        const p = inner[0];
        return p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3] && pointInRing(p[0], p[1], outer);
      });
      return [outer, ...holes];
    });
    return { type: 'Feature', id: `r${el.id}`, properties: props, geometry: { type: 'MultiPolygon', coordinates: polys } };
  }
  return null;
}

function featureRepresentativePoint(feature) {
  const g = feature.geometry;
  if (g.type === 'Point') return g.coordinates;
  if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
  if (g.type === 'Polygon') {
    const ring = g.coordinates[0];
    let sx = 0, sy = 0;
    const n = ring.length - 1 || 1;
    for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / n, sy / n];
  }
  if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
  return null;
}

/**
 * Partition OSM elements into target-club golf features vs. surrounding context,
 * rejecting features belonging to neighbouring golf courses.
 */
export function partitionOsmElements(elements, {
  targetRelationId = null,
  targetWayId = null,
  targetBufferMetres = 120,
  expectedHoleCount = 18,
} = {}) {
  const courseBoundaries = elements.filter(el => el.tags?.leisure === 'golf_course');
  const targetBoundaryEl = courseBoundaries.find(el =>
    (targetRelationId && el.type === 'relation' && el.id === Number(targetRelationId)) ||
    (targetWayId && el.type === 'way' && el.id === Number(targetWayId))
  ) || null;
  const neighbourBoundaries = courseBoundaries.filter(el => el !== targetBoundaryEl);

  const targetRings = targetBoundaryEl ? elementRingsEpsg3006(targetBoundaryEl).filter(r => isClosedRing(r)) : [];
  const targetBbox = targetRings.length ? ringBbox(targetRings.flat()) : null;
  const neighbourRings = neighbourBoundaries.flatMap(el => elementRingsEpsg3006(el).filter(r => isClosedRing(r)));

  const inTarget = pt => {
    if (!pt) return false;
    if (neighbourRings.some(ring => pointInRing(pt[0], pt[1], ring))) return false;
    if (!targetRings.length) return true;
    if (targetRings.some(ring => pointInRing(pt[0], pt[1], ring))) return true;
    return pt[0] >= targetBbox[0] - targetBufferMetres && pt[0] <= targetBbox[2] + targetBufferMetres &&
      pt[1] >= targetBbox[1] - targetBufferMetres && pt[1] <= targetBbox[3] + targetBufferMetres;
  };

  const golfFeatures = [];
  const contextFeatures = [];
  const excludedNeighbourGolf = [];

  for (const el of elements) {
    const feature = toGeoJsonFeature(el);
    if (!feature) continue;
    const isGolf = Boolean(el.tags?.golf);
    const isBoundary = el.tags?.leisure === 'golf_course';
    if (isBoundary) {
      if (el === targetBoundaryEl) golfFeatures.push(feature);
      else contextFeatures.push(feature);
      continue;
    }
    if (isGolf) {
      const pt = featureRepresentativePoint(feature);
      if (inTarget(pt)) golfFeatures.push(feature);
      else excludedNeighbourGolf.push({ id: feature.id, golf: el.tags.golf, ref: el.tags.ref || null });
      continue;
    }
    contextFeatures.push(feature);
  }

  const golfCounts = {};
  const holeRefs = new Map();
  for (const f of golfFeatures) {
    const kind = f.properties.tags.golf || f.properties.tags.leisure;
    golfCounts[kind] = (golfCounts[kind] || 0) + 1;
    if (f.properties.tags.golf === 'hole') {
      const ref = Number(f.properties.tags.ref);
      if (Number.isInteger(ref)) {
        holeRefs.set(ref, [...(holeRefs.get(ref) || []), {
          id: f.id, par: f.properties.tags.par ? Number(f.properties.tags.par) : null,
          handicap: f.properties.tags.handicap ? Number(f.properties.tags.handicap) : null,
        }]);
      }
    }
  }
  const missingHoleRefs = [];
  for (let h = 1; h <= expectedHoleCount; h++) {
    if (!holeRefs.has(h)) missingHoleRefs.push(h);
  }

  return {
    golf: { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, features: golfFeatures },
    context: { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, features: contextFeatures },
    report: {
      targetBoundary: targetBoundaryEl ? { type: targetBoundaryEl.type, id: targetBoundaryEl.id, name: targetBoundaryEl.tags?.name || null, bboxEpsg3006: targetBbox } : null,
      neighbourBoundaries: neighbourBoundaries.map(el => ({ type: el.type, id: el.id, name: el.tags?.name || null })),
      excludedNeighbourGolfCount: excludedNeighbourGolf.length,
      golfCounts,
      contextFeatureCount: contextFeatures.length,
      expectedHoleCount,
      mappedHoleCount: holeRefs.size,
      missingHoleRefs,
    },
  };
}

export function assertOverpassFreshness(payload, maxAgeDays = 14) {
  const ts = payload?.osm3s?.timestamp_osm_base;
  if (!ts) throw new Error('Overpass response omitted osm3s.timestamp_osm_base');
  const ageMs = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ageMs)) throw new Error(`Invalid Overpass timestamp: ${ts}`);
  const ageDays = ageMs / 86_400_000;
  if (ageDays > maxAgeDays) {
    throw new Error(`Overpass mirror is stale (${ageDays.toFixed(1)} days old; timestamp ${ts}); retry primary overpass-api.de`);
  }
  return { timestampOsmBase: ts, ageDays: Math.round(ageDays * 100) / 100 };
}

export async function fetchOverpass(query, { endpoints = PRIMARY_OVERPASS_ENDPOINTS, maxAgeDays = 14, fetchImpl = fetch } = {}) {
  let lastError = null;
  for (const url of endpoints) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'course-geo-intake/1.0',
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      const text = await response.text();
      const payload = JSON.parse(text);
      const freshness = assertOverpassFreshness(payload, maxAgeDays);
      return { url, payload, rawBytes: Buffer.from(text, 'utf8'), freshness };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All primary Overpass endpoints failed: ${lastError?.message || 'unknown error'}`);
}

export function buildOverpassQuery([west, south, east, north]) {
  const b = `${south},${west},${north},${east}`;
  return `[out:json][timeout:60];
(
  way["golf"](${b});
  relation["golf"](${b});
  node["golf"](${b});
  way["leisure"="golf_course"](${b});
  relation["leisure"="golf_course"](${b});
  way["building"](${b});
  relation["building"](${b});
  way["natural"~"water|wood|wetland|scrub|heath|sand|bare_rock|coastline"](${b});
  relation["natural"~"water|wood|wetland|scrub|heath|sand|bare_rock"](${b});
  way["waterway"](${b});
  way["highway"](${b});
  way["bridge"](${b});
  way["man_made"~"pier|bridge|breakwater|embankment|mast|tower|flagpole"](${b});
  node["man_made"~"mast|tower|flagpole"](${b});
  way["barrier"](${b});
  way["amenity"="parking"](${b});
  way["landuse"~"forest|meadow|farmland|grass|residential|farmyard|orchard|recreation_ground"](${b});
  relation["landuse"~"forest|meadow|farmland|grass|residential"](${b});
  way["power"~"line|minor_line"](${b});
  node["power"~"tower|pole"](${b});
);
out body geom;`;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} requires a value`);
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ground = opts.ground;
  const bbox = (opts['bbox-wgs84'] || '').split(',').map(Number);
  if (!ground || bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) {
    throw new Error('Usage: acquire-osm.mjs --ground ID --bbox-wgs84 W,S,E,N --out-dir DIR [--target-relation ID] [--target-way ID] [--cache-dir DIR] [--expected-holes 18]');
  }
  const outDir = path.resolve(opts['out-dir']);
  const cacheDir = opts['cache-dir'] ? path.resolve(opts['cache-dir']) : null;
  const query = buildOverpassQuery(bbox);
  const { url, payload, rawBytes, freshness } = await fetchOverpass(query);

  fs.mkdirSync(outDir, { recursive: true });
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'overpass-raw.json'), rawBytes);
  }
  const { golf, context, report } = partitionOsmElements(payload.elements || [], {
    targetRelationId: opts['target-relation'] ? Number(opts['target-relation']) : null,
    targetWayId: opts['target-way'] ? Number(opts['target-way']) : null,
    expectedHoleCount: opts['expected-holes'] ? Number(opts['expected-holes']) : 18,
  });

  const writeJson = (file, data) => {
    const text = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(file, text, 'utf8');
    return { bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(Buffer.from(text, 'utf8')) };
  };

  const golfMeta = writeJson(path.join(outDir, 'osm-golf-epsg3006.geojson'), golf);
  const ctxMeta = writeJson(path.join(outDir, 'osm-context-epsg3006.geojson'), context);
  const receipt = {
    schemaVersion: 1,
    groundId: ground,
    provider: 'OpenStreetMap contributors',
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    endpoint: url,
    retrievedAt: new Date().toISOString(),
    timestampOsmBase: freshness.timestampOsmBase,
    bboxWgs84: bbox,
    rawResponse: { bytes: rawBytes.length, sha256: sha256(rawBytes), elementCount: (payload.elements || []).length },
    outputs: {
      golf: { file: 'osm-golf-epsg3006.geojson', ...golfMeta },
      context: { file: 'osm-context-epsg3006.geojson', ...ctxMeta },
    },
    report,
  };
  writeJson(path.join(outDir, 'osm-acquisition.json'), receipt);
  console.log(JSON.stringify({ groundId: ground, endpoint: url, freshness, report, outputs: receipt.outputs }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
