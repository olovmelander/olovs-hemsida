#!/usr/bin/env node
/* The nine greens read again in a SECOND, dated image.

   The live Esri layer over this course is one WorldView-2 capture of
   2023-04-28 (leaf-off; Esri's own metadata layer says so), and every played
   surface was traced from it. Esri Wayback keeps every release since 2014:
   hashing the course-centre z18 tile across all 196 of them finds exactly
   three distinct images here — the 2023-02-23 release carries a 2019-06-02
   WorldView-2 capture (leaf-on, June), and the 2024-02-08 and 2025-04-24
   releases both carry the 2023-04-28 image the live layer serves.

   Two things are asked of it, and only one of them answers.

   The GREENS: the same grower, unchanged, from the same GPS centres. It
   refuses all nine — every reading runs to 2,000–4,000 m² against traced
   outlines of 216–605. That is not a failure of registration but of season:
   in June the approach and the fairway are as green as the putting surface,
   so the collar the leaf-off April capture draws as a bright ring is simply
   not there. The measurement is therefore that this course's greens are
   traceable in LEAF-OFF imagery and not in leaf-on, and the numbers are kept
   so nobody tries it again expecting otherwise.

   The BUNKERS: sand is sand in both seasons, so the same classifier that
   placed them (detect-sand's rule) is run on the 2019 image at each measured
   bunker and its centroid compared. Two independently orthorectified
   captures, four years apart, agreeing on where a bunker is bounds the
   imagery's own accuracy — a number no single capture can produce, and which
   the laser dish check can then be read against.

     node ribbingsforsbuild/wayback-greens.mjs   -> wayback-greens.json (+ cache/review/greens-wayback.png) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMosaic } from './imagery.mjs';
import { loadTerrain } from './laser-lib.mjs';
import { readGreen } from './green-grower.mjs';
import { gridOver, fillRing } from './raster-shapes.mjs';
import { encodePNG } from '../geobuild/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const traces = JSON.parse(fs.readFileSync(path.join(HERE, 'surface-traces.json'), 'utf8'));
const WINDOW = { x0: -380, x1: 760, z0: -500, z1: 440 };
const RELEASE = 57965, CAPTURE = '2019-06-02', LIVE_CAPTURE = '2023-04-28';
const T = loadTerrain();
const live = await loadMosaic(WINDOW, { zoom: 18, name: 'course' });
const old = await loadMosaic(WINDOW, { zoom: 18, name: `wb${RELEASE}`, release: RELEASE });

function iou(a, b) {
  const xs = [...a, ...b].map(p => p[0]), zs = [...a, ...b].map(p => p[1]);
  const G = gridOver({ x0: Math.min(...xs) - 2, x1: Math.max(...xs) + 2, z0: Math.min(...zs) - 2, z1: Math.max(...zs) + 2 }, 0.5, 0);
  const A = new Uint8Array(G.width * G.height), B = new Uint8Array(G.width * G.height);
  fillRing(a, A, G, 1); fillRing(b, B, G, 1);
  let inter = 0, union = 0;
  for (let i = 0; i < A.length; i++) { if (A[i] && B[i]) inter++; if (A[i] || B[i]) union++; }
  return union ? inter / union : 0;
}
const cen = ring => { let sx = 0, sz = 0; for (const p of ring) { sx += p[0]; sz += p[1]; } return [sx / ring.length, sz / ring.length]; };

const results = [];
for (const h of model.holes) {
  const traced = traces.greens.find(g => g.hole === h.n);
  const { chosen, summary } = readGreen(old, T, h.green.c);
  const row = { hole: h.n, traced2023: traced?.accepted ? { area: traced.area, set: traced.set } : null, read2019: chosen ? { area: chosen.area, set: chosen.set, solidity: chosen.solidity, centroidShift: chosen.centroidShift, coreExg: chosen.coreExg, coreBright: chosen.coreBright } : null, readings2019: summary };
  if (traced?.accepted && chosen) {
    const c1 = cen(traced.ring), c2 = cen(chosen.ring);
    row.iou = +iou(traced.ring, chosen.ring).toFixed(3);
    row.centroidOffset = +Math.hypot(c2[0] - c1[0], c2[1] - c1[1]).toFixed(1);
    row.areaRatio = +(chosen.area / traced.area).toFixed(2);
    row.ring2019 = chosen.ring;
  }
  results.push(row);
  console.log(`green ${h.n}: 2023 ${traced?.accepted ? traced.area + ' m²' : 'refused'} | 2019 ${chosen ? `${chosen.area} m² set ${chosen.set}` : 'REFUSED'}${row.iou !== undefined ? ` | IoU ${row.iou} centroids ${row.centroidOffset} m apart, area x${row.areaRatio}` : ''}  [${summary}]`);
}
/* --- the bunkers: the sand rule of detect-sand.mjs, in both captures ------- */
const isSand = p => p && Math.min(...p) >= 132 && Math.max(...p) - Math.min(...p) <= 75 && p[0] - p[2] >= 30 && p[1] - p[0] <= -6;
function sandCentroid(IMG, c, reach = 14) {
  let sx = 0, sz = 0, n = 0;
  for (let dz = -reach; dz <= reach; dz += 0.5) for (let dx = -reach; dx <= reach; dx += 0.5) {
    if (Math.hypot(dx, dz) > reach || !isSand(IMG.rgbAt(c[0] + dx, c[1] + dz))) continue;
    sx += c[0] + dx; sz += c[1] + dz; n++;
  }
  return n >= 20 ? { c: [+(sx / n).toFixed(1), +(sz / n).toFixed(1)], cells: n, area: +(n * 0.25).toFixed(0) } : null;
}
const shapes = JSON.parse(fs.readFileSync(path.join(HERE, 'sat-shapes.json'), 'utf8'));
const bunkers = [];
for (const b of shapes.bunkers) {
  const a = sandCentroid(live, b.c), o = sandCentroid(old, b.c);
  const row = { hole: b.hole, c: b.c, sand2023: a, sand2019: o,
    offset: a && o ? +Math.hypot(o.c[0] - a.c[0], o.c[1] - a.c[1]).toFixed(1) : null,
    laserShift: b.laser ? b.laser.shift : null };
  bunkers.push(row);
  console.log('bunker hole ' + row.hole + ' (' + b.c + '): 2023 ' + (a ? a.area + ' m2 at ' + a.c : 'no sand') + ' | 2019 ' + (o ? o.area + ' m2 at ' + o.c : 'no sand') + (row.offset !== null ? ' | ' + row.offset + ' m apart' : ''));
}
const paired = bunkers.filter(b => b.offset !== null);
const med = arr => arr.length ? [...arr].sort((p, q) => p - q)[arr.length >> 1] : null;
const bunkerAgreement = { bothCaptures: paired.length, of: bunkers.length, medianOffset: med(paired.map(b => b.offset)), maxOffset: paired.length ? Math.max(...paired.map(b => b.offset)) : null,
  sandIn2019Only: bunkers.filter(b => !b.sand2023 && b.sand2019).length, sandIn2023Only: bunkers.filter(b => b.sand2023 && !b.sand2019).length };
