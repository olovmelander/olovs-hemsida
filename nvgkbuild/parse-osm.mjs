/* Turn the cached OSM extract into course-frame vectors — Norrfällsviken edition.

   Same state machine as geobuild/parse-osm.mjs, with the two differences this
   site forces. There are no golf polygons here beyond the clubhouse, so the
   course hull that scenery is trimmed against comes from the club's GPS survey
   rather than from OSM golf ways. And the water that matters is the SEA: the
   natural=coastline chain is collected as first-class geometry, because the
   eastern edge of this course is the Gulf of Bothnia.                           */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE, lonLatToXZ, simplifyDP, polyArea, centroid, bbox,
  ring1, r1, writeJSON, polyLen,
} from './lib.mjs';

const files = [path.join(CACHE, 'osm-core.xml')];
for (const f of fs.readdirSync(CACHE)) if (/^osm-rel-/.test(f)) files.push(path.join(CACHE, f));
const wayDir = path.join(CACHE, 'ways');
if (fs.existsSync(wayDir)) for (const f of fs.readdirSync(wayDir)) files.push(path.join(wayDir, f));

const decodeMap = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => decodeMap[m]);

const nodes = new Map();
const nodeTags = new Map();
const ways = new Map();
const rels = [];

for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g))
    if (!nodes.has(m[1])) nodes.set(m[1], lonLatToXZ(+m[3], +m[2]));
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="[-\d.]+"[^>]*?lon="[-\d.]+"[^/]*?>([\s\S]*?)<\/node>/g)) {
    if (nodeTags.has(m[1])) continue;
    const tags = {};
    for (const t of m[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = decode(t[2]);
    if (Object.keys(tags).length) nodeTags.set(m[1], tags);
  }
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*?(\/>|>[\s\S]*?<\/way>)/g)) {
    if (ways.has(m[1])) continue;
    const refs = [...m[0].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]);
    const tags = {};
    for (const t of m[0].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = decode(t[2]);
    ways.set(m[1], { id: m[1], refs, tags });
  }
  for (const m of xml.matchAll(/<relation id="(\d+)"[\s\S]*?<\/relation>/g)) {
    const tags = {};
    for (const t of m[0].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = decode(t[2]);
    const members = [...m[0].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"/g)]
      .map(x => ({ type: x[1], ref: x[2], role: x[3] }));
    rels.push({ id: m[1], tags, members });
  }
}
console.log(`parsed ${nodes.size} nodes, ${ways.size} ways, ${rels.length} relations`);

/* --- geometry helpers -------------------------------------------------------- */
const ptsOf = w => w.refs.map(r => nodes.get(r)).filter(Boolean);
const isClosed = w => w.refs.length > 3 && w.refs[0] === w.refs[w.refs.length - 1];

function ringOf(w, tol = 0.75) {
  const p = ptsOf(w);
  if (p.length < 4) return null;
  const open = p.slice(0, -1);
  const s = simplifyDP([...open, open[0]], tol).slice(0, -1);
  return s.length >= 3 ? ring1(s) : null;
}
function lineOf(w, tol = 0.75) {
  const p = ptsOf(w);
  return p.length >= 2 ? ring1(simplifyDP(p, tol)) : null;
}

function obbOf(ring) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
    const ang = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of hull) {
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { area, cx: um * c - vm * s, cz: um * s + vm * c,
               hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, ang };
    }
  }
  return best;
}

/* the course hull, from the GPS survey — OSM has no golf polygons to derive it from */
const gps = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'geo_data', 'norrfallsviken_clean.json'), 'utf8'));
const gpsPts = gps.features.map(f => lonLatToXZ(...f.geometry.coordinates));
const CB = bbox(gpsPts);
console.log(`course bbox (GPS): x ${CB.x0.toFixed(0)}..${CB.x1.toFixed(0)}  z ${CB.z0.toFixed(0)}..${CB.z1.toFixed(0)}`);
const near = (pts, pad) =>
  pts.some(p => p[0] > CB.x0 - pad && p[0] < CB.x1 + pad && p[1] > CB.z0 - pad && p[1] < CB.z1 + pad);

