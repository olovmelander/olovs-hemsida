/* Read Johannesberg off the laser terrain and the orthoimagery: bunkers, the ditches
   that cross the playing lines, and the flat decks under the card's tee marks.

   Both sources are orthorectified, so nothing here is registered to anything -- the
   only question each feature answers is whether two independent signals agree at a
   place. That matters more here than at Veckefjärden, because this course has NO
   surveyed golf geometry at all: every green, fairway and bunker in the model is an
   Esri trace routed by the club's 2026 banguide, and terrain-check.json measured
   those traces sitting a few metres off their own laser features. A feature derived
   from the laser AND the imagery carries no such offset by construction, so where
   this script and a trace disagree, the trace is what moved.

   A BUNKER is sand in the imagery over a dish in the DTM (rim minus floor). The sand
   rule is CALIBRATED on this course's own bunkers rather than copied: the 27 traced
   bunkers are read inside and in a turf band around them, and the threshold is set
   between the two populations, which the run prints. A DITCH is a linear valley the
   directional valley filter scores at a playing-line crossing, traced along its
   bottom by least-cost path on the black top-hat; the club's own banguide names two
   more. A DECK is a plateau whose 5 x 5 m spread is under 0.10 m, found under a card
   tee mark that no traced pad covers.

   Runs after reconcile has fused the traces and before reconcile's final pass, which
   reads what it writes. Needs the imagery cache (fetched here) and Chromium.

     node johannesbergbuild/derive-dtm-features.mjs   -> johannesbergbuild/dtm-features.json
   SAT_REL=<release> picks a dated Esri capture instead of the live mosaic.        */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON } from './lib.mjs';
/* The imagery sampler reads its frame from BUILD's own model at import time, so BUILD
   must be set before geobuild/dtm-lib.mjs is loaded -- hence the dynamic import. dtm-lib
   compares the two frames and throws when they disagree, which is how the first run of
   this script was caught calibrating on Veckefjärden's tiles: the traced bunkers came
   out DARKER than the turf around them, which is a wrong place, not a wrong rule. */
process.env.BUILD = process.env.BUILD || 'johannesbergbuild';
const {
  loadTerrain, blackTopHat, ensureImagery, rgbAt, inRing, bboxOf, lineD, ringD, median, quant,
  areaOf, meanPt, hull, simplify,
} = await import('../geobuild/dtm-lib.mjs');

const SLUG = 'johannesberg';
const m = readJSON(path.join(ROOT, 'johannesbergbuild/course-model.json'));
const T = loadTerrain(SLUG);
const { hAt } = T;
console.log(`terrain: ${T.tiles} tiles, ${T.W}x${T.H} at 1 m, datum ${T.datum} m`);

/* the played ground with a margin, clipped to the terrain window */
const BOX = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const h of m.holes) for (const p of [...h.line, ...h.green.ring, ...h.tees.marks.map(t => t.c)]) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  return { x0: x0 - 120, z0: z0 - 120, x1: x1 + 120, z1: z1 + 120 };
})();
console.log('box', JSON.stringify(BOX));
console.log('imagery:', await ensureImagery(BOX.x0, BOX.z0, BOX.x1, BOX.z1), process.env.SAT_REL ? `release ${process.env.SAT_REL}` : 'live mosaic');

/* ---------------------------------------------------------------- calibration */
/* Read the imagery inside every traced bunker and in a turf band around it. The traces
   are a few metres off, so the inside sample is contaminated by turf and the band by
   sand -- which is exactly why the threshold is taken from the SEPARATION of the two
   distributions and not from either one's mean. */
const allBunkers = m.holes.flatMap(h => h.bunkers.map(b => ({ hole: h.n, ...b })));
const sampleRing = (ring, inside) => {
  const b = bboxOf(ring), out = [];
  for (let z = b.z0 - 6; z <= b.z1 + 6; z += 0.5) for (let x = b.x0 - 6; x <= b.x1 + 6; x += 0.5) {
    const isIn = inRing(x, z, ring), d = ringD(x, z, ring);
    if (inside ? (isIn && d > 1.5) : (!isIn && d > 3 && d < 8)) { const c = rgbAt(x, z); if (c) out.push(c); }
  }
  return out;
};
const chan = (px, k) => median(px.map(c => c[k]));
const inPx = [], outPx = [];
for (const b of allBunkers) { inPx.push(...sampleRing(b.ring, true)); outPx.push(...sampleRing(b.ring, false)); }
const lum = c => (c[0] + c[1] + c[2]) / 3;
console.log(`calibration: ${allBunkers.length} traced bunkers, ${inPx.length} interior px, ${outPx.length} band px`);
console.log(`  interior median rgb ${[0, 1, 2].map(k => Math.round(chan(inPx, k))).join(',')}  luminance ${median(inPx.map(lum)).toFixed(1)}`);
console.log(`  band     median rgb ${[0, 1, 2].map(k => Math.round(chan(outPx, k))).join(',')}  luminance ${median(outPx.map(lum)).toFixed(1)}`);
/* sand is bright and NOT green-dominant; turf is darker and green-dominant. Both
   thresholds sit between the two populations' quantiles, so neither is a literal. */
