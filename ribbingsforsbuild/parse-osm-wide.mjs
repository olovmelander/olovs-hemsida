#!/usr/bin/env node
/* Parse the wide Ribbingsfors OSM extract into osm-surroundings.json.

   This is deliberately a much richer read than build-course.mjs's core parse:
   it assembles multipolygon relations (Skagern, the forest and wetland and
   farmland rings around the course), keeps waterway lines, piers, the power
   corridor with its towers, named places, barriers and pitches — everything
   the surroundings model needs. It needs no GDAL: projection is the repo's
   own Krüger series (see frame.mjs for the measured agreement with cs2cs).

   Usage: node ribbingsforsbuild/fetch-osm-wide.mjs && node ribbingsforsbuild/parse-osm-wide.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polyArea, ring1, simplifyDP } from '../geobuild/lib.mjs';
import { FRAME, localFromLatLon, r1 } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const XML_FILE = path.join(HERE, 'cache', 'osm-wide.xml');
const OUT_FILE = path.join(HERE, 'osm-surroundings.json');
/* Everything inside the vista heightfield can be drawn; beyond it nothing is.
   A relation can drag in ways far outside the bbox (a lift gate arrived from
   10 km north), so every feature is distance-gated against the origin. */
const KEEP_RADIUS = 4600;

const xml = fs.readFileSync(XML_FILE, 'utf8');

