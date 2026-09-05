/* Tracing crops on the orthoimagery, with the model drawn over it. Orthorectified
   tiles need no registration, so a coordinate read off a gridded crop IS a world
   coordinate; that is how the four screenshot-traced buildings were corrected
   (8-13 m out) and how every green was judged against its survey ring.

   Usage (SAT_REL=27982 for the leaf-on capture, BUILD=<dir> for another course):
     node geobuild/imagery/crops.mjs sheet out.png [sizeM=90] [ppm=3]        all greens, one panel each
     node geobuild/imagery/crops.mjs green <hole> out.png [size=70] [ppm=8] [--model] [--enhance]
     node geobuild/imagery/crops.mjs evidence out.png <hole> [hole...]      imagery | smoothed brightness | DTM roughness
     node geobuild/imagery/crops.mjs object out.png <cx> <cz> <sizeM> [ppm=3]   buildings, roads, lots, greens, bunkers
   Colours: cyan = surveyed (OSM) green, orange = plan-traced green, yellow = bunkers, white =
   buildings/tee pads, red = traced buildings, magenta cross = GPS green centre, grid every 10 m. */
import fs from 'node:fs';
import { encodePNG } from '../png.mjs';
import { rgbAt } from './wayback.mjs';
import { model, survey, renderHTML, quant } from './lib.mjs';

const m = model(), G = survey();
const [cmd, ...a] = process.argv.slice(2);
const flags = new Set(a.filter(x => x.startsWith('--'))); const args = a.filter(x => !x.startsWith('--'));
const raster = (x0, z0, size, ppm) => { const P = Math.round(size * ppm); const rgb = new Uint8Array(P * P * 3); for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) { const v = rgbAt(x0 + px / ppm, z0 + py / ppm) || [0, 0, 0]; const i = (py * P + px) * 3; rgb[i] = v[0]; rgb[i + 1] = v[1]; rgb[i + 2] = v[2]; } return { P, rgb }; };
const stretch = rgb => { const n = rgb.length / 3, sum = new Float32Array(n); for (let i = 0; i < n; i++) sum[i] = rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]; const lo = quant(sum, 0.03), hi = quant(sum, 0.97); const out = new Uint8Array(rgb.length); for (let i = 0; i < n; i++) { const g = Math.max(0, Math.min(1, (sum[i] - lo) / (hi - lo))); const sc = (0.3 + 0.7 * g) * 3 * 130 / Math.max(1, sum[i]); for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.max(0, Math.min(255, rgb[i * 3 + k] * sc)); } return out; };
const svgFor = (x0, z0, size, ppm, opts = {}) => {
  const P = Math.round(size * ppm); const T = (x, z) => `${((x - x0) * ppm).toFixed(1)},${((z - z0) * ppm).toFixed(1)}`;
  const poly = (r, col, w = 1.5, dash = '') => `<polygon points="${r.map(p => T(p[0], p[1])).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  const line = (r, col, w = 1.5) => `<polyline points="${r.map(p => T(p[0], p[1])).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  const inBox = r => r.some(p => p[0] > x0 - 20 && p[0] < x0 + size + 20 && p[1] > z0 - 20 && p[1] < z0 + size + 20);
  let s = '';
  if (opts.objects) {
    for (const b of m.infra?.buildings || []) if (inBox(b.ring)) s += poly(b.ring, b.prov === 'trace' ? '#ff3030' : '#ffffff', 2);
    for (const r of m.infra?.roads || []) if (r.line && inBox(r.line)) s += line(r.line, '#bbbbbb', 1);
    for (const r of m.infra?.paths || []) if (r.line && inBox(r.line)) s += line(r.line, '#ffaa00', 1);
    for (const p of m.infra?.parking || []) if (p.ring && inBox(p.ring)) s += poly(p.ring, '#4488ff', 1.5, '4,3');
    for (const w of m.water || []) if (inBox(w.ring)) s += poly(w.ring, '#40a0ff', 1.5);
  }
  if (opts.holes !== false) for (const h of m.holes) { if (inBox(h.green.ring)) s += poly(h.green.ring, h.green.prov === 'osm' ? '#00ffff' : '#ff9900', 1.5); for (const b of h.bunkers || []) if (inBox(b.ring)) s += poly(b.ring, '#ffff00', 1); if (opts.pads) for (const t of h.tees?.pads || []) if (inBox(t.ring)) s += poly(t.ring, '#ffffff', 1); }
  for (const r of opts.extra || []) s += poly(r.ring, r.col || '#ff0000', 2);
  if (opts.cross) s += `<line x1="${(opts.cross[0] - x0) * ppm - 8}" y1="${(opts.cross[1] - z0) * ppm}" x2="${(opts.cross[0] - x0) * ppm + 8}" y2="${(opts.cross[1] - z0) * ppm}" stroke="#f0f" stroke-width="2"/><line x1="${(opts.cross[0] - x0) * ppm}" y1="${(opts.cross[1] - z0) * ppm - 8}" x2="${(opts.cross[0] - x0) * ppm}" y2="${(opts.cross[1] - z0) * ppm + 8}" stroke="#f0f" stroke-width="2"/>`;
  for (let x = Math.ceil(x0 / 10) * 10; x <= x0 + size; x += 10) s += `<line x1="${(x - x0) * ppm}" y1="0" x2="${(x - x0) * ppm}" y2="${P}" stroke="${x % 50 ? '#ffffff33' : '#ffff0088'}"/>${x % 50 ? '' : `<text x="${(x - x0) * ppm + 2}" y="12" style="font:bold 11px sans-serif;fill:#ff0;text-shadow:0 0 3px #000">${x}</text>`}`;
  for (let z = Math.ceil(z0 / 10) * 10; z <= z0 + size; z += 10) s += `<line x1="0" y1="${(z - z0) * ppm}" x2="${P}" y2="${(z - z0) * ppm}" stroke="${z % 50 ? '#ffffff33' : '#ffff0088'}"/>${z % 50 ? '' : `<text x="2" y="${(z - z0) * ppm - 2}" style="font:bold 11px sans-serif;fill:#ff0;text-shadow:0 0 3px #000">${z}</text>`}`;
  if (opts.label) s += `<text x="4" y="${P - 6}" style="font:bold 13px sans-serif;fill:#fff;text-shadow:0 0 3px #000">${opts.label}</text>`;
  return `<svg style="position:absolute;left:0;top:0" width="${P}" height="${P}">${s}</svg>`;
};
const panel = (rgb, P, svg) => `<div style="position:relative;width:${P}px;height:${P}px"><img src="data:image/png;base64,${encodePNG(P, P, rgb).toString('base64')}" style="position:absolute;left:0;top:0;width:${P}px;height:${P}px">${svg}</div>`;
const page = (panels, cols, P) => `<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(${cols},${P}px);gap:3px">${panels.join('')}</div></body>`;

