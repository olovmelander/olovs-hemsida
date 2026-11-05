/* The rounds a player keeps: what is left of a round once it is over, and what many of
   them add up to. Pure.

   A card lives per course and is replaced by the next round, so a round is copied here
   when it ends: every hole's par and score, so an old round can be read without loading
   its course. Its shots stay in the shot log, under the same round id. */
import { clubStats, isMeasured, isPutt, shotLength } from './map-shots.mjs';
import { roundTotals, scoreName } from './map-score.mjs';

export const ROUNDS_VERSION = 1;
const MAX_STORED_ROUNDS = 300;
/* A hole's history starts here: one round is only a memory of that round. */
export const LEAST_ROUNDS = 2;
const FULL_ROUND_HOLES = 18;
/* Off the last green with this few holes unscored, the round is over all the same. */
const MISSING_AT_THE_END = 3;
const HALF_ROUND_HOLES = 9;

export function parseRounds(text) {
  try {
    const stored = JSON.parse(text);
    return stored?.version === ROUNDS_VERSION && Array.isArray(stored.rounds) ? stored.rounds : [];
  } catch { return []; }
}
export const storeRounds = rounds => JSON.stringify({ version: ROUNDS_VERSION, rounds: rounds.slice(-MAX_STORED_ROUNDS) });

const scored = score => Boolean(score?.picked) || Number.isFinite(score?.strokes);
export const holesScored = (round, holes) => holes.filter(hole => scored(round.scores[hole.n])).length;
export const isRoundComplete = (round, holes) => holes.length > 0 && holesScored(round, holes) === holes.length;

/* Is this round over, now that this hole has its score? Every hole has one, or the last
   hole is done with only a few left blank. A round begun on the 10th is not over on the
   18th: half its card is still to come. */
export function roundIsOver(round, holes, number) {
  const missing = holes.length - holesScored(round, holes);
  return missing === 0 || (number === holes.length && missing <= MISSING_AT_THE_END);
}

/* Nine holes done on an 18-hole course, which many a round is. */
export const atTheTurn = (round, holes, number) => holes.length === FULL_ROUND_HOLES && number === HALF_ROUND_HOLES
  && holesScored(round, holes) === HALF_ROUND_HOLES;

/* A round is taken out with its shots, or a club's lengths would still count them. */
export const dropRound = (rounds, record) => rounds.filter(each => !(each.id === record.id && each.course === record.course));
export const dropRoundShots = (shots, record) => shots.filter(shot => !(shot.round === record.id && shot.course === record.course));

/* A round as it is kept. Holes the player never reached stay out of it. */
export function roundRecord(round, course, { tee = null, at = Date.now() } = {}) {
  return {
    id: round.id,
    course: course.slug,
    courseName: course.name,
    date: round.startedAt,
    endedAt: at,
    tee,
    handicap: Number.isFinite(round.handicap) ? round.handicap : null,
    holeCount: course.holes.length,
    pars: course.holes.map(hole => hole.par),
    holes: course.holes.filter(hole => scored(round.scores[hole.n])).map(hole => {
      const { strokes = null, putts = null, fairway = null, picked = false } = round.scores[hole.n];
      return { n: hole.n, par: hole.par, strokes, putts, fairway, picked };
    }),
    totals: roundTotals(round, course.holes),
  };
}

/* A later edit of the same round replaces it where it stands. */
export function keepRound(rounds, record) {
  const index = rounds.findIndex(each => each.id === record.id && each.course === record.course);
  if (index < 0) return [...rounds, record];
  const list = rounds.slice();
  list[index] = record;
  return list;
}

const SCORE_KINDS = Object.freeze([
  ['better', 'Eagle eller bättre', step => step <= -2],
  ['birdie', 'Birdie', step => step === -1],
  ['par', 'Par', step => step === 0],
  ['bogey', 'Bogey', step => step === 1],
  ['double', 'Dubbel eller sämre', step => step >= 2],
]);

const ownShots = (record, shots) => shots.filter(shot => shot.course === record.course && shot.round === record.id);

/* Each hole's shots in the order they were played, with its putts from the card. */
function shotsByHole(record, own) {
  const strokes = own.filter(shot => !isPutt(shot));
  return [...new Set(strokes.map(shot => shot.hole))].sort((a, b) => a - b).map(n => ({
    n,
    shots: strokes.filter(shot => shot.hole === n).map(shot => ({ club: shot.club, out: shot.outcome === 'out', metres: shotLength(shot), suspect: Boolean(shot.suspect) })),
    putts: record.holes.find(hole => hole.n === n)?.putts ?? null,
  }));
}

/* What the player sees when the round is over. */
export function roundSummary(record, shots = []) {
  const played = record.holes.filter(hole => !hole.picked && Number.isFinite(hole.strokes));
  const kinds = SCORE_KINDS.map(([key, label, fits]) => ({ key, label, count: played.filter(hole => fits(hole.strokes - hole.par)).length }))
    .filter(kind => kind.count > 0);
  const own = ownShots(record, shots);
  const measured = own.filter(isMeasured);
  const longest = measured.reduce((best, shot) => (!best || shotLength(shot) > shotLength(best) ? shot : best), null);
  const best = played.reduce((top, hole) => (!top || hole.strokes - hole.par < top.strokes - top.par ? hole : top), null);
  return {
    played: record.holes.length,
    of: record.holeCount,
    missing: record.holeCount - record.holes.length,
    totals: record.totals,
    kinds,
    logged: own.filter(shot => !isPutt(shot)).length,
    clubs: [...clubStats(own)].map(([club, stat]) => ({ club, ...stat })).sort((a, b) => b.typical - a.typical),
    byHole: shotsByHole(record, own),
    longest: longest ? { club: longest.club, metres: shotLength(longest), hole: longest.hole } : null,
    bestHole: best && best.strokes < best.par ? { n: best.n, name: scoreName(best.strokes, best.par) } : null,
    penalties: own.reduce((sum, shot) => sum + shot.penalty, 0),
  };
}

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

