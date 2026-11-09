/* Measures proposed reference windows before they are declared (evidence of how a sample was chosen; first
   used for Norrfällsviken, 2026-11-09). Detector-neutral, as window-scan-r5.mjs: the reference panels'
   over-segmenting apex filter on the pit-free CHM (apexes of at least 3 m, not trees), the detect census's
   16 m stratum rule, the leaf-off photo's vegetated share (the census's leaf-off class), the play zone, the
   nearest hole and the distances to mapped water and buildings. No detector output is read.

   node tools/tree-pipeline/photo/window-measure.mjs --ground <id> --windows <file.json> [--out <file.json>]
   node tools/tree-pipeline/photo/window-measure.mjs --ground <id> --windows <file.json> --scan water|building [--size 40]
     lists the near-play windows (5 m lattice) with the most apexes within 6 m of mapped water (or buildings),
     one per 60 m, at least 15 m from every listed window
   <file.json>: [{ "id": "C1-h1-isolated", "role": "calibration", "bbox": [minE, minN, maxE, maxN] }, ...] */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { lineDistance, nearPlay, playGeometry } from '../geometry.mjs';
import { loadMosaic, loadRaster } from '../panels.mjs';
import { overSegmentCandidates } from '../reference.mjs';
import { closedness, photoDisc } from '../crown-evidence.mjs';
import { leafOffClass, stratumOf } from '../detect.mjs';
import { courseExclusionFeatures } from '../../../packages/course-v2/vegetation/semantic-exclusions.mjs';

const { values: args } = parseArgs({ options: { ground: { type: 'string' }, windows: { type: 'string' }, out: { type: 'string' }, scan: { type: 'string' }, size: { type: 'string', default: '40' } } });
if (!args.ground || !args.windows) throw new Error('usage: --ground <id> --windows <file.json> [--out <file.json>]');
const ctx = loadGroundConfig(ROOT, args.ground);
const windows = JSON.parse(fs.readFileSync(args.windows, 'utf8'));
const { groundCourses, geometry, holeLines, practiceRings } = playGeometry(ctx);
const chm = loadRaster(ctx, 'chm-pitfree-050');
const leafOff = loadMosaic(ctx, ctx.leafOff.key);
const shift = ctx.ortho(ctx.leafOff.key).shift;

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
const distanceTo = (e, n, lines) => {
  let best = Infinity;
  for (const line of lines) {
    const closed = line.length > 3 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];
    if (closed && insideRing(e, n, line)) return 0;
    best = Math.min(best, lineDistance(e, n, line));
  }
  return best;
};
const water = edgesOf('water').concat(edgesOf('stream'), edgesOf('coast'));
const buildings = edgesOf('building');
const holeOf = (e, n) => {
  let best = null;
  for (const course of groundCourses) for (const h of course.geometry.holes || []) {
    if (!Array.isArray(h.line)) continue;
    const d = lineDistance(e, n, h.line);
    if (!best || d < best.d) best = { d: Math.round(d), hole: `${course.slug}/${h.n ?? h.number}` };
  }
  return best;
};
const overlaps = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

