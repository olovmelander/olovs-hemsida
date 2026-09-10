/* Trace the ball-stop net at the range's north-east boundary from the retained
 * 2026 orthophoto (o66150_5975_25_mr26, captured 2026-05-02T13:09:09Z).
 *
 * The net is a continuous mesh, so its shadow is a broad band and individual
 * post shadows do not separate by darkness. They separate by WIDTH: a post
 * shadow is a thin dark line inside that band. This uses an oriented matched
 * filter -- the mean along a short run at the solar bearing against two flanks
 * either side. The bearing comes from the source item's own capture instant
 * through NOAA's algorithm, so nothing in the filter is fitted to what it finds.
 *
 * Height is corrected for the ground the shadow falls on, sampled from this
 * build's own heightfield: H = shadow * tan(elevation) + (ground_tip - ground_base).
 *
 * This measures a display model of an observed structure. Post diameter, mesh
 * and cable detail are not resolved at 0.32 m and are not claimed.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sampleWindow, luminance, toWorld, toPixel, TILE } from './ortho-sample.mjs';
import { SUN, BEARING, dirPixel, CAPTURE } from './measure-shadows.mjs';
import { heightAtEpsg3006 } from './terrain.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN = { x: 2130, y: 2440, w: 470, h: 350 };
/* Approximate base line, read off the 0.08 m/px stretched review crop. Each
 * post's own base comes from its shadow; these two points only say where to look. */
const GUIDE = [[597568.0, 6615334.0], [597674.0, 6615290.0]];
const SCORE_CUT = 5;            /* the response is bimodal: real posts 6.7-11.4, noise <= 2.8 */
const TAN = Math.tan(SUN.elevationDeg * Math.PI / 180);

const s = await sampleWindow(WIN);
const lum = new Float64Array(s.w * s.h);
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) lum[j * s.w + i] = luminance(s, i, j);
const L = (i, j) => {
  const x = Math.round(i), y = Math.round(j);
  return x >= 0 && y >= 0 && x < s.w && y < s.h ? lum[y * s.w + x] : NaN;
};
const perp = [-dirPixel[1], dirPixel[0]];
const RUN = 5, FLANK = 3;
function response(i, j) {
  let line = 0, flank = 0, nl = 0, nf = 0;
  for (let t = -RUN; t <= RUN; t++) {
    const x = i + dirPixel[0] * t, y = j + dirPixel[1] * t;
    const v = L(x, y); if (Number.isFinite(v)) { line += v; nl++; }
    for (const sgn of [-1, 1]) {
      const w = L(x + perp[0] * FLANK * sgn, y + perp[1] * FLANK * sgn);
      if (Number.isFinite(w)) { flank += w; nf++; }
    }
  }
  return nl && nf ? flank / nf - line / nl : NaN;
}

const local = ([e, n]) => { const [px, py] = toPixel([e, n]); return [px - WIN.x, py - WIN.y]; };
const A = local(GUIDE[0]), B = local(GUIDE[1]);
const guideLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
const alongGuide = [(B[0] - A[0]) / guideLen, (B[1] - A[1]) / guideLen];
const BACK = 4 / TILE.metresPerPixel, LOOK = 22 / TILE.metresPerPixel;

const stations = [];
for (let t = 0; t <= guideLen; t += 0.25) {
  const ox = A[0] + alongGuide[0] * t - dirPixel[0] * BACK, oy = A[1] + alongGuide[1] * t - dirPixel[1] * BACK;
  let sum = 0, n = 0;
  const profile = [];
  for (let u = 0; u < LOOK; u++) {
    const r = response(ox + dirPixel[0] * u, oy + dirPixel[1] * u);
    profile.push(r);
    if (Number.isFinite(r)) { sum += Math.max(0, r); n++; }
  }
  stations.push({ metres: t * TILE.metresPerPixel, score: n ? sum / n : 0, origin: [ox, oy], profile });
}

const MINGAP = Math.round(4.0 / TILE.metresPerPixel / 0.25);   /* posts are metres apart, never centimetres */
const peaks = [];
for (let i = 1; i < stations.length - 1; i++) {
  if (stations[i].score < SCORE_CUT) continue;
  let isPeak = true;
  for (let k = Math.max(0, i - MINGAP); k <= Math.min(stations.length - 1, i + MINGAP); k++)
    if (stations[k].score > stations[i].score) { isPeak = false; break; }
  if (isPeak) peaks.push(stations[i]);
}