if (cmd === 'sheet') {
  const [out, size = 90, ppm = 3] = [args[0], +(args[1] || 90), +(args[2] || 3)]; const panels = []; let P = 0;
  for (const h of m.holes) { const c = G[h.n]['Green Center']; const x0 = c[0] - size / 2, z0 = c[1] - size / 2; const r = raster(x0, z0, size, ppm); P = r.P; panels.push(panel(r.rgb, P, svgFor(x0, z0, size, ppm, { pads: true, cross: c, label: `hål ${h.n}` }))); }
  const cols = 6; await renderHTML(page(panels, cols, P), cols * (P + 3), Math.ceil(panels.length / cols) * (P + 3), out); console.log('wrote', out);
} else if (cmd === 'green') {
  const n = +args[0], out = args[1], size = +(args[2] || 70), ppm = +(args[3] || 8); const c = G[n]['Green Center']; const x0 = Math.round(c[0]) - size / 2, z0 = Math.round(c[1]) - size / 2;
  const r = raster(x0, z0, size, ppm); const rgb = flags.has('--enhance') ? stretch(r.rgb) : r.rgb;
  await renderHTML(page([panel(rgb, r.P, svgFor(x0, z0, size, ppm, { holes: flags.has('--model'), pads: flags.has('--model'), cross: c, label: `hål ${n} · ${ppm} px/m` }))], 1, r.P), r.P, r.P, out); console.log('wrote', out, `x ${x0}..${x0 + size} z ${z0}..${z0 + size}`);
} else if (cmd === 'evidence') {
  const { loadTerrain } = await import('../dtm-lib.mjs'); const T = loadTerrain(); const out = args[0], holes = args.slice(1).map(Number); const size = 70, ppm = 4, P = size * ppm; const panels = [];
  const rough = (x, z) => { const c = T.hAt(x, z), nb = [T.hAt(x + 1, z), T.hAt(x - 1, z), T.hAt(x, z + 1), T.hAt(x, z - 1)]; return Math.abs(4 * c - nb.reduce((p, q) => p + q, 0)); };
  const smooth = (F, k) => { const o = new Float32Array(P * P); for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { let s = 0, q = 0; for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= P || jj >= P) continue; const v = F[jj * P + ii]; if (Number.isFinite(v)) { s += v; q++; } } o[j * P + i] = q ? s / q : NaN; } return o; };
  const gray = (F, invert) => { const lo = quant(F, 0.03), hi = quant(F, 0.97); const A = new Uint8Array(P * P * 3); for (let i = 0; i < P * P; i++) { let g = Math.max(0, Math.min(1, (F[i] - lo) / (hi - lo))); if (invert) g = 1 - g; const v = Math.round(g * 255); A[i * 3] = v; A[i * 3 + 1] = v; A[i * 3 + 2] = Math.round(v * 0.75); } return A; };
  for (const n of holes) { const c = G[n]['Green Center']; const x0 = Math.round(c[0]) - size / 2, z0 = Math.round(c[1]) - size / 2; const r = raster(x0, z0, size, ppm); const sum = new Float32Array(P * P), ro = new Float32Array(P * P); for (let i = 0; i < P * P; i++) { sum[i] = r.rgb[i * 3] + r.rgb[i * 3 + 1] + r.rgb[i * 3 + 2]; ro[i] = rough(x0 + (i % P) / ppm, z0 + Math.floor(i / P) / ppm); } const svg = svgFor(x0, z0, size, ppm, { cross: c, label: `hål ${n}` }); for (const img of [stretch(r.rgb), gray(smooth(sum, 6), false), gray(smooth(ro, 8), true)]) panels.push(panel(img, P, svg)); }
  await renderHTML(page(panels, 3, P), 3 * (P + 3), holes.length * (P + 3), out); console.log('wrote', out);
} else if (cmd === 'object') {
  const [out, cx, cz, size] = [args[0], +args[1], +args[2], +args[3]]; const ppm = +(args[4] || 3); const x0 = cx - size / 2, z0 = cz - size / 2; const r = raster(x0, z0, size, ppm);
  await renderHTML(page([panel(r.rgb, r.P, svgFor(x0, z0, size, ppm, { objects: true, pads: true }))], 1, r.P), r.P, r.P, out); console.log('wrote', out, `x ${x0}..${x0 + size} z ${z0}..${z0 + size}`);
} else console.log('usage: sheet | green | evidence | object  (see the header)');
