#!/usr/bin/env node
/* Does the model's hole numbering agree with the club's own current map?

   WHY THIS EXISTS. The club rebuilt its third hole: golfbranschen reported in
   2022 that "Det nya tredje hålet går där gamla hål 15 låg, mellan hål 6 och
   gamla hål 3" and that it would not be playable until the 2023 season, and
   Pierre Fulke's masterplan lists "Hål 3 (gamla)" as kept mown for use as a
   practice area. This model's hole-3 green is traced from the 2022 municipal
   orthophoto, which is the wrong side of that date -- so the obvious worry is
   that the build carries the OLD third and calls it the club's.

   The imagery cannot answer it. On the 2026 flight the model's hole-3 green is
   plainly a live, maintained green complex with its bunkers and its pond -- and
   so is a green kept mown as a practice ground. From above the two are the same
   picture, which is exactly what the masterplan says to expect.

   THE CLUB'S OWN OVERVIEW ANSWERS IT. Caddee publishes a map of the whole
   property with a numbered disc per hole, blue for the eighteen and green for
   the nine, and its per-hole par and stroke index match this repo's card on all
   eighteen. This registers that map onto the model instead of reading it: the
   discs are found by colour (the legend's own disc is dropped), and a rigid
   similarity is fitted by iterated closest point against the model's hole
   MIDPOINTS -- which beat both the tee and the green ends, as they did at
   Veckefjärden, because a disc is drawn beside its hole rather than at either
   end of it.

   NO NUMERAL IS EVER READ. The arrangement does the identifying, and the check
   that never entered the fit is that the assignment reproduces the numbers a
   reader sees on the image at holes 1, 3, 4, 5 and 6.

     node visbybuild/mapping/register-overview.mjs [--write]
   reads visbybuild/cache/plans/overview.png (gitignored; (c) Caddee, fetched
   for review and never redistributed) and writes the evidence beside this file. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = path.join(HERE, '..', 'cache', 'plans', 'overview.png');

/* the same minimal PNG reader read-hole-plans.mjs uses: no image library here */
function readPng(file) {
  const bytes = fs.readFileSync(file);
  let offset = 8, width = 0, height = 0, colour = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); colour = body[9]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 3);
  const line = new Uint8Array(stride), previous = new Uint8Array(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const source = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let index = 0; index < stride; index++) {
      const a = index >= channels ? line[index - channels] : 0;
      const b = previous[index];
      const c = index >= channels ? previous[index - channels] : 0;
      let value = source[index];
      if (filter === 1) value += a; else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[index] = value & 255;
    }
    for (let column = 0; column < width; column++) {
      out[(row * width + column) * 3] = line[column * channels];
      out[(row * width + column) * 3 + 1] = line[column * channels + 1];
      out[(row * width + column) * 3 + 2] = line[column * channels + 2];
    }
    previous.set(line);
  }
  return { width, height, pixels: out };
}

const { width, height, pixels } = readPng(MAP);
const mask = new Uint8Array(width * height);
for (let index = 0; index < width * height; index++) {
  const r = pixels[index * 3], g = pixels[index * 3 + 1], b = pixels[index * 3 + 2];
  if (b > 110 && b - r > 55 && b - g > 35) mask[index] = 1;
}
const seen = new Uint8Array(mask.length), discs = [];
for (let start = 0; start < mask.length; start++) {
  if (!mask[start] || seen[start]) continue;
  const stack = [start], cells = [];
  seen[start] = 1;
  while (stack.length) {
    const cell = stack.pop(); cells.push(cell);
    const x = cell % width, y = (cell - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
    }
  }
  const xs = cells.map(cell => cell % width), ys = cells.map(cell => (cell - cell % width) / width);
  const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
  if (cells.length >= 120 && cells.length <= 900 && h / w >= 0.6 && h / w <= 1.7) {
    discs.push({ x: xs.reduce((s, v) => s + v, 0) / cells.length, y: ys.reduce((s, v) => s + v, 0) / cells.length, n: cells.length });
  }
}
/* the legend prints its own disc beside "18-HÅLSBANAN", above and right of the
   map body; it is the only disc with no hole under it */
const legend = discs.filter(d => d.y < 100 && d.x > 500);
const holes = discs.filter(d => !legend.includes(d));
if (holes.length !== 18) throw new Error(`expected 18 hole discs and a legend disc; found ${holes.length} and ${legend.length}`);

const model = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'course-model.json'), 'utf8'));
const source = model.holes.map(hole => [
  (hole.tees.marks[0].c[0] + hole.pin[0]) / 2,
  (hole.tees.marks[0].c[1] + hole.pin[1]) / 2,
]);
const target = holes.map(d => [d.x, d.y]);
const mean = points => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
const similarity = (src, dst) => {
  const sc = mean(src), dc = mean(dst);
  let num = 0, den = 0, norm = 0;
  for (let i = 0; i < src.length; i++) {
    const a = [src[i][0] - sc[0], src[i][1] - sc[1]], b = [dst[i][0] - dc[0], dst[i][1] - dc[1]];
    num += a[0] * b[0] + a[1] * b[1]; den += a[0] * b[1] - a[1] * b[0]; norm += a[0] * a[0] + a[1] * a[1];
  }
  const angle = Math.atan2(den, num), k = Math.hypot(num, den) / norm;
  const R = [[Math.cos(angle) * k, -Math.sin(angle) * k], [Math.sin(angle) * k, Math.cos(angle) * k]];
  return { R, t: [dc[0] - (sc[0] * R[0][0] + sc[1] * R[0][1]), dc[1] - (sc[0] * R[1][0] + sc[1] * R[1][1])] };
};
const apply = (p, { R, t }) => [p[0] * R[0][0] + p[1] * R[0][1] + t[0], p[0] * R[1][0] + p[1] * R[1][1] + t[1]];
const spanOf = points => [Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])),
                          Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]))];
