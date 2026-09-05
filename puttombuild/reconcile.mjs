/* Fuse Puttom's four records into one course model.

   Unlike Norrfällsviken, this course is fully mapped in OpenStreetMap, so the
   fusion is Veckefjärden's kind: OSM polygons are the shapes, the GPS survey is
   the anchor that assigns each polygon to its hole (no OSM golf feature here
   carries a hole ref), and the card is the length every drawn line is slid to.

   - card.json          the club's card — every displayed number, verbatim
   - geo_data GPS        green centres + back tees, the per-hole anchor
   - osm-features.json   greens, fairways, tees, bunkers, hole lines, the two
                         lakes, wetlands, forest, farmland, the E4, the railway
   - sat-traces.json     the few anchors OSM simply has not got — read off the
                         orthorectified z18 imagery, which needs no registration */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN, M_PER_LAT, M_PER_LON, lonLatToXZ,
  polyLen, polyArea, centroid, pointInPoly, distToLine, bbox,
  readJSON, writeJSON, r1, ring1, decodeHF, bearing, hyp,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const card = readJSON(path.join(HERE, 'card.json'));
const notes = (() => { try { return readJSON(path.join(HERE, 'guide-notes.json')); } catch { return { holes: {} }; } })();
const osm = readJSON(path.join(HERE, 'osm-features.json'));
const traces = (() => { try { return readJSON(path.join(HERE, 'sat-traces.json')); } catch { return { buildings: [] }; } })();
const hf = readJSON(path.join(HERE, 'heightfields.json'));
const gpsRaw = readJSON(path.join(HERE, '..', 'geo_data', 'puttom_clean.json'));
/* What the 1 m laser ground says (laser-features.mjs): the lakes' names and
   levels, the ditches, the true tee/green heights, and which tee marks stand
   in the water. Optional so the model still builds before a ground is
   published; everything it supplies carries prov:"laser". */
const laserF = (() => { try { return readJSON(path.join(HERE, 'laser-features.json')); } catch { return null; } })();

