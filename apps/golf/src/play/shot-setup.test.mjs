import { describe, it, expect } from 'vitest';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { launchState, simulateShot, BALL, seeded } from './ball-physics.mjs';
import {
  playBag, launchFor, flatShot, shotTypesFor, swingFor, fitSetup, lieQuality, slopeLie, slopeWords, suggestShot, puttPlaysLike, STOCK_SETUP,
} from './shot-model.mjs';
import { tempoOf, dragSwing, stickSwing } from './swing-input.mjs';
import { deadZone, readPad } from './gamepad-input.mjs';
import { flyoverPose, flyoverSeconds } from './flyover.mjs';
import { greenArrows, slopeColour } from './green-read.mjs';

const clubs = playBag(DEFAULT_BAG);
const byCat = cat => clubs.find(c => c.cat === cat);
const flat = (surface = 'fairway') => ({ heightAt: () => 0, surfaceAt: () => surface, cup: null });
const fly = L => {
  const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: L.yaw, spinRpm: L.spinRpm, axisDeg: L.axisDeg });
  return simulateShot(flat(), { start: [0, BALL.radius, 0], velocity, spin });
};

describe('the swing\'s tempo', () => {
  it('a 3:1 swing is pure; a dawdling downswing is short and open; a snatched one closes the face', () => {
    const pure = tempoOf({ back: .9, down: .3, power: 1 });
    expect(pure.grade).toBe('perfect');
    expect(pure.errorMul).toBeLessThan(1);
    const slow = tempoOf({ back: .8, down: .6, power: 1 });
    expect(slow.grade).toBe('slow');
    expect(slow.powerMul).toBeLessThan(.95);
    expect(slow.faceAdd).toBeGreaterThan(0);
    const fast = tempoOf({ back: 1.6, down: .2, power: 1 });
    expect(fast.grade).toBe('fast');
    expect(fast.faceAdd).toBeLessThan(0);
    expect(tempoOf({}).grade).toBe('none');
  });
  it('a hurried backswing spreads the miss whatever the ratio', () => {
    const rushed = tempoOf({ back: .3, down: .1, power: 1 });
    expect(rushed.label).toBe('Stressad baksving');
    expect(rushed.errorMul).toBeGreaterThan(tempoOf({ back: .9, down: .3, power: 1 }).errorMul);
  });
  it('the drag is timed from touch to the top and from the top to the strike', () => {
    const drag = dragSwing({ height: 200, width: 400 });
    drag.down(100, 100, 0);
    for (let i = 1; i <= 10; i++) drag.move(100, 100 + i * 20, i * .09);   // 0.9 s back to the top
    let out = drag.move(100, 280, .95);
    expect(drag.state).toBe('down');
    out = drag.move(100, 99, 1.2);                                          // 0.3 s down
    expect(out.phase).toBe('strike');
    expect(out.power).toBeCloseTo(1, 5);
    expect(out.tempo.grade).toBe('perfect');
    expect(out.tempo.ratio).toBeCloseTo(3, 1);
  });
  it('a controller\'s stick swings: back, through, struck; let go in the middle and it cancels', () => {
    const stick = stickSwing();
    let t = 0, out = null;
    for (let i = 0; i <= 9; i++) out = stick.feed(0, .1 * i + .1, t += .09);
    out = stick.feed(0, .5, t += .05);
    expect(stick.state).toBe('down');
    out = stick.feed(.05, -.8, t += .16);     // back 0.63 s (from past the dead zone), down 0.21 s
    expect(out.phase).toBe('strike');
    expect(out.power).toBeGreaterThan(.9);
    expect(['perfect', 'good']).toContain(out.tempo.grade);
    const loose = stickSwing();
    loose.feed(0, .9, 0); loose.feed(0, .3, .5);
    loose.feed(0, 0, .6); out = loose.feed(0, 0, 1);
    expect(out.phase).toBe('cancel');
  });
});

