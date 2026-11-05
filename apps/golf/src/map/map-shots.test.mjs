/* The shot log: two fixes and a club make a shot, and the awkward cases stay honest. */
import { describe, expect, it } from 'vitest';
import {
  addPenalty, changeClub, closeHole, clubStats, correctClub, holeTally, isPutter, learnedBag, lockShot, openShot, parseHistory, reachOf, retakeShot, setPutts, shotLength, storeHistory, surfaceAt,
} from './map-shots.mjs';

const seven = { id: 'iron-7', carry: 140 }, driver = { id: 'driver', carry: 210 }, putter = { id: 'putter', carry: 0 };
const lock = (shots, club, point, extra = {}) => lockShot(shots, { hole: 1, club, point, accuracy: 5, at: 1000, ...extra });

describe('a shot', () => {
  it('starts at one lock and ends at the next', () => {
    const first = lock([], driver, [0, 0]);
    expect(openShot(first).club).toBe('driver');
    const second = lock(first, seven, [0, 220]);
    expect(second.length).toBe(2);
    expect(second[0].outcome).toBe('played');
    expect(shotLength(second[0])).toBe(220);
    expect(openShot(second).club).toBe('iron-7');
  });

  it('keeps out of the lengths a shot too long for its club: a lock was missed', () => {
    const list = lock(lock([], driver, [0, 0]), seven, [0, 400], { farthest: 300 });
    expect(list[0].suspect).toBe(true);
    expect(holeTally(list, 1).strokes).toBe(2);
    expect(clubStats(list).size).toBe(0);
  });

  it('knows a putter by what it does, whatever a bag calls it', () => {
    const own = { id: 'my-blade', carry: 0 };
    expect(isPutter(own)).toBe(true);
    const list = setPutts(lock(lock([], seven, [0, 0]), own, [0, 150]), 1, 2);
    expect(holeTally(list, 1)).toMatchObject({ strokes: 3, putts: 2 });
    expect(clubStats(list).get('my-blade')).toBeUndefined();
  });

  it('puts a club right afterwards: the length stands and is the new club\'s', () => {
    const list = lock(lock([], seven, [0, 0]), seven, [0, 150]);
    const fixed = correctClub(list, list[0], driver);
    expect(fixed[0].club).toBe('driver');
    expect(shotLength(fixed[0])).toBe(150);
    expect(fixed[1]).toBe(list[1]);
    expect(list[0].club).toBe('iron-7');
  });

  it('asks again whether a lock was missed, against the right club', () => {
    const list = lock(lock([], seven, [0, 0]), seven, [0, 260], { farthest: reachOf(seven) });
    expect(list[0].suspect).toBe(true);
    const fixed = correctClub(list, list[0], driver);
    expect(fixed[0].suspect).toBe(false);
    expect(clubStats(fixed).get('driver').shots).toBe(1);
    expect(correctClub(fixed, fixed[0], seven)[0].suspect).toBe(true);
  });

  it('puts right a shot still under way, and one played again, without a verdict on either', () => {
    const open = lock([], seven, [0, 0]);
    expect(correctClub(open, open[0], driver)[0]).toMatchObject({ club: 'driver', outcome: 'open' });
    expect(correctClub(open, open[0], driver)[0].suspect).toBeUndefined();
    const out = retakeShot(open, { club: seven, at: 2000 });
    expect(correctClub(out, out[0], driver).map(shot => shot.club)).toEqual(['driver', 'iron-7']);
  });

  it('leaves putts, the putter and a shot from another list alone', () => {
    const list = lock(lock([], seven, [0, 0]), putter, [0, 150]);
    expect(correctClub(list, list[1], driver)).toBe(list);
    expect(correctClub(list, list[0], putter)).toBe(list);
    expect(correctClub(list, { ...list[0] }, driver)).toBe(list);
  });

  it('takes a change of mind before the swing without a new stroke', () => {
    const list = changeClub(lock([], seven, [0, 0]), driver);
    expect(list.length).toBe(1);
    expect(list[0].club).toBe('driver');
  });
});

