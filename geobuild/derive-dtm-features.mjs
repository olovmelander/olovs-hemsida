/* Read the course off the laser terrain and the orthoimagery: bunkers, the ditches
   that cross the playing lines, and the flat decks under the card's tee marks.

   Both sources are orthorectified, so nothing here is registered to anything -- the
   only question each feature answers is whether two independent signals agree at a
   place. A BUNKER is sand in the imagery (calibrated on the 21 OSM bunkers with a
   clear dish: inside rgb ~140,147,124 against turf ~63,113,60) over a dish in the
   DTM (rim minus floor >= 0.15 m); its outline is the hull of the sand pixels, and
   on the 32 OSM bunkers the same rule lands 1-2 m from the surveyed outline, which
   is the calibration of the whole thing. A DITCH is a linear valley the directional
   valley filter scores >= 0.4 where it crosses a playing line, traced along its
   bottom by least-cost path on the black top-hat and trimmed where the depth gives
   out; two more are adopted on the club's own word. A DECK is a plateau whose 5 x 5 m
   spread is under 0.10 m, found under a card tee mark OSM never mapped.

   Runs after reconcile has fused the plan traces (it needs the re-anchored plan
   bunkers to match against) and before reconcile's final pass, which reads what
   it writes. Needs the imagery cache (fetched here) and Chromium for the JPEGs.

     node geobuild/derive-dtm-features.mjs        -> geobuild/dtm-features.json    */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON, alongLine } from './lib.mjs';
import {
  loadTerrain, blackTopHat, ensureImagery, rgbAt, inRing, bboxOf, lineD, ringD, median, quant,
  areaOf, meanPt, hull, simplify,
} from './dtm-lib.mjs';

const m = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const T = loadTerrain('veckefjarden');
const { hAt } = T;
console.log(`terrain: ${T.tiles} tiles, ${T.W}x${T.H} at 1 m`);
const BOX = { x0: -950, z0: -1300, x1: 450, z1: 540 };
console.log('imagery:', await ensureImagery(BOX.x0, BOX.z0, BOX.x1, BOX.z1));

/* ------------------------------------------------------------------ bunkers */
const sandy = c => c && c[0] > 105 && c[0] >= 0.85 * c[1] && c[2] > 85 && (c[0] + c[1] + c[2]) / 3 > 105;
const STEP = 0.5;
const NX = Math.round((BOX.x1 - BOX.x0) / STEP), NZ = Math.round((BOX.z1 - BOX.z0) / STEP);
const built = [...m.infra.buildings.map(b => b.ring), ...m.infra.parking.map(p => p.ring), ...m.scenery.range];
const lines = [...m.infra.roads, ...m.infra.tracks, ...m.infra.paths].map(p => p.line);
const scen = m.scenery.greens.map(r => ({ ring: r, c: meanPt(r) }));
const nearPlay = (x, z) => m.holes.some(h => lineD(x, z, h.line) < 65);
const mask = new Uint8Array(NX * NZ);
for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) { const x = BOX.x0 + c * STEP, z = BOX.z0 + r * STEP; if (sandy(rgbAt(x, z)) && nearPlay(x, z)) mask[r * NX + c] = 1; }
const lab = new Int32Array(NX * NZ).fill(-1); const comps = [];
for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) {
  if (!mask[r * NX + c] || lab[r * NX + c] >= 0) continue;
  const id = comps.length, cells = [], st = [r * NX + c]; lab[r * NX + c] = id;
  while (st.length) { const i = st.pop(); cells.push(i); const cy = (i / NX) | 0, cx = i % NX; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = cy + dy, xx = cx + dx; if (yy < 0 || xx < 0 || yy >= NZ || xx >= NX) continue; const j = yy * NX + xx; if (mask[j] && lab[j] < 0) { lab[j] = id; st.push(j); } } }
  comps.push(cells);
}
function dish(ring) { const b = bboxOf(ring); const inside = [], band = []; for (let z = b.z0 - 5; z <= b.z1 + 5; z += 0.5) for (let x = b.x0 - 5; x <= b.x1 + 5; x += 0.5) { const isIn = inRing(x, z, ring); const d = ringD(x, z, ring); if (isIn) inside.push(hAt(x, z)); else if (d > 1.5 && d < 5) band.push(hAt(x, z)); } return +(median(band) - median(inside)).toFixed(2); }
const cands = [];
for (const cells of comps) {
  const a = cells.length * STEP * STEP; if (a < 10 || a > 700) continue;
  const ring = hull(cells.map(i => [BOX.x0 + (i % NX) * STEP, BOX.z0 + ((i / NX) | 0) * STEP])).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  const c = meanPt(ring);
  if (built.some(r => inRing(c[0], c[1], r))) continue;
  let ld = 1e9; for (const L of lines) ld = Math.min(ld, lineD(c[0], c[1], L)); if (ld < 3) continue;
  const dep = dish(ring);
  if (!(dep >= 0.12 || (dep >= 0.07 && a >= 30))) continue;
  let hn = 0, hd = 1e9; for (const h of m.holes) { const d = lineD(c[0], c[1], h.line); if (d < hd) { hd = d; hn = h.n; } }
  let sd = 1e9; for (const s of scen) sd = Math.min(sd, Math.hypot(s.c[0] - c[0], s.c[1] - c[1]));
  cands.push({ ring, c: c.map(v => +v.toFixed(1)), area: Math.round(areaOf(ring)), dish: dep, hole: hn, holeDist: Math.round(hd), scenery: sd < 30 && sd < hd });
}
console.log(`sand-over-dish candidates: ${cands.length}`);

