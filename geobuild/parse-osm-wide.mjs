#!/usr/bin/env node
/* Turn the wide Örnsköldsvik-basin extract (fetch-osm-wide.mjs) into the
   SURROUNDINGS RECORD, geobuild/surroundings.json -- the town, the harbour, the
   ski jumps, the trotting track, the roads and railway beyond the core extract,
   the towers and chimneys on the skyline. It travels BESIDE the pack like the
   land-cover record (emit-manifest copies it under courses/<slug>/, the loader
   fetches it by content), so the course model, the pack, the EPSG:3006
   migration and the five checksum registries never move for a change to the
   scenery three kilometres away.

   Two rules decide what goes in:

   1. A KIND THE PACK ALREADY CARRIES (buildings, roads, tracks, railway, power,
      landuse, water, parking, piers) is taken only OUTSIDE the core extract's
      box -- rings by centroid, lines clipped to the outside runs with the
      crossing point kept so a ribbon meets the pack's at the edge. Inside it
      the pack is the authority; drawing both would double every road. The
      committed osm-features.json is read for its ids so a way the core parse
      dropped by its own rules is not resurrected here either.
   2. A KIND THE PACK HAS NO NOTION OF (ski jumps, lifts, pitches and tracks,
      masts, chimneys, peaks) is taken wherever it stands, the two the scenery
      module already draws from their surveyed nodes excepted.

   Everything is in local metres about ORIGIN, clipped -- never merely filtered
   -- to the +-6.4 km keep box (the land-cover record's own window), simplified
   to a metre and rounded to a decimetre.

   The sea is not a polygon in OSM: it is the RIGHT-hand side of every
   natural=coastline way. The chains are clipped to the keep box and closed
   along its perimeter clockwise (north-up), which keeps the water on the
   right, and each resulting ring is checked to contain open water and no land
   the frame knows. Its level is measured on the vista heightfield -- Terrarium
   carries this basin about 21 m above RH 2000 (the lake's 21.59 against a
   laser 0.280), so the sea reads ~21 m in the frame's datum, never 0.       */
import fs from 'node:fs';
import path from 'node:path';
import {
  CACHE, ROOT, ORIGIN, lonLatToXZ, simplifyDP, polyArea, centroid, bbox, ring1, r1,
  readJSON, writeJSON, polyLen, pointInPoly, decodeHF,
} from './lib.mjs';
/* the fetch window (fetch-osm-wide.mjs WIDE), restated so importing it does not run the fetch */
const WIDE = { lon0: 18.545, lon1: 18.805, lat0: 63.227, lat1: 63.342 };

const DIR = path.join(CACHE, 'wide');
const KEEP = 6400;
const BOX = { x0: -KEEP, x1: KEEP, z0: -KEEP, z1: KEEP };
/* the core extract's bbox (fetch-osm.mjs CORE_BBOX) in local metres */
const CORE_BBOX = [18.640, 63.270, 18.710, 63.300];
const [ix0, iz1] = lonLatToXZ(CORE_BBOX[0], CORE_BBOX[1]);
const [ix1, iz0] = lonLatToXZ(CORE_BBOX[2], CORE_BBOX[3]);
const INNER = { x0: r1(ix0), x1: r1(ix1), z0: r1(iz0), z1: r1(iz1) };

const decodeMap = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => decodeMap[m]);

