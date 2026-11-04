/* The scorecard's rules. Pure: what a round is, and what it adds up to.

   This keeps score for the golfer playing, on this phone. It is not a registered
   round: handicap and score reporting stay with Min Golf. */
export const MAX_HANDICAP = 54, MIN_HANDICAP = -10;

export const newRound = (startedAt = new Date()) => ({
  version: 1,
  startedAt: startedAt.toISOString().slice(0, 10),
  handicap: null,
  scores: {},
});

/* Stored rounds come back through here, so an old or damaged one is a fresh start
   instead of a broken card in the middle of a round. */
export function parseRound(text) {
  try {
    const round = JSON.parse(text);
    if (round?.version !== 1 || typeof round.scores !== 'object' || round.scores === null) return null;
    return { ...newRound(), ...round };
  } catch { return null; }
}

/* A hole's place in the course's order of difficulty, 1 the hardest. Needs every
   hole's index: a card without them, as the korthålsbana's, has no ranking. */
function difficultyRanks(holes) {
  if (!holes.every(hole => Number.isFinite(hole.index))) return null;
  const order = [...holes].sort((a, b) => a.index - b.index || a.n - b.n);
  return new Map(order.map((hole, rank) => [hole.n, rank + 1]));
}

/* Strokes a playing handicap gives on a hole: the hardest holes first, round and
   round. A plus handicap gives them back on the easiest holes. */
export function strokesReceived(handicap, hole, holes) {
  const ranks = difficultyRanks(holes);
  if (!ranks || !Number.isFinite(handicap)) return null;
  const count = holes.length, rank = ranks.get(hole.n);
  const whole = Math.floor(Math.abs(handicap) / count), rest = Math.abs(handicap) % count;
  return handicap >= 0
    ? whole + (rank <= rest ? 1 : 0)
    : 0 - whole - (rank > count - rest ? 1 : 0);
}

/* Stableford: two points for net par, one more or less a stroke, never below nil. */
export function stablefordPoints(par, strokes, received) {
  return Math.max(0, 2 + par + received - strokes);
}

/* The keys a score is picked from: two under par, par, and on up. A score past them
   takes the last key's place, so what was entered is always on the row. */
export function strokeKeys(par, current = null) {
  const first = Math.max(1, par - 2);
  const keys = Array.from({ length: 6 }, (_, k) => first + k);
  if (Number.isFinite(current) && current > keys.at(-1)) keys[keys.length - 1] = current;
  return keys;
}

/* A green in regulation: on it with two putts left for par. */
export const hitGreen = (score, par) => Number.isFinite(score?.strokes) && Number.isFinite(score?.putts) && score.strokes - score.putts <= par - 2;

const SCORE_NAMES = Object.freeze({ '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Dubbelbogey', 3: 'Trippelbogey' });
export const scoreName = (strokes, par) => (strokes === 1 ? 'Hole in one' : SCORE_NAMES[strokes - par] ?? `+${strokes - par}`);

/* What the round adds up to so far. A struck hole scores no points and has no
   strokes to add, so it leaves the stroke total and counts toward the points. */
export function roundTotals(round, holes) {
  const totals = { played: 0, strokes: 0, par: 0, putts: 0, points: 0, fairways: 0, fairwaysTried: 0, greens: 0, greensTried: 0 };
  const scoring = Number.isFinite(round.handicap) && difficultyRanks(holes) !== null;
  for (const hole of holes) {
    const score = round.scores[hole.n];
    if (!score) continue;
    if (score.picked) { totals.played++; continue; }
    if (!Number.isFinite(score.strokes)) continue;
    totals.played++;
    totals.strokes += score.strokes;
    totals.par += hole.par;
    totals.putts += score.putts ?? 0;
    if (hole.par >= 4 && score.fairway) {
      totals.fairwaysTried++;
      if (score.fairway === 'hit') totals.fairways++;
    }
    if (Number.isFinite(score.putts)) {
      totals.greensTried++;
      if (hitGreen(score, hole.par)) totals.greens++;
    }
    if (scoring) totals.points += stablefordPoints(hole.par, score.strokes, strokesReceived(round.handicap, hole, holes));
  }
  return { ...totals, toPar: totals.strokes - totals.par, points: scoring ? totals.points : null };
}