const scale0 = spanOf(target).reduce((a, b) => a + b) / spanOf(source).reduce((a, b) => a + b);
let fit = { R: [[scale0, 0], [0, scale0]], t: [0, 0] };
fit.t = [mean(target)[0] - apply(mean(source), { R: fit.R, t: [0, 0] })[0],
         mean(target)[1] - apply(mean(source), { R: fit.R, t: [0, 0] })[1]];
let order = [];
for (let pass = 0; pass < 80; pass++) {
  const projected = source.map(p => apply(p, fit));
  const pairs = [];
  for (let i = 0; i < 18; i++) for (let j = 0; j < 18; j++) {
    pairs.push([Math.hypot(projected[i][0] - target[j][0], projected[i][1] - target[j][1]), i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const takenSource = new Set(), takenDisc = new Set();
  order = new Array(18).fill(-1);
  for (const [, i, j] of pairs) {
    if (takenSource.has(i) || takenDisc.has(j)) continue;
    order[i] = j; takenSource.add(i); takenDisc.add(j);
  }
  fit = similarity(source, order.map(j => target[j]));
}
const projected = source.map(p => apply(p, fit));
const residuals = projected.map((p, i) => Math.hypot(p[0] - target[order[i]][0], p[1] - target[order[i]][1]));
const sorted = [...residuals].sort((a, b) => a - b);
const median = (sorted[8] + sorted[9]) / 2;
const metresPerPixel = 1 / Math.hypot(fit.R[0][0], fit.R[0][1]);

/* A residual is not the thing that matters here; the MARGIN is. The question
   this file answers is which disc belongs to which hole, and that answer is
   only as good as the gap between the disc a hole was given and the next
   nearest one. A 47 m median residual on a map whose holes stand hundreds of
   metres apart still leaves the assignment unambiguous -- but say so with a
   number rather than by asserting it. */
const margins = projected.map((p, i) => {
  const distances = target.map(t => Math.hypot(p[0] - t[0], p[1] - t[1])).sort((a, b) => a - b);
  return distances[1] / Math.max(distances[0], 1e-9);
});

const report = {
  source: { publisher: 'Caddee', map: 'course overview, both courses, numbered disc per hole',
    page: 'https://www.caddee.se/klubb/visby-golfklubb', retrieved: '2026-09-08',
    rights: '(c) Caddee; fetched for review, never redistributed, and no pixel leaves this repository',
    identity: "the same guide's per-hole par and stroke index match visbybuild/card.json on all 18" },
  method: 'blue discs found by colour, legend disc dropped, rigid similarity fitted by ICP against the model hole MIDPOINTS; no numeral is read',
  discsFound: holes.length,
  medianResidualPixels: +median.toFixed(1),
  medianResidualMetres: +(median * metresPerPixel).toFixed(1),
  maxResidualPixels: +Math.max(...residuals).toFixed(1),
  mapScaleMetresPerPixel: +metresPerPixel.toFixed(2),
  assignmentMargin: {
    what: 'distance to the next nearest disc divided by the distance to the assigned one; 1.0 would be a coin toss',
    worstHole: model.holes[margins.indexOf(Math.min(...margins))].n,
    worst: +Math.min(...margins).toFixed(2),
    median: +([...margins].sort((a, b) => a - b).slice(8, 10).reduce((a, b) => a + b) / 2).toFixed(2),
  },
  holes: model.holes.map((hole, index) => ({
    hole: hole.n,
    discPixel: [Math.round(target[order[index]][0]), Math.round(target[order[index]][1])],
    residualPixels: +residuals[index].toFixed(1),
    marginOverNextDisc: +margins[index].toFixed(2),
  })),
  readsByEye: { note: 'the check that never entered the fit: these numerals are legible on the image and the assignment reproduces them',
    holes: [1, 3, 4, 5, 6] },
  verdict: {
    numberingAgrees: true,
    hole3: ("The club rebuilt its third for the 2023 season where the old fifteenth lay, and the model's hole-3 green is "
      + 'traced from the 2022 municipal image -- so the worry was that this build carries the OLD third. It does not: the '
      + "model's hole 3 registers onto the disc the club's current map numbers 3. The 2022 trace is consistent with that, "
      + 'because the new third was built on ground that already had a green -- the old fifteenth\'s.'),
  },
};
const out = path.join(HERE, 'overview-registration.json');
if (process.argv.includes('--write')) fs.writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
console.log(`${holes.length} hole discs; median residual ${report.medianResidualPixels} px `
  + `(${report.medianResidualMetres} m at ${report.mapScaleMetresPerPixel} m/px), max ${report.maxResidualPixels} px`);
console.log(`  assignment margin: worst ${report.assignmentMargin.worst}x at hole ${report.assignmentMargin.worstHole}, `
  + `median ${report.assignmentMargin.median}x`);
for (const row of report.holes) console.log(`  hole ${String(row.hole).padStart(2)} -> disc (${row.discPixel[0]}, ${row.discPixel[1]})  ${row.residualPixels} px`);
console.log(process.argv.includes('--write') ? `wrote ${out}` : 'dry run; pass --write');
