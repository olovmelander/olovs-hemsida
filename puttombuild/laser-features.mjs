/* What the laser ground says about Puttom that no other record does.

   Reads the PUBLISHED 1 m v2 terrain (the 64 level-zero tiles of the live
   ground manifest, Lantmäteriet's Markhöjdmodell in RH 2000) through the same
   bridge the app uses, and measures the course against it in the legacy frame:

     - every water ring's laser level, and which lakes carry which names --
       each name is a Wikipedia coordinate that must fall INSIDE its ring, so
       a name cannot land on the wrong lake (reconcile.mjs used to name the two
       LARGEST rings Stor- and Lill-Rössjön; both are 4 km off the course);
     - the laser water plate of the two on-course lakes against the OSM ring,
       and every tee mark that stands on that plate (holes 12, 14, 15, 16: the
       card-length marks along a line that crosses a bay land in the water);
     - tee and green heights on the laser, next to the pack's Terrarium ones
       (hole 7's Terrarium green is canopy, 7 m above the ground);
     - the ditches: linear depressions extracted from a 9 m residual, kept
       where they cross or run beside a hole line -- the tvärdiken the club's
       local rules and hole plans name on 1, 10, 16, 18 and the bridges on
       8, 10, 13, 18, none of which OSM has.

   Writes puttombuild/laser-features.json, which reconcile.mjs folds into the
   model (names, elevations, ditches as narrow streams, the shore-slide of
   marks that stand in water). Re-run after a ground publish; the record
   carries the ground manifest it was measured on.
     node puttombuild/laser-features.mjs                                      */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../apps/golf/src/engine/v2-puttom-preview.mjs';
import { lonLatToXZ, centroid, pointInPoly, distToLine, readJSON, writeJSON, r1, ORIGIN } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUB = path.join(ROOT, 'apps', 'golf', 'public');
const model = readJSON(path.join(HERE, 'course-model.json'));

/* --- the published ground, through the live root index ------------------------ */
const root = readJSON(path.join(PUB, 'courses', 'v2-index.json'));
const entry = root.courses.find(c => c.slug === 'puttom');
const courseManifest = readJSON(path.join(PUB, entry.manifest.url));
const groundManifest = readJSON(path.join(PUB, courseManifest.groundManifest.url));
const l0 = groundManifest.tiles.filter(t => t.id.startsWith('l0/'));
const E0 = Math.min(...l0.map(t => t.bounds.minEasting)), N0 = Math.max(...l0.map(t => t.bounds.maxNorthing));
const E1 = Math.max(...l0.map(t => t.bounds.maxEasting)), N1 = Math.min(...l0.map(t => t.bounds.minNorthing));
const W = Math.round(E1 - E0) + 1, Hn = Math.round(N0 - N1) + 1;
const G = new Float32Array(W * Hn).fill(NaN);
for (const t of l0) {
  const ch = readChunk(fs.readFileSync(path.join(PUB, t.layers.terrain.url)));
  const grid = ch.envelope?.header?.grid || ch.header?.grid;
  const hts = decodeTerrainGrid(ch.payload, grid);
  const ci = Math.round(t.bounds.minEasting - E0), rj = Math.round(N0 - t.bounds.maxNorthing);
  for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) G[(rj + j) * W + ci + i] = hts[j * grid.width + i];
}

/* --- the bridge: the app's own, from the frame's own constants ---------------- */
const LEG = PUTTOM_PREVIEW_CONFIG.legacyFrame;
const bridge = legacyGridBridge(LEG);
const OE = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.easting, ON = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.northing;
const VOFF = LEG.verticalDatumOffsetMetres;
function sampleEN(e, n) {
  const fx = e - E0, fz = N0 - n; const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= W - 1 || j >= Hn - 1) return NaN;
  const a = G[j * W + i], b = G[j * W + i + 1], c = G[(j + 1) * W + i], d = G[(j + 1) * W + i + 1];
  const tx = fx - i, tz = fz - j;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
/* RH 2000 at a legacy-frame point */
function laser(x, z) { const [gx, gz] = bridge.toGrid(x, z); return sampleEN(OE + gx, ON - gz); }

const inR = (p, r) => pointInPoly(p[0], p[1], r);
const segD = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t); };
const ringSD = (p, r) => { let d = 1e9; for (let i = 0; i < r.length; i++) d = Math.min(d, segD(p, r[i], r[(i + 1) % r.length])); return (inR(p, r) ? -1 : 1) * d; };
const lineD = (p, l) => { let d = 1e9; for (let i = 0; i < l.length - 1; i++) d = Math.min(d, segD(p, l[i], l[i + 1])); return d; };

