/* Walk every published layout through its normal pack, frame, vegetation, height
   and guidance loaders. The Node fixture exercises the map's vector-water
   fallback. The mobile field harness also loads the painted water and shores. */
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import catalogue from '../../public/courses/v2-index.json';
import { DEFAULT_BAG, pointAlongLine } from '../engine/caddie.js';
import { inRing, polyLen, ringSD } from '../engine/geom.js';
import { loadMapCourse } from './map-course.mjs';
import { groundDistance, shotReading } from './map-measure.mjs';
import { createMapShotGeometry, loadMapShotGeometry } from './map-shot-geometry.mjs';
import { createMapStrategy } from './map-strategy.mjs';
import { createTileStore } from './map-tiles.mjs';
import { createTreeRules } from './map-trees.mjs';

const baseHref = 'https://banvy.invalid/';
const publicRoot = new URL('../../public/', import.meta.url);
beforeAll(() => {
  vi.stubGlobal('fetch', async url => {
    const file = new URL(url, baseHref).pathname.slice(1);
    return new Response(await readFile(new URL(file, publicRoot)));
  });
});
afterAll(() => vi.unstubAllGlobals());

function positions(hole, tee) {
  const halfway = polyLen(hole.line) / 2;
  const middle = pointAlongLine(hole.line, halfway);
  const forward = pointAlongLine(hole.line, halfway + 1);
  const step = groundDistance(middle, forward);
  const lateral = [
    middle[0] + 32 * (forward[1] - middle[1]) / step,
    middle[1] - 32 * (forward[0] - middle[0]) / step,
  ];
  // An approach two metres outside the actual front edge of this green.
  const direction = Math.atan2(middle[1] - hole.green.c[1], middle[0] - hole.green.c[0]);
  let greenside = hole.green.c;
  for (let distance = 1; ringSD(...greenside, hole.green.ring) < 2; distance++) {
    greenside = [hole.green.c[0] + Math.cos(direction) * distance, hole.green.c[1] + Math.sin(direction) * distance];
  }
  return { tee, middle, lateral, greenside };
}

describe('GPS shot guidance on published layouts', () => {
  for (const { slug } of catalogue.courses) {
    it(`routes real lies at ${slug}`, async () => {
      const course = await loadMapCourse(slug);
      const store = createTileStore({ ground: course.ground, baseHref, rules: createTreeRules(course) });
      const tiles = new Map();
      const cachedStore = {
        shotTile(id) {
          if (!tiles.has(id)) tiles.set(id, store.shotTile(id));
          return tiles.get(id);
        },
      };
      const playable = { tee: 0, middle: 0, lateral: 0, greenside: 0 };
      const recoveries = { ...playable };
      const failures = [];
      for (const hole of course.holes) {
        const payload = await loadMapShotGeometry(course, hole, cachedStore);
        const geometry = createMapShotGeometry(payload);
        const planner = createMapStrategy({ ...geometry, bag: DEFAULT_BAG });
        const tee = (hole.tees[course.tees.def] ?? hole.tees[0]).point;
        for (const [lie, origin] of Object.entries(positions(hole, tee))) {
          const label = `${slug} hole ${hole.n}, ${lie}`;
          const plan = planner.plan(origin, { tee: lie === 'tee' });
          expect(plan.origin, label).toEqual(origin);
          if (slug === 'veckefjarden' && hole.n === 14 && lie === 'tee') {
            // The island green is reachable over water. A neighbouring run of
            // white stakes used to reject every flight from this tee.
            expect(plan.status, label).toBe('playable');
            expect(plan.shots, label).toHaveLength(1);
            expect(geometry.environment.carryRequired(origin, plan.shots[0].point), label).toBeGreaterThan(0);
          }
          if (course.greensApproximate && lie === 'tee' && hole.par === 3) {
            expect(plan.shots[0]?.point, label).toEqual(hole.green.c);
          }
          if (!['playable', 'recovery'].includes(plan.status)) {
            expect(['blocked', 'unavailable', 'on-green'], label).toContain(plan.status);
            expect(plan.shots, label).toHaveLength(0);
            if (plan.status === 'on-green') expect(inRing(...origin, hole.green.ring), label).toBe(true);
            failures.push({ hole: hole.n, lie, status: plan.status });
            continue;
          }
          if (plan.status === 'recovery') recoveries[lie]++;
          else playable[lie]++;
          let ball = origin;
          for (const shot of plan.shots) {
            expect(shot.from, label).toEqual(ball);
            const club = DEFAULT_BAG.find(item => item.id === shot.club?.id);
            expect(club, label).toBeDefined();
            expect(shot.reading.distance, label).toBeCloseTo(groundDistance(ball, shot.point), 6);
            expect(geometry.environment.clearSegment(ball, shot.point), label).toBe(true);
            expect(geometry.environment.landingAllowed(...shot.point), label).toBe(true);
            expect([hole.green.ring, ...hole.fairways].some(ring => inRing(...shot.point, ring)), label).toBe(true);
            const carry = geometry.environment.carryRequired(ball, shot.point);
            if (carry > 0) {
              const farBank = pointAlongLine([ball, shot.point], carry);
              const toBank = shotReading(ball, farBank, geometry.heightAt);
              expect(club.carry, label).toBeGreaterThanOrEqual(toBank.plays ?? carry);
            }
            ball = shot.point;
          }
          if (plan.status === 'recovery') {
            expect(plan.shots, label).toHaveLength(1);
            expect(hole.fairways.some(ring => inRing(...ball, ring)), label).toBe(true);
          } else {
            expect(plan.shots.at(-1)?.kind, label).toBe('green');
            expect(inRing(...ball, hole.green.ring), label).toBe(true);
            if (course.greensApproximate) expect(ball, label).toEqual(hole.green.c);
          }
        }
        const onGreen = planner.plan(hole.green.c);
        expect(onGreen.status).toBe(course.greensApproximate ? 'unavailable' : 'on-green');
        if (course.greensApproximate) expect(onGreen.reason).toBe('approximate-green');
        expect(onGreen.shots).toHaveLength(0);
      }
      if (process.env.BANVY_ROUTE_COVERAGE) console.log(slug, JSON.stringify({ playable, recoveries, failures }));
      // A lateral GPS fix can be under a measured crown. The published tee
      // and approach samples support full routes on at least four in five
      // holes of every layout, so a regression to mostly blocked cannot pass.
      const reason = JSON.stringify(failures);
      expect(playable.lateral, reason).toBeGreaterThan(0);
      for (const lie of ['tee', 'middle', 'greenside']) {
        expect(playable[lie], reason).toBeGreaterThanOrEqual(Math.ceil(course.holes.length * 0.8));
      }
    }, 120000);
  }
});
