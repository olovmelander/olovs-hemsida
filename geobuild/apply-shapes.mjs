/* Turn the shapes read off the hole plans into world geometry, and check them.

   The reading and the mathematics are deliberately separated: a person (or a model)
   reading a plan is good at seeing where a bunker is and useless at knowing where
   that is on Earth, and the registration is the reverse. plan-shapes.json holds the
   readings in pixels; the tee-and-pin similarity fixed by the reconciler carries
   them into metres.

   Two of the eight traced holes are surveyed in OpenStreetMap and were traced BLIND
   -- the reader was not shown the survey -- so comparing them measures the whole
   chain: reading error plus registration error. That number is printed and stored,
   and it is the error bar on the six holes nobody surveyed.

   Usage: node geobuild/apply-shapes.mjs                                             */
import path from 'node:path';
import {
  ROOT, readJSON, writeJSON, hyp, polyLen, polyArea, centroid, distToLine,
  pointInPoly, simplifyDP, ring1, r1,
} from './lib.mjs';

const model = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const anchors = readJSON(path.join(ROOT, 'geobuild/plan-anchors.json'));
const shapes = readJSON(path.join(ROOT, 'geobuild/plan-shapes.json'));
const HOLES = Object.fromEntries(model.holes.map(h => [h.n, h]));

/* the same two-anchor similarity the tracer uses; complex arithmetic keeps it honest */
function reg(n) {
  const A = anchors[String(n)], h = HOLES[n];
  const [p1x, p1y] = A.teePx, [p2x, p2y] = A.pinPx;
  const [w1x, w1z] = h.line[0], [w2x, w2z] = h.pin;
  const dpx = p2x - p1x, dpy = p2y - p1y;
  const dwx = w2x - w1x, dwz = w2z - w1z;
  const den = dpx * dpx + dpy * dpy;
  const ar = (dpx * dwx + dpy * dwz) / den;          // Re(a)
  const ai = (dpx * dwz - dpy * dwx) / den;          // Im(a)
  const bx = w1x - (ar * p1x - ai * p1y);
  const bz = w1z - (ai * p1x + ar * p1y);
  return {
    toWorld: (px, py) => [ar * px - ai * py + bx, ai * px + ar * py + bz],
    scale: Math.hypot(ar, ai),
  };
}

const toRing = (R, pts, tol = 1.2) =>
  ring1(simplifyDP(pts.map(([px, py]) => R.toWorld(px, py)), tol));

function bunkerRing(R, b) {
  const a = (b.ang || 0) * Math.PI / 180;
  const ring = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 16 * Math.PI * 2;
    const ex = Math.cos(t) * b.rx, ey = Math.sin(t) * b.ry;
    const px = b.c[0] + ex * Math.cos(a) + ey * Math.sin(a);
    const py = b.c[1] - ex * Math.sin(a) + ey * Math.cos(a);
    ring.push(R.toWorld(px, py));
  }
  return ring1(ring);
}

/* ---------------------------------------------------------------- validation */
console.log('blind validation on the surveyed holes:');
const val = [];
for (const n of [13, 17]) {
  const S = shapes[String(n)];
  if (!S?.green) { console.log(`  hole ${n}: not traced`); continue; }
  const R = reg(n);
  const ring = toRing(R, S.green);
  const c = centroid(ring);
  const h = HOLES[n];
  if (h.green.prov !== 'osm') continue;
  const co = centroid(h.green.ring);
  const d = hyp(c, co);
  const ratio = Math.abs(polyArea(ring)) / Math.abs(polyArea(h.green.ring));
  val.push({ hole: n, centreErr: r1(d), areaRatio: +ratio.toFixed(2) });
  console.log(`  hole ${n}: traced green centre ${d.toFixed(1)} m off the survey, area x${ratio.toFixed(2)}`);
}

/* ------------------------------------------------------------------- output */
const out = {};
for (const n of [1, 2, 3, 4, 5, 7]) {
  const S = shapes[String(n)];
  if (!S) continue;
  const R = reg(n);
  const h = HOLES[n];
  const rec = { scale: +R.scale.toFixed(3) };

  if (S.green?.length >= 6) {
    const ring = toRing(R, S.green);
    const c = centroid(ring);
    const area = Math.abs(polyArea(ring));
    const dPin = hyp(c, h.pin);
    if (dPin < 30 && area > 150 && area < 1500) {
      rec.green = { ring, area: Math.round(area), c: c.map(r1) };
    } else console.log(`  hole ${n}: green rejected (${dPin.toFixed(0)} m from pin, ${area.toFixed(0)} m²)`);
  }
  rec.fairways = [];
  for (const key of ['fairway', 'fairway2']) {
    if (!S[key] || S[key].length < 6) continue;
    const ring = toRing(R, S[key], 1.6);
    const c = centroid(ring);
    const area = Math.abs(polyArea(ring));
    if (area > 900 && distToLine(c[0], c[1], h.line) < 45)
      rec.fairways.push({ ring, area: Math.round(area), c: c.map(r1) });
  }
  rec.bunkers = (S.bunkers || [])
    .map(b => { const ring = bunkerRing(R, b); const c = centroid(ring);
                return { ring, c: c.map(r1), area: Math.round(Math.abs(polyArea(ring))) }; })
    .filter(b => b.area > 8 && b.area < 900
                 && distToLine(b.c[0], b.c[1], h.line) < 60
                 && !(rec.green && pointInPoly(b.c[0], b.c[1], rec.green.ring)));
  out[String(n)] = rec;
  console.log(`  hole ${n}: green ${rec.green ? 'ok' : '-'}  fairway pieces ${rec.fairways.length}  bunkers ${rec.bunkers.length}`);
}

writeJSON(path.join(ROOT, 'geobuild/traced-holes.json'), {
  note: 'shapes read off the club hole plans, carried to world metres by the tee-and-pin '
      + 'similarity; holes 13 and 17 were traced blind against their OSM survey as the error bar',
  method: 'plan-shapes.json (reader) + plan-anchors.json (registration)',
  validation: val,
  holes: out,
});
console.log('wrote geobuild/traced-holes.json');
