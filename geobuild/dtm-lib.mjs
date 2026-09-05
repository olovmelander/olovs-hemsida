/* The two orthorectified sources the course can be read off without any registration
   step at all, in the pack's own frame:

   - the 1 m laser terrain Lantmäteriet publishes (Markhöjdmodell, RH 2000), as the
     64 level-0 tiles the app already serves for this ground -- decoded from the
     published chunks, sampled through the same derived bridge the runtime uses
     (legacyGridBridge: the frame's rotation and scales from its own constants);
   - Esri World Imagery at z18 (0.27 m/px here), whose tile coordinates ARE its
     georeference, decoded through Chromium because Node has no JPEG decoder.

   Both give a height or a colour at a legacy (x, z), which is all the derivation
   needs. The imagery is cached under geobuild/cache/sat18 (gitignored).

   Every course has its own frame, so the terrain and the imagery are FACTORIES
   over a frame description -- { slug, origin, mPerLat, mPerLon, origin3006,
   cache } -- and the module-level exports are those factories bound to
   Veckefjärden's frame, so geobuild's own callers are unchanged. Another build
   passes its frame: loadTerrain(slug, frame), createImagery({ cache, origin,
   ..., release }) -- and a Wayback RELEASE turns the live patchwork mosaic into
   one dated capture (tools/wayback-captures.mjs says which).                    */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, CACHE, ORIGIN, M_PER_LAT, M_PER_LON } from './lib.mjs';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { decodePNG } from './png.mjs';

/* --- the terrain ---------------------------------------------------------------- */
const PUB = path.join(ROOT, 'apps/golf/public');
/* the pack origin in EPSG:3006, PROJ cs2cs (docs/courses/veckefjarden-source-dossier.md §6.1) */
const ORIGIN_3006 = { easting: 684183.801986, northing: 7022564.696685 };
export const DATUM = 20.9924;            /* legacy minus RH 2000, measured (dossier §6.2) */
export const VECKEFJARDEN_FRAME = Object.freeze({ slug: 'veckefjarden', origin: ORIGIN, mPerLat: M_PER_LAT, mPerLon: M_PER_LON, origin3006: ORIGIN_3006, cache: CACHE });

export function loadTerrain(slug = 'veckefjarden', frame = VECKEFJARDEN_FRAME) {
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
  const bridge = legacyGridBridge({ latitude: frame.origin.lat, longitude: frame.origin.lon, metresPerLatitude: frame.mPerLat, metresPerLongitude: +frame.mPerLon.toFixed(2) });
  const E0 = minE, N1 = maxN;
  const O3 = frame.origin3006;
  const legacyToGrid = (x, z) => { const [gx, gz] = bridge.toGrid(x, z); return [O3.easting + gx, O3.northing - gz]; };
  const gridToLegacy = (e, n) => bridge.toLegacy(e - O3.easting, O3.northing - n);
  const hAtGrid = (e, n) => {
    const c = e - E0, r = N1 - n, c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= W || r0 + 1 >= H) return NaN;
    const tx = c - c0, tz = r - r0, at = (cc, rr) => dem[rr * W + cc];
    const a = at(c0, r0), b = at(c0 + 1, r0), d = at(c0, r0 + 1), e2 = at(c0 + 1, r0 + 1);
    return (a + (b - a) * tx) * (1 - tz) + (d + (e2 - d) * tx) * tz;
  };
  const hAt = (x, z) => { const [e, n] = legacyToGrid(x, z); return hAtGrid(e, n); };
  return { dem, W, H, E0, N1, tiles: l0.length, bridge, legacyToGrid, gridToLegacy, hAtGrid, hAt };
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
const Z = 18;
const n2 = 2 ** Z;
const CHROME = process.env.CHROME || process.env.BANVY_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* One imagery source: the live World Imagery mosaic (release null) or one Wayback
   release, cached under <cache>/sat18[-<release>], read in the course's frame. */
