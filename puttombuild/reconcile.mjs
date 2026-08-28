/* Fuse Puttom's four records into one course model.

   Unlike Norrfällsviken, this course is fully mapped in OpenStreetMap, so the
   fusion is Veckefjärden's kind: OSM polygons are the shapes, the GPS survey is
   the anchor that assigns each polygon to its hole (no OSM golf feature here
   carries a hole ref), and the card is the length every drawn line is slid to.

   - card.json          the club's card — every displayed number, verbatim
   - geo_data GPS        green centres + back tees, the per-hole anchor
   - osm-features.json   greens, fairways, tees, bunkers, hole lines, the two
                         lakes, wetlands, forest, farmland, the E4, the railway   */
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
const hf = readJSON(path.join(HERE, 'heightfields.json'));
const gpsRaw = readJSON(path.join(HERE, '..', 'geo_data', 'puttom_clean.json'));

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
for (const b of bunkers) {
  let best = -1, bd = Infinity;
  for (const h of holes) { const d = distToLine(b.c[0], b.c[1], h.line); if (d < bd) { bd = d; best = h.n; } }
  if (best > 0 && bd < 60) holes.find(h => h.n === best).bunkers.push({ ring: ring1(b.ring), prov: 'osm' });
}

/* --- water -------------------------------------------------------------------- */
const water = [];
for (const w of osm.water) {
  const lv = hf.water.find(x => x.id === w.id);
  /* only the two dominant lakes get the wide shore bench; the rest are ponds */
  water.push({ id: w.id, ring: w.ring, name: w.name || null, area: w.area, c: centroid(w.ring),
               level: lv ? lv.level : null, isLake: w.area > 300000 });
}
/* OSM tags no lake here, but the club's own history names them: Stor-Rössjön is the
   larger lake on the W/NW side (hole 12 plays over a bay of it), Lill-Rössjön the
   ~14 ha lake in the south-centre. Name the two largest by that geography. */
{
  const lakes = water.filter(w => w.isLake).sort((a, b) => b.area - a.area);
  if (lakes[0]) lakes[0].name = 'Stor-Rössjön';
  if (lakes[1]) lakes[1].name = 'Lill-Rössjön';
}
for (const w of water) delete w.c;

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
  streams: osm.waterway.map(w => ({ id: w.id, line: w.line, kind: w.kind, w: w.kind === 'stream' ? 1.6 : 1.0 })),
  coast: { chains: [], beaches: (osm.sand || []).map(s => ({ id: s.id, ring: s.ring })) },
  vegetation: {
    forest: (osm.forest || []).map(f => f.ring),
    wood: (osm.wood || []).map(w => w.ring),
    scrub: (osm.scrub || []).map(s => s.ring),
    wetland: (osm.wetland || []).map(w => w.ring || w),
    sand: [], rock: [],
  },
  infra: {
    paths: osm.paths, tracks: osm.tracks, roads: osm.roads,
    buildings: osm.buildings, farB: osm.farBuildings,
    parking: osm.parking || [], piers: osm.piers || [], basins: [],
    pitches: [], landuse: osm.landuse || [], reserves: osm.reserves || [],
    power: osm.power || { lines: [], towers: [], poles: [] }, railway: osm.railway || [],
  },
  pois: osm.pois || [],
  scenery: { greens: [], fairways: [], tees: [], bunkers: [], grass: [], range: (osm.drivingRange || []).map(r => r.ring) },
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
console.log(`\nhole  tee m  green m  rise`);
for (const h of holes) console.log(`${String(h.n).padStart(4)}  ${h.elev.tee.toFixed(1).padStart(5)}  ${h.elev.green.toFixed(1).padStart(6)}  ${(h.elev.rise >= 0 ? '+' : '') + h.elev.rise.toFixed(1)}`);
if (card.provisional) console.log('\nNOTE: card.json is PROVISIONAL — tee lengths/index are placeholders.');
console.log(`\nwrote puttombuild/course-model.json (${(fs.statSync(path.join(HERE, 'course-model.json')).size / 1024).toFixed(0)} KB)`);