console.log('bunker sand in both captures: ' + bunkerAgreement.bothCaptures + '/' + bunkers.length + ', centroids median ' + bunkerAgreement.medianOffset + ' m apart, worst ' + bunkerAgreement.maxOffset + ' m');

const scored = results.filter(r => r.iou !== undefined);
const summary = {
  greensRead2019: results.filter(r => r.read2019).length,
  medianIoU: scored.length ? +[...scored].sort((p, q) => p.iou - q.iou)[scored.length >> 1].iou.toFixed(3) : null,
  minIoU: scored.length ? Math.min(...scored.map(r => r.iou)) : null,
  medianCentroidOffset: scored.length ? [...scored].sort((p, q) => p.centroidOffset - q.centroidOffset)[scored.length >> 1].centroidOffset : null,
};
console.log(`2019 vs 2023: ${summary.greensRead2019}/9 greens read, IoU median ${summary.medianIoU} min ${summary.minIoU}, centroids median ${summary.medianCentroidOffset} m apart`);

fs.writeFileSync(path.join(HERE, 'wayback-greens.json'), JSON.stringify({
  schemaVersion: 1,
  source: `Esri World Imagery Wayback release ${RELEASE} (2023-02-23), which over this course carries a ${CAPTURE} WorldView-2 0.5 m capture (Esri metadata layer 5 at 14.1172 E 58.9613 N); the live layer is ${LIVE_CAPTURE} (same metadata). Found by hashing z18 tile 141351/77616 across all 196 Wayback releases: three distinct images, the other two both the ${LIVE_CAPTURE} capture. Migration-only; no imagery is stored. wayback-greens.mjs`,
  method: 'the green grower of green-grower.mjs (the rule trace-surfaces.mjs used on the 2023 image) run unchanged on the 2019 image from the same GPS green centres, scored against the 2023 trace by intersection over union on a 0.5 m raster; and detect-sand.mjs own sand rule run on BOTH captures at each measured bunker',
  greens: { finding: 'the grower refuses all nine on the leaf-on capture: every reading runs to 2,000-4,000 m2 against traced outlines of 216-605 m2, because in June the approach and fairway are as green as the putting surface and the bright collar the April capture shows is absent. The greens of this course are traceable in leaf-off imagery only; recorded so the attempt is not repeated.', summary, results },
  bunkers: { method: 'the sand rule (min >= 132, range <= 75, R-B >= 30, G-R <= -6) integrated over a 14 m disc at each measured bunker in each capture; the centroids distance is the two captures disagreement about where the sand is', agreement: bunkerAgreement, rows: bunkers },
}, null, 1) + '\n');