const SAND_LUM = +(((quant(inPx.map(lum), 0.60) + quant(outPx.map(lum), 0.90)) / 2)).toFixed(1);
const SAND_RG = +(((quant(inPx.map(c => c[0] / Math.max(1, c[1])), 0.40) + quant(outPx.map(c => c[0] / Math.max(1, c[1])), 0.90)) / 2)).toFixed(3);
console.log(`  rule: luminance >= ${SAND_LUM} and R/G >= ${SAND_RG}`);
const sandy = c => c && lum(c) >= SAND_LUM && c[0] / Math.max(1, c[1]) >= SAND_RG;

/* ------------------------------------------------------------------- bunkers */
const STEP = 0.5;
const NX = Math.round((BOX.x1 - BOX.x0) / STEP), NZ = Math.round((BOX.z1 - BOX.z0) / STEP);
const built = [
  ...(m.infra.buildings || []).map(b => b.ring), ...(m.infra.parking || []).map(p => p.ring),
  ...(m.scenery.range || []), ...(m.surround?.yard || []).map(y => y.ring || y),
];
const lines = [...(m.infra.roads || []), ...(m.infra.tracks || []), ...(m.infra.paths || [])].map(p => p.line).filter(Boolean);
/* The mask is 11 million cells at half a metre, and the play test walks every hole
   line and green ring, so the order of the tests is the whole cost: a coarse 4 m
   play grid is built once, the imagery is read only inside it, and the expensive
   exclusions run only on the cells that already read as sand. */
const nearPlay = (x, z) => m.holes.some(h => lineD(x, z, h.line) < 70) || m.holes.some(h => ringD(x, z, h.green.ring) < 45);
const CX = Math.ceil((BOX.x1 - BOX.x0) / 4) + 1, CZ = Math.ceil((BOX.z1 - BOX.z0) / 4) + 1;
const coarse = new Uint8Array(CX * CZ);
for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) if (nearPlay(BOX.x0 + i * 4, BOX.z0 + j * 4)) coarse[j * CX + i] = 1;
/* dilate one coarse cell so nothing within 4 m of the play band is lost to the grid */
const grown = new Uint8Array(coarse);
for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) if (coarse[j * CX + i]) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const nj = j + dj, ni = i + di; if (ni >= 0 && nj >= 0 && ni < CX && nj < CZ) grown[nj * CX + ni] = 1; }
console.log(`play band: ${grown.reduce((a, v) => a + v, 0)} of ${CX * CZ} coarse cells`);
const mask = new Uint8Array(NX * NZ);
let sandCells = 0;
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const x = BOX.x0 + i * STEP, z = BOX.z0 + j * STEP;
  if (!grown[Math.round((z - BOX.z0) / 4) * CX + Math.round((x - BOX.x0) / 4)]) continue;
  if (!sandy(rgbAt(x, z))) continue;
  sandCells++;
  if (built.some(r => inRing(x, z, r))) continue;                    /* hardstanding is bright too */
  if (lines.some(l => lineD(x, z, l) < 4)) continue;                 /* so is a gravel road */
  if (m.water.some(w => inRing(x, z, w.ring))) continue;
  mask[j * NX + i] = 1;
}
console.log(`sand pixels in the play band: ${sandCells}, ${mask.reduce((a, v) => a + v, 0)} after dropping hardstanding, roads and water`);
/* connected components of sand */
const lab = new Int32Array(NX * NZ).fill(-1); const comps = [];
for (let s = 0; s < mask.length; s++) {
  if (!mask[s] || lab[s] >= 0) continue;
  const id = comps.length, st = [s], cells = []; lab[s] = id;
  while (st.length) {
    const k = st.pop(); cells.push(k); const i = k % NX, j = (k / NX) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const nk = nj * NX + ni; if (mask[nk] && lab[nk] < 0) { lab[nk] = id; st.push(nk); }
    }
  }
  comps.push(cells);
}
/* rim minus floor: the dish that says a bright patch is dug, not merely pale */
function dish(ring) {
  const b = bboxOf(ring), inside = [], band = [];
  for (let z = b.z0 - 5; z <= b.z1 + 5; z += 0.5) for (let x = b.x0 - 5; x <= b.x1 + 5; x += 0.5) {
    const isIn = inRing(x, z, ring), d = ringD(x, z, ring);
    if (isIn) inside.push(hAt(x, z)); else if (d > 1.5 && d < 5) band.push(hAt(x, z));
  }
  return +(median(band) - median(inside)).toFixed(2);
}
const AREA_MIN = 12, AREA_MAX = 260, DISH_MIN = 0.15;
const cands = [];
for (const cells of comps) {
  const area = cells.length * STEP * STEP;
  if (area < AREA_MIN || area > AREA_MAX) continue;
  const pts = cells.map(k => [BOX.x0 + (k % NX) * STEP, BOX.z0 + (((k / NX) | 0)) * STEP]);
  const ring = simplify(hull(pts), 0.4).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  if (ring.length < 4) continue;
  const c = meanPt(ring);
  const d = dish(ring);
  let hole = null, holeDist = 1e9;
  for (const h of m.holes) { const dd = Math.min(lineD(c[0], c[1], h.line), ringD(c[0], c[1], h.green.ring)); if (dd < holeDist) { holeDist = dd; hole = h.n; } }
  cands.push({ ring, c: c.map(v => +v.toFixed(1)), area: Math.round(areaOf(ring)), dish: d, hole, holeDist: +holeDist.toFixed(1) });
}
console.log(`sand components: ${comps.length}; ${cands.length} in the size band, ${cands.filter(c => c.dish >= DISH_MIN).length} of those over a dish >= ${DISH_MIN} m`);

