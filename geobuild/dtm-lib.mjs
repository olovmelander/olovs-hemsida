/* The two orthorectified sources the course can be read off without any registration
   step at all, in the pack's own frame:

   - the 1 m laser terrain Lantmäteriet publishes (Markhöjdmodell, RH 2000), as the
     64 level-0 tiles the app already serves for this ground -- decoded from the
     published chunks, sampled through the same derived bridge the runtime uses
     (legacyGridBridge: the frame's rotation and scales from its own constants);
   - Esri World Imagery at z18 (0.27 m/px here), whose tile coordinates ARE its
     georeference, decoded through Chromium because Node has no JPEG decoder.

   Both give a height or a colour at a legacy (x, z), which is all the derivation
   needs. The imagery is cached under <build>/cache/sat18[-<release>] (gitignored)
   and is sampled through imagery/wayback.mjs, so a dated capture is one env var.

   Nothing here is written down per course: the frame, the pack origin in EPSG:3006
   and the vertical datum step all come from that slug's own reviewed v2 frontier
   contract, which the runtime already renders through.                            */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from '../apps/golf/src/engine/v2-frontier-configs.mjs';
import { ensure as ensureSat, rgbAt as satRgbAt, mPerPx } from './imagery/wayback.mjs';
import { FRAME as SAT_FRAME, BUILD as SAT_BUILD } from './imagery/lib.mjs';

/* --- the terrain ---------------------------------------------------------------- */
const PUB = path.join(ROOT, 'apps/golf/public');

/* Every number a course needs here is already reviewed in its frontier contract: the
   pack origin projected to EPSG:3006, the frame the pack is authored in, and the
   measured legacy-minus-RH 2000 step. Read them; never restate them. */
export function contractOf(slug) {
  const c = V2_GRAPH_FRONTIER_CONFIGS[slug];
  if (!c) throw new Error(`no reviewed v2 frontier contract for ${slug}`);
  const dig = (o, key, d = 0) => {
    if (!o || typeof o !== 'object' || d > 3) return undefined;
    if (key in o) return o[key];
    for (const v of Object.values(o)) { const r = dig(v, key, d + 1); if (r !== undefined) return r; }
    return undefined;
  };
  const origin3006 = dig(c, 'legacyOriginEpsg3006');
  const wgs = dig(c, 'packOriginWgs84');
  const mPerLon = dig(c, 'packMetresPerLongitude');
  const datum = dig(c, 'verticalDatumOffsetMetres');
  if (!origin3006 || !wgs || !mPerLon) throw new Error(`${slug}: the contract carries no legacy frame (a grid-authored pack needs no bridge)`);
  return { origin3006, origin: { lat: wgs.latitude, lon: wgs.longitude }, mPerLon, mPerLat: 111320, datum: datum ?? 0 };
}
/** legacy minus RH 2000 for a slug, as its own contract measured it. */
export const datumOf = slug => contractOf(slug).datum;

export function loadTerrain(slug = 'veckefjarden') {
  const { origin3006: ORIGIN_3006, origin: ORIGIN, mPerLon: M_PER_LON, mPerLat: M_PER_LAT } = contractOf(slug);
  const root = JSON.parse(fs.readFileSync(path.join(PUB, 'courses/v2-index.json'), 'utf8'));
  const entry = root.courses.find(c => c.slug === slug);
  if (!entry) throw new Error(`no v2 course ${slug}`);
  const course = JSON.parse(fs.readFileSync(path.join(PUB, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(PUB, course.groundManifest.url), 'utf8'));
  const l0 = ground.tiles.filter(t => t.id.startsWith('l0/'));
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const t of l0) { minE = Math.min(minE, t.bounds.minEasting); maxE = Math.max(maxE, t.bounds.maxEasting); minN = Math.min(minN, t.bounds.minNorthing); maxN = Math.max(maxN, t.bounds.maxNorthing); }
  const W = Math.round(maxE - minE) + 1, H = Math.round(maxN - minN) + 1;
  const dem = new Float32Array(W * H).fill(NaN);
  for (const t of l0) {
    const ch = readChunk(fs.readFileSync(path.join(PUB, t.layers.terrain.url)));
    const g = ch.header.grid, h = decodeTerrainGrid(ch.payload, g);
    const c0 = Math.round(t.bounds.minEasting - minE), r0 = Math.round(maxN - t.bounds.maxNorthing);
    for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) dem[(r0 + r) * W + c0 + c] = h[r * g.width + c];
  }
  const bridge = legacyGridBridge({ latitude: ORIGIN.lat, longitude: ORIGIN.lon, metresPerLatitude: M_PER_LAT, metresPerLongitude: M_PER_LON });
  const E0 = minE, N1 = maxN;
  const legacyToGrid = (x, z) => { const [gx, gz] = bridge.toGrid(x, z); return [ORIGIN_3006.easting + gx, ORIGIN_3006.northing - gz]; };
  const gridToLegacy = (e, n) => bridge.toLegacy(e - ORIGIN_3006.easting, ORIGIN_3006.northing - n);
  const hAtGrid = (e, n) => {
    const c = e - E0, r = N1 - n, c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= W || r0 + 1 >= H) return NaN;
    const tx = c - c0, tz = r - r0, at = (cc, rr) => dem[rr * W + cc];
    const a = at(c0, r0), b = at(c0 + 1, r0), d = at(c0, r0 + 1), e2 = at(c0 + 1, r0 + 1);
    return (a + (b - a) * tx) * (1 - tz) + (d + (e2 - d) * tx) * tz;
  };
  const hAt = (x, z) => { const [e, n] = legacyToGrid(x, z); return hAtGrid(e, n); };
  /* The imagery sampler takes its frame from BUILD's own model, and it is read at
     import time. A terrain loaded for one course and imagery sampled in another's
     frame produces a plausible calibration over ground 400 km away rather than an
     error, so the two frames are compared here and the mismatch is fatal. */
  if (Math.abs(SAT_FRAME.lat - ORIGIN.lat) > 1e-6 || Math.abs(SAT_FRAME.lon - ORIGIN.lon) > 1e-6) {
    throw new Error(`the imagery frame is ${SAT_BUILD}'s (${SAT_FRAME.lat}, ${SAT_FRAME.lon}) but the terrain is ${slug}'s (${ORIGIN.lat}, ${ORIGIN.lon}); set BUILD=<dir> in the environment BEFORE this module is imported`);
  }
  return { slug, datum: contractOf(slug).datum, dem, W, H, E0, N1, tiles: l0.length, bridge, legacyToGrid, gridToLegacy, hAtGrid, hAt };
}

