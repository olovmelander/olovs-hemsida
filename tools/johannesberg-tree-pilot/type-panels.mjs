#!/usr/bin/env node
/* Conifer/broadleaf spot check on the photos: for chosen holes, every placed
   record within 90 m of the hole's line drawn by its measured type over the
   2021-04-18 leaf-off colour infrared, plus chips of a deterministic sample
   of the broadleaf calls (April colour infrared, April natural colour, June
   2025 natural colour, June colour infrared), each with its April vegetated
   share and type confidence. In leaf-off April a conifer crown is red in
   colour infrared and a broadleaf crown is grey-brown branches over the
   ground; in June both are green, but a birch's crown is paler and finer.

   usage: node tools/johannesberg-tree-pilot/type-panels.mjs [--course johannesberg] [--holes 1,17] [--sample 12]

   Output goes to the ignored cache only (photo pixels; the orthophoto
   redistribution review is pending in the source catalogue). */
import fs from 'node:fs';
import path from 'node:path';
import { loadGroundCourseGeometries } from '../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { PILOT } from './pilot-config.mjs';
import { Canvas, ROOT, drawGrid, loadMosaic, renderLayer, toPixel } from './panels.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const slug = flag('course', 'johannesberg');
const holes = flag('holes', '1,17').split(',').map(Number);
const sampleSize = Number(flag('sample', 12));
const file = flag('candidates', path.join(PILOT.cacheDir, 'candidates', 'candidates-full.json'));

const PLACED = new Set(['retain', 'adjust', 'add']);
const TYPE_COLOUR = { conifer: [255, 60, 220], broadleaf: [255, 230, 40], unknown: [255, 255, 255] };

function lineDistance(e, n, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - e, ay + dy * t - n));
  }
  return best;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const courses = loadGroundCourseGeometries(path.join(ROOT, 'geo_data/course-v2/johannesberg'), 'johannesberg');
const course = courses.find(c => c.slug === slug || c.courseId === slug) || courses[0];
const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).filter(t => PLACED.has(t.decision));
const m21 = loadMosaic('2021');
const m25 = loadMosaic('2025');
const outDir = path.join(ROOT, PILOT.cacheDir, 'type-panels');
fs.mkdirSync(outDir, { recursive: true });
const report = [];
for (const number of holes) {
  const hole = (course.geometry.holes || []).find(h => h.n === number || h.number === number || h.hole === number);
  if (!hole) throw new Error(`hole ${number} not found in ${slug}`);
  const near = candidates.filter(t => lineDistance(t.easting, t.northing, hole.line) <= 90);
  const counts = near.reduce((a, t) => { a[t.type] = (a[t.type] || 0) + 1; return a; }, {});
  /* the overview: every near record by type on April CIR */
  const es = hole.line.map(p => p[0]), ns = hole.line.map(p => p[1]);
  const bbox = [Math.min(...es) - 95, Math.min(...ns) - 95, Math.max(...es) + 95, Math.max(...ns) + 95];
  const mpp = Math.max(0.25, Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 1100);
  const overview = renderLayer({ kind: 'cir', mosaic: m21, bbox, metresPerPixel: mpp });
  for (let i = 1; i < hole.line.length; i++) {
    const [x0, y0] = toPixel(bbox, mpp, ...hole.line[i - 1]), [x1, y1] = toPixel(bbox, mpp, ...hole.line[i]);
    overview.line(x0, y0, x1, y1, [0, 255, 255]);
  }
  for (const t of near) {
    const [x, y] = toPixel(bbox, mpp, t.easting, t.northing);
    const colour = TYPE_COLOUR[t.type] || TYPE_COLOUR.unknown;
    if (t.type === 'conifer') overview.square(x, y, 2, colour); else overview.circle(x, y, 3, colour, { thickness: 2 });
  }
  drawGrid(overview, bbox, mpp, 50);
  overview.text(4, overview.height - 14, `HOLE ${number} APR 2021 CIR  MAGENTA SQUARE CONIFER  YELLOW RING BROADLEAF  WHITE UNKNOWN`, [255, 255, 255], 2);
  fs.writeFileSync(path.join(outDir, `${slug}-hole${number}-overview.png`), overview.png());
  /* the chips: a deterministic sample of the broadleaf calls */
  const broad = near.filter(t => t.type === 'broadleaf').sort((a, b) => hash(a.id) - hash(b.id)).slice(0, sampleSize);
  const chipMetres = 26, chipMpp = 0.13;
  const rows = [];
  for (const [k, t] of broad.entries()) {
    const box = [t.easting - chipMetres / 2, t.northing - chipMetres / 2, t.easting + chipMetres / 2, t.northing + chipMetres / 2];
    const panels = [['cir', m21, 'APR CIR'], ['rgb', m21, 'APR RGB'], ['rgb', m25, 'JUN RGB'], ['cir', m25, 'JUN CIR']].map(([kind, mosaic, label]) => {
      const c = renderLayer({ kind, mosaic, bbox: box, metresPerPixel: chipMpp });
      const [x, y] = toPixel(box, chipMpp, t.easting, t.northing);
      c.circle(x, y, t.radiusMetres / chipMpp, [255, 230, 40], { alpha: 0.8 });
      c.cross(x, y, 3, [255, 230, 40]);
      c.text(3, 3, `${k + 1} ${label}`, [255, 255, 255], 1);
      return c;
    });
    const row = new Canvas(panels[0].width * 4 + 9, panels[0].height + 14, [30, 30, 30]);
    panels.forEach((c, i) => row.blit(c, i * (c.width + 3), 0));
    row.text(3, panels[0].height + 3, `${k + 1} ${t.id} H${t.objectHeightMetres} R${t.radiusMetres} APRVEG ${t.evidence?.april2021?.vegetatedShare} CONF ${t.typeConfidence} ${t.decision}`, [230, 230, 230], 1);
    rows.push(row);
    report.push({ hole: number, n: k + 1, id: t.id, easting: t.easting, northing: t.northing, height: t.objectHeightMetres, radius: t.radiusMetres, aprilVegetatedShare: t.evidence?.april2021?.vegetatedShare, firstCanopyShare: t.evidence?.laser?.firstCanopyShare, groundShare: t.evidence?.laser?.groundShare, typeConfidence: t.typeConfidence, decision: t.decision, source: t.source });
  }
  const half = Math.ceil(rows.length / 2);
  for (const [part, list] of [[1, rows.slice(0, half)], [2, rows.slice(half)]]) {
    if (!list.length) continue;
    const sheet = new Canvas(list[0].width, list.reduce((a, r) => a + r.height + 4, 0), [20, 20, 20]);
    let y = 0;
    for (const r of list) { sheet.blit(r, 0, y); y += r.height + 4; }
    fs.writeFileSync(path.join(outDir, `${slug}-hole${number}-broadleaf-${part}.png`), sheet.png());
  }
  console.log(`hole ${number}: ${near.length} placed within 90 m`, JSON.stringify(counts), `sampled ${broad.length} broadleaf`);
}
fs.writeFileSync(path.join(outDir, `${slug}-sample.json`), JSON.stringify(report, null, 1) + '\n');
console.log('wrote', path.relative(ROOT, outDir));
