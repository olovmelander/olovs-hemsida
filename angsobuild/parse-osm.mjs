/* Turn the cached OSM extract into course-frame vectors.

   OSM XML is flat and regular enough that a small state machine beats a dependency.
   Everything comes out in local metres about ORIGIN, simplified to 0.75 m and
   rounded to a decimetre, which is finer than the survey behind any of it.        */
import fs from 'node:fs';
import path from 'node:path';
import {
  CACHE, ROOT, lonLatToXZ, simplifyDP, polyArea, centroid, bbox,
  ring1, r1, writeJSON, polyLen, pointInPoly,
} from './lib.mjs';

const files = [path.join(CACHE, 'osm-core.xml')];
for (const f of fs.readdirSync(CACHE)) if (/^osm-rel-/.test(f)) files.push(path.join(CACHE, f));
const wayDir = path.join(CACHE, 'ways');
if (fs.existsSync(wayDir)) for (const f of fs.readdirSync(wayDir)) files.push(path.join(wayDir, f));

const decodeMap = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => decodeMap[m]);

const nodes = new Map();          // id -> [x, z]
const nodeTags = new Map();       // id -> tags, only for nodes that carry any
const ways = new Map();           // id -> {id, refs, tags}
const rels = [];                  // {id, tags, members}

for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g))
    if (!nodes.has(m[1])) nodes.set(m[1], lonLatToXZ(+m[3], +m[2]));
  /* nodes with bodies carry tags -- power towers, bus stops, gates. The plain pass
     above only ever read lat/lon, which made every point feature invisible. */
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
  const open = p.slice(0, -1);                              // drop the repeated last point
  const s = simplifyDP([...open, open[0]], tol).slice(0, -1);
  return s.length >= 3 ? ring1(s) : null;
}
function lineOf(w, tol = 0.75) {
  const p = ptsOf(w);
  return p.length >= 2 ? ring1(simplifyDP(p, tol)) : null;
}

/* minimum-area oriented bounding box: convex hull, then rotating calipers. Distant
   buildings ship as five numbers instead of a ring. */
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

/* the course hull, so scenery can be trimmed to what a camera on the course sees */
/* Relation fetches for a big water body drag in ways from far away -- Mälaren's
   multipolygon brought a golf=water_hazard from another club 43 km east, which
   stretched the hull across half the province. Only golf ways near ORIGIN count. */
const NEARO = 3000;
const courseWays = [...ways.values()].filter(w => w.tags.golf)
  .filter(w => ptsOf(w).some(p => Math.abs(p[0]) < NEARO && Math.abs(p[1]) < NEARO));
const coursePts = courseWays.flatMap(ptsOf);
/* The hull that scenery is trimmed against must cover the WHOLE course, and on
   a partly-mapped course the golf ways alone do not: Ängsö has four holes in
   OSM out of eighteen. Union the mapped hull with a fixed box about ORIGIN so
   the unmapped half of the course still gets its surroundings. */
const HULL_MIN = 750;
const CBg = bbox(coursePts);
const CB = { x0: Math.min(CBg.x0, -HULL_MIN), x1: Math.max(CBg.x1, HULL_MIN),
             z0: Math.min(CBg.z0, -HULL_MIN), z1: Math.max(CBg.z1, HULL_MIN) };
console.log(`course bbox: x ${CB.x0.toFixed(0)}..${CB.x1.toFixed(0)}  z ${CB.z0.toFixed(0)}..${CB.z1.toFixed(0)}`);
const near = (pts, pad) =>
  pts.some(p => p[0] > CB.x0 - pad && p[0] < CB.x1 + pad && p[1] > CB.z0 - pad && p[1] < CB.z1 + pad);

/* --- collect ----------------------------------------------------------------- */
const out = {
  origin: { lat: undefined, lon: undefined },      // filled below from lib's frozen ORIGIN
  greens: [], fairways: [], tees: [], bunkers: [], roughs: [], holeWays: [], drivingRange: [],
  water: [], waterway: [], forest: [], wood: [], scrub: [], sand: [], rock: [], wetland: [], grass: [],
  paths: [], tracks: [], roads: [], buildings: [], farBuildings: [],
  parking: [], piers: [], power: { lines: [], towers: [], poles: [] }, railway: [],
  landuse: [], reserves: [],
  courseBoundary: null,
};

/* Tee pads run from 5 m² (a single forward-tee box) to 230 m² (a full championship
   deck), so the floor has to sit under the smallest real one or a third of the
   course's tees vanish. */
const AREA_MIN = { green: 60, fairway: 300, tee: 3, bunker: 6 };

