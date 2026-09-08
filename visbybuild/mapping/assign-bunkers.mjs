#!/usr/bin/env node
/* Which hole does each of Visby's 65 observed bunkers belong to?
 *
 * They were all traced from the 2022 municipal orthophoto into
 * scenery.bunkers -- shared-ground furniture with no hole ownership, because
 * ownership was never established. That costs something concrete: main.js
 * gives a hole's bunkers the dish-and-lip terrain walk (`walk(b.ring, 5, 3)`)
 * and a scenery bunker only its painted sand, so an unassigned bunker is a
 * flat sand patch on the 4 m grid with no shoulder.
 *
 * ATTRIBUTION IS NOT INVENTION, which is why this is allowed under a
 * mapped-only object policy: every ring here is already measured and already
 * in the model. Nothing moves; a bunker only gains the name of the hole it is
 * on. What the rule must not do is GUESS, so it refuses rather than reaches.
 *
 * The rule uses the model's own mown rings rather than centre lines, because a
 * bunker is placed against a green or a fairway and not against an abstract
 * axis. A bunker is assigned to a hole when it lies within 25 m of that hole's
 * green ring or one of its fairway rings, and the next-nearest hole is at
 * least 8 m further. It is refused when it is on the SEPARATE NINE that shares
 * this property, when nothing mown is within 25 m, or when two holes are too
 * close to separate.
 *
 * Visby is a 27-hole property and the model routes only the eighteen, so a
 * refusal is the expected outcome for the nine's bunkers -- and the model
 * records only two of the nine's corridors, so most of them cannot be
 * attributed to it positively either. They stay in scenery, listed with their
 * numbers.
 *
 *   node visbybuild/mapping/assign-bunkers.mjs           # measure and report
 *   node visbybuild/mapping/assign-bunkers.mjs --write   # apply to geometry.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { local } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEOMETRY = path.join(HERE, 'geometry.json');
const MODEL = path.join(HERE, '..', 'course-model.json');
const OUT = path.join(HERE, 'bunker-ownership-review.json');
const write = process.argv.includes('--write');

const geometry = JSON.parse(fs.readFileSync(GEOMETRY, 'utf8'));

const centroid = ring => {
  let x = 0, z = 0;
  for (const point of ring) { x += point[0]; z += point[1]; }
  return [x / ring.length, z / ring.length];
};
const ringArea = ring => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice / 2);
};
const toSegment = (point, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
};
const toRing = (point, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, toSegment(point, ring[i], ring[(i + 1) % ring.length]));
  return best;
};
const inside = (point, ring) => {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
};
/* signed: negative inside the ring, so a bunker cut into a fairway wins */
const signed = (point, ring) => toRing(point, ring) * (inside(point, ring) ? -1 : 1);

const NEAR_METRES = 25;
const MARGIN_METRES = 8;
const NINE_METRES = 25;

const nineCorridors = geometry.scenery?.fairways || [];
const rows = (geometry.scenery?.bunkers || []).map((ring, index) => {
  const c = centroid(ring);
  const onNine = nineCorridors.some(corridor => inside(c, corridor) || toRing(c, corridor) < NINE_METRES);
  const ranked = geometry.holes.map(hole => {
    const green = signed(c, hole.green.ring);
    const fairway = (hole.fairway?.rings || []).length
      ? Math.min(...hole.fairway.rings.map(r => signed(c, r))) : Infinity;
    return { hole: hole.n, toGreenRingMetres: +green.toFixed(1), toFairwayRingMetres: Number.isFinite(fairway) ? +fairway.toFixed(1) : null, best: Math.min(green, fairway) };
  }).sort((a, b) => a.best - b.best);
  const [first, second] = ranked;
  const marginMetres = +(second.best - first.best).toFixed(1);
  let hole = null, refusal = null;
  if (onNine) refusal = 'lies on the separate nine that shares this property';
  else if (first.best > NEAR_METRES) refusal = `nothing mown on the eighteen within ${NEAR_METRES} m (nearest ${first.best.toFixed(0)} m, hole ${first.hole})`;
  else if (marginMetres < MARGIN_METRES) refusal = `holes ${first.hole} and ${second.hole} are only ${marginMetres} m apart in reach`;
  else hole = first.hole;
  return {
    index, areaSquareMetres: +ringArea(ring).toFixed(0), centroidEpsg3006: c.map(v => +v.toFixed(2)),
    hole, refusal, onNine, marginMetres,
    nearest: { hole: first.hole, toGreenRingMetres: first.toGreenRingMetres, toFairwayRingMetres: first.toFairwayRingMetres },
    runnerUp: { hole: second.hole, toGreenRingMetres: second.toGreenRingMetres, toFairwayRingMetres: second.toFairwayRingMetres },
  };
});

