/* Fuse the four Norrfällsviken records into one course model.

   Sources, in order of authority for what each is authority ON:
   - card.json            the club's printed card — every displayed number, verbatim
   - geo_data GPS survey  green centres and (with caveats) back tees
   - sat-shapes.json      outlines traced from z18 orthoimagery: greens, fairways,
                          tee pads, ponds, centerlines. The imagery is orthorectified,
                          so a trace is georeferenced by construction.
   - osm-features.json    the coastline, the lake, wetlands, and everything around
                          the course; OSM has no golf features here.

   THE NUMBERING SWAP. The club renumbered at some point: every third-party dataset
   (and the GPS survey) calls the par-5 west corridor "8" and the par-4 east corridor
   "4"; the club's own 2025 card is the other way around. The survey also recorded
   the west corridor twice (its "4" and "8" share one green to within 1.5 m) and lost
   the east corridor entirely — the traces restored it. Model numbering is the CARD's:
   trace/GPS 8 -> model 4, trace/GPS 4 -> model 8, asserted below against the card
   lengths rather than assumed.                                                     */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN, M_PER_LAT, M_PER_LON, lonLatToXZ,
  polyLen, polyArea, centroid, pointInPoly, polySD, bbox,
  readJSON, writeJSON, r1, ring1, decodeHF, bearing,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const card = readJSON(path.join(HERE, 'card.json'));
