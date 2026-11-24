/* Bro Hof's two routings on one ground: the committed models against the committed reviewed layers.
   The 1 m terrain is a private cache, so nothing here recompiles; `compile-grid-course.mjs` does. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pointInPoly, polyArea, polyLen } from '../geobuild/lib.mjs';
import { verifyScorecard } from '../packages/course-geo/intake/verify-scorecard.mjs';

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const ORIGIN = [649094.5, 6598568.5];
const local = ([e, n]) => [e - ORIGIN[0], ORIGIN[1] - n];
const COURSES = [
  { slug: 'bro-hof-stadium', dir: '.', tees: ['svart', 'vit', 'gul', 'bla', 'rod'] },
  { slug: 'bro-hof-castle', dir: '../brohofcastlebuild', tees: ['vit', 'gul', 'bla', 'rod'] },
].map(c => ({ ...c, model: read(`${c.dir}/course-model.json`), card: read(`${c.dir}/reference/club-scorecard.json`),
  packCard: read(`${c.dir}/card.json`), surfaces: read(`${c.dir}/mapping/playing-surfaces.geojson`), report: read(`${c.dir}/mapping/trace-report.json`),
  notes: read(`${c.dir}/guide-notes.json`), decisions: read(`${c.dir}/mapping/decisions.json`) }));
const inWater = (model, p) => model.water.some(w => pointInPoly(p[0], p[1], w.ring));
const centre = ring => ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);

for (const c of COURSES) {
  test(`${c.slug}: the card is the printed 2024 card, cell by cell, in the model and in the pack card`, () => {
    assert.equal(verifyScorecard(c.card, { requireRated: true }).valid, true);
    assert.equal(c.model.holes.length, 18);
    c.model.holes.forEach((hole, i) => {
      const row = c.card.holes[i];
      assert.deepEqual([hole.n, hole.par, hole.idx], [row.number, row.par, row.index]);
      assert.deepEqual(hole.t, c.tees.map(id => row.lengths[id]));
      assert.deepEqual(c.packCard.holes[i].t, hole.t);
    });
    assert.equal(c.model.holes.reduce((s, h) => s + h.par, 0), 72);
  });

  test(`${c.slug}: every colour stands on a named platform, at the card's own distance, and the route starts there`, () => {
    const routes = new Map(c.report.rows.filter(r => r.kind === 'route').map(r => [r.hole, r]));
    for (const hole of c.model.holes) {
      assert.equal(hole.tees.markerLayout, 'separate-reviewed-colours', `hole ${hole.n}`);
      for (const [i, mark] of hole.tees.marks.entries()) {
        const pad = hole.tees.pads.find(p => p.id === mark.sourcePadId);
        assert.ok(pad && pointInPoly(mark.c[0], mark.c[1], pad.ring), `hole ${hole.n} ${c.tees[i]} stands inside its platform`);
        // Measured, never warped: the worst is Castle 6 Röd, whose only platform stands 13.8 m longer than the card.
        assert.ok(Math.abs(routes.get(hole.n).cardResidual[c.tees[i]]) < 16, `hole ${hole.n} ${c.tees[i]}: ${routes.get(hole.n).cardResidual[c.tees[i]]} m off the card`);
      }
      assert.ok(Math.hypot(hole.line[0][0] - hole.tees.marks[0].c[0], hole.line[0][1] - hole.tees.marks[0].c[1]) < 0.05, `hole ${hole.n} starts on the back mark`);
      const end = hole.line.at(-1);
      assert.ok(pointInPoly(end[0], end[1], hole.green.ring), `hole ${hole.n} ends on its green`);
      assert.ok(Math.abs(polyLen(hole.line) - hole.lineLen) < 0.2);
    }
    const all = c.report.rows.filter(r => r.kind === 'route').flatMap(r => Object.values(r.cardResidual).map(Math.abs)).sort((a, b) => a - b);
    assert.ok(all[all.length >> 1] < 1, `median card residual ${all[all.length >> 1]} m`);
  });

  test(`${c.slug}: greens, tees and bunkers are dry, sane in size and clear of each other`, () => {
    for (const hole of c.model.holes) {
      const area = Math.abs(polyArea(hole.green.ring));
      assert.ok(area > 240 && area < 900, `hole ${hole.n} green ${area.toFixed(0)} m2`);
      for (const p of hole.green.ring) assert.equal(inWater(c.model, p), false, `hole ${hole.n} green reaches water`);
      assert.ok(pointInPoly(hole.pin[0], hole.pin[1], hole.green.ring));
      for (const pad of hole.tees.pads) {
        const a = Math.abs(polyArea(pad.ring));
        assert.ok(a > 18 && a < 620, `${pad.id} ${a.toFixed(0)} m2`);
        assert.equal(inWater(c.model, centre(pad.ring)), false, `${pad.id} stands in water`);
      }
      for (const b of hole.bunkers) {
        assert.equal(inWater(c.model, centre(b.ring)), false, `${b.sourceFeatureId} lies in water`);
        const bitten = b.ring.filter(p => pointInPoly(p[0], p[1], hole.green.ring)).length;
        assert.ok(bitten <= 0.12 * b.ring.length, `${b.sourceFeatureId} bites the green`);
      }
    }
  });

  test(`${c.slug}: the outlines were measured on the photo`, () => {
    const greens = c.report.rows.filter(r => r.kind === 'green');
    assert.equal(greens.length, 18);
    for (const g of greens) {
      assert.equal(g.kept, undefined, `hole ${g.hole} green fell back to its start`);
      assert.ok(g.dPrime > 2.4, `hole ${g.hole} green d' ${g.dPrime}`);
    }
    assert.ok(c.report.classifierAccuracy.green > 0.99 && c.report.classifierAccuracy.fairway > 0.95);
    for (const f of c.surfaces.features) for (const ring of f.geometry.coordinates) {
      assert.deepEqual(ring[0], ring.at(-1), `${f.id} ring is closed`);
      for (const [e, n] of ring) assert.ok(e > 648100 && e < 650160 && n > 6597450 && n < 6599500, `${f.id} leaves the estate`);
    }
  });

  test(`${c.slug}: every hole carries its own note and tagline`, () => {
    c.model.holes.forEach((hole, i) => {
      assert.equal(hole.note, c.notes.holes[i].note);
      assert.equal(hole.name, c.notes.holes[i].name);
    });
    assert.equal(new Set(c.model.holes.map(h => h.note)).size, 18);
    assert.equal(new Set(c.model.holes.map(h => h.name)).size, 18);
  });
}

test('each routing draws the other as mown ground, and the ground itself is one', () => {
  const [stadium, castle] = COURSES;
  for (const [own, other] of [[stadium, castle], [castle, stadium]]) {
    for (const hole of other.model.holes) {
      assert.ok(own.model.scenery.greens.some(ring => pointInPoly(hole.pin[0], hole.pin[1], Array.isArray(ring) ? ring : ring.ring)), `${own.slug} draws ${other.slug} ${hole.n}`);
    }
  }
  assert.deepEqual(stadium.model.water, castle.model.water);
  assert.deepEqual(stadium.model.infra, castle.model.infra);
  assert.equal(stadium.model.evidence.terrain, castle.model.evidence.terrain);
  assert.equal(castle.model.scenery.mappedFeatures.filter(f => f.kind === 'waste_sand').length, 10);
  assert.equal(stadium.model.scenery.mappedFeatures.filter(f => f.kind === 'waste_sand').length, 10);
  // the fescue islands stay in the sand
  assert.ok(castle.model.scenery.mappedFeatures.filter(f => f.kind === 'waste_sand').reduce((s, f) => s + f.rings.length - 1, 0) >= 30);
});

test('the living ground is on: only the bridges keep to the mapped inventory', () => {
  for (const { model } of COURSES) {
    assert.equal(model.infra.bridgePlacement, 'mapped-only');
    for (const key of ['objectPlacement', 'vegetationPlacement', 'terrainPlacement']) assert.equal(key in model.infra, false, key);
    assert.equal(model.evidence.terrainModifiedForPlayingSurfaces, false);
  }
});

test('the 17th is an island behind its stone wall, reached by its causeway', () => {
  const { model } = COURSES[0];
  const wall = model.infra.bulkheads.find(b => b.id === 'stadium-17-island-wall');
  assert.equal(wall.kind, 'stone');
  const green = model.holes[16].green.ring;
  for (const p of green) assert.ok(pointInPoly(p[0], p[1], wall.line), 'the green lies inside the wall');
  const pond = model.water.find(w => w.id === 'lm-water-659_64-16');
  let wet = 0, n = 0;
  const c = centre(wall.line);
  for (const p of wall.line) {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    const out = [c[0] + (p[0] - c[0]) * (d + 1.2) / d, c[1] + (p[1] - c[1]) * (d + 1.2) / d];
    n++;
    if (pointInPoly(out[0], out[1], pond.ring)) wet++;
  }
  assert.ok(wet / n > 0.85, `${wet} of ${n} points have water just outside the wall`);
  assert.ok(model.infra.bulkheads.every(b => ['stone', 'boulders'].includes(b.kind)), 'no timber was seen anywhere on the estate');
});

test('Mälaren is one lake across the 10 km tile seam', () => {
  const { model } = COURSES[0];
  const lake = model.water.filter(w => w.area > 1e6);
  assert.equal(lake.length, 1);
  assert.equal(lake[0].level, 0.99);
  const seam = 650000 - ORIGIN[0];
  assert.ok(lake[0].ring.some(p => p[0] < seam - 200) && lake[0].ring.some(p => p[0] > seam + 200));
  for (const id of ['lm-water-659_65-0']) assert.equal(model.water.some(w => w.id === id), false);
  assert.ok(local([650000, 6598568.5])[0] === seam);
});
