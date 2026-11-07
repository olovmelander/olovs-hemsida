/* Statistik's counting, held without a browser: the same records the light map
   keeps, read back as the page shows them. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { closeHole, lockShot } from '../map/map-shots.mjs';
import { keepRound, roundRecord } from '../map/map-rounds.mjs';
import { exampleData, insights, kindOf, perEighteen, playerStats, SCORE_KINDS, selectRounds } from './stats-model.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const course = (slug, pars) => ({ slug, name: slug.toUpperCase(), holes: pars.map((par, i) => ({ n: i + 1, par, index: i + 1 })) });
/* a round as the map keeps it, from a card of strokes, putts and fairways */
function played(c, id, date, card) {
  const scores = {};
  card.forEach(([strokes, putts = null, fairway = null], i) => { scores[i + 1] = strokes === 'x' ? { picked: true } : { strokes, putts, fairway }; });
  return { ...roundRecord({ id, startedAt: date, handicap: 18, scores }, c, { at: Date.parse(date) + 4 * 3600000 }), date };
}
const nine = course('nian', [4, 4, 3, 5, 4, 4, 3, 4, 5]);

describe('the rounds in view', () => {
  const a = played(nine, 1, '2026-01-10', Array(9).fill([5, 2, 'hit']));
  const b = played(nine, 2, '2026-10-20', Array(9).fill([4, 2, 'right']));
  const other = played(course('annan', [4, 4, 4]), 3, '2026-10-01', [[4, 2], [5, 2], [6, 3]]);
  it('narrows by period and course, oldest first', () => {
    expect(selectRounds([b, a, other], { now: NOW }).map(r => r.id)).toEqual([1, 3, 2]);
    expect(selectRounds([b, a, other], { period: '90', now: NOW }).map(r => r.id)).toEqual([3, 2]);
    expect(selectRounds([b, a, other], { course: 'nian', now: NOW }).map(r => r.id)).toEqual([1, 2]);
  });
  it('scales a nine to 18 holes, and leaves a struck hole out', () => {
    expect(perEighteen(b)).toBeCloseTo((36 - 36) / 9 * 18);
    const struck = played(nine, 4, '2026-10-21', [['x'], ...Array(8).fill([5, 2])]);
    expect(perEighteen(struck)).toBeCloseTo((40 - 32) / 8 * 18);
  });
});

describe('what the rounds add up to', () => {
  const rounds = [
    played(nine, 1, '2026-09-01', [[5, 2, 'hit'], [4, 2, 'left'], [3, 1], [7, 3, 'right'], [4, 2, 'hit'], [6, 2, 'right'], [2, 1], [4, 2, 'hit'], [5, 2, 'hit']]),
    played(nine, 2, '2026-09-08', [[4, 2, 'hit'], [5, 2, 'right'], [3, 2], [6, 2, 'right'], [4, 1, 'hit'], [5, 3, 'right'], [4, 2], [4, 2, 'hit'], [5, 2, 'hit']]),
  ];
  const stat = playerStats({ rounds, shots: [], bag: DEFAULT_BAG, now: NOW });

  it('counts rounds, holes and the score kinds', () => {
    expect(stat.rounds).toBe(2);
    expect(stat.holes).toBe(18);
    const count = Object.fromEntries(stat.distribution.map(d => [d.key, d.count]));
    /* round 1: +1 0 0 +2 0 +2 -1 0 0; round 2: 0 +1 0 +1 0 +1 +1 0 0 */
    expect(count).toEqual({ better: 0, birdie: 1, par: 10, bogey: 5, double: 2 });
    expect(stat.distribution.reduce((s, d) => s + d.count, 0)).toBe(stat.holes);
  });

  it('reads fairways, greens and putts as the map\'s card does', () => {
    /* the par 4s and 5s: round 1 hit left right hit right hit hit, round 2 hit right right hit right hit hit */
    expect(stat.fairways).toEqual({ hit: 8, left: 1, right: 5, tried: 14 });
    expect(stat.putts.total).toBe(35);
    expect(stat.putts.one).toBe(3);
    expect(stat.putts.three).toBe(2);
    /* green in regulation: strokes - putts <= par - 2 */
    expect(stat.greens.tried).toBe(18);
    expect(stat.greens.hit).toBe(rounds.flatMap(r => r.holes).filter(h => h.strokes - h.putts <= h.par - 2).length);
  });

  it('averages each par type against its par', () => {
    const par3 = stat.byPar.find(p => p.par === 3);
    expect(par3.holes).toBe(4);
    expect(par3.toPar).toBeCloseTo((3 + 2 + 3 + 4 - 12) / 4);
  });

  it('picks the best round of nine holes or more, by its score per 18', () => {
    expect(stat.best.id).toBe(1);
    expect(stat.trend.map(t => t.id)).toEqual([1, 2]);
  });
});

