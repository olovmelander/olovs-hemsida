/* Statistik's counting, held without a browser: the same records the light map
   keeps, read back as the page shows them. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { closeHole, lockShot } from '../map/map-shots.mjs';
import { keepRound, roundRecord } from '../map/map-rounds.mjs';
import { bestScorecard, exampleData, inkOn, insights, kindOf, perEighteen, playerStats, SCORE_KINDS, selectRounds } from './stats-model.mjs';

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
    expect(selectRounds([b, a, other], { period: 'season', now: NOW }).map(r => r.id)).toEqual([1, 3, 2]);
    expect(selectRounds([b, a, other], { period: 'last5', now: NOW }).map(r => r.id)).toEqual([1, 3, 2]);
    expect(selectRounds([b, a, other], { course: 'nian', now: NOW }).map(r => r.id)).toEqual([1, 2]);
  });
  it('starts 18-hole comparisons at nine scored holes and leaves a struck hole out', () => {
    expect(perEighteen(b)).toBeCloseTo((36 - 36) / 9 * 18);
    const struck = played(nine, 4, '2026-10-21', [['x'], ...Array(8).fill([5, 2])]);
    expect(perEighteen(struck)).toBeNull();
    const ten = played(course('tian', Array(10).fill(4)), 5, '2026-10-21', [['x'], ...Array(9).fill([5, 2])]);
    expect(perEighteen(ten)).toBe(18);
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
    expect(stat.fairways).toMatchObject({ hit: 8, left: 1, right: 5, tried: 14 });
    expect(stat.fairways.scoring.hit).toBeCloseTo(1 / 8);
    expect(stat.fairways.scoring.right).toBeCloseTo(7 / 5);
    expect(stat.fairways.scoring.gain).toBeGreaterThan(0);
    expect(stat.putts.total).toBe(35);
    expect(stat.putts.one).toBe(3);
    expect(stat.putts.three).toBe(2);
    expect(stat.putts.onGir).not.toBeNull();
    expect(stat.putts.missedGir).not.toBeNull();
    /* green in regulation: strokes - putts <= par - 2 */
    expect(stat.greens.tried).toBe(18);
    expect(stat.greens.hit).toBe(rounds.flatMap(r => r.holes).filter(h => h.strokes - h.putts <= h.par - 2).length);
    expect(stat.greens.scrambling.opportunities).toBe(18 - stat.greens.hit);
    expect(stat.greens.scrambling.saved).toBeGreaterThanOrEqual(1);
    expect(stat.strokeCosts.doubles.holes).toBe(2);
    expect(stat.strokeCosts.doubles.extra).toBe(2);
    expect(stat.strokeCosts.threePutts.extra).toBe(2);
    expect(stat.latest.row.id).toBe(2);
    expect(stat.trend[1].rolling).toBeCloseTo((stat.trend[0].perEighteen + stat.trend[1].perEighteen) / 2);
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

describe('hole by hole', () => {
  const rounds = [
    played(nine, 1, '2026-09-01', [[5, 2, 'hit'], [4, 2, 'left'], [3, 1], [7, 3, 'right'], [4, 2, 'hit'], [6, 2, 'right'], [2, 1], [4, 2, 'hit'], [5, 2, 'hit']]),
    played(nine, 2, '2026-09-08', [[4, 2, 'hit'], [5, 2, 'right'], [3, 2], [6, 2, 'right'], [4, 1, 'hit'], [5, 3, 'right'], [4, 2], [4, 2, 'hit'], [5, 2, 'hit']]),
  ];
  it('is drawn for one course only', () => {
    expect(playerStats({ rounds, now: NOW }).byHoleNumber).toBeNull();
    const holes = playerStats({ rounds, filter: { course: 'nian' }, now: NOW }).byHoleNumber;
    expect(holes).toHaveLength(9);
  });
  it('averages each hole against its own par, with its best and its fairways', () => {
    const holes = playerStats({ rounds, filter: { course: 'nian' }, now: NOW }).byHoleNumber;
    const fourth = holes.find(h => h.n === 4);
    expect(fourth).toMatchObject({ par: 5, rounds: 2, average: 6.5, toPar: 1.5, best: 6, putts: 2.5, fairway: 0 });
    expect(holes.find(h => h.n === 1).fairway).toBe(1);
    expect(holes.find(h => h.n === 3).fairway).toBeNull();
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
    expect(driver.carry).toBe(DEFAULT_BAG.find(club => club.id === 'driver').carry);
    expect(driver.carry).not.toBe(driver.stat.typical);
    expect(stat).not.toHaveProperty('bagUpdates');
  });
});