/* --- terrain sampler ---------------------------------------------------------- */
const H0 = hf.hf0, grid0 = decodeHF(H0);
function terr(x, z) {
  const gx = (x - H0.x0) / H0.dx, gz = (z - H0.z0) / H0.dx;
  const i = Math.max(0, Math.min(H0.nx - 2, Math.floor(gx)));
  const j = Math.max(0, Math.min(H0.nz - 2, Math.floor(gz)));
  const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
  const a = grid0[j * H0.nx + i], b = grid0[j * H0.nx + i + 1];
  const c = grid0[(j + 1) * H0.nx + i], d = grid0[(j + 1) * H0.nx + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/* --- GPS points --------------------------------------------------------------- */
const G = {};
for (const f of gpsRaw.features) {
  const p = f.properties;
  (G[+p.hole] ||= {})[p.name] = lonLatToXZ(...f.geometry.coordinates);
}

/* --- OSM golf pools ----------------------------------------------------------- */
const greens = osm.greens.map(g => ({ ...g, c: centroid(g.ring), used: false }));
const fairways = osm.fairways.map(f => ({ ...f, c: centroid(f.ring) }));
const tees = osm.tees.map(t => ({ ...t, c: centroid(t.ring) }));
const bunkers = osm.bunkers.map(b => ({ ...b, c: centroid(b.ring) }));
const holeWays = osm.holeWays.map(h => ({ ...h }));

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* --- assemble holes ----------------------------------------------------------- */
const holes = [];
const report = [];
for (const ch of card.holes) {
  const n = ch.n;
  const g = G[n];
  const gpsGC = g['Green Center'];

  /* green: the OSM green nearest the surveyed centre */
  let green = null, gd = Infinity;
  for (const gg of greens) { if (gg.used) continue; const d = dist(gg.c, gpsGC); if (d < gd) { gd = d; green = gg; } }
  if (!green || gd > 22) throw new Error(`hole ${n}: no OSM green within 22 m of GPS centre (nearest ${gd.toFixed(1)})`);
  green.used = true;
  const gc = green.c.map(r1);

  /* hole line: the OSM hole way whose ends best straddle tee->green, else GPS */
  const teeP = g['TheTipsTee Back Reach'], tgtP = g['Tee Target'];
  let line = null, lineSrc = 'gps';
  let bestHW = null, bestScore = Infinity;
  for (const hw of holeWays) {
    if (hw.used) continue;
    const a = hw.line[0], b = hw.line[hw.line.length - 1];
    const s1 = dist(a, teeP) + dist(b, gpsGC);
    const s2 = dist(b, teeP) + dist(a, gpsGC);
    const s = Math.min(s1, s2);
    if (s < bestScore) { bestScore = s; bestHW = hw; bestHW._rev = s2 < s1; }
  }
  if (bestHW && bestScore < 90) {
    bestHW.used = true;
    line = bestHW._rev ? [...bestHW.line].reverse().map(p => p.slice()) : bestHW.line.map(p => p.slice());
    line[line.length - 1] = gc.slice();
    lineSrc = 'osm-hole';
  } else {
    line = [teeP.map(r1)];
    if (dist(tgtP, teeP) > 25 && dist(tgtP, gpsGC) > 40) line.push(tgtP.map(r1));
    line.push(gc.slice());
  }

  /* slide the tee end along the first segment to the card's Gul length */
  const target = ch.t[0];
  const rest = polyLen(line.slice(1));
  const d0 = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
  const need = target - rest;
  if (need <= 2) throw new Error(`hole ${n}: dogleg (${rest.toFixed(0)}) >= card ${target}`);
  const ux = (line[0][0] - line[1][0]) / d0, uz = (line[0][1] - line[1][1]) / d0;
  const slide = need - d0;
  line[0] = [r1(line[1][0] + ux * need), r1(line[1][1] + uz * need)];
  const lineLen = polyLen(line);
  const lenDev = Math.abs(lineLen - target) / target * 100;

  /* fairways and bunkers are assigned to their nearest hole line globally, below */
  const fwRings = [];

  /* tees: OSM tee pads near the sliding tee end (within 55 m of the line start) */
  const pads = [];
  for (const t of tees) {
    if (t.used) continue;
    if (distToLine(t.c[0], t.c[1], line) < 26 && dist(t.c, line[0]) < 90) { t.used = true; pads.push({ ring: t.ring, cx: r1(t.c[0]), cz: r1(t.c[1]) }); }
  }
  const teePadDist = pads.length ? Math.min(...pads.map(t => dist([t.cx, t.cz], line[0]))) : null;

  /* per-card-tee marker positions on the line */
  const marks = ch.t.map(m => {
    const f = Math.max(0, (lineLen - m) / lineLen);
    const seg = []; let tot = 0;
    for (let i = 0; i < line.length - 1; i++) { const d = hyp(line[i], line[i + 1]); seg.push(d); tot += d; }
    let d = f * tot;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? d / seg[i] : 0;
        const b = bearing(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) * 180 / Math.PI;
        return { c: [r1(line[i][0] + (line[i + 1][0] - line[i][0]) * t), r1(line[i][1] + (line[i + 1][1] - line[i][1]) * t)], b: Math.round(b * 10) / 10, m };
      }
      d -= seg[i];
    }
  });

  const elev = { tee: r1(terr(line[0][0], line[0][1])), green: r1(terr(gc[0], gc[1])) };
  elev.rise = r1(elev.green - elev.tee);

  const nn = notes.holes[String(n)] || {};
  holes.push({
    n, par: ch.par, idx: ch.hcp, t: ch.t,
    line, lineLen: r1(lineLen), lenDev: Math.round(lenDev * 100) / 100, lineSrc, teeSlide: r1(slide),
    teePadDist: teePadDist == null ? null : r1(teePadDist),
    green: { ring: ring1(green.ring), c: gc, prov: 'osm', area: Math.round(Math.abs(polyArea(green.ring))) },
    fairway: { rings: fwRings, prov: 'osm' },
    tees: { pads, marks },
    bunkers: [],
    pin: gc.slice(), elev,
    name: nn.name || null, note: nn.note || null, tiers: nn.tiers || 1,
    gpsGreenDist: r1(gd),
  });
  report.push({ n, par: ch.par, card: target, lineLen: r1(lineLen), lenDev: r1(lenDev), slide: r1(slide), area: Math.round(Math.abs(polyArea(green.ring))), gd: r1(gd), lineSrc });
}

