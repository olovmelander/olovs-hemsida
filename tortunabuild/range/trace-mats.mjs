/* Re-trace the range's hitting mats from the retained 2026 orthophoto.
 *
 * The mats do not out-contrast the strip on any absolute colour cut: measured,
 * their excess green sits at the strip's own 75th percentile. What separates
 * them is LOCAL -- a mat is greener than the two metres around it, whether it
 * lies on pale gravel or on grass. So the score is green-minus-red against its
 * own local median, and the corridor is restricted to a band about the tee
 * line so that nothing green elsewhere can enter.
 *
 * The retained trace is kept as the review reference; this is a measurement of
 * the same objects on the same tile, and the two are compared, not merged.
 * Mat size at 0.32 m/px is 4-5 pixels across: positions are measured, corner
 * geometry is not resolved and is drawn as an oriented rectangle of the
 * measured area.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sampleWindow, rgb, toWorld, toPixel, TILE } from './ortho-sample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = [597400.5, 6614899.5];
const model = JSON.parse(readFileSync(resolve(HERE, '../course-model.json'), 'utf8'));
const retained = (model.scenery.mappedFeatures || []).filter(f => f.kind === 'range_tee_pad')
  .map(f => { const r = f.rings[0]; const c = [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
    return { id: f.id, centre: [ORIGIN[0] + c[0], ORIGIN[1] - c[1]] }; });

const WIN = { x: Math.round((597415 - 596880) / 0.32), y: Math.round((6616160 - 6615228) / 0.32), w: 175, h: 175 };
const s = await sampleWindow(WIN);
const ok = (i, j) => i >= 0 && j >= 0 && i < s.w && j < s.h;
const greenRed = (i, j) => { const c = rgb(s, i, j); return c[1] - c[0]; };
const R = 7;                                   /* 2.2 m: wider than a mat, narrower than the strip */
const score = new Float64Array(s.w * s.h);
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
  const v = [];
  for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) if (ok(i + a, j + b)) v.push(greenRed(i + a, j + b));
  v.sort((p, q) => p - q);
  score[j * s.w + i] = greenRed(i, j) - v[Math.floor(v.length / 2)];
}

/* corridor: within 6 m of the line through the retained trace's own endpoints */
const A = retained[0].centre, B = retained.at(-1).centre;
const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
const offsets = (e, n) => [(e - A[0]) * dir[0] + (n - A[1]) * dir[1],
  Math.abs(-(e - A[0]) * dir[1] + (n - A[1]) * dir[0])];
/* The threshold is measured on a WIDE band and membership tested on a narrow
   one. Taking both from the narrow band is a feedback loop: the tighter the
   corridor, the larger the share of it that is mat, and a percentile cut then
   starts rejecting the very objects it is meant to find. */
const inWide = (e, n) => { const [t, d] = offsets(e, n); return t >= -8 && t <= len + 8 && d <= 6; };
const nearLine = (e, n) => { const [t, d] = offsets(e, n); return t >= -8 && t <= len + 8 && d <= 3.5; };

const inCorridor = [];
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
  const [e, n] = toWorld([WIN.x + i + .5, WIN.y + j + .5]);
  if (inWide(e, n)) inCorridor.push(score[j * s.w + i]);
}
inCorridor.sort((a, b) => a - b);
const CUT = inCorridor[Math.floor(0.90 * (inCorridor.length - 1))];

const seen = new Uint8Array(s.w * s.h), blobs = [];
for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
  const [e0, n0] = toWorld([WIN.x + i + .5, WIN.y + j + .5]);
  if (seen[j * s.w + i] || score[j * s.w + i] < CUT || !nearLine(e0, n0)) continue;
  const stack = [[i, j]], pixels = []; seen[j * s.w + i] = 1;
  while (stack.length) {
    const [x, y] = stack.pop(); pixels.push([x, y]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!ok(nx, ny) || seen[ny * s.w + nx] || score[ny * s.w + nx] < CUT) continue;
      const [e, n] = toWorld([WIN.x + nx + .5, WIN.y + ny + .5]);
      if (!nearLine(e, n)) continue;
      seen[ny * s.w + nx] = 1; stack.push([nx, ny]);
    }
  }
  const area = pixels.length * TILE.metresPerPixel ** 2;
  if (area < 1.8 || area > 6) continue;
  const mx = pixels.reduce((a, p) => a + p[0], 0) / pixels.length + .5;
  const my = pixels.reduce((a, p) => a + p[1], 0) / pixels.length + .5;
  blobs.push({ centre: toWorld([WIN.x + mx, WIN.y + my]).map(v => Math.round(v * 100) / 100),
    areaSquareMetres: Math.round(area * 100) / 100, pixels: pixels.length,
    peakScore: Math.max(...pixels.map(([x, y]) => score[y * s.w + x])) });
}
blobs.sort((a, b) => (a.centre[0] - A[0]) * dir[0] + (a.centre[1] - A[1]) * dir[1]
  - ((b.centre[0] - A[0]) * dir[0] + (b.centre[1] - A[1]) * dir[1]));

const gaps = blobs.slice(1).map((m, i) => Math.hypot(m.centre[0] - blobs[i].centre[0], m.centre[1] - blobs[i].centre[1]));
const g = gaps.slice().sort((a, b) => a - b);
console.log('corridor cut %s (p90)   mats found %s   retained trace %s', CUT.toFixed(1), blobs.length, retained.length);
console.log('area   median %s m2   range %s..%s', blobs.map(b => b.areaSquareMetres).sort((a, b) => a - b)[Math.floor(blobs.length / 2)]?.toFixed(2),
  Math.min(...blobs.map(b => b.areaSquareMetres)).toFixed(2), Math.max(...blobs.map(b => b.areaSquareMetres)).toFixed(2));
console.log('spacing median %s m   p10 %s   p90 %s', g[Math.floor(g.length / 2)]?.toFixed(2), g[Math.floor(.1 * g.length)]?.toFixed(2), g[Math.floor(.9 * g.length)]?.toFixed(2));
/* how far is each retained mat from the nearest measured one? */
const off = retained.map(r => {
  let bd = Infinity, bm = null;
  for (const b of blobs) { const d = Math.hypot(b.centre[0] - r.centre[0], b.centre[1] - r.centre[1]); if (d < bd) { bd = d; bm = b; } }
  return { id: r.id, distance: bd, dE: bm.centre[0] - r.centre[0], dN: bm.centre[1] - r.centre[1] };
});
const ds = off.map(o => o.distance).sort((a, b) => a - b);
console.log('retained trace vs measured: median %s m   dE median %s   dN median %s',
  ds[Math.floor(ds.length / 2)].toFixed(2),
  off.map(o => o.dE).sort((a, b) => a - b)[Math.floor(off.length / 2)].toFixed(2),
  off.map(o => o.dN).sort((a, b) => a - b)[Math.floor(off.length / 2)].toFixed(2));
writeFileSync(resolve(HERE, '../cache/range/mat-line-raw.json'),
  JSON.stringify({ window: WIN, cut: CUT, localRadiusPixels: R, mats: blobs, retainedComparison: off }, null, 2) + '\n');
