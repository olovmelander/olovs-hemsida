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
});