/* --- read the tiles ---------------------------------------------------------- */
const nodes = new Map(), nodeTags = new Map(), ways = new Map(), rels = [];
const seenRel = new Set();
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.xml')).sort()) {
  const xml = fs.readFileSync(path.join(DIR, f), 'utf8');
  /* the alternation (\/>|>...<\/node>) is the correct form: a lazy body match
     over a self-closing node swallows the NEXT tagged node's tags */
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g)) {
    if (nodes.has(m[1])) continue;
    nodes.set(m[1], lonLatToXZ(+m[3], +m[2]));
    if (m[5]) {
      const t = {};
      for (const x of m[5].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) t[x[1]] = decode(x[2]);
      if (Object.keys(t).length) nodeTags.set(m[1], t);
    }
  }
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*?(\/>|>[\s\S]*?<\/way>)/g)) {
    if (ways.has(m[1])) continue;
    const refs = [...m[0].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]);
    const tags = {};
    for (const t of m[0].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = decode(t[2]);
    ways.set(m[1], { id: m[1], refs, tags });
  }
  for (const m of xml.matchAll(/<relation id="(\d+)"[^>]*?(\/>|>[\s\S]*?<\/relation>)/g)) {
    if (seenRel.has(m[1])) continue;
    seenRel.add(m[1]);
    const tags = {};
    for (const t of m[0].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = decode(t[2]);
    const members = [...m[0].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"/g)].map(x => ({ type: x[1], ref: x[2], role: x[3] }));
    rels.push({ id: m[1], tags, members });
  }
}
console.log(`parsed ${nodes.size} nodes, ${ways.size} ways, ${rels.length} relations from ${DIR}`);

/* --- what the pack already has ------------------------------------------------- */
const core = readJSON(path.join(ROOT, 'geobuild', 'osm-features.json'));
const packIds = new Set();
for (const k of ['buildings', 'paths', 'tracks', 'roads', 'railway', 'landuse', 'water', 'parking', 'piers', 'forest', 'wood', 'reserves'])
  for (const f of core[k] || []) if (f.id) packIds.add(f.id);
for (const l of core.power?.lines || []) packIds.add(l.id);

/* --- geometry ------------------------------------------------------------------ */
const ptsOf = w => w.refs.map(r => nodes.get(r)).filter(Boolean);
const isClosed = w => w.refs.length > 3 && w.refs[0] === w.refs[w.refs.length - 1];
const inBox = (p, B) => p[0] >= B.x0 && p[0] <= B.x1 && p[1] >= B.z0 && p[1] <= B.z1;

/* Sutherland-Hodgman against an axis box */
function clipRing(ring, B) {
  let out = ring;
  for (const [axis, lim, keepLess] of [[0, B.x0, false], [0, B.x1, true], [1, B.z0, false], [1, B.z1, true]]) {
    const inp = out; out = [];
    if (!inp.length) break;
    const inside = p => keepLess ? p[axis] <= lim : p[axis] >= lim;
    const cross = (a, b) => { const t = (lim - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
  }
  return out.length >= 3 ? out : null;
}
/* the runs of a polyline that lie inside (or, with outside=true, outside) a box,
   each with the boundary crossing point at its end */
function clipLine(line, B, outside = false) {
  const inside = p => inBox(p, B) !== outside;
  const runs = [];
  let run = [];
  const crossPt = (a, b) => {
    /* walk a->b in small steps to the boundary; exact enough at a decimetre */
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; const p = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m]; if (inside(p) === inside(a)) lo = m; else hi = m; }
    return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (inside(p)) {
      if (!run.length && i > 0 && !inside(line[i - 1])) run.push(crossPt(line[i - 1], p));
      run.push(p);
    } else if (run.length) {
      run.push(crossPt(line[i - 1], p));
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}
const outsideInner = line => clipLine(line, INNER, true);
const simp = (pts, tol) => ring1(simplifyDP(pts, tol));

function obbOf(ring) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
    const ang = Math.atan2(bz - az, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of hull) { const u = x * c + z * s, v = -x * s + z * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) { const um = (u0 + u1) / 2, vm = (v0 + v1) / 2; best = { area, cx: um * c - vm * s, cz: um * s + vm * c, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, ang }; }
  }
  return best;
}

/* --- collect ------------------------------------------------------------------- */
const out = {
  version: 1,
  source: `OpenStreetMap map API, ${new Date().toISOString().slice(0, 10)}, tiles over ${WIDE.lon0}-${WIDE.lon1} E ${WIDE.lat0}-${WIDE.lat1} N (geobuild/fetch-osm-wide.mjs)`,
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  box: BOX, inner: INNER,
  /* [cx, cz, hw, hd, angle, kind, height]: kind 0 house · 1 industrial · 2 block (apartments, commercial, public); height 0 = unknown */
  buildings: [],
  landmarks: [], roads: [], railway: [], water: [], landuse: [], piers: [],
  pistes: [], lifts: [], sports: [], towers: [], peaks: [],
  power: { lines: [], towers: [] },
};

/* the three point landmarks apps/golf/src/engine/scenery/veckefjarden.js draws
   from these same nodes; listing them twice would stand two masts on one spot */
const DRAWN_BY_SCENERY = new Set(['845145336', '9502846496', '10943559733']);

const BLOCK = /^(apartments|commercial|retail|office|public|school|college|university|hospital|church|civic|hotel|kindergarten|stadium|sports_centre|sports_hall|train_station|government)$/;
const INDUSTRIAL = /^(industrial|warehouse|manufacture|service|hangar|storage_tank|silo)$/;
const heightOf = t => t.height ? parseFloat(t.height) : t['building:levels'] ? 3.1 * parseFloat(t['building:levels']) : 0;

for (const w of ways.values()) {
  const t = w.tags;
  const pts = ptsOf(w);
  if (pts.length < 2) continue;
  const closed = isClosed(w);
  const id = 'w' + w.id;
  const cen = closed ? centroid(pts.slice(0, -1)) : null;
  const packHas = packIds.has(id);

  /* -- kinds the pack has no notion of: taken wherever they stand ------------- */
  if (t['piste:type'] || t.sport === 'ski_jumping') {
    if (!closed) continue;
    const ring = clipRing(simp(pts.slice(0, -1), 0.5), BOX);
    if (ring) out.pistes.push({ id, ring: ring1(ring), kind: t['piste:type'] || 'ski_jump', name: t.name || null, lit: t.lit === 'yes' });
    continue;
  }
  if (t.aerialway && /lift|gondola|cable_car|platter|t-bar|j-bar|rope_tow|magic_carpet/.test(t.aerialway)) {
    const pylons = w.refs.filter(r => nodeTags.get(r)?.aerialway === 'pylon').map(r => nodes.get(r)).filter(Boolean).map(p => p.map(r1));
    out.lifts.push({ id, line: ring1(pts), kind: t.aerialway, name: t.name || null, pylons });
    continue;
  }
  if (closed && (t.leisure === 'pitch' || t.leisure === 'track' || (t.leisure === 'stadium' && !t.building) || t.leisure === 'ice_rink' && !t.building)) {
    const ring = clipRing(simp(pts.slice(0, -1), 0.8), BOX);
    if (!ring) continue;
    const area = Math.abs(polyArea(ring));
    if (area < 400) continue;
    out.sports.push({ id, ring: ring1(ring), kind: t.leisure, sport: t.sport || null, name: t.name || null,
                      surface: t.surface || null, area: Math.round(area) });
    continue;
  }

  /* -- kinds the pack carries: outside the core extract only ------------------- */
  if (closed && t.building && t.building !== 'no') {
    if (packHas || !cen || inBox(cen, INNER) || !inBox(cen, BOX)) continue;
    const ring = simp(pts.slice(0, -1), 0.5);
    const area = Math.abs(polyArea(ring));
    if (area < 30) continue;
    const h = heightOf(t);
    const kind = INDUSTRIAL.test(t.building) || t.man_made === 'works' ? 1 : BLOCK.test(t.building) || h >= 9 || area >= 900 ? 2 : 0;
    /* an untagged height is a guess by what the building is: a church is tall
       and a supermarket is not, whatever its footprint */
    const guess = t.building === 'church' ? 14 : t.building === 'hospital' ? 16 : t.building === 'apartments' ? 12.4
      : /^(commercial|retail|warehouse|industrial)$/.test(t.building) ? 7 : kind === 2 ? 9 : kind === 1 ? 8 : 5;
    /* a named public building or a big one keeps its footprint; it is what a
       town is recognised by (the arena, the churches, the hospital) */
    if (area >= 2500 || (t.name && /arena|hall|kyrka|church|sjukhus|hospital|museum|station|hotel|hotell|torg|skola|gymnasium/i.test(t.name) && area >= 400)) {
      out.landmarks.push({ id, ring: ring1(ring), h: h || guess, hTagged: !!h, kind: t.building, name: t.name || null,
                           roof: t['roof:shape'] || null, sport: t.sport || null, area: Math.round(area) });
    } else {
      const b = obbOf(ring);
      /* half-metre precision: a box read through two kilometres of haze */
      const r5 = v => Math.round(v * 2) / 2;
      if (b) out.buildings.push([r5(b.cx), r5(b.cz), r5(b.hw), r5(b.hd), +b.ang.toFixed(2), kind, Math.round(h * 2) / 2]);
    }
    continue;
  }
  if (t.highway && /^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian)$/.test(t.highway)) {
    const runs = packHas ? outsideInner(pts) : (cen && inBox(cen, INNER) ? [] : [pts]);
    for (const run of runs) for (const seg of clipLine(run, BOX)) {
      const line = simp(seg, /^(trunk|primary|secondary|tertiary)/.test(t.highway) ? 1.0 : 2.0);
      if (line.length < 2 || polyLen(line) < 8) continue;
      out.roads.push({ id, line, kind: t.highway.replace(/_link$/, ''), link: /_link$/.test(t.highway), name: t.name || null,
                       oneway: t.oneway === 'yes', lanes: t.lanes ? +t.lanes : null, surface: t.surface || null,
                       bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no' });
    }
    continue;
  }
  if (t.railway === 'rail') {
    if (t.tunnel && t.tunnel !== 'no') continue;
    const inner = !packHas && pts.every(p => inBox(p, INNER));
    if (inner) continue;
    const runs = packHas ? outsideInner(pts) : [pts];
    for (const run of runs) for (const seg of clipLine(run, BOX)) {
      const line = simp(seg, 2);
      if (line.length >= 2) out.railway.push({ id, line, bridge: !!t.bridge && t.bridge !== 'no', name: t.name || null, usage: t.usage || null });
    }
    continue;
  }
  if (closed && (t.natural === 'water' || t.water || t.landuse === 'reservoir')) {
    if (packHas || !cen || inBox(cen, INNER)) continue;
    const ring = clipRing(simp(pts.slice(0, -1), 1.5), BOX);
    if (!ring || Math.abs(polyArea(ring)) < 4000) continue;
    out.water.push({ id, ring: ring1(ring), kind: t.water || 'water', name: t.name || null, area: Math.round(Math.abs(polyArea(ring))) });
    continue;
  }
  if (closed && /^(residential|farmland|farmyard|industrial|commercial|retail|allotments|meadow|grass|cemetery|railway)$/.test(t.landuse || '') || closed && t.leisure === 'park') {
    /* a ring the pack carries -- clipped at its extract's edge or not -- is the pack's */
    if (packHas || !cen || inBox(cen, INNER)) continue;
    const ring = clipRing(simp(pts.slice(0, -1), 3), BOX);
    if (!ring || Math.abs(polyArea(ring)) < 1500) continue;
    out.landuse.push({ id, ring: ring1(ring), kind: t.leisure === 'park' ? 'park' : t.landuse });
    continue;
  }
  if (t.man_made === 'pier' || t.man_made === 'quay' || t.man_made === 'breakwater') {
    if (packHas) continue;
    if (closed) {
      if (!cen || inBox(cen, INNER)) continue;
      const ring = clipRing(simp(pts.slice(0, -1), 0.5), BOX);
      if (ring) out.piers.push({ id, ring: ring1(ring), kind: t.man_made });
    } else {
      for (const seg of clipLine(pts, BOX)) { if (seg.every(p => inBox(p, INNER))) continue; const line = simp(seg, 0.5); if (line.length >= 2) out.piers.push({ id, line, kind: t.man_made }); }
    }
    continue;
  }
  if (t.power === 'line' && t.voltage && +t.voltage >= 100000) {
    const runs = packHas ? outsideInner(pts) : [pts];
    for (const run of runs) for (const seg of clipLine(run, BOX))
      out.power.lines.push({ id, line: seg.map(p => p.map(r1)), voltage: +t.voltage });
  }
}

/* --- what OSM lacks and the orthophoto shows: the traced pistes ------------------ */
{
  const traces = readJSON(path.join(ROOT, 'geobuild', 'wide-traces.json'));
  for (const p of traces.pistes || []) {
    if (!Array.isArray(p.ring) || p.ring.length < 3) throw new Error(`wide-traces: ${p.id} has no ring`);
    if (out.pistes.some(q => q.id === p.id)) throw new Error(`wide-traces: ${p.id} twice`);
    out.pistes.push({ id: p.id, ring: ring1(p.ring), kind: p.kind, name: p.name || null, prov: 'trace', basis: p.basis || null });
  }
}

/* --- point features -------------------------------------------------------------- */
for (const [id, t] of nodeTags) {
  const p = nodes.get(id);
  if (!p || !inBox(p, BOX)) continue;
  if (DRAWN_BY_SCENERY.has(id)) continue;
  const h = t.height ? parseFloat(t.height) : null;
  if (t.man_made === 'mast' || t.man_made === 'chimney' || t.man_made === 'water_tower' ||
      (t.man_made === 'tower' && /communication|observation|cooling/.test(t['tower:type'] || 'communication') && t.leisure !== 'bird_hide')) {
    out.towers.push({ id: 'n' + id, c: p.map(r1), kind: t.man_made, type: t['tower:type'] || null, h, name: t.name || null });
  } else if (t.natural === 'peak') {
    out.peaks.push({ id: 'n' + id, c: p.map(r1), name: t.name || null, ele: t.ele ? +t.ele : null });
  } else if (t.power === 'tower') {
    if (!inBox(p, INNER)) out.power.towers.push(p.map(r1));
  }
}

/* --- the sea: coastline chains closed along the keep box ------------------------- */
{
  const chains = [...ways.values()].filter(w => w.tags.natural === 'coastline' && !isClosed(w));
  const islands = [...ways.values()].filter(w => w.tags.natural === 'coastline' && isClosed(w));
  /* join end to end (OSM coastline is one directed chain around every water body) */
  const byStart = new Map();
  for (const w of chains) byStart.set(w.refs[0], w);
  /* start from the HEADS -- a way no other way ends at -- or the join depends on
     the order the tiles listed the ways in, and a chain is cut at every way
     already visited (the first version did exactly that) */
  const ends = new Set(chains.map(w => w.refs[w.refs.length - 1]));
  const ordered = [...chains.filter(w => !ends.has(w.refs[0])), ...chains.filter(w => ends.has(w.refs[0]))];
  const used = new Set(), merged = [];
  for (const w of ordered) {
    if (used.has(w.id)) continue;
    let cur = w, refs = [...w.refs]; used.add(w.id);
    for (;;) { const nx = byStart.get(refs[refs.length - 1]); if (!nx || used.has(nx.id)) break; used.add(nx.id); refs = refs.concat(nx.refs.slice(1)); cur = nx; }
    merged.push(refs.map(r => nodes.get(r)).filter(Boolean));
  }
  /* work north-up: (x, y) with y = -z, so "clockwise" means what it does on a map */
  const up = P => P.map(([x, z]) => [x, -z]);
  const B = KEEP;
  const runs = merged.flatMap(P => clipLine(up(P), { x0: -B, x1: B, z0: -B, z1: B }));
  /* perimeter parameter, clockwise from the north-west corner */
  const perim = ([x, y]) => {
    const e = 0.5;                                               /* the clip bisects to ~1e-4 m */
    if (Math.abs(y - B) < e) return x + B;                       /* north edge, west -> east */
    if (Math.abs(x - B) < e) return 2 * B + (B - y);             /* east edge, north -> south */
    if (Math.abs(y + B) < e) return 4 * B + (B - x);             /* south edge, east -> west */
    if (Math.abs(x + B) < e) return 6 * B + (y + B);             /* west edge, south -> north */
    return null;
  };
  const onEdge = runs.filter(r => perim(r[0]) !== null && perim(r[r.length - 1]) !== null);
  const skipped = runs.length - onEdge.length;
  const cornerAt = s => { const k = ((s % (8 * B)) + 8 * B) % (8 * B); if (k < 2 * B) return [k - B, B]; if (k < 4 * B) return [B, B - (k - 2 * B)]; if (k < 6 * B) return [B - (k - 4 * B), -B]; return [-B, -B + (k - 6 * B)]; };
  const starts = onEdge.map((r, i) => ({ i, s: perim(r[0]) })).sort((a, b) => a.s - b.s);
  const done = new Set(), rings = [];
  for (const st of starts) {
    if (done.has(st.i)) continue;
    const ring = [];
    let i = st.i;
    for (let guard = 0; guard < 64; guard++) {
      done.add(i);
      ring.push(...onEdge[i]);
      const sEnd = perim(onEdge[i][onEdge[i].length - 1]);
      /* walk the perimeter clockwise to the next run start */
      let next = null, best = Infinity;
      for (const c of starts) { let d = c.s - sEnd; if (d <= 1e-6) d += 8 * B; if (d < best) { best = d; next = c; } }
      /* corners passed on the way */
      for (let corner = 2 * B; corner < 8 * B + 2 * B; corner += 2 * B) { const d = ((corner - sEnd) % (8 * B) + 8 * B) % (8 * B); if (d > 1e-6 && d < best) ring.push(cornerAt(corner)); }
      if (next.i === st.i) break;
      i = next.i;
    }
    rings.push(ring.map(([x, y]) => [x, -y]));
  }
  console.log(`coastline: ${chains.length} ways -> ${merged.length} chains, ${onEdge.length} runs through the keep box (${skipped} not touching it), ${islands.length} islands, ${rings.length} sea rings`);
  /* level from the vista heightfield: the median of samples the ring encloses */
  const HF = readJSON(path.join(ROOT, 'geobuild', 'heightfields.json'));
  const H1 = decodeHF(HF.hf1), S = HF.hf1;
  for (const ring of rings) {
    const area = Math.abs(polyArea(ring));
    const bb = bbox(ring);
    const hs = [];
    for (let j = 0; j < S.nz; j++) for (let i = 0; i < S.nx; i++) {
      const x = S.x0 + i * S.dx, z = S.z0 + j * S.dx;
      if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
      if (pointInPoly(x, z, ring)) hs.push(H1[j * S.nx + i]);
    }
    hs.sort((a, b) => a - b);
    const level = hs.length ? hs[hs.length >> 1] : null;
    const p10 = hs.length ? hs[Math.floor(hs.length * 0.1)] : null, p90 = hs.length ? hs[Math.floor(hs.length * 0.9)] : null;
    console.log(`  sea ring ${ring.length} pts, ${(area / 1e6).toFixed(2)} km², hf1 samples ${hs.length}: median ${level?.toFixed(2)} (p10 ${p10?.toFixed(2)} p90 ${p90?.toFixed(2)})`);
    const simpRing = ring1(simplifyDP([...ring, ring[0]], 2).slice(0, -1));
    out.water.push({ id: 'coast', ring: simpRing, kind: 'sea', name: 'Örnsköldsviksfjärden', area: Math.round(area),
                     level: level === null ? null : Math.round(level * 100) / 100, levelSamples: hs.length, levelP10: p10, levelP90: p90,
                     islands: islands.filter(w => { const c = centroid(ptsOf(w)); return pointInPoly(c[0], c[1], ring); }).map(w => ({ id: 'w' + w.id, ring: ring1(simplifyDP(ptsOf(w), 2).slice(0, -1)), name: w.tags.name || null })) });
  }
  /* the two checks that never entered the construction: known water is inside, known land is not */
  const sea = out.water.filter(w => w.kind === 'sea');
  const wet = [[3000, 1400], [2500, 1300], [4000, 2200]];      /* Örnsköldsviksfjärden: the harbour basin, the inner bay, Bäckfjärden */
  const dry = [[0, 0], [2600, -600], [-1875, -305], [1300, -540]]; /* the course, the town centre, the trotting track, the ski jumps */
  for (const p of wet) if (!sea.some(w => pointInPoly(p[0], p[1], w.ring))) throw new Error(`sea polygon does not contain open water at ${p}`);
  for (const p of dry) if (sea.some(w => pointInPoly(p[0], p[1], w.ring))) throw new Error(`sea polygon contains land at ${p}`);
}

/* lake levels for the OSM lakes outside the core box, from the same heightfield */
{
  const HF = readJSON(path.join(ROOT, 'geobuild', 'heightfields.json'));
  const H1 = decodeHF(HF.hf1), S = HF.hf1;
  for (const w of out.water) {
    if (w.kind === 'sea') continue;
    const bb = bbox(w.ring), hs = [];
    for (let j = 0; j < S.nz; j++) for (let i = 0; i < S.nx; i++) {
      const x = S.x0 + i * S.dx, z = S.z0 + j * S.dx;
      if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
      if (pointInPoly(x, z, w.ring)) hs.push(H1[j * S.nx + i]);
    }
    /* the ring's own edge samples where the interior is under a cell */
    if (hs.length < 3) for (const p of w.ring) { const i = Math.round((p[0] - S.x0) / S.dx), j = Math.round((p[1] - S.z0) / S.dx); if (i >= 0 && j >= 0 && i < S.nx && j < S.nz) hs.push(H1[j * S.nx + i]); }
    hs.sort((a, b) => a - b);
    w.level = hs.length ? Math.round(hs[Math.floor(hs.length * 0.3)] * 100) / 100 : null;
    w.levelSamples = hs.length;
  }
}

out.water.sort((a, b) => b.area - a.area);
out.stats = Object.fromEntries(Object.entries(out).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
out.stats.powerLines = out.power.lines.length; out.stats.powerTowers = out.power.towers.length;
out.stats.roadKm = Math.round(out.roads.reduce((s, r) => s + polyLen(r.line), 0) / 100) / 10;
out.stats.railKm = Math.round(out.railway.reduce((s, r) => s + polyLen(r.line), 0) / 100) / 10;
const dest = path.join(ROOT, 'geobuild', 'surroundings.json');
writeJSON(dest, out);
console.log(`inner box (the core extract): x ${INNER.x0}..${INNER.x1} z ${INNER.z0}..${INNER.z1}`);
console.log(JSON.stringify(out.stats));
console.log(`pistes: ${out.pistes.map(p => `${p.kind}${p.name ? ' ' + p.name : ''} ${Math.round(Math.abs(polyArea(p.ring)))} m²`).join(' · ')}`);
console.log(`lifts: ${out.lifts.map(l => `${l.kind} ${Math.round(polyLen(l.line))} m, ${l.pylons.length} pylons`).join(' · ')}`);
console.log(`sports: ${out.sports.filter(s => s.kind === 'track' || s.kind === 'stadium').map(s => `${s.kind}/${s.sport} ${s.name || s.id} ${s.area} m²`).join(' · ')}`);
console.log(`landmarks: ${out.landmarks.map(l => `${l.name || l.id} ${l.area} m² h${l.h}`).join(' · ')}`);
console.log(`towers: ${out.towers.map(t => `${t.kind}${t.name ? ' ' + t.name : ''}${t.h ? ' ' + t.h + 'm' : ''}`).join(' · ')}`);
console.log(`peaks: ${out.peaks.map(p => p.name).join(' · ')}`);
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
