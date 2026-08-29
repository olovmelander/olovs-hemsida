/* Fuse Johannesberg Golf & CC's records into one course model.

   OpenStreetMap knows this club only as a property outline and two greens, and
   GolfTraxx does not list it at all — so unlike every other course here, the
   geometry is read almost entirely off orthorectified satellite imagery, with
   the club's own banguide supplying the routing. The card, as always, supplies
   every number the page displays and the length each drawn line is slid to.

   - card.json           the club's card: every displayed number, verbatim
   - sat-shapes.json     per hole: the OSM green it belongs to, plus traced
                         fairways, tees, centrelines and water; and the driving
                         range, which OSM does not map here at all
   - osm-features.json   greens, bunkers, water, forest, farmland, roads,
                         buildings
   - heightfields.json   the ground, and every water level measured                */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN, M_PER_LAT, M_PER_LON,
  polyLen, polyArea, centroid, pointInPoly, distToLine,
  readJSON, writeJSON, r1, ring1, decodeHF, bearing, hyp,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const card = readJSON(path.join(HERE, 'card.json'));
const notes = (() => { try { return readJSON(path.join(HERE, 'guide-notes.json')); } catch { return { holes: {} }; } })();
const osm = readJSON(path.join(HERE, 'osm-features.json'));
const traces = readJSON(path.join(HERE, 'sat-shapes.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));

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

const T = {};
for (const t of traces.holes) T[t.hole] = t;
const missing = [];
for (const ch of card.holes) if (!T[ch.n]) missing.push(ch.n);
if (missing.length) throw new Error(`traces missing for holes ${missing.join(',')}`);

/* --- OSM pools ---------------------------------------------------------------- */
const greens = osm.greens.map(g => ({ ...g, c: centroid(g.ring) }));
const bunkers = osm.bunkers.map(b => ({ ...b, c: centroid(b.ring) }));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* One green per hole: a trace names it by index. Two holes may not claim the same
   green, and a claim is refused if the traced green sits nowhere near the OSM one —
   that is the check that catches a mis-numbered routing rather than trusting it. */
const claimed = new Map();
for (const ch of card.holes) {
  const tr = T[ch.n];
  const gi = tr.greenOsmIndex;
  if (gi == null || gi < 0 || gi >= greens.length) continue;
  const g = greens[gi];
  const tc = centroid(tr.green.ring);
  const d = dist(g.c, tc);
  if (d > 45) { console.log(`  hole ${ch.n}: refuses OSM green G${gi} (traced centre ${d.toFixed(0)} m away)`); continue; }
  if (claimed.has(gi)) { console.log(`  hole ${ch.n}: OSM green G${gi} already taken by hole ${claimed.get(gi)} — tracing instead`); continue; }
  claimed.set(gi, ch.n);
  tr._osmGreen = g;
  tr._osmGreenDist = d;
}

/* --- assemble holes ----------------------------------------------------------- */
const holes = [];
const report = [];
for (const ch of card.holes) {
  const n = ch.n;
  const tr = T[n];
  const useOsm = !!tr._osmGreen;
  const ring = ring1(useOsm ? tr._osmGreen.ring : tr.green.ring);
  const gc = centroid(ring).map(r1);
  const area = Math.round(Math.abs(polyArea(ring)));

  let line = tr.centerline.map(p => [r1(p[0]), r1(p[1])]);
  if (line.length < 2) throw new Error(`hole ${n}: centerline too short`);
  line[line.length - 1] = gc.slice();

  /* slide the tee end along its own axis to the card's back-tee length */
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

  const padRing = t => {
    const a = t.angDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const hw = Math.max(3, t.w) / 2, hd = Math.max(4, t.d) / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
      .map(([u, v]) => [r1(t.cx + u * ca - v * sa), r1(t.cz + u * sa + v * ca)]);
  };
  const pads = (tr.tees || []).map(t => ({ ring: padRing(t), cx: r1(t.cx), cz: r1(t.cz), ang: Math.round(t.angDeg) }));
  const teePadDist = pads.length ? Math.min(...pads.map(t => dist([t.cx, t.cz], line[0]))) : null;

  const marks = ch.t.map(m => {
    const f = Math.max(0, (lineLen - m) / lineLen);
    const seg = []; let tot = 0;
    for (let i = 0; i < line.length - 1; i++) { const d = hyp(line[i], line[i + 1]); seg.push(d); tot += d; }
    let d = f * tot;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? d / seg[i] : 0;
        const b = bearing(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) * 180 / Math.PI;
        return { c: [r1(line[i][0] + (line[i + 1][0] - line[i][0]) * t), r1(line[i][1] + (line[i + 1][1] - line[i][1]) * t)],
                 b: Math.round(b * 10) / 10, m };
      }
      d -= seg[i];
    }
  });

  const elev = { tee: r1(terr(line[0][0], line[0][1])), green: r1(terr(gc[0], gc[1])) };
  elev.rise = r1(elev.green - elev.tee);
  const nn = notes.holes[String(n)] || {};

  holes.push({
    n, par: ch.par, idx: ch.hcp, t: ch.t,
    line, lineLen: r1(lineLen), lenDev: Math.round(lenDev * 100) / 100,
    lineSrc: 'sat-trace', teeSlide: r1(slide), teePadDist: teePadDist == null ? null : r1(teePadDist),
    green: { ring, c: gc, prov: useOsm ? 'osm' : 'sat', area },
    fairway: { rings: (tr.fairway.rings || []).map(ring1), prov: 'sat' },
    tees: { pads, marks },
    bunkers: (tr.bunkers || []).map(b => ({ ring: ring1(b.ring), prov: 'sat' })),
    pin: gc.slice(), elev,
    name: nn.name || null, note: nn.note || null, tiers: nn.tiers || 1,
    conf: tr.confidence, notes: tr.notes || null,
  });
  report.push({ n, par: ch.par, card: target, lineLen: r1(lineLen), lenDev: r1(lenDev), slide: r1(slide),
                area, prov: useOsm ? `osm G${tr.greenOsmIndex}` : 'traced',
                gd: useOsm ? r1(tr._osmGreenDist) : null, conf: tr.confidence });
}

