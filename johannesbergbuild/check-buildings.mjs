/* Are the building footprints where the orthoimagery puts them?

   Esri z18 tiles are orthorectified, so a footprint drawn over them is a real check on
   the polygon rather than decoration -- that is how four of Veckefjärden's screenshot
   traces were found 8-13 m out. Here 305 of 307 footprints come from OpenStreetMap and
   two are satellite traces, and neither record has ever been measured against the other.

   A roof is the ground that is NOT vegetation: turf, canopy and scrub are all strongly
   green, a roof of tile, sheet or shingle is not. So the test is the shift, within
   +-10 m, that best separates "not green inside the ring" from "green just outside it".
   It is only meaningful where the ring actually sits on something roof-like, so a
   footprint whose best agreement stays poor is reported as unmeasurable rather than
   moved -- a building under canopy, or a ruin, is not an offset.

     node johannesbergbuild/check-buildings.mjs   -> johannesbergbuild/building-check.json */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON } from './lib.mjs';
process.env.BUILD = process.env.BUILD || 'johannesbergbuild';
const { ensureImagery, rgbAt, inRing, bboxOf, ringD, median, areaOf, meanPt } = await import('../geobuild/dtm-lib.mjs');

const m = readJSON(path.join(ROOT, 'johannesbergbuild/course-model.json'));
/* the buildings a visitor can see: everything within the played ground's own reach */
const near = (m.infra.buildings || []).filter(b => { const c = meanPt(b.ring); return Math.abs(c[0]) < 1200 && Math.abs(c[1]) < 1300; });
console.log(`${near.length} of ${(m.infra.buildings || []).length} footprints inside the imagery box`);
let bx = [1e9, 1e9, -1e9, -1e9];
for (const b of near) for (const p of b.ring) { bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.min(bx[1], p[1]); bx[2] = Math.max(bx[2], p[0]); bx[3] = Math.max(bx[3], p[1]); }
console.log('imagery:', await ensureImagery(bx[0] - 25, bx[1] - 25, bx[2] + 25, bx[3] + 25));

const exg = c => c ? 2 * c[1] - c[0] - c[2] : null;
/* the green threshold from this course's own ground rather than a literal: the median
   of everything just outside these footprints is vegetation by construction */
const around = [];
for (const b of near) { const bb = bboxOf(b.ring); for (let z = bb.z0 - 8; z <= bb.z1 + 8; z += 1) for (let x = bb.x0 - 8; x <= bb.x1 + 8; x += 1) { if (inRing(x, z, b.ring)) continue; const d = ringD(x, z, b.ring); if (d > 3 && d < 8) { const v = exg(rgbAt(x, z)); if (v !== null) around.push(v); } } }
const GREEN = +(median(around)).toFixed(1);
console.log(`vegetation threshold from the ground around these buildings: ExG ${GREEN}`);

/* The objective is the CONTRAST between the ring's interior and a tight collar, not
   "roof inside plus vegetation outside". The first version scored the second form and
   every footprint asked to move ten metres -- into open grass, which raises the
   vegetation term without touching the roof term -- and the best shifts piled up on
   the +-10 m search boundary. That is the same flat-objective tell the vertical datum
   sweep left at Johannesberg, and it means the objective, not the data, was wrong.
   Contrast cannot be gamed that way: sliding a ring off its roof lowers the interior
   and raises the collar at once. */
const score = (ring, dx, dz) => {
  const bb = bboxOf(ring); let inRoof = 0, inTot = 0, colRoof = 0, colTot = 0;
  for (let z = bb.z0 - 8; z <= bb.z1 + 8; z += 1) for (let x = bb.x0 - 8; x <= bb.x1 + 8; x += 1) {
    const v = exg(rgbAt(x, z)); if (v === null) continue;
    const isIn = inRing(x - dx, z - dz, ring), d = ringD(x - dx, z - dz, ring);
    if (isIn && d > 1) { inTot++; if (v < GREEN) inRoof++; }
    else if (!isIn && d >= 2 && d <= 5) { colTot++; if (v < GREEN) colRoof++; }
  }
  if (inTot < 8 || colTot < 8) return null;
  const roof = inRoof / inTot, collar = colRoof / colTot;
  return { f: roof - collar, roof, collar };
};

const rows = [];
for (const b of near) {
  const at0 = score(b.ring, 0, 0);
  if (!at0) continue;
  let best = { dx: 0, dz: 0, ...at0 };
  for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
    if (!dx && !dz) continue;
    const s = score(b.ring, dx, dz); if (s && s.f > best.f) best = { dx, dz, ...s };
  }
  rows.push({
    id: b.id || null, name: b.name || null, prov: b.prov || 'osm', areaM2: Math.round(areaOf(b.ring)),
    c: meanPt(b.ring).map(v => +v.toFixed(1)),
    roofFractionAtRing: +at0.roof.toFixed(2), collarRoofFractionAtRing: +at0.collar.toFixed(2), contrastAtRing: +at0.f.toFixed(3),
    bestShiftMetres: [best.dx, best.dz], contrastAtBest: +best.f.toFixed(3), gain: +(best.f - at0.f).toFixed(3),
    roofFractionAtBest: +best.roof.toFixed(2),
    atSearchEdge: Math.abs(best.dx) === 10 || Math.abs(best.dz) === 10,
    measurable: at0.f >= 0.25 || best.f >= 0.35,
  });
}
const meas = rows.filter(r => r.measurable);
/* a shift is only believable if it improves the contrast materially AND does not sit
   on the search boundary, where the objective has told you nothing */