describe('the shot\'s setup', () => {
  it('offers the short game to wedges, the bump to short irons and only the full swing to the driver', () => {
    expect(shotTypesFor(byCat('driver'))).toEqual(['full']);
    expect(shotTypesFor(byCat('iron7'))).toContain('bump');
    expect(shotTypesFor(byCat('sw'))).toContain('flop');
    expect(shotTypesFor(byCat('pw'))).not.toContain('flop');
    expect(fitSetup(byCat('driver'), { type: 'chip', shape: 5, height: -3, spin: 1 })).toEqual({ type: 'full', shape: 2, height: -1, spin: 1 });
    expect(fitSetup(byCat('sw'), { type: 'chip', shape: 2 }).shape).toBe(0);
  });
  it('plays a chip with the short-game swing and a full wedge with the iron swing', () => {
    expect(swingFor(byCat('sw'), 'chip')).toBe('Wedge');
    expect(swingFor(byCat('sw'), 'full')).toBe('Iron');
    expect(swingFor(byCat('driver'), 'full')).toBe('Driver');
    expect(swingFor(clubs.at(-1))).toBe('Putter');
  });
  it('a shaped shot starts away from the aim and lands on it', () => {
    const driver = byCat('driver');
    for (const shape of [-2, -1, 1, 2]) {
      const L = launchFor({ club: driver, power: 1, yaw: 0, setup: { ...STOCK_SETUP, shape } });
      // A draw (negative) starts right of the aim (smaller yaw facing +z) and bends back.
      expect(Math.sign(L.yaw)).toBe(shape < 0 ? -1 : 1);
      const shot = fly(L);
      expect(Math.abs(shot.landing[0])).toBeLessThan(.6);
    }
  });
  it('a low shot flies lower and a high one higher; a punch runs further than it carries', () => {
    const iron = byCat('iron7');
    const apex = height => fly(launchFor({ club: iron, power: 1, yaw: 0, setup: { ...STOCK_SETUP, height } })).apex;
    expect(apex(-1)).toBeLessThan(apex(0));
    expect(apex(1)).toBeGreaterThan(apex(0));
    const punch = flatShot(iron, 1, 'fairway', { type: 'punch' });
    expect(punch.carry).toBeLessThan(flatShot(iron, 1).carry * .9);
    expect(punch.total - punch.carry).toBeGreaterThan(15);
  });
  it('a chip goes short and rolls; a flop barely rolls at all', () => {
    const chip = flatShot(byCat('pw'), 1, 'fairway', { type: 'chip' });
    expect(chip.total).toBeLessThan(40);
    expect(chip.total).toBeGreaterThan(chip.carry * 1.8);
    const flop = flatShot(byCat('lw'), 1, 'fairway', { type: 'flop' });
    expect(flop.total - flop.carry).toBeLessThan(2);
  });
  it('the caddie hands over a chip by the green, a pitch a little out and a full iron from the fairway', () => {
    expect(suggestShot(clubs, 12, 'fairway').type).toBe('chip');
    expect(suggestShot(clubs, 60, 'fairway').type).toBe('pitch');
    const approach = suggestShot(clubs, 140, 'fairway');
    expect(approach.type).toBe('full');
    expect(suggestShot(clubs, 6, 'green').club.cat).toBe('putter');
  });
});