/* review sheet: 2023 | 2019, both rings */
const S = 60, scale = 4, px = S * scale, cols = 3, rows = 3, W = cols * (2 * px + 4) + 4, H = rows * (px + 4) + 4;
const rgb = new Uint8Array(W * H * 3).fill(30);
const put = (X, Y, r, g, b) => { if (X < 0 || Y < 0 || X >= W || Y >= H) return; const o = (Y * W + X) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b; };
model.holes.forEach((h, k) => {
  const col = k % cols, row = Math.floor(k / cols), X0 = 4 + col * (2 * px + 4), Y0 = 4 + row * (px + 4), [cx, cz] = h.green.c;
  for (let r = 0; r < px; r++) for (let c = 0; c < px; c++) { const x = cx - S / 2 + c / scale, z = cz - S / 2 + r / scale; put(X0 + c, Y0 + r, ...(live.rgbAt(x, z) || [0, 0, 0])); put(X0 + px + c, Y0 + r, ...(old.rgbAt(x, z) || [0, 0, 0])); }
  const line = (L, colr) => { for (let i = 0; i < L.length; i++) { const P = L[i], Q = L[(i + 1) % L.length]; const n = Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1]) * scale); for (let s = 0; s <= n; s++) { const x = P[0] + (Q[0] - P[0]) * s / n, z = P[1] + (Q[1] - P[1]) * s / n; const c = Math.round((x - cx + S / 2) * scale), r = Math.round((z - cz + S / 2) * scale); if (c < 0 || r < 0 || c >= px || r >= px) continue; put(X0 + c, Y0 + r, ...colr); put(X0 + px + c, Y0 + r, ...colr); } } };
  const res = results.find(r => r.hole === h.n);
  line(h.green.ring, [255, 255, 0]);
  if (res.ring2019) line(res.ring2019, [0, 255, 255]);
});
fs.mkdirSync(path.join(HERE, 'cache', 'review'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'cache', 'review', 'greens-wayback.png'), encodePNG(W, H, rgb));
console.log('wrote wayback-greens.json and cache/review/greens-wayback.png (yellow = 2023 trace, cyan = 2019 reading)');