/* --- OSM bunkers to their nearest hole line, unless a trace already found one --- */
for (const b of bunkers) {
  let best = -1, bd = Infinity;
  for (const h of holes) { const d = distToLine(b.c[0], b.c[1], h.line); if (d < bd) { bd = d; best = h.n; } }
  if (best < 0 || bd >= 70) continue;
  const H = holes.find(h => h.n === best);
  /* a traced bunker within 12 m of this one is the same bunker; OSM's outline wins */
  const dup = H.bunkers.findIndex(x => Math.hypot(centroid(x.ring)[0] - b.c[0], centroid(x.ring)[1] - b.c[1]) < 12);
  if (dup >= 0) H.bunkers[dup] = { ring: ring1(b.ring), prov: 'osm' };
  else H.bunkers.push({ ring: ring1(b.ring), prov: 'osm' });
}

/* --- water -------------------------------------------------------------------- */
const water = [];
for (const w of osm.water) {
  const lv = hf.water.find(x => x.id === w.id);
  water.push({ id: w.id, ring: w.ring, name: w.name || null, area: w.area,
               level: lv ? lv.level : null, isLake: w.area > 120000 });
}
const levelOfRing = ring => {
  const s = ring.map(p => terr(p[0], p[1])).sort((a, b) => a - b);
  return r1(s[Math.floor(s.length * 0.25)]);
};
let pondId = 0;
for (const t of traces.holes) for (const w of t.water || []) {
  const ring = ring1(w.ring);
  const c = centroid(ring);
  if (water.some(x => pointInPoly(c[0], c[1], x.ring) || dist(centroid(x.ring), c) < 20)) continue;
  water.push({ id: `t${++pondId}`, ring, name: null, kind: w.kind,
               area: Math.round(Math.abs(polyArea(ring))), level: levelOfRing(ring), isLake: false });
}

/* --- the driving range --------------------------------------------------------- */
/* OSM maps no golf=driving_range here — the club's property polygon only mentions
   one in its description — so the range is traced off the imagery exactly like the
   holes are, and sat-shapes.json carries the reading. The trace is self-checked:
   both ends of the hitting line must fall inside the ring it belongs to, and the
   carry from that line is reported so a ring too small to be a range is obvious.  */
const rangeRings = (osm.drivingRange || []).map(r => r.ring);
if (traces.range) {
  const ring = ring1(traces.range.ring);
  const c = centroid(ring);
  if (rangeRings.some(r => pointInPoly(c[0], c[1], r))) {
    console.log('\nrange: OSM already maps one over this ground — keeping OSM, dropping the trace');
  } else {
    const hl = traces.range.hittingLine || [];
    if (hl.length !== 2) throw new Error('range trace: hittingLine must be two points');
    for (const p of hl) {
      if (!pointInPoly(p[0], p[1], ring)) throw new Error(`range trace: hitting-line end ${p} is outside its own ring`);
    }
    rangeRings.push(ring);
    const mid = [(hl[0][0] + hl[1][0]) / 2, (hl[0][1] + hl[1][1]) / 2];
    const carry = Math.max(...ring.map(p => Math.hypot(p[0] - mid[0], p[1] - mid[1])));
    let clear = Infinity;
    for (const h of holes) for (const p of ring) clear = Math.min(clear, distToLine(p[0], p[1], h.line));
    console.log(`\nrange: traced, ${(Math.abs(polyArea(ring)) / 10000).toFixed(2)} ha, hitting line ${polyLen(hl).toFixed(0)} m`
              + ` at ${mid.map(r1).join(',')}, carry to the far edge ${carry.toFixed(0)} m,`
              + ` nearest hole corridor ${clear.toFixed(0)} m  [${traces.range.confidence}]`);
  }
}

/* --- the practice greens -------------------------------------------------------- */
/* Traced like the range, and for the same reason: OSM maps neither. A practice
   green is only a practice green if it belongs to no hole on the card, so that is
   what is asserted — anything within 25 m of a card green is that green, mistraced. */
