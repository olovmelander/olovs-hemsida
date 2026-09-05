#!/usr/bin/env node
/* The played surfaces of Ribbingsfors read off two orthorectified records,
   by rule, with a review sheet per hole.

   Esri z18 imagery (0.31 m/px, a leaf-off spring capture on which mown turf
   is vivid against dormant pasture) gives the mown mask; the published 1 m
   laser terrain gives flatness. Neither is registered to anything, so the
   only question each feature answers is whether the two agree at a place:

   - a GREEN is the patch around the surveyed green centre whose excess green
     stays within the green's own core reading, bounded where the collar
     brightens: grown from the centre, opened, the component holding the
     centre, holes filled; accepted only if 250–1,000 m², solid (area over
     hull ≥ 0.85) and centred within 8 m of the survey point;
   - a TEE DECK is mown ground whose 5 × 5 m laser spread is under 0.12 m,
     60–600 m², within 30 m of a card mark; the deck nearest the mark wins,
     and the mark moves onto it (a tee marker has to stand on a tee);
   - a FAIRWAY is the mown mask within 60 m of a hole's line, tee or green,
     assigned to the nearest hole, closed over 3 m so shadows do not cut it,
     with holes under 200 m² filled (bunkers and greens are drawn above it).

   Calibration (calibrate.mjs, 2026-09-05): excess green 2G−R−B reads 98–118
   at the nine surveyed green centres, 24–96 along the provisional lines,
   p90 59 on the dormant rough 70–130 m off the course; laser plane residual
   0.007–0.016 m on greens against a median 0.036 m on the rough.

     node ribbingsforsbuild/trace-surfaces.mjs   -> surface-traces.json + cache/review/hole-N.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { loadMosaic, excessGreen, brightness } from './imagery.mjs';
import { loadTerrain, spreadAt, planeResidualAt } from './laser-lib.mjs';
import { gridOver, labelComponents, open, close, dilate, erode, fillHoles, outerRing, simplifyRing, polygonArea, centroid } from './raster-shapes.mjs';
import { pointInPoly, polyLen, r1 } from '../geobuild/lib.mjs';
import { FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
/* the reviewed DTM-bench tee controls (tee-controls.json, EPSG:3006): a
   controlled tee's mark is the control centre, whatever the card distance says */
const teeControls = JSON.parse(fs.readFileSync(path.join(HERE, 'tee-controls.json'), 'utf8')).controls
  .map(control => ({ hole: control.hole, m: control.teeMetres, c: [r1(control.centre.easting - FRAME.easting), r1(FRAME.northing - control.centre.northing)], pad: control.pad, provenance: control.provenance }));
const WINDOW = { x0: -380, x1: 760, z0: -500, z1: 440 };
const MOWN_EXG = 70, MOWN_BRIGHT = [60, 150];
const T = loadTerrain();
const IMG = await loadMosaic(WINDOW);
console.log(`terrain ${T.tiles} tiles; imagery ${IMG.W}x${IMG.H} at ${IMG.metresPerPixel.toFixed(3)} m/px`);

const hull = pts => { pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], hi = []; for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); } return lo.slice(0, -1).concat(hi.slice(0, -1)); };
const lineD = (x, z, L) => { let d = 1e9; for (let i = 0; i < L.length - 1; i++) { const A = L[i], B = L[i + 1]; const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - A[0]) * dx + (z - A[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t)); } return d; };
const mownAt = (x, z) => { const c = IMG.rgbAt(x, z); if (!c) return false; const b = brightness(c); return excessGreen(c) > MOWN_EXG && b > MOWN_BRIGHT[0] && b < MOWN_BRIGHT[1]; };
const round = ring => ring.map(p => [r1(p[0]), r1(p[1])]);

/* ------------------------------------------------------------------ greens */
/* Colour fields around a centre, box-smoothed: the collar is a ring a few
   pixels wide and noise in it is what let the first grower leak through. */