/* match each traced bunker to the nearest accepted detection, and MEASURE the offset */
const accepted = cands.filter(c => c.dish >= DISH_MIN);
const used = new Set(); const bunkers = []; const offsets = []; const log = [];
for (const b of allBunkers) {
  const bc = meanPt(b.ring);
  let best = -1, bd = 1e9;
  accepted.forEach((c, i) => { if (used.has(i)) return; const d = Math.hypot(c.c[0] - bc[0], c.c[1] - bc[1]); if (d < bd) { bd = d; best = i; } });
  if (best >= 0 && bd <= 12) {
    used.add(best); const c = accepted[best];
    offsets.push([c.c[0] - bc[0], c.c[1] - bc[1]]);
    bunkers.push({ hole: b.hole, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'dtm', was: b.prov, moved: +bd.toFixed(1) });
    log.push(`  hole ${String(b.hole).padStart(2)} ${b.prov.padEnd(4)} trace -> detection ${bd.toFixed(1)} m, ${c.area} m², dish ${c.dish} m`);
  } else {
    log.push(`  hole ${String(b.hole).padStart(2)} ${b.prov.padEnd(4)} trace kept: no sand-over-dish within 12 m (nearest ${bd < 1e8 ? bd.toFixed(1) + ' m' : 'none'})`);
  }
}
const mx = median(offsets.map(o => o[0])), mz = median(offsets.map(o => o[1]));
console.log(`bunkers: ${bunkers.length} of ${allBunkers.length} traces confirmed by sand over a dish`);
console.log(`  the traces' median offset from their own laser+imagery feature: ${mx.toFixed(2)} m east, ${mz.toFixed(2)} m z (n=${offsets.length})`);
for (const l of log) console.log(l);
/* an unmatched detection is adopted only where the club's plan draws a bunker the
   model lacks -- two independent records, the rule this course already refuses on */
/* guide-inventory keys its holes by number, and each hole's bunkers entry carries an
   n per group ("greenside, left, n 2"), so the plan's count is the sum of those. */
const inv = readJSON(path.join(ROOT, 'johannesbergbuild/guide-inventory.json')).holes || {};
const planCount = {};
for (const [n, h] of Object.entries(inv)) planCount[+n] = (h.bunkers || []).reduce((a, b) => a + (b.n || 1), 0);
/* what the model will carry per hole once the confirmed detections replace their traces:
   every existing bunker still counts, whether or not a detection confirmed it */
