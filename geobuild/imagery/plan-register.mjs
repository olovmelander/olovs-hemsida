/* The club's hole plans (banguide/maps/hole_NN.jpg, drawn on aerial photography),
   registered to the world on their BUNKERS rather than on the drawn flag.

   The two-anchor registration (back-tee disc + pin, plan-anchors.json) puts the pin on
   the surveyed green centre -- but the flag is drawn where the pin was, not at the
   centre, so the plan sat 5-16 m off at the green end. Sand blobs found on the plan
   near the green, matched one-to-one within 22 m to the model's measured bunkers
   (OSM or DTM), give a weighted least-squares similarity that lands 2-8 m off instead.
   traceGreen() then reads the plan's own saturated-green fill round the pin: it is a
   0.64 IoU against the survey when aligned (the plan draws fairway green too), which
   is why the plan greens keep the reader's shape.

   Usage: node geobuild/imagery/plan-register.mjs            # registration table + fill IoU
          node geobuild/imagery/plan-register.mjs --write out.json
   Veckefjärden-specific by data (the plans and anchors); the method is not.        */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from '../png.mjs';
import { ROOT, readJSON, model, survey, inRing, area, centroid, iou, simplifyDP, traceBoundary, jpgToPng } from './lib.mjs';

const anchors = readJSON('geobuild/plan-anchors.json'), m = model(), G = survey();
const PLANS = path.join(ROOT, 'geobuild/cache/plans'); fs.mkdirSync(PLANS, { recursive: true });
const mk = (ar, ai, bx, bz) => { const s2 = ar * ar + ai * ai; return { ar, ai, bx, bz, mpp: Math.sqrt(s2), toWorld: (px, py) => [ar * px - ai * py + bx, ai * px + ar * py + bz], toPx: (x, z) => { const ux = x - bx, uz = z - bz; return [(ar * ux + ai * uz) / s2, (ar * uz - ai * ux) / s2]; } }; };
/** the two-anchor similarity, as apply-shapes.mjs builds it */
export function reg2(n) { const A = anchors[n], h = m.holes[n - 1]; const [p1x, p1y] = A.teePx, [p2x, p2y] = A.pinPx; const [w1x, w1z] = h.line[0], [w2x, w2z] = G[n]['Green Center']; const dpx = p2x - p1x, dpy = p2y - p1y, dwx = w2x - w1x, dwz = w2z - w1z, den = dpx * dpx + dpy * dpy; const ar = (dpx * dwx + dpy * dwz) / den, ai = (dpx * dwz - dpy * dwx) / den; return mk(ar, ai, w1x - (ar * p1x - ai * p1y), w1z - (ai * p1x + ar * p1y)); }
function lsq(pairs) { let sw = 0, pm = [0, 0], wm = [0, 0]; for (const { p, w, wt } of pairs) { sw += wt; pm[0] += wt * p[0]; pm[1] += wt * p[1]; wm[0] += wt * w[0]; wm[1] += wt * w[1]; } pm = pm.map(v => v / sw); wm = wm.map(v => v / sw); let nr = 0, ni = 0, den = 0; for (const { p, w, wt } of pairs) { const px = p[0] - pm[0], py = p[1] - pm[1], wx = w[0] - wm[0], wz = w[1] - wm[1]; nr += wt * (px * wx + py * wz); ni += wt * (px * wz - py * wx); den += wt * (px * px + py * py); } const ar = nr / den, ai = ni / den; const T = mk(ar, ai, wm[0] - (ar * pm[0] - ai * pm[1]), wm[1] - (ai * pm[0] + ar * pm[1])); let ss = 0; for (const { p, w, wt } of pairs) { const q = T.toWorld(...p); ss += wt * ((q[0] - w[0]) ** 2 + (q[1] - w[1]) ** 2); } T.rms = Math.sqrt(ss / sw); return T; }
const imgs = {};
export async function decodePlans() { const pairs = []; for (let n = 1; n <= 18; n++) { const png = path.join(PLANS, `hole_${String(n).padStart(2, '0')}.png`); if (!fs.existsSync(png)) pairs.push([path.join(ROOT, `banguide/maps/hole_${String(n).padStart(2, '0')}.jpg`), png]); } await jpgToPng(pairs); }
const img = n => imgs[n] ||= decodePNG(fs.readFileSync(path.join(PLANS, `hole_${String(n).padStart(2, '0')}.png`)));
const px = (im, x, y) => { const ch = im.channels || im.data.length / (im.width * im.height); const i = (y * im.width + x) * ch; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };
function sandBlobs(n, R0) { const im = img(n), [cx, cy] = anchors[n].pinPx; const r = Math.round(90 / R0.mpp), W = 2 * r + 1; const M = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const x = cx - r + i, y = cy - r + j; if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue; const [rr, g, b] = px(im, x, y); const mx = Math.max(rr, g, b), mn = Math.min(rr, g, b); const s = mx ? (mx - mn) / mx : 0; M[j * W + i] = (mx > 150 && s < 0.32 && rr >= g - 8 && g >= b - 10 && rr > 140) ? 1 : 0; }
  const lab = new Int32Array(W * W).fill(-1); const out = []; let nl = 0;
  for (let s0 = 0; s0 < W * W; s0++) { if (!M[s0] || lab[s0] >= 0) continue; const st = [s0]; lab[s0] = nl; let cnt = 0, sx = 0, sy = 0; while (st.length) { const p = st.pop(); cnt++; const i = p % W, j = (p - i) / W; sx += i; sy += j; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue; const q = jj * W + ii; if (M[q] && lab[q] < 0) { lab[q] = nl; st.push(q); } } } const a = cnt * R0.mpp * R0.mpp; if (a >= 12 && a <= 400) out.push({ px: [cx - r + sx / cnt, cy - r + sy / cnt], area: +a.toFixed(0) }); nl++; }
  return out; }