/* The side a tee shot usually misses, or nothing if it does not lean either way. */
function usualMiss(fairways) {
  const left = fairways.filter(side => side === 'left').length;
  const right = fairways.filter(side => side === 'right').length;
  return left === right ? null : left > right ? 'vänster' : 'höger';
}

/* How a player tends to play one hole, across the rounds kept. Scores come from the
   rounds, and clubs from the shots, since a round can be scored without any locks. */
export function holeHistory(rounds, shots, slug, number) {
  const kept = rounds.flatMap(round => (round.course === slug ? round.holes.filter(hole => hole.n === number).map(hole => ({ round, hole })) : []));
  const played = kept.filter(({ hole }) => !hole.picked && Number.isFinite(hole.strokes));
  if (played.length < LEAST_ROUNDS) return null;
  const { par } = played[0].hole;
  const strokes = played.map(({ hole }) => hole.strokes);
  const putts = played.map(({ hole }) => hole.putts).filter(Number.isFinite);
  const fairways = played.map(({ hole }) => hole.fairway).filter(Boolean);
  const ids = new Set(played.map(({ round }) => round.id));
  const here = shots.filter(shot => shot.course === slug && shot.hole === number && ids.has(shot.round));
  const firstShots = [...new Set(here.map(shot => shot.round))].map(id => here.find(shot => shot.round === id)).filter(shot => !isPutt(shot));
  const clubCounts = new Map();
  for (const shot of firstShots) clubCounts.set(shot.club, (clubCounts.get(shot.club) ?? 0) + 1);
  const teeClub = [...clubCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const teeLengths = firstShots.filter(shot => shot.club === teeClub && isMeasured(shot)).map(shotLength).sort((a, b) => a - b);
  return {
    rounds: played.length,
    average: average(strokes),
    toPar: average(strokes) - par,
    best: Math.min(...strokes),
    putts: putts.length ? average(putts) : null,
    fairway: fairways.length ? { hit: fairways.filter(side => side === 'hit').length, of: fairways.length, miss: usualMiss(fairways) } : null,
    teeClub,
    teeLength: teeLengths.length ? teeLengths[teeLengths.length >> 1] : null,
    penalties: here.reduce((sum, shot) => sum + shot.penalty, 0),
  };
}

/* A round's score scaled to 18 holes, so a nine sits beside a full round. */
const toParPerRound = record => {
  const { toPar, played } = record.totals;
  return played ? (toPar / played) * FULL_ROUND_HOLES : null;
};
const scoredRounds = rounds => rounds.filter(record => record.totals.strokes > 0 && toParPerRound(record) !== null);

/* The newest rounds against the ones before them. */
export function roundTrend(rounds, recent = 5) {
  const list = scoredRounds(rounds);
  if (!list.length) return null;
  const summarise = part => {
    if (!part.length) return null;
    const sum = key => part.reduce((total, record) => total + record.totals[key], 0);
    return {
      rounds: part.length,
      toPar: average(part.map(toParPerRound)),
      putts: sum('greensTried') ? sum('putts') / sum('greensTried') : null,
      fairways: sum('fairwaysTried') ? sum('fairways') / sum('fairwaysTried') : null,
      greens: sum('greensTried') ? sum('greens') / sum('greensTried') : null,
    };
  };
  return {
    recent: summarise(list.slice(-recent)),
    before: summarise(list.slice(0, -recent)),
    line: list.slice(-20).map(record => ({ id: record.id, toPar: toParPerRound(record) })),
  };
}

const toParWords = value => (value === 0 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`);

/* The round in words, for a message to a friend. */
export function roundText(record, summary, when = record.date) {
  const { totals } = summary;
  const lines = [`${record.courseName}, ${when}`];
  lines.push([`${totals.strokes} slag (${toParWords(totals.toPar)})`, totals.points === null ? null : `${totals.points} poäng`, totals.putts ? `${totals.putts} puttar` : null].filter(Boolean).join(' · '));
  const stats = [totals.fairwaysTried ? `Fairway ${totals.fairways}/${totals.fairwaysTried}` : null, totals.greensTried ? `Green ${totals.greens}/${totals.greensTried}` : null];
  if (stats.some(Boolean)) lines.push(stats.filter(Boolean).join(' · '));
  const nine = (from, to) => record.holes.filter(hole => hole.n >= from && hole.n <= to).map(hole => (hole.picked ? '–' : hole.strokes)).join(' ');
  for (const part of [nine(1, 9), nine(10, 18)]) if (part) lines.push(part);
  return lines.join('\n');
}

/* The course's length from a tee, for the start of a round. */
export function courseLength(holes, teeIndex) {
  return holes.reduce((sum, hole) => sum + (hole.tees?.[teeIndex]?.metres ?? hole.lengths?.[teeIndex] ?? hole.lengths?.[0] ?? 0), 0);
}