for (const w of ways.values()) {
  const t = w.tags;
  const closed = isClosed(w);

  if (t.leisure === 'golf_course' && closed) {
    /* The club's own property line -- the thing white out-of-bounds stakes follow.
       An extract can hold more than one club's: Johannesberg's also contains Nifsta
       GK 2.4 km west, and keeping whichever parsed last handed the course its
       neighbour's boundary. THIS course is the polygon containing ORIGIN; if none
       does, the largest wins. */
    const ring = ringOf(w, 1.5);
    if (ring) {
      const a = Math.abs(polyArea(ring));
      const here = pointInPoly(0, 0, ring);
      const prev = out.courseBoundary;
      if (!prev || (here && !prev.hasOrigin) || (here === prev.hasOrigin && a > prev.area))
        out.courseBoundary = { id: 'w' + w.id, ring, name: t.name || null, area: Math.round(a), hasOrigin: here };
    }
    continue;
  }
  /* golf=clubhouse is a BUILDING wearing a golf tag, not a playing feature. Ängsö's
     three clubhouse ways carry building=yes + golf=clubhouse + name, and swallowing
     them here matched no `kind` and dropped them on the floor -- the course rendered
     with no clubhouse at all. nvgkbuild does the same thing: let it fall through to
     the building branch below, which keeps the footprint and the name and stamps
     amenity 'clubhouse' on it. */
  if (t.golf && !(t.golf === 'clubhouse' && t.building)) {
    const kind = t.golf;
    if (closed) {
      const ring = ringOf(w, kind === 'fairway' || kind === 'rough' ? 0.75 : 0.3);
      if (!ring) continue;
      const area = Math.abs(polyArea(ring));
      const rec = { id: 'w' + w.id, ring, area: Math.round(area), c: centroid(ring).map(r1) };
      if (kind === 'green' && area >= AREA_MIN.green) out.greens.push(rec);
      else if (kind === 'fairway' && area >= AREA_MIN.fairway) out.fairways.push(rec);
      else if (kind === 'tee' && area >= AREA_MIN.tee) out.tees.push(rec);
      else if (kind === 'bunker' && area >= AREA_MIN.bunker) out.bunkers.push(rec);
      else if (kind === 'rough') out.roughs.push(rec);
      else if (kind === 'driving_range') out.drivingRange.push(rec);
    } else if (kind === 'hole') {
      const line = lineOf(w, 1.5);
      if (line && line.length >= 2)
        out.holeWays.push({ id: 'w' + w.id, ref: t.ref || null, par: t.par ? +t.par : null,
                            name: t.name || null, line, len: Math.round(polyLen(line)) });
    }
    continue;
  }

  const pts = ptsOf(w);
  if (!pts.length) continue;

  if (t.natural === 'water' || t.water || t.landuse === 'reservoir') {
    if (!closed) continue;
    const ring = ringOf(w, 1.2);
    if (!ring) continue;
    out.water.push({ id: 'w' + w.id, ring, name: t.name || null,
                     kind: t.water || t.natural || 'water', area: Math.round(Math.abs(polyArea(ring))) });
  } else if (t.waterway && !closed) {
    if (!near(pts, 600)) continue;
    const line = lineOf(w, 1.2);
    if (line) out.waterway.push({ id: 'w' + w.id, line, kind: t.waterway, name: t.name || null });
  } else if (closed && (t.landuse === 'forest' || t.natural === 'wood')) {
    if (!near(pts, 900)) continue;
    const ring = ringOf(w, 2.0);
    if (ring) (t.natural === 'wood' ? out.wood : out.forest)
      .push({ id: 'w' + w.id, ring, area: Math.round(Math.abs(polyArea(ring))) });
  } else if (closed && t.natural === 'scrub') {
    if (!near(pts, 700)) continue;
    const ring = ringOf(w, 2.0); if (ring) out.scrub.push({ id: 'w' + w.id, ring });
  } else if (closed && (t.natural === 'sand' || t.natural === 'beach')) {
    const ring = ringOf(w, 0.8); if (ring) out.sand.push({ id: 'w' + w.id, ring, kind: t.natural });
  } else if (closed && (t.natural === 'bare_rock' || t.natural === 'rock' || t.natural === 'cliff')) {
    const ring = ringOf(w, 1.5); if (ring) out.rock.push({ id: 'w' + w.id, ring });
  } else if (closed && t.natural === 'wetland') {
    if (!near(pts, 700)) continue;
    const ring = ringOf(w, 2.0); if (ring) out.wetland.push({ id: 'w' + w.id, ring });
  } else if (closed && (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green')) {
    if (!near(pts, 500)) continue;
    const ring = ringOf(w, 1.5); if (ring) out.grass.push({ id: 'w' + w.id, ring });
  } else if (closed && t.building) {
    /* full footprints out to a kilometre; beyond that a distant building is its
       oriented box -- five numbers instead of a ring */
    if (near(pts, 1000)) {
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
    if (!near(pts, 800)) continue;
    const ring = ringOf(w, 0.8);
    if (ring) out.parking.push({ id: 'w' + w.id, ring, surface: t.surface || null,
                                 area: Math.round(Math.abs(polyArea(ring))) });
  } else if (t.man_made === 'pier') {
    if (!near(pts, 800)) continue;
    if (closed) { const ring = ringOf(w, 0.5); if (ring) out.piers.push({ id: 'w' + w.id, ring }); }
    else { const line = lineOf(w, 0.5); if (line) out.piers.push({ id: 'w' + w.id, line }); }
  } else if (t.power === 'line' || t.power === 'minor_line') {
    /* NOT simplified: every vertex of a power line is a tower position */
    if (!near(pts, 700)) continue;
    out.power.lines.push({ id: 'w' + w.id, line: pts.map(p => p.map(r1)),
                           voltage: t.voltage ? +t.voltage : null, minor: t.power === 'minor_line' });
  } else if (t.railway === 'rail') {
    if (t.tunnel) continue;                                  /* invisible by definition */
    const line = lineOf(w, 2);
    if (line) out.railway.push({ id: 'w' + w.id, line, bridge: !!t.bridge,
                                 usage: t.usage || null, name: t.name || null });
  } else if (closed && t.leisure === 'nature_reserve') {
    const ring = ringOf(w, 3);
    if (ring) out.reserves.push({ id: 'w' + w.id, ring, name: t.name || null });
  } else if (closed && /^(residential|farmland|farmyard|industrial|commercial|allotments)$/.test(t.landuse || '')) {
    if (!near(pts, 1200)) continue;
    const ring = ringOf(w, 3);
    if (ring) out.landuse.push({ id: 'w' + w.id, ring, kind: t.landuse });
  } else if (t.highway) {
    /* the trunk road and the named connectors anchor the whole vista, so they are
       kept to the extract's edge; lane-level streets still clip at 500 m */
    const pad = t.highway === 'trunk' ? 1e9
              : /^(secondary|tertiary)$/.test(t.highway) ? 1200 : 500;
    if (!near(pts, pad)) continue;
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

/* point features from tagged nodes: the pylons that carry the 130 kV corridors */
for (const [id, t] of nodeTags) {
  const p = nodes.get(id);
  if (!p) continue;
  if (t.power === 'tower') { if (near([p], 700)) out.power.towers.push(p.map(r1)); }
  else if (t.power === 'pole') { if (near([p], 700)) out.power.poles.push(p.map(r1)); }
}

/* multipolygon water relations, if any: outer rings only (islands handled later) */
for (const r of rels) {
  if (r.tags.natural !== 'water' && r.tags.water == null) continue;
  for (const m of r.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w || !isClosed(w)) continue;
    if (out.water.some(x => x.id === 'w' + w.id)) continue;
    if (!near(ptsOf(w), 2500)) continue;      /* Mälaren's far shores are not this scene */
    const ring = ringOf(w, 1.2);
    if (ring) out.water.push({ id: 'w' + w.id, ring, name: r.tags.name || null, kind: 'lake',
                               area: Math.round(Math.abs(polyArea(ring))), rel: r.id });
  }
}

/* forest multipolygons: the ridge south of the E4 is mapped as a relation whose
   outer way carries no tags of its own, so until this pass the whole backdrop
   south of the road parsed as bare ground */
for (const r of rels) {
  if (r.tags.landuse !== 'forest' && r.tags.leisure !== 'park') continue;
  for (const m of r.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w || !isClosed(w)) continue;
    const pts = ptsOf(w);
    if (!pts.length || !near(pts, 900)) continue;
    if (out.forest.some(x => x.id === 'w' + w.id)) continue;
    const ring = ringOf(w, 2.0);
    if (ring) out.forest.push({ id: 'w' + w.id, ring, area: Math.round(Math.abs(polyArea(ring))), rel: r.id });
  }
}

out.water.sort((a, b) => b.area - a.area);
const { ORIGIN } = await import('./lib.mjs');
out.origin = { lat: ORIGIN.lat, lon: ORIGIN.lon };

const dest = path.join(ROOT, 'angsobuild', 'osm-features.json');
writeJSON(dest, out);

const n = k => (out[k] || []).length;
console.log(`golf     greens ${n('greens')}  fairways ${n('fairways')}  tees ${n('tees')}  bunkers ${n('bunkers')}  holeWays ${n('holeWays')}  range ${n('drivingRange')}`);
console.log(`nature   water ${n('water')}  waterway ${n('waterway')}  forest ${n('forest')}  wood ${n('wood')}  scrub ${n('scrub')}  sand ${n('sand')}  rock ${n('rock')}  wetland ${n('wetland')}  grass ${n('grass')}`);
console.log(`infra    paths ${n('paths')}  tracks ${n('tracks')}  roads ${n('roads')}  buildings ${n('buildings')}  far ${n('farBuildings')}`);
console.log(`around   parking ${n('parking')}  piers ${n('piers')}  power ${out.power.lines.length}/${out.power.towers.length}t/${out.power.poles.length}p  rail ${n('railway')}  landuse ${n('landuse')}  reserves ${n('reserves')}`);
if (out.water[0]) {
  const w = out.water[0];
  console.log(`largest water: ${w.name || w.id} area ${(w.area / 1e6).toFixed(2)} km², ${w.ring.length} pts`);
}
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
