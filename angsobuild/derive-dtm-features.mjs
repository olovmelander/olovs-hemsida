/* Read Ängsö off the laser terrain and the orthoimagery: the imagery's own
   registration against the laser, bunkers as sand over a dish, the ditches
   that cross a playing line, and the flat decks under the card's tee marks.

   Both sources are orthorectified, but "orthorectified" is not "registered":
   Johannesberg's satellite traces sat 2-4 m off their laser features and
   angsobuild/terrain-check.mjs found the same here -- every satellite-traced
   bunker that is a real pit wants the same shift, about 1 m east and 4-5 m
   south, while the surveyed OSM bunkers sit within a metre of theirs. So the
   FIRST thing measured is the offset of the imagery against the laser, from
   the sand patches themselves: each patch's hull is slid over +/-8 m and the
   shift that deepens its dish most is kept; the median over the patches with
   a clear dish is the capture's registration error, and every reading from
   that capture is corrected by it before it is believed. The surveyed OSM
   bunkers never enter the measurement and are the check on it.

   A BUNKER is then sand in the corrected imagery over a dish in the DTM (rim
   2-6 m minus inside), its outline the hull of the sand pixels. A DITCH is a
   linear valley the directional valley filter scores >= 0.4 where it crosses
   a playing line, traced by least-cost path on the black top-hat -- checked
   against the ten already traced from the laser (laser-streams.json). A DECK
   is a 5 x 5 m plateau (spread < 0.10 m) under a card tee mark no pad covers.

   Needs the imagery cache (fetched here; angsobuild/dtm.mjs says where) and
   Chromium for the JPEGs.  node angsobuild/derive-dtm-features.mjs [--release 27982]
   Writes angsobuild/dtm-features.json, which reconcile.mjs folds in.        */
import path from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';
import { loadTerrain, imagery, BOX } from './dtm.mjs';
import { blackTopHat, inRing, bboxOf, lineD, ringD, median, quant, areaOf, meanPt, hull, simplify } from '../geobuild/dtm-lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const RELEASE = argv.includes('--release') ? +argv[argv.indexOf('--release') + 1] : null;
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(HERE, 'dtm-features.json');
const m = readJSON(path.join(HERE, 'course-model.json'));
const shapes = readJSON(path.join(HERE, 'sat-shapes.json'));
const T = loadTerrain();
const { hAt } = T;
const I = imagery(RELEASE);
console.log(`terrain: ${T.tiles} tiles, ${T.W}x${T.H} at 1 m; imagery ${RELEASE ? `Wayback release ${RELEASE}` : 'live mosaic'}:`, await I.ensureImagery(BOX.x0, BOX.z0, BOX.x1, BOX.z1), `${I.metresPerPixel.toFixed(3)} m/px`);

/* ---------------------------------------------------------------- sand pixels */
/* The rule is CALIBRATED ON THIS CAPTURE, never hardcoded. Two single-capture
   frames cover this course -- 2025-04-13 Vantor at 0.34 m and 2018-10-25 Maxar
   at 0.5 m (tools/wayback-captures.mjs -> imagery-captures.json) -- and they
   share neither a colour scale nor a season, so a threshold read off one is
   meaningless on the other. The surveyed OSM bunkers supply the sand
   population and the greens and fairways the turf population; the cut goes
   between them on two axes that separate a mineral from a plant: red minus
   green (sand is near-neutral, turf never is) and brightness. */