const moved = meas.filter(r => Math.hypot(...r.bestShiftMetres) >= 3 && r.gain >= 0.15 && !r.atSearchEdge);
const edge = meas.filter(r => r.atSearchEdge && r.gain >= 0.15);
console.log(`\n${rows.length} footprints scored, ${meas.length} sit on something the imagery reads as a roof`);
console.log(`${meas.filter(r => Math.hypot(...r.bestShiftMetres) < 3).length} are already within 3 m of their best contrast`);
console.log(`${moved.length} want a real shift (>= 3 m, contrast up >= 0.15, not on the search edge):`);
for (const r of moved.sort((a, b) => b.gain - a.gain).slice(0, 20)) {
  console.log(`  ${(r.name || r.id || '?').padEnd(26)} ${String(r.areaM2).padStart(5)} m² ${r.prov.padEnd(5)} shift ${JSON.stringify(r.bestShiftMetres).padEnd(9)} = ${Math.hypot(...r.bestShiftMetres).toFixed(1)} m, contrast ${r.contrastAtRing} -> ${r.contrastAtBest}`);
}
if (edge.length) console.log(`${edge.length} more improve only by running to the +-10 m search edge, which is not a measurement`);
/* IS THE SHIFT A FOOTPRINT ERROR, OR THE ROOF LEANING? Orthoimagery is rectified to the
   TERRAIN, so anything standing above the ground leans radially away from the image's
   nadir point by its height times the tangent of the off-nadir angle. A scene of leaning
   roofs gives shifts that point away from ONE point and grow with distance from it; a
   scene of misplaced footprints gives shifts pointing anywhere. The test costs nothing
   and it decides whether any of this may be applied. */
const believable = meas.filter(r => Math.hypot(...r.bestShiftMetres) >= 2 && !r.atSearchEdge);
let lean = null;
if (believable.length >= 10) {
  const radial = (cx, cz) => {
    let a = 0; for (const r of believable) { const vx = r.c[0] - cx, vz = r.c[1] - cz, l = Math.hypot(vx, vz); if (l < 1) continue; const [sx, sz] = r.bestShiftMetres, sl = Math.hypot(sx, sz); a += (vx / l * sx + vz / l * sz) / sl; }
    return a / believable.length;
  };
  let best = null;
  for (let cz = -4000; cz <= 4000; cz += 100) for (let cx = -4000; cx <= 4000; cx += 100) { const v = radial(cx, cz); if (!best || v > best.v) best = { cx, cz, v }; }
  /* the same footprints with random directions: what "no pattern" scores */
  let ctrl = 0; for (const r of believable) { const a = Math.random() * 2 * Math.PI, vx = r.c[0] - best.cx, vz = r.c[1] - best.cz, l = Math.hypot(vx, vz); ctrl += (vx / l * Math.cos(a) + vz / l * Math.sin(a)); }
  const corr = (xs, ys) => { const n = xs.length, mx2 = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n; let sx = 0, sy = 0, sxy = 0; for (let i = 0; i < n; i++) { sx += (xs[i] - mx2) ** 2; sy += (ys[i] - my) ** 2; sxy += (xs[i] - mx2) * (ys[i] - my); } return +(sxy / Math.sqrt(sx * sy)).toFixed(3); };
  const dd = believable.map(r => Math.hypot(r.c[0] - best.cx, r.c[1] - best.cz));
  const mm = believable.map(r => Math.hypot(...r.bestShiftMetres));
  lean = {
    n: believable.length, nadirPoint: [best.cx, best.cz], meanCosToRadial: +best.v.toFixed(3),
    randomDirectionControl: +(ctrl / believable.length).toFixed(3),
    shiftVsDistanceR: corr(dd, mm), shiftVsAreaR: corr(believable.map(r => r.areaM2), mm),
  };
  console.log(`\nroof lean test: the shifts are most radial about (${best.cx}, ${best.cz}), mean cos ${lean.meanCosToRadial} against a random-direction control of ${lean.randomDirectionControl}`);
  console.log(`  magnitude vs distance from that point r = ${lean.shiftVsDistanceR}, vs footprint area r = ${lean.shiftVsAreaR}`);
  console.log(`  a substantial radial component means much of this is roofs leaning off nadir, not footprints in the wrong place, and NOTHING here is applied to the model.`);
}
if (meas.length) {
  const mx = median(meas.map(r => r.bestShiftMetres[0])), mz = median(meas.map(r => r.bestShiftMetres[1]));
  console.log(`median best shift over the ${meas.length} measurable footprints: ${mx} m east, ${mz} m in z`);
}
writeJSON(path.join(ROOT, 'johannesbergbuild/building-check.json'), {
  source: `Esri World Imagery z18 (orthorectified, ${process.env.SAT_REL ? 'release ' + process.env.SAT_REL : 'the live mosaic'}) against johannesbergbuild/course-model.json's footprints, by johannesbergbuild/check-buildings.mjs. A roof is ground that is not vegetation; the excess-green threshold ${GREEN} is the median of the ground in a 3-8 m band around these same footprints, so it is this course's own vegetation and not a literal. bestShiftMetres maximises the CONTRAST (roof fraction inside the ring) minus (roof fraction in a 2-5 m collar) over +-10 m; a shift that lands on the search boundary is flagged atSearchEdge and means the objective found nothing. Nothing here is applied to the model: roofLeanTest measures how radial the shifts are about a single point, which is what a roof standing above the terrain does in an ortho, and a substantial radial component means the shift cannot be attributed to the footprint without building heights the model does not carry. It is a MEASUREMENT, not applied: a footprint that does not sit on a roof at all is marked unmeasurable rather than moved.`,
  measuredOn: new Date().toISOString().slice(0, 10),
  vegetationExgThreshold: GREEN, searchRadiusMetres: 10, roofLeanTest: lean, buildings: rows,
});
console.log('-> johannesbergbuild/building-check.json');