const posts = [];
for (const peak of peaks) {
  let bestStart = -1, bestLen = 0, run = -1;
  for (let u = 0; u <= peak.profile.length; u++) {
    if (Number.isFinite(peak.profile[u]) && peak.profile[u] > 4) { if (run < 0) run = u; }
    else if (run >= 0) { if (u - run > bestLen) { bestLen = u - run; bestStart = run; } run = -1; }
  }
  if (bestLen < 4 / TILE.metresPerPixel) continue;
  const base = [peak.origin[0] + dirPixel[0] * bestStart, peak.origin[1] + dirPixel[1] * bestStart];
  const tip = [base[0] + dirPixel[0] * bestLen, base[1] + dirPixel[1] * bestLen];
  const baseWorld = toWorld([WIN.x + base[0], WIN.y + base[1]]);
  const tipWorld = toWorld([WIN.x + tip[0], WIN.y + tip[1]]);
  const shadow = bestLen * TILE.metresPerPixel;
  const groundBase = heightAtEpsg3006(...baseWorld), groundTip = heightAtEpsg3006(...tipWorld);
  const rise = Number.isFinite(groundBase) && Number.isFinite(groundTip) ? groundTip - groundBase : 0;
  posts.push({
    epsg3006: baseWorld.map(v => Math.round(v * 100) / 100),
    groundRh2000: Math.round(groundBase * 100) / 100,
    shadowLengthMetres: Math.round(shadow * 100) / 100,
    shadowGroundRiseMetres: Math.round(rise * 100) / 100,
    heightMetres: Math.round((shadow * TAN + rise) * 100) / 100,
    heightFlatGroundMetres: Math.round(shadow * TAN * 100) / 100,
    guideMetres: Math.round(peak.metres * 100) / 100,
    score: Math.round(peak.score * 10) / 10,
  });
}
const stat = list => {
  const v = list.slice().sort((a, b) => a - b), pick = p => v[Math.floor(p * (v.length - 1))];
  const median = pick(0.5);
  return { median, mad: v.map(x => Math.abs(x - median)).sort((a, b) => a - b)[Math.floor(v.length / 2)],
    p10: pick(0.1), p90: pick(0.9), min: v[0], max: v.at(-1) };
};
const heights = stat(posts.map(p => p.heightMetres));
const gaps = posts.slice(1).map((p, i) => Math.hypot(p.epsg3006[0] - posts[i].epsg3006[0], p.epsg3006[1] - posts[i].epsg3006[1]));
const spacing = stat(gaps);
const span = Math.hypot(posts.at(-1).epsg3006[0] - posts[0].epsg3006[0], posts.at(-1).epsg3006[1] - posts[0].epsg3006[1]);

console.log('posts %s over %s m   score cut %s', posts.length, span.toFixed(1), SCORE_CUT);
console.log('height    median %s  MAD %s  p10 %s  p90 %s  (flat-ground median %s)',
  heights.median.toFixed(2), heights.mad.toFixed(2), heights.p10.toFixed(2), heights.p90.toFixed(2),
  stat(posts.map(p => p.heightFlatGroundMetres)).median.toFixed(2));
console.log('spacing   median %s  p10 %s  p90 %s  min %s  max %s',
  spacing.median.toFixed(2), spacing.p10.toFixed(2), spacing.p90.toFixed(2), spacing.min.toFixed(2), spacing.max.toFixed(2));
for (const p of posts) console.log('  %s  E%s N%s  ground %s  shadow %s  rise %s  H %s  score %s',
  String(p.guideMetres).padStart(6), p.epsg3006[0].toFixed(1), p.epsg3006[1].toFixed(1),
  p.groundRh2000.toFixed(2), p.shadowLengthMetres.toFixed(1), String(p.shadowGroundRiseMetres).padStart(6),
  p.heightMetres.toFixed(1), p.score);

writeFileSync(resolve(HERE, '../cache/range/net-posts-raw.json'), JSON.stringify({
  sourceItem: 'o66150_5975_25_mr26', capture: CAPTURE, sun: SUN, shadowBearingDeg: BEARING,
  window: WIN, guideEpsg3006: GUIDE, scoreCut: SCORE_CUT, filter: { runPixels: RUN, flankPixels: FLANK },
  heightStatsMetres: heights, spacingStatsMetres: spacing, spanMetres: span, posts,
}, null, 2) + '\n');