/* --- water: names that must land inside their ring, and laser levels ---------- */
/* sv.wikipedia "Insjöfakta Sverige" infoboxes (SMHI/SVAR lake register), read
   2026-09-05. The coordinate is the register's, the SVAR height its "höjd". */
const WIKI = [
  { name: 'Stor-Rössjön', lat: 63.29677, lon: 18.94202, svarHeight: 39, sjoid: '702502-165721', areaKm2: 0.144 },
  { name: 'Lill-Rössjön', lat: 63.30116, lon: 18.93392, svarHeight: 38, sjoid: '702537-165674', areaKm2: 0.113 },
  { name: 'Ovansjösjön', lat: 63.30188, lon: 18.91344, svarHeight: 27, sjoid: '702466-165529', areaKm2: 0.401 },
  { name: 'Högbysjön', lat: 63.32824, lon: 18.88632, svarHeight: 42.1, sjoid: '702669-165541', areaKm2: 1.11 },
  { name: 'Norrtjärnen', lat: 63.3192, lon: 18.9487 },
  { name: 'Tävrasjön', lat: 63.3068, lon: 18.9757 },
  { name: 'Kroktjärnen', lat: 63.3092, lon: 18.9554 },
  { name: 'Långtjärnen', lat: 63.2861, lon: 18.9624 },
  { name: 'Trättjärnen', lat: 63.2875, lon: 18.9189 },
  { name: 'Hjältatjärnen', lat: 63.3144, lon: 18.9398 },
  { name: 'Bursjötjärnen', lat: 63.2817, lon: 18.9186 },
  { name: 'Görtjärnen', lat: 63.2867, lon: 18.9280 },
];
const water = [];
for (const w of model.water) {
  const hits = WIKI.filter(k => inR(lonLatToXZ(k.lon, k.lat), w.ring));
  if (hits.length > 1) throw new Error(`${w.id}: two names fall inside one ring (${hits.map(h => h.name).join(', ')})`);
  const s = [];
  const bb = w.ring.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  for (let z = bb[1]; z <= bb[3]; z += 4) for (let x = bb[0]; x <= bb[2]; x += 4) { if (!inR([x, z], w.ring)) continue; const v = laser(x, z); if (Number.isFinite(v)) s.push(v); }
  s.sort((a, b) => a - b);
  const lvl = s.length ? s[s.length >> 1] : null;
  water.push({ id: w.id, name: hits[0]?.name ?? null, svarHeight: hits[0]?.svarHeight ?? null, sjoid: hits[0]?.sjoid ?? null,
    areaHa: r1(w.area / 1e4), packLevel: w.level,
    laserLevelRH2000: lvl == null ? null : Math.round(lvl * 100) / 100,
    laserLevelLegacy: lvl == null ? null : Math.round((lvl + VOFF) * 100) / 100,
    laserSpread: s.length ? Math.round((s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]) * 100) / 100 : null,
    laserSamples: s.length });
}
for (const k of WIKI) if (!water.some(w => w.name === k.name)) throw new Error(`${k.name} falls in no water ring`);

/* --- the laser water plate of the on-course lakes, and marks standing on it --- */
const plates = [];
const marksOnWater = [];
for (const id of ['w185976257', 'w227300000']) {
  const w = model.water.find(x => x.id === id), rec = water.find(x => x.id === id);
  const r = w.ring, lvl = rec.laserLevelRH2000;
  const bb = r.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  const X0 = Math.floor(bb[0]) - 40, Z0 = Math.floor(bb[1]) - 40, NX = Math.ceil(bb[2] - bb[0]) + 80, NZ = Math.ceil(bb[3] - bb[1]) + 80;
  const Hg = new Float32Array(NX * NZ); for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) Hg[j * NX + i] = laser(X0 + i, Z0 + j);
  const c = centroid(r); const flat = new Uint8Array(NX * NZ); const st = [[Math.round(c[0] - X0), Math.round(c[1] - Z0)]]; flat[st[0][1] * NX + st[0][0]] = 1; let n = 0;
  while (st.length) { const [i, j] = st.pop(); n++; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue; const k = b * NX + a; if (flat[k] || !(Math.abs(Hg[k] - lvl) < 0.08)) continue; flat[k] = 1; st.push([a, b]); } }
  const edge = []; for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (flat[k] && (!flat[k - 1] || !flat[k + 1] || !flat[k - NX] || !flat[k + NX])) edge.push([X0 + i, Z0 + j]); }
  const offs = r.map(p => { let d = 1e9; for (const e of edge) { const q = Math.hypot(e[0] - p[0], e[1] - p[1]); if (q < d) d = q; } return d; }).sort((a, b) => a - b);
  plates.push({ id, name: rec.name, plateHa: r1(n / 1e4), ringHa: r1(w.area / 1e4), ringToPlateEdgeMetres: { median: r1(offs[offs.length >> 1]), p90: r1(offs[Math.floor(offs.length * 0.9)]), max: r1(offs.at(-1)) } });
  const onPlate = p => { const i = Math.round(p[0] - X0), j = Math.round(p[1] - Z0); return i >= 0 && j >= 0 && i < NX && j < NZ && !!flat[j * NX + i]; };
  /* measured where the card put the mark, before any shore slide reconcile
     made -- the record is of the defect, and of where the mark stands now */
  for (const h of model.holes) for (const k of h.tees.marks) {
    const c = k.shore?.from ?? k.c;
    const sd = ringSD(c, r);
    if (onPlate(c) || sd < 0) marksOnWater.push({ hole: h.n, m: k.m, alongLine: c, water: id, ringSD: r1(sd), onLaserPlate: onPlate(c),
      ...(k.shore ? { now: k.c, nowRingSD: r1(ringSD(k.c, r)), nowOnLaserPlate: onPlate(k.c), slide: k.shore } : {}) });
  }
}