describe('the lie', () => {
  it('reads a lie % that is the same for the same stroke', () => {
    expect(lieQuality('fairway').pct).toBe(100);
    const a = lieQuality('rough', seeded(42)), b = lieQuality('rough', seeded(42));
    expect(a).toEqual(b);
    const rand = seed => { const r = seeded(seed); r(); return r; };
    const pcts = new Set(Array.from({ length: 60 }, (_, i) => lieQuality('rough', rand(i * 104729 + 12345)).pct));
    expect(pcts.size).toBeGreaterThan(1);
    for (const p of pcts) { expect(p).toBeGreaterThan(70); expect(p).toBeLessThan(96); }
  });
  it('a plugged ball in sand comes out slow and spinless', () => {
    const plugged = lieQuality('sand', () => .9, { plugged: true });
    expect(plugged.label).toBe('Pluggad');
    expect(plugged.pct).toBeLessThan(60);
    const sw = byCat('sw');
    const clean = launchFor({ club: sw, power: 1, yaw: 0, lie: 'sand' });
    const buried = launchFor({ club: sw, power: 1, yaw: 0, lie: 'sand', quality: plugged });
    expect(buried.speed).toBeLessThan(clean.speed * .8);
    expect(buried.spinRpm).toBeLessThan(clean.spinRpm * .5);
  });
  it('reads uphill and a ball above the feet from the ground, and plays them', () => {
    // Ground rising toward +z (the aim at yaw 0) and toward +x (the golfer's left, facing +z).
    const up = slopeLie((x, z) => z * .1, 0, 0, 0);
    expect(up.up).toBeGreaterThan(5);
    expect(Math.abs(up.side)).toBeLessThan(.1);
    // Lower on the golfer's side (+x is left, facing +z): the ball sits above the feet.
    const above = slopeLie(x => -x * .1, 0, 0, 0);
    expect(above.side).toBeGreaterThan(5);
    expect(slopeWords(above)).toContain('över fötterna');
    const iron = byCat('iron7');
    const level = launchFor({ club: iron, power: 1, yaw: 0 });
    expect(launchFor({ club: iron, power: 1, yaw: 0, slope: { up: 6, side: 0 } }).launchDeg).toBeGreaterThan(level.launchDeg + 4);
    // Above the feet: starts left (a larger yaw facing +z) and hooks (a negative axis).
    const hook = launchFor({ club: iron, power: 1, yaw: 0, slope: { up: 0, side: 8 } });
    expect(hook.yaw).toBeGreaterThan(0);
    expect(hook.axisDeg).toBeLessThan(0);
  });
  it('an uphill putt plays longer, a downhill one shorter', () => {
    expect(puttPlaysLike(5, .1)).toBeGreaterThan(6);
    expect(puttPlaysLike(5, -.1)).toBeLessThan(4);
  });
});

describe('a game controller', () => {
  it('has a dead zone and reports a press once', () => {
    expect(deadZone(.1)).toBe(0);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-.58)).toBeCloseTo(-.5, 5);
    const pad = held => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })), axes: [0, 0, 0, .9] });
    const first = readPad(pad([0, 5]));
    expect([...first.pressed].sort()).toEqual(['a', 'rb']);
    const again = readPad(pad([0, 5]), first.held);
    expect(again.pressed.size).toBe(0);
    expect(again.ry).toBeCloseTo(.9, 5);
    expect(readPad(null).connected).toBe(false);
  });
});

describe('the hole\'s flyover', () => {
  const line = [[0, 0], [0, 200], [60, 380]], pin = [60, 380, 4];
  const ground = (x, z) => z * .02;
  it('starts behind the tee, stays above the ground and ends looking at the pin', () => {
    const start = flyoverPose(line, pin, 0, ground), end = flyoverPose(line, pin, 1, ground);
    expect(start.eye[2]).toBeLessThan(0);
    for (const u of [0, .25, .5, .75, 1]) {
      const { eye } = flyoverPose(line, pin, u, ground);
      expect(eye[1]).toBeGreaterThan(ground(eye[0], eye[2]) + 5);
    }
    expect(end.look[0]).toBeCloseTo(60, 5);
    expect(end.look[2]).toBeCloseTo(380, 5);
    expect(flyoverSeconds(400)).toBeLessThanOrEqual(9);
  });
});

describe('the green\'s read', () => {
  it('points every arrow downhill and colours steeper ground warmer', () => {
    // A green falling toward -x at 2%.
    const arrows = greenArrows({ heightAt: x => x * .02, isGreen: () => true, from: [0, 0], to: [6, 0], margin: 2 });
    expect(arrows.length).toBeGreaterThan(20);
    for (const a of arrows) { expect(a.dx).toBeCloseTo(-1, 5); expect(a.slope).toBeCloseTo(.02, 5); }
    expect(greenArrows({ heightAt: () => 0, isGreen: () => true, from: [0, 0], to: [4, 0] })).toHaveLength(0);
    expect(slopeColour(.05)[2]).toBeLessThan(slopeColour(.002)[2]);
  });
});
