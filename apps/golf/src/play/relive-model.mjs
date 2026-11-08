/* A round recorded with the map, as a sequence of strokes the detailed course
   can play back.

   The map stores every locked shot: where it was played from and where the
   next lock found the ball (`from`, `to`, in the map's ground frame), the club,
   the lie, and what happened (out of bounds, a penalty area). Putts are
   counted, not positioned: the map clones the first putt once per putt. So a
   hole replays its measured shots exactly, and its putts from the first putt's
   spot, rolled to the cup in as many putts as were counted (and said so). */
import { parseRounds } from '../map/map-rounds.mjs';
import { parseHistory, isPutt } from '../map/map-shots.mjs';

export const MAP_ROUNDS_KEY = 'banvy-map-rounds-v1';
export const MAP_SHOTS_KEY = 'banvy-map-shots-v1';

/** The recorded rounds of a course, newest first, each with how many shots it has positions for. */
export function recordedRounds(storage, slug) {
  const rounds = parseRounds(storage?.getItem(MAP_ROUNDS_KEY) ?? 'null').filter(r => r.course === slug);
  const shots = parseHistory(storage?.getItem(MAP_SHOTS_KEY) ?? 'null');
  return rounds.map(r => ({ ...r, located: shots.filter(s => s.course === slug && s.round === r.id && Array.isArray(s.from)).length }))
    .sort((a, b) => (b.endedAt ?? b.id) - (a.endedAt ?? a.id));
}

/** The leave of each putt but the last, as a share of the distance to the cup. */
function puttLeave(k, count, distance) {
  if (k === count - 1) return 0;
  // A lag leaves about a tenth of a long putt, at least a short putt's length;
  // a third putt and on are short misses.
  const left = count - 1 - k;
  const share = k === 0 ? .1 : .4;
  return Math.max(.35 * left, Math.min(distance * share, 2.2 * left));
}

/**
 * The strokes of one hole, in the course's own frame.
 *   shots     the round's shots on this hole, in recorded order
 *   toCourse  ([x, z]) -> [x, z], the map's ground frame into the course's
 *   cup       [x, z] of the hole's cup
 * Each stroke: { club, putt, from, to, measured, outcome, penalty, distance, counted }
 */
export function holeStrokes(shots, toCourse, cup) {
  const strokes = [];
  const plays = shots.filter(s => Array.isArray(s.from));
  const putts = plays.filter(isPutt), full = plays.filter(s => !isPutt(s));
  let last = null;
  for (let i = 0; i < full.length; i++) {
    const s = full[i];
    const from = toCourse(s.from);
    // A shot's end is its own `to`, else where the next one was played from.
    const next = full[i + 1] ?? putts[0] ?? null;
    let to = s.to ? toCourse(s.to) : next?.from ? toCourse(next.from) : null;
    const ended = !to && !next;
    if (!to && ended) to = cup.slice();         // the last stroke on the hole: it went in
    strokes.push({ club: s.club, putt: false, from, to, measured: Boolean(s.to || next?.from), outcome: s.outcome || 'played',
      penalty: Number(s.penalty) || 0, inHazard: Boolean(s.inHazard), fromLie: s.fromLie, toLie: s.toLie,
      distance: to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : null, counted: false, holed: ended });
    last = to;
  }
  if (putts.length) {
    let at = toCourse(putts[0].from);
    const d0 = Math.hypot(cup[0] - at[0], cup[1] - at[1]);
    for (let k = 0; k < putts.length; k++) {
      const d = Math.hypot(cup[0] - at[0], cup[1] - at[1]) || 1e-6;
      const leave = puttLeave(k, putts.length, d0);
      const to = leave <= 0 ? cup.slice() : [cup[0] - (cup[0] - at[0]) / d * Math.min(leave, d * .9), cup[1] - (cup[1] - at[1]) / d * Math.min(leave, d * .9)];
      strokes.push({ club: putts[k].club, putt: true, from: at, to, measured: k === 0, outcome: 'played', penalty: 0, inHazard: false,
        fromLie: 'green', toLie: 'green', distance: Math.hypot(to[0] - at[0], to[1] - at[1]), counted: true, holed: leave <= 0 });
      at = to;
    }
  } else if (strokes.length && !strokes.at(-1).holed) {
    // No putts counted: the last measured shot finished the hole.
    strokes.at(-1).holed = true;
  }
  void last;
  return strokes;
}

/**
 * The whole round, ready to play: its holes in the order they were played.
 * Returns null when the round is not stored. Holes without any located shot
 * are kept with an empty stroke list (shown, not played).
 */
export function reliveRound(storage, slug, roundId, { toCourse, cupOf }) {
  const id = Number(roundId);
  const record = parseRounds(storage?.getItem(MAP_ROUNDS_KEY) ?? 'null').find(r => r.course === slug && Number(r.id) === id);
  if (!record) return null;
  const shots = parseHistory(storage?.getItem(MAP_SHOTS_KEY) ?? 'null').filter(s => s.course === slug && Number(s.round) === id);
  const byHole = new Map();
  for (const s of shots) {
    if (!byHole.has(s.hole)) byHole.set(s.hole, []);
    byHole.get(s.hole).push(s);
  }
  const first = n => Math.min(...(byHole.get(n) ?? []).map(s => s.at ?? Infinity));
  const holes = (record.holes ?? []).slice().sort((a, b) => (first(a.n) - first(b.n)) || (a.n - b.n)).map(card => ({
    n: card.n, par: card.par, strokes: card.strokes, putts: card.putts, picked: Boolean(card.picked),
    plays: holeStrokes(byHole.get(card.n) ?? [], toCourse, cupOf(card.n)),
  }));
  return { id, slug, courseName: record.courseName, date: record.date, tee: record.tee, totals: record.totals ?? null, holes };
}
