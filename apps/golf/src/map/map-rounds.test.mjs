/* The rounds a player keeps, and what they add up to. */
import { describe, expect, it } from 'vitest';
import { courseLength, holeHistory, holesScored, isRoundComplete, keepRound, parseRounds, roundRecord, roundSummary, roundText, roundTrend, storeRounds } from './map-rounds.mjs';
import { closeHole, lockShot } from './map-shots.mjs';

const holes = [{ n: 1, par: 4, index: 1 }, { n: 2, par: 3, index: 3 }, { n: 3, par: 5, index: 2 }];
const course = { slug: 'bana', name: 'Banan', holes };
const round = (scores, extra = {}) => ({ version: 1, id: 7, startedAt: '2026-11-05', handicap: 18, scores, ...extra });
const seven = { id: 'iron-7', carry: 140 }, driver = { id: 'driver', carry: 210 };
const lock = (shots, club, point, hole = 1, roundId = 7) => lockShot(shots, { hole, club, point, accuracy: 5, at: 1000, meta: { course: 'bana', round: roundId } });

describe('a round kept', () => {
  it('keeps only the holes that have a score, with each par', () => {
    const record = roundRecord(round({ 1: { strokes: 5, putts: 2, fairway: 'hit' }, 2: { picked: true } }), course, { tee: 'Gul', at: 9 });
    expect(record.holes).toEqual([
      { n: 1, par: 4, strokes: 5, putts: 2, fairway: 'hit', picked: false },
      { n: 2, par: 3, strokes: null, putts: null, fairway: null, picked: true },
    ]);
    expect(record).toMatchObject({ id: 7, course: 'bana', courseName: 'Banan', date: '2026-11-05', endedAt: 9, tee: 'Gul', holeCount: 3 });
    expect(record.totals.strokes).toBe(5);
  });

  it('tells a card finished from one under way', () => {
    expect(holesScored(round({ 1: { strokes: 4 } }), holes)).toBe(1);
    expect(isRoundComplete(round({ 1: { strokes: 4 }, 2: { picked: true } }), holes)).toBe(false);
    expect(isRoundComplete(round({ 1: { strokes: 4 }, 2: { picked: true }, 3: { strokes: 5 } }), holes)).toBe(true);
    expect(isRoundComplete(round({}), [])).toBe(false);
  });

  it('replaces the same round where it stands, and keeps two courses apart', () => {
    const first = { id: 7, course: 'bana', totals: 1 }, other = { id: 7, course: 'annan', totals: 2 };
    const list = keepRound(keepRound([], first), other);
    expect(list.length).toBe(2);
    const next = keepRound(list, { ...first, totals: 3 });
    expect(next.map(each => each.totals)).toEqual([3, 2]);
  });

  it('survives a damaged store and keeps the newest rounds', () => {
    expect(parseRounds('{')).toEqual([]);
    expect(parseRounds(null)).toEqual([]);
    expect(parseRounds(JSON.stringify({ version: 99, rounds: [1] }))).toEqual([]);
    const many = Array.from({ length: 310 }, (_, id) => ({ id }));
    const stored = parseRounds(storeRounds(many));
    expect(stored.length).toBe(300);
    expect(stored[0].id).toBe(10);
  });

  it('reads the course length from the tee, with a short hole falling back', () => {
    const lengths = [{ tees: [{ metres: 300 }, { metres: 280 }], lengths: [300] }, { tees: [{ metres: 150 }], lengths: [150] }];
    expect(courseLength(lengths, 1)).toBe(430);
  });
});