function sample(rings, step = 0.4) {
  const out = [];
  for (const ring of rings) { const b = bboxOf(ring); for (let z = b.z0; z <= b.z1; z += step) for (let x = b.x0; x <= b.x1; x += step) { if (!inRing(x, z, ring)) continue; const c = I.rgbAt(x, z); if (c) out.push(c); } }
  return out;
}
const osmRings = m.holes.flatMap(h => h.bunkers.filter(b => b.prov === 'osm').map(b => b.ring));
const turfRings = m.holes.flatMap(h => [h.green.ring, ...h.fairway.rings]);
const sandPx = sample(osmRings), turfPx = sample(turfRings);
const rg = c => c[0] - c[1], bright = c => (c[0] + c[1] + c[2]) / 3;
const CAL = {
  n: { sand: sandPx.length, turf: turfPx.length, surveyedBunkers: osmRings.length },
  sandRG: [quant(sandPx.map(rg), 0.1), median(sandPx.map(rg)), quant(sandPx.map(rg), 0.9)].map(v => +v.toFixed(1)),
  turfRG: [quant(turfPx.map(rg), 0.1), median(turfPx.map(rg)), quant(turfPx.map(rg), 0.9)].map(v => +v.toFixed(1)),
  sandBright: [quant(sandPx.map(bright), 0.1), median(sandPx.map(bright)), quant(sandPx.map(bright), 0.9)].map(v => +v.toFixed(1)),
  turfBright: [quant(turfPx.map(bright), 0.1), median(turfPx.map(bright)), quant(turfPx.map(bright), 0.9)].map(v => +v.toFixed(1)),
};
/* the cut is the midpoint between turf's 90th percentile and sand's 25th, and
   never below turf's 90th: over-detection costs a false patch that the dish
   test then has to reject, under-detection loses a real bunker outright */
const cut = (t90, s25) => +(Math.max(t90, (t90 + s25) / 2)).toFixed(1);
CAL.rgCut = cut(quant(turfPx.map(rg), 0.9), quant(sandPx.map(rg), 0.25));
CAL.brightCut = cut(quant(turfPx.map(bright), 0.9), quant(sandPx.map(bright), 0.25));
console.log('sand calibration on ' + CAL.n.sand + ' px inside ' + osmRings.length + ' surveyed bunkers vs ' + CAL.n.turf + ' px of mown turf:');
console.log('  R-G   turf ' + CAL.turfRG + '  sand ' + CAL.sandRG + '  -> cut ' + CAL.rgCut);
console.log('  bright turf ' + CAL.turfBright + '  sand ' + CAL.sandBright + '  -> cut ' + CAL.brightCut);
const sandy = c => c && rg(c) >= CAL.rgCut && bright(c) >= CAL.brightCut;
const STEP = 0.5;
const NX = Math.round((BOX.x1 - BOX.x0) / STEP), NZ = Math.round((BOX.z1 - BOX.z0) / STEP);
const rangeRing = Array.isArray(m.scenery.range) ? m.scenery.range : m.scenery.range?.ring;
const built = [...m.infra.buildings.map(b => b.ring), ...(m.infra.parking || []).map(p => p.ring), ...(rangeRing ? [rangeRing] : [])].filter(Boolean);
const lines = [...(m.infra.roads || []), ...(m.infra.tracks || []), ...(m.infra.paths || [])].map(p => p.line);
const nearPlay = (x, z) => m.holes.some(h => lineD(x, z, h.line) < 70);
const mask = new Uint8Array(NX * NZ);
for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) { const x = BOX.x0 + c * STEP, z = BOX.z0 + r * STEP; if (sandy(I.rgbAt(x, z)) && nearPlay(x, z)) mask[r * NX + c] = 1; }
const lab = new Int32Array(NX * NZ).fill(-1); const comps = [];
for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) {
  if (!mask[r * NX + c] || lab[r * NX + c] >= 0) continue;
  const id = comps.length, cells = [], st = [r * NX + c]; lab[r * NX + c] = id;
  while (st.length) { const i = st.pop(); cells.push(i); const cy = (i / NX) | 0, cx = i % NX; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = cy + dy, xx = cx + dx; if (yy < 0 || xx < 0 || yy >= NZ || xx >= NX) continue; const j = yy * NX + xx; if (mask[j] && lab[j] < 0) { lab[j] = id; st.push(j); } } }
  comps.push(cells);
}
/* rim (2-6 m outside) minus inside, the ring shifted by (sx, sz) */
function dish(ring, sx = 0, sz = 0) {
  const R = sx || sz ? ring.map(p => [p[0] + sx, p[1] + sz]) : ring;
  const b = bboxOf(R); const inside = [], band = [];
  for (let z = b.z0 - 6; z <= b.z1 + 6; z += 0.5) for (let x = b.x0 - 6; x <= b.x1 + 6; x += 0.5) {
    const h = hAt(x, z); if (!Number.isFinite(h)) continue;
    if (inRing(x, z, R)) inside.push(h); else { const d = ringD(x, z, R); if (d > 2 && d < 6) band.push(h); }
  }
  return inside.length < 8 ? NaN : +(median(band) - median(inside)).toFixed(2);
}
const patches = [];
for (const cells of comps) {
  const a = cells.length * STEP * STEP; if (a < 8 || a > 700) continue;
  const ring = hull(cells.map(i => [BOX.x0 + (i % NX) * STEP, BOX.z0 + ((i / NX) | 0) * STEP])).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  const c = meanPt(ring);
  if (built.some(r => inRing(c[0], c[1], r))) continue;
  let ld = 1e9; for (const L of lines) ld = Math.min(ld, lineD(c[0], c[1], L)); if (ld < 3) continue;
  patches.push({ ring, c, area: Math.round(areaOf(ring)) });
}
console.log(`sand patches near play: ${patches.length} (${comps.length} components)`);

