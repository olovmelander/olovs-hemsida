#!/usr/bin/env node
/* Every traced ring against the 1 m laser terrain: a bunker is a dish, a green
   a plateau, a tee deck flat. Johannesberg's method, on this ground's own
   raster: each bunker's interior is compared with a 2-5 m collar outside it,
   the shift within +-5 m that deepens the dish most is its registration
   against the laser, and the median over the confirmed bunkers is the offset
   of the whole orthophoto trace set. Lantmäteriet's orthophoto is rectified on
   the same national height model, so the expectation is a metre or less; what
   is measured is written to mapping/terrain-check-2026.json and nothing is
   moved by it.

     node tortunabuild/terrain-check.mjs                                        */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from './lib/rasters.mjs';
import { pointInRing, ringBounds, ringCentroid, ringArea, distToPolyline } from './lib/imagery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const { heightAt } = loadTerrain();
const q = (a, p) => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const median = a => q(a, 0.5);

/* interior samples and a collar band (2-5 m outside the ring), on a 0.5 m lattice */
function bands(ring, step = 0.5) {
  const [x0, z0, x1, z1] = ringBounds(ring);
  const inside = [], collar = [];
  const closed = [...ring, ring[0]];
  for (let z = z0 - 6; z <= z1 + 6; z += step) for (let x = x0 - 6; x <= x1 + 6; x += step) {
    if (pointInRing(x, z, ring)) inside.push([x, z]);
    else { const d = distToPolyline([x, z], closed).d; if (d >= 2 && d <= 5) collar.push([x, z]); }
  }
  return { inside, collar };
}
const dishDepth = (ring, dx, dz) => {
  const { inside, collar } = bands(ring);
  const hi = median(inside.map(([x, z]) => heightAt(x + dx, z + dz))), hc = median(collar.map(([x, z]) => heightAt(x + dx, z + dz)));
  return hc - hi;   /* positive: the interior is lower than its collar */
};
const bunkers = [];
for (const h of model.holes) for (const b of h.bunkers) {
  const ring = b.ring.slice(0, -1);
  const depth0 = dishDepth(ring, 0, 0);
  let best = { dx: 0, dz: 0, depth: depth0 };
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) { const depth = dishDepth(ring, dx, dz); if (depth > best.depth + 1e-6) best = { dx, dz, depth }; }
  bunkers.push({ hole: h.n, id: b.sourceFeatureId, areaM2: Math.round(ringArea(ring)), depthAtTrace: +depth0.toFixed(2), bestShift: [best.dx, best.dz], depthAtBest: +best.depth.toFixed(2), dish: depth0 >= 0.10 });
}
const confirmed = bunkers.filter(b => b.dish);
const shiftX = median(confirmed.map(b => b.bestShift[0])), shiftZ = median(confirmed.map(b => b.bestShift[1]));
console.log(`bunkers: ${bunkers.length}, with a dish of 0.10 m or more at the traced position: ${confirmed.length}; depth median ${median(bunkers.map(b => b.depthAtTrace)).toFixed(2)} m`);
console.log(`registration (median best shift of the confirmed dishes): (${shiftX}, ${shiftZ}) m; |shift| median ${median(confirmed.map(b => Math.hypot(...b.bestShift))).toFixed(1)} m`);
for (const b of bunkers.filter(b => !b.dish)) console.log(`  no dish: hole ${b.hole} ${b.id} depth ${b.depthAtTrace} m (best ${b.depthAtBest} at ${b.bestShift})`);

/* greens: interior height spread against a 4 m collar, and the plateau's own best shift */
const greens = [];
for (const h of model.holes) {
  const ring = h.green.ring.slice(0, -1);
  const { inside, collar } = bands(ring);
  const hi = inside.map(([x, z]) => heightAt(x, z)), hc = collar.map(([x, z]) => heightAt(x, z));
  greens.push({ hole: h.n, areaM2: Math.round(ringArea(ring)), interiorSpreadP90P10: +(q(hi, 0.9) - q(hi, 0.1)).toFixed(2), interiorMinusCollar: +(median(hi) - median(hc)).toFixed(2), collarSpread: +(q(hc, 0.9) - q(hc, 0.1)).toFixed(2) });
}
console.log(`greens: interior p90-p10 median ${median(greens.map(g => g.interiorSpreadP90P10)).toFixed(2)} m, collar ${median(greens.map(g => g.collarSpread)).toFixed(2)} m; interior above collar median ${median(greens.map(g => g.interiorMinusCollar)).toFixed(2)} m`);

/* tee pads: the deck's flatness on the laser, and which are not flat */
const pads = [];
for (const h of model.holes) for (const p of h.tees.pads) {
  const ring = p.ring.slice(0, -1);
  const { inside } = bands(ring);
  const hi = inside.map(([x, z]) => heightAt(x, z));
  pads.push({ hole: h.n, id: p.id, kind: /derived/.test(p.id) ? 'card-derived' : /laser/.test(p.id) ? 'laser-deck' : 'observed', spread: +(q(hi, 0.95) - q(hi, 0.05)).toFixed(2) });
}
for (const kind of ['observed', 'laser-deck', 'card-derived']) { const s = pads.filter(p => p.kind === kind); console.log(`tee pads ${kind}: ${s.length}, p95-p5 height spread median ${median(s.map(p => p.spread)).toFixed(2)} m, worst ${Math.max(...s.map(p => p.spread)).toFixed(2)} m`); }

fs.writeFileSync(path.join(HERE, 'mapping', 'terrain-check-2026.json'), JSON.stringify({ schemaVersion: 1, groundId: 'tortuna', checkedOn: new Date().toISOString().slice(0, 10), terrain: 'tortunabuild/cache/terrain/terrain-1m.f32 (Lantmäteriet Markhöjdmodell 1 m, RH 2000)',
  method: 'bunker interior median minus 2-5 m collar median (dish depth), best +-5 m shift; green interior spread and height over collar; tee pad height spread',
  registration: { medianBestShiftMetres: [shiftX, shiftZ], confirmedBunkers: confirmed.length, applied: false, note: 'recorded, not applied; a whole-trace shift is a survey decision' },
  bunkers, greens, teePads: pads }, null, 2) + '\n');
console.log('wrote mapping/terrain-check-2026.json');