const have = {}; for (const b of allBunkers) have[b.hole] = (have[b.hole] || 0) + 1;
const extras = accepted.map((c, i) => [i, c]).filter(([i, c]) => !used.has(i) && c.holeDist <= 45 && c.dish >= 0.25 && c.area >= 15)
  .sort((a, b2) => b2[1].dish - a[1].dish);
const adopted = [];
for (const [, c] of extras) {
  const n = (have[c.hole] || 0) + adopted.filter(a => a.hole === c.hole).length;
  if (!(planCount[c.hole] > n)) continue;                            /* the plan draws no more here */
  adopted.push({ hole: c.hole, ring: c.ring, c: c.c, area: c.area, dish: c.dish, src: 'dtm', was: null, moved: null,
                 note: `the club's plan draws ${planCount[c.hole]} bunkers on this hole and the model carried ${have[c.hole] || 0}` });
}
bunkers.push(...adopted);
console.log(`  ${extras.length} unmatched detections, ${adopted.length} adopted where the club's plan draws a bunker the model lacks`);

/* ------------------------------------------------------------------- ditches */
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
  if (s < 0 || t < 0 || s >= w * h || t >= w * h) return null;
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
const ditches = [], candidates = [];
const nearDitch = line => [...ditches, ...candidates].some(d => line.reduce((a, p) => a + lineD(p[0], p[1], d.line), 0) / line.length < 10);
/* The club's banguide names water crossing the fairway on two holes; those two are
   adopted at a lower valley score than an unannounced one, because a second record
   already says a channel is there. Everything else must stand on the laser alone. */
const BY_WORD = { 12: 'the plan: ponds either side of the fairway at 178-188 m, "joined by the ditch that crosses it"', 18: 'the club: "ett vattenhinder tvärs över fairway" on the signature hole' };
for (const h of m.holes) {
  const L = h.line; let total = 0; const segs = [];
  for (let i = 0; i < L.length - 1; i++) { const d = Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); segs.push(d); total += d; }
  const at = s => { let acc = 0; for (let i = 0; i < segs.length; i++) { if (s <= acc + segs[i]) { const t = (s - acc) / segs[i]; return [L[i][0] + (L[i + 1][0] - L[i][0]) * t, L[i][1] + (L[i + 1][1] - L[i][1]) * t, i]; } acc += segs[i]; } return [L[L.length - 1][0], L[L.length - 1][1], segs.length - 1]; };
  const prof = [];
  for (let s = 8; s < total - 8; s += 1) {
    const [x, z, i] = at(s); const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1], l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l; let best = 0, bv = null;
    for (const o of [-8, -4, 0, 4, 8]) { const v = valley(x + nx * o, z + nz * o); if (v.s > best) { best = v.s; bv = { x: x + nx * o, z: z + nz * o, dir: v.dir }; } }
    if (bv) prof.push({ s, toGreen: Math.round(total - s), score: best, p: bv });
  }
  for (let i = 2; i < prof.length - 2; i++) {
    const p = prof[i];
    if (p.score < 0.15 || prof.slice(Math.max(0, i - 12), i + 13).some(q => q.score > p.score)) continue;
    if (inWater(p.p.x, p.p.z)) continue;
    /* OSM's watercourses, never this script's own earlier output: reconcile folds
       dtm-features.json in on every run, so a re-run must not mistake its own ditches
       for OSM's and drop them */
    let sd = 1e9; for (const st of m.streams) if (st.prov !== 'dtm' && st.src !== 'dtm') sd = Math.min(sd, lineD(p.p.x, p.p.z, st.line));
    if (sd < 12) continue;
    const byWord = !!BY_WORD[h.n];
    if (p.score < (byWord ? 0.28 : 0.4)) continue;
    if (Math.hypot(p.p.x - L[0][0], p.p.z - L[0][1]) < 30 || (p.toGreen < 25 && !byWord)) continue;
    /* A TEE TERRACE IS NOT A DITCH. A tee cut into a slope leaves a cross-slope cut
       behind it and a drop in front, and the valley filter scores that exactly as it
       scores a channel. The first run of this found three "ditches" on the 10th -- a
       hole whose five tee marks run 160 m down a 16 m fall -- sitting 6, 14 and 18 m
       from a tee mark, 0.9 to 1.7 m below the ground either side and convincingly
       linear. Guarding on the traced PADS was not enough because three of those five
       marks have no traced pad; the guard is every card tee MARK. */
    if (h.tees.marks.some(q => Math.hypot(q.c[0] - p.p.x, q.c[1] - p.p.z) < 22)) continue;
    if (h.tees.pads.some(q => Math.hypot((q.cx ?? meanPt(q.ring)[0]) - p.p.x, (q.cz ?? meanPt(q.ring)[1]) - p.p.z) < 12)) continue;
    const d = p.p.dir;
    const s = snap([p.p.x + d[0] * 45, p.p.z + d[1] * 45], [p.p.x - d[0] * 45, p.p.z - d[1] * 45]);
    if (!s) continue;
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
    /* THE SAME TWO-RECORDS RULE THIS COURSE ALREADY APPLIES TO BUNKERS. Three traced
       bunkers no plan draws and no pit confirms were refused here; a channel the laser
       alone sees, on a hole whose banguide names no water, is the same claim. It is
       recorded as a candidate with its measurements so the next reader can judge it,
       and it does not enter the model. Only a crossing the club's own record names is
       adopted outright. */
    const rec = {
      hole: h.n, line, kind: 'ditch', meanDepth: +mean.toFixed(2), crossesAt: p.toGreen, src: 'dtm',
      note: `crosses the playing line ${p.toGreen} m from the green (valley score ${p.score.toFixed(2)}, mean depth ${mean.toFixed(2)} m)${byWord ? ` -- ${BY_WORD[h.n]}` : ''}`,
    };
    (byWord ? ditches : candidates).push(rec);
  }
}
console.log(`ditches adopted (a club record names water crossing the hole): ${ditches.length}`);
for (const d of ditches) console.log(`  hole ${String(d.hole).padStart(2)} ${d.crossesAt} m to green, depth ${d.meanDepth}, ${d.line.length} pts`);
console.log(`laser-only candidates recorded but NOT modelled: ${candidates.length}`);
for (const d of candidates) console.log(`  hole ${String(d.hole).padStart(2)} ${d.crossesAt} m to green, depth ${d.meanDepth} -- no club record names water on this hole`);