/* ------------------------------------------------ the imagery's registration */
/* for every patch big enough to hold a dish, the shift of the hull (1 m steps,
   +/-8 m) that deepens the dish most; a patch whose best is at the window's edge
   or shallower than 0.2 m says nothing and is left out of the median */
/* the shift search runs 289 positions per patch, so it uses a CHEAP dish --
   an interior disc against a rim annulus, both on fixed sample rings about the
   patch centroid -- and the full hull-based dish() is kept for the handful of
   candidates that survive. The two agree to a few centimetres on the surveyed
   bunkers, which is all a shift search needs. */
const RING8 = Array.from({ length: 12 }, (_, k) => [Math.cos(k * Math.PI / 6), Math.sin(k * Math.PI / 6)]);
function dishAt(cx, cz, rad) {
  const ins = [], rim = [];
  ins.push(hAt(cx, cz));
  for (const [ux, uy] of RING8) { const h = hAt(cx + ux * rad * 0.55, cz + uy * rad * 0.55); if (Number.isFinite(h)) ins.push(h); }
  for (const [ux, uy] of RING8) for (const f of [rad + 2.5, rad + 4.5]) { const h = hAt(cx + ux * f, cz + uy * f); if (Number.isFinite(h)) rim.push(h); }
  return ins.length < 6 || rim.length < 8 ? NaN : median(rim) - median(ins);
}
const reg = [];
for (const p of patches) {
  if (p.area < 15) continue;
  const rad = Math.sqrt(p.area / Math.PI);
  let best = { d: -Infinity, sx: 0, sz: 0 };
  for (let sx = -8; sx <= 8; sx++) for (let sz = -8; sz <= 8; sz++) { const d = dishAt(p.c[0] + sx, p.c[1] + sz, rad); if (d > best.d) best = { d, sx, sz }; }
  p.best = best;
  if (best.d >= 0.2 && Math.abs(best.sx) < 8 && Math.abs(best.sz) < 8) reg.push(best);
}
const OFF = { x: median(reg.map(r => r.sx)), z: median(reg.map(r => r.sz)), n: reg.length, of: patches.filter(p => p.area >= 15).length,
  spread: { x: [quant(reg.map(r => r.sx), 0.25), quant(reg.map(r => r.sx), 0.75)], z: [quant(reg.map(r => r.sz), 0.25), quant(reg.map(r => r.sz), 0.75)] } };