describe('the summary', () => {
  const record = roundRecord(round({ 1: { strokes: 3, putts: 1, fairway: 'hit' }, 2: { strokes: 5, putts: 3 }, 3: { strokes: 5 } }), course);

  it('counts the card by kind, and only what happened', () => {
    const { kinds, missing, played, bestHole } = roundSummary(record);
    expect(kinds.map(kind => [kind.key, kind.count])).toEqual([['birdie', 1], ['par', 1], ['double', 1]]);
    expect(missing).toBe(0);
    expect(played).toBe(3);
    expect(bestHole).toEqual({ n: 1, name: 'Birdie' });
  });

  it('says how many holes are missing', () => {
    const short = roundRecord(round({ 1: { strokes: 4 } }), course);
    expect(roundSummary(short)).toMatchObject({ played: 1, of: 3, missing: 2, bestHole: null });
  });

  it('takes clubs and the longest shot from this round alone', () => {
    let shots = lock([], driver, [0, 0]);
    shots = lock(shots, seven, [0, 230]);
    shots = lock(shots, seven, [0, 370]);
    shots = lock(closeHole(shots, 1), seven, [500, 0], 1, 8);
    const summary = roundSummary(record, shots);
    expect(summary.longest).toEqual({ club: 'driver', metres: 230, hole: 1 });
    expect(summary.clubs.map(each => each.club)).toEqual(['driver', 'iron-7']);
    expect(summary.logged).toBe(3);
  });

  it('adds the penalties up', () => {
    const shots = [{ ...lock([], seven, [0, 0])[0], penalty: 2 }];
    expect(roundSummary(record, shots).penalties).toBe(2);
  });

  it('writes the round for a message', () => {
    const text = roundText(record, roundSummary(record));
    expect(text).toContain('Banan, 2026-11-05');
    expect(text).toContain('13 slag (+1)');
    expect(text).toContain('3 5 5');
  });
});

describe('a hole over time', () => {
  const kept = (id, strokes, fairway, putts = 2) => ({ id, course: 'bana', holes: [{ n: 1, par: 4, strokes, putts, fairway, picked: false }] });

  it('needs two rounds', () => {
    expect(holeHistory([kept(1, 4, 'hit')], [], 'bana', 1)).toBeNull();
    expect(holeHistory([kept(1, 4, 'hit'), kept(2, 5, 'left')], [], 'annan', 1)).toBeNull();
  });

  it('averages the scores and finds the usual miss', () => {
    const history = holeHistory([kept(1, 4, 'hit'), kept(2, 5, 'right'), kept(3, 6, 'right')], [], 'bana', 1);
    expect(history).toMatchObject({ rounds: 3, average: 5, toPar: 1, best: 4, putts: 2 });
    expect(history.fairway).toEqual({ hit: 1, of: 3, miss: 'höger' });
  });

  it('leaves the miss out when it does not lean, and a struck hole out of the score', () => {
    const struck = { id: 9, course: 'bana', holes: [{ n: 1, par: 4, strokes: null, putts: null, fairway: null, picked: true }] };
    const history = holeHistory([kept(1, 4, 'left'), kept(2, 6, 'right'), struck], [], 'bana', 1);
    expect(history.rounds).toBe(2);
    expect(history.fairway.miss).toBeNull();
  });

  it('names the usual tee club and its length, and counts penalties, from rounds kept', () => {
    const play = (shots, id, length) => lock(lock(shots, driver, [0, 0], 1, id), seven, [0, length], 1, id);
    let shots = play([], 1, 200);
    shots = play(shots, 2, 220);
    shots = play(shots, 3, 240);
    shots = shots.map((shot, k) => (k === 0 ? { ...shot, penalty: 1 } : shot));
    const history = holeHistory([kept(1, 4, 'hit'), kept(2, 5, 'hit'), kept(3, 4, 'hit')], shots, 'bana', 1);
    expect(history).toMatchObject({ teeClub: 'driver', teeLength: 220, penalties: 1 });
  });
});

describe('rounds over time', () => {
  const kept = (id, toPar, played = 18) => ({ id, totals: { strokes: played * 4 + toPar, toPar, played, putts: played * 2, fairways: 7, fairwaysTried: 14, greens: 6, greensTried: played } });

  it('has nothing to say with nothing played', () => {
    expect(roundTrend([])).toBeNull();
    expect(roundTrend([{ id: 1, totals: { strokes: 0, toPar: 0, played: 0 } }])).toBeNull();
  });

  it('sets the newest rounds against the ones before', () => {
    const rounds = [20, 18, 16, 14, 12, 10, 8].map((toPar, id) => kept(id, toPar));
    const trend = roundTrend(rounds);
    expect(trend.recent).toMatchObject({ rounds: 5, toPar: 12 });
    expect(trend.before).toMatchObject({ rounds: 2, toPar: 19 });
    expect(trend.recent.greens).toBeCloseTo(6 / 18);
    expect(trend.recent.putts).toBeCloseTo(2);
  });

  it('scales a nine to eighteen, so they compare', () => {
    expect(roundTrend([kept(1, 6, 9)]).line[0].toPar).toBe(12);
  });
});