/* --------------------------------------------------- the channels already modelled */
/* The laser's better use here is not inventing watercourses but MEASURING the ones two
   other records already place. Every stream and ditch the model carries is re-run
   between its own endpoints as a least-cost path along the valley bottom; where the
   result is a real channel it replaces a three-point screenshot trace with the
   channel's own line, and where it is not, the original stands and this says so. */
const refined = [];
for (const st of m.streams) {
  const a = st.line[0], b = st.line[st.line.length - 1];
  const inWindow = st.line.every(q => Number.isFinite(hAt(q[0], q[1])));
  if (!inWindow) { refined.push({ id: st.id, kind: st.kind, adopted: false, why: 'the line leaves the 1 m terrain window' }); continue; }
  const s = snap(a, b);
  if (!s) { refined.push({ id: st.id, kind: st.kind, adopted: false, why: 'no path' }); continue; }
  let mean = 0; for (const q of s.pts) mean += thAt(q[0], q[1]); mean /= s.pts.length;
  /* how far the snapped line moved from the one the model carries */
  const moved = median(s.pts.map(q => lineD(q[0], q[1], st.line)));
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const detour = s.pts.length / Math.max(1, straight);
  const adopted = mean >= 0.30 && detour < 1.6;
  refined.push({
    id: st.id, kind: st.kind, adopted, meanDepth: +mean.toFixed(2), medianMoveMetres: +moved.toFixed(1),
    lengthMetres: Math.round(s.pts.length), straightMetres: Math.round(straight),
    line: adopted ? s.line : null,
    why: adopted ? `the valley bottom between the same two endpoints, mean black-top-hat depth ${mean.toFixed(2)} m`
      : (mean < 0.30 ? `the laser reads no channel along it (mean depth ${mean.toFixed(2)} m): the modelled line stands`
        : `the least-cost path wanders ${detour.toFixed(2)}x the straight distance: not one channel`),
  });
}
console.log(`modelled watercourses re-measured: ${refined.filter(r => r.adopted).length} of ${refined.length} snapped to a laser channel`);
for (const r of refined) console.log(`  ${(r.id || '?').padEnd(20)} ${r.kind.padEnd(7)} ${r.adopted ? `adopted: ${r.lengthMetres} m along the valley, depth ${r.meanDepth} m, moved ${r.medianMoveMetres} m` : r.why}`);

