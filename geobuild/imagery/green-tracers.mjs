/* Every way of tracing a putting green that was tried, scored against the surveyed
   (OSM) greens so the number is a measurement and not a hope. The record on
   Veckefjärden (leaf-on release 27982, 12 surveyed greens, median IoU):
     polar      0.36-0.44 rays from the GPS centre, edge at the largest brightness step -- locks on the apron
     firststep  0.44   first significant step outward instead of the largest
     roughness  0.53   1 m DTM roughness region-grow: greens ARE the smoothest surface (0.014-0.025
                       vs 0.024-0.044 in the collar, on all twelve) but the ratio is only 1.5
     blob       0.54   1.5 m-smoothed brightness, component round the centre above an adaptive threshold
     fusion     0.55   blob with the roughness z-score folded in (WR=1)
     plan       0.64   the club plan's own green fill, bunker-registered (plan-register.mjs), aligned
   None reaches survey quality; the six plan greens keep their shape on the survey centre.
   Run it again only with a new source (a finer leafed-on image, a survey).

   Usage:  SAT_REL=27982 node geobuild/imagery/green-tracers.mjs [method|all] [--write out.json]
   Env:    F (blob threshold fraction, 0.5), WR (roughness weight, 0), THR (first-step, 18)      */
import fs from 'node:fs';
import { rgbAt } from './wayback.mjs';
import { model, survey, inRing, ringD, area, centroid, median, quant, iou, hull, simplifyDP, traceBoundary } from './lib.mjs';

const m = model(), G = survey();
const S = 0.5, R = 34, N = Math.round(2 * R / S) + 1;
const smoothN = (F, k, n = N) => { const o = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0, q = 0; for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const v = F[jj * n + ii]; if (Number.isFinite(v)) { s += v; q++; } } o[j * n + i] = q ? s / q : NaN; } return o; };
function brightnessField(c, R2 = 40) { const n = Math.ceil(2 * R2 / S) + 1, raw = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = rgbAt(c[0] - R2 + i * S, c[1] - R2 + j * S); raw[j * n + i] = v ? v[0] + v[1] + v[2] : NaN; } const B = smoothN(raw, 3, n); return (x, z) => { const i = Math.round((x - c[0] + R2) / S), j = Math.round((z - c[1] + R2) / S); return (i < 0 || j < 0 || i >= n || j >= n) ? NaN : B[j * n + i]; }; }