/* --- holes on the laser ------------------------------------------------------- */
const mean9 = (x, z) => { let s = 0, n = 0; for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) { const v = laser(x + dx, z + dz); if (Number.isFinite(v)) { s += v; n++; } } return s / n; };
const holes = [];
for (const h of model.holes) {
  const L = h.line, seg = []; let total = 0;
  for (let i = 0; i < L.length - 1; i++) { const d = Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); seg.push(d); total += d; }
  const at = s => { let d = s, i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; } const t = d / seg[i]; return { p: [L[i][0] + (L[i + 1][0] - L[i][0]) * t, L[i][1] + (L[i + 1][1] - L[i][1]) * t], i }; };
  const tee = laser(L[0][0], L[0][1]), green = laser(h.green.c[0], h.green.c[1]);
  const profile = [];
  for (let s = 0; s <= total; s += 25) { const { p } = at(s); profile.push([Math.round(total - s), Math.round(laser(p[0], p[1]) * 10) / 10]); }
  /* dips: the residual under a 9 m band across the line, outside water and bunkers */
  const dips = []; let run = null;
  const bunkers = model.holes.flatMap(o => o.bunkers.map(b => b.ring)).concat(model.scenery.bunkers || []);
  for (let s = 0; s <= total; s += 1) {
    const { p, i } = at(s); const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1], ln = Math.hypot(dx, dz); const nx = -dz / ln, nz = dx / ln;
    let rmin = 1e9; for (let o = -4; o <= 4; o += 2) { const x = p[0] + nx * o, z = p[1] + nz * o; const v = laser(x, z) - mean9(x, z); if (v < rmin) rmin = v; }
    const wet = model.water.some(w => inR(p, w.ring)), sand = bunkers.some(b => ringSD(p, b) < 6);
    if (rmin < -0.18 && !wet && !sand) { if (!run) run = { s0: s, s1: s, min: rmin }; else { run.s1 = s; run.min = Math.min(run.min, rmin); } }
    else if (run) { dips.push(run); run = null; }
  }
  if (run) dips.push(run);
  holes.push({ n: h.n,
    laser: { tee: Math.round(tee * 100) / 100, green: Math.round(green * 100) / 100, rise: Math.round((green - tee) * 10) / 10 },
    legacy: { tee: Math.round((tee + VOFF) * 10) / 10, green: Math.round((green + VOFF) * 10) / 10, rise: Math.round((green - tee) * 10) / 10 },
    pack: h.elev, packGreenMinusLaser: Math.round((h.elev.green - VOFF - green) * 100) / 100,
    profileRH2000: profile,
    dips: dips.map(d => ({ toGreen: Math.round(total - (d.s0 + d.s1) / 2), depth: Math.round(-d.min * 100) / 100, width: d.s1 - d.s0 + 1 })) });
}

