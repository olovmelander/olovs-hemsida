#!/usr/bin/env node
/* The ditches, read off the 1 m laser terrain.

   A drainage ditch is an incised channel in bare-earth data: a long positive
   ridge in the black top-hat (how far a cell lies below the surface that
   would fill its hollows, 13 m closing). Two uses here, the same as the
   Veckefjärden and Ängsö work:
   - the four SATELLITE-TRACED ditches are re-laid on the laser: each trace is
     walked vertex to vertex by least-cost path along the top-hat, and kept
     only where the channel reads >= 0.10 m deep (a culverted run is dropped
     from the drawn line, which is what a culvert looks like);
   - CROSSINGS the traces missed: the valley score (across-depth minus along-
     slope) sampled every metre along each traced hole route; a peak >= 0.4
     that is not water and not already a ditch is snapped and trimmed the
     same way.

     node ribbingsforsbuild/laser-ditches.mjs   -> laser-ditches.json */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from './laser-lib.mjs';
import { blackTopHat } from '../geobuild/dtm-lib.mjs';
import { pointInPoly, r1 } from '../geobuild/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const traces = JSON.parse(fs.readFileSync(path.join(HERE, 'surface-traces.json'), 'utf8'));
/* the satellite-traced ditches are read from the trace file, never from the
   model, so a rerun never re-lays laser on laser */
const sat = JSON.parse(fs.readFileSync(path.join(HERE, 'surroundings-traces.json'), 'utf8')).features;
const tracedDitches = [...sat.ditches.map(d => ({ line: d.line, w: d.w, prov: d.prov, name: d.name })), ...(sat.connectors || []).map(d => ({ line: d.line, w: d.w, prov: d.prov }))];
const T = loadTerrain();
const started = Date.now();
const th = blackTopHat(T, 6);
console.log(`top-hat over ${T.W}x${T.H} in ${Date.now() - started} ms`);
const thAt = (x, z) => { const i = T.cellOf(x, z); return i < 0 ? 0 : th[i]; };
const { hAt } = T;
const simplify = (P, tol) => { if (P.length < 3) return P; let md = 0, mi = 0; const A = P[0], B = P[P.length - 1]; for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - P[i][1]) - (A[0] - P[i][0]) * (B[1] - A[1])) / (Math.hypot(B[0] - A[0], B[1] - A[1]) || 1); if (d > md) { md = d; mi = i; } } if (md > tol) return [...simplify(P.slice(0, mi + 1), tol).slice(0, -1), ...simplify(P.slice(mi), tol)]; return [A, B]; };
const lineD = (x, z, L) => { let d = 1e9; for (let i = 0; i < L.length - 1; i++) { const A = L[i], B = L[i + 1]; const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - A[0]) * dx + (z - A[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t)); } return d; };

/* least-cost path along the channel bottom between two points, within a corridor */
function snap(a, b, corridor = 40) {
  const { W, H } = T;
  const ca = Math.round(a[0] - T.x0), ra = Math.round(a[1] - T.z0), cb = Math.round(b[0] - T.x0), rb = Math.round(b[1] - T.z0);
  const x0 = Math.max(0, Math.min(ca, cb) - corridor), x1 = Math.min(W - 1, Math.max(ca, cb) + corridor), y0 = Math.max(0, Math.min(ra, rb) - corridor), y1 = Math.min(H - 1, Math.max(ra, rb) + corridor);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const dist = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  const cost = i => 1 / (0.04 + Math.min(1.2, th[(y0 + ((i / w) | 0)) * W + x0 + (i % w)]));
  const s = (ra - y0) * w + (ca - x0), t = (rb - y0) * w + (cb - x0);
  dist[s] = 0; const heap = [[0, s]];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  while (heap.length) { const [d, i] = pop(); if (d > dist[i]) continue; if (i === t) break; const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx, nd = d + Math.hypot(dx, dy) * (cost(i) + cost(j)) / 2; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); } } }
  const pts = []; for (let i = t; i >= 0; i = prev[i]) { pts.push([T.x0 + x0 + (i % w), T.z0 + y0 + ((i / w) | 0)]); if (i === s) break; }
  pts.reverse();
  return pts;
}
/* keep the runs of a dense path where the channel is at least `floor` deep, bridging gaps under 6 m */
function deepRuns(pts, floor = 0.10, gapCells = 6) {
  const ok = pts.map(p => thAt(p[0], p[1]) >= floor);
  const runs = []; let start = -1, gap = 0;
  for (let i = 0; i < pts.length; i++) {
    if (ok[i]) { if (start < 0) start = i; gap = 0; }
    else if (start >= 0) { gap++; if (gap > gapCells) { runs.push(pts.slice(start, i - gap + 1)); start = -1; gap = 0; } }
  }
  if (start >= 0) runs.push(pts.slice(start).filter((p, i, arr) => i <= arr.length - 1 - 0));
  return runs.map(run => { while (run.length && !ok[pts.indexOf(run[run.length - 1])]) run.pop(); return run; }).filter(run => run.length >= 15);
}
const meanDepth = run => run.reduce((s, p) => s + thAt(p[0], p[1]), 0) / run.length;
const round = L => L.map(p => [r1(p[0]), r1(p[1])]);

