/* Which colour feature separates an artificial hitting mat from the strip it
 * lies on? Measured on the seventeen mats the model already carries against a
 * ring of background 3-6 m away, rather than assumed. */
import { sampleWindow, rgb, luminance, toPixel } from './ortho-sample.mjs';
import { readFileSync } from 'node:fs';
const model = JSON.parse(readFileSync(new URL('../course-model.json', import.meta.url), 'utf8'));
const ORIGIN = [597400.5, 6614899.5];
const toE = ([x, z]) => [ORIGIN[0] + x, ORIGIN[1] - z];
const mats = (model.scenery.mappedFeatures || []).filter(f => f.kind === 'range_tee_pad');
const rings = mats.map(m => m.rings[0].map(toE));
const WIN = { x: Math.round((597400 - 596880) / 0.32), y: Math.round((6616160 - 6615235) / 0.32), w: 240, h: 220 };
const s = await sampleWindow(WIN);
const px = ([e, n]) => { const [x, y] = toPixel([e, n]); return [x - WIN.x, y - WIN.y]; };
const ok = (i, j) => i >= 0 && j >= 0 && i < s.w && j < s.h;
const FEAT = {
  excessGreen: c => 2 * c[1] - c[0] - c[2],
  greenMinusRed: c => c[1] - c[0],
  greenMinusBlue: c => c[1] - c[2],
  blueMinusRed: c => c[2] - c[0],
  saturation: c => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? 255 * (mx - mn) / mx : 0; },
  luminance: c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
};
function interior(ring) {
  const pts = ring.map(px), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), out = [];
  for (let j = Math.floor(Math.min(...ys)); j <= Math.ceil(Math.max(...ys)); j++)
    for (let i = Math.floor(Math.min(...xs)); i <= Math.ceil(Math.max(...xs)); i++) {
      if (!ok(i, j)) continue;
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++)
        if ((pts[a][1] > j + .5) !== (pts[b][1] > j + .5)
          && i + .5 < (pts[b][0] - pts[a][0]) * (j + .5 - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0]) inside = !inside;
      if (inside) out.push([i, j]);
    }
  return out;
}
const onCells = [], offCells = [];
const matMask = new Set();
for (const ring of rings) for (const [i, j] of interior(ring)) { matMask.add(j * s.w + i); onCells.push(rgb(s, i, j)); }
/* background: within 6 m of a mat centre but not on any mat */
for (const ring of rings) {
  const c = px([ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length]);
  for (let j = Math.round(c[1]) - 12; j <= Math.round(c[1]) + 12; j++)
    for (let i = Math.round(c[0]) - 12; i <= Math.round(c[0]) + 12; i++) {
      if (!ok(i, j) || matMask.has(j * s.w + i)) continue;
      const d = Math.hypot(i - c[0], j - c[1]) * 0.32;
      if (d > 3 && d < 6) offCells.push(rgb(s, i, j));
    }
}
const stat = (cells, f) => {
  const v = cells.map(f).sort((a, b) => a - b), p = q => v[Math.floor(q * (v.length - 1))];
  return { p10: p(.1), med: p(.5), p90: p(.9) };
};
console.log('mat cells %s   background cells %s\n', onCells.length, offCells.length);
console.log('%s  %s  %s  %s', 'feature'.padEnd(16), 'MAT p10/med/p90'.padEnd(22), 'BG p10/med/p90'.padEnd(22), 'separation');
for (const [name, f] of Object.entries(FEAT)) {
  const a = stat(onCells, f), b = stat(offCells, f);
  const spread = (a.p90 - a.p10 + b.p90 - b.p10) / 2 || 1;
  console.log('%s  %s  %s  %s', name.padEnd(16),
    `${a.p10.toFixed(1)}/${a.med.toFixed(1)}/${a.p90.toFixed(1)}`.padEnd(22),
    `${b.p10.toFixed(1)}/${b.med.toFixed(1)}/${b.p90.toFixed(1)}`.padEnd(22),
    ((a.med - b.med) / spread).toFixed(2));
}
