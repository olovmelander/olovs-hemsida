import { describe, expect, it } from 'vitest';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { inRing } from '../engine/geom.js';
import { createShotEnvironment } from '../engine/shot-planner.mjs';
import { createMapStrategy, readMapShot } from './map-strategy.mjs';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const hole = {
  n: 1, line: [[0, 0], [0, 360]], fairway: { rings: [rect(-21, 40, 21, 326)] },
  green: { c: [0, 360], ring: rect(-10, 350, 10, 370) },
};
const defaults = { bag: DEFAULT_BAG, hole, environment: createShotEnvironment(), heightAt: () => 0 };
const same = (point, expected) => expect(point).toEqual(expected);

describe('live next stroke', () => {
  it('holds a valid landing for a small fix change while remeasuring its shot from the real lie', () => {
    const strategy = createMapStrategy(defaults);
    const initial = strategy.plan([0, 0]);
    const moved = strategy.plan([3, 4], { previous: initial });
    expect(initial.status).toBe('playable');
    expect(moved.shots[0].candidateId).toBe(initial.shots[0].candidateId);
    same(moved.shots[0].from, [3, 4]);
    expect(moved.shots[0].distance).not.toBe(initial.shots[0].distance);
    expect(moved.shots[0].reading.distance).toBe(moved.shots[0].distance);
    const approach = strategy.plan([0, 236], { previous: moved });
    same(approach.shots[0].point, hole.green.c);
    expect(approach.shots[0].club.id).toBe('iron-9');
  });

  it('recommends a short green-centre chip and leaves the putter to the on-green state', () => {
    const strategy = createMapStrategy(defaults);
    const chip = strategy.plan([0, 348]);
    same(chip.shots[0].point, hole.green.c);
    expect(chip.shots[0].distance).toBe(12);
    expect(chip.shots[0].club.carry).toBeGreaterThan(0);
    expect(strategy.plan([0, 355])).toMatchObject({ status: 'on-green', shots: [] });
  });

  it('recognises a safe sub-15 m entry when the rest of a long green is screened', () => {
    const longGreen = { ...hole, green: { c: [0, 368], ring: rect(-7, 350, 7, 386) } };
    const environment = createShotEnvironment({ buildings: [rect(-18, 358, 18, 360)] });
    const plan = createMapStrategy({ ...defaults, hole: longGreen, environment }).plan([0, 348]);
    expect(plan.status).toBe('playable');
    expect(plan.shots[0].distance).toBeLessThan(15);
    expect(inRing(...plan.shots[0].point, longGreen.green.ring)).toBe(true);
    expect(environment.clearSegment(plan.origin, plan.shots[0].point)).toBe(true);
  });

  it('uses only the centre of a placeholder green and does not infer a putt from its radius', () => {
    const strategy = createMapStrategy({ ...defaults, greensApproximate: true });
    const chip = strategy.plan([0, 354]);
    same(chip.shots[0].point, hole.green.c);
    expect(strategy.plan([0, 359.8])).toMatchObject({ status: 'unavailable', reason: 'approximate-green', shots: [] });
    const blockedCentre = createMapStrategy({ ...defaults, greensApproximate: true,
      environment: createShotEnvironment({ landingAllowed: (x, z) => x !== 0 || z !== 360 }) });
    expect(blockedCentre.plan([0, 347]).shots).toEqual([]);
  });

  it('keeps a long dogleg shortcut off the route even when the inside woods are unmapped', () => {
    const corner = { n: 2, line: [[0, 0], [0, 130], [130, 130]],
      fairway: { rings: [rect(-18, 15, 18, 145), rect(-12, 113, 115, 147)] },
      green: { c: [130, 130], ring: rect(120, 120, 140, 140) } };
    const plan = createMapStrategy({ ...defaults, hole: corner }).plan([0, 0]);
    expect(plan.shots.length).toBeGreaterThan(1);
    expect(plan.shots[0].kind).toBe('landing');
    expect(plan.shots[0].point[1]).toBeGreaterThan(90);
  });

  it('can recover sideways onto this fairway with a checked onward route', () => {
    const bank = rect(8, 174, 65, 230);
    const environment = createShotEnvironment({ buildings: [bank] });
    const plan = createMapStrategy({ ...defaults, environment }).plan([57, 171]);
    expect(plan.status).toBe('playable');
    expect(plan.shots[0].point[1]).toBeLessThan(196);
    expect(inRing(...plan.shots[0].point, hole.fairway.rings[0])).toBe(true);
    expect(plan.shots.every(shot => environment.clearSegment(shot.from, shot.point))).toBe(true);
    expect(createMapStrategy({ ...defaults, environment }).plan([55, 180]).shots).toEqual([]);
    const water = createMapStrategy({ ...defaults, environment: { ...environment, originAllowed: (x, z) => x !== 57 || z !== 171 } });
    expect(water.plan([57, 171])).toMatchObject({ status: 'blocked', shots: [] });
  });

  it('applies the tee note only on a tee-origin solve', () => {
    const strategy = createMapStrategy({ ...defaults, hole: { ...hole, note: 'Slå max 140 meter.' } });
    expect(strategy.plan([0, 0], { tee: true }).shots[0].distance).toBeLessThanOrEqual(140);
    expect(strategy.plan([0, 0]).shots[0].distance).toBeGreaterThan(140);
  });

  it('shows a checked fairway recovery without promising an unreachable onward approach', () => {
    const strategy = createMapStrategy({ ...defaults, heightAt: (_x, z) => z < 340 ? 0 : 300 });
    const plan = strategy.plan([0, 20]);
    expect(plan.status).toBe('recovery');
    expect(plan.shots).toHaveLength(1);
    expect(plan.shots[0].kind).toBe('landing');
    expect(inRing(...plan.shots[0].point, hole.fairway.rings[0])).toBe(true);
  });

  it('uses entered carry over hazards when the GPS-learned range includes roll', () => {
    const bag = [{ id: 'short', name: 'Kort', carry: 150 }, { id: 'long', name: 'Lång', carry: 165 }];
    const carryBag = [{ ...bag[0], carry: 115 }, { ...bag[1], carry: 155 }];
    const environment = { ...defaults.environment, carryRequired: () => 139 };
    const forced = readMapShot({ ...defaults, environment, bag, carryBag, from: [0, 0], to: [0, 150] });
    expect(forced.club.id).toBe('long');
    expect(forced.reachable).toBe(true);
    expect(readMapShot({ ...defaults, environment, bag, carryBag, from: [0, 0], to: [0, 170] }).reachable).toBe(false);
    const blocked = readMapShot({ ...defaults, environment: { carryRequired: () => 141 },
      bag, carryBag: [{ ...bag[0], carry: 115 }, { ...bag[1], carry: 140 }], from: [0, 0], to: [0, 150] });
    expect(blocked.reachable).toBe(false);
    expect(blocked.club.id).toBe('long');
    expect(readMapShot({ ...defaults, from: [0, 0], to: [0, 0] }).club).toBeNull();
  });

  it('never assigns a woefully short club from a sparse bag to an automatic leg', () => {
    const bag = [{ id: 'w', name: 'SW', carry: 70 }, { id: 'd', name: 'Driver', carry: 210 }];
    const shot = createMapStrategy({ ...defaults, bag }).plan([0, 228]).shots[0];
    expect(shot.distance).toBe(132);
    expect(shot.club.id).toBe('d');
    const near = readMapShot({ ...defaults, from: [0, 0], to: [0, 144] });
    expect(near.club.id).toBe('iron-7');
    const aboveRange = [{ id: 'custom-a', name: 'A', carry: 370 }, { id: 'custom-b', name: 'B', carry: 420 }];
    expect(readMapShot({ ...defaults, bag: aboveRange, from: [0, 0], to: [0, 370] }).club.id).toBe('custom-a');
  });
});