if (args.scan) {
  const lines = args.scan === 'water' ? water : args.scan === 'building' ? buildings : null;
  if (!lines) throw new Error('--scan water|building');
  const W = ctx.innerWindow, STEP = 5, size = Number(args.size);
  const all = overSegmentCandidates(chm, [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing], 0).filter(c => c.heightMetres >= 3);
  const cols = Math.ceil((W.maxEasting - W.minEasting) / STEP), rows = Math.ceil((W.maxNorthing - W.minNorthing) / STEP);
  const prefix = key => new Float64Array((cols + 1) * (rows + 1));
  const hit = prefix(), total = prefix();
  const lineBoxes = lines.map(line => ({ line, box: line.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]) }));
  for (const a of all) {
    const c = Math.floor((a.easting - W.minEasting) / STEP), r = Math.floor((a.northing - W.minNorthing) / STEP);
    total[(r + 1) * (cols + 1) + c + 1]++;
    const near = lineBoxes.filter(({ box }) => a.easting >= box[0] - 6 && a.easting <= box[2] + 6 && a.northing >= box[1] - 6 && a.northing <= box[3] + 6).map(x => x.line);
    if (near.length && distanceTo(a.easting, a.northing, near) <= 6) hit[(r + 1) * (cols + 1) + c + 1]++;
  }
  for (const L of [hit, total]) for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) L[r * (cols + 1) + c] += L[(r - 1) * (cols + 1) + c] + L[r * (cols + 1) + c - 1] - L[(r - 1) * (cols + 1) + c - 1];
  const sum = (L, c0, r0, c1, r1) => L[r1 * (cols + 1) + c1] - L[r0 * (cols + 1) + c1] - L[r1 * (cols + 1) + c0] + L[r0 * (cols + 1) + c0];
  const found = [];
  for (let c0 = 0; c0 + size / STEP <= cols; c0++) for (let r0 = 0; r0 + size / STEP <= rows; r0++) {
    const c1 = c0 + size / STEP, r1 = r0 + size / STEP;
    const k = sum(hit, c0, r0, c1, r1);
    if (k < 3) continue;
    const bbox = [W.minEasting + c0 * STEP, W.minNorthing + r0 * STEP, W.minEasting + c1 * STEP, W.minNorthing + r1 * STEP];
    if (windows.some(o => overlaps(o.bbox, bbox, 15))) continue;
    if (!nearPlay((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2, holeLines, practiceRings, ctx.config.playZone.nearMetres)) continue;
    found.push({ bbox, [args.scan]: k, apexes: sum(total, c0, r0, c1, r1) });
  }
  found.sort((a, b) => b[args.scan] - a[args.scan] || b.apexes - a.apexes);
  const kept = [];
  for (const o of found) { if (kept.some(k => overlaps(k.bbox, o.bbox, 60))) continue; kept.push(o); if (kept.length >= 8) break; }
  for (const o of kept) { const h = holeOf((o.bbox[0] + o.bbox[2]) / 2, (o.bbox[1] + o.bbox[3]) / 2); console.log(JSON.stringify({ ...o, hole: h.hole, d: h.d })); }
  process.exit(0);
}
const report = windows.map(w => {
  const apexes = overSegmentCandidates(chm, w.bbox, 0).filter(c => c.heightMetres >= 3);
  const count = { apexes: apexes.length, isolated: 0, group: 0, edge: 0, closed: 0, 'conifer-like': 0, mixed: 0, leafless: 0, unknown: 0, near: 0, byWater: 0, byBuilding: 0, tallest: 0 };
  for (const a of apexes) {
    count[stratumOf(closedness(chm, a.easting, a.northing))]++;
    const disc = photoDisc(leafOff, a.easting + (shift?.dE ?? 0), a.northing + (shift?.dN ?? 0), 1.5 + 0.15 * a.heightMetres);
    count[leafOffClass(disc?.vegetatedShare)]++;
    if (nearPlay(a.easting, a.northing, holeLines, practiceRings, ctx.config.playZone.nearMetres)) count.near++;
    if (distanceTo(a.easting, a.northing, water) <= 6) count.byWater++;
    if (distanceTo(a.easting, a.northing, buildings) <= 6) count.byBuilding++;
    count.tallest = Math.max(count.tallest, Math.round(a.heightMetres));
  }
  const cx = (w.bbox[0] + w.bbox[2]) / 2, cy = (w.bbox[1] + w.bbox[3]) / 2;
  const clash = windows.filter(o => o.id !== w.id && overlaps(o.bbox, w.bbox, 15)).map(o => o.id);
  return { id: w.id, role: w.role, bbox: w.bbox, size: [w.bbox[2] - w.bbox[0], w.bbox[3] - w.bbox[1]], nearest: holeOf(cx, cy), ...count, within15mOf: clash };
});
for (const r of report) console.log(`${r.id.padEnd(22)} ${String(r.role).padEnd(11)} ${r.size.join('x').padEnd(6)} apexes ${String(r.apexes).padStart(3)}  iso ${r.isolated} grp ${r.group} edge ${r.edge} cl ${r.closed}  con ${r['conifer-like']} mix ${r.mixed} bare ${r.leafless}  near ${r.near} water ${r.byWater} bldg ${r.byBuilding} max ${r.tallest} m  ${r.nearest?.hole} ${r.nearest?.d} m${r.within15mOf.length ? `  CLASH ${r.within15mOf}` : ''}`);
const totals = role => report.filter(r => r.role === role).reduce((a, r) => a + r.apexes, 0);
console.log(`apexes: calibration ${totals('calibration')}, evaluation ${totals('evaluation')}`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ schemaVersion: 1, kind: 'reference-window-measure', groundId: ctx.groundId, note: 'detector-neutral measurements of the proposed windows (apexes of the reference panels\' over-segmenting filter, not trees)', windows: report }, null, 1) + '\n');