/** polar: rays every 6°, edge at the largest (or, first=true, the first significant) inside-minus-outside step. */
export function polar(c, { first = false, THR = +(process.env.THR ?? 18), RMIN = 5, RMAX = 26, NA = 60 } = {}) {
  const B = brightnessField(c); const rs = [];
  for (let a = 0; a < NA; a++) { const th = a / NA * 2 * Math.PI, dx = Math.sin(th), dz = -Math.cos(th); const prof = []; for (let r = 0; r <= RMAX + 6; r += S) prof.push(B(c[0] + dx * r, c[1] + dz * r));
    const steps = []; for (let r = RMIN; r <= RMAX; r += S) { const k = Math.round(r / S); let si = 0, so = 0, qi = 0, qo = 0; for (let t = 1; t <= 6; t++) { const a1 = prof[k - t], a2 = prof[k + t]; if (Number.isFinite(a1)) { si += a1; qi++; } if (Number.isFinite(a2)) { so += a2; qo++; } } steps.push({ r, step: (qi < 3 || qo < 3) ? -1e9 : si / qi - so / qo }); }
    let best = -1e9, br = NaN, found = false; if (first) for (let i = 1; i < steps.length - 1 && !found; i++) { const s0 = steps[i].step; if (s0 >= THR && s0 >= steps[i - 1].step && s0 >= steps[i + 1].step) { best = s0; br = steps[i].r; found = true; } } if (!found) for (const q of steps) if (q.step > best) { best = q.step; br = q.r; } rs.push(br); }
  const filt = rs.map((_, i) => median([-2, -1, 0, 1, 2].map(d => rs[(i + d + NA) % NA]))); const rr = rs.map((r, i) => Math.abs(r - filt[i]) > 4 ? filt[i] : r); const sm = rr.map((_, i) => [-1, 0, 1].reduce((s, d) => s + rr[(i + d + NA) % NA], 0) / 3);
  return sm.map((r, i) => { const th = i / NA * 2 * Math.PI; return [+(c[0] + Math.sin(th) * r).toFixed(1), +(c[1] - Math.cos(th) * r).toFixed(1)]; });
}
/** blob (and fusion with WR>0): grow from the brightest cell near the centre where smoothed brightness (minus WR x roughness z-score) exceeds bg + F x (centre - bg); bunkers masked; holes filled; 1 m opening; boundary traced. */
export function blob(n, { F = +(process.env.F ?? 0.5), WR = +(process.env.WR ?? 0), rough = null } = {}) {
  const h = m.holes[n - 1], c = G[n]['Green Center']; const raw = new Float32Array(N * N), ro = new Float32Array(N * N); const bunk = (h.bunkers || []).map(b => b.ring);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = c[0] - R + i * S, z = c[1] - R + j * S; const v = rgbAt(x, z); const masked = bunk.some(r => ringD(x, z, r) < 2 || inRing(x, z, r)); raw[j * N + i] = (v && !masked) ? v[0] + v[1] + v[2] : NaN; ro[j * N + i] = (WR && rough) ? rough(x, z) : 0; }
  let B = smoothN(raw, 3);
  if (WR && rough) { const RS = smoothN(ro, 4); const z = F2 => { const v = Array.from(F2).filter(Number.isFinite); const mu = median(v), sd = (quant(v, 0.84) - quant(v, 0.16)) / 2 || 1; return F2.map(x => (x - mu) / sd); }; const zr = z(RS); const bv = Array.from(B).filter(Number.isFinite); const bsd = (quant(bv, 0.84) - quant(bv, 0.16)) / 2 || 1; B = B.map((v, p) => v - WR * bsd * zr[p]); }
  const ctr = [], bg = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const d = Math.hypot(i * S - R, j * S - R), v = B[j * N + i]; if (!Number.isFinite(v)) continue; if (d <= 5) ctr.push(v); else if (d >= 18 && d <= 28) bg.push(v); }
  const b0 = quant(ctr, 0.75), b1 = median(bg), thr = b1 + F * (b0 - b1);
  let seed = -1, best = -1e9; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (Math.hypot(i * S - R, j * S - R) > 4) continue; const v = B[j * N + i]; if (v > best) { best = v; seed = j * N + i; } }
  const acc = new Uint8Array(N * N); acc[seed] = 1; const st = [seed]; const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (st.length) { const p = st.pop(); const i = p % N, j = (p - i) / N; for (const [di, dj] of nb) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const q = jj * N + ii; if (acc[q] || !(B[q] > thr) || Math.hypot(ii * S - R, jj * S - R) > 30) continue; acc[q] = 1; st.push(q); } }
  const outside = new Uint8Array(N * N); const st2 = []; for (let i = 0; i < N; i++) for (const j of [0, N - 1]) { for (const p of [j * N + i, i * N + j]) if (!acc[p] && !outside[p]) { outside[p] = 1; st2.push(p); } }
  while (st2.length) { const p = st2.pop(); const i = p % N, j = (p - i) / N; for (const [di, dj] of nb) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const q = jj * N + ii; if (outside[q] || acc[q]) continue; outside[q] = 1; st2.push(q); } }
  for (let p = 0; p < N * N; p++) if (!acc[p] && !outside[p]) acc[p] = 1;
  const K = 2; const mor = (src, val) => { const o = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let hit = 0; for (let dj = -K; dj <= K && !hit; dj++) for (let di = -K; di <= K; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; if (src[jj * N + ii] === val) { hit = 1; break; } } o[j * N + i] = hit ? val : 1 - val; } return o; };
  const op = mor(mor(acc, 0), 1); const comp = new Uint8Array(N * N); if (op[seed]) { comp[seed] = 1; const s3 = [seed]; while (s3.length) { const p = s3.pop(); const i = p % N, j = (p - i) / N; for (const [di, dj] of nb) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const q = jj * N + ii; if (op[q] && !comp[q]) { comp[q] = 1; s3.push(q); } } } }
  const M = comp[seed] ? comp : acc; const bnd = traceBoundary(M, N, N).map(([i, j]) => [c[0] - R + i * S, c[1] - R + j * S]);
  const smw = bnd.map((p, i) => { const a = bnd[(i - 1 + bnd.length) % bnd.length], b = bnd[(i + 1) % bnd.length]; return [(a[0] + p[0] + b[0]) / 3, (a[1] + p[1] + b[1]) / 3]; });
  return simplifyDP(smw, 0.4).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
}
/** roughness: region-grow on the 1 m DTM's smoothed |Laplacian| z-score (greens are the smoothest ground). */
export function roughness(n, T, { THR = 0.5 } = {}) {
  const c = G[n]['Green Center']; const rough = (x, z) => { const cc = T.hAt(x, z), nb = [T.hAt(x + 1, z), T.hAt(x - 1, z), T.hAt(x, z + 1), T.hAt(x, z - 1)]; return Math.abs(4 * cc - nb.reduce((p, q) => p + q, 0)); };
  const S1 = 1, R1 = 32, n1 = 2 * R1 / S1 + 1; const ro = new Float32Array(n1 * n1); for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) ro[j * n1 + i] = rough(c[0] - R1 + i, c[1] - R1 + j);
  const rs = smoothN(ro, 2, n1); const v = Array.from(rs).filter(Number.isFinite); const mu = median(v), sd = (quant(v, 0.84) - quant(v, 0.16)) / 2 || 1; const score = rs.map(x => -(x - mu) / sd);
  const ci = R1, cj = R1; let seed = null, best = -1e9; for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const s = score[(cj + dj) * n1 + ci + di]; if (s > best) { best = s; seed = [ci + di, cj + dj]; } }
  const acc = new Set([seed[1] * n1 + seed[0]]); const q = [seed];
  while (q.length) { const [i, j] = q.shift(); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n1 || jj >= n1) continue; const k = jj * n1 + ii; if (acc.has(k) || Math.hypot(ii - ci, jj - cj) > 28) continue; if (score[k] > THR) { acc.add(k); q.push([ii, jj]); } } }
  return simplifyDP(hull([...acc].map(k => [c[0] - R1 + (k % n1), c[1] - R1 + Math.floor(k / n1)])), 0.6).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
}
if (process.argv[1] && process.argv[1].endsWith('green-tracers.mjs')) {
  const which = process.argv[2] || 'all'; const outIdx = process.argv.indexOf('--write'); const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
  const methods = ['polar', 'firststep', 'roughness', 'blob', 'fusion', 'plan'].filter(k => which === 'all' || which === k);
  let T = null; if (methods.some(k => k === 'roughness' || k === 'fusion')) { const { loadTerrain } = await import('../dtm-lib.mjs'); T = loadTerrain(); }
  let planTrace = null; if (methods.includes('plan')) { try { planTrace = (await import('./plan-register.mjs')).traceGreen; } catch (e) { console.log('plan: skipped (' + e.message + ')'); } }
  const rough = T ? (x, z) => { const cc = T.hAt(x, z), nb = [T.hAt(x + 1, z), T.hAt(x - 1, z), T.hAt(x, z + 1), T.hAt(x, z - 1)]; return Math.abs(4 * cc - nb.reduce((p, q) => p + q, 0)); } : null;
  const results = {};
  for (const k of methods) {
    const ious = [], rings = {};
    for (const h of m.holes) { const c = G[h.n]['Green Center']; let ring;
      if (k === 'polar') ring = polar(c); else if (k === 'firststep') ring = polar(c, { first: true }); else if (k === 'roughness') ring = roughness(h.n, T); else if (k === 'blob') ring = blob(h.n); else if (k === 'fusion') ring = blob(h.n, { WR: +(process.env.WR || 1), rough }); else if (k === 'plan') { if (!planTrace) continue; const t = planTrace(h.n, { bunkers: true }); if (!t) continue; const cc = centroid(t.ring), oc = h.green.c; ring = t.ring.map(p => [p[0] + oc[0] - cc[0], p[1] + oc[1] - cc[1]]); }
      if (!ring || ring.length < 3) continue; rings[h.n] = ring; if (h.green.prov === 'osm') ious.push(iou(ring, h.green.ring)); }
    results[k] = rings; console.log(`${k.padEnd(10)} median IoU vs the ${ious.length} surveyed greens ${median(ious).toFixed(2)}  min ${Math.min(...ious).toFixed(2)}  areas ${Object.values(rings).map(r => Math.round(area(r))).join(' ')}`);
  }
  if (out) { fs.writeFileSync(out, JSON.stringify(results)); console.log('wrote', out); }
}