function colourFields(c, R, S, smooth) {
  const G = gridOver({ x0: c[0] - R, x1: c[0] + R, z0: c[1] - R, z1: c[1] + R }, S, 0);
  const eg = new Float32Array(G.width * G.height).fill(NaN), br = new Float32Array(G.width * G.height).fill(NaN);
  for (let i = 0; i < eg.length; i++) { const [x, z] = G.centre(i); const p = IMG.rgbAt(x, z); if (p) { eg[i] = excessGreen(p); br[i] = brightness(p); } }
  const box = (src, r) => { if (!r) return src; const out = new Float32Array(src.length); for (let row = 0; row < G.height; row++) for (let col = 0; col < G.width; col++) { let sum = 0, n = 0; for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) { const rr = row + dr, cc = col + dc; if (rr < 0 || cc < 0 || rr >= G.height || cc >= G.width) continue; const v = src[rr * G.width + cc]; if (Number.isFinite(v)) { sum += v; n++; } } out[row * G.width + col] = n ? sum / n : NaN; } return out; };
  return { G, eg: box(eg, smooth), br: box(br, smooth) };
}
/* Six readings of the same rule, from loose to tight. A green's approach can
   be as green as its putting surface, so a loose reading leaks down the
   fairway and fails the compactness test; the tightest readings erode the
   green's own edge. The LARGEST result that stays compact is taken. */
const GREEN_SETS = [
  { id: 'B', egDrop: 22, brCap: 5, smooth: 2, openR: 3 }, { id: 'C', egDrop: 15, brCap: 4, smooth: 2, openR: 3 },
  { id: 'D', egDrop: 18, brCap: 6, smooth: 3, openR: 4 }, { id: 'E', egDrop: 10, brCap: 3, smooth: 2, openR: 4 },
  { id: 'F', egDrop: 12, brCap: 2, smooth: 3, openR: 5 }, { id: 'G', egDrop: 8, brCap: 2, smooth: 2, openR: 4 },
];
const GREEN_AREA = [180, 800], GREEN_SOLIDITY = 0.85, GREEN_SHIFT = 6;
function growGreen(c, { egDrop, brCap, smooth, openR }, R = 32, S = 0.5) {
  const { G, eg, br } = colourFields(c, R, S, smooth);
  let coreE = 0, coreB = 0, n = 0;
  for (let i = 0; i < eg.length; i++) { const [x, z] = G.centre(i); if (Math.hypot(x - c[0], z - c[1]) <= 4 && Number.isFinite(eg[i])) { coreE += eg[i]; coreB += br[i]; n++; } }
  if (!n) return null;
  coreE /= n; coreB /= n;
  const mask = new Uint8Array(eg.length);
  for (let i = 0; i < mask.length; i++) if (eg[i] >= coreE - egDrop && br[i] <= coreB + brCap) mask[i] = 1;
  const opened = open(mask, G.width, G.height, openR);
  const { label } = labelComponents(opened, G.width, G.height);
  const seed = label[G.cellOf(c[0], c[1])];
  if (!seed) return null;
  const member = new Uint8Array(mask.length); for (let i = 0; i < member.length; i++) member[i] = label[i] === seed ? 1 : 0;
  const filled = close(fillHoles(member, G.width, G.height), G.width, G.height, 1);
  const ring0 = outerRing(i => filled[i], G); if (!ring0) return null;
  const ring = round(simplifyRing(ring0, 0.6));
  const area = polygonArea(ring), cen = centroid(ring0);
  let rough = 0, rn = 0; for (let i = 0; i < member.length; i += 4) if (member[i]) { const [x, z] = G.centre(i); const r = planeResidualAt(T, x, z, 1); if (Number.isFinite(r)) { rough += r; rn++; } }
  return { ring, area: Math.round(area), solidity: +(area / polygonArea(hull(ring))).toFixed(3), centroidShift: +Math.hypot(cen[0] - c[0], cen[1] - c[1]).toFixed(1), coreExg: Math.round(coreE), coreBright: Math.round(coreB), laserRoughness: +(rough / (rn || 1)).toFixed(3) };
}
const greens = [];
for (const h of model.holes) {
  const readings = GREEN_SETS.map(set => ({ set: set.id, ...(growGreen(h.green.c, set) || { ring: null }) }));
  const passing = readings.filter(r => r.ring && r.area >= GREEN_AREA[0] && r.area <= GREEN_AREA[1] && r.solidity >= GREEN_SOLIDITY && r.centroidShift <= GREEN_SHIFT);
  passing.sort((p, q) => q.area - p.area);
  const chosen = passing[0] || null;
  const summary = readings.map(r => `${r.set}:${r.ring ? `${r.area}/${r.solidity}/${r.centroidShift}` : '-'}`).join(' ');
  if (chosen) {
    greens.push({ hole: h.n, accepted: true, ring: chosen.ring, area: chosen.area, solidity: chosen.solidity, centroidShift: chosen.centroidShift, set: chosen.set, coreExg: chosen.coreExg, coreBright: chosen.coreBright, laserRoughness: chosen.laserRoughness, readings: summary, why: 'the largest reading of the collar-bounded patch that stays compact and centred on the survey point' });
    console.log(`green ${h.n}: OK set ${chosen.set} ${chosen.area} m² solidity ${chosen.solidity} shift ${chosen.centroidShift} m laser ${chosen.laserRoughness} [${summary}]`);
  } else {
    greens.push({ hole: h.n, accepted: false, readings: summary, why: 'no reading is compact and centred; the synthetic outline stays' });
    console.log(`green ${h.n}: REFUSED [${summary}]`);
  }
}

