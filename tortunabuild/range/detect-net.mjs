/* Find the range's ball-stop net in the retained 2026 orthophoto.
 * A post is a thin vertical object: in a nadir ortho it is at most a pixel or
 * two wide, but its SHADOW is metres long and is the detectable signal. The
 * shadows are parallel, evenly spaced and fall on open grass, so a dark
 * top-hat residual plus a common direction isolates them from the scrub line. */
import { sampleWindow, luminance, toWorld, TILE } from './ortho-sample.mjs';

const WIN = { x: 2100, y: 2500, w: 620, h: 420 };
const s = await sampleWindow(WIN);
const L = (i, j) => luminance(s, i, j);

/* Local background: a wide box mean, so a metres-long shadow is a residual
 * against the field it lies on rather than against the whole window. */
const R = 14;
const back = new Float64Array(s.w * s.h);
const integral = new Float64Array((s.w + 1) * (s.h + 1));
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++)
  integral[(j + 1) * (s.w + 1) + i + 1] = L(i, j) + integral[j * (s.w + 1) + i + 1]
    + integral[(j + 1) * (s.w + 1) + i] - integral[j * (s.w + 1) + i];
const boxMean = (i, j) => {
  const x0 = Math.max(0, i - R), x1 = Math.min(s.w - 1, i + R);
  const y0 = Math.max(0, j - R), y1 = Math.min(s.h - 1, j + R);
  const sum = integral[(y1 + 1) * (s.w + 1) + x1 + 1] - integral[y0 * (s.w + 1) + x1 + 1]
    - integral[(y1 + 1) * (s.w + 1) + x0] + integral[y0 * (s.w + 1) + x0];
  return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
};
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) back[j * s.w + i] = boxMean(i, j);
const residual = (i, j) => back[j * s.w + i] - L(i, j);

let hist = [];
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) hist.push(residual(i, j));
hist.sort((a, b) => a - b);
const q = p => hist[Math.floor(p * (hist.length - 1))];
console.log('residual quantiles  p50 %s  p90 %s  p98 %s  p99.5 %s  max %s',
  q(.5).toFixed(2), q(.9).toFixed(2), q(.98).toFixed(2), q(.995).toFixed(2), q(1).toFixed(2));

/* Directional response: a shadow is dark ALONG a direction and bright across it. */
const best = { score: -Infinity };
for (let deg = 0; deg < 180; deg += 1) {
  const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  let score = 0, n = 0;
  for (let j = 20; j < s.h - 20; j += 2) for (let i = 20; i < s.w - 20; i += 2) {
    const r0 = residual(i, j);
    if (r0 < q(.99)) continue;
    let along = 0;
    for (let t = -6; t <= 6; t++) along += residual(Math.round(i + ux * t), Math.round(j + uy * t));
    score += along / 13; n++;
  }
  if (n > 50 && score / n > best.score) { best.score = score / n; best.deg = deg; }
}
console.log('dominant dark-line bearing in pixels: %s deg (score %s)', best.deg, best.score.toFixed(2));
console.log('window world bounds NW %s  SE %s',
  toWorld([WIN.x, WIN.y]).map(v => v.toFixed(1)).join(','),
  toWorld([WIN.x + WIN.w, WIN.y + WIN.h]).map(v => v.toFixed(1)).join(','));