/** registration on tee (0.5) + matched bunkers (1 each) + pin (0.15 once two bunkers match, else 1) */
export function regBunkers(n) {
  const R0 = reg2(n), h = m.holes[n - 1]; const blobs = sandBlobs(n, R0); const bunk = (h.bunkers || []).filter(b => b.prov !== 'plan' && b.prov !== 'guide').map(b => ({ c: centroid(b.ring) }));
  const cands = []; for (let i = 0; i < blobs.length; i++) for (let j = 0; j < bunk.length; j++) { const w = R0.toWorld(...blobs[i].px); const d = Math.hypot(w[0] - bunk[j].c[0], w[1] - bunk[j].c[1]); if (d < 22) cands.push({ i, j, d }); }
  cands.sort((a, b) => a.d - b.d); const ui = new Set(), uj = new Set(), pairs = []; for (const c of cands) { if (ui.has(c.i) || uj.has(c.j)) continue; ui.add(c.i); uj.add(c.j); pairs.push({ p: blobs[c.i].px, w: bunk[c.j].c, wt: 1, d0: c.d }); }
  const A = anchors[n]; const base = [{ p: A.teePx, w: h.line[0], wt: 0.5 }, { p: A.pinPx, w: G[n]['Green Center'], wt: pairs.length >= 2 ? 0.15 : 1 }];
  const T = pairs.length ? lsq([...base, ...pairs]) : R0; const a0 = R0.toWorld(...A.pinPx), a1 = T.toWorld(...A.pinPx);
  return { T, R0, blobs: blobs.length, bunkers: bunk.length, matched: pairs.length, d0: pairs.map(p => +p.d0.toFixed(1)), rms: T.rms ?? null, shiftAtPin: +Math.hypot(a0[0] - a1[0], a0[1] - a1[1]).toFixed(1) };
}
function hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx / 255]; }
/** the plan's saturated-green fill round the pin (H 95-140, S>=0.35, V>=0.52), closed then opened by 1.2 m, nearest component >= 60 m², boundary traced into world metres */
export function traceGreen(n, { bunkers = true, SMIN = 0.35, VMIN = 0.52, HLO = 95, HHI = 140 } = {}) {
  const im = img(n), Rg = bunkers ? regBunkers(n).T : reg2(n), [cx, cy] = anchors[n].pinPx; const r = Math.round(40 / Rg.mpp), W = 2 * r + 1; const isG = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const [h, s, v] = hsv(...px(im, cx - r + i, cy - r + j)); isG[j * W + i] = (h >= HLO && h <= HHI && s >= SMIN && v >= VMIN) ? 1 : 0; }
  const k = Math.max(1, Math.round(1.2 / Rg.mpp)); const morph = (src, val) => { const out = new Uint8Array(W * W); for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { let hit = 0; for (let dj = -k; dj <= k && !hit; dj++) for (let di = -k; di <= k; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue; if (src[jj * W + ii] === val) { hit = 1; break; } } out[j * W + i] = hit ? val : 1 - val; } return out; };
  const opened = morph(morph(morph(morph(isG, 1), 0), 0), 1); const lab = new Int32Array(W * W).fill(-1); let nl = 0; const comps = [];
  for (let s0 = 0; s0 < W * W; s0++) { if (!opened[s0] || lab[s0] >= 0) continue; const st = [s0]; lab[s0] = nl; let cnt = 0, sx = 0, sy = 0; while (st.length) { const p = st.pop(); cnt++; const i = p % W, j = (p - i) / W; sx += i; sy += j; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue; const q = jj * W + ii; if (opened[q] && lab[q] < 0) { lab[q] = nl; st.push(q); } } } comps.push({ id: nl, cnt, cx: sx / cnt, cy: sy / cnt }); nl++; }
  const near = comps.map(c => ({ ...c, d: Math.hypot(c.cx - r, c.cy - r) * Rg.mpp })).filter(c => c.cnt * Rg.mpp * Rg.mpp > 60).sort((a, b) => a.d - b.d)[0]; if (!near) return null;
  const M = new Uint8Array(W * W); for (let p = 0; p < W * W; p++) M[p] = lab[p] === near.id ? 1 : 0;
  const world = traceBoundary(M, W, W).map(([i, j]) => Rg.toWorld(cx - r + i, cy - r + j)); return { ring: simplifyDP(world, 0.5).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]), mpp: Rg.mpp };
}
if (process.argv[1] && process.argv[1].endsWith('plan-register.mjs')) {
  await decodePlans(); const outIdx = process.argv.indexOf('--write'); const out = {};
  const raw = [], ali = [];
  for (const h of m.holes) { const n = h.n; const r = regBunkers(n); const t = traceGreen(n); let s = ''; if (t && h.green.prov === 'osm') { const cc = centroid(t.ring), oc = centroid(h.green.ring); const i1 = iou(t.ring, h.green.ring), i2 = iou(t.ring.map(p => [p[0] + oc[0] - cc[0], p[1] + oc[1] - cc[1]]), h.green.ring); raw.push(i1); ali.push(i2); s = `fill IoU raw ${i1.toFixed(2)} aligned ${i2.toFixed(2)} centroid err ${Math.hypot(oc[0] - cc[0], oc[1] - cc[1]).toFixed(1)} m`; } else if (t) s = `fill ${Math.round(area(t.ring))} m² (plan hole, reader ${h.green.area} m²)`;
    console.log(`hole ${String(n).padStart(2)} blobs ${r.blobs} bunkers ${r.bunkers} matched ${r.matched} (d0 ${r.d0.join(',')}) rms ${r.rms?.toFixed(1) ?? '-'} shift at pin ${r.shiftAtPin} m  ${s}`); out[n] = { registration: { ar: r.T.ar, ai: r.T.ai, bx: r.T.bx, bz: r.T.bz, matched: r.matched, rms: r.rms, shiftAtPin: r.shiftAtPin }, fill: t?.ring || null }; }
  const med = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; }; console.log(`plan fill vs ${raw.length} surveyed greens: median IoU raw ${med(raw).toFixed(2)} aligned ${med(ali).toFixed(2)}`);
  if (outIdx > 0) { fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(out)); console.log('wrote', process.argv[outIdx + 1]); }
}