/* --------------------------------------------------------------------- decks */
function decks(cx, cz, R) {
  const cells = new Map();
  for (let z = Math.round(cz) - R; z <= Math.round(cz) + R; z++) for (let x = Math.round(cx) - R; x <= Math.round(cx) + R; x++) {
    const hs = []; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) hs.push(hAt(x + dx, z + dz));
    if (quant(hs, 0.9) - quant(hs, 0.1) < 0.10) cells.set(`${x},${z}`, [x, z]);
  }
  const seen = new Set(), out = [];
  for (const [k] of cells) {
    if (seen.has(k)) continue;
    const comp = [], st = [k]; seen.add(k);
    while (st.length) { const kk = st.pop(); const c = cells.get(kk); comp.push(c); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${c[0] + dx},${c[1] + dz}`; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
    if (comp.length >= 40) { const ring = hull(comp); out.push({ n: comp.length, ring, c: meanPt(ring) }); }
  }
  return out;
}
const padC = p => [p.cx ?? meanPt(p.ring)[0], p.cz ?? meanPt(p.ring)[1]];
const deckOut = [];
for (const h of m.holes) {
  const marks = h.tees.marks || [];
  marks.forEach((mk, teeIdx) => {
    /* only a mark no traced pad already covers: a measured pad is the better record */
    if (h.tees.pads.some(p => inRing(mk.c[0], mk.c[1], p.ring) || Math.hypot(...padC(p).map((v, k) => v - mk.c[k])) < 7)) return;
    if (deckOut.some(d => d.hole === h.n && Math.hypot(d.c[0] - mk.c[0], d.c[1] - mk.c[1]) < 4)) return;
    const cand = decks(mk.c[0], mk.c[1], 18)
      .filter(d => inRing(mk.c[0], mk.c[1], d.ring) || Math.hypot(d.c[0] - mk.c[0], d.c[1] - mk.c[1]) < 9)
      .sort((a, b) => b.n - a.n);
    if (!cand.length) return;
    const area = areaOf(cand[0].ring);
    if (area > 400 || area < 25) return;                    /* a whole fairway is flat too */
    const ring = cand[0].ring.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]);
    deckOut.push({ hole: h.n, teeIdx, ring, c: cand[0].c.map(v => +v.toFixed(1)), area: Math.round(area), src: 'dtm' });
  });
}
console.log(`decks: ${deckOut.length} under card tee marks no traced pad covers`);

writeJSON(path.join(ROOT, 'johannesbergbuild/dtm-features.json'), {
  source: `Derived from Lantmäteriet's 1 m Markhöjdmodell as published in apps/golf/public/grounds/johannesberg (${T.tiles} level-0 tiles, RH 2000, sampled through legacyGridBridge) and Esri World Imagery z18 (orthorectified, ${process.env.SAT_REL ? 'release ' + process.env.SAT_REL : 'live mosaic'}) by johannesbergbuild/derive-dtm-features.mjs. A bunker is sand in the imagery over a dish in the DTM (rim minus floor >= ${DISH_MIN} m); the sand rule is calibrated on this course's own traced bunkers, inside against a turf band, and is luminance >= ${SAND_LUM} with R/G >= ${SAND_RG}. Its outline is the hull of the sand pixels, which carries no registration error because both sources are orthorectified -- unlike the traces, which this run measures as sitting a median ${mx.toFixed(2)} m east and ${mz.toFixed(2)} m in z off their own laser feature. A ditch is a linear valley crossing a playing line (directional valley score >= 0.4, or >= 0.28 on the two holes whose banguide names water across the fairway), traced by least-cost path along its bottom, mean black-top-hat depth >= 0.3 m. A deck is a flat plateau (5x5 m spread < 0.10 m) under a card tee mark that no traced pad covers.`,
  derivedOn: new Date().toISOString().slice(0, 10),
  calibration: {
    tracedBunkers: allBunkers.length, interiorPx: inPx.length, bandPx: outPx.length,
    interiorMedianRgb: [0, 1, 2].map(k => Math.round(chan(inPx, k))), bandMedianRgb: [0, 1, 2].map(k => Math.round(chan(outPx, k))),
    sandLuminance: SAND_LUM, sandRedOverGreen: SAND_RG,
    traceOffsetToLaserMetres: { east: +mx.toFixed(2), z: +mz.toFixed(2), n: offsets.length },
  },
  bunkers, ditches, ditchCandidates: candidates, decks: deckOut, refinedStreams: refined,
});
console.log('-> johannesbergbuild/dtm-features.json');
