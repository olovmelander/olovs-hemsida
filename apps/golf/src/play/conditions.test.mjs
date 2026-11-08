import { describe, it, expect } from 'vitest';
import { launchState, simulateShot, BALL, puttSpeedFor, seeded } from './ball-physics.mjs';
import { conditionsFor, groundWith, strokeWind, airDensity, LIGHT_DAY } from './conditions.mjs';
import { holeFrame, fitFrame } from './hole-map.mjs';
import { createRound, holeCard, addStroke, receivedOn, pointsOn, roundStats } from './play-rules.mjs';
import { launchFor, playBag } from './shot-model.mjs';
import { DEFAULT_BAG } from '../engine/caddie.js';

const flat = (surface, c) => ({ heightAt: () => 0, surfaceAt: () => surface, cup: null, ...(c ? { ground: groundWith(c), plug: c.plug } : {}) });
const drive = (c, surface = 'fairway') => {
  const { velocity, spin } = launchState({ speed: 62, launchDeg: 12.5, yaw: 0, spinRpm: 2700 });
  return simulateShot(flat(surface, c), { start: [0, BALL.radius, 0], velocity, spin, rho: c?.rho });
};

describe('the day\'s conditions', () => {
  it('a storm\'s wet turf and winter\'s snow take the run out of a drive; summer gives it more', () => {
    const plain = drive(conditionsFor({ preset: 'golden' }));
    const wet = drive(conditionsFor({ preset: 'storm', wetness: 1 }));
    const firm = drive(conditionsFor({ preset: 'summer' }));
    const snow = drive(conditionsFor({ preset: 'winter', snow: true }));
    const run = s => s.total - s.carry;
    expect(run(wet)).toBeLessThan(run(plain) * .8);
    expect(run(firm)).toBeGreaterThan(run(plain));
    expect(run(snow)).toBeLessThan(run(wet));
  });
  it('cold air carries a ball less far than warm air', () => {
    expect(airDensity(-5)).toBeGreaterThan(airDensity(25));
    const cold = drive(conditionsFor({ preset: 'golden', weather: { tempC: -5 } }));
    const warm = drive(conditionsFor({ preset: 'golden', weather: { tempC: 28 } }));
    expect(warm.carry - cold.carry).toBeGreaterThan(3);
  });
  it('takes the reading\'s temperature when there is one, the light\'s otherwise', () => {
    expect(conditionsFor({ preset: 'winter' }).tempC).toBe(LIGHT_DAY.winter.tempC);
    const read = conditionsFor({ preset: 'noon', weather: { tempC: 7.4 } });
    expect(read.measured).toBe(true);
    expect(read.label).toMatch(/^7 °C/);
    expect(conditionsFor({ preset: 'winter', snow: true }).ball).not.toBe(conditionsFor({ preset: 'noon' }).ball);
  });
  it('a putt struck for d metres on today\'s green rolls d metres there', () => {
    const c = conditionsFor({ preset: 'storm', wetness: 1 });
    const putter = playBag(DEFAULT_BAG).at(-1);
    const L = launchFor({ club: putter, power: .5, yaw: 0, puttRange: 12, greenRoll: c.greenRoll });
    expect(L.speed).toBeGreaterThan(puttSpeedFor(6));
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: 0, yaw: 0, spinRpm: 0 });
    const roll = simulateShot(flat('green', c), { start: [0, BALL.radius, 0], velocity, spin, roll: true });
    expect(Math.abs(roll.total - 6)).toBeLessThan(.35);
  });
  it('a gust is drawn per stroke, never below the mean, and the same for the same seed', () => {
    const a = strokeWind([4, 0], { gustMs: 9 }, seeded(5)), b = strokeWind([4, 0], { gustMs: 9 }, seeded(5));
    expect(a).toEqual(b);
    for (let i = 1; i < 40; i++) {
      const w = strokeWind([4, 0], { gustMs: 9 }, seeded(i * 7919));
      expect(w.ms).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(w.ms).toBeLessThanOrEqual(9 + 1e-9);
    }
    expect(strokeWind([0, 0], {}, seeded(1)).ms).toBe(0);
  });
});

describe('the hole map\'s frame', () => {
  const line = [[100, 50], [100, 250], [160, 420]];
  it('turns the hole to run up the map: the tee at the bottom, the green at the top', () => {
    const frame = holeFrame(line);
    const fit = fitFrame(holeFrame(line, { aspect: 160 / 270 }), 160, 270);
    const tee = fit.toPx(...line[0]), green = fit.toPx(...line.at(-1));
    expect(green[1]).toBeLessThan(tee[1]);
    expect(Math.abs(green[0] - tee[0])).toBeLessThan(2);
    for (const p of line) { const q = fit.toPx(...p); expect(q[0]).toBeGreaterThan(0); expect(q[0]).toBeLessThan(160); expect(q[1]).toBeGreaterThan(0); expect(q[1]).toBeLessThan(270); }
    const back = fit.fromPx(...fit.toPx(130, 300));
    expect(back[0]).toBeCloseTo(130, 6); expect(back[1]).toBeCloseTo(300, 6);
  });
  it('widens to fill its box', () => {
    const frame = holeFrame(line, { aspect: 168 / 270 });
    expect((frame.cMax - frame.cMin) / (frame.aMax - frame.aMin)).toBeCloseTo(168 / 270, 6);
  });
  it('keeps the map\'s right on the golfer\'s right, facing up the hole', () => {
    // Up the hole is +z here (south): facing south, the right hand is west (-x).
    const frame = holeFrame([[0, 0], [0, 300]]);
    const fit = fitFrame(frame, 160, 270);
    expect(fit.toPx(-20, 150)[0]).toBeGreaterThan(fit.toPx(20, 150)[0]);
  });
});

describe('handicap and the round\'s figures (the map\'s rules)', () => {
  const holes = [{ n: 1, par: 4, idx: 1 }, { n: 2, par: 3, idx: 2 }];
  const round = createRound({ slug: 's', courseName: 'S', holes, now: 5 });
  round.handicap = 1;
  it('gives the stroke on the hardest hole and counts Stableford points', () => {
    expect(receivedOn(round, holes, 1)).toBe(1);
    expect(receivedOn(round, holes, 2)).toBe(0);
    const one = holeCard(round, 1);
    round.current = 1;
    addStroke(round, { club: 'driver', lie: 'tee', from: [0, 0], to: [0, 200] });
    addStroke(round, { club: 'iron-7', lie: 'fairway', from: [0, 200], to: [0, 340] });
    addStroke(round, { club: 'putter', putt: true, lie: 'green' });
    addStroke(round, { club: 'putter', putt: true, lie: 'green' });
    addStroke(round, { club: 'putter', putt: true, lie: 'green' });
    one.holed = true;
    // 5 on a par 4 with a stroke: net par, two points.
    expect(pointsOn(round, holes, 1)).toBe(2);
    const stats = roundStats(round, holes);
    expect(stats).toMatchObject({ fairways: 1, fairwaysTried: 1, greens: 1, greensTried: 1, putts: 3, points: 2 });
  });
  it('counts no points without a handicap', () => {
    const plain = createRound({ slug: 's', courseName: 'S', holes, now: 6 });
    expect(receivedOn(plain, holes, 1)).toBeNull();
    expect(roundStats(plain, holes).points).toBeNull();
  });
});
