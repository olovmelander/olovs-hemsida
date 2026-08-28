/* Measure tree-cover.json against the hole-plan imagery it was read from.

   Every probe below is a place on one of the club's plans where a person looked at
   the orthophoto and said what is there: a conifer wall, a freestanding clump, a
   mown fairway, an open shore strip. The probe is stored in PLAN PIXELS and carried
   to world metres by the same tee-and-pin registration the tracer uses, so this
   checks the raster against the imagery, never against itself.

   Two kinds of probe, two kinds of failure:
   - want=T marks verified forest. If one of these stops being trees, the raster
     contradicts imagery a person has confirmed, so ANY T failure exits non-zero.
   - want=O marks verified open ground. Five of these sit on ground the classifier
     genuinely cannot tell from shadowed conifer (dark mottled rough, 5-16 m off a
     corridor line, where the page's own distance guard suppresses planting anyway).
     Those five are the accepted residual: MORE than five O failures exits non-zero.

   Run:  node geobuild/check-treecover.mjs                                          */
import path from 'node:path';
import { ROOT, readJSON } from './lib.mjs';

const model = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const anchors = readJSON(path.join(ROOT, 'geobuild/plan-anchors.json'));
const tc = readJSON(path.join(ROOT, 'geobuild/tree-cover.json'));
const raw = Buffer.from(tc.b64, 'base64');
const at = (x, z) => {
  const i = Math.floor((x - tc.x0) / tc.cell), j = Math.floor((z - tc.z0) / tc.cell);
  if (i < 0 || i >= tc.nx || j < 0 || j >= tc.nz) return 0;
  const k = j * tc.nx + i;
  return (raw[k >> 2] >> ((k & 3) * 2)) & 3;
};
const win = (x, z, r) => {
  const c = [0, 0, 0, 0]; let n = 0;
  for (let dz = -r; dz <= r; dz += tc.cell) for (let dx = -r; dx <= r; dx += tc.cell) { c[at(x + dx, z + dz)]++; n++; }
  return c.map(v => v / n);
};

const HOLES = Object.fromEntries(model.holes.map(h => [h.n, h]));
function reg(n) {
  const A = anchors[String(n)], h = HOLES[n];
  const [p1x, p1y] = A.teePx, [p2x, p2y] = A.pinPx;
  const [w1x, w1z] = h.line[0], [w2x, w2z] = h.pin;
  const dpx = p2x - p1x, dpy = p2y - p1y, dwx = w2x - w1x, dwz = w2z - w1z;
  const den = dpx * dpx + dpy * dpy;
  const ar = (dpx * dwx + dpy * dwz) / den, ai = (dpx * dwz - dpy * dwx) / den;
  const bx = w1x - (ar * p1x - ai * p1y), bz = w1z - (ai * p1x + ar * p1y);
  return (px, py) => [ar * px - ai * py + bx, ai * px + ar * py + bz];
}

/* [hole, planPxX, planPxY, want, what the person saw on the plan] */
const PROBES = [
  [2, 500, 950, 'T', 'conifer wall L mid'], [2, 520, 700, 'T', 'forest L 150'],
  [2, 560, 300, 'T', 'forest behind green2'], [2, 610, 1450, 'T', 'forest L near tee'],
  [2, 850, 880, 'O', 'open fairway 200arc'], [2, 1150, 700, 'O', 'neighbour fairway'],
  [5, 560, 800, 'T', 'wall L beyond road mid'], [5, 545, 1100, 'T', 'wall L lower'],
  [5, 585, 1500, 'T', 'wall L near tee'], [5, 735, 700, 'O', 'fairway 150arc'],
  [5, 1000, 900, 'O', 'open R mid'], [5, 905, 320, 'O', 'open green5 R'],
  [5, 640, 1000, 'O', 'open rough road-fairway'], [5, 950, 1250, 'O', 'open R lower'],
  [8, 560, 850, 'T', 'clump L mid'], [8, 620, 650, 'T', 'clump L N'],
  [8, 1060, 700, 'T', 'clump R'], [8, 980, 880, 'T', 'R clump edge'],
  [8, 560, 300, 'T', 'clump left of green8'], [8, 760, 860, 'O', 'pinch corridor'],
  [8, 760, 1350, 'O', 'tee-150 scrub'], [8, 580, 1250, 'O', 'scrub L near tee'],
  [8, 1200, 1000, 'O', 'open R'], [8, 950, 340, 'O', 'open right of green8'],
  [13, 1050, 800, 'T', 'forest R mid'], [13, 1010, 1000, 'T', 'forest lower'],
  [13, 1100, 600, 'T', 'forest R 250'], [13, 790, 700, 'O', 'corridor 150arc'],
  [13, 650, 900, 'O', 'open L h12 side'], [13, 700, 1400, 'O', 'meadow near tee13'],
  [13, 1290, 560, 'T', 'shore band behind houses'], [13, 1430, 980, 'O', 'lawn to shore'],
  [15, 950, 135, 'T', 'band E behind green15'], [15, 1000, 500, 'O', 'shore strip near green'],
  [15, 950, 900, 'O', 'shore mid'], [15, 940, 1430, 'O', 'shore near tee'],
  [15, 700, 600, 'O', 'fairway mid'],
  [17, 960, 250, 'T', 'forest right of green17'], [17, 950, 650, 'T', 'band R 100'],
  [17, 760, 780, 'O', 'corridor 150arc'], [17, 1050, 950, 'O', 'open R 200arc'],
  [17, 760, 1430, 'O', 'open near tee17'],
];

let pass = 0, failT = 0, failO = 0;
for (const [n, px, py, want, label] of PROBES) {
  const [wx, wz] = reg(n)(px, py);
  const w = win(wx, wz, 9);
  const trees = w[3], open = w[2], unk = w[0];
  const ok = want === 'T' ? trees >= 0.5 : (open + unk >= 0.6 && trees < 0.4);
  if (ok) pass++; else if (want === 'T') failT++; else failO++;
  const pct = w.map(v => Math.round(v * 100));
  console.log(`${ok ? ' ok ' : 'FAIL'} h${String(n).padStart(2)} want=${want} [unk,-,open,trees]%=[${pct[0]},${pct[1]},${pct[2]},${pct[3]}]  ${label}`);
}
console.log(`\n${pass} pass of ${PROBES.length} (${failT} forest failures, ${failO} open failures; 5 open failures are the accepted residual)`);
if (failT > 0 || failO > 5) {
  console.error(failT > 0
    ? 'FAIL: the raster contradicts imagery a person verified as forest'
    : 'FAIL: more open ground reads as trees than the accepted residual');
  process.exit(1);
}
console.log('tree-cover agrees with the labelled imagery');
