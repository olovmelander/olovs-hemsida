/* Every traced ring of the Ängsö model against the 1 m laser terrain.

   The satellite traces (sat-shapes.json) were read off Esri z18 tiles, whose
   coordinates are their georeference -- but the tiles' own orthorectification
   is not perfect (Johannesberg's traces sat 2-4 m off their laser features).
   The laser terrain never entered a trace, so it is independent evidence, and
   the four OSM-surveyed holes are the calibration: a green is a plateau (mean
   inside minus a 4-10 m collar > 0, small std inside), a bunker a pit (rim 2-6 m
   minus inside > 0), a tee pad a flat, a pond a flat plate with banks. The
   shift (1 m steps, +/-8 m) that maximises each signal, medianed over the
   maxima that fall INSIDE the search window, is the horizontal offset between
   the traces and the laser -- measured separately for OSM and for satellite
   provenance, because only the second can carry an imagery offset.

   Writes angsobuild/terrain-check.json.   node angsobuild/terrain-check.mjs   */
import path from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';
import { loadTerrain } from './dtm.mjs';
import { inRing, ringD, bboxOf, areaOf } from '../geobuild/dtm-lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const m = readJSON(path.join(HERE, 'course-model.json'));
const T = loadTerrain();
const { hAt } = T;
console.log(`terrain: ${T.tiles} tiles, ${T.W}x${T.H} at 1 m`);

const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const r2 = v => Math.round(v * 100) / 100;
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function stats(ring, sx, sz, inner, outer) {
  const R = ring.map(([x, z]) => [x + sx, z + sz]);
  const b = bboxOf(R);
  const ins = [], col = [];
  for (let z = Math.floor(b.z0 - outer - 1); z <= Math.ceil(b.z1 + outer + 1); z++) for (let x = Math.floor(b.x0 - outer - 1); x <= Math.ceil(b.x1 + outer + 1); x++) {
    const h = hAt(x + 0.5, z + 0.5); if (!Number.isFinite(h)) continue;
    if (inRing(x + 0.5, z + 0.5, R)) ins.push(h); else { const d = ringD(x + 0.5, z + 0.5, R); if (d >= inner && d <= outer) col.push(h); }
  }
  const mi = mean(ins), mc = mean(col);
  return { n: ins.length, inside: mi, collar: mc, sd: Math.sqrt(mean(ins.map(v => (v - mi) ** 2))), delta: mi - mc };
}
function bestShift(ring, inner, outer, sign, key = 'delta', R = 8) {
  let best = { d: -Infinity, sx: 0, sz: 0 };
  for (let sx = -R; sx <= R; sx++) for (let sz = -R; sz <= R; sz++) { const v = sign * stats(ring, sx, sz, inner, outer)[key]; if (v > best.d) best = { d: v, sx, sz }; }
  best.interior = Math.abs(best.sx) < R && Math.abs(best.sz) < R;
  return best;
}
const medShift = shifts => { const s = shifts.filter(x => x.interior); return { n: s.length, of: shifts.length, x: med(s.map(x => x.sx)), z: med(s.map(x => x.sz)) }; };