describe('scored holes and GPS sessions in the same history', () => {
  const fullCourse = course('test', Array(18).fill(4));
  const recorded = (id, count, bogeys, putts) => played(fullCourse, id, `2026-11-0${id}`,
    Array.from({ length: count }, (_, i) => [i < bogeys ? 5 : 4, putts[i] ?? null]));
  const shot = (id, metres, date, slug = 'test') => ({ round: id, course: slug, hole: 1, club: 'iron-7',
    from: [0, 0], to: [metres, 0], at: Date.parse(date), fromAccuracy: 3, toAccuracy: 4, outcome: 'played' });
  it('uses the same normalized best and keeps partial and zero putts distinct', () => {
    const rounds = [recorded(1, 18, 7, []), recorded(2, 9, 4, [2]), recorded(3, 1, 0, [0])];
    const stat = playerStats({ rounds });
    expect(stat.courses[0].best).toBe(stat.best);
    expect(bestScorecard(rounds).id).toBe(stat.best.id);
    expect(stat.best).toMatchObject({ id: 1, holes: 18, strokes: 79, perEighteen: 7 });
    expect(stat.trend.map(row => row.putts)).toEqual([
      { total: null, recorded: 0, holes: 18 }, { total: 2, recorded: 1, holes: 9 }, { total: 0, recorded: 1, holes: 1 },
    ]);
  });
  it('reports a single scored hole and earned points without projecting a whole round', () => {
    const actual = roundRecord({ id: 1, startedAt: '2026-11-01', handicap: 36, scores: { 10: { strokes: 4 } } }, fullCourse);
    const stat = playerStats({ rounds: [actual] });
    expect(stat.latest.row).toMatchObject({ holes: 1, of: 18, strokes: 4, toPar: 0, points: 4,
      singleHole: { n: 10, par: 4, strokes: 4 }, putts: { recorded: 0, total: null }, perEighteen: null });
    expect(stat.average).toBeNull();
    expect(stat.best).toBeNull();
    expect(perEighteen(actual)).toBeNull();
    expect(stat.shotsMeasured).toBe(0);
    expect(stat.greens.tried).toBe(0);
    expect(stat.fairways.tried).toBe(0);
  });
  it('keeps a short card in the history without changing longer-round comparisons', () => {
    const rounds = [recorded(1, 18, 4, []), recorded(2, 1, 1, []), recorded(3, 9, 1, [])];
    const stat = playerStats({ rounds });
    expect(stat.holes).toBe(28);
    expect(stat.trend.map(row => [row.toPar, row.perEighteen, row.rolling])).toEqual([[4, 4, 4], [1, null, null], [1, 2, 3]]);
    expect(stat.average).toBe(3);
    expect(stat.courses[0].best.id).toBe(3);
  });
  it('uses the archived par list and withholds par comparisons when a legacy score has no par', () => {
    const recovered = recorded(1, 9, 1, [2]);
    for (const h of recovered.holes) delete h.par;
    const sparse = { ...recovered, id: 2, pars: null };
    const stat = playerStats({ rounds: [recovered, sparse], filter: { course: 'test' } });
    expect(stat.trend.map(row => [row.strokes, row.toPar])).toEqual([[37, 1], [37, null]]);
    expect(stat.greens.tried).toBe(1);
    expect(stat.putts.holes).toBe(2);
    expect(stat.average).toBe(2);
    expect(stat.courses[0].average).toBe(2);
    expect(stat.courses[0].best.id).toBe(1);
  });
  it('keeps archived scoreless sessions and unarchived shots in their course and date filters', () => {
    const rounds = [recorded(1, 9, 1, []), recorded(2, 0, 0, [])];
    const shots = [shot(1, 125, '2024-05-01'), shot(2, 130, '2026-11-02'), shot(3, 143, '2026-11-03'),
      shot(4, 150, '2026-01-01'), shot(5, 180, '2026-11-05', 'guest')];
    const data = { rounds, shots, courses: [{slug: 'guest', name: 'Gästbanan'}], now: NOW };
    const stat = playerStats({ ...data, filter: { course: 'test', period: '90' } });
    expect(stat.rounds).toBe(1);
    expect(stat.history.map(s => s.record.id)).toEqual([1, 2]);
    expect(stat.shotsMeasured).toBe(3);
    expect(stat.history[1].shots).toHaveLength(1);
    const guest = playerStats({ ...data, filter: { course: 'guest' } });
    expect(guest.shotsMeasured).toBe(1);
    expect(guest.rounds).toBe(0);
    expect(guest.playedCourses).toContainEqual({ slug: 'guest', name: 'Gästbanan' });
    expect(guest.longest.course).toBe('Gästbanan');
    expect(guest.courses[0]).toMatchObject({name: 'Gästbanan', rounds: 0, shots: 1, best: null});
    expect(guest.average).toBeNull();
  });
  it('takes the last five sessions once and keeps unscored penalties out of score-based rates', () => {
    const rounds = [recorded(1, 9, 1, []), recorded(2, 9, 1, [])];
    const shots = Array.from({length: 7}, (_, i) => ({...shot(i + 1, 140, `2026-11-0${i + 1}`), penalty: 1}));
    const all = playerStats({ rounds, shots });
    expect(all.penalties).toBe(7);
    expect(all.strokeCosts.penalties).toEqual({ total: 2, holes: 2, perEighteen: 18 });
    const latest = playerStats({ rounds, shots, filter: { period: 'last5' } });
    expect(latest.shotsMeasured).toBe(5);
    expect(latest.rounds).toBe(0);
    expect(latest.strokeCosts.penalties.perEighteen).toBeNull();
  });
});