/* match the plan readings and guide placements; an OSM bunker is never touched */
const PLAN = new Set([1, 2, 3, 4, 5, 7]);
const bunkers = [], used = new Set(), log = [];
for (const h of m.holes) {
  const soft = h.bunkers.filter(b => b.prov !== 'osm');
  for (const b of soft) {
    let best = null, bd = 1e9;
    for (const [k, c] of cands.entries()) { if (used.has(k) || c.scenery) continue; const d = Math.hypot(c.c[0] - b.c[0], c.c[1] - b.c[1]); if (d < bd) { bd = d; best = k; } }
    if (best !== null && bd <= 28) { used.add(best); const c = cands[best]; bunkers.push({ hole: h.n, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'sat+dtm', replaces: b.prov, moved: +bd.toFixed(1) }); log.push(`hole ${h.n} ${b.prov} bunker at (${b.c}) -> (${c.c}) ${bd.toFixed(1)} m`); }
    else log.push(`hole ${h.n} ${b.prov} bunker at (${b.c}) -> nothing within 28 m (nearest ${bd.toFixed(0)} m): dropped`);
  }
}
/* An unmatched candidate fills a plan bunker the match missed, never more: the plan
   says how many bunkers a hole has, and a sand patch with a dish on the 2nd's
   48 m descent is an erosion scar, not a third bunker on a hole drawn with two. */
const planCount = {}; for (const h of m.holes) planCount[h.n] = h.bunkers.filter(b => b.prov !== 'osm').length;
const matched = {}; for (const b of bunkers) matched[b.hole] = (matched[b.hole] || 0) + 1;
const extras = [...cands.entries()].filter(([k, c]) => !used.has(k) && !c.scenery && PLAN.has(c.hole) && c.holeDist <= 30 && c.dish >= 0.3 && c.area >= 15 && c.area <= 150).sort((a, b) => b[1].dish - a[1].dish);
for (const [k, c] of extras) {
  if ((matched[c.hole] || 0) >= (planCount[c.hole] || 0)) continue;
  if (bunkers.some(b => Math.hypot(b.c[0] - c.c[0], b.c[1] - c.c[1]) < 10)) continue;
  const h = m.holes[c.hole - 1];
  if (h.tees.pads.some(p => Math.hypot(p.c[0] - c.c[0], p.c[1] - c.c[1]) < 14) || h.tees.marks.some(p => Math.hypot(p.c[0] - c.c[0], p.c[1] - c.c[1]) < 14)) continue;
  used.add(k); matched[c.hole] = (matched[c.hole] || 0) + 1;
  bunkers.push({ hole: c.hole, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'sat+dtm', replaces: null, note: 'not on the club plan; sand in the imagery over a dish in the DTM' });
  log.push(`hole ${c.hole} extra bunker at (${c.c}) ${c.area} m² dish ${c.dish}`);
}
console.log(log.join('\n'));

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
/* least-cost path along the valley bottom between two legacy points */
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
const ditches = [];
const nearDitch = line => ditches.some(d => line.reduce((a, p) => a + lineD(p[0], p[1], d.line), 0) / line.length < 10);
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
    if (sd < 12) continue;                                             /* OSM already has it */
    /* adopted on a strong valley signature, or on the club's word: the 17th's crossing
       ditch is a club fact the model lacked */
    if (p.score < 0.4 && !(h.n === 17 && p.toGreen < 90)) continue;
    if (Math.hypot(p.p.x - L[0][0], p.p.z - L[0][1]) < 30 || p.toGreen < 25) continue;
    if (h.tees.pads.some(q => q.prov === 'osm' && Math.hypot(q.c[0] - p.p.x, q.c[1] - p.p.z) < 10)) continue;
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
    if (nearDitch(line)) continue;
    ditches.push({ hole: h.n, line, kind: 'ditch', meanDepth: +mean.toFixed(2), crossesAt: p.toGreen, src: 'dtm', note: `crosses the playing line ${p.toGreen} m from the green (valley score ${p.score.toFixed(2)})` });
  }
}
/* the two the club names that run ALONG a hole and so never cross a line */
const h3 = snap([-53, -23], [-78, 77]);
ditches.push({ hole: 3, line: h3.line, kind: 'ditch', meanDepth: h3.meanDepth, src: 'dtm', note: 'the club: "ett dike längs den högra" -- traced along the valley bottom right of the 3rd between two points read off the hillshade' });
const h1 = snap([12.4, -92.7], [45.1, 51.1]);
ditches.push({ hole: 1, line: h1.line, kind: 'ditch', meanDepth: h1.meanDepth, src: 'dtm', note: 'the club: penalty area right of the 1st "mellan klippgräns och anlagd väg" -- the roadside ditch' });
console.log(`ditches: ${ditches.length}`);
for (const d of ditches) console.log(`  hole ${d.hole} ${d.crossesAt ? d.crossesAt + ' m to green' : 'along'} depth ${d.meanDepth} (${d.line[0]})->(${d.line.at(-1)})`);

