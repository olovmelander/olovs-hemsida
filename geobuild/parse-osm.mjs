/* Turn the cached OSM extract into course-frame vectors.

   OSM XML is flat and regular enough that a small state machine beats a dependency.
   Everything comes out in local metres about ORIGIN, simplified to 0.75 m and
   rounded to a decimetre, which is finer than the survey behind any of it.        */
import fs from 'node:fs';
import path from 'node:path';
import {
  CACHE, ROOT, lonLatToXZ, simplifyDP, polyArea, centroid, bbox,
  ring1, r1, writeJSON, polyLen,
} from './lib.mjs';

const files = [path.join(CACHE, 'osm-core.xml')];
for (const f of fs.readdirSync(CACHE)) if (/^osm-rel-/.test(f)) files.push(path.join(CACHE, f));
const wayDir = path.join(CACHE, 'ways');
if (fs.existsSync(wayDir)) for (const f of fs.readdirSync(wayDir)) files.push(path.join(wayDir, f));

const decodeMap = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => decodeMap[m]);

const nodes = new Map();          // id -> [x, z]
const ways = new Map();           // id -> {id, refs, tags}
const rels = [];                  // {id, tags, members}

for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g))
    if (!nodes.has(m[1])) nodes.set(m[1], lonLatToXZ(+m[3], +m[2]));
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

/* the course hull, so scenery can be trimmed to what a camera on the course sees */
const courseWays = [...ways.values()].filter(w => w.tags.golf);
const coursePts = courseWays.flatMap(ptsOf);
const CB = bbox(coursePts);
console.log(`course bbox: x ${CB.x0.toFixed(0)}..${CB.x1.toFixed(0)}  z ${CB.z0.toFixed(0)}..${CB.z1.toFixed(0)}`);
const near = (pts, pad) =>
  pts.some(p => p[0] > CB.x0 - pad && p[0] < CB.x1 + pad && p[1] > CB.z0 - pad && p[1] < CB.z1 + pad);

/* --- collect ----------------------------------------------------------------- */
const out = {
  origin: { lat: undefined, lon: undefined },      // filled below from lib's frozen ORIGIN
  greens: [], fairways: [], tees: [], bunkers: [], roughs: [], holeWays: [], drivingRange: [],
  water: [], waterway: [], forest: [], wood: [], scrub: [], sand: [], rock: [], wetland: [], grass: [],
  paths: [], tracks: [], roads: [], buildings: [],
};

/* Tee pads run from 5 m² (a single forward-tee box) to 230 m² (a full championship
   deck), so the floor has to sit under the smallest real one or a third of the
   course's tees vanish. */
const AREA_MIN = { green: 60, fairway: 300, tee: 3, bunker: 6 };

for (const w of ways.values()) {
  const t = w.tags;
  const closed = isClosed(w);

  if (t.golf) {
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
    if (!near(pts, 500)) continue;
    const ring = ringOf(w, 0.5);
    if (ring) out.buildings.push({ id: 'w' + w.id, ring,
      h: t.height ? parseFloat(t.height) : (t['building:levels'] ? 3.1 * parseFloat(t['building:levels']) : null),
      kind: t.building, name: t.name || null });
  } else if (t.highway) {
    if (!near(pts, 500)) continue;
    const line = lineOf(w, 1.2);
    if (!line) continue;
    const rec = { id: 'w' + w.id, line, kind: t.highway };
    if (/^(path|footway|cycleway|bridleway|steps)$/.test(t.highway)) out.paths.push(rec);
    else if (/^(track|service)$/.test(t.highway)) out.tracks.push(rec);
    else out.roads.push(rec);
  }
}

/* multipolygon water relations, if any: outer rings only (islands handled later) */
for (const r of rels) {
  if (r.tags.natural !== 'water' && r.tags.water == null) continue;
  for (const m of r.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w || !isClosed(w)) continue;
    if (out.water.some(x => x.id === 'w' + w.id)) continue;
    const ring = ringOf(w, 1.2);
    if (ring) out.water.push({ id: 'w' + w.id, ring, name: r.tags.name || null, kind: 'lake',
                               area: Math.round(Math.abs(polyArea(ring))), rel: r.id });
  }
}

out.water.sort((a, b) => b.area - a.area);
const { ORIGIN } = await import('./lib.mjs');
out.origin = { lat: ORIGIN.lat, lon: ORIGIN.lon };

const dest = path.join(ROOT, 'geobuild', 'osm-features.json');
writeJSON(dest, out);

const n = k => (out[k] || []).length;
console.log(`golf     greens ${n('greens')}  fairways ${n('fairways')}  tees ${n('tees')}  bunkers ${n('bunkers')}  holeWays ${n('holeWays')}  range ${n('drivingRange')}`);
console.log(`nature   water ${n('water')}  waterway ${n('waterway')}  forest ${n('forest')}  wood ${n('wood')}  scrub ${n('scrub')}  sand ${n('sand')}  rock ${n('rock')}  wetland ${n('wetland')}  grass ${n('grass')}`);
console.log(`infra    paths ${n('paths')}  tracks ${n('tracks')}  roads ${n('roads')}  buildings ${n('buildings')}`);
if (out.water[0]) {
  const w = out.water[0];
  console.log(`largest water: ${w.name || w.id} area ${(w.area / 1e6).toFixed(2)} km², ${w.ring.length} pts`);
}
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