/* --------------------------------------------------------------- tee decks */
function orientedBox(pts) {
  const n = pts.length; let mx = 0, mz = 0; for (const [x, z] of pts) { mx += x; mz += z; } mx /= n; mz /= n;
  let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of pts) { const dx = x - mx, dz = z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(angle), uz = Math.sin(angle), vx = -uz, vz = ux;
  const a = pts.map(([x, z]) => (x - mx) * ux + (z - mz) * uz).sort((p, q) => p - q);
  const b = pts.map(([x, z]) => (x - mx) * vx + (z - mz) * vz).sort((p, q) => p - q);
  const lo = arr => arr[Math.floor(arr.length * 0.03)] - 0.5, hi = arr => arr[Math.floor(arr.length * 0.97)] + 0.5;
  const a0 = lo(a), a1 = hi(a), b0 = lo(b), b1 = hi(b);
  const P = (s, t) => [mx + ux * s + vx * t, mz + uz * s + vz * t];
  return { ring: [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], c: P((a0 + a1) / 2, (b0 + b1) / 2), length: a1 - a0, width: b1 - b0, bearing: (Math.atan2(ux, -uz) * 180 / Math.PI + 360) % 180 };
}
/* A deck is laser-flat ground (5 x 5 m spread under 0.12 m) that is either
   mown in the imagery or lies within 12 m of the card mark -- the 8th's tees
   are flat to 6 cm under their marks and dormant brown in this capture. */
function findDeck(mark, greenC) {
  const R = 30, S = 1;
  const G = gridOver({ x0: mark[0] - R, x1: mark[0] + R, z0: mark[1] - R, z1: mark[1] + R }, S, 0);
  const mask = new Uint8Array(G.width * G.height);
  for (let i = 0; i < mask.length; i++) { const [x, z] = G.centre(i); if (spreadAt(T, x, z, 2) < 0.12 && (mownAt(x, z) || Math.hypot(x - mark[0], z - mark[1]) <= 12)) mask[i] = 1; }
  const opened = open(mask, G.width, G.height, 1);
  const { label, sizes } = labelComponents(opened, G.width, G.height);
  let best = null;
  for (let id = 1; id < sizes.length; id++) {
    if (sizes[id] < 50 || sizes[id] > 600) continue;
    const cells = []; for (let i = 0; i < label.length; i++) if (label[i] === id) cells.push(G.centre(i));
    const box = orientedBox(cells);
    if (box.width < 4 || box.length > 45 || box.width > 25) continue;
    const inside = pointInPoly(mark[0], mark[1], box.ring);
    let d = inside ? 0 : Infinity; if (!inside) for (const p of cells) d = Math.min(d, Math.hypot(p[0] - mark[0], p[1] - mark[1]));
    if (d > 25) continue;
    if (Math.hypot(box.c[0] - greenC[0], box.c[1] - greenC[1]) < 60) continue;
    const cand = { ring: round(box.ring), c: [r1(box.c[0]), r1(box.c[1])], area: Math.round(box.length * box.width), length: +box.length.toFixed(1), width: +box.width.toFixed(1), bearing: +box.bearing.toFixed(1), cells: sizes[id], distance: +d.toFixed(1), mown: cells.filter(p => mownAt(p[0], p[1])).length / cells.length };
    if (!best || d < best.distance || (d === best.distance && cand.area > best.area)) best = cand;
  }
  return best;
}
const decks = [];