/* --- fairways & bunkers assigned globally to nearest hole line ----------------- */
const lineOf = n => holes.find(h => h.n === n).line;
for (const f of fairways) {
  let best = -1, bd = Infinity;
  for (const h of holes) { const d = distToLine(f.c[0], f.c[1], h.line); if (d < bd) { bd = d; best = h.n; } }
  if (best > 0 && bd < 70) holes.find(h => h.n === best).fairway.rings.push(ring1(f.ring));
}
/* A bunker beside a practice green is the practice ground's, not the nearest
   hole's: the 153 m² one at the inspelsgreen sat 37 m off the 14th's line and
   was drawn as that hole's fairway bunker, 29 m from its tee. */
const practiceGreens = greens.filter(g => !g.used);
const practiceBunkers = [];
for (const b of bunkers) {
  const dp = Math.min(...practiceGreens.map(g => dist(g.c, b.c)), Infinity);
  let best = -1, bd = Infinity;
  for (const h of holes) { const d = distToLine(b.c[0], b.c[1], h.line); if (d < bd) { bd = d; best = h.n; } }
  if (dp < 30 && dp < bd) { practiceBunkers.push(ring1(b.ring)); continue; }
  if (best > 0 && bd < 60) holes.find(h => h.n === best).bunkers.push({ ring: ring1(b.ring), prov: 'osm' });
}

/* --- water -------------------------------------------------------------------- */
const water = [];
/* OSM tags no lake here. The names come from laser-features.json, where each
   is a Wikipedia/SVAR register coordinate asserted to fall INSIDE the ring it
   names -- this pass used to call the two LARGEST rings Stor- and Lill-Rössjön,
   and both of those are 4 km from the course (Högbysjön and Ovansjösjön). The
   Rössjön lakes are the two ON the course: Stor-Rössjön the 13.7 ha ring the
   12th, 13th, 14th and 15th play over, Lill-Rössjön the 11 ha one inside the
   4th's dogleg. Those two get the lake treatment (the wide shore bench, the
   finer water mesh) with the two big far lakes; the tarns stay ponds. */
const laserWater = new Map((laserF?.water || []).map(w => [w.id, w]));
for (const w of osm.water) {
  const lv = hf.water.find(x => x.id === w.id);
  const lw = laserWater.get(w.id);
  const name = w.name || lw?.name || null;
  water.push({ id: w.id, ring: w.ring, name, area: w.area,
               level: lv ? lv.level : null,
               isLake: w.area > 300000 || /Rössjön$/.test(name || ''),
               ...(lw?.laserLevelRH2000 != null ? { laserLevelRH2000: lw.laserLevelRH2000, laserLevelLegacy: lw.laserLevelLegacy } : {}),
               ...(lw?.svarHeight != null ? { svarHeight: lw.svarHeight } : {}) });
}

/* --- what the laser ground corrects ------------------------------------------ */
/* Tee marks that stand in the water. A card-length mark is placed ALONG the hole
   line, and on 12, 14 and 15 that line crosses a bay of Stor-Rössjön, so the
   forward marks landed in the lake (the 12th's Orange 22 m inside the ring).
   The club's own hole plans put every one of those tees on the shore to the
   player's RIGHT -- the 41 beside the path east of the 12th's bay, the 48/41
   on the west bank of the 15th's, the 48 on the fairway side of the 14th's
   inlet -- so a wet mark slides right, square to the line, until it stands
   6 m clear of the ring. The card length is still what the card prints; the
   mark says it was moved and by how much. */
