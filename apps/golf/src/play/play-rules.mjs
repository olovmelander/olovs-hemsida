/* The rules a played round keeps: out of bounds, penalty areas, holing out and
   the card. Pure functions, so they are tested without a course.

   Played rounds are stored under their own key and never beside the rounds
   recorded with the map, so a game can never reach the real club statistics
   (stats-model.mjs reads only the map's keys). */
import { strokesReceived, stablefordPoints } from '../map/map-score.mjs';

export const PLAY_KEYS = Object.freeze({ rounds: 'banvy-play-rounds-v1', settings: 'banvy-play-settings-v1' });
export const CLUB_LENGTH = 1.0;          // the drop's measuring club, in metres

function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** How many boundary lines the straight line between two points crosses. */
export function boundaryCrossings(lines, from, to) {
  let n = 0;
  for (const line of lines || []) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (segmentsCross(from[0], from[1], to[0], to[1], a[0], a[1], b[0], b[1])) n++;
    }
  }
  return n;
}

/**
 * Out of bounds, seen from where the stroke was played (always in bounds): a
 * ball is out when the line to it crosses the white stakes an odd number of
 * times, or when it rests beyond the course's own ground altogether.
 */
export function outTest({ lines, from, inCourse }) {
  return (x, z) => (inCourse && !inCourse(x, z)) || boundaryCrossings(lines, from, [x, z]) % 2 === 1;
}

/**
 * Relief from a penalty area (lateral relief, rule 17.1d(3)): a spot within two
 * club lengths of where the ball last crossed into it, no nearer the hole, on
 * dry playable ground. Falls back to further away along the line back from
 * the hole if nothing near is dry.
 */
export function dropPoint({ entry, cup, isDry, isOut = () => false }) {
  const holeDist = (x, z) => Math.hypot(x - cup[0], z - cup[1]);
  const limit = holeDist(entry[0], entry[1]);
  const ok = (x, z) => isDry(x, z) && !isOut(x, z) && holeDist(x, z) >= limit - 1e-6;
  let best = null;
  for (const reach of [2 * CLUB_LENGTH, 4 * CLUB_LENGTH, 7 * CLUB_LENGTH]) {
    for (let r = .5; r <= reach + 1e-9; r += .5) {
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2;
        const x = entry[0] + Math.cos(a) * r, z = entry[1] + Math.sin(a) * r;
        if (ok(x, z)) {
          const score = r + .01 * holeDist(x, z);
          if (!best || score < best.score) best = { x, z, score };
        }
      }
      if (best) return [best.x, best.z];
    }
  }
  // Back on the line from the hole through the entry, as far as it takes.
  const dx = entry[0] - cup[0], dz = entry[1] - cup[1], l = Math.hypot(dx, dz) || 1;
  for (let back = 2; back <= 60; back += 1) {
    const x = entry[0] + dx / l * back, z = entry[1] + dz / l * back;
    if (ok(x, z)) return [x, z];
  }
  return entry.slice();
}

/** A new played round. */
export function createRound({ slug, courseName, holes, startHole = 1, tee = 0, character = 'female', difficulty = 'normal', now = Date.now() }) {
  const order = [];
  for (let i = 0; i < holes.length; i++) order.push(((startHole - 1 + i) % holes.length) + 1);
  return { version: 1, id: now, slug, courseName, tee, character, difficulty, startedAt: now, endedAt: null,
    order, pars: Object.fromEntries(holes.map(h => [h.n, h.par])),
    holes: {}, current: order[0] };
}

/** The card of one hole: strokes include penalties. */
export function holeCard(round, n) {
  return round.holes[n] || (round.holes[n] = { strokes: 0, putts: 0, penalties: 0, shots: [], holed: false });
}

/** Count a stroke (and what it was) on the current hole. */
export function addStroke(round, shot) {
  const card = holeCard(round, round.current);
  card.strokes++;
  if (shot.putt) card.putts++;
  card.shots.push({ club: shot.club, from: shot.from, to: shot.to, lie: shot.lie, result: shot.result, distance: shot.distance });
  return card;
}

export function addPenalty(round, strokes = 1) {
  const card = holeCard(round, round.current);
  card.strokes += strokes; card.penalties += strokes;
  return card;
}

/** The name a score has against par. */
export function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const names = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Dubbelbogey', '3': 'Trippelbogey' };
  return names[String(strokes - par)] || `${strokes - par > 0 ? '+' : ''}${strokes - par}`;
}

/** The round's totals over the holes holed so far. */
export function roundTotals(round) {
  let strokes = 0, par = 0, putts = 0, played = 0;
  for (const [n, card] of Object.entries(round.holes)) {
    if (!card.holed) continue;
    strokes += card.strokes; putts += card.putts; par += round.pars[n] || 0; played++;
  }
  return { strokes, par, putts, played, toPar: strokes - par };
}

/* The handicap's share (the map's own rules, map/map-score.mjs): strokes given on a
   hole by its index, and Stableford points. A course without indexes counts strokes. */
const indexed = holes => holes.map(h => ({ n: h.n, index: Number.isFinite(h.idx) ? h.idx : h.index }));
export function receivedOn(round, holes, n) {
  if (!Number.isFinite(round.handicap)) return null;
  const list = indexed(holes);
  const hole = list.find(h => h.n === n);
  return hole ? strokesReceived(round.handicap, hole, list) : null;
}
/** A finished hole's points (a picked-up hole scores none), or null without a handicap. */
export function pointsOn(round, holes, n) {
  const card = round.holes[n], received = receivedOn(round, holes, n);
  if (received == null || !card || !(card.holed || card.picked)) return null;
  return card.picked ? 0 : stablefordPoints(round.pars[n], card.strokes, received);
}

/** What the round's holes add up to, as the map's round sheet counts it: fairways, greens, putts, points. */
export function roundStats(round, holes) {
  const s = { fairways: 0, fairwaysTried: 0, greens: 0, greensTried: 0, putts: 0, points: null };
  for (const [key, card] of Object.entries(round.holes)) {
    if (!card.holed && !card.picked) continue;
    const n = Number(key), par = round.pars[n];
    if (par >= 4 && card.shots.length) {
      s.fairwaysTried++;
      // The second stroke's lie is where the tee shot finished.
      if (card.shots[1]?.lie === 'fairway' || (card.holed && card.shots.length === 1)) s.fairways++;
    }
    if (card.holed) {
      s.greensTried++;
      if (card.strokes - card.putts <= par - 2) s.greens++;
      s.putts += card.putts;
    }
    const points = pointsOn(round, holes, n);
    if (points != null) s.points = (s.points ?? 0) + points;
  }
  return s;
}

/** The next hole of the round, or null when it is over. */
export function nextHole(round) {
  const i = round.order.indexOf(round.current);
  return i >= 0 && i + 1 < round.order.length ? round.order[i + 1] : null;
}

/* Storage: its own key, the newest 100 rounds. */
export function readPlayedRounds(storage) {
  try {
    const data = JSON.parse(storage?.getItem(PLAY_KEYS.rounds) || 'null');
    return data?.version === 1 && Array.isArray(data.rounds) ? data.rounds : [];
  } catch { return []; }
}
export function savePlayedRound(storage, round) {
  try {
    const rounds = readPlayedRounds(storage).filter(r => !(r.id === round.id && r.slug === round.slug));
    rounds.push(round);
    storage?.setItem(PLAY_KEYS.rounds, JSON.stringify({ version: 1, rounds: rounds.slice(-100) }));
    return true;
  } catch { return false; }
}