const practiceGreens = [];
for (const pg of traces.practiceGreens || []) {
  const ring = ring1(pg.ring);
  const c = centroid(ring);
  let near = Infinity, who = null;
  for (const h of holes) { const d = dist(c, h.green.c); if (d < near) { near = d; who = h.n; } }
  if (near < 25) throw new Error(`practice green at ${c.map(r1)} is ${near.toFixed(0)} m from green ${who} — that is a hole's green, not a practice one`);
  practiceGreens.push(ring);
  console.log(`practice green '${pg.name}': ${Math.abs(polyArea(ring)).toFixed(0)} m² at ${c.map(r1).join(',')},`
            + ` nearest card green is ${who} at ${near.toFixed(0)} m  [${pg.confidence}]`);
}

/* --- the model ---------------------------------------------------------------- */
const model = {
  version: 1,
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  mPerLat: M_PER_LAT, mPerLon: Math.round(M_PER_LON * 100) / 100,
  frame: 'local metres about ORIGIN; north -z, east +x',
  /* The floor below which nothing may sit. With a real sea it is 0; inland it is
     just under the lowest water the MODEL knows -- which includes traced ponds
     that build-heightfields never saw, and so can be lower than its estimate. */
  seaLevel: (() => {
    const lv = water.map(w => w.level).filter(v => v != null);
    const sea = water.some(w => w.isSea);
    return sea ? (hf.seaLevel ?? 0) : (lv.length ? Math.round((Math.min(...lv) - 0.5) * 100) / 100 : (hf.seaLevel ?? null));
  })(),
  card: { teeNames: card.teeNames, provisional: !!card.provisional },
  holes,
  water,
  streams: osm.waterway.map(w => ({ id: w.id, line: w.line, kind: w.kind, w: w.kind === 'stream' ? 1.6 : 1.0 })),
  coast: { chains: [], beaches: (osm.sand || []).map(s => ({ id: s.id, ring: s.ring })) },
  vegetation: {
    forest: (osm.forest || []).map(f => f.ring),
    wood: (osm.wood || []).map(w => w.ring),
    scrub: (osm.scrub || []).map(s => s.ring),
    wetland: (osm.wetland || []).map(w => w.ring || w),
    sand: [], rock: (osm.rock || []).map(r => r.ring),
  },
  infra: {
    paths: osm.paths, tracks: osm.tracks, roads: osm.roads,
    buildings: osm.buildings, farB: osm.farBuildings,
    parking: osm.parking || [], piers: osm.piers || [], basins: [],
    pitches: [], landuse: osm.landuse || [], reserves: osm.reserves || [],
    power: osm.power || { lines: [], towers: [], poles: [] }, railway: osm.railway || [],
  },
  pois: osm.pois || [],
  scenery: { greens: practiceGreens, fairways: [], tees: [], bunkers: [], grass: [],
             range: rangeRings },
};
writeJSON(path.join(HERE, 'course-model.json'), model);

/* --- report ------------------------------------------------------------------- */
console.log('\nhole par  card  drawn   dev%  slide  green m²  source     conf');
for (const r of report) {
  const bad = r.lenDev > 0.5;
  console.log(`${String(r.n).padStart(4)}  ${r.par}  ${String(r.card).padStart(4)}  ${String(r.lineLen).padStart(6)}  ${String(r.lenDev).padStart(5)}  ${String(r.slide).padStart(5)}  ${String(r.area).padStart(8)}  ${r.prov.padEnd(9)}  ${r.conf}${bad ? '  <-- CHECK' : ''}`);
}
const devs = report.map(r => r.lenDev);
const osmN = report.filter(r => r.prov.startsWith('osm')).length;
console.log(`\nlength dev max ${Math.max(...devs).toFixed(2)}%  ·  greens: ${osmN} from OSM, ${18 - osmN} traced`);
console.log(`green areas ${Math.min(...report.map(r => r.area))}–${Math.max(...report.map(r => r.area))} m²`);
const bkN = holes.reduce((a, h) => a + h.bunkers.length, 0);
const fwN = holes.reduce((a, h) => a + h.fairway.rings.length, 0);
const tpN = holes.reduce((a, h) => a + h.tees.pads.length, 0);
console.log(`assigned: bunkers ${bkN} (${bunkers.length} from OSM), fairways ${fwN}, tee pads ${tpN}; water ${water.length}`);
console.log(`\nhole  tee m  green m  rise`);
for (const h of holes) console.log(`${String(h.n).padStart(4)}  ${h.elev.tee.toFixed(1).padStart(5)}  ${h.elev.green.toFixed(1).padStart(6)}  ${(h.elev.rise >= 0 ? '+' : '') + h.elev.rise.toFixed(1)}`);
if (card.provisional) console.log('\nNOTE: card.json is PROVISIONAL.');
console.log(`\nwrote ${path.basename(HERE)}/course-model.json (${(fs.statSync(path.join(HERE, 'course-model.json')).size / 1024).toFixed(0)} KB)`);