console.log(`imagery -> laser offset: (${OFF.x}, ${OFF.z}) m from ${OFF.n} of ${OFF.of} dished patches; quartiles x ${OFF.spread.x} z ${OFF.spread.z}`);
/* the fine offset, on the same patches, at 0.5 m about the coarse one */
let fine = { d: -Infinity, x: OFF.x, z: OFF.z };
const fineSet = patches.filter(p => p.best && p.best.d >= 0.2);
for (let sx = OFF.x - 2; sx <= OFF.x + 2; sx += 0.5) for (let sz = OFF.z - 2; sz <= OFF.z + 2; sz += 0.5) { let s = 0; for (const p of fineSet) s += dishAt(p.c[0] + sx, p.c[1] + sz, Math.sqrt(p.area / Math.PI)); if (s > fine.d) fine = { d: s, x: sx, z: sz }; }
OFF.x = fine.x; OFF.z = fine.z;
/* --offset x,z overrides the measurement; the OSM check below is what says
   whether an offset helps at all, and it is run both ways before one is kept */
if (argv.includes("--offset")) { const [ox, oz] = argv[argv.indexOf("--offset") + 1].split(",").map(Number); OFF.x = ox; OFF.z = oz; OFF.forced = true; console.log(`  FORCED to (${ox}, ${oz})`); }
console.log(`  refined at 0.5 m: (${OFF.x}, ${OFF.z}) m -- every sand patch below is moved by this before it is read against the terrain`);
const shifted = ring => ring.map(p => [+(p[0] + OFF.x).toFixed(1), +(p[1] + OFF.z).toFixed(1)]);

/* ------------------------------------------------------------------ bunkers */
const scen = (m.scenery.greens || []).map(r => ({ ring: r.ring || r, c: meanPt(r.ring || r) }));
const cands = [];
for (const p of patches) {
  const ring = shifted(p.ring), c = meanPt(ring), dep = dish(ring);
  if (!(dep >= 0.12 || (dep >= 0.07 && p.area >= 30))) { p.refused = `dish ${dep}`; continue; }
  let hn = 0, hd = 1e9; for (const h of m.holes) { const d = lineD(c[0], c[1], h.line); if (d < hd) { hd = d; hn = h.n; } }
  let sd = 1e9; for (const s of scen) sd = Math.min(sd, Math.hypot(s.c[0] - c[0], s.c[1] - c[1]));
  cands.push({ ring, c: c.map(v => +v.toFixed(1)), area: p.area, dish: dep, hole: hn, holeDist: Math.round(hd), scenery: sd < 30 && sd < hd });
}
console.log(`sand-over-dish candidates: ${cands.length}`);

/* every bunker of the model: an OSM one is surveyed and stays, the candidate
   beside it is the CHECK; a satellite-traced one is replaced by the measured
   hull, or, with no sand within reach, kept if its laser dish confirms it and
   dropped if nothing does */