const rightOf = (line, c) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < line.length - 1; i++) { const d = distToLine(c[0], c[1], [line[i], line[i + 1]]); if (d < bd) { bd = d; bi = i; } }
  const dx = line[bi + 1][0] - line[bi][0], dz = line[bi + 1][1] - line[bi][1], L = Math.hypot(dx, dz);
  return [-dz / L, dx / L];            /* forward (dx,dz) -> right hand (-dz, dx) with north -z */
};
const ringSD = (p, r) => {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t));
  }
  return (pointInPoly(p[0], p[1], r) ? -1 : 1) * d;
};
const shoreSlides = [];
/* A tee stands between the water and whatever runs along the bank -- the 15th's
   forward tee is squeezed between the shore and the service road, the 12th's
   sits just east of the shore path, the 14th's on the fairway side of the
   shore path. So the slide does not stop at the first dry metre: it takes the
   point along its direction with the best clearance from BOTH the ring and
   the nearest path or road (a pad is 8.8 m deep, so 8 m of clearance is all
   it can use), with a small preference for the shorter slide. */
const ways = [osm.paths, traces.paths || [], osm.tracks, traces.tracks || [], osm.roads, traces.roads || []].flat().map(w => w.line);
const wayDist = p => Math.min(...ways.map(l => distToLine(p[0], p[1], l)), Infinity);
/* A walking path may lie between a tee and its water -- the 12th's 41 tee sits
   east of the shore path, the 14th's 48 on the fairway side of it -- but a tee
   is never on the far side of a ROAD from its hole: the 15th's forward tee is
   the strip between the shore and the service road, however narrow. */