/* Black top-hat with a square closing of radius r: how far each cell lies below the
   surface that would fill its hollows. A ditch is a long positive ridge in it. */
export function blackTopHat(T, r = 6) {
  const { dem, W, H } = T;
  const sep = (src, op) => {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = op === 'max' ? -1e9 : 1e9; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; const s = src[y * W + xx]; v = op === 'max' ? Math.max(v, s) : Math.min(v, s); } tmp[y * W + x] = v; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = op === 'max' ? -1e9 : 1e9; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; const s = tmp[yy * W + x]; v = op === 'max' ? Math.max(v, s) : Math.min(v, s); } out[y * W + x] = v; }
    return out;
  };
  const closed = sep(sep(dem, 'max'), 'min');
  const th = new Float32Array(W * H);
  for (let i = 0; i < th.length; i++) th[i] = closed[i] - dem[i];
  return th;
}

/* --- the imagery ---------------------------------------------------------------- */
/* One sampler for the whole repo: imagery/wayback.mjs reads the build's own frame out
   of its model (BUILD=<dir>) and can serve a dated Esri release (SAT_REL=<id>) instead
   of the live mosaic, which over a leaf-off course is the difference between a green
   you can trace and one you cannot. This module keeps the older names its callers use. */
export const ensureImagery = (x0, z0, x1, z1) => ensureSat(x0, z0, x1, z1);
/** the imagery's colour at a legacy point, nearest pixel, or null off the cache */
export const rgbAt = (x, z) => satRgbAt(x, z);
export const metresPerPixel = mPerPx;

/* --- small geometry ------------------------------------------------------------- */
export const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
export const bboxOf = r => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
export const segD = (x, z, A, B) => { const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - A[0]) * dx + (z - A[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t); };
export const lineD = (x, z, L) => { let d = 1e9; for (let i = 0; i < L.length - 1; i++) d = Math.min(d, segD(x, z, L[i], L[i + 1])); return d; };
export const ringD = (x, z, r) => { let d = 1e9; for (let i = 0; i < r.length; i++) d = Math.min(d, segD(x, z, r[i], r[(i + 1) % r.length])); return d; };
export const median = a => { const s = [...a].filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
export const quant = (a, q) => { const s = [...a].filter(Number.isFinite).sort((p, q2) => p - q2); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
export const areaOf = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
export const meanPt = r => { let sx = 0, sz = 0; for (const p of r) { sx += p[0]; sz += p[1]; } return [sx / r.length, sz / r.length]; };
export function hull(pts) {
  pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
export function simplify(P, tol) {
  if (P.length < 3) return P;
  let md = 0, mi = 0; const A = P[0], B = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - P[i][1]) - (A[0] - P[i][0]) * (B[1] - A[1])) / (Math.hypot(B[0] - A[0], B[1] - A[1]) || 1); if (d > md) { md = d; mi = i; } }
  if (md > tol) return [...simplify(P.slice(0, mi + 1), tol).slice(0, -1), ...simplify(P.slice(mi), tol)];
  return [A, B];
}