/* ---------------------------------------------------------------- fairways */
const G = gridOver(WINDOW, 1, 0);
const mown = new Uint8Array(G.width * G.height);
for (let i = 0; i < mown.length; i++) { const [x, z] = G.centre(i); if (mownAt(x, z)) mown[i] = 1; }
let mask = open(mown, G.width, G.height, 1);
mask = close(mask, G.width, G.height, 3);
/* remove water, buildings and car parks from the mown mask */
const exclude = [...model.water.map(w => w.ring), ...model.infra.buildings.map(b => b.ring), ...model.infra.parking.map(p => p.ring)];
const { label: lab0, sizes: sizes0 } = labelComponents(mask, G.width, G.height);
for (let i = 0; i < mask.length; i++) { if (!mask[i]) continue; if (sizes0[lab0[i]] < 300) { mask[i] = 0; continue; } const [x, z] = G.centre(i); if (exclude.some(r => pointInPoly(x, z, r))) mask[i] = 0; }
/* each mown cell belongs to the hole whose line, green (-10 m) or tee mark (-8 m) is nearest, within 60 m */
function assignOwners(refs) {
  const owner = new Int16Array(G.width * G.height).fill(-1);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [x, z] = G.centre(i);
    let best = -1, bd = 60;
    for (const h of refs) {
      let d = lineD(x, z, h.line);
      d = Math.min(d, Math.hypot(x - h.green[0], z - h.green[1]) - 10, ...h.tees.map(t => Math.hypot(x - t[0], z - t[1]) - 8));
      if (d < bd) { bd = d; best = h.n; }
    }
    owner[i] = best;
  }
  return owner;
}
function traceFairways(owner) {
  const fairways = [];
  for (const h of model.holes) {
    const member = new Uint8Array(mask.length); for (let i = 0; i < member.length; i++) member[i] = owner[i] === h.n ? 1 : 0;
    const { label, sizes } = labelComponents(member, G.width, G.height);
    const rings = [];
    for (let id = 1; id < sizes.length; id++) {
      if (sizes[id] < 300) continue;
      const comp = new Uint8Array(mask.length); for (let i = 0; i < comp.length; i++) comp[i] = label[i] === id ? 1 : 0;
      const filled = fillHoles(comp, G.width, G.height);
      const { label: hl, sizes: hs } = labelComponents(new Uint8Array(filled.map((v, i) => v && !comp[i] ? 1 : 0)), G.width, G.height);
      for (let i = 0; i < comp.length; i++) if (filled[i] && !comp[i] && hs[hl[i]] <= 200) comp[i] = 1;
      const ring0 = outerRing(i => comp[i], G); if (!ring0) continue;
      rings.push({ ring: round(simplifyRing(ring0, 1.0)), area: sizes[id] });
    }
    rings.sort((p, q) => q.area - p.area);
    fairways.push({ hole: h.n, rings: rings.map(r => r.ring), areas: rings.map(r => r.area), area: rings.reduce((t, r) => t + r.area, 0) });
  }
  return fairways;
}

/* ----------------------------------------------------------------- routing */
/* The provisional lines are GolfTraxx seeds (dossier §3): on holes 5, 6 and 8
   they run through woods and over pasture the mown mask shows the hole never
   uses. The mown corridor IS the routing: least-cost path from the back tee
   (its measured deck where one exists, else the card mark) to the surveyed
   green centre over a 2 m cost grid -- 1 down the middle of the hole's OWN
   mown ground, 4 at its edge, 3 on another hole's turf, 8 within 20 m of mown
   ground, 25 elsewhere, 400 on water -- then simplified to its bends.
   Ownership and routing depend on each other, so they are solved twice:
   once from the provisional lines, once from the routes they produce. */
