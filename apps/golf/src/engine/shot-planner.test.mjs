import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { strategyForHole, DEFAULT_BAG } from './caddie.js';
import { createShotEnvironment } from './shot-planner.mjs';
import { hyp, inRing, ptSegD } from './geom.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const straight = (par = 4) => ({ par, line: [[0, 0], [0, 350]], tees: { marks: [{ c: [18, 0] }] },
  fairway: { rings: [rect(-24, 50, 24, 325)] },
  green: { c: [0, 350], ring: rect(-14, 336, 14, 364) } });
const plan = (hole, environment) => strategyForHole(hole, 0, DEFAULT_BAG, environment);

describe('golf shot planning', () => {
  it('launches straight from a lateral tee to a central fairway landing on par fours and fives', () => {
    for (const par of [4, 5]) {
      const h = straight(par), result = plan(h);
      expect(result.status).toBe('playable');
      expect(result.line[0]).toEqual([18, 0]);
      expect(result.line[1]).toEqual(result.primary);
      expect(result.primary[1]).toBeGreaterThan(140);
      expect(Math.abs(result.primary[0])).toBeLessThan(5);
      expect(result.primaryDistance).toBeCloseTo(hyp(result.origin, result.primary));
      expect(result.zones.at(-1).point).toEqual(h.green.c);
    }
  });

  it('aims at a reachable green centre regardless of par', () => {
    const h = straight(); h.tees.marks[0].c = [0, 175];
    const result = plan(h);
    expect(result.zones).toHaveLength(1);
    expect(result.primary).toEqual(h.green.c);
    expect(result.zones[0].kind).toBe('green');
  });

  it('rejects an overhanging crown even when its trunk is outside the shot', () => {
    const environment = createShotEnvironment({ trees: [{ x: 7, z: 100, radius: 6 }] });
    expect(environment.clearSegment([0, 0], [0, 200])).toBe(false);
    expect(environment.clearSegment([-5, 0], [-5, 200])).toBe(true);
    const result = plan(straight(), environment);
    expect(result.status).toBe('playable');
    for (const zone of result.zones) expect(ptSegD(7, 100, ...zone.from, ...zone.point)).toBeGreaterThan(8);
  });

  it('plans strokes around a wooded dogleg with a fairway layup', () => {
    const h = { par: 5, line: [[0, 0], [0, 170], [180, 170]], tees: { marks: [{ c: [0, 0] }] },
      fairway: { rings: [rect(-20, 40, 20, 190), rect(0, 150, 160, 190)] },
      green: { c: [180, 170], ring: rect(165, 155, 195, 185) } };
    const wall = rect(30, 20, 150, 130);
    const environment = createShotEnvironment({ buildings: [wall] });
    const result = plan(h, environment);
    expect(result.status).toBe('playable');
    expect(result.primary[1]).toBeGreaterThan(145);
    for (const zone of result.zones) expect(environment.clearSegment(zone.from, zone.point)).toBe(true);
    expect(result.line).toHaveLength(result.zones.length + 1);
  });

  it('allows a water carry but never recommends landing in the water or a bunker', () => {
    const h = straight();
    h.bunkers = [{ ring: rect(-10, 190, 10, 220) }];
    const water = rect(-30, 85, 30, 110);
    const result = plan(h, createShotEnvironment({ landingAllowed: (x, z) => !inRing(x, z, water) }));
    expect(result.status).toBe('playable');
    expect(result.primary[1]).toBeGreaterThan(110);
    for (const zone of result.zones) {
      expect(inRing(...zone.point, water)).toBe(false);
      expect(inRing(...zone.point, h.bunkers[0].ring)).toBe(false);
    }
  });

  it('searches a narrow fairway opening when the central candidates are blocked', () => {
    const h = straight(); h.tees.marks[0].c = [22, 0];
    const environment = createShotEnvironment({ buildings: [rect(-30, 30, 14, 170)] });
    const result = plan(h, environment);
    expect(result.status).toBe('playable');
    expect(result.primary[0]).toBeGreaterThan(16);
    expect(result.primary[1]).toBeGreaterThan(140);
    for (const zone of result.zones) expect(environment.clearSegment(zone.from, zone.point)).toBe(true);
  });

  it('returns no invented safe line when the tee is enclosed or the green is unreachable', () => {
    const h = straight();
    const closed = createShotEnvironment({ trees: [{ x: 18, z: 0, radius: 12 }] });
    const result = plan(h, closed);
    expect(result.status).toBe('blocked');
    expect(result.primary).toBeNull();
    expect(result.zones).toEqual([]);
    h.fairway.rings = [];
    expect(plan(h).status).toBe('blocked');
  });

  it('does not use the authored line as a fallback when surface geometry is missing', () => {
    const h = straight(); delete h.green.ring;
    const result = plan(h);
    expect(result.status).toBe('unavailable');
    expect(result.primary).toBeNull();
  });

  it('checks buildings continuously, including a narrow diagonal crossing and collinear edges', () => {
    const env = createShotEnvironment({ buildings: [rect(49.9, -1, 50.1, 1)], clearance: 0 });
    expect(env.clearSegment([0, -30], [100, 30])).toBe(false);
    expect(env.clearSegment([0, -1], [100, -1])).toBe(false);
    expect(env.clearSegment([0, 4], [100, 4])).toBe(true);
  });

  it('rejects a terrain ridge above the nominal carry envelope', () => {
    const env = createShotEnvironment({ terrainHeight: (x, z) => z > 90 && z < 110 ? 60 : 0 });
    expect(env.clearSegment([0, 0], [0, 200])).toBe(false);
  });

  it('uses an interior green target if the supplied centre is outside a concave green', () => {
    const h = straight(); h.green = { c: [0, 350], ring: [[-20, 330], [20, 330], [20, 340], [-8, 340], [-8, 370], [-20, 370]] };
    const result = plan(h);
    expect(result.status).toBe('playable');
    expect(inRing(...result.zones.at(-1).point, h.green.ring)).toBe(true);
  });
});

describe('reported Upsala holes', () => {
  const model = JSON.parse(readFileSync(new URL('../../../../upsalabuild/course-model.json', import.meta.url), 'utf8'));
  it.each([1, 7, 11])('keeps every tee of hole %i on its own fairway/green with true carry distances', n => {
    const h = model.holes[n - 1];
    for (let tee = 0; tee < h.tees.marks.length; tee++) {
      const result = strategyForHole(h, tee);
      expect(result.status).toBe('playable');
      expect(result.origin).toEqual(h.tees.marks[tee].c);
      for (const zone of result.zones) {
        const rings = zone.surface === 'green' ? [h.green.ring] : h.fairway.rings;
        expect(rings.some(r => inRing(...zone.point, r))).toBe(true);
        expect(zone.shotDistance).toBeCloseTo(hyp(zone.from, zone.point));
        expect(zone.shotDistance).toBeLessThanOrEqual(210);
      }
    }
  });
});
