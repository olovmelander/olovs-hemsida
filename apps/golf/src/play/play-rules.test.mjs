import { describe, it, expect } from 'vitest';
import { boundaryCrossings, outTest, dropPoint, createRound, addStroke, addPenalty, holeCard, roundTotals, nextHole, scoreName, readPlayedRounds, savePlayedRound, PLAY_KEYS } from './play-rules.mjs';
import { playBag, clubCategory, suggestClub, launchFor, puttRangeFor } from './shot-model.mjs';
import { DEFAULT_BAG } from '../engine/caddie.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

describe('out of bounds', () => {
  const fence = [[[-50, 100], [50, 100]]];
  it('a ball beyond the white stakes is out, one short of them is in', () => {
    const out = outTest({ lines: fence, from: [0, 0] });
    expect(out(0, 120)).toBe(true);
    expect(out(0, 80)).toBe(false);
  });
  it('crossing out and back in again is in', () => {
    expect(boundaryCrossings([[[-10, 10], [10, 10]], [[-10, 20], [10, 20]]], [0, 0], [0, 30])).toBe(2);
  });
  it('beyond the course ground is out even with no stakes', () => {
    expect(outTest({ lines: [], from: [0, 0], inCourse: (x, z) => z < 500 })(0, 600)).toBe(true);
  });
});

describe('penalty area relief', () => {
  it('drops within two club lengths of the entry, dry and no nearer the hole', () => {
    const cup = [0, 200], entry = [0, 120];
    const isDry = (x, z) => z < 120.5;           // the water begins at z = 120.5
    const [x, z] = dropPoint({ entry, cup, isDry });
    expect(Math.hypot(x - entry[0], z - entry[1])).toBeLessThanOrEqual(2.0001);
    expect(isDry(x, z)).toBe(true);
    expect(Math.hypot(x - cup[0], z - cup[1])).toBeGreaterThanOrEqual(80 - 1e-6);
  });
  it('goes further back when nothing near is dry', () => {
    const cup = [0, 200], entry = [0, 120];
    const isDry = (x, z) => z < 110;
    const [, z] = dropPoint({ entry, cup, isDry });
    expect(z).toBeLessThan(110);
  });
});

describe('the card', () => {
  const holes = [{ n: 1, par: 4 }, { n: 2, par: 3 }, { n: 3, par: 5 }];
  it('counts strokes, putts and penalties and names the score', () => {
    const round = createRound({ slug: 'bana', courseName: 'Banan', holes, startHole: 2, now: 1 });
    expect(round.order).toEqual([2, 3, 1]);
    addStroke(round, { club: 'iron-7' }); addStroke(round, { club: 'putter', putt: true }); addPenalty(round);
    holeCard(round, 2).holed = true;
    expect(roundTotals(round)).toMatchObject({ strokes: 3, par: 3, putts: 1, played: 1, toPar: 0 });
    expect(nextHole(round)).toBe(3);
    expect(scoreName(2, 3)).toBe('Birdie');
    expect(scoreName(1, 3)).toBe('Hole in one!');
    expect(scoreName(7, 4)).toBe('Trippelbogey');
  });
  it('keeps played rounds under their own key, apart from the map\'s rounds', () => {
    const store = memory();
    const round = createRound({ slug: 'bana', courseName: 'Banan', holes, now: 5 });
    expect(savePlayedRound(store, round)).toBe(true);
    expect(readPlayedRounds(store)).toHaveLength(1);
    expect([...store.m.keys()]).toEqual([PLAY_KEYS.rounds]);
    expect(PLAY_KEYS.rounds.startsWith('banvy-map')).toBe(false);
  });
});

describe('the bag in play', () => {
  const clubs = playBag(DEFAULT_BAG);
  it('maps every default club to a launch family, putter last', () => {
    expect(clubs.at(-1).cat).toBe('putter');
    expect(clubs[0].cat).toBe('driver');
    expect(clubs.map(c => c.cat)).toContain('iron7');
    expect(clubCategory({ id: 'club-3', name: 'Järn 6', carry: 150 })).toBe('iron6');
    expect(clubCategory({ id: 'club-9', name: 'Min klubba', carry: 95 })).toBe('gw');
  });
  it('suggests the shortest club that reaches, and the putter on the green', () => {
    expect(suggestClub(clubs, 135).carry).toBeGreaterThanOrEqual(125);
    expect(suggestClub(clubs, 135).carry).toBeLessThanOrEqual(140);
    expect(suggestClub(clubs, 8, 'green').cat).toBe('putter');
    expect(suggestClub(clubs, 400).cat).toBe('driver');
  });
  it('a straight full swing launches along the aim; an open face starts right', () => {
    const iron = clubs.find(c => c.cat === 'iron7');
    const straight = launchFor({ club: iron, power: 1, yaw: 0 });
    expect(straight.yaw).toBeCloseTo(0, 9);
    expect(straight.speed).toBeGreaterThan(40);
    const open = launchFor({ club: iron, power: 1, face: 1, yaw: 0 });
    // Facing +z, right is -x, which is a smaller yaw.
    expect(open.yaw).toBeLessThan(0);
    const rough = launchFor({ club: iron, power: 1, yaw: 0, lie: 'rough' });
    expect(rough.speed).toBeLessThan(straight.speed);
    expect(rough.spinRpm).toBeLessThan(straight.spinRpm);
  });
  it('a putt rolls on, with a meter a little longer than the putt', () => {
    const putter = clubs.at(-1);
    expect(launchFor({ club: putter, power: .5, yaw: 0, puttRange: 10 }).roll).toBe(true);
    expect(puttRangeFor(4)).toBe(5);
    expect(puttRangeFor(15)).toBe(20);
  });
});

describe('planned power', async () => {
  const { powerFor, flatShot } = await import('./shot-model.mjs');
  const clubs = playBag(DEFAULT_BAG);
  it('a lob wedge eased off sends a chip its distance, a full swing is the cap', () => {
    const lw = clubs.find(c => c.cat === 'lw');
    const p = powerFor(lw, 20);
    expect(p).toBeLessThan(.75);
    expect(Math.abs(flatShot(lw, p).total - 20)).toBeLessThan(1.5);
    expect(powerFor(lw, 500)).toBe(1);
  });
});