const barriers = [osm.tracks, traces.tracks || [], osm.roads, traces.roads || []].flat().map(w => w.line);
const barrierDist = p => Math.min(...barriers.map(l => distToLine(p[0], p[1], l)), Infinity);
const placeAlong = (mk, wet, sx, sz, limit) => {
  let best = null;
  for (let s = 1; s <= limit; s++) {
    const p = [mk.c[0] + sx * s, mk.c[1] + sz * s];
    if (barrierDist(p) < 2) break;
    const sd = ringSD(p, wet.ring);
    if (sd < 3 || water.some(w => w !== wet && ringSD(p, w.ring) < 3)) continue;
    const score = Math.min(sd, wayDist(p) - 1.5, 8) - 0.05 * s;
    if (!best || score > best.score) best = { p: [r1(p[0]), r1(p[1])], s, score, sd: r1(sd), way: r1(wayDist(p)) };
  }
  return best;
};
for (const h of holes) for (const mk of h.tees.marks) {
  const wet = water.find(w => ringSD(mk.c, w.ring) < 0);
  if (!wet) continue;
  const [rx, rz] = rightOf(h.line, mk.c);
  /* right first; left only if no bank lies right within 60 m; and a mark that
     merely grazes the ring where the shore runs along the line (the 16th's
     back tee, 1.1 m inside at the lake's south-west corner) finds no bank
     square to the line at all and steps straight off the shore instead */
  let bp = null, bd = Infinity;
  for (let i = 0; i < wet.ring.length; i++) {
    const a = wet.ring[i], b = wet.ring[(i + 1) % wet.ring.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], t = Math.max(0, Math.min(1, ((mk.c[0] - a[0]) * ex + (mk.c[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const p = [a[0] + ex * t, a[1] + ez * t], d = Math.hypot(p[0] - mk.c[0], p[1] - mk.c[1]);
    if (d < bd) { bd = d; bp = p; }
  }
  const nx = (bp[0] - mk.c[0]) / (bd || 1), nz = (bp[1] - mk.c[1]) / (bd || 1);
  let moved = null;
  for (const [side, sx, sz] of [['R', rx, rz], ['L', -rx, -rz], ['shore', nx, nz]]) {
    const got = placeAlong(mk, wet, sx, sz, 60);
    if (got) { moved = { ...got, side }; break; }
  }
  if (!moved) throw new Error(`hole ${h.n}: the ${mk.m} m mark stands in ${wet.name || wet.id} and no dry ground lies within 60 m of it`);
  shoreSlides.push({ n: h.n, m: mk.m, from: mk.c, to: moved.p, metres: moved.s, side: moved.side, water: wet.name || wet.id, sd: moved.sd, way: moved.way });
  mk.shore = { from: mk.c, side: moved.side, metres: moved.s, water: wet.name || wet.id, basis: 'club hole plan' };
  mk.c = moved.p;
}
/* Tee and green heights: the page's terrain is Terrarium, which carries canopy
   -- the 7th's green reads 7 m above the ground under it -- so the displayed
   rise comes from the laser, in the legacy datum, wherever the laser has it. */
if (laserF) for (const h of holes) {
  const lh = laserF.holes.find(x => x.n === h.n);
  if (!lh) continue;
  h.elevTerrarium = h.elev;
  h.elev = { tee: lh.legacy.tee, green: lh.legacy.green, rise: lh.legacy.rise };
  h.elevSrc = 'laser';
}
/* The ditches: linear depressions the laser resolves and OSM has not got,
   kept where they cross a hole or run within twelve metres of one and are not
   a road's own drain. They ship as narrow streams (the engine carves a stream
   and bridges a path over it), which is what the tvärdiken on 1, 10, 16 and 18
   and the bridged crossings on 8, 13 and 17 are. */
const ditches = (laserF?.ditches || [])
  .filter(d => (d.crossings.length || d.holeDistance <= 12) && d.roadDistance > 3)
  .map(d => ({ id: d.id, line: d.line, kind: 'ditch', w: 1.0, prov: 'laser', depth: d.meanDepth, crossings: d.crossings }));

/* --- the clubhouse, and the practice greens ------------------------------------ */
/* Satellite-traced anchor: OSM maps no clubhouse at Puttom — every one of its 23
   building footprints here is unnamed and the nearest sits 680 m from the hub — so
   the club's own building comes from sat-traces.json, read off the orthorectified
   z18 imagery. It carries a name the page's /golfklubb/ matcher finds, which is what
   puts the bench, the mown apron and the terrace under it. */
const tracedBuildings = (traces.buildings || []).map(b => ({
  id: b.id, ring: ring1(b.ring), h: b.h ?? null,
  kind: b.kind || 'yes', name: b.name || null,
  amenity: b.amenity || null, prov: 'trace',
}));
/* The rest of what OSM has not got here and the imagery has: the two gravel car
   parks, the service roads into the works yard and out to the summer houses, the
   gravel cart paths the tiles show clearly, the works yard itself, and the
   range's tee line and net. Same frame, same trace file, same provenance tag. */
const tracedParking = (traces.parking || []).map(p => ({
  id: p.id, ring: ring1(p.ring), surface: p.surface || 'gravel', prov: 'trace',
  ...(p.cars === false ? { cars: false } : {}), ...(p.vehicles ? { vehicles: p.vehicles } : {}),
}));
const tracedRoads = (traces.roads || []).map(r => ({
  id: r.id, line: ring1(r.line), kind: r.kind || 'unclassified', surface: r.surface || 'gravel',
  name: r.name || null, lanes: null, oneway: false, maxspeed: null, lit: false, prov: 'trace',
}));
/* Where a trace carries the road, OSM's version of it must not: inside the
   hub override box every OSM road and track loses its points, and a way that
   crosses the box comes out as the runs outside it. OSM's way here cut the
   bend by ten metres, which put cars on the carriageway and the net on the
   shoulder however carefully the rest was traced. */
const inRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const clipOutside = (ways, box) => {
  if (!box) return ways;
  const out = [];
  for (const way of ways) {
    const runs = [];
    let run = [];
    for (const p of way.line) {
      if (inRing(p[0], p[1], box)) { if (run.length >= 2) runs.push(run); run = []; }
      else run.push(p);
    }
    if (run.length >= 2) runs.push(run);
    if (runs.length === 1 && runs[0].length === way.line.length) { out.push(way); continue; }
    runs.forEach((line, k) => out.push({ ...way, id: `${way.id}${runs.length > 1 ? '.' + k : ''}`, line, clipped: true }));
  }
  return out;
};
const hubBox = traces.hubOverride?.ring ? ring1(traces.hubOverride.ring) : null;
const tracedTracks = (traces.tracks || []).map(t => ({ id: t.id, line: ring1(t.line), kind: t.kind || 'service', surface: t.surface || 'gravel', prov: 'trace' }));
const tracedPaths = (traces.paths || []).map(t => ({ id: t.id, line: ring1(t.line), kind: t.kind || 'path', surface: t.surface || 'gravel', prov: 'trace' }));
const tracedSurround = traces.surround ? {
  clearfells: (traces.surround.clearfells || []).map(ring1),
  yard: traces.surround.yard ? ring1(traces.surround.yard) : null,
  hayfields: traces.surround.hayfields ? ring1(traces.surround.hayfields) : null,
  shallows: (traces.surround.shallows || []).map(ring1),
} : null;
const tracedRange = traces.range ? {
  bays: ring1(traces.range.bays), bayPitch: traces.range.bayPitch ?? 3,
  nets: (traces.range.nets || []).map(ring1), netHeight: traces.range.netHeight ?? 10,
  shelterId: traces.range.shelterId || null, hutId: traces.range.hutId || null, prov: 'trace',
} : null;
const tracedCartPark = traces.cartPark ? { line: ring1(traces.cartPark.line), count: traces.cartPark.count ?? 6, prov: 'trace' } : null;

/* Every OSM green the 18 holes did not claim. Two are left over here, both beside
   the clubhouse, and one of them is the far end of the 19th OSM hole way — a 73 m
   pitch, well under the card's shortest hole at 122 m — so they are practice
   ground, not a hole this pass mis-assigned. They ship as bare rings, the shape
   geobuild and nvgkbuild use for scenery.greens. */
const spareGreens = greens.filter(g => !g.used);

/* --- the model ---------------------------------------------------------------- */
const model = {
  version: 1,
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  mPerLat: M_PER_LAT, mPerLon: Math.round(M_PER_LON * 100) / 100,
  frame: 'local metres about ORIGIN; north -z, east +x',
  seaLevel: hf.seaLevel ?? null,
  card: { teeNames: card.teeNames, provisional: !!card.provisional },
  holes,
  water,
  streams: osm.waterway.map(w => ({ id: w.id, line: w.line, kind: w.kind, w: w.kind === 'stream' ? 1.6 : 1.0 })).concat(ditches),
  coast: { chains: [], beaches: (osm.sand || []).map(s => ({ id: s.id, ring: s.ring })) },
  vegetation: {
    forest: (osm.forest || []).map(f => f.ring),
    wood: (osm.wood || []).map(w => w.ring),
    scrub: (osm.scrub || []).map(s => s.ring),
    wetland: (osm.wetland || []).map(w => w.ring || w),
    sand: [], rock: [],
  },
  infra: {
    paths: osm.paths.concat(tracedPaths), tracks: clipOutside(osm.tracks, hubBox).concat(tracedTracks),
    roads: clipOutside(osm.roads, hubBox).concat(tracedRoads),
    buildings: osm.buildings.concat(tracedBuildings), farB: osm.farBuildings,
    parking: (osm.parking || []).concat(tracedParking), piers: osm.piers || [], basins: [],
    pitches: [], landuse: osm.landuse || [], reserves: osm.reserves || [],
    power: osm.power || { lines: [], towers: [], poles: [] }, railway: osm.railway || [],
  },
  ...(tracedSurround ? { surround: tracedSurround } : {}),
  pois: osm.pois || [],
  scenery: {
    greens: spareGreens.map(g => ring1(g.ring)),
    fairways: [], tees: [], bunkers: practiceBunkers, grass: [],
    range: (osm.drivingRange || []).map(r => r.ring),
    ...(tracedRange ? { rangeFacilities: tracedRange } : {}),
    ...(tracedCartPark ? { cartPark: tracedCartPark } : {}),
  },
};

writeJSON(path.join(HERE, 'course-model.json'), model);

/* --- report ------------------------------------------------------------------- */
console.log('hole par  card  drawn   dev%  slide  green m²  gc-dist  src');
for (const r of report) {
  const bad = r.lenDev > 0.5 || r.gd > 12;
  console.log(`${String(r.n).padStart(4)}  ${r.par}  ${String(r.card).padStart(4)}  ${String(r.lineLen).padStart(6)}  ${String(r.lenDev).padStart(5)}  ${String(r.slide).padStart(5)}  ${String(r.area).padStart(7)}  ${String(r.gd).padStart(6)}  ${r.lineSrc}${bad ? '  <-- CHECK' : ''}`);
}
const devs = report.map(r => r.lenDev);
console.log(`\nlength dev max ${Math.max(...devs).toFixed(2)}%  · GPS-green match max ${Math.max(...report.map(r => r.gd)).toFixed(1)} m`);
console.log(`greens ${Math.min(...report.map(r => r.area))}–${Math.max(...report.map(r => r.area))} m²`);
const fwN = holes.reduce((a, h) => a + h.fairway.rings.length, 0);
const bkN = holes.reduce((a, h) => a + h.bunkers.length, 0);
const tpN = holes.reduce((a, h) => a + h.tees.pads.length, 0);
console.log(`assigned: fairways ${fwN}, bunkers ${bkN}, tee pads ${tpN}; water ${water.length} (${water.filter(w => w.isLake).length} lakes)`);
console.log(`practice greens: ${spareGreens.length} OSM greens no hole claimed -> scenery.greens`);
for (const g of spareGreens) {
  const d = Math.min(...holes.map(h => dist(g.c, h.green.c)));
  console.log(`  ${g.id}  centre ${g.c.map(r1).join(', ')}  ${Math.round(Math.abs(polyArea(g.ring)))} m²  ${r1(d)} m from the nearest hole green`);
}
console.log(`buildings: ${osm.buildings.length} from OSM (none named) + ${tracedBuildings.length} satellite-traced`);
for (const b of tracedBuildings) {
  const c = centroid(b.ring);
  console.log(`  ${b.id}  ${b.name}  centre ${c.map(r1).join(', ')}  ${Math.round(Math.abs(polyArea(b.ring)))} m²`);
}
console.log(`\nhole  tee m  green m  rise   (${laserF ? 'laser, legacy datum; Terrarium in brackets' : 'Terrarium'})`);
for (const h of holes) console.log(`${String(h.n).padStart(4)}  ${h.elev.tee.toFixed(1).padStart(5)}  ${h.elev.green.toFixed(1).padStart(6)}  ${(h.elev.rise >= 0 ? '+' : '') + h.elev.rise.toFixed(1)}${h.elevTerrarium ? `   (${(h.elevTerrarium.rise >= 0 ? '+' : '') + h.elevTerrarium.rise})` : ''}`);
console.log(`\nwater: ${water.map(w => `${w.name || w.id}${w.isLake ? '*' : ''}`).join(', ')}  (* lake treatment)`);
console.log(`shore slides: ${shoreSlides.map(s => `hole ${s.n} ${s.m} m: ${s.metres} m ${s.side} onto the ${s.water} bank (${s.sd} m off the ring, ${s.way} m off the nearest way)`).join('; ') || 'none'}`);
console.log(`ditches from the laser: ${ditches.length} (${ditches.reduce((a, d) => a + polyLen(d.line), 0).toFixed(0)} m), crossing holes ${[...new Set(ditches.flatMap(d => d.crossings.map(c => c.hole)))].sort((a, b) => a - b).join(', ')}`);
console.log(`practice bunkers: ${practiceBunkers.length}`);
if (card.provisional) console.log('\nNOTE: card.json is PROVISIONAL — tee lengths/index are placeholders.');
console.log(`\nwrote puttombuild/course-model.json (${(fs.statSync(path.join(HERE, 'course-model.json')).size / 1024).toFixed(0)} KB)`);