const holes = [], gShifts = { osm: [], sat: [] }, bShifts = { osm: [], sat: [] }, gFlat = { osm: [], sat: [] };
for (const h of m.holes) {
  const g = stats(h.green.ring, 0, 0, 4, 10), gb = bestShift(h.green.ring, 4, 10, +1), gf = bestShift(h.green.ring, 4, 10, -1, 'sd');
  gShifts[h.green.prov].push(gb); gFlat[h.green.prov].push(gf);
  const tees = h.tees.pads.map((p, i) => { const s = stats(p.ring, 0, 0, 3, 8); return { i, raise: r2(s.delta), sd: r2(s.sd), n: s.n, c: p.c }; });
  const bunkers = h.bunkers.map((b, i) => { const s = stats(b.ring, 0, 0, 2, 6), bs = bestShift(b.ring, 2, 6, -1); bShifts[b.prov].push(bs); return { i, prov: b.prov, depth: r2(-s.delta), sd: r2(s.sd), n: s.n, area: Math.round(areaOf(b.ring)), bestShift: [bs.sx, bs.sz], depthAtBest: r2(bs.d), interior: bs.interior }; });
  const rec = { n: h.n, prov: h.green.prov, green: { raise: r2(g.delta), sd: r2(g.sd), n: g.n, area: h.green.area, bestShift: [gb.sx, gb.sz], raiseAtBest: r2(gb.d), flattestShift: [gf.sx, gf.sz], sdAtFlattest: r2(-gf.d) }, tees, bunkers };
  holes.push(rec);
  console.log(`hole ${String(h.n).padStart(2)} ${h.green.prov.padEnd(3)} green raise ${String(rec.green.raise).padStart(5)} sd ${rec.green.sd} best ${rec.green.bestShift} (${rec.green.raiseAtBest}) flattest ${rec.green.flattestShift} (${rec.green.sdAtFlattest}) | pads ${tees.map(t => `${t.raise}/${t.sd}`).join(' ')} | bunkers ${bunkers.map(b => `${b.prov}:${b.depth}m@${b.bestShift}${b.interior ? '' : '!'}`).join(' ') || '-'}`);
}
const water = [];
for (const w of m.water) {
  if (w.isLake) continue;
  const s = stats(w.ring, 0, 0, 3, 10), bs = bestShift(w.ring, 3, 10, -1);
  water.push({ id: w.id, prov: w.prov || 'osm/trace', area: Math.round(w.area), modelLevel: w.level, laserInside: r2(s.inside), laserSd: r2(s.sd), bankRise: r2(-s.delta), n: s.n, bestShift: [bs.sx, bs.sz], bankAtBest: r2(bs.d), interior: bs.interior });
  console.log(`water ${String(w.id).padEnd(14)} ${String(Math.round(w.area)).padStart(6)} m²  laser ${r2(s.inside)} sd ${r2(s.sd)} bank +${r2(-s.delta)}  best ${[bs.sx, bs.sz]} (${r2(bs.d)})${bs.interior ? '' : ' edge'}  model level ${w.level}`);
}
const summary = {
  greens: { osm: { raiseShift: medShift(gShifts.osm), flattestShift: medShift(gFlat.osm) }, sat: { raiseShift: medShift(gShifts.sat), flattestShift: medShift(gFlat.sat) },
    raised: holes.filter(h => h.green.raise > 0.1).length, raiseMedian: r2(med(holes.map(h => h.green.raise))), sdMedian: r2(med(holes.map(h => h.green.sd))) },
  bunkers: { osm: { pitShift: medShift(bShifts.osm), n: bShifts.osm.length, asPits: holes.flatMap(h => h.bunkers).filter(b => b.prov === 'osm' && b.depth > 0.15).length },
    sat: { pitShift: medShift(bShifts.sat), n: bShifts.sat.length, asPits: holes.flatMap(h => h.bunkers).filter(b => b.prov === 'sat' && b.depth > 0.15).length },
    depthMedian: r2(med(holes.flatMap(h => h.bunkers.map(b => b.depth)))) },
  teePads: { n: holes.flatMap(h => h.tees).length, sdMedian: r2(med(holes.flatMap(h => h.tees.map(t => t.sd)))), flat: holes.flatMap(h => h.tees).filter(t => t.sd < 0.10).length },
  water: { n: water.length, flat: water.filter(w => w.laserSd < 0.15).length, banked: water.filter(w => w.bankRise > 0.2).length, bankShift: medShift(water.map(w => ({ sx: w.bestShift[0], sz: w.bestShift[1], interior: w.interior }))), modelMinusLaserMedian: r2(med(water.map(w => w.modelLevel - w.laserInside))) },
};
console.log('\nsummary', JSON.stringify(summary, null, 1));
writeJSON(path.join(HERE, 'terrain-check.json'), { checkedOn: new Date().toISOString().slice(0, 10), holes, water, summary });
console.log('wrote angsobuild/terrain-check.json');
