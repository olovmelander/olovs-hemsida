/* Trace the range's unfinished landing field from the retained 2026 orthophoto.
 *
 * The club's own 2025 report describes the range as an unfinished project --
 * "slutföra arbetet på rangen med jordmassorna och göra klart målområdena",
 * with "ytan på rangen inte är gräsbetäckt" -- and the capture shows exactly
 * that: a large pale scraped area with three constructed target areas in it.
 * The model's range ring deliberately covers only the visibly grassed southern
 * part, so without this the render shows a finished grass range.
 *
 * Bare fill is PALE and not green; grass is darker and green. Both cuts are
 * measured against the range's own surroundings rather than assumed, and the
 * component is grown from a seed inside the bare area so that pale ground
 * elsewhere (the road, the car park, the gravel strip) cannot join it.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sampleWindow, rgb, luminance, toWorld, toPixel, TILE } from './ortho-sample.mjs';
import { local } from '../frame.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN = { x: Math.round((597450 - 596880) / 0.32), y: Math.round((6616160 - 6615375) / 0.32), w: 790, h: 460 };
const s = await sampleWindow(WIN);
const ok = (i, j) => i >= 0 && j >= 0 && i < s.w && j < s.h;
const lum = (i, j) => luminance(s, i, j);
const gr = (i, j) => { const c = rgb(s, i, j); return c[1] - c[0]; };

const lums = [], grs = [];
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) { lums.push(lum(i, j)); grs.push(gr(i, j)); }
lums.sort((a, b) => a - b); grs.sort((a, b) => a - b);
const q = (v, p) => v[Math.floor(p * (v.length - 1))];
console.log('window luminance p20 %s p50 %s p80 %s p95 %s', q(lums, .2).toFixed(0), q(lums, .5).toFixed(0), q(lums, .8).toFixed(0), q(lums, .95).toFixed(0));
console.log('window green-red p20 %s p50 %s p80 %s', q(grs, .2).toFixed(0), q(grs, .5).toFixed(0), q(grs, .8).toFixed(0));

/* Bare fill: brighter than most of the window and not green with it. */
const LUM_CUT = q(lums, 0.62), GR_CUT = q(grs, 0.45);
const bare = (i, j) => lum(i, j) >= LUM_CUT && gr(i, j) <= GR_CUT;
/* Seed inside the scraped area, read off the review crop; the grow does the rest. */
const SEED = toPixel([597600, 6615310]).map((v, k) => Math.round(v - (k ? WIN.y : WIN.x)));
console.log('cuts: luminance >= %s, green-red <= %s ; seed at %s (bare=%s)',
  LUM_CUT.toFixed(0), GR_CUT.toFixed(0), JSON.stringify(SEED), bare(...SEED));

const mask = new Uint8Array(s.w * s.h);
const stack = [SEED]; mask[SEED[1] * s.w + SEED[0]] = 1;
let filled = 0;
while (stack.length) {
  const [x, y] = stack.pop(); filled++;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!ok(nx, ny) || mask[ny * s.w + nx] || !bare(nx, ny)) continue;
    mask[ny * s.w + nx] = 1; stack.push([nx, ny]);
  }
}
/* close pinholes so the outline does not thread between clods */
for (let pass = 0; pass < 2; pass++) {
  const next = Uint8Array.from(mask);
  for (let j = 1; j < s.h - 1; j++) for (let i = 1; i < s.w - 1; i++) {
    if (mask[j * s.w + i]) continue;
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) n += mask[(j + dy) * s.w + i + dx];
    if (n >= 3) next[j * s.w + i] = 1;
  }
  mask.set(next);
}
const area = filled * TILE.metresPerPixel ** 2;
console.log('component %s px = %s m2 (%s ha)', filled, area.toFixed(0), (area / 1e4).toFixed(2));

/* Marching-squares outline of the largest boundary, then simplified. */
const inside = (i, j) => ok(i, j) && mask[j * s.w + i] === 1;
let start = null;
for (let j = 0; j < s.h && !start; j++) for (let i = 0; i < s.w; i++) if (inside(i, j)) { start = [i, j]; break; }
const path = [];
{
  let [x, y] = start, dir = 0;                     /* 0 up,1 right,2 down,3 left; Moore boundary walk */
  const step = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const first = `${x},${y}`; let guard = 0;
  do {
    path.push([x, y]);
    let turned = false;
    for (let k = 0; k < 4; k++) {
      const nd = (dir + 3 + k) % 4, [dx, dy] = step[nd];
      if (inside(x + dx, y + dy)) { x += dx; y += dy; dir = nd; turned = true; break; }
    }
    if (!turned) break;
  } while ((`${x},${y}` !== first || path.length < 3) && ++guard < 400000);
}
/* Douglas-Peucker at 1.5 m: the boundary is a scraped edge, not a survey line. */
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const work = [[0, points.length - 1]];
  while (work.length) {
    const [a, b] = work.pop();
    let best = -1, bd = tol;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; work.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const world = path.map(([i, j]) => toWorld([WIN.x + i + .5, WIN.y + j + .5]));
const simple = simplify(world, 1.5).map(p => p.map(v => Math.round(v * 100) / 100));
console.log('outline %s points -> %s after 1.5 m simplification', path.length, simple.length);
writeFileSync(resolve(HERE, '../cache/range/earthworks-raw.json'), JSON.stringify({
  window: WIN, luminanceCut: LUM_CUT, greenRedCut: GR_CUT, seedEpsg3006: [597600, 6615310],
  areaSquareMetres: Math.round(area), ringEpsg3006: simple,
  ringLocal: simple.map(p => local(p).map(v => Math.round(v * 100) / 100)),
}, null, 2) + '\n');
