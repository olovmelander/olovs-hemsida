/* Tjusta's one routing: the committed model against the committed reviewed layers.
   The 1 m terrain is a private cache, so nothing here recompiles; `compile-grid-course.mjs` does. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pointInPoly, polyArea, polyLen } from '../geobuild/lib.mjs';
import { verifyScorecard } from '../packages/course-geo/intake/verify-scorecard.mjs';

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const TEES = ['gul', 'rod'];
const model = read('./course-model.json');
const card = read('./reference/club-scorecard.json');
const packCard = read('./card.json');
const surfaces = read('./mapping/playing-surfaces.geojson');
const report = read('./mapping/trace-report.json');
const notes = read('./guide-notes.json');
const plates = read('./mapping/guide-plates.json');
const routes = read('./mapping/routes.geojson');
const inWater = p => model.water.some(w => pointInPoly(p[0], p[1], w.ring));
const centre = ring => ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);

test('the card is the guide publishers\' par-72 card, cell by cell, in the model and in the pack card', () => {
  assert.equal(verifyScorecard(card, { requireRated: true }).valid, true);
  assert.equal(model.holes.length, 18);
  model.holes.forEach((hole, i) => {
    const row = card.holes[i];
    assert.deepEqual([hole.n, hole.par, hole.idx], [row.number, row.par, row.index]);
    assert.deepEqual(hole.t, TEES.map(id => row.lengths[id]));
    assert.deepEqual(packCard.holes[i].t, hole.t);
  });
  assert.equal(model.holes.reduce((s, h) => s + h.par, 0), 72);
  assert.deepEqual(card.tees.map(t => t.total), [5878, 4959]);
});

test('every colour stands on a named platform, at the card\'s own distance, and the route starts there', () => {
  const rows = new Map(report.rows.filter(r => r.kind === 'route').map(r => [r.hole, r]));
  for (const hole of model.holes) {
    assert.equal(hole.tees.markerLayout, 'separate-reviewed-colours', `hole ${hole.n}`);
    for (const [i, mark] of hole.tees.marks.entries()) {
      const pad = hole.tees.pads.find(p => p.id === mark.sourcePadId);
      assert.ok(pad && pointInPoly(mark.c[0], mark.c[1], pad.ring), `hole ${hole.n} ${TEES[i]} stands inside its platform`);
      // Measured, never warped: the worst is 18 Röd, whose deck stands 12.7 m short of the card (the walkthrough says why).
      assert.ok(Math.abs(rows.get(hole.n).cardResidual[TEES[i]]) < 14, `hole ${hole.n} ${TEES[i]}: ${rows.get(hole.n).cardResidual[TEES[i]]} m off the card`);
    }
    assert.ok(Math.hypot(hole.line[0][0] - hole.tees.marks[0].c[0], hole.line[0][1] - hole.tees.marks[0].c[1]) < 0.05, `hole ${hole.n} starts on the back mark`);
    const end = hole.line.at(-1);
    assert.ok(pointInPoly(end[0], end[1], hole.green.ring), `hole ${hole.n} ends on its green`);
    assert.ok(Math.abs(polyLen(hole.line) - hole.lineLen) < 0.2);
  }
  const all = report.rows.filter(r => r.kind === 'route').flatMap(r => Object.values(r.cardResidual).map(Math.abs)).sort((a, b) => a - b);
  assert.ok(all[all.length >> 1] < 1, `median card residual ${all[all.length >> 1]} m`);
});

test('greens, tees and bunkers are dry, sane in size and clear of each other', () => {
  for (const hole of model.holes) {
    const area = Math.abs(polyArea(hole.green.ring));
    // The 3rd and 13th greens are small: 15 m by 16 and 19 m by 15 on the 2023 and 2021 photos (213 and 227 m2). The first
    // trace drew every green out to its collar's outer edge, and none came under 288.
    assert.ok(area > 180 && area < 900, `hole ${hole.n} green ${area.toFixed(0)} m2`);
    for (const p of hole.green.ring) assert.equal(inWater(p), false, `hole ${hole.n} green reaches water`);
    assert.ok(pointInPoly(hole.pin[0], hole.pin[1], hole.green.ring));
    for (const pad of hole.tees.pads) {
      const a = Math.abs(polyArea(pad.ring));
      // 4 Röd and 12 Gul are small decks (about 4 x 4.5 m), which deck-ground.mjs measures as too small to call level.
      assert.ok(a > 15 && a < 620, `${pad.id} ${a.toFixed(0)} m2`);
      assert.equal(inWater(centre(pad.ring)), false, `${pad.id} stands in water`);
    }
    for (const b of hole.bunkers) {
      assert.equal(inWater(centre(b.ring)), false, `${b.sourceFeatureId} lies in water`);
      const bitten = b.ring.filter(p => pointInPoly(p[0], p[1], hole.green.ring)).length;
      assert.ok(bitten <= 0.12 * b.ring.length, `${b.sourceFeatureId} bites the green`);
    }
  }
});

test('the outlines were measured on the photo', () => {
  const greens = report.rows.filter(r => r.kind === 'green');
  assert.equal(greens.length, 18);
  for (const g of greens) {
    assert.equal(g.kept, undefined, `hole ${g.hole} green fell back to its start`);
    // The 10th green's front has no rim on any photo year (the mown tongue runs on as the approach) and its east side
    // lies under the wood's shadow on all four: drawn by hand (decisions.json says from what), d' 1.87, and a stated
    // fault of the ground. The 6th and 8th, ovals on striped surfaces, measure 2.35 and 2.83; the rest are over 3.
    assert.ok(g.dPrime > (g.hole === 10 ? 1.5 : 2.1), `hole ${g.hole} green d' ${g.dPrime}`);
  }
  assert.ok(report.classifierAccuracy.green > 0.98 && report.classifierAccuracy.fairway > 0.92);
  for (const f of surfaces.features) for (const ring of f.geometry.coordinates) {
    assert.deepEqual(ring[0], ring.at(-1), `${f.id} ring is closed`);
    const vertices = ring.slice(0, -1).map(p => p.join());
    assert.equal(new Set(vertices).size, vertices.length, `${f.id} touches itself`);
    for (const [e, n] of ring) assert.ok(e > 668500 && e < 669760 && n > 6610400 && n < 6612100, `${f.id} leaves the course`);
  }
});

test('every hole runs from the tee to the green the guide plate shows', () => {
  // golfisverige.com's plates, registered on the 2025 photo (register-guide-plates.py). The plates of the two short
  // par 3s (3 and 12) find no fit and are read by eye; every other plate's flag lies on its hole's green.
  const byHole = new Map(plates.plates.map(p => [p.hole, p]));
  for (const hole of model.holes) {
    const plate = byHole.get(hole.n);
    if (!plate.accepted) { assert.ok([3, 12].includes(hole.n), `hole ${hole.n}: its plate found no fit`); continue; }
    const green = surfaces.features.find(f => f.properties.kind === 'green' && f.properties.hole === hole.n).geometry.coordinates[0];
    const route = routes.features.find(f => f.properties.hole === hole.n).geometry.coordinates;
    const d = Math.min(...green.map(p => Math.hypot(p[0] - plate.flag[0], p[1] - plate.flag[1])));
    assert.ok(pointInPoly(plate.flag[0], plate.flag[1], green) || d < 6, `hole ${hole.n}: the plate's flag is ${d.toFixed(1)} m off its green`);
    assert.ok(Math.hypot(route[0][0] - plate.tee[0], route[0][1] - plate.tee[1]) < 14, `hole ${hole.n}: the yellow tee is far from the plate's`);
  }
});

test('every hole has its own fairway, along its own line', () => {
  // The first trace learned "fairway" from six OSM outlines of 2012 and drew fragments (1,873 m2 on the 505 m 7th);
  // the next shared the mown ground out by connected piece and gave the 1st ten hectares and four holes none.
  const area = ring => Math.abs(polyArea(ring));
  for (const hole of model.holes) {
    const own = surfaces.features.filter(f => f.properties.kind === 'fairway' && f.properties.hole === hole.n);
    const total = own.reduce((sum, f) => sum + area(f.geometry.coordinates[0]), 0);
    assert.ok(own.length >= 1 && own.length <= 4, `hole ${hole.n}: ${own.length} fairway pieces`);
    if (hole.par >= 4) assert.ok(total > 5000 && total < 26000, `hole ${hole.n} (par ${hole.par}): ${total.toFixed(0)} m2 of fairway`);
    const line = routes.features.find(f => f.properties.hole === hole.n).geometry.coordinates;
    for (const f of own) for (const [e, n] of f.geometry.coordinates[0]) {
      const d = Math.min(...line.slice(1).map((b, i) => {
        const a = line[i], dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(e - a[0] - u * dx, n - a[1] - u * dy);
      }));
      assert.ok(d < 62, `${f.id} reaches ${d.toFixed(0)} m from its hole's line`);
    }
  }
});

test('every hole carries its own note and tagline', () => {
  model.holes.forEach((hole, i) => {
    assert.equal(hole.note, notes.holes[i].note);
    assert.equal(hole.name, notes.holes[i].name);
  });
  assert.equal(new Set(model.holes.map(h => h.note)).size, 18);
  assert.equal(new Set(model.holes.map(h => h.name)).size, 18);
});

test('the living ground is on: only the bridges keep to the mapped inventory', () => {
  assert.equal(model.infra.bridgePlacement, 'mapped-only');
  for (const key of ['objectPlacement', 'vegetationPlacement', 'terrainPlacement']) assert.equal(key in model.infra, false, key);
  assert.equal(model.evidence.terrainModifiedForPlayingSurfaces, false);
});

test('the practice ground is the range, its tee line, two practice greens, the chipping apron and the short-game area', () => {
  assert.equal(model.scenery.range.length, 1);
  // the putting green, the chipping green and the short-game area's three target circles
  assert.equal(model.scenery.practiceGreens.length, 5);
  assert.deepEqual(model.scenery.mappedFeatures.map(f => f.kind).sort(), Array(5).fill('practice_green'));
  // the mats: one bay every 3 m along the 43 m tee line (2025 photo)
  const bays = model.scenery.rangeFacilities.bays;
  assert.ok(bays.length >= 14 && bays.length <= 16, `${bays.length} bays`);
  for (let i = 1; i < bays.length; i++) assert.ok(Math.abs(Math.hypot(bays[i][0] - bays[i - 1][0], bays[i][1] - bays[i - 1][1]) - 3) < 0.35);
  assert.equal(model.water.length, 29);
});