const nodes = new Map();
const nodeTags = new Map();
for (const match of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g)) {
  nodes.set(match[1], localFromLatLon(+match[2], +match[3]));
  if (match[5]) {
    const tags = {};
    for (const tag of match[5].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[tag[1]] = tag[2];
    if (Object.keys(tags).length) nodeTags.set(match[1], tags);
  }
}

const ways = new Map();
for (const match of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
  const tags = {};
  for (const tag of match[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[tag[1]] = tag[2];
  const refs = [...match[2].matchAll(/<nd ref="(\d+)"/g)].map(item => item[1]);
  ways.set(match[1], { id: `w${match[1]}`, tags, refs,
    points: refs.map(ref => nodes.get(ref)).filter(Boolean),
    closed: refs.length > 3 && refs[0] === refs.at(-1) });
}

const relations = [];
for (const match of xml.matchAll(/<relation id="(\d+)"[^>]*>([\s\S]*?)<\/relation>/g)) {
  const tags = {};
  for (const tag of match[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[tag[1]] = tag[2];
  const members = [...match[2].matchAll(/<member type="way" ref="(\d+)" role="([^"]*)"/g)]
    .map(item => ({ ref: item[1], role: item[2] }));
  relations.push({ id: `r${match[1]}`, tags, members });
}

const near = points => points.some(([x, z]) => Math.hypot(x, z) <= KEEP_RADIUS);
/* Clip a ring to the keep box (Sutherland–Hodgman). A relation can hand this
   parser a polygon reaching kilometres past the vista heightfield; everything
   outside the box is undrawable, and an unclipped 76 km power line once made
   the committed file mostly invisible geometry. */
function clipRingToBox(points, half = KEEP_RADIUS) {
  let output = points;
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const input = output;
    output = [];
    const inside = p => sign * p[axis] <= half;
    for (let index = 0; index < input.length; index++) {
      const current = input[index], previous = input[(index + input.length - 1) % input.length];
      const currentIn = inside(current), previousIn = inside(previous);
      if (currentIn !== previousIn) {
        const t = (sign * half - sign * previous[axis]) /
          (sign * current[axis] - sign * previous[axis]);
        output.push([previous[0] + (current[0] - previous[0]) * t,
          previous[1] + (current[1] - previous[1]) * t]);
      }
      if (currentIn) output.push(current);
    }
    if (output.length < 3) return null;
  }
  return output;
}
/* Clip a polyline to the keep box, splitting it into the runs inside it. */
function clipLineToBox(points, half = KEEP_RADIUS) {
  const inside = p => Math.abs(p[0]) <= half && Math.abs(p[1]) <= half;
  const cross = (a, b) => {
    /* March from a toward b, clamping at each violated box edge. */
    let t0 = 0, t1 = 1;
    for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
      const pa = sign * a[axis], pb = sign * b[axis];
      if (pa > half && pb > half) return null;
      if (pa > half) t0 = Math.max(t0, (pa - half) / (pa - pb));
      else if (pb > half) t1 = Math.min(t1, (pa - half) / (pa - pb));
    }
    if (t0 > t1) return null;
    const at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [at(t0), at(t1)];
  };
  const runs = [];
  let current = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    if (inside(a) && inside(b)) {
      if (!current.length) current.push(a);
      current.push(b);
      continue;
    }
    const clipped = cross(a, b);
    if (!clipped) { if (current.length > 1) runs.push(current); current = []; continue; }
    if (!current.length) current.push(clipped[0]);
    current.push(clipped[1]);
    if (!inside(b)) { if (current.length > 1) runs.push(current); current = []; }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}
const ring = (way, tolerance = 1.5) => {
  if (!way.closed || way.points.length < 4) return null;
  const clipped = clipRingToBox(way.points.slice(0, -1));
  if (!clipped) return null;
  const simplified = simplifyDP([...clipped, clipped[0]], tolerance).slice(0, -1);
  return simplified.length >= 3 && near(simplified) ? ring1(simplified) : null;
};
/* A way that leaves and re-enters the box comes back as several runs. */
const lineRuns = (way, tolerance = 1) => clipLineToBox(way.points)
  .map(run => simplifyDP(run, tolerance))
  .filter(run => run.length >= 2 && near(run))
  .map(run => ring1(run));
const line = (way, tolerance = 1) => lineRuns(way, tolerance)[0] || null;

/* Chain a relation's member ways of one role into rings and open runs by
   matching endpoint node ids. The map API only returns members that touch the
   bbox, so a lake that leaves the extract comes out as open shoreline runs. */
function chainMembers(members, role) {
  const pool = members.filter(member => member.role === role)
    .map(member => ways.get(member.ref)).filter(way => way && way.refs.length >= 2)
    .map(way => ({ refs: [...way.refs], points: [...way.points] }));
  const rings = [], runs = [];
  while (pool.length) {
    let { refs, points } = pool.shift();
    let extended = true;
    while (extended && refs[0] !== refs.at(-1)) {
      extended = false;
      for (let index = 0; index < pool.length; index++) {
        const candidate = pool[index];
        if (candidate.refs[0] === refs.at(-1)) {
          refs = refs.concat(candidate.refs.slice(1));
          points = points.concat(candidate.points.slice(1));
        } else if (candidate.refs.at(-1) === refs.at(-1)) {
          refs = refs.concat([...candidate.refs].reverse().slice(1));
          points = points.concat([...candidate.points].reverse().slice(1));
        } else if (candidate.refs.at(-1) === refs[0]) {
          refs = candidate.refs.concat(refs.slice(1));
          points = candidate.points.concat(points.slice(1));
        } else if (candidate.refs[0] === refs[0]) {
          refs = [...candidate.refs].reverse().concat(refs.slice(1));
          points = [...candidate.points].reverse().concat(points.slice(1));
        } else continue;
        pool.splice(index, 1);
        extended = true;
        break;
      }
    }
    if (refs.length > 3 && refs[0] === refs.at(-1)) {
      const clipped = clipRingToBox(points.slice(0, -1));
      if (!clipped) continue;
      const simplified = simplifyDP([...clipped, clipped[0]], 1.5).slice(0, -1);
      if (simplified.length >= 3 && near(simplified)) rings.push(ring1(simplified));
    } else {
      for (const clipped of clipLineToBox(points)) {
        const simplified = simplifyDP(clipped, 2);
        if (simplified.length >= 2 && near(simplified)) runs.push(ring1(simplified));
      }
    }
  }
  return { rings, runs };
}

const out = {
  schemaVersion: 1,
  source: 'https://api.openstreetmap.org/api/0.6/map?bbox=14.090,58.948,14.160,58.985',
  licence: 'ODbL-1.0; © OpenStreetMap contributors',
  generatedFrame: { easting: FRAME.easting, northing: FRAME.northing },
  projection: 'packages/course-geo/chmv2/projection.mjs Krüger series; agrees with the cs2cs frame origin to <1 mm',
  keepRadiusMetres: KEEP_RADIUS,
  courseBoundary: null,
  skagern: null,
  lakes: [], waterways: [],
  forest: [], wood: [], scrub: [], wetland: [], grass: [],
  farmland: [], landuse: [],
  paths: [], tracks: [], roads: [], railway: [],
  buildings: [], parking: [], piers: [], pitches: [],
  power: { lines: [], towers: [], poles: [] },
  pois: [], barriers: [],
};

const powerWayNodeRefs = new Set();
for (const way of ways.values()) {
  const t = way.tags;
  if (way.closed && t.leisure === 'golf_course') {
    const geometry = ring(way, 1);
    if (geometry) out.courseBoundary = { id: way.id, ring: geometry, name: t.name || null };
  } else if (way.closed && t.natural === 'water') {
    const geometry = ring(way, 1.2);
    if (geometry) out.lakes.push({ id: way.id, ring: geometry, name: t.name || null,
      kind: t.water || 'water', area: Math.round(Math.abs(polyArea(geometry))) });
  } else if (t.waterway && !way.closed) {
    for (const geometry of lineRuns(way, 1.2)) {
      out.waterways.push({ id: way.id, line: geometry, kind: t.waterway, name: t.name || null });
    }
  } else if (way.closed && (t.landuse === 'forest' || t.natural === 'wood')) {
    const geometry = ring(way, 1.5);
    if (geometry) (t.natural === 'wood' ? out.wood : out.forest).push(geometry);
  } else if (way.closed && t.natural === 'scrub') {
    const geometry = ring(way, 1.5); if (geometry) out.scrub.push(geometry);
  } else if (way.closed && t.natural === 'wetland') {
    const geometry = ring(way, 1.5); if (geometry) out.wetland.push(geometry);
  } else if (way.closed && /^(grass|meadow|village_green)$/.test(t.landuse || '')) {
    const geometry = ring(way, 1.2); if (geometry) out.grass.push(geometry);
  } else if (way.closed && /^(farmland|farmyard|residential|industrial|commercial)$/.test(t.landuse || '')) {
    const geometry = ring(way, 2);
    if (geometry) (t.landuse === 'farmland' ? out.farmland : out.landuse)
      .push({ ring: geometry, kind: t.landuse });
  } else if (way.closed && t.building) {
    const geometry = ring(way, 0.4);
    if (geometry) out.buildings.push({ id: way.id, ring: geometry,
      h: t.height ? +t.height : t['building:levels'] ? +t['building:levels'] * 3.1 : null,
      kind: t.building, name: t.name || null, amenity: t.amenity || null });
  } else if (way.closed && t.amenity === 'parking') {
    const geometry = ring(way, 0.6);
    if (geometry) out.parking.push({ id: way.id, ring: geometry, surface: t.surface || null,
      operator: t.operator || null, area: Math.round(Math.abs(polyArea(geometry))) });
  } else if (way.closed && t.leisure === 'pitch') {
    const geometry = ring(way, 0.6);
    if (geometry) out.pitches.push({ id: way.id, ring: geometry, sport: t.sport || null });
  } else if (t.man_made === 'pier') {
    const geometry = line(way, 0.6);
    if (geometry) out.piers.push({ id: way.id, line: geometry });
  } else if (/^(rail|disused|preserved|narrow_gauge)$/.test(t.railway || '')) {
    /* Otterbäcksbanan/Torvedsbanan: the disused Gullspång railway, kept for
       rail-bike tourism (the "dressinuthyrning" POI is its hire point). */
    for (const geometry of lineRuns(way, 1.5)) {
      out.railway.push({ id: way.id, line: geometry, kind: t.railway,
        name: t.name || null, usage: t.usage || null });
    }
  } else if (t.power === 'line' || t.power === 'minor_line') {
    const runs = lineRuns(way, 2);
    if (runs.length) for (const ref of way.refs) powerWayNodeRefs.add(ref);
    for (const geometry of runs) {
      out.power.lines.push({ id: way.id, line: geometry,
        voltage: t.voltage ? +t.voltage : null, kind: t.power });
    }
  } else if (t.highway) {
    if (t.highway === 'platform') continue;
    for (const geometry of lineRuns(way, 1)) {
      const record = { id: way.id, line: geometry, kind: t.highway, surface: t.surface || null };
      if (/^(path|footway|cycleway|bridleway|steps)$/.test(t.highway)) out.paths.push(record);
      else if (/^(track|service)$/.test(t.highway)) out.tracks.push(record);
      else out.roads.push({ ...record, name: t.name || null, ref: t.ref || null,
        lanes: t.lanes ? +t.lanes : null, oneway: t.oneway === 'yes',
        maxspeed: t.maxspeed ? +t.maxspeed : null, lit: t.lit === 'yes' });
    }
  }
}

for (const relation of relations) {
  const t = relation.tags;
  if (t.type !== 'multipolygon') continue;
  if (t.natural === 'water' && t.name === 'Skagern') {
    const outer = chainMembers(relation.members, 'outer');
    const inner = chainMembers(relation.members, 'inner');
    out.skagern = { relationId: relation.id, name: t.name, ele: t.ele ? +t.ele : null,
      wikidata: t.wikidata || null,
      outerRuns: outer.runs, outerRings: outer.rings, islands: inner.rings };
  } else if (t.landuse === 'forest' || t.natural === 'wood') {
    const { rings } = chainMembers(relation.members, 'outer');
    out.forest.push(...rings);
  } else if (t.natural === 'wetland') {
    const { rings } = chainMembers(relation.members, 'outer');
    out.wetland.push(...rings);
  } else if (t.natural === 'scrub') {
    const { rings } = chainMembers(relation.members, 'outer');
    out.scrub.push(...rings);
  } else if (/^(farmland|farmyard|residential|industrial|commercial)$/.test(t.landuse || '')) {
    const { rings } = chainMembers(relation.members, 'outer');
    for (const geometry of rings) (t.landuse === 'farmland' ? out.farmland : out.landuse)
      .push({ ring: geometry, kind: t.landuse });
  }
}

for (const [id, tags] of nodeTags) {
  const point = nodes.get(id);
  if (!point || Math.hypot(point[0], point[1]) > KEEP_RADIUS) continue;
  const [x, z] = point;
  if (tags.place) out.pois.push({ x, z, kind: `place:${tags.place}`, name: tags.name || null, ele: null });
  else if (tags.natural === 'peak') out.pois.push({ x, z, kind: 'peak',
    name: tags.name || null, ele: tags.ele ? +tags.ele : null });
  else if (tags.man_made === 'mast') out.pois.push({ x, z, kind: 'mast', name: tags.name || null, ele: null });
  else if (tags.man_made === 'chimney') out.pois.push({ x, z, kind: 'chimney', name: tags.name || null, ele: null });
  else if (tags.tourism === 'attraction') out.pois.push({ x, z, kind: 'attraction', name: tags.name || null, ele: null });
  else if (tags.amenity === 'shelter') out.pois.push({ x, z, kind: 'shelter', name: tags.name || null, ele: null });
  else if (tags.barrier) out.barriers.push({ x, z, kind: tags.barrier });
  if (tags.power === 'tower' && powerWayNodeRefs.has(id)) out.power.towers.push([x, z]);
  else if (tags.power === 'pole' && powerWayNodeRefs.has(id)) out.power.poles.push([x, z]);
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out));
const counts = Object.entries(out)
  .filter(([, value]) => Array.isArray(value))
  .map(([key, value]) => `${key} ${value.length}`).join(', ');
console.log(`wrote ${path.relative(process.cwd(), OUT_FILE)}`);
console.log(counts);
console.log(`power: ${out.power.lines.length} lines, ${out.power.towers.length} towers`);
if (out.skagern) console.log(`skagern: ${out.skagern.outerRuns.length} shoreline runs, ` +
  `${out.skagern.outerRings.length} closed rings, ${out.skagern.islands.length} islands, ele ${out.skagern.ele}`);
