import { describe, it, expect } from 'vitest';
import { BALL, CLUB_LAUNCH, SURFACES, CUP_RADIUS, launchState, simulateShot, flatCarry, speedForCarry, puttSpeedFor, windAt, aeroCoefficients } from './ball-physics.mjs';

const flat = (surface = 'fairway', extra = {}) => ({ heightAt: () => 0, surfaceAt: () => surface, cup: null, ...extra });
const shoot = (world, { speed, launchDeg, spinRpm, yaw = 0, axisDeg = 0, wind = [0, 0], start = [0, BALL.radius, 0] }) => {
  const { velocity, spin } = launchState({ speed, launchDeg, yaw, spinRpm, axisDeg });
  return simulateShot(world, { start, velocity, spin, wind });
};

describe('flight', () => {
  it('carries a TrackMan-average driver about 200 m and an apex near 30 m', () => {
    // Amateur average: 62.6 m/s ball speed, 13 deg, 2900 rpm, about 200 m carry.
    const shot = shoot(flat(), { speed: 62.6, launchDeg: 13, spinRpm: 2900 });
    expect(shot.carry).toBeGreaterThan(180);
    expect(shot.carry).toBeLessThan(225);
    expect(shot.apex).toBeGreaterThan(20);
    expect(shot.apex).toBeLessThan(38);
  });
  it('carries a 7-iron about 135-155 m from 53 m/s', () => {
    const carry = flatCarry({ speed: 53, launchDeg: 18.5, spinRpm: 7000 });
    expect(carry).toBeGreaterThan(125);
    expect(carry).toBeLessThan(160);
  });
  it('solves the ball speed that carries a club its distance', () => {
    for (const [club, carry] of [['driver', 210], ['iron7', 140], ['pw', 105], ['sw', 75]]) {
      const speed = speedForCarry(club, carry);
      const spec = CLUB_LAUNCH[club];
      expect(Math.abs(flatCarry({ speed, launchDeg: spec.launch, spinRpm: spec.spin }) - carry)).toBeLessThan(.5);
    }
  });
  it('rolls a driver out much further than a wedge', () => {
    const drive = shoot(flat(), { speed: speedForCarry('driver', 210), launchDeg: 12.5, spinRpm: 2700 });
    const wedge = shoot(flat('green'), { speed: speedForCarry('sw', 75), launchDeg: 31, spinRpm: 9900 });
    expect(drive.total - drive.carry).toBeGreaterThan(12);
    expect(wedge.total - wedge.carry).toBeLessThan(6);
  });
  it('curves right with a positive spin axis and left with a negative one', () => {
    const fade = shoot(flat(), { speed: 55, launchDeg: 15, spinRpm: 5000, axisDeg: 15 });
    const draw = shoot(flat(), { speed: 55, launchDeg: 15, spinRpm: 5000, axisDeg: -15 });
    // Flying along +z (yaw 0), the right-hand side of the flight is -x.
    expect(fade.rest[0]).toBeLessThan(-8);
    expect(draw.rest[0]).toBeGreaterThan(8);
  });
  it('a headwind shortens and a tailwind lengthens', () => {
    const calm = shoot(flat(), { speed: 55, launchDeg: 16, spinRpm: 6000 }).carry;
    const into = shoot(flat(), { speed: 55, launchDeg: 16, spinRpm: 6000, wind: [0, -6] }).carry;
    const down = shoot(flat(), { speed: 55, launchDeg: 16, spinRpm: 6000, wind: [0, 6] }).carry;
    expect(into).toBeLessThan(calm - 8);
    expect(down).toBeGreaterThan(calm + 5);
  });
  it('the wind is weaker near the ground', () => {
    expect(windAt([10, 0], 1)[0]).toBeLessThan(windAt([10, 0], 10)[0]);
    expect(windAt([10, 0], 10)[0]).toBeCloseTo(10, 6);
  });
  it('lift grows with spin and stays bounded', () => {
    expect(aeroCoefficients(.1).cl).toBeLessThan(aeroCoefficients(.3).cl);
    expect(aeroCoefficients(5).cl).toBeLessThanOrEqual(.36);
  });
});