const bunkers = [], used = new Set(), log = [], osmCheck = [];
for (const h of m.holes) {
  for (const [bi, b] of h.bunkers.entries()) {
    const bc = meanPt(b.ring);
    let best = null, bd = 1e9;
    for (const [k, c] of cands.entries()) { if (used.has(k) || c.scenery) continue; const d = Math.hypot(c.c[0] - bc[0], c.c[1] - bc[1]); if (d < bd) { bd = d; best = k; } }
    if (b.prov === 'osm') {
      const dep = dish(b.ring);
      if (best !== null && bd <= 12) { used.add(best); osmCheck.push({ hole: h.n, dist: +bd.toFixed(1), dish: dep, candDish: cands[best].dish }); log.push(`hole ${h.n} OSM bunker ${bi} kept; the sand-over-dish reading lands ${bd.toFixed(1)} m from it (dish ${dep} / ${cands[best].dish})`); }
      else { osmCheck.push({ hole: h.n, dist: null, dish: dep }); log.push(`hole ${h.n} OSM bunker ${bi} kept; no sand patch within 12 m (nearest ${bd.toFixed(0)} m), laser dish ${dep}`); }
      bunkers.push({ hole: h.n, ring: b.ring, c: bc.map(v => +v.toFixed(1)), area: Math.round(areaOf(b.ring)), dish: dep, src: 'osm', replaces: null });
      continue;
    }
    if (best !== null && bd <= 16) {
      used.add(best); const c = cands[best];
      bunkers.push({ hole: h.n, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'sat+dtm', replaces: 'sat', moved: +bd.toFixed(1) });
      log.push(`hole ${h.n} sat bunker ${bi} at (${bc.map(v => v.toFixed(0))}) -> measured (${c.c}) ${bd.toFixed(1)} m, ${c.area} m², dish ${c.dish}`);
    } else {
      const sr = shifted(b.ring), dep = dish(sr);
      if (dep >= 0.15) { bunkers.push({ hole: h.n, ring: sr, c: meanPt(sr).map(v => +v.toFixed(1)), area: Math.round(areaOf(sr)), dish: dep, src: 'trace+dtm', replaces: 'sat', note: 'no sand read in the imagery; the trace, moved by the measured offset, sits over a laser dish' }); log.push(`hole ${h.n} sat bunker ${bi}: no sand within 16 m (nearest ${bd.toFixed(0)} m) but a ${dep} m dish under the shifted trace: kept as trace+dtm`); }
      else log.push(`hole ${h.n} sat bunker ${bi} at (${bc.map(v => v.toFixed(0))}): no sand within 16 m (nearest ${bd.toFixed(0)} m) and no dish (${dep}): DROPPED`);
    }
  }
}
/* an unmatched candidate becomes a bunker only on a strong dish beside a hole,
   never on a tee, a green or a practice green */
const extras = [...cands.entries()].filter(([k, c]) => !used.has(k) && !c.scenery && c.holeDist <= 35 && c.dish >= 0.25 && c.area >= 12 && c.area <= 250).sort((a, b) => b[1].dish - a[1].dish);
for (const [k, c] of extras) {
  if (bunkers.some(b => Math.hypot(b.c[0] - c.c[0], b.c[1] - c.c[1]) < 10)) continue;
  const h = m.holes[c.hole - 1];
  if (h.tees.pads.some(p => Math.hypot(p.cx - c.c[0], p.cz - c.c[1]) < 14) || h.tees.marks.some(p => Math.hypot(p.c[0] - c.c[0], p.c[1] - c.c[1]) < 14)) continue;
  if (m.holes.some(g => inRing(c.c[0], c.c[1], g.green.ring) || ringD(c.c[0], c.c[1], g.green.ring) < 3 && !inRing(c.c[0], c.c[1], g.green.ring) && false)) continue;
  used.add(k);
  bunkers.push({ hole: c.hole, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'sat+dtm', replaces: null, note: 'not in the trace; sand in the imagery over a dish in the laser' });
  log.push(`hole ${c.hole} EXTRA bunker at (${c.c}) ${c.area} m² dish ${c.dish}, ${c.holeDist} m from the line`);
}
console.log(log.join('\n'));
const oc = osmCheck.filter(o => o.dist != null);
console.log(`OSM check: ${oc.length} of ${osmCheck.length} surveyed bunkers have a sand-over-dish reading beside them, median ${median(oc.map(o => o.dist))} m, max ${Math.max(...oc.map(o => o.dist))} m`);

