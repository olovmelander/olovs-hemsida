/* Every water body on this course, measured against the laser plate.

   A 1 m bare-earth DTM does not penetrate water: a lake is delivered as a FLAT PLATE
   at its surface. That makes the laser three independent things at once -- a level, a
   registration check on the ring that claims to be its shoreline, and, where the two
   disagree, the shoreline itself.

   The model's eleven OSM rings carry levels sampled from AWS Terrarium, whose datum is
   this course's measured 5.6676 m off RH 2000 and whose SHAPE over this parkland is
   poor (the datum measurement's MAD is 1.72 m). So a level here is not a correction of
   a rounding error, it is a different measurement.

   What it reports per ring: the plate's level in RH 2000 and in the legacy frame, how
   flat the interior actually is, how much of the interior really is plate, and the
   offset that best aligns the ring to the plate's own edge. It writes no geometry it
   has not measured: a ring whose interior is not a plate keeps its outline and says so.

     node johannesbergbuild/laser-water.mjs   -> johannesbergbuild/laser-water.json     */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON } from './lib.mjs';
process.env.BUILD = process.env.BUILD || 'johannesbergbuild';
const { loadTerrain, datumOf, inRing, bboxOf, ringD, median, quant, areaOf } = await import('../geobuild/dtm-lib.mjs');

const SLUG = 'johannesberg';
const DATUM = datumOf(SLUG);
const m = readJSON(path.join(ROOT, 'johannesbergbuild/course-model.json'));
const T = loadTerrain(SLUG);
const { hAt } = T;
console.log(`terrain: ${T.tiles} tiles, ${T.W}x${T.H} at 1 m; legacy minus RH 2000 = ${DATUM} m`);

const FLAT = 0.08;       /* a plate cell: this close to its neighbours over 3 m */
const BAND = 0.25;       /* a cell within this of the plate level counts as plate */
const STEP = 1;

/* is this cell laser-flat? the max spread of the 3 m neighbourhood */
const spread = (x, z) => {
  const h = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) h.push(hAt(x + dx, z + dz));
  if (h.some(v => !Number.isFinite(v))) return NaN;
  return Math.max(...h) - Math.min(...h);
};