describe('insights', () => {
  it('says where the tee shots miss once there are enough misses', () => {
    const stat = { fairways: { hit: 4, left: 1, right: 7, tried: 12 }, byPar: [], putts: { holes: 0 }, greens: { tried: 0 }, delta: null, gaps: [], longest: null };
    expect(insights(stat)[0]).toMatchObject({ key: 'miss', title: 'Utslagen missar till höger' });
  });
  it('says a change of form in words, with no sign beside "bättre" or "sämre"', () => {
    const base = { fairways: { hit: 0, left: 0, right: 0, tried: 0 }, byPar: [], putts: { holes: 0 }, greens: { tried: 0 }, gaps: [], longest: null };
    expect(insights({ ...base, delta: -3.6 })[0].text).toContain('är 3,6 slag bättre');
    expect(insights({ ...base, delta: 2.25 })[0].text).toContain('är 2,3 slag sämre');
  });
  it('keeps a share and its per cent sign on one line', () => {
    const stat = { fairways: { hit: 4, left: 1, right: 7, tried: 12 }, byPar: [], putts: { holes: 0 }, greens: { tried: 0 }, delta: null, gaps: [], longest: null };
    expect(insights(stat)[0].text).toMatch(/^\d+\u00a0% av/);
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

describe('the share inside a bar', () => {
  /* WCAG contrast of two colours, for the test's own check */
  const lum = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  it('is printed in an ink that reads at 4.5:1 on every score colour', () => {
    for (const kind of SCORE_KINDS) expect(contrast(inkOn(kind.colour), kind.colour)).toBeGreaterThanOrEqual(4.5);
  });
  it('is dark on the mid blue and orange, where white fell to 3:1', () => {
    expect(inkOn('#5096ea')).toBe('#06140c');
    expect(inkOn('#e26a32')).toBe('#06140c');
    expect(inkOn('#285fbd')).toBe('#ffffff');
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