describe('the awkward shots', () => {
  it('counts out of bounds as stroke and distance, and leaves it out of the lengths', () => {
    const list = retakeShot(lock([], driver, [0, 0]), { club: driver, at: 2000 });
    expect(list.length).toBe(2);
    expect(list[0].outcome).toBe('out');
    expect(holeTally(list, 1).strokes).toBe(3);
    expect(list[1].from).toEqual([0, 0]);
    const played = lock(list, seven, [0, 200]);
    expect(clubStats(played).get('driver').shots).toBe(1);
    expect(openShot(list).outcome).toBe('open');
  });

  it('puts a penalty on the shot that went in, and keeps that shot out of the lengths', () => {
    const list = addPenalty(lock(lock([], seven, [0, 0]), seven, [0, 90]));
    expect(holeTally(list, 1).penalties).toBe(1);
    expect(holeTally(list, 1).strokes).toBe(3);
    expect(clubStats(list).get('iron-7')).toBeUndefined();
  });

  it('counts putts as strokes and never as lengths', () => {
    let list = lock([], seven, [0, 0]);
    list = lock(list, putter, [0, 150]);
    list = lock(list, putter, [0, 152]);
    list = closeHole(list, 1);
    expect(holeTally(list, 1)).toMatchObject({ strokes: 3, putts: 2 });
    expect(clubStats(list).get('putter')).toBeUndefined();
    expect(clubStats(list).get('iron-7').typical).toBe(150);
  });

  it('takes a count of putts in place of walking each one', () => {
    let list = lock(lock([], seven, [0, 0]), putter, [0, 150]);
    list = setPutts(list, 1, 3);
    expect(holeTally(list, 1)).toMatchObject({ strokes: 4, putts: 3 });
    expect(openShot(list)).toBeNull();
    expect(holeTally(setPutts(list, 1, 1), 1)).toMatchObject({ strokes: 2, putts: 1 });
    expect(setPutts(lock([], seven, [0, 0]), 1, 2).length).toBe(1);
  });

  it('counts a last shot with no end as a stroke with no length', () => {
    const list = closeHole(lock([], seven, [0, 0]), 1);
    expect(list[0].outcome).toBe('ended');
    expect(holeTally(list, 1).strokes).toBe(1);
    expect(clubStats(list).size).toBe(0);
    expect(openShot(list)).toBeNull();
  });

  it('counts a stroke on a loose fix, without trusting its length', () => {
    const list = lock(lock([], seven, [0, 0], { accuracy: 30 }), seven, [0, 150]);
    expect(holeTally(list, 1).strokes).toBe(2);
    expect(clubStats(list).size).toBe(0);
  });

  it('keeps each hole\'s tally to itself', () => {
    const list = lock(closeHole(lock([], seven, [0, 0]), 1), driver, [500, 0], { hole: 2 });
    expect(holeTally(list, 1).strokes).toBe(1);
    expect(holeTally(list, 2).strokes).toBe(1);
  });
});

describe('a club\'s length', () => {
  /* Each on its own hole, so the walk to the next one is not a shot. */
  const strike = (club, lengths) => lengths.reduce((list, length, k) => {
    const start = lock(list, club, [k * 1000, 0], { hole: k + 1 });
    return closeHole(lock(start, club, [k * 1000, length], { hole: k + 1 }), k + 1);
  }, []);

  it('stands up to chips and tops', () => {
    const { typical, known, shots } = clubStats(strike(seven, [142, 138, 145, 40, 60, 140, 136, 20, 141])).get('iron-7');
    expect(shots).toBe(9);
    expect(typical).toBeGreaterThanOrEqual(138);
    expect(typical).toBeLessThanOrEqual(142);
    expect(known).toBe(true);
  });

  it('says nothing for the bag until enough shots are in', () => {
    const few = clubStats(strike(seven, [150, 152, 148]));
    expect(few.get('iron-7').known).toBe(false);
    expect(learnedBag([seven], few)[0].carry).toBe(140);
    const many = clubStats(strike(seven, [150, 152, 148, 151, 149, 150]));
    expect(learnedBag([seven], many)[0]).toMatchObject({ learned: true });
    expect(learnedBag([seven], many)[0].carry).toBeGreaterThanOrEqual(149);
  });

  it('leaves the putter out of the bag\'s lengths', () => {
    expect(isPutter(putter)).toBe(true);
    expect(learnedBag([putter], new Map([['putter', { known: true, typical: 12 }]]))[0].carry).toBe(0);
  });
});

describe('where a ball lies', () => {
  const square = (x, z, half) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
  const hole = { green: { ring: square(0, 0, 10) }, bunkers: [square(30, 0, 5)], teePads: [square(0, 300, 5)], fairways: [square(0, 150, 100)] };

  it('takes the tightest surface first', () => {
    expect(surfaceAt([0, 0], hole)).toBe('green');
    expect(surfaceAt([30, 0], hole)).toBe('bunker');
    expect(surfaceAt([0, 300], hole)).toBe('tee');
    expect(surfaceAt([0, 150], hole)).toBe('fairway');
    expect(surfaceAt([500, 500], hole)).toBe('rough');
    expect(surfaceAt([500, 500], hole, [{ ring: square(500, 500, 40) }])).toBe('water');
  });
});

describe('the history', () => {
  it('comes back as it went in, and survives damage', () => {
    const list = lock([], seven, [0, 0]);
    expect(parseHistory(storeHistory(list))).toEqual(list);
    expect(parseHistory('nonsense')).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{"version":99,"shots":[1]}')).toEqual([]);
  });
});