const notes = readJSON(path.join(HERE, 'guide-notes.json'));
const osm = readJSON(path.join(HERE, 'osm-features.json'));
const traces = readJSON(path.join(HERE, 'sat-shapes.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));
const gpsRaw = readJSON(path.join(HERE, '..', 'geo_data', 'norrfallsviken_clean.json'));

/* --- terrain sampler (decoded HF0, bilinear) --------------------------------- */
const H0 = hf.hf0;
const grid0 = decodeHF(H0);
function terr(x, z) {
  const gx = (x - H0.x0) / H0.dx, gz = (z - H0.z0) / H0.dx;
  const i = Math.max(0, Math.min(H0.nx - 2, Math.floor(gx)));
  const j = Math.max(0, Math.min(H0.nz - 2, Math.floor(gz)));
  const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
  const a = grid0[j * H0.nx + i], b = grid0[j * H0.nx + i + 1];
  const c = grid0[(j + 1) * H0.nx + i], d = grid0[(j + 1) * H0.nx + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/* --- GPS points, renumbered to the card -------------------------------------- */
/* GPS/trace -> card: 4 and 8 swap; everything else is 1:1 */
const swap = n => n === 4 ? 8 : n === 8 ? 4 : n;
const G = {};
for (const f of gpsRaw.features) {
  const p = f.properties;
  const [x, z] = lonLatToXZ(...f.geometry.coordinates);
  (G[swap(+p.hole)] ||= {})[p.name] = [r1(x), r1(z)];
}
/* the survey's model-8 record (its "4") duplicates the west corridor — its green
   is the model-4 green, not model-8's. Drop the corrupt points; the trace carries
   model 8 entirely. */
G[8] = { corrupt: true };

/* --- traces by model number --------------------------------------------------- */
const T = {};
for (const t of traces.holes) T[swap(t.hole)] = t;
const missing = [];
for (let n = 1; n <= 18; n++) if (!T[n]) missing.push(n);
if (missing.length) throw new Error(`traces missing for holes ${missing.join(',')}`);

/* assert the swap against the card: the west corridor the survey measured at
   ~431 m straight must be the hole the card calls a 440 m par 5 */
{
  const L4 = polyLen(T[4].centerline), L8 = polyLen(T[8].centerline);
  if (!(L4 > L8)) throw new Error(`numbering swap looks wrong: centerline 4 ${L4.toFixed(0)} m !> 8 ${L8.toFixed(0)} m`);
}

/* --- assemble holes ----------------------------------------------------------- */
const holes = [];
const report = [];
for (const ch of card.holes) {
  const n = ch.n;
  const tr = T[n];
  const g = G[n];

  /* green: traced ring; GPS green centre is the surveyed anchor where it exists */
  const ring = ring1(tr.green.ring);
  const gc = (!g.corrupt && g['Green Center']) ? g['Green Center'] : centroid(ring).map(r1);
  const gcInRing = pointInPoly(gc[0], gc[1], ring);
  const area = Math.round(Math.abs(polyArea(ring)));

  /* centerline: trace waypoints, pinned to the green centre at the far end */
  let line = tr.centerline.map(p => [r1(p[0]), r1(p[1])]);
  line[line.length - 1] = gc.slice();

  /* tee end: slide back/forward along the first segment until the line measures
     the card's Gul length exactly — where a back tee is, by definition */
  const target = ch.t[0];
  const rest = polyLen(line.slice(1));
  const d0 = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
  const need = target - rest;
  if (need <= 0) throw new Error(`hole ${n}: dogleg alone (${rest.toFixed(0)}) exceeds card ${target}`);
  const ux = (line[0][0] - line[1][0]) / d0, uz = (line[0][1] - line[1][1]) / d0;
  const slide = need - d0;
  line[0] = [r1(line[1][0] + ux * need), r1(line[1][1] + uz * need)];
  const lineLen = polyLen(line);
  const lenDev = Math.abs(lineLen - target) / target * 100;

  /* tee pads from the trace, as rings (the page samples ringSD on them); distance
     from the slid tee to the nearest pad measures whether the slide finds real tees */
  const padRing = t => {
    const a = t.angDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const hw = t.w / 2, hd = t.d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
      .map(([u, v]) => [r1(t.cx + u * ca - v * sa), r1(t.cz + u * sa + v * ca)]);
  };
  const pads = (tr.tees || []).map(t => ({ ring: padRing(t), cx: r1(t.cx), cz: r1(t.cz), ang: Math.round(t.angDeg) }));
  const teePadDist = pads.length
    ? Math.min(...pads.map(t => Math.hypot(t.cx - line[0][0], t.cz - line[0][1]))) : null;

  /* one marker position per card tee: on the line, the card's metres from the pin */
  const marks = ch.t.map(m => {
    const f = Math.max(0, (lineLen - m) / lineLen);
    const seg = [];
    let tot = 0;
    for (let i = 0; i < line.length - 1; i++) { const d = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]); seg.push(d); tot += d; }
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

  const elev = {
    tee: r1(terr(line[0][0], line[0][1])),
    green: r1(terr(gc[0], gc[1])),
  };
  elev.rise = r1(elev.green - elev.tee);

  holes.push({
    n, par: ch.par, idx: ch.hcp, t: ch.t,
    line, lineLen: r1(lineLen), lenDev: Math.round(lenDev * 100) / 100,
    lineSrc: 'sat-trace', teeSlide: r1(slide), teePadDist: teePadDist == null ? null : r1(teePadDist),
    green: { ring, c: gc, prov: 'sat', area },
    fairway: { rings: tr.fairway.rings.map(ring1), prov: 'sat' },
    tees: { pads, marks },
    bunkers: (tr.bunkers || []).map(b => ({ ring: ring1(b.ring), prov: 'sat' })),
    pin: gc.slice(),
    elev,
    name: (notes.holes[String(n)] || {}).name || null,
    note: (notes.holes[String(n)] || {}).note || null,
    tiers: (notes.holes[String(n)] || {}).tiers || 1,
    gpsGreenDist: (!g.corrupt && g['Green Center'])
      ? r1(Math.hypot(g['Green Center'][0] - centroid(ring)[0], g['Green Center'][1] - centroid(ring)[1])) : null,
    conf: tr.confidence, notes: tr.notes || null,
  });

  report.push({ n, par: ch.par, card: target, straight: null, lineLen: r1(lineLen),
    lenDev: r1(lenDev), slide: r1(slide), teePadDist, area, gcInRing, conf: tr.confidence });
}

/* --- water -------------------------------------------------------------------- */
/* OSM lake first, then traced ponds that do not duplicate it or each other */
const water = [];
/* isLake marks THE big water — here the sea; the perched lake by 13 renders as a
   (large) pond at its own measured level, not with the sea's 5.5 m bed ramp */
for (const w of osm.water) {
  const lv = hf.water.find(x => x.id === w.id);
  water.push({ id: w.id, ring: w.ring, name: w.name, area: w.area,
               level: lv ? lv.level : null, isLake: false });
}
const levelOfRing = ring => {
  const s = ring.map(p => terr(p[0], p[1])).sort((a, b) => a - b);
  return r1(s[Math.floor(s.length * 0.25)]);
};
let pondId = 0;
for (const t of traces.holes) {
  for (const w of t.water || []) {
    const ring = ring1(w.ring);
    const c = centroid(ring);
    const dup = water.some(x => pointInPoly(c[0], c[1], x.ring) ||
      Math.hypot(centroid(x.ring)[0] - c[0], centroid(x.ring)[1] - c[1]) < 18);
    if (dup) continue;
    water.push({ id: `t${++pondId}`, ring, name: null, kind: w.kind,
                 area: Math.round(Math.abs(polyArea(ring))), level: levelOfRing(ring), isLake: false });
  }
}

/* --- the sea as a ring --------------------------------------------------------- */
/* The page's water machinery is ring-driven (shore distance, wet masks, benches),
   so the sea becomes a ring too: the coastline chains merged end-to-end, closed
   around the offshore side of the frame. OSM coastline runs with the water on the
   LEFT looking along the way? No: OSM convention is land on the left, water on the
   right — the chain here runs north->south along an east-facing shore. Verified
   below by checking that the closed ring contains a point known to be offshore. */
function seaRing() {
  const chains = osm.coastline.map(c => c.line.map(p => p.slice()));
  /* merge chains whose ends meet (within 2 m) */
  let merged = chains.shift();
  let guard = 40;
  while (chains.length && guard--) {
    const tail = merged[merged.length - 1], head = merged[0];
    let done = false;
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i];
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d(tail, c[0]) < 2) { merged = merged.concat(c.slice(1)); chains.splice(i, 1); done = true; break; }
      if (d(tail, c[c.length - 1]) < 2) { merged = merged.concat(c.slice(0, -1).reverse()); chains.splice(i, 1); done = true; break; }
      if (d(head, c[c.length - 1]) < 2) { merged = c.slice(0, -1).concat(merged); chains.splice(i, 1); done = true; break; }
      if (d(head, c[0]) < 2) { merged = c.slice(1).reverse().concat(merged); chains.splice(i, 1); done = true; break; }
    }
    if (!done) break;
  }
  if (chains.length) console.log(`  seaRing: ${chains.length} coastline chain(s) did not connect — closed without them`);
  /* close offshore: walk from the last coast vertex out east, around, and back */
  const E = 2600;                                   // beyond the HF0 edge
  const a = merged[0], b = merged[merged.length - 1];
  const ring = merged.concat([[E, b[1]], [E, a[1]]]);
  /* which side is the water: the point 300 m due east of the chain's midpoint must
     be inside; if not, the ring is wound the other way and closes over land */
  const mid = merged[Math.floor(merged.length / 2)];
  const probe = [mid[0] + 300, mid[1]];
  if (!pointInPoly(probe[0], probe[1], ring))
    throw new Error('seaRing: offshore probe not inside the closed ring — coastline direction assumption is wrong');
  return ring1(ring);
}
const SEA = seaRing();
water.unshift({ id: 'sea', ring: SEA, name: 'Bottenhavet', area: Math.round(Math.abs(polyArea(SEA))),
                level: hf.seaLevel, isLake: true, isSea: true });

/* --- the model ---------------------------------------------------------------- */
const model = {
  version: 1,
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  mPerLat: M_PER_LAT, mPerLon: Math.round(M_PER_LON * 100) / 100,
  frame: 'local metres about ORIGIN; north -z, east +x',
  seaLevel: hf.seaLevel,
  card: { teeNames: card.teeNames, slope: card.slope, ratingDate: card.ratingDate },
  holes,
  water,
  streams: osm.waterway.map(w => ({ id: w.id, line: w.line, kind: w.kind, w: w.kind === 'stream' ? 1.6 : 1.0 })),
  coast: {
    chains: osm.coastline.map(c => ({ id: c.id, line: c.line })),
    beaches: osm.sand.map(s => ({ id: s.id, ring: s.ring, name: s.name || null })),
  },
  vegetation: {
    forest: [], wood: [], scrub: [],
    wetland: osm.wetland.map(w => w.ring),
    /* the shore beaches paint through the same sand channel the page already has */
    sand: osm.sand.map(s => s.ring),
    rock: [],
  },
  infra: {
    paths: osm.paths, tracks: osm.tracks, roads: osm.roads,
    buildings: osm.buildings, farB: osm.farBuildings,
    parking: osm.parking, piers: osm.piers, basins: osm.basins,
    pitches: osm.pitches, landuse: osm.landuse, reserves: osm.reserves,
    /* keys the page dereferences that this cape simply has none of */
    power: { lines: [], towers: [], poles: [] }, railway: [],
  },
  pois: osm.pois,
  /* same shape as the Veckefjärden model: plain ring arrays per class, so the
     page's spatial index and planter code read it unchanged */
  scenery: (() => {
    const sc = traces.scenery || {};
    const circle = (cx, cz, r) => Array.from({ length: 10 },
      (_, i) => [r1(cx + Math.cos(i / 10 * 2 * Math.PI) * r), r1(cz + Math.sin(i / 10 * 2 * Math.PI) * r)]);
    return {
      greens: [...(sc.greens || []).map(g => g.ring),
               ...(sc.rangeTargets || []).filter(t => t.kind !== 'frame').map(t => circle(t.cx, t.cz, t.r))],
      fairways: (sc.fairways || []).map(f => f.ring || f),
      tees: sc.rangeTee ? [(() => {
        const [a, b] = sc.rangeTee.line;
        const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
        const nx = -dz / L * 3, nz = dx / L * 3;
        return [[r1(a[0] - nx), r1(a[1] - nz)], [r1(b[0] - nx), r1(b[1] - nz)],
                [r1(b[0] + nx), r1(b[1] + nz)], [r1(a[0] + nx), r1(a[1] + nz)]];
      })()] : [],
      bunkers: (sc.bunkers || []).map(b => b.ring || b),
      grass: (sc.grass || []).map(g => g.ring || g),
      range: (sc.range || []).map(r => r.ring || r),
    };
  })(),
};

writeJSON(path.join(HERE, 'course-model.json'), model);

/* --- the agreement report ----------------------------------------------------- */
console.log('hole par  card  drawn   dev%  slide  padD  green m²  gc-in  conf');
for (const r of report) {
  const bad = r.lenDev > 0.5 || !r.gcInRing;
  console.log(`${String(r.n).padStart(4)}  ${r.par}  ${String(r.card).padStart(4)}  ${String(r.lineLen).padStart(6)}  ${String(r.lenDev).padStart(5)}  ${String(r.slide).padStart(5)}  ${r.teePadDist == null ? '   —' : String(Math.round(r.teePadDist)).padStart(4)}  ${String(r.area).padStart(8)}  ${r.gcInRing ? '  yes' : '   NO'}  ${r.conf}${bad ? '   <-- CHECK' : ''}`);
}
const devs = report.map(r => r.lenDev);
console.log(`\nlength dev: max ${Math.max(...devs).toFixed(2)}%  (gate 0.5%)`);
console.log(`green areas: ${Math.min(...report.map(r => r.area))}..${Math.max(...report.map(r => r.area))} m²`);
console.log(`water: ${water.length} features (${water.filter(w => w.isLake).length} OSM)`);
const under = holes.filter(h => h.elev.green < hf.seaLevel + 0.5 || h.elev.tee < hf.seaLevel + 0.5);
if (under.length) console.log(`UNDER-WATER WARNING: holes ${under.map(h => h.n).join(',')}`);
console.log(`\nhole  tee m  green m  rise`);
for (const h of holes)
  console.log(`${String(h.n).padStart(4)}  ${h.elev.tee.toFixed(1).padStart(5)}  ${h.elev.green.toFixed(1).padStart(6)}  ${(h.elev.rise >= 0 ? '+' : '') + h.elev.rise.toFixed(1)}`);
console.log(`\nwrote nvgkbuild/course-model.json (${(fs.statSync(path.join(HERE, 'course-model.json')).size / 1024).toFixed(0)} KB)`);