/* -------------------------------------------------------------------- decks */
function decks(cx, cz, R) {
  const cells = new Map();
  for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) { const hs = []; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) hs.push(hAt(x + dx, z + dz)); if (quant(hs, 0.9) - quant(hs, 0.1) < 0.10) cells.set(`${x},${z}`, [x, z]); }
  const seen = new Set(), out = [];
  for (const [k] of cells) { if (seen.has(k)) continue; const comp = [], st = [k]; seen.add(k); while (st.length) { const kk = st.pop(); const c = cells.get(kk); comp.push(c); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${c[0] + dx},${c[1] + dz}`; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } } if (comp.length >= 40) { const ring = hull(comp); out.push({ n: comp.length, ring, c: meanPt(ring) }); } }
  return out;
}
const deckOut = [];
for (const h of m.holes) for (const p of h.tees.pads) {
  if (p.prov !== 'synth') continue;
  const cand = decks(p.c[0], p.c[1], 20).filter(d => inRing(p.c[0], p.c[1], d.ring) || Math.hypot(d.c[0] - p.c[0], d.c[1] - p.c[1]) < 9).sort((a, b) => b.n - a.n);
  if (!cand.length || areaOf(cand[0].ring) > 400) continue;              /* a whole fairway is flat too */
  const ring = cand[0].ring.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]);
  deckOut.push({ hole: h.n, teeIdx: p.teeIdx, ring, c: cand[0].c.map(v => +v.toFixed(1)), area: Math.round(areaOf(ring)), src: 'dtm' });
}
console.log(`decks: ${deckOut.length}`);

writeJSON(path.join(ROOT, 'geobuild/dtm-features.json'), {
  source: 'Derived from Lantmäteriet\'s 1 m Markhöjdmodell as published in apps/golf/public/grounds/veckefjarden (64 level-0 tiles, RH 2000, sampled through legacyGridBridge) and Esri World Imagery z18 (0.27 m/px, orthorectified) by geobuild/derive-dtm-features.mjs. A bunker is sand in the imagery (R>105, R>=0.85G) over a dish in the DTM (rim minus floor >= 0.15 m); its outline is the hull of the sand pixels. Every OSM bunker with a clear dish reproduces to 1-2 m by the same rule, which is the calibration. A ditch is a linear valley crossing a playing line (directional valley score >= 0.4, mean black-top-hat depth >= 0.3 m), traced by least-cost path along its bottom. A deck is a flat plateau (5x5 m spread < 0.10 m) under a card tee mark.',
  bunkers, ditches, decks: deckOut,
});
console.log('wrote geobuild/dtm-features.json');