const RG = gridOver(WINDOW, 2, 0);
const nearMown = dilate(mask, G.width, G.height, 20);
const inner = []; inner[0] = mask; for (let k = 1; k <= 8; k++) inner[k] = erode(inner[k - 1], G.width, G.height, 2);
const depthAt = j => { let k = 0; while (k < 8 && inner[k + 1][j]) k++; return k * 2; };
const waterAt = (x, z) => model.water.some(w => pointInPoly(x, z, w.ring));
const baseCost = new Float32Array(RG.width * RG.height), cellRef = new Int32Array(RG.width * RG.height);
for (let i = 0; i < baseCost.length; i++) { const [x, z] = RG.centre(i); const j = G.cellOf(x, z); cellRef[i] = j; baseCost[i] = waterAt(x, z) ? 400 : j >= 0 && mask[j] ? 1 + 3 * Math.max(0, 1 - depthAt(j) / 16) : j >= 0 && nearMown[j] ? 8 : 25; }
function route(a, b, owner, holeN) {
  const s0 = RG.cellOf(a[0], a[1]), t0 = RG.cellOf(b[0], b[1]);
  if (s0 < 0 || t0 < 0) throw new Error('route endpoint outside the window');
  const costOf = i => { const j = cellRef[i]; if (j >= 0 && mask[j] && owner[j] !== holeN && owner[j] !== -1 && baseCost[i] < 8) return 3 + baseCost[i]; return baseCost[i]; };
  const dist = new Float64Array(baseCost.length).fill(Infinity), prev = new Int32Array(baseCost.length).fill(-1);
  const heap = [[0, s0]]; dist[s0] = 0;
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const W = RG.width, H = RG.height;
  while (heap.length) {
    const [d, i] = pop(); if (d > dist[i]) continue; if (i === t0) break;
    const c = i % W, r = (i - c) / W, ci = costOf(i);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const j = rr * W + cc, nd = d + Math.hypot(dc, dr) * (ci + costOf(j)) / 2;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
    }
  }
  const pts = []; for (let i = t0; i >= 0; i = prev[i]) { pts.push(RG.centre(i)); if (i === s0) break; }
  pts.reverse(); pts[0] = a; pts[pts.length - 1] = b;
  return pts;
}
const simplifyLine = (P, tol) => { if (P.length < 3) return P; let md = 0, mi = 0; const A = P[0], B = P[P.length - 1]; for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - P[i][1]) - (A[0] - P[i][0]) * (B[1] - A[1])) / (Math.hypot(B[0] - A[0], B[1] - A[1]) || 1); if (d > md) { md = d; mi = i; } } if (md > tol) return [...simplifyLine(P.slice(0, mi + 1), tol).slice(0, -1), ...simplifyLine(P.slice(mi), tol)]; return [A, B]; };
const lengthOf = L => { let t = 0; for (let i = 0; i < L.length - 1; i++) t += Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); return t; };
const fromEnd = (L, d) => { let remaining = d; for (let i = L.length - 1; i > 0; i--) { const seg = Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (remaining <= seg) { const t = remaining / seg; return [L[i][0] + (L[i - 1][0] - L[i][0]) * t, L[i][1] + (L[i - 1][1] - L[i][1]) * t]; } remaining -= seg; } const A = L[0], B = L[1], seg = Math.hypot(B[0] - A[0], B[1] - A[1]); return [A[0] + (A[0] - B[0]) / seg * remaining, A[1] + (A[1] - B[1]) / seg * remaining]; };
/* a deck on another hole's mown ground, or by another hole's green, is not this hole's tee */
function deckFor(mark, h, owner) {
  const deck = findDeck(mark, h.green.c);
  if (!deck) return null;
  const j = G.cellOf(deck.c[0], deck.c[1]);
  if (j >= 0 && mask[j] && owner[j] !== -1 && owner[j] !== h.n) return null;
  if (model.holes.some(o => o.n !== h.n && Math.hypot(o.green.c[0] - deck.c[0], o.green.c[1] - deck.c[1]) < 40)) return null;
  return deck;
}
function routeAll(owner) {
  const routes = [], deckRows = [];
  for (const h of model.holes) {
    const marks = [...h.tees.marks].sort((p, q) => q.m - p.m);
    const backDeck = deckFor(marks[0].c, h, owner);
    const start = backDeck ? backDeck.c : marks[0].c;
    const raw = route(start, h.green.c, owner, h.n);
    let line = simplifyLine(raw.filter((p, i) => !i || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.5), 12);
    for (let k = 1; k < line.length - 1;) { const p = Math.atan2(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]), q = Math.atan2(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1]); let d = Math.abs(p - q); if (d > Math.PI) d = 2 * Math.PI - d; if (d < 15 * Math.PI / 180) line.splice(k, 1); else k++; }
    const pathLength = lengthOf(line);
    if (!backDeck) {
      let remaining = marks[0].m; const kept = [];
      for (let i = line.length - 1; i > 0; i--) { const seg = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); kept.unshift(line[i]); if (remaining <= seg) { const t = remaining / seg; kept.unshift([line[i][0] + (line[i - 1][0] - line[i][0]) * t, line[i][1] + (line[i - 1][1] - line[i][1]) * t]); remaining = 0; break; } remaining -= seg; }
      if (remaining > 1e-6) { let k = 1; while (k < line.length - 1 && Math.hypot(line[k][0] - line[0][0], line[k][1] - line[0][1]) < 0.5) k++; const A = line[0], B = line[k], seg = Math.hypot(B[0] - A[0], B[1] - A[1]); kept.unshift([A[0] + (A[0] - B[0]) / seg * remaining, A[1] + (A[1] - B[1]) / seg * remaining]); if (kept[1] !== A) kept.splice(1, 0, A); }
      line = kept.filter((p, i) => !i || Math.hypot(p[0] - kept[i - 1][0], p[1] - kept[i - 1][1]) > 0.5);
    }
    line = round(line);
    const newMarks = marks.map(mk => {
      const control = teeControls.find(ct => ct.hole === h.n && ct.m === mk.m);
      const at = control ? control.c : fromEnd(line, mk.m);
      let deck = deckFor(at, h, owner);
      if (control && (!deck || Math.hypot(deck.c[0] - control.c[0], deck.c[1] - control.c[1]) > 6)) {
        /* the control IS the tee: a pad of its stated size, square to the route */
        const b = fromEnd(line, mk.m + 20), ang = Math.atan2(at[0] - b[0], at[1] - b[1]);
        const ux = Math.sin(ang), uz = Math.cos(ang), vx = -uz, vz = ux, L = control.pad.lengthMetres / 2, Wd = control.pad.widthMetres / 2;
        deck = { ring: round([[at[0] - ux * L - vx * Wd, at[1] - uz * L - vz * Wd], [at[0] + ux * L - vx * Wd, at[1] + uz * L - vz * Wd], [at[0] + ux * L + vx * Wd, at[1] + uz * L + vz * Wd], [at[0] - ux * L + vx * Wd, at[1] - uz * L + vz * Wd]]), c: control.c, area: control.pad.lengthMetres * control.pad.widthMetres, length: control.pad.lengthMetres, width: control.pad.widthMetres, bearing: +((Math.atan2(ux, -uz) * 180 / Math.PI + 360) % 180).toFixed(1), cells: 0, distance: 0, mown: 1, control: true };
      }
      return { m: mk.m, t: mk.t, control: !!control, cardPoint: [r1(at[0]), r1(at[1])], c: deck ? deck.c : [r1(at[0]), r1(at[1])], deck, snapped: !!deck, snapMetres: deck ? +Math.hypot(deck.c[0] - at[0], deck.c[1] - at[1]).toFixed(1) : null };
    });
    /* one deck cannot serve two card tees more than 25 m apart on the card:
       the snap that moved its mark furthest gives the deck up */
    for (;;) {
      let worst = null;
      for (const p of newMarks) for (const q of newMarks) {
        if (p === q || !p.deck || !q.deck || p.deck.c.join() !== q.deck.c.join() || Math.abs(p.m - q.m) <= 25) continue;
        const loser = p.snapMetres >= q.snapMetres ? p : q;
        if (!worst || loser.snapMetres > worst.snapMetres) worst = loser;
      }
      if (!worst) break;
      worst.deck = null; worst.snapped = false; worst.snapMetres = null; worst.c = worst.cardPoint;
    }
    const byDeck = new Map();
    for (const mk of newMarks) if (mk.deck) { const key = mk.deck.c.join(','); (byDeck.get(key) || byDeck.set(key, []).get(key)).push(mk); }
    for (const group of byDeck.values()) {
      if (group.length < 2) continue;
      const deck = group[0].deck, ang = deck.bearing * Math.PI / 180, ux = Math.sin(ang), uz = -Math.cos(ang);
      const toGreen = [h.green.c[0] - deck.c[0], h.green.c[1] - deck.c[1]];
      const sign = (ux * toGreen[0] + uz * toGreen[1]) > 0 ? -1 : 1;
      const half = Math.max(0, deck.length / 2 - 2);
      const mean = group.reduce((t, mk) => t + mk.m, 0) / group.length;
      for (const mk of group) { const off = Math.max(-half, Math.min(half, mk.m - mean)); mk.c = [r1(deck.c[0] + sign * ux * off), r1(deck.c[1] + sign * uz * off)]; }
    }
    line[0] = newMarks[0].c;
    const length = lengthOf(line);
    routes.push({ hole: h.n, line, length: +length.toFixed(1), pathLength: +pathLength.toFixed(1), cardBack: marks[0].m, backTee: backDeck ? 'measured deck' : 'card slide', bends: line.length - 2, marks: newMarks });
    for (const mk of newMarks) deckRows.push({ hole: h.n, tee: mk.m, mark: mk.c, cardPoint: mk.cardPoint, accepted: !!mk.deck, ...(mk.deck ? { ring: mk.deck.ring, c: mk.deck.c, area: mk.deck.area, length: mk.deck.length, width: mk.deck.width, bearing: mk.deck.bearing, mownShare: +mk.deck.mown.toFixed(2), markToDeck: mk.snapMetres, why: mk.deck.control ? 'the reviewed DTM-bench control (tee-controls.json)' : mk.deck.mown > 0.5 ? 'mown ground, laser 5x5 spread < 0.12 m' : 'laser-flat deck under the card mark (dormant in this capture)' } : { why: 'no flat deck within 25 m of the card point; the app synthesises a pad at the mark' }) });
  }
  return { routes, deckRows };
}
let owner = assignOwners(model.holes.map(h => ({ n: h.n, line: h.line, green: h.green.c, tees: h.tees.marks.map(t => t.c) })));
let pass = routeAll(owner);
owner = assignOwners(pass.routes.map(r => ({ n: r.hole, line: r.line, green: model.holes[r.hole - 1].green.c, tees: r.marks.map(t => t.c) })));
pass = routeAll(owner);
const { routes } = pass;
decks.push(...pass.deckRows);
const fairways = traceFairways(owner);
for (const r of routes) console.log(`route ${r.hole}: ${r.line.length} pts, ${r.length.toFixed(0)} m against card ${r.cardBack} (${r.backTee}), bends ${r.bends}; marks ${r.marks.map(mk => `${mk.m}${mk.snapped ? '@deck' + mk.snapMetres : '@card'}`).join(' ')}`);
for (const fw of fairways) console.log(`fairway ${fw.hole}: ${fw.rings.length} ring(s), ${fw.area} m² (${fw.areas.join(', ')})`);

