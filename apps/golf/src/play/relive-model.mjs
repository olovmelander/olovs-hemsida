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

/* ------------------------------------------------------------------ examples
   Statistik's example (shell/stats-model.mjs exampleData) is a made-up player's
   sixteen rounds: each shot has a club and a length, but no place. To watch one,
   each hole is laid onto the real course: from the real tee, every shot along the
   hole's own line, its length scaled to the hole's real length; a missed fairway
   goes to the side it says; the last full shot finishes on the green near the
   pin, closer the fewer putts were taken. Seeded by round and hole, so the same
   example always plays the same. */

export const EXAMPLE_PREFIX = 'exempel-';

function seededRandom(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}

/** The point and direction a distance along a polyline. */
export function alongLine(line, distance) {
  let left = Math.max(0, distance);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 0 && left <= L) {
      const u = left / L;
      return { point: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
    }
    left -= L;
  }
  const a = line.at(-2) ?? line[0], b = line.at(-1), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { point: b.slice(), dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
}

/** Where along a polyline a point lies (its nearest point's distance from the start). */
export function projectOnLine(line, p) {
  let best = { d: Infinity, at: 0 }, acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], bx = b[0] - a[0], bz = b[1] - a[1], L2 = bx * bx + bz * bz, L = Math.sqrt(L2);
    const u = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * bx + (p[1] - a[1]) * bz) / L2)) : 0;
    const d = Math.hypot(a[0] + bx * u - p[0], a[1] + bz * u - p[1]);
    if (d < best.d) best = { d, at: acc + u * L };
    acc += L;
  }
  return best.at;
}

/**
 * One example hole laid onto the course.
 *   card    the example's { n, par, strokes, putts, fairway }
 *   lengths the example's full shots: [{ club, metres }]
 *   hole    the course's hole: { line, pin, tees: { marks: [{ c }] } }
 *   tee     index into the hole's tee marks
 *   seed    a number (the round's id)
 * Returns shots in the map's stored shape, in the course's own frame.
 */
export function exampleHoleShots({ card, lengths, hole, tee = 0, seed = 1 }) {
  const random = seededRandom(seed * 131 + card.n * 7919);
  const marks = hole.tees?.marks ?? [];
  const start = (marks[Math.min(tee, marks.length - 1)] ?? marks[0])?.c ?? hole.line[0];
  const pin = hole.pin ?? hole.line.at(-1);
  // The hole's line from this tee to the pin.
  const line = [start.slice(), ...hole.line.filter((p, i) => i > 0 && projectOnLine(hole.line, p) > projectOnLine(hole.line, start) + 1), pin.slice()];
  const toPin = (() => { let L = 0; for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return L; })();
  const putts = Math.max(0, card.putts ?? 0);
  // The last full shot's leave from the pin: holed out, a short putt, a lag.
  const leave = putts === 0 ? 0 : putts === 1 ? .8 + random() * 2.4 : putts === 2 ? 3.5 + random() * 6 : 9 + random() * 6;
  const total = lengths.reduce((s, x) => s + Math.max(5, x.metres), 0) || 1;
  const scale = Math.min(1.6, Math.max(.55, Math.max(1, toPin - leave) / total));
  const shots = [];
  let at = 0, from = start.slice();
  lengths.forEach((shot, i) => {
    const last = i === lengths.length - 1;
    let to;
    if (last) {
      const a = random() * Math.PI * 2;
      to = [pin[0] + Math.cos(a) * leave, pin[1] + Math.sin(a) * leave];
    } else {
      at = Math.min(toPin - leave - 8, at + Math.max(5, shot.metres) * scale);
      const { point, dir } = alongLine(line, at);
      const left = [dir[1], -dir[0]];
      // The tee shot of a par 4 or 5 goes where the card says; other shots stray a little.
      const miss = i === 0 && card.fairway === 'left' ? 14 + random() * 10
        : i === 0 && card.fairway === 'right' ? -(14 + random() * 10)
        : (random() - .5) * (i === 0 ? 8 : 12);
      to = [point[0] + left[0] * miss, point[1] + left[1] * miss];
    }
    shots.push({ course: null, round: null, hole: card.n, club: shot.club, at: i, from, to, fromLie: i ? 'fairway' : 'tee',
      toLie: last ? (leave > 0 ? 'green' : 'green') : (i === 0 && card.fairway && card.fairway !== 'hit' ? 'rough' : 'fairway'),
      outcome: 'played', penalty: 0 });
    from = to;
  });
  for (let k = 0; k < putts; k++) shots.push({ course: null, round: null, hole: card.n, club: 'putter', putt: true, at: lengths.length + k,
    from: from.slice(), to: null, fromLie: 'green', outcome: 'ended', penalty: 0 });
  return shots;
}

/**
 * Statistik's example round `id`, laid onto the detailed course, in the shape
 * reliveRound returns. `example` is exampleData's { rounds, shots }.
 */
export function exampleRound(example, id, { holes, tee = 0 }) {
  const record = example.rounds.find(r => String(r.id) === String(id));
  if (!record) return null;
  const holeCards = (record.holes ?? []).filter(card => holes[card.n - 1]);
  return {
    id: record.id, slug: record.course, courseName: record.courseName, date: record.date, tee: null, totals: record.totals ?? null, example: true,
    holes: holeCards.map(card => {
      const hole = holes[card.n - 1];
      const lengths = example.shots.filter(s => s.round === record.id && s.hole === card.n && !s.putt)
        .map(s => ({ club: s.club, metres: s.to ? Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) : 120 }));
      const shots = exampleHoleShots({ card, lengths, hole, tee, seed: record.id });
      // The card is the example's; its par is the real hole's, so the score's name fits the course.
      const par = hole.par ?? card.par;
      return { n: card.n, par, strokes: card.strokes, putts: card.putts, picked: Boolean(card.picked),
        plays: holeStrokes(shots, p => p, hole.pin ?? hole.line.at(-1)) };
    }),
  };
}
