import { describe, it, expect } from 'vitest';
import { compassBearing, windAlong, playsLike, greenDistances, lineHazards, layupTargets, PLAYS_LIKE } from './rangefinder.js';

const deg = r => r * 180 / Math.PI;

describe('compassBearing', () => {
  it('north is -z, east is +x', () => {
    expect(deg(compassBearing(0, 0, 0, -100))).toBeCloseTo(0);
    expect(deg(compassBearing(0, 0, 100, 0))).toBeCloseTo(90);
    expect(deg(compassBearing(0, 0, 0, 100))).toBeCloseTo(180, 5);
  });
});

describe('windAlong', () => {
  const north = compassBearing(0, 0, 0, -100);
  it('a north wind on a north-bound shot is all headwind', () => {
    const w = windAlong(north, 0, 5);
    expect(w.head).toBeCloseTo(5);
    expect(w.cross).toBeCloseTo(0);
  });
  it('a south wind on the same shot is all tailwind', () => {
    expect(windAlong(north, 180, 5).head).toBeCloseTo(-5);
  });
  it('an east wind is a crosswind from the right', () => {
    const w = windAlong(north, 90, 5);
    expect(w.head).toBeCloseTo(0);
    expect(w.cross).toBeCloseTo(5);
  });
  it('no wind or no direction is no wind', () => {
    expect(windAlong(north, null, 5)).toEqual({ head: 0, cross: 0 });
    expect(windAlong(north, 90, 0)).toEqual({ head: 0, cross: 0 });
  });
});

describe('playsLike', () => {
  it('adds a metre per metre of rise', () => {
    expect(playsLike({ dist: 150, dh: 10 }).total).toBeCloseTo(160);
    expect(playsLike({ dist: 150, dh: -10 }).total).toBeCloseTo(140);
  });
  it('a 10 mph headwind adds about 10% and the same tailwind takes about 5%', () => {
    const mph10 = 4.4704;
    expect(playsLike({ dist: 150, head: mph10 }).wind).toBeCloseTo(15.0, 0);
    expect(playsLike({ dist: 150, head: -mph10 }).wind).toBeCloseTo(-7.5, 0);
  });
  it('warm air plays shorter, cold air longer, off 21 °C', () => {
    expect(playsLike({ dist: 150, tempC: 31 }).temp).toBeCloseTo(-150 * PLAYS_LIKE.perDegC * 10);
    expect(playsLike({ dist: 150, tempC: 1 }).temp).toBeCloseTo(150 * PLAYS_LIKE.perDegC * 20);
    expect(playsLike({ dist: 150, tempC: null }).temp).toBe(0);
  });
  it('the wind term is capped at a quarter of the shot', () => {
    expect(playsLike({ dist: 100, head: 40 }).wind).toBeCloseTo(25);
    expect(playsLike({ dist: 100, head: -40 }).wind).toBeCloseTo(-25);
  });
});

describe('greenDistances', () => {
  const square = { c: [0, -100], ring: [[-10, -90], [10, -90], [10, -110], [-10, -110]] };
  it('front, centre and back along the ray through the centre', () => {
    const g = greenDistances([0, 0], square);
    expect(g.centre).toBeCloseTo(100);
    expect(g.front).toBeCloseTo(90, 0);
    expect(g.back).toBeCloseTo(110, 0);
  });
  it('an approach from the side measures the ring where the ray crosses it', () => {
    const g = greenDistances([-100, -100], square);
    expect(g.centre).toBeCloseTo(100);
    expect(g.front).toBeCloseTo(90, 0);
    expect(g.back).toBeCloseTo(110, 0);
  });
  it('a ray that misses the ring reports no front or back', () => {
    const g = greenDistances([0, 0], { c: [0, -100], ring: [[50, -90], [70, -90], [70, -110], [50, -110]] });
    expect(g.front).toBeNull();
    expect(g.back).toBeNull();
    expect(g.centre).toBeCloseTo(100);
  });
});

describe('lineHazards', () => {
  it('reports each run with its layup and carry distances', () => {
    const kindAt = (x, z) => (z <= -50 && z >= -70 ? 'vatten' : z <= -120 && z >= -125 ? 'bunker' : null);
    const runs = lineHazards([0, 0], [0, -200], kindAt);
    expect(runs.map(r => r.type)).toEqual(['vatten', 'bunker']);
    expect(runs[0].from).toBe(50);
    expect(runs[0].to).toBe(70);
    expect(runs[1].from).toBe(120);
    expect(runs[1].to).toBe(125);
  });
  it('merges runs of one kind closer than the gap and keeps different kinds apart', () => {
    const kindAt = (x, z) => (z <= -50 && z >= -60 ? 'vatten' : z <= -61.5 && z >= -70 ? 'vatten' : z <= -71 && z >= -75 ? 'bunker' : null);
    const runs = lineHazards([0, 0], [0, -100], kindAt, 0.5, 2);
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ type: 'vatten', from: 50, to: 70 });
    expect(runs[1].type).toBe('bunker');
  });
  it('a zero-length shot crosses nothing', () => {
    expect(lineHazards([5, 5], [5, 5], () => 'vatten')).toEqual([]);
  });
});

describe('layupTargets', () => {
  it('offers the shots that leave 100 and 150 metres', () => {
    expect(layupTargets(265)).toEqual([{ remain: 100, shot: 165 }, { remain: 150, shot: 115 }]);
  });
  it('drops layups that would be a chip', () => {
    expect(layupTargets(130)).toEqual([]);
    expect(layupTargets(160)).toEqual([{ remain: 100, shot: 60 }]);
  });
});