/* --- ditches: linear depressions in a 9 m residual, near the holes ------------- */
const X0 = -720, Z0 = -720, N = 1440;
const Hl = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Hl[j * N + i] = laser(X0 + i, Z0 + j);
const SAT = new Float64Array((N + 1) * (N + 1));
for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) SAT[j * (N + 1) + i] = Hl[(j - 1) * N + i - 1] + SAT[(j - 1) * (N + 1) + i] + SAT[j * (N + 1) + i - 1] - SAT[(j - 1) * (N + 1) + i - 1];
const boxMean = (i, j, r) => { const i0 = Math.max(0, i - r), j0 = Math.max(0, j - r), i1 = Math.min(N, i + r + 1), j1 = Math.min(N, j + r + 1); return (SAT[j1 * (N + 1) + i1] - SAT[j0 * (N + 1) + i1] - SAT[j1 * (N + 1) + i0] + SAT[j0 * (N + 1) + i0]) / ((i1 - i0) * (j1 - j0)); };
const R = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) R[j * N + i] = Hl[j * N + i] - boxMean(i, j, 4);
const waterRings = model.water.map(w => w.ring);
const cand = new Uint8Array(N * N);
for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
  const k = j * N + i, r = R[k]; if (!(r < -0.22)) continue;
  if (waterRings.some(w => inR([X0 + i, Z0 + j], w))) continue;
  const minOf = (a, b) => r <= R[a] && r <= R[b];
  if (minOf(k - 1, k + 1) || minOf(k - N, k + N) || minOf(k - N - 1, k + N + 1) || minOf(k - N + 1, k + N - 1)) cand[k] = 1;
}
const lab = new Int32Array(N * N).fill(-1); const comps = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i; if (!cand[k] || lab[k] >= 0) continue;
  const id = comps.length, cells = [], st = [k]; lab[k] = id;
  while (st.length) { const c = st.pop(); cells.push(c); const ci = c % N, cj = (c / N) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const nk = nj * N + ni; if (cand[nk] && lab[nk] < 0) { lab[nk] = id; st.push(nk); } } }
  comps.push(cells);
}
function polyline(cells) {
  const pts = cells.map(c => [X0 + c % N, Z0 + ((c / N) | 0)]);
  let a = pts[0]; for (const p of pts) if (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(a[0] - pts[0][0], a[1] - pts[0][1])) a = p;
  let e = a; for (const p of pts) if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(e[0] - a[0], e[1] - a[1])) e = p;
  const used = new Uint8Array(pts.length); const out = []; let cur = e; used[pts.indexOf(e)] = 1; out.push(cur);
  for (let n = 1; n < pts.length; n++) { let bd = 1e9, bi = -1; for (let q = 0; q < pts.length; q++) { if (used[q]) continue; const d = Math.hypot(pts[q][0] - cur[0], pts[q][1] - cur[1]); if (d < bd) { bd = d; bi = q; } } if (bd > 6) break; used[bi] = 1; cur = pts[bi]; out.push(cur); }
  const res = [out[0]]; let acc = 0; for (let q = 1; q < out.length; q++) { acc += Math.hypot(out[q][0] - out[q - 1][0], out[q][1] - out[q - 1][1]); if (acc >= 8) { res.push(out[q]); acc = 0; } } if (res.at(-1) !== out.at(-1)) res.push(out.at(-1));
  return res;
}
const roads = model.infra.roads.concat(model.infra.tracks, model.infra.paths).map(r => r.line);
const ditches = [];
comps.forEach((cells, ci) => {
  if (cells.length < 25) return;
  const pl = polyline(cells); let len = 0; for (let q = 1; q < pl.length; q++) len += Math.hypot(pl[q][0] - pl[q - 1][0], pl[q][1] - pl[q - 1][1]);
  if (len < 20) return;
  let nearest = null, nd = 1e9; for (const h of model.holes) { const d = Math.min(...pl.map(p => lineD(p, h.line))); if (d < nd) { nd = d; nearest = h.n; } }
  if (nd > 40) return;
  const crossings = [];
  for (const h of model.holes) for (let s = 0; s < h.line.length - 1; s++) {
    const a = h.line[s], b = h.line[s + 1], Ls = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= Ls; t += 1) {
      const p = [a[0] + (b[0] - a[0]) * t / Ls, a[1] + (b[1] - a[1]) * t / Ls]; const i = Math.round(p[0] - X0), j = Math.round(p[1] - Z0); if (i < 2 || j < 2 || i >= N - 2 || j >= N - 2) continue;
      let hit = false; for (let dj = -2; dj <= 2 && !hit; dj++) for (let di = -2; di <= 2; di++) if (lab[(j + dj) * N + i + di] === ci) { hit = true; break; }
      if (!hit) continue;
      let toG = Ls - t; for (let q = s + 1; q < h.line.length - 1; q++) toG += Math.hypot(h.line[q + 1][0] - h.line[q][0], h.line[q + 1][1] - h.line[q][1]);
      crossings.push({ hole: h.n, toGreen: Math.round(toG) }); t += 15;
    }
  }
  const roadD = Math.min(...pl.map(p => Math.min(...roads.map(r => lineD(p, r)))));
  ditches.push({ id: `laser-ditch-${ditches.length + 1}`, line: pl.map(p => [Math.round(p[0]), Math.round(p[1])]), lengthMetres: Math.round(len),
    meanDepth: Math.round(cells.reduce((s, c) => s + R[c], 0) / cells.length * -100) / 100, maxDepth: Math.round(Math.min(...cells.map(c => R[c])) * -100) / 100,
    nearestHole: nearest, holeDistance: Math.round(nd), roadDistance: Math.round(roadD), crossings });
});
ditches.sort((a, b) => a.holeDistance - b.holeDistance || b.lengthMetres - a.lengthMetres);

