/* Round-5 window scan (evidence of how the Y windows were chosen).
   Detector-neutral: the reference panels' over-segmenting apex filter on the
   pit-free CHM, the detect census's 16 m stratum rule, the play zone, and the
   distances to mapped water and buildings. No detector output, candidate
   decision or photo crown is read. Windows keep 15 m from every earlier
   window (and the dropped ones) and stay out of EXCLUDED: areas whose
   detector output the main session looked at before the sample was frozen.

   node tools/tree-pipeline/photo/window-scan-r5.mjs --raw <cache> [--top 6]  */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { lineDistance, nearPlay, playGeometry } from '../geometry.mjs';
import { loadRaster } from '../panels.mjs';
import { overSegmentCandidates } from '../reference.mjs';
import { courseExclusionFeatures } from '../../../packages/course-v2/vegetation/semantic-exclusions.mjs';

export const EXCLUDED = [
  { bbox: [679130, 6625620, 679330, 6626140], why: 'hole 18 by the water: the main session read the round-4 candidates and holds there on 2026-11-09 (the owner report of missing shore trees)' },
];

const { values: args } = parseArgs({ options: { raw: { type: 'string' }, top: { type: 'string', default: '6' } } });
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: args.raw, round: 'r4b' });
const top = Number(args.top);
const { groundCourses, geometry, holeLines, practiceRings } = playGeometry(ctx);
const chm = loadRaster(ctx, 'chm-pitfree-050');
const g = chm.grid;
const at = (e, n) => {
  const c = Math.floor((e - g.minEasting) / 0.5), r = Math.floor((g.maxNorthing - n) / 0.5);
  return c < 0 || r < 0 || c >= g.width || r >= g.height ? 0 : chm.values[r * g.width + c];
};
const share = (e, n) => {
  let k = 0, t = 0;
  for (let y = -8; y < 8; y += 1) for (let x = -8; x < 8; x += 1) { t++; if (at(e + x + 0.5, n + y + 0.5) >= 3) k++; }
  return k / t;
};
const declared = JSON.parse(fs.readFileSync(ctx.reviewFile('reference-windows-r4b.json'), 'utf8'));
const earlier = [...declared.windows, ...(declared.dropped || [])];
const overlaps = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

/* apexes of the whole inner window, by the reference panels' filter */
const W = ctx.innerWindow;
const apexes = overSegmentCandidates(chm, [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing], 0).filter(c => c.heightMetres >= 3);
const features = courseExclusionFeatures(geometry);
const edgesOf = kind => features.filter(f => f.kind === kind).flatMap(f => [...(f.rings || []).map(r => [...r, r[0]]), ...(f.lines || [])]);
const insideRing = (e, n, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const indexed = list => list.map(line => ({ line, closed: line.length > 3 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1], bbox: line.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]) }));
const waterIx = indexed(edgesOf('water').concat(edgesOf('stream'))), buildingIx = indexed(edgesOf('building'));
const distanceTo = (e, n, ix, reach) => {
  let best = Infinity;
  for (const { line, closed, bbox } of ix) {
    if (e < bbox[0] - reach || e > bbox[2] + reach || n < bbox[1] - reach || n > bbox[3] + reach) continue;
    if (closed && insideRing(e, n, line)) return 0;
    best = Math.min(best, lineDistance(e, n, line));
  }
  return best;
};

/* 5 m cells, prefix sums per attribute */
const STEP = 5;
const cols = Math.ceil((W.maxEasting - W.minEasting) / STEP), rows = Math.ceil((W.maxNorthing - W.minNorthing) / STEP);
const keys = ['n', 'iso', 'grp', 'edge', 'cl', 'water', 'building'];
const layers = Object.fromEntries(keys.map(k => [k, new Float64Array((cols + 1) * (rows + 1))]));
for (const a of apexes) {
  const c = Math.floor((a.easting - W.minEasting) / STEP), r = Math.floor((a.northing - W.minNorthing) / STEP);
  const add = k => { layers[k][(r + 1) * (cols + 1) + (c + 1)] += 1; };
  const s = share(a.easting, a.northing);
  add('n');
  add(s < 0.2 ? 'iso' : s < 0.45 ? 'grp' : s < 0.75 ? 'edge' : 'cl');
  if (distanceTo(a.easting, a.northing, waterIx, 6) <= 6) add('water');
  if (distanceTo(a.easting, a.northing, buildingIx, 6) <= 6) add('building');
}
for (const k of keys) {
  const L = layers[k], w = cols + 1;
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) L[r * w + c] += L[(r - 1) * w + c] + L[r * w + c - 1] - L[(r - 1) * w + c - 1];
}
const sum = (k, c0, r0, c1, r1) => { const L = layers[k], w = cols + 1; return L[r1 * w + c1] - L[r0 * w + c1] - L[r1 * w + c0] + L[r0 * w + c0]; };
const holeOf = (e, n) => {
  let best = null;
  for (const course of groundCourses) for (const h of course.geometry.holes || []) {
    if (!Array.isArray(h.line)) continue;
    const d = lineDistance(e, n, h.line);
    if (!best || d < best.d) best = { d, label: `${course.slug}/${h.n}` };
  }
  return best;
};
const scan = (w, h, key, minimum) => {
  const out = [];
  for (let c0 = 0; c0 + w / STEP <= cols; c0++) for (let r0 = 0; r0 + h / STEP <= rows; r0++) {
    const c1 = c0 + w / STEP, r1 = r0 + h / STEP;
    const n = sum('n', c0, r0, c1, r1);
    if (n < minimum) continue;
    const bbox = [W.minEasting + c0 * STEP, W.minNorthing + r0 * STEP, W.minEasting + c1 * STEP, W.minNorthing + r1 * STEP];
    if (earlier.some(p => overlaps(bbox, p.bbox, 15)) || EXCLUDED.some(x => overlaps(bbox, x.bbox, 15))) continue;
    const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
    if (!nearPlay(cx, cy, holeLines, practiceRings, ctx.config.playZone.nearMetres)) continue;
    const v = Object.fromEntries(keys.map(k => [k, sum(k, c0, r0, c1, r1)]));
    out.push({ bbox, ...v, share: Math.round(1000 * v[key] / n) / 1000, hole: holeOf(cx, cy) });
  }
  out.sort((a, b) => b.share - a.share || b.n - a.n);
  /* one per area: skip windows within 60 m of a better one */
  const kept = [];
  for (const o of out) {
    if (kept.some(k => overlaps(k.bbox, o.bbox, 60))) continue;
    kept.push(o);
    if (kept.length >= top) break;
  }
  return kept;
};
const report = {
  closed: scan(25, 25, 'cl', 20),
  edge: scan(40, 35, 'edge', 18),
  group: scan(50, 50, 'grp', 10),
  shore: scan(40, 40, 'water', 10),
  garden: scan(50, 50, 'building', 8),
};
console.log(`apexes >= 3 m: ${apexes.length}`);
for (const [k, list] of Object.entries(report)) {
  console.log(`== ${k}`);
  for (const o of list) console.log(' ', JSON.stringify({ bbox: o.bbox, n: o.n, share: o.share, iso: o.iso, grp: o.grp, edge: o.edge, cl: o.cl, water: o.water, building: o.building, hole: o.hole.label, d: Math.round(o.hole.d) }));
}