/* --- collect ----------------------------------------------------------------- */
const out = {
  origin: { lat: undefined, lon: undefined },
  greens: [], fairways: [], tees: [], bunkers: [], roughs: [], holeWays: [], drivingRange: [],
  water: [], waterway: [], coastline: [], basins: [],
  forest: [], wood: [], scrub: [], sand: [], rock: [], wetland: [], grass: [],
  paths: [], tracks: [], roads: [], buildings: [], farBuildings: [],
  parking: [], piers: [], pitches: [],
  landuse: [], reserves: [],
  courseBoundary: null,
};

for (const w of ways.values()) {
  const t = w.tags;
  const closed = isClosed(w);

  if (t.leisure === 'golf_course' && closed) {
    const ring = ringOf(w, 1.5);
    if (ring) out.courseBoundary = { id: 'w' + w.id, ring, name: t.name || null };
    continue;
  }
  if (t.golf && t.golf !== 'clubhouse') continue;   // none exist; clubhouse is a building below

  const pts = ptsOf(w);
  if (!pts.length) continue;

  if (t.natural === 'coastline') {
    /* NOT trimmed by near(): the whole cape's outline is the scene's edge */
    const line = lineOf(w, 1.0);
    if (line) out.coastline.push({ id: 'w' + w.id, line });
  } else if (t.natural === 'water' || t.water || t.landuse === 'reservoir') {
    if (!closed) continue;
    const ring = ringOf(w, 1.2);
    if (!ring) continue;
    out.water.push({ id: 'w' + w.id, ring, name: t.name || null,
                     kind: t.water || t.natural || 'water', area: Math.round(Math.abs(polyArea(ring))) });
  } else if (closed && t.landuse === 'basin') {
    const ring = ringOf(w, 0.8);
    if (ring) out.basins.push({ id: 'w' + w.id, ring, area: Math.round(Math.abs(polyArea(ring))) });
  } else if (t.waterway && !closed) {
    if (!near(pts, 900)) continue;
    const line = lineOf(w, 1.2);
    if (line) out.waterway.push({ id: 'w' + w.id, line, kind: t.waterway, name: t.name || null });
  } else if (closed && (t.landuse === 'forest' || t.natural === 'wood')) {
    const ring = ringOf(w, 2.0);
    if (ring) (t.natural === 'wood' ? out.wood : out.forest)
      .push({ id: 'w' + w.id, ring, area: Math.round(Math.abs(polyArea(ring))) });
  } else if (closed && t.natural === 'scrub') {
    const ring = ringOf(w, 2.0); if (ring) out.scrub.push({ id: 'w' + w.id, ring });
  } else if (closed && (t.natural === 'sand' || t.natural === 'beach')) {
    const ring = ringOf(w, 0.8);
    if (ring) out.sand.push({ id: 'w' + w.id, ring, kind: t.natural, name: t.name || null });
  } else if (closed && (t.natural === 'bare_rock' || t.natural === 'rock' || t.natural === 'cliff')) {
    const ring = ringOf(w, 1.5); if (ring) out.rock.push({ id: 'w' + w.id, ring });
  } else if (closed && t.natural === 'wetland') {
    const ring = ringOf(w, 2.0);
    if (ring) out.wetland.push({ id: 'w' + w.id, ring, kind: t.wetland || null,
                                 area: Math.round(Math.abs(polyArea(ring))) });
  } else if (closed && (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green')) {
    const ring = ringOf(w, 1.5); if (ring) out.grass.push({ id: 'w' + w.id, ring });
  } else if (closed && t.building) {
    if (near(pts, 1600)) {
      const ring = ringOf(w, 0.5);
      if (ring) out.buildings.push({ id: 'w' + w.id, ring,
        h: t.height ? parseFloat(t.height) : (t['building:levels'] ? 3.1 * parseFloat(t['building:levels']) : null),
        kind: t.building, name: t.name || null,
        amenity: t.amenity || (t.golf === 'clubhouse' ? 'clubhouse' : null) });
    } else {
      const ring = ringOf(w, 1.0);
      if (!ring || Math.abs(polyArea(ring)) < 45) continue;
      const b = obbOf(ring);
      if (b) out.farBuildings.push([r1(b.cx), r1(b.cz), r1(b.hw), r1(b.hd),
        +b.ang.toFixed(2), t.building === 'industrial' ? 1 : 0]);
    }
  } else if (closed && t.amenity === 'parking') {
    const ring = ringOf(w, 0.8);
    if (ring) out.parking.push({ id: 'w' + w.id, ring, surface: t.surface || null,
                                 area: Math.round(Math.abs(polyArea(ring))) });
  } else if (t.man_made === 'pier') {
    if (closed) { const ring = ringOf(w, 0.5); if (ring) out.piers.push({ id: 'w' + w.id, ring }); }
    else { const line = lineOf(w, 0.5); if (line) out.piers.push({ id: 'w' + w.id, line }); }
  } else if (closed && t.leisure === 'pitch') {
    const ring = ringOf(w, 0.8);
    if (ring) out.pitches.push({ id: 'w' + w.id, ring, sport: t.sport || null });
  } else if (closed && t.leisure === 'nature_reserve') {
    const ring = ringOf(w, 3);
    if (ring) out.reserves.push({ id: 'w' + w.id, ring, name: t.name || null });
  } else if (closed && /^(residential|farmland|farmyard|industrial|commercial|allotments)$/.test(t.landuse || '')) {
    const ring = ringOf(w, 3);
    if (ring) out.landuse.push({ id: 'w' + w.id, ring, kind: t.landuse, name: t.name || null });
  } else if (t.highway) {
    const line = lineOf(w, 1.2);
    if (!line) continue;
    const rec = { id: 'w' + w.id, line, kind: t.highway, surface: t.surface || null };
    if (/^(path|footway|cycleway|bridleway|steps)$/.test(t.highway)) out.paths.push(rec);
    else if (/^(track|service)$/.test(t.highway)) out.tracks.push(rec);
    else out.roads.push({ ...rec, name: t.name || null, lanes: t.lanes ? +t.lanes : null,
                          oneway: t.oneway === 'yes', maxspeed: t.maxspeed ? +t.maxspeed : null,
                          lit: t.lit === 'yes' });
  }
}

/* named point features worth keeping: peaks, the bathing place, viewpoints */
out.pois = [];
for (const [id, t] of nodeTags) {
  const p = nodes.get(id);
  if (!p) continue;
  if (t.natural === 'peak' || t.leisure === 'bathing_place' || t.tourism === 'viewpoint'
      || t.amenity === 'restaurant' || t.leisure === 'marina' || t.place) {
    out.pois.push({ x: r1(p[0]), z: r1(p[1]),
      kind: t.natural || t.leisure || t.tourism || t.amenity || ('place:' + t.place),
      name: t.name || null, ele: t.ele ? +t.ele : null });
  }
}

/* multipolygon water/wetland relations, if any: outer rings only */
for (const r of rels) {
  const isWater = r.tags.natural === 'water' || r.tags.water != null;
  const isWet = r.tags.natural === 'wetland';
  if (!isWater && !isWet) continue;
  for (const m of r.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w || !isClosed(w)) continue;
    const list = isWater ? out.water : out.wetland;
    if (list.some(x => x.id === 'w' + w.id)) continue;
    const ring = ringOf(w, 1.2);
    if (ring) list.push({ id: 'w' + w.id, ring, name: r.tags.name || null,
                          kind: isWater ? 'lake' : (r.tags.wetland || null),
                          area: Math.round(Math.abs(polyArea(ring))), rel: r.id });
  }
}

out.water.sort((a, b) => b.area - a.area);
const { ORIGIN } = await import('./lib.mjs');
out.origin = { lat: ORIGIN.lat, lon: ORIGIN.lon };

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'osm-features.json');
writeJSON(dest, out);

const n = k => (out[k] || []).length;
console.log(`sea      coastline ${n('coastline')} chains  basins ${n('basins')}  piers ${n('piers')}`);
console.log(`nature   water ${n('water')}  waterway ${n('waterway')}  forest ${n('forest')}  wood ${n('wood')}  sand ${n('sand')}  wetland ${n('wetland')}  grass ${n('grass')}  reserves ${n('reserves')}`);
console.log(`infra    paths ${n('paths')}  tracks ${n('tracks')}  roads ${n('roads')}  buildings ${n('buildings')}  far ${n('farBuildings')}  parking ${n('parking')}  pitches ${n('pitches')}`);
console.log(`pois     ${out.pois.map(p => p.name || p.kind).join(', ')}`);
if (out.water[0]) {
  const w = out.water[0];
  console.log(`largest water: ${w.name || w.id} area ${(w.area / 1e3).toFixed(1)} k m², ${w.ring.length} pts`);
}
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