/* --- write ---------------------------------------------------------------------- */
const out = {
  source: {
    ground: 'Lantmäteriet Markhöjdmodell 1 m (RH 2000) as published for the app: the level-zero terrain tiles of the live Puttom ground manifest, read through the app\'s own legacy bridge',
    groundManifest: courseManifest.groundManifest.url, courseManifest: entry.manifest.url, tiles: l0.length,
    bridge: { rotationDegrees: r1(bridge.rotationDegrees * 1000) / 1000, scaleX: bridge.scaleX, scaleZ: bridge.scaleZ, verticalDatumOffsetMetres: VOFF, origin: ORIGIN },
    lakeNames: 'sv.wikipedia Insjöfakta (SMHI/SVAR register) coordinates, each asserted to fall inside the ring it names; svarHeight is the register\'s "höjd"',
    ditchMethod: 'residual against a 9 m box mean; cells below -0.22 m that are a local minimum along an axis, outside every water ring, 8-connected with a two-cell gap tolerance; components of >= 25 cells and >= 20 m within 40 m of a hole line',
    measuredOn: new Date().toISOString().slice(0, 10),
  },
  water, plates, marksOnWater, holes, ditches,
};
writeJSON(path.join(HERE, 'laser-features.json'), out);

/* --- report --------------------------------------------------------------------- */
console.log(`ground: ${l0.length} tiles, ${W}x${Hn} m; bridge rot ${bridge.rotationDegrees.toFixed(4)}°, datum ${VOFF} m`);
console.log('\nwater                 ha    pack   laser(+off)  SVAR');
for (const w of water) console.log(`${(w.name || w.id).padEnd(16)} ${String(w.areaHa).padStart(6)}  ${String(w.packLevel).padStart(6)}  ${String(w.laserLevelLegacy ?? '-').padStart(7)}  ${w.svarHeight == null ? '' : (w.svarHeight + ' (' + w.laserLevelRH2000 + ' laser)')}`);
for (const p of plates) console.log(`plate ${p.name}: ${p.plateHa} ha vs ring ${p.ringHa} ha; ring→edge median ${p.ringToPlateEdgeMetres.median} m, p90 ${p.ringToPlateEdgeMetres.p90}, max ${p.ringToPlateEdgeMetres.max}`);
console.log(`\nmarks on water: ${marksOnWater.map(m => `hole ${m.hole} ${m.m} m (${m.ringSD} m)`).join('; ') || 'none'}`);
console.log('\nhole  laser tee  green   rise | pack rise | pack green − laser');
for (const h of holes) console.log(`${String(h.n).padStart(4)}  ${h.legacy.tee.toFixed(1).padStart(8)}  ${h.legacy.green.toFixed(1).padStart(5)}  ${(h.legacy.rise >= 0 ? '+' : '') + h.legacy.rise.toFixed(1)} | ${(h.pack.rise >= 0 ? '+' : '') + h.pack.rise} | ${h.packGreenMinusLaser}${Math.abs(h.packGreenMinusLaser) > 2 ? '  <-- Terrarium canopy' : ''}  dips ${h.dips.map(d => `${d.toGreen}m(${d.depth})`).join(',') || '-'}`);
console.log(`\nditches kept: ${ditches.length}`);
for (const d of ditches.filter(d => d.crossings.length || d.holeDistance <= 12)) console.log(`  ${d.id}: ${d.lengthMetres} m, depth ${d.meanDepth}/${d.maxDepth}, hole ${d.nearestHole} @${d.holeDistance} m, road ${d.roadDistance} m, crosses ${d.crossings.map(c => `${c.hole}@${c.toGreen}`).join(',') || '-'}`);
console.log(`\nwrote puttombuild/laser-features.json`);