export function createImagery({ cache = CACHE, origin = ORIGIN, mPerLat = M_PER_LAT, mPerLon = M_PER_LON, release = null } = {}) {
const SAT = path.join(cache, release ? `sat18-${release}` : 'sat18');
const tileURL = (tx, ty) => release
  ? `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${Z}/${ty}/${tx}`
  : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;
const toLonLat = (x, z) => [origin.lon + x / mPerLon, origin.lat - z / mPerLat];
const tileF = (lon, lat) => [(lon + 180) / 360 * n2, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n2];
const pxOf = (x, z) => { const [lon, lat] = toLonLat(x, z); const [tx, ty] = tileF(lon, lat); return [tx * 256, ty * 256]; };
const tiles = new Map();

/* fetch every z18 tile over the box and decode it to PNG through one Chromium session */
async function ensureImagery(x0, z0, x1, z1) {
  fs.mkdirSync(SAT, { recursive: true });
  const [ax, ay] = pxOf(x0, z0), [bx, by] = pxOf(x1, z1);
  const tx0 = Math.floor(Math.min(ax, bx) / 256), tx1 = Math.floor(Math.max(ax, bx) / 256);
  const ty0 = Math.floor(Math.min(ay, by) / 256), ty1 = Math.floor(Math.max(ay, by) / 256);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const jpg = path.join(SAT, `${Z}_${ty}_${tx}.jpg`); if (!fs.existsSync(jpg)) jobs.push({ tx, ty, jpg }); }
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; const r = await fetch(tileURL(j.tx, j.ty)); if (!r.ok) throw new Error(`tile ${j.ty}/${j.tx} ${r.status}`); fs.writeFileSync(j.jpg, Buffer.from(await r.arrayBuffer())); }
  }));
  const todo = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const png = path.join(SAT, `${Z}_${ty}_${tx}.png`); if (!fs.existsSync(png)) todo.push(path.join(SAT, `${Z}_${ty}_${tx}.jpg`), png); }
  if (todo.length) {
    const script = path.join(SAT, 'jpg2png.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs';
import { chromium } from '${path.join(ROOT, 'node_modules/playwright-core/index.mjs').replace(/\\/g, '/')}';
const pairs = []; for (let i = 2; i + 1 < process.argv.length; i += 2) pairs.push([process.argv[i], process.argv[i + 1]]);
const browser = await chromium.launch({ executablePath: ${JSON.stringify(CHROME)}, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const [inp, out] of pairs) {
  const b64 = fs.readFileSync(inp).toString('base64');
  const png = await page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png').split(',')[1]; }, b64);
  fs.writeFileSync(out, Buffer.from(png, 'base64'));
}
await browser.close();
`);
    for (let k = 0; k < todo.length; k += 120) execFileSync('node', [script, ...todo.slice(k, k + 120)], { stdio: 'inherit' });
  }
  return { fetched: jobs.length, decoded: todo.length / 2, tiles: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
}
function tile(tx, ty) {
  const k = tx + ',' + ty;
  if (!tiles.has(k)) { const f = path.join(SAT, `${Z}_${ty}_${tx}.png`); tiles.set(k, fs.existsSync(f) ? decodePNG(fs.readFileSync(f)) : null); }
  return tiles.get(k);
}
/* the imagery's colour at a legacy point, nearest pixel, or null off the cache */
function rgbAt(x, z) {
  const [gx, gy] = pxOf(x, z);
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const t = tile(tx, ty); if (!t) return null;
  const px = Math.min(255, Math.floor(gx - tx * 256)), py = Math.min(255, Math.floor(gy - ty * 256));
  const i = (py * t.width + px) * t.channels;
  return [t.data[i], t.data[i + 1], t.data[i + 2]];
}
const metresPerPixel = (() => { const [a] = pxOf(0, 0), [b] = pxOf(100, 0); return 100 / (b - a); })();
return { ensureImagery, rgbAt, metresPerPixel, pxOf, cacheDir: SAT, release };
}
/* geobuild's own callers: Veckefjärden's frame, the live mosaic */
const DEFAULT_IMAGERY = createImagery();
export const ensureImagery = (...a) => DEFAULT_IMAGERY.ensureImagery(...a);
export const rgbAt = (x, z) => DEFAULT_IMAGERY.rgbAt(x, z);
export const metresPerPixel = DEFAULT_IMAGERY.metresPerPixel;

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