/* ------------------------------------------------------------------ ditches */
const th = blackTopHat(T, 6);
const thAt = (x, z) => { const [e, n] = T.legacyToGrid(x, z); const c = Math.round(e - T.E0), r = Math.round(T.N1 - n); return (c < 0 || r < 0 || c >= T.W || r >= T.H) ? 0 : th[r * T.W + c]; };
const dirs = []; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 8; dirs.push([Math.cos(a), Math.sin(a)]); }
function valley(x, z) {
  const h = hAt(x, z); let best = 0, dir = null;
  for (const [ux, uy] of dirs) {
    const nx = -uy, ny = ux;
    const across = Math.min(Math.max(hAt(x + nx * 3, z + ny * 3), hAt(x + nx * 5, z + ny * 5)), Math.max(hAt(x - nx * 3, z - ny * 3), hAt(x - nx * 5, z - ny * 5))) - h;
    const along = Math.max(Math.abs(hAt(x + ux * 4, z + uy * 4) - h), Math.abs(hAt(x - ux * 4, z - uy * 4) - h));
    const s = across - 0.8 * along;
    if (s > best) { best = s; dir = [ux, uy]; }
  }
  return { s: best, dir };
}
function snap(a, b) {
  const { W, H, E0, N1 } = T;
  const [ea, na] = T.legacyToGrid(a[0], a[1]), [eb, nb] = T.legacyToGrid(b[0], b[1]);
  const ca = Math.round(ea - E0), ra = Math.round(N1 - na), cb = Math.round(eb - E0), rb = Math.round(N1 - nb);
  const x0 = Math.max(0, Math.min(ca, cb) - 60), x1 = Math.min(W - 1, Math.max(ca, cb) + 60), y0 = Math.max(0, Math.min(ra, rb) - 60), y1 = Math.min(H - 1, Math.max(ra, rb) + 60);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const dist = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  const cost = i => 1 / (0.04 + Math.min(1.2, th[(y0 + ((i / w) | 0)) * W + x0 + (i % w)]));
  const s = (ra - y0) * w + (ca - x0), t = (rb - y0) * w + (cb - x0);
  dist[s] = 0; const heap = [[0, s]];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let mm = k; if (l < heap.length && heap[l][0] < heap[mm][0]) mm = l; if (r < heap.length && heap[r][0] < heap[mm][0]) mm = r; if (mm === k) break; [heap[mm], heap[k]] = [heap[k], heap[mm]]; k = mm; } } return top; };
  while (heap.length) { const [d, i] = pop(); if (d > dist[i]) continue; if (i === t) break; const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; const nd = d + Math.hypot(dx, dy) * (cost(i) + cost(j)) / 2; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); } } }
  const pts = []; for (let i = t; i >= 0; i = prev[i]) { pts.push(T.gridToLegacy(E0 + x0 + (i % w), N1 - (y0 + ((i / w) | 0)))); if (i === s) break; }
  pts.reverse();
  let mean = 0; for (const p of pts) mean += thAt(p[0], p[1]); mean /= pts.length;
  return { pts, line: simplify(pts, 0.8).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]), meanDepth: +mean.toFixed(2) };
}
const inWater = (x, z) => m.water.some(w => inRing(x, z, w.ring));
const ditches = [], crossings = [];
const nearStream = line => m.streams.some(st => line.reduce((a, p) => a + lineD(p[0], p[1], st.line), 0) / line.length < 12) || ditches.some(d => line.reduce((a, p) => a + lineD(p[0], p[1], d.line), 0) / line.length < 10);
for (const h of m.holes) {
  const L = h.line; let total = 0; const segs = []; for (let i = 0; i < L.length - 1; i++) { const d = Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); segs.push(d); total += d; }
  const at = s => { let acc = 0; for (let i = 0; i < segs.length; i++) { if (s <= acc + segs[i]) { const t = (s - acc) / segs[i]; return [L[i][0] + (L[i + 1][0] - L[i][0]) * t, L[i][1] + (L[i + 1][1] - L[i][1]) * t, i]; } acc += segs[i]; } return [L[L.length - 1][0], L[L.length - 1][1], segs.length - 1]; };
  const prof = [];
  for (let s = 8; s < total - 8; s += 1) { const [x, z, i] = at(s); const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1], l = Math.hypot(dx, dz); const nx = -dz / l, nz = dx / l; let best = 0, bv = null; for (const o of [-8, -4, 0, 4, 8]) { const v = valley(x + nx * o, z + nz * o); if (v.s > best) { best = v.s; bv = { x: x + nx * o, z: z + nz * o, dir: v.dir }; } } prof.push({ s, toGreen: Math.round(total - s), score: best, p: bv }); }
  for (let i = 2; i < prof.length - 2; i++) {
    const p = prof[i];
    if (p.score < 0.15 || prof.slice(Math.max(0, i - 12), i + 13).some(q => q.score > p.score)) continue;
    if (inWater(p.p.x, p.p.z)) continue;
    let sd = 1e9; for (const st of m.streams) sd = Math.min(sd, lineD(p.p.x, p.p.z, st.line));
    crossings.push({ hole: h.n, toGreen: p.toGreen, score: +p.score.toFixed(2), at: [+p.p.x.toFixed(1), +p.p.z.toFixed(1)], knownStreamDist: +sd.toFixed(1) });
    if (sd < 12) continue;                                            /* the model has it */
    if (p.score < 0.4) continue;
    if (Math.hypot(p.p.x - L[0][0], p.p.z - L[0][1]) < 30 || p.toGreen < 25) continue;
    if (h.tees.pads.some(q => Math.hypot(q.cx - p.p.x, q.cz - p.p.z) < 10)) continue;
    const d = p.p.dir;
    const s = snap([p.p.x + d[0] * 45, p.p.z + d[1] * 45], [p.p.x - d[0] * 45, p.p.z - d[1] * 45]);
    const dense = s.pts;
    let ci = 0, cd = 1e9; dense.forEach((q, k) => { const dd = Math.hypot(q[0] - p.p.x, q[1] - p.p.z); if (dd < cd) { cd = dd; ci = k; } });
    const ok = dense.map(q => thAt(q[0], q[1]) >= 0.10);
    let lo = ci, hi = ci, gap = 0;
    while (lo > 0) { if (ok[lo - 1]) { gap = 0; lo--; } else if (gap < 6) { gap++; lo--; } else break; } while (!ok[lo] && lo < ci) lo++;
    gap = 0; while (hi < dense.length - 1) { if (ok[hi + 1]) { gap = 0; hi++; } else if (gap < 6) { gap++; hi++; } else break; } while (!ok[hi] && hi > ci) hi--;
    const run = dense.slice(lo, hi + 1);
    if (run.length < 40) continue;
    let mean = 0; for (const q of run) mean += thAt(q[0], q[1]); mean /= run.length;
    if (mean < 0.3) continue;
    const line = simplify(run, 0.8).map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]);
    if (nearStream(line)) continue;
    ditches.push({ hole: h.n, line, kind: 'ditch', meanDepth: +mean.toFixed(2), crossesAt: p.toGreen, src: 'dtm', note: `crosses the playing line ${p.toGreen} m from the green (valley score ${p.score.toFixed(2)})` });
  }
}
console.log(`valley crossings scored >= 0.15 on the playing lines: ${crossings.length}; already in the model (within 12 m of a stream): ${crossings.filter(c => c.knownStreamDist < 12).length}; new ditches adopted: ${ditches.length}`);
for (const c of crossings.filter(c => c.knownStreamDist >= 12 && c.score >= 0.3)) console.log(`  hole ${c.hole} ${c.toGreen} m to green score ${c.score} at (${c.at}) -- nearest known stream ${c.knownStreamDist} m`);
for (const d of ditches) console.log(`  adopted hole ${d.hole} ${d.crossesAt} m to green depth ${d.meanDepth} (${d.line[0]})->(${d.line.at(-1)})`);