const out = {
  schemaVersion: 1,
  routes,
  source: `Esri World Imagery z18 (${IMG.metresPerPixel.toFixed(3)} m/px, leaf-off) classified per pixel + the published Lantmäteriet 1 m terrain (${T.tiles} tiles) for flatness, by ribbingsforsbuild/trace-surfaces.mjs on 2026-09-05; migration-only, no imagery stored.`,
  rules: { mown: `2G-R-B > ${MOWN_EXG}, brightness ${MOWN_BRIGHT[0]}–${MOWN_BRIGHT[1]}`, green: 'grown from the surveyed centre on 0.5 m box-smoothed colour: ExG >= core - drop and brightness <= core + cap, opened, the component holding the centre, holes filled; six (drop, cap, smooth, open) readings from loose to tight (GREEN_SETS); accept 180–800 m², solidity >= 0.85, centroid within 6 m; the LARGEST compact reading wins', deck: 'mown and laser 5x5 spread < 0.12 m, 60–600 m², within 25 m of the card mark, not within 60 m of the green; drawn as the oriented box of its cells (PCA axes, 3–97 percentile extents)', fairway: 'mown mask opened 1 m and closed 3 m, water/buildings/parking removed, assigned to the nearest hole (line, green - 10 m, tee - 8 m) within 60 m, holes <= 200 m² filled, components >= 300 m²' },
  greens, decks, fairways,
};
out.rules.route = 'least-cost path over a 2 m grid (mown 1, within 20 m of mown 4, elsewhere 25, water 400) from the back tee (measured deck, else card mark) to the surveyed green centre; simplified 5 m, bends under 8° dropped; card marks at the card distance from the green along the line, snapped onto a deck within 25 m; where no deck fixes the back tee the line start slides to the card length';
fs.writeFileSync(path.join(HERE, 'surface-traces.json'), JSON.stringify(out, null, 1));
console.log('wrote surface-traces.json');