const assigned = rows.filter(row => row.hole !== null);
const perHole = {};
for (const row of assigned) perHole[row.hole] = (perHole[row.hole] || 0) + 1;
const review = {
  reviewedFor: 'visby',
  source: 'visbybuild/mapping/geometry.json scenery.bunkers, all traced from the 2022 municipal orthophoto',
  rule: {
    statement: `assigned to the hole whose green ring or fairway ring is nearest, when that is within ${NEAR_METRES} m and at least ${MARGIN_METRES} m nearer than the next hole; refused when the bunker is on the separate nine, when nothing mown is in reach, or when two holes cannot be separated`,
    nearMetres: NEAR_METRES, marginMetres: MARGIN_METRES, nineMetres: NINE_METRES,
    why: 'the model\'s mown rings rather than its centre lines, because a bunker is placed against a green or a fairway and not against an abstract axis',
    doesNotMoveGeometry: true,
  },
  totals: {
    bunkers: rows.length, assigned: assigned.length,
    refusedOnTheNine: rows.filter(r => r.onNine).length,
    refusedNothingInReach: rows.filter(r => !r.onNine && r.hole === null && r.marginMetres >= MARGIN_METRES).length,
    refusedAmbiguous: rows.filter(r => !r.onNine && r.hole === null && r.marginMetres < MARGIN_METRES).length,
    perHole,
  },
  caveat: 'Visby is a 27-hole property and only the eighteen is routed here, so a refusal is the expected outcome for the nine\'s bunkers. The model records just two of the nine\'s corridors, so most refused bunkers cannot be attributed to it positively either; they stay in scenery with their numbers.',
  bunkers: rows,
};
fs.writeFileSync(OUT, `${JSON.stringify(review, null, 2)}\n`);

console.log(`${rows.length} observed bunkers -> ${assigned.length} assigned, ${rows.length - assigned.length} refused`);
console.log(`  ${review.totals.refusedOnTheNine} on the separate nine, ${review.totals.refusedNothingInReach} with nothing mown in reach, ${review.totals.refusedAmbiguous} ambiguous`);
console.log('  per hole:', Object.keys(perHole).sort((a, b) => a - b).map(k => `${k}:${perHole[k]}`).join(' '));
console.log(`  holes with none: ${geometry.holes.filter(h => !perHole[h.n]).map(h => h.n).join(', ') || '(none)'}`);
console.log(`wrote ${path.relative(path.join(HERE, '..', '..'), OUT)}`);

if (write) {
  const keep = [];
  for (const row of rows) {
    const ring = geometry.scenery.bunkers[row.index];
    if (row.hole === null) { keep.push(ring); continue; }
    const hole = geometry.holes.find(h => h.n === row.hole);
    hole.bunkers.push({ ring, sourceIds: ['visby-municipal-ortho-2022'] });
  }
  geometry.scenery.bunkers = keep;
  fs.writeFileSync(GEOMETRY, `${JSON.stringify(geometry, null, 2)}\n`);
  console.log(`wrote ${path.relative(path.join(HERE, '..', '..'), GEOMETRY)}: ${assigned.length} bunkers moved onto their holes, ${keep.length} left in scenery`);

  /* geometry.json is the reviewed source and build-course.mjs is what turns it
     into the model -- but that needs the pinned Float32 terrain and the stage
     caches, which a session container does not have. So the same partition is
     applied to the model directly, through the same local() mapping the build
     would use, and the two are asserted equal afterwards. Identical in shape
     to the hole-16 fairway re-sync. */
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const keepLocal = [];
  /* read the partition back off the file just written, so the model is built
     from what the source now says rather than from an in-memory copy */
  const sourceBunkers = JSON.parse(fs.readFileSync(GEOMETRY, 'utf8'));
  for (const hole of sourceBunkers.holes) {
    const target = model.holes.find(h => h.n === hole.n);
    target.bunkers = hole.bunkers.map(bunker => ({ ring: bunker.ring.map(local), sourceIds: bunker.sourceIds }));
  }
  for (const ring of sourceBunkers.scenery.bunkers) keepLocal.push(ring.map(local));
  model.scenery.bunkers = keepLocal;
  fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`);
  const onHoles = model.holes.reduce((sum, hole) => sum + hole.bunkers.length, 0);
  console.log(`wrote ${path.relative(path.join(HERE, '..', '..'), MODEL)}: ${onHoles} on holes + ${model.scenery.bunkers.length} in scenery = ${onHoles + model.scenery.bunkers.length}`);
  if (onHoles + model.scenery.bunkers.length !== rows.length) throw new Error('a bunker was lost or duplicated in the partition');
}
