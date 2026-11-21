/* The shared round picture's numbers, as the card says them. The drawing
   itself was looked at (a 1080 x 1350 PNG from the example statistics). */
import { describe, expect, it } from 'vitest';
import { roundCardFacts } from './round-card.mjs';

describe('a round as a picture', () => {
  const record = {
    course: 'nian', courseName: 'Nian', date: '2026-11-01', holeCount: 9,
    pars: [4, 4, 3, 5, 4, 4, 3, 4, 5],
    holes: [
      { n: 1, par: 4, strokes: 5, putts: 2, fairway: 'hit' }, { n: 2, par: 4, strokes: 4, putts: 1, fairway: 'left' },
      { n: 3, par: 3, strokes: 3, putts: 2 }, { n: 4, par: 5, picked: true }, { n: 5, par: 4, strokes: 4, putts: 2, fairway: 'hit' },
    ],
    totals: { points: 11 },
  };
  it('counts the holes played, the strokes and the score against their par', () => {
    expect(roundCardFacts(record)).toMatchObject({ strokes: 16, toPar: 1, played: 4, of: 9, points: 11 });
  });
  it('reads putts, fairways and greens in regulation off the card', () => {
    /* greens: strokes - putts <= par - 2 on holes 3 and 5 (the 2nd took three to reach) */
    expect(roundCardFacts(record)).toMatchObject({ putts: 7, fairways: '2/3', greens: '2/4' });
  });
  it('leaves out what was never written', () => {
    const bare = roundCardFacts({ holes: [{ n: 1, par: 3, strokes: 3 }], holeCount: 1, totals: { points: null } });
    expect(bare).toMatchObject({ putts: null, fairways: null, greens: null, points: null });
  });
  it('distinguishes no recorded putts, an explicit zero and a subtotal', () => {
    const holes = [{ n: 1, strokes: 3, par: 3 }, { n: 2, strokes: 4, par: 4 }, { n: 3, picked: true, putts: 12 }];
    expect(roundCardFacts({ holes, holeCount: 9 })).toMatchObject({ putts: null, puttsLabel: 'Puttar ej förda', scoreLabel: 'Score på 2 av 9 hål · 1 struket' });
    holes[0].putts = 0;
    expect(roundCardFacts({ holes })).toMatchObject({ putts: 0, puttsLabel: 'Puttar på 1 av 2 hål' });
    holes[1].putts = 2;
    expect(roundCardFacts({ holes })).toMatchObject({ putts: 2, puttsLabel: 'Puttar' });
  });
  it('does not turn a shots-only archive into a score of zero or level par', () => {
    expect(roundCardFacts({ holes: [], holeCount: 9, totals: { points: 0 } })).toMatchObject({ scoreLabel: 'Inga hål med score', strokes: null, toPar: null, points: null });
  });
  it('shows the round’s real logged and measured strokes in a shots-only share', () => {
    const measured = { round: 7, course: 'nian', hole: 7, club: 'driver', from: [0, 0], to: [120, 0], fromAccuracy: 4, toAccuracy: 4, outcome: 'played' };
    const shots = [measured, { ...measured, club: 'sw', to: null }, { ...measured, club: 'putter' }, { ...measured, round: 8 }];
    const facts = roundCardFacts({ course: 'nian', id: 7, holes: [], totals: {}, holeCount: 9 }, shots);
    expect(facts).toMatchObject({ strokes: null, toPar: null, logged: 2, measured: 1, longest: 120, clubs: 2 });
    expect([...facts.byHole]).toEqual([[7, 2]]);
  });
  it('recovers par from the saved course card or leaves the comparison unscored', () => {
    const holes = [{ n: 1, strokes: 4, putts: 2 }];
    expect(roundCardFacts({ holes })).toMatchObject({ strokes: 4, toPar: null, greens: null });
    expect(roundCardFacts({ holes, pars: [4] })).toMatchObject({ strokes: 4, toPar: 0, greens: '1/1' });
  });
});