describe('ground', () => {
  it('a ball landing in water stays there and reports where it crossed in', () => {
    const world = flat('fairway', { surfaceAt: (x, z) => (z > 120 ? 'water' : 'fairway') });
    const shot = shoot(world, { speed: 55, launchDeg: 16, spinRpm: 6000 });
    expect(shot.outcome).toBe('water');
    expect(shot.entry[1]).toBeLessThanOrEqual(120.5);
    expect(shot.entry[1]).toBeGreaterThan(100);
  });
  it('sand stops a ball almost where it lands', () => {
    const shot = shoot(flat('sand'), { speed: 50, launchDeg: 18, spinRpm: 6500 });
    expect(shot.total - shot.carry).toBeLessThan(1.5);
  });
  it('rough holds a ball far more than fairway', () => {
    const fairway = shoot(flat('fairway'), { speed: 60, launchDeg: 12, spinRpm: 2800 });
    const rough = shoot(flat('rough'), { speed: 60, launchDeg: 12, spinRpm: 2800 });
    expect(fairway.total - fairway.carry).toBeGreaterThan(2 * (rough.total - rough.carry));
  });
  it('a ball out of bounds is reported out', () => {
    const shot = shoot(flat('fairway', { isOut: (x, z) => z > 100 }), { speed: 55, launchDeg: 16, spinRpm: 6000 });
    expect(shot.outcome).toBe('out');
  });
  it('a trunk in the way turns the ball back', () => {
    const trees = { near: () => [{ x: 0, y: 0, z: 30, height: 18, radius: 3, trunk: .35 }] };
    const shot = shoot(flat('fairway', { trees }), { speed: 40, launchDeg: 3, spinRpm: 3000 });
    expect(shot.treeHits).toBeGreaterThan(0);
    expect(shot.rest[2]).toBeLessThan(31);
  });
});

describe('putting', () => {
  it('a putt struck for d metres rolls about d metres on a flat green', () => {
    for (const d of [2, 6, 15]) {
      const shot = simulateShot(flat('green'), { start: [0, BALL.radius, 0], velocity: [0, 0, puttSpeedFor(d)], spin: [0, 0, 0], roll: true }, {});
      // Putts start rolling at once: the first contact makes it a roll.
      expect(Math.abs(shot.rest[2] - d)).toBeLessThan(d * .08 + .15);
    }
  });
  it('drops a putt at the right pace and lips out one struck far too hard', () => {
    const cup = [0, 4];
    const good = simulateShot(flat('green', { cup }), { start: [0, BALL.radius, 0], velocity: [0, 0, puttSpeedFor(4.4)], spin: [0, 0, 0], roll: true });
    expect(good.outcome).toBe('holed');
    const hard = simulateShot(flat('green', { cup }), { start: [0, BALL.radius, 0], velocity: [0, 0, puttSpeedFor(12)], spin: [0, 0, 0], roll: true });
    expect(hard.outcome).toBe('rest');
    const wide = simulateShot(flat('green', { cup }), { start: [.12, BALL.radius, 0], velocity: [0, 0, puttSpeedFor(4.4)], spin: [0, 0, 0], roll: true });
    expect(wide.outcome).toBe('rest');
  });
  it('breaks with the slope', () => {
    // The green falls toward +x: a straight putt along +z drifts to +x.
    const tilted = flat('green', { heightAt: x => -.02 * x });
    const shot = simulateShot(tilted, { start: [0, BALL.radius, 0], velocity: [0, 0, puttSpeedFor(6)], spin: [0, 0, 0], roll: true });
    expect(shot.rest[0]).toBeGreaterThan(.25);
  });
  it('the cup is a regulation 108 mm', () => {
    expect(CUP_RADIUS * 2).toBeCloseTo(.108, 3);
    expect(SURFACES.green.roll).toBeLessThan(SURFACES.fairway.roll);
  });
});
