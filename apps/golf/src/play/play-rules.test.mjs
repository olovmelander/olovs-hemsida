import { describe, it, expect } from 'vitest';
import { boundaryCrossings, outTest, dropPoint, createRound, addStroke, addPenalty, holeCard, roundTotals, nextHole, scoreName, holeReaction, playHoleReaction, readPlayedRounds, savePlayedRound, PLAY_KEYS } from './play-rules.mjs';
import { playBag, clubCategory, suggestClub, launchFor, puttRangeFor, setupForClub } from './shot-model.mjs';
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
  it('takes each hole with the golfer\'s reaction: birdie or better, par, double bogey or worse', () => {
    expect(holeReaction(1, 3)).toBe('Celebrate');
    expect(holeReaction(3, 5)).toBe('Celebrate');
    expect(holeReaction(3, 4)).toBe('Celebrate');
    expect(holeReaction(4, 4)).toBe('FistPump');
    expect(holeReaction(5, 4)).toBe(null);
    expect(holeReaction(6, 4)).toBe('Disappointed');
    expect(holeReaction(9, 4)).toBe('Disappointed');
    expect(holeReaction(9, 4, true)).toBe(null);
    expect(holeReaction(0, 4)).toBe(null);
    const played = [];
    const golfer = { clips: new Map([['Celebrate', {}], ['FistPump', {}], ['Disappointed', {}]]), play: (name, opts) => played.push([name, opts.fade]) };
    expect(playHoleReaction(golfer, 4, 4)).toBe('FistPump');
    expect(playHoleReaction(golfer, 5, 4)).toBe(null);
    expect(played).toEqual([['FistPump', .25]]);
    // The September golfers have only Celebrate: a par passes quietly rather than failing.
    const september = { clips: new Map([['Celebrate', {}]]), play: () => { throw new Error('no clip'); } };
    expect(playHoleReaction(september, 4, 4)).toBe(null);
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
  it('reads a club as the bag editor does: the kind chosen, then the name, then the id', () => {
    // Swedish names put the number first; a short hitter's irons are still irons
    expect(clubCategory({ id: 'custom-mh3k2x1', name: '6-järn', carry: 120 })).toBe('iron6');
    expect(clubCategory({ id: 'custom-mh3k2x2', name: '7-järn', carry: 110 })).toBe('iron7');
    expect(clubCategory({ id: 'custom-mh3k2x3', name: '7i', carry: 110 })).toBe('iron7');
    // a renamed row keeps its old id: the name wins
    expect(clubCategory({ id: 'pw', name: 'Driver', carry: 205 })).toBe('driver');
    expect(clubCategory({ id: 'gw', name: 'Järn 6', carry: 140 })).toBe('iron6');
    expect(clubCategory({ id: 'iron-5', name: 'Hybrid', carry: 170 })).toBe('hybrid');
    // the kind the player chose, and a wedge's loft
    expect(clubCategory({ id: 'custom-a', name: 'Driver 10.5°', carry: 190 })).toBe('driver');
    expect(clubCategory({ id: 'custom-b', name: 'Min långa', carry: 175, kind: 'fairway' })).toBe('wood');
    expect(clubCategory({ id: 'custom-c', name: '52°', carry: 85, kind: 'wedge' })).toBe('gw');
    expect(clubCategory({ id: 'custom-d', name: '58°', carry: 55, kind: 'wedge' })).toBe('lw');
    expect(clubCategory({ id: 'custom-e', name: 'Wedge', carry: 70 })).toBe('sw');
    // a custom id's digits are not an iron's number
    expect(clubCategory({ id: 'custom-k9x3', name: 'Järn', carry: 150 })).toBe('iron6');
  });
  it('a new club starts its full swing; the short game stays only from wedge to wedge', () => {
    const by = cat => clubs.find(c => c.cat === cat);
    const chip = { type: 'chip', shape: 0, height: 0, spin: 0 };
    expect(setupForClub(chip, by('sw'), by('pw')).type).toBe('chip');
    expect(setupForClub(chip, by('pw'), by('iron6')).type).toBe('full');
    expect(setupForClub({ ...chip, type: 'pitch' }, by('gw'), by('driver')).type).toBe('full');
    expect(setupForClub({ ...chip, type: 'bump' }, by('iron9'), by('iron7')).type).toBe('full');
    const low = { type: 'punch', shape: 1, height: -1, spin: 0 };
    expect(setupForClub(low, by('iron7'), by('iron6'))).toEqual(low);
    expect(setupForClub(low, by('iron7'), by('driver'))).toEqual({ type: 'full', shape: 1, height: -1, spin: 0 });
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
  const { powerFor, planPower, flatShot } = await import('./shot-model.mjs');
  const clubs = playBag(DEFAULT_BAG);
  const by = cat => clubs.find(c => c.cat === cat);
  it('a lob wedge eased off sends a chip its distance, a full swing is the cap', () => {
    const lw = clubs.find(c => c.cat === 'lw');
    const p = powerFor(lw, 20);
    expect(p).toBeLessThan(.75);
    expect(Math.abs(flatShot(lw, p).total - 20)).toBeLessThan(1.5);
    expect(powerFor(lw, 500)).toBe(1);
  });
  it('finds the strongest swing whose run reaches, not a soft one that skids there', () => {
    // a 6-iron to a 140 m pin, planned onto a green: it used to settle on a 42% swing
    // that landed 36 m out and was meant to run the other 104
    const iron = by('iron6');
    const p = powerFor(iron, 140, 'fairway', undefined, null, 'green');
    expect(p).toBeGreaterThan(.75);
    expect(flatShot(iron, p, 'fairway', undefined, null, 'green').carry).toBeGreaterThan(110);
  });
  it('every club and shot type stops at the target, on the hole\'s shape round a green', async () => {
    const { shotTypesFor } = await import('./shot-model.mjs');
    const playing = clubs.filter(c => c.cat !== 'putter');
    for (const landOn of ['fairway', 'green']) {
      for (const type of ['full', 'punch', 'pitch', 'chip', 'flop', 'bump']) {
        const setup = { type, shape: 0, height: 0, spin: 0 };
        // every 40 m: each pin's hole shape is a set of simulations of its own (CI is slower)
        for (let pin = 20; pin <= 240; pin += 40) {
          for (const c of playing.filter(club => shotTypesFor(club).includes(type))) {
            const full = flatShot(c, 1, 'fairway', setup, null, landOn, pin);
            if (full.total < pin) continue;
            const p = planPower(c, pin, 'fairway', setup, null, landOn);
            if (p <= .05) continue;                    // even the softest swing runs past: a wood by a green
            const s = flatShot(c, p, 'fairway', setup, null, landOn, pin);
            // within the pad's own step: a whole percent moves a softly swung wood 3-4 m
            expect(Math.abs(s.total - pin), `${landOn} ${type} ${c.name} ${pin} m`).toBeLessThanOrEqual(Math.max(4, pin * .04));
            expect(s.carry, `${landOn} ${type} ${c.name} ${pin} m`).toBeLessThanOrEqual(pin + 1);
          }
        }
      }
    }
  }, 30000);
  it('a softer swing lands shorter and runs up, rather than running past', () => {
    // at a 100 m pin on a green: the near-full 8-iron flies further than the soft 7-iron,
    // which flies further than the softer 6-iron, and all three stop at the pin
    const land = cat => {
      const c = by(cat), p = planPower(c, 100, 'fairway', undefined, null, 'green');
      return flatShot(c, p, 'fairway', undefined, null, 'green', 100);
    };
    const [six, seven, eight] = ['iron6', 'iron7', 'iron8'].map(land);
    expect(six.carry).toBeLessThan(seven.carry);
    expect(seven.carry).toBeLessThan(eight.carry);
    for (const s of [six, seven, eight]) expect(Math.abs(s.total - 100)).toBeLessThan(3);
    expect(six.carry).toBeGreaterThan(50);                // short of the pin, not absurdly so
  });
  it('plans the short game by its whole run', () => {
    const pw = by('pw'), chip = { type: 'chip', shape: 0, height: 0, spin: 0 };
    expect(planPower(pw, 25, 'fairway', chip)).toBe(powerFor(pw, 25, 'fairway', chip));
    expect(planPower(by('putter'), 5)).toBeNull();
  });
});
