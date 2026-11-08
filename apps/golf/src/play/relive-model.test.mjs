import { describe, it, expect } from 'vitest';
import { holeStrokes, reliveRound, recordedRounds, MAP_ROUNDS_KEY, MAP_SHOTS_KEY } from './relive-model.mjs';

const memory = data => ({ getItem: k => data[k] ?? null });
const id = p => p.slice();
const shot = (hole, club, from, to, extra = {}) => ({ course: 'bana', round: 7, hole, club, at: hole * 1000, from, to, fromLie: 'fairway', toLie: 'fairway', outcome: 'played', penalty: 0, ...extra });

describe('a recorded hole', () => {
  it('plays its measured shots from where each was locked to where the next began', () => {
    const shots = [shot(1, 'driver', [0, 0], null), shot(1, 'iron-7', [0, 200], [0, 340]),
      shot(1, 'putter', [0, 340], null, { putt: true }), shot(1, 'putter', [0, 340], null, { putt: true })];
    const strokes = holeStrokes(shots, id, [0, 348]);
    expect(strokes.map(s => s.club)).toEqual(['driver', 'iron-7', 'putter', 'putter']);
    expect(strokes[0].to).toEqual([0, 200]);
    expect(strokes[0].measured).toBe(true);
    expect(strokes[1].to).toEqual([0, 340]);
    // Two counted putts: the first lags short, the second goes in.
    expect(strokes[2].counted).toBe(true);
    expect(strokes[2].to[1]).toBeGreaterThan(340);
    expect(strokes[2].to[1]).toBeLessThan(348);
    expect(strokes[3].to).toEqual([0, 348]);
    expect(strokes[3].holed).toBe(true);
  });
  it('a hole with no putts counted finishes on its last shot', () => {
    const strokes = holeStrokes([shot(2, 'driver', [0, 0], [0, 150]), shot(2, 'pw', [0, 150], null)], id, [0, 250]);
    expect(strokes.at(-1).to).toEqual([0, 250]);
    expect(strokes.at(-1).holed).toBe(true);
  });
  it('keeps out of bounds and penalty areas', () => {
    const strokes = holeStrokes([shot(3, 'driver', [0, 0], [80, 120], { outcome: 'out', penalty: 1 }), shot(3, 'driver', [0, 0], [0, 210])], id, [0, 300]);
    expect(strokes[0].outcome).toBe('out');
    expect(strokes[0].penalty).toBe(1);
    expect(strokes[1].from).toEqual([0, 0]);
  });
  it('carries every position through the frame conversion', () => {
    const shift = ([x, z]) => [x + 1000, z - 50];
    const strokes = holeStrokes([shot(4, 'driver', [0, 0], [0, 200])], shift, [1000, 250]);
    expect(strokes[0].from).toEqual([1000, -50]);
    expect(strokes[0].to).toEqual([1000, 150]);
  });
});

describe('a recorded round', () => {
  const rounds = { version: 1, rounds: [{ id: 7, course: 'bana', courseName: 'Banan', date: '2026-11-05', endedAt: 9, tee: 'Gul',
    holes: [{ n: 2, par: 3, strokes: 3, putts: 1 }, { n: 1, par: 4, strokes: 4, putts: 2 }] }, { id: 8, course: 'annan', holes: [] }] };
  const shots = { version: 1, shots: [shot(2, 'iron-7', [0, 0], [0, 140]), shot(2, 'putter', [0, 140], null, { putt: true, at: 2100 }),
    shot(1, 'driver', [5, 5], [5, 200], { at: 500 })] };
  const storage = memory({ [MAP_ROUNDS_KEY]: JSON.stringify(rounds), [MAP_SHOTS_KEY]: JSON.stringify(shots) });
  it('reads the round and puts its holes in the order they were played', () => {
    const round = reliveRound(storage, 'bana', '7', { toCourse: id, cupOf: () => [0, 145] });
    expect(round.courseName).toBe('Banan');
    expect(round.holes.map(h => h.n)).toEqual([1, 2]);
    expect(round.holes[1].plays).toHaveLength(2);
  });
  it('lists only the course\'s rounds, with how many shots have positions', () => {
    const list = recordedRounds(storage, 'bana');
    expect(list).toHaveLength(1);
    expect(list[0].located).toBe(3);
    expect(reliveRound(storage, 'bana', 99, { toCourse: id, cupOf: () => [0, 0] })).toBeNull();
  });
});

describe('an example round', async () => {
  const { exampleHoleShots, exampleRound, projectOnLine } = await import('./relive-model.mjs');
  const { exampleData } = await import('../shell/stats-model.mjs');
  const { parseBag } = await import('../engine/caddie.js');
  // A straight 400 m hole up +z, with two tees.
  const hole = { par: 4, line: [[0, 0], [0, 200], [0, 400]], pin: [0, 400], tees: { marks: [{ c: [0, 0] }, { c: [0, 30] }] } };
  it('starts on the real tee, follows the hole and finishes near the pin as the putts say', () => {
    const shots = exampleHoleShots({ card: { n: 1, par: 4, strokes: 4, putts: 2, fairway: 'hit' },
      lengths: [{ club: 'driver', metres: 215 }, { club: 'iron-8', metres: 125 }], hole, tee: 1, seed: 9 });
    expect(shots).toHaveLength(4);
    expect(shots[0].from).toEqual([0, 30]);
    expect(Math.abs(shots[0].to[0])).toBeLessThan(5);                 // fairway hit: near the line
    expect(projectOnLine(hole.line, shots[0].to)).toBeGreaterThan(150);
    const leave = Math.hypot(shots[1].to[0] - 0, shots[1].to[1] - 400);
    expect(leave).toBeGreaterThan(3); expect(leave).toBeLessThan(10);  // two putts: a lag
    expect(shots.slice(2).every(s => s.putt && s.to === null)).toBe(true);
  });
  it('sends a missed fairway to its side', () => {
    const left = exampleHoleShots({ card: { n: 2, par: 4, strokes: 4, putts: 2, fairway: 'left' }, lengths: [{ club: 'driver', metres: 210 }, { club: 'pw', metres: 100 }], hole, seed: 3 });
    const right = exampleHoleShots({ card: { n: 2, par: 4, strokes: 4, putts: 2, fairway: 'right' }, lengths: [{ club: 'driver', metres: 210 }, { club: 'pw', metres: 100 }], hole, seed: 3 });
    // Playing up +z, left is +x.
    expect(left[0].to[0]).toBeGreaterThan(12);
    expect(right[0].to[0]).toBeLessThan(-12);
    expect(left[0].toLie).toBe('rough');
  });
  it('lays Statistik\'s own example round onto the course, the same every time', () => {
    const courses = [{ slug: 'bana', name: 'Banan', par: 72, holes: 18, status: 'playable' }];
    const example = exampleData({ courses, bag: parseBag(null) });
    const holes = Array.from({ length: 18 }, () => hole);
    const a = exampleRound(example, example.rounds[0].id, { holes }), b = exampleRound(example, example.rounds[0].id, { holes });
    expect(a.example).toBe(true);
    expect(a.holes).toHaveLength(18);
    expect(a.holes.every(h => h.plays.length === h.strokes)).toBe(true);
    expect(a.holes.every(h => h.plays.at(-1).holed)).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(exampleRound(example, 'nope', { holes })).toBeNull();
  });
});