const out = [];
for (const w of m.water) {
  const b = bboxOf(w.ring);
  const inside = [], flatH = [];
  let cells = 0, outside = 0;
  for (let z = Math.floor(b.z0); z <= Math.ceil(b.z1); z += STEP) for (let x = Math.floor(b.x0); x <= Math.ceil(b.x1); x += STEP) {
    if (!inRing(x, z, w.ring)) continue;
    cells++;
    const h = hAt(x, z);
    if (!Number.isFinite(h)) { outside++; continue; }
    inside.push(h);
    if (spread(x, z) <= FLAT) flatH.push(h);
  }
  const rec = { id: w.id, name: w.name || null, osmAreaM2: Math.round(w.area || areaOf(w.ring)), modelLevelLegacy: w.level, interiorCells: cells, cellsOutsideWindow: outside };
  if (outside === cells) { rec.note = 'the whole ring lies outside the 1 m terrain window: not measured'; out.push(rec); continue; }
  if (flatH.length < 20) {
    rec.plateCells = flatH.length;
    rec.note = `only ${flatH.length} of ${cells - outside} interior cells are laser-flat: no plate, so no level and no outline is taken from the laser here`;
    rec.interiorMedianRH2000 = +median(inside).toFixed(3);
    out.push(rec); continue;
  }
  /* the plate's level is the median of its flat cells; the plate is everything within
     BAND of it, which is what separates a lake from a flat field beside it */
  const lvl = median(flatH);
  let plate = 0;
  for (const h of inside) if (Math.abs(h - lvl) <= BAND) plate++;
  rec.levelRH2000 = +lvl.toFixed(3);
  rec.levelLegacy = +(lvl + DATUM).toFixed(3);
  rec.modelMinusLaser = +(w.level - (lvl + DATUM)).toFixed(3);
  rec.plateCells = plate;
  rec.plateFraction = +(plate / (cells - outside)).toFixed(3);
  rec.interiorSpreadP90 = +(quant(inside.map(h => Math.abs(h - lvl)), 0.9)).toFixed(3);
  /* registration: the shift that puts the most plate inside the ring and the least out */
  let best = [0, 0], bestScore = -1e9;
  for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
    let inP = 0, inTot = 0, edge = 0;
    for (let z = Math.floor(b.z0) - 8; z <= Math.ceil(b.z1) + 8; z += 2) for (let x = Math.floor(b.x0) - 8; x <= Math.ceil(b.x1) + 8; x += 2) {
      const isIn = inRing(x - dx, z - dz, w.ring), d = ringD(x - dx, z - dz, w.ring);
      const h = hAt(x, z); if (!Number.isFinite(h)) continue;
      const isPlate = Math.abs(h - lvl) <= BAND;
      if (isIn) { inTot++; if (isPlate) inP++; }
      else if (d < 6 && isPlate) edge++;         /* plate outside the ring: the ring is too tight */
    }
    const score = (inTot ? inP / inTot : 0) - 0.5 * (inTot ? edge / inTot : 0);
    if (score > bestScore) { bestScore = score; best = [dx, dz]; }
  }
  rec.bestShiftMetres = best;
  rec.note = `laser plate at ${rec.levelRH2000} m RH 2000 (${rec.levelLegacy} legacy; the model carries ${w.level} from Terrarium, ${rec.modelMinusLaser > 0 ? '+' : ''}${rec.modelMinusLaser} m), ${plate} of ${cells - outside} interior cells within ${BAND} m of it`;
  out.push(rec);
}

for (const r of out) {
  console.log(`${(r.id || '').padEnd(20)} ${(r.name || '-').padEnd(9)} ${String(r.osmAreaM2).padStart(7)} m²  ${r.levelRH2000 !== undefined ? `plate ${String(r.levelRH2000).padStart(7)} RH2000 -> ${String(r.levelLegacy).padStart(7)} legacy, model ${String(r.modelLevelLegacy).padStart(6)} (${r.modelMinusLaser > 0 ? '+' : ''}${r.modelMinusLaser}), ${(100 * r.plateFraction).toFixed(0)}% plate, shift ${JSON.stringify(r.bestShiftMetres)}` : r.note}`);
}
const measured = out.filter(r => r.levelRH2000 !== undefined);
if (measured.length) {
  const d = measured.map(r => r.modelMinusLaser);
  console.log(`\n${measured.length} of ${out.length} rings are a laser plate; the model's Terrarium levels run ${median(d) > 0 ? '+' : ''}${median(d).toFixed(2)} m off the laser at the median, ${Math.min(...d).toFixed(2)} to ${Math.max(...d).toFixed(2)}`);
}

writeJSON(path.join(ROOT, 'johannesbergbuild/laser-water.json'), {
  source: `Lantmäteriet Markhöjdmodell 1 m (RH 2000), the ${T.tiles} published level-0 tiles of the johannesberg v2 ground sampled through the derived legacy bridge (geobuild/dtm-lib.mjs); the rings from johannesbergbuild/course-model.json. A laser DTM does not penetrate water, so a water body is delivered as a flat plate at its surface: the level is the median of the interior cells whose 3 m neighbourhood spreads no more than ${FLAT} m, and the plate is every interior cell within ${BAND} m of that level. bestShiftMetres is the [east, z] offset that puts the most plate inside the ring and the least just outside it -- a registration check on the ring, not a correction applied to it.`,
  measuredOn: new Date().toISOString().slice(0, 10),
  datumLegacyMinusRH2000: DATUM, flatnessMetres: FLAT, plateBandMetres: BAND,
  water: out,
});
console.log('-> johannesbergbuild/laser-water.json');