/* -------------------------------------------------------------------- decks */
function decks(cx, cz, R) {
  const cells = new Map();
  for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) { const hs = []; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) hs.push(hAt(x + dx, z + dz)); if (quant(hs, 0.9) - quant(hs, 0.1) < 0.10) cells.set(`${x},${z}`, [x, z]); }
  const seen = new Set(), out = [];
  for (const [k] of cells) { if (seen.has(k)) continue; const comp = [], st = [k]; seen.add(k); while (st.length) { const kk = st.pop(); const c = cells.get(kk); comp.push(c); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${c[0] + dx},${c[1] + dz}`; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } } if (comp.length >= 30) { const ring = hull(comp); out.push({ n: comp.length, ring, c: meanPt(ring) }); } }
  return out;
}
const deckOut = [], padCheck = [];
for (const h of m.holes) {
  for (const p of h.tees.pads) {
    const pc = [p.cx, p.cz];
    const cand = decks(pc[0], pc[1], 16).filter(d => inRing(pc[0], pc[1], d.ring) || Math.hypot(d.c[0] - pc[0], d.c[1] - pc[1]) < 9).sort((a, b) => b.n - a.n);
    padCheck.push({ hole: h.n, pad: pc, deck: cand.length ? cand[0].c.map(v => +v.toFixed(1)) : null, deckArea: cand.length ? Math.round(areaOf(cand[0].ring)) : null, offsetToDeck: cand.length ? [+(cand[0].c[0] - pc[0]).toFixed(1), +(cand[0].c[1] - pc[1]).toFixed(1)] : null });
  }
  for (const [mi, mk] of h.tees.marks.entries()) {
    if (h.tees.pads.some(p => inRing(mk.c[0], mk.c[1], p.ring) || Math.hypot(p.cx - mk.c[0], p.cz - mk.c[1]) < 8)) continue;
    const cand = decks(mk.c[0], mk.c[1], 20).filter(d => inRing(mk.c[0], mk.c[1], d.ring) || Math.hypot(d.c[0] - mk.c[0], d.c[1] - mk.c[1]) < 9).sort((a, b) => b.n - a.n);
    if (!cand.length || areaOf(cand[0].ring) > 400) continue;
    const ring = cand[0].ring.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]);
    deckOut.push({ hole: h.n, markIdx: mi, ring, c: cand[0].c.map(v => +v.toFixed(1)), area: Math.round(areaOf(ring)), src: 'dtm' });
  }
}
const pc = padCheck.filter(p => p.deck);
console.log(`decks: ${deckOut.length} new under card marks with no pad; ${pc.length} of ${padCheck.length} traced pads have a laser deck beside them, median offset (${median(pc.map(p => p.offsetToDeck[0]))}, ${median(pc.map(p => p.offsetToDeck[1]))}) m`);

writeJSON(OUT, {
  source: `Derived from Lantmäteriet's 1 m Markhöjdmodell as published in apps/golf/public/grounds/angso (256 level-0 tiles, RH 2000, sampled through legacyGridBridge) and Esri World Imagery z18 (${RELEASE ? `Wayback release ${RELEASE}` : 'the live mosaic'}, ${I.metresPerPixel.toFixed(3)} m/px) by angsobuild/derive-dtm-features.mjs. The imagery's registration against the laser is MEASURED first (the shift that deepens the sand patches' dishes most, medianed) and every reading is corrected by it. A bunker is sand in the corrected imagery over a dish in the DTM (rim 2-6 m minus inside >= 0.12 m); its outline is the hull of the sand pixels. The surveyed OSM bunkers never enter the measurement and are the check. A ditch is a linear valley crossing a playing line (valley score >= 0.4, mean black-top-hat depth >= 0.3 m) the laser-streams tracing had not; a deck is a flat plateau (5x5 m spread < 0.10 m) under a card tee mark no pad covers.`,
  imagery: { release: RELEASE, metresPerPixel: +I.metresPerPixel.toFixed(4), offset: OFF, calibration: CAL, note: 'add (offset.x, offset.z) to any coordinate read off this capture to land it on the laser terrain; the satellite traces of sat-shapes.json were read off the live mosaic (the 2025-04-13 Vantor capture since the 2025-10-23 release)' },
  osmCheck, bunkers, ditches, crossings, decks: deckOut, padCheck,
});
console.log(`wrote ${OUT}`);