/* ---- the traced ditches, re-laid on the laser ---- */
const refined = [];
for (const stream of tracedDitches) {
  const dense = [];
  for (let i = 0; i < stream.line.length - 1; i++) { const seg = snap(stream.line[i], stream.line[i + 1]); dense.push(...(i ? seg.slice(1) : seg)); }
  const runs = deepRuns(dense);
  const kept = runs.map(run => ({ line: round(simplify(run, 0.8)), meanDepth: +meanDepth(run).toFixed(2), length: Math.round(run.length) }));
  const total = kept.reduce((s, r) => s + r.length, 0), traced = dense.length;
  console.log(`${stream.name || 'connector'}: traced ${traced} m -> ${kept.length} laser run(s), ${total} m, depths ${kept.map(r => r.meanDepth).join('/') || '-'}`);
  refined.push({ name: stream.name || null, w: stream.w, prov: stream.prov, tracedLine: stream.line, runs: kept, tracedMetres: traced, laserMetres: total });
}

/* ---- crossings under the routes ---- */
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
const inWater = (x, z) => model.water.some(w => pointInPoly(x, z, w.ring));
const existing = refined.flatMap(r => r.runs.map(run => run.line));
const crossings = [];
for (const rt of traces.routes) {
  const L = rt.line; const segs = []; let total = 0; for (let i = 0; i < L.length - 1; i++) { const d = Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); segs.push(d); total += d; }
  const at = s => { let acc = 0; for (let i = 0; i < segs.length; i++) { if (s <= acc + segs[i]) { const t = (s - acc) / segs[i]; return [L[i][0] + (L[i + 1][0] - L[i][0]) * t, L[i][1] + (L[i + 1][1] - L[i][1]) * t]; } acc += segs[i]; } return L.at(-1); };
  const prof = [];
  for (let s = 8; s < total - 8; s += 1) { const [x, z] = at(s); const v = valley(x, z); prof.push({ s, x, z, score: v.s, dir: v.dir, toGreen: Math.round(total - s) }); }
  for (let i = 2; i < prof.length - 2; i++) {
    const p = prof[i];
    if (p.score < 0.4 || prof.slice(Math.max(0, i - 12), i + 13).some(q => q.score > p.score)) continue;
    if (inWater(p.x, p.z) || p.s < 30 || p.toGreen < 25) continue;
    if (existing.some(line => lineD(p.x, p.z, line) < 12)) continue;
    const d = p.dir;
    const dense = snap([p.x + d[0] * 45, p.z + d[1] * 45], [p.x - d[0] * 45, p.z - d[1] * 45]);
    const run = deepRuns(dense).find(run => lineD(p.x, p.z, run) < 3);
    if (!run || run.length < 30 || meanDepth(run) < 0.2) continue;
    const line = round(simplify(run, 0.8));
    if (crossings.some(c => lineD(p.x, p.z, c.line) < 12)) continue;
    crossings.push({ hole: rt.hole, line, meanDepth: +meanDepth(run).toFixed(2), crossesAt: p.toGreen, valleyScore: +p.score.toFixed(2), note: `crosses the traced route of hole ${rt.hole} ${p.toGreen} m from the green` });
    existing.push(line);
    console.log(`crossing on hole ${rt.hole}: ${p.toGreen} m from the green, score ${p.score.toFixed(2)}, depth ${meanDepth(run).toFixed(2)}, ${run.length} m`);
  }
}
fs.writeFileSync(path.join(HERE, 'laser-ditches.json'), JSON.stringify({
  schemaVersion: 1,
  source: `Lantmäteriet Markhöjdmodell 1 m as published for this ground (${T.tiles} tiles, RH 2000, identity frame), black top-hat with a 13 m closing; ribbingsforsbuild/laser-ditches.mjs 2026-09-05`,
  rules: { relay: 'each traced ditch walked vertex to vertex by least-cost path along the top-hat within 40 m; kept where >= 0.10 m deep, gaps under 6 m bridged, runs >= 15 m', crossing: 'valley score (across-depth minus 0.8 x along-slope over 8 directions) sampled every metre along each traced route; peaks >= 0.4 not in water, > 30 m from the tee and > 25 m from the green, > 12 m from a known ditch; snapped ±45 m and trimmed; runs >= 30 m and >= 0.2 m mean depth' },
  refined, crossings,
}, null, 1));
console.log(`wrote laser-ditches.json: ${refined.length} traces re-laid, ${crossings.length} crossings`);