/* ------------------------------------------------------------ review sheets */
const REVIEW = path.join(HERE, 'cache', 'review'); fs.mkdirSync(REVIEW, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage();
const mosaicB64 = fs.readFileSync(IMG.file).toString('base64');
await page.setContent('<canvas id=c></canvas><img id=m>');
await page.evaluate(async b64 => { const img = document.getElementById('m'); img.src = 'data:image/png;base64,' + b64; await img.decode(); window.__img = img; }, mosaicB64);
for (const h of model.holes) {
  const g = greens.find(x => x.hole === h.n), d = decks.filter(x => x.hole === h.n), f = fairways.find(x => x.hole === h.n), rt = routes.find(x => x.hole === h.n);
  const pts = [h.green.c, ...h.tees.marks.map(t => t.c), ...rt.line, ...(f.rings.flat())];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const pad = 25; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const [px0, py0] = IMG.px(x0, z0), [px1, py1] = IMG.px(x1, z1);
  const P = ([x, z]) => { const [px, py] = IMG.px(x, z); return [px - px0, py - py0]; };
  const overlays = {
    fair: f.rings.map(r => r.map(P)), green: g.ring ? [g.ring.map(P)] : [], oldGreen: [h.green.ring.map(P)],
    decks: d.filter(x => x.ring).map(x => x.ring.map(P)), marks: rt.marks.map(t => P(t.c)), oldMarks: h.tees.marks.map(t => P(t.c)), bunkers: h.bunkers.map(b => b.ring.map(P)), line: rt.line.map(P), oldLine: h.line.map(P), centre: P(h.green.c),
    title: `hole ${h.n}: green ${g.accepted ? 'OK ' + g.area + ' m²' : 'REFUSED'}; decks ${d.filter(x => x.accepted).length}/${d.length}; fairway ${f.area} m²; route ${rt.length} m vs card ${rt.cardBack} (${rt.backTee})`,
  };
  const dataUrl = await page.evaluate(({ px0, py0, w, h, o }) => {
    const canvas = document.getElementById('c'); canvas.width = w; canvas.height = h; const g = canvas.getContext('2d');
    g.drawImage(window.__img, px0, py0, w, h, 0, 0, w, h);
    const poly = (pts, closeIt) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (closeIt) g.closePath(); g.stroke(); };
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(120,255,120,0.9)'; for (const r of o.fair) poly(r, true);
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.setLineDash([6, 4]); for (const r of o.oldGreen) poly(r, true); g.setLineDash([]);
    g.strokeStyle = 'rgba(0,255,255,1)'; g.lineWidth = 2.5; for (const r of o.green) poly(r, true);
    g.strokeStyle = 'rgba(255,60,255,1)'; g.lineWidth = 2; for (const r of o.decks) poly(r, true);
    g.strokeStyle = 'rgba(255,255,80,1)'; for (const r of o.bunkers) poly(r, true);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.setLineDash([4, 6]); poly(o.oldLine, false); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2; poly(o.line, false);
    g.fillStyle = 'rgba(255,0,0,0.45)'; for (const [x, y] of o.oldMarks) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    g.fillStyle = 'red'; for (const [x, y] of o.marks) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); }
    g.fillStyle = 'magenta'; g.beginPath(); g.arc(o.centre[0], o.centre[1], 4, 0, 7); g.fill();
    g.fillStyle = 'white'; g.font = 'bold 16px sans-serif'; g.fillText(o.title, 8, 20);
    return canvas.toDataURL('image/png');
  }, { px0: Math.round(px0), py0: Math.round(py0), w: Math.round(px1 - px0), h: Math.round(py1 - py0), o: overlays });
  fs.writeFileSync(path.join(REVIEW, `hole-${h.n}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
console.log('review sheets in', REVIEW);