describe('the clubs', () => {
  it('takes their lengths from the measured shots, and names them from the bag', () => {
    let shots = [];
    const lock = (club, x, hole = 1) => { shots = lockShot(shots, { hole, club: DEFAULT_BAG.find(c => c.id === club), point: [x, 0], accuracy: 4, at: 1, meta: { course: 'nian', round: 1 } }); };
    for (let i = 0; i < 6; i++) { lock('driver', i * 1000, 1 + i); lock('iron-7', i * 1000 + 220 + i, 1 + i); lock('putter', i * 1000 + 220 + i + 140 + i, 1 + i); shots = closeHole(shots, 1 + i); }
    const stat = playerStats({ rounds: [], shots, bag: DEFAULT_BAG, now: NOW });
    const driver = stat.clubs.find(c => c.id === 'driver');
    expect(driver.name).toBe('Driver');
    expect(driver.stat.shots).toBe(6);
    expect(driver.stat.known).toBe(true);
    expect(Math.round(driver.stat.typical)).toBeGreaterThanOrEqual(221);
    expect(stat.clubs.find(c => c.id === 'putter').putter).toBe(true);
    expect(stat.longest.club).toBe('Driver');
  });
});

describe('insights', () => {
  it('says where the tee shots miss once there are enough misses', () => {
    const stat = { fairways: { hit: 4, left: 1, right: 7, tried: 12 }, byPar: [], putts: { holes: 0 }, greens: { tried: 0 }, delta: null, gaps: [], longest: null };
    expect(insights(stat)[0]).toMatchObject({ key: 'miss', title: 'Utslagen missar till höger' });
  });
  it('says nothing it has too little behind', () => {
    const stat = { fairways: { hit: 1, left: 1, right: 2, tried: 4 }, byPar: [{ par: 3, holes: 2, toPar: 2 }], putts: { holes: 4, perGreen: 2.5 }, greens: { tried: 4 }, delta: 0.4, gaps: [], longest: null };
    expect(insights(stat)).toEqual([]);
  });
});

describe('the example', () => {
  const courses = [
    { slug: 'a', name: 'A', holes: 18, par: 72 }, { slug: 'b', name: 'B', holes: 18, par: 71 },
    { slug: 'c', name: 'C', holes: 9, par: 35 }, { slug: 'd', name: 'D', holes: 18, par: 73 },
  ];
  const example = exampleData({ courses, bag: DEFAULT_BAG, now: NOW });
  it('is the same every time, on eighteen-hole courses only', () => {
    expect(exampleData({ courses, bag: DEFAULT_BAG, now: NOW })).toEqual(example);
    expect(new Set(example.rounds.map(r => r.course))).toEqual(new Set(['a', 'b', 'd']));
  });
  it('keeps each course\'s par and makes a full, believable page', () => {
    for (const record of example.rounds) {
      const c = courses.find(x => x.slug === record.course);
      expect(record.pars.reduce((s, p) => s + p, 0)).toBe(c.par);
      expect(record.holes).toHaveLength(18);
    }
    const stat = playerStats({ ...example, bag: DEFAULT_BAG, now: NOW });
    expect(stat.rounds).toBe(16);
    expect(stat.average).toBeGreaterThan(0);
    expect(stat.clubs.filter(c => c.stat?.known).length).toBeGreaterThanOrEqual(8);
    expect(stat.insights.length).toBeGreaterThan(0);
  });
  it('is kept the way the map keeps a round', () => {
    expect(keepRound([], example.rounds[0])).toHaveLength(1);
  });
});

describe('the score scale', () => {
  it('runs from eagle to double and names every score', () => {
    expect(kindOf(3, 5).key).toBe('better');
    expect(kindOf(4, 4).key).toBe('par');
    expect(kindOf(9, 4).key).toBe('double');
    expect(SCORE_KINDS).toHaveLength(5);
  });
});
