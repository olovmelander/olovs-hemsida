/* Shared pieces for the imagery tools: the frame, the survey, the model, small
   geometry, and a Chromium for decoding JPEGs and rendering overlays (Node has no
   JPEG decoder; the tiles are JPEG). Everything is Veckefjärden's frame by default;
   pass another build's model where the tool allows it.                            */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib.mjs';

export { ROOT };
/** The build directory the tools work on (BUILD=puttombuild etc.); its model carries the frame. */
export const BUILD = process.env.BUILD || 'geobuild';
const _model = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD, 'course-model.json'), 'utf8'));
export const FRAME = { lat: _model.origin.lat, lon: _model.origin.lon, mPerLon: _model.mPerLon, mPerLat: _model.mPerLat };
export const CHROME = process.env.BANVY_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const readJSON = f => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f), 'utf8'));
export const model = () => _model;
/** GPS survey points by hole: G[n]['Green Center'] etc., in the legacy frame. GPS=<file> names
    the survey (default Veckefjärden's for geobuild); where a build has none, the model's own
    green centres and back tees stand in, so every tool still runs. */
export function survey() {
  const f = process.env.GPS || (BUILD === 'geobuild' ? 'geo_data/veckefjarden_clean.json' : null); const G = {};
  if (!f || !fs.existsSync(path.join(ROOT, f))) { for (const h of _model.holes) G[h.n] = { 'Green Center': h.green.c, 'Tee Target': h.line[0], fromModel: true }; return G; }
  const gps = readJSON(f);
  for (const f of gps.features) { const p = f.properties, [lo, la] = f.geometry.coordinates; (G[+p.hole] ||= {})[p.name] = [(lo - FRAME.lon) * FRAME.mPerLon, -(la - FRAME.lat) * FRAME.mPerLat]; }
  return G;
}
export const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
export const segD = (x, z, A, B) => { const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - A[0]) * dx + (z - A[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t); };
export const ringD = (x, z, r) => { let d = 1e9; for (let i = 0; i < r.length; i++) d = Math.min(d, segD(x, z, r[i], r[(i + 1) % r.length])); return d; };
export const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
export const centroid = r => { let a = 0, cx = 0, cz = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cz += (r[j][1] + r[i][1]) * f; } if (Math.abs(a) < 1e-9) { let sx = 0, sz = 0; for (const p of r) { sx += p[0]; sz += p[1]; } return [sx / r.length, sz / r.length]; } return [cx / (3 * a), cz / (3 * a)]; };
export const median = a => { const s = [...a].filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
export const quant = (a, q) => { const s = [...a].filter(Number.isFinite).sort((p, q2) => p - q2); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
/** Intersection over union of two rings, on a 0.5 m lattice. */
export function iou(a, b) { let I = 0, U = 0; const xs = [...a, ...b].map(p => p[0]), zs = [...a, ...b].map(p => p[1]); for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) { const p = inRing(x, z, a), q = inRing(x, z, b); if (p && q) I++; if (p || q) U++; } return U ? I / U : 0; }
export function simplifyDP(L, tol) { if (L.length < 3) return L; const keep = new Uint8Array(L.length); keep[0] = keep[L.length - 1] = 1; const st = [[0, L.length - 1]]; while (st.length) { const [a, b] = st.pop(); let far = -1, fd = tol; for (let i = a + 1; i < b; i++) { const d = segD(L[i][0], L[i][1], L[a], L[b]); if (d > fd) { fd = d; far = i; } } if (far > 0) { keep[far] = 1; st.push([a, far], [far, b]); } } return L.filter((_, i) => keep[i]); }
export function hull(pts) { pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], hi = []; for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); } return lo.slice(0, -1).concat(hi.slice(0, -1)); }
/** Moore boundary trace of a binary raster (Uint8Array W*H); returns [[i,j],...] */
export function traceBoundary(M, W, H) {
  let start = -1; for (let p = 0; p < W * H && start < 0; p++) if (M[p]) start = p; if (start < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 0 : M[j * W + i];
  const out = []; let ci = start % W, cj = (start - ci) / W, dir = 6; const s0i = ci, s0j = cj; let guard = 0;
  do { out.push([ci, cj]); let found = false; for (let t = 0; t < 8; t++) { const d = (dir + 6 + t) % 8; const ni = ci + dirs[d][0], nj = cj + dirs[d][1]; if (at(ni, nj)) { ci = ni; cj = nj; dir = d; found = true; break; } } if (!found) break; } while ((ci !== s0i || cj !== s0j) && ++guard < 100000);
  return out;
}
export async function browser() { const { chromium } = await import('playwright-core'); return chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); }
/** Render an HTML string to a PNG at the given viewport. */
export async function renderHTML(html, width, height, out) { const b = await browser(); const page = await b.newPage({ viewport: { width: Math.round(width), height: Math.round(height) } }); await page.setContent(html); await page.waitForTimeout(300); await page.screenshot({ path: out }); await b.close(); }
/** Decode JPEG files to PNG through Chromium, in batches. */
export async function jpgToPng(pairs) { if (!pairs.length) return; const b = await browser(); const page = await b.newPage(); for (const [inp, out] of pairs) { const b64 = fs.readFileSync(inp).toString('base64'); const png = await page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png').split(',')[1]; }, b64); fs.writeFileSync(out, Buffer.from(png, 'base64')); } await b.close(); }
