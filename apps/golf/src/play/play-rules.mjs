/* The rules a played round keeps: out of bounds, penalty areas, holing out and
   the card. Pure functions, so they are tested without a course.

   Played rounds are stored under their own key and never beside the rounds
   recorded with the map, so a game can never reach the real club statistics
   (stats-model.mjs reads only the map's keys). */
import { strokesReceived, stablefordPoints } from '../map/map-score.mjs';

export const PLAY_KEYS = Object.freeze({ rounds: 'banvy-play-rounds-v1', settings: 'banvy-play-settings-v1', checkpoint: 'banvy-play-checkpoint-v1:' });
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

/** How the golfer takes a hole (owner request, 12 November): Celebrate for a birdie or
    better, FistPump for a par, Disappointed for a double bogey or worse. A bogey, or a
    ball picked up, passes without one. */
export function holeReaction(strokes, par, picked = false) {
  if (picked || !(strokes > 0) || !(par > 0)) return null;
  const over = strokes - par;
  if (over < 0) return 'Celebrate';
  if (over === 0) return 'FistPump';
  return over >= 2 ? 'Disappointed' : null;
}

/** Play a hole's reaction if the golfer's model has it (the September golfers have only Celebrate). */
export function playHoleReaction(golfer, strokes, par, picked = false) {
  const name = holeReaction(strokes, par, picked);
  if (!name || !golfer?.clips?.has(name)) return null;
  golfer.play(name, { fade: .25 });
  return name;
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

/* The browser may deny the storage accessor itself (private or embedded contexts). */
export function getPlayStorage(scope = globalThis) {
  try { return scope.localStorage; } catch { return null; }
}

/* Storage: its own key, the newest 100 rounds. */
export function readPlayedRounds(storage) {
  try {
    return storedRounds(storage);
  } catch { return []; }
}
function storedRounds(storage) {
  const raw = storage.getItem(PLAY_KEYS.rounds);
  if (raw == null) return [];
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.rounds)) throw new Error('Ogiltig rundhistorik');
  return data.rounds;
}

const sameRound = (a, b) => a.id === b.id && a.slug === b.slug;

function writeHistory(storage, rounds, round) {
  const next = rounds.filter(r => !sameRound(r, round));
  next.push(round);
  const data = JSON.stringify({ version: 1, rounds: next.slice(-100) });
  storage.setItem(PLAY_KEYS.rounds, data);
  if (storage.getItem(PLAY_KEYS.rounds) !== data) throw new Error('Resultatet kunde inte verifieras');
}

export function savePlayedRound(storage, round) {
  try {
    const rounds = storedRounds(storage);
    if (rounds.some(r => sameRound(r, round) && r.endedAt != null)) return false;
    writeHistory(storage, rounds, round);
    return true;
  } catch { return false; }
}

/** One settled simulator lie per course. A stroke in flight still has its previous
    address saved; relief and its penalty are stored together when it lands. */
function storedCheckpoint(storage, slug, holeCount = null) {
  const raw = storage.getItem(PLAY_KEYS.checkpoint + slug);
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  if (!saved || saved.version !== 1) return null;
  const { round, position } = saved;
  if (round?.slug !== slug || !Number.isFinite(round.id) || round.endedAt != null ||
      !Array.isArray(round.order) || !round.order.length || (holeCount != null && round.order.length !== holeCount) ||
      !round.order.every(n => Number.isInteger(n) && n >= 1 && n <= round.order.length) ||
      new Set(round.order).size !== round.order.length || !round.order.includes(round.current) ||
      !round.pars || !round.holes || !round.holes[round.current] || !Number.isInteger(round.tee) || round.tee < 0) return null;
  if (!Object.values(round.holes).every(c => c && [c.strokes, c.putts, c.penalties].every(n => Number.isInteger(n) && n >= 0) && Array.isArray(c.shots))) return null;
  if (!Array.isArray(position?.ball) || position.ball.length !== 2 || !position.ball.every(Number.isFinite) ||
      !['address', 'holed'].includes(position.phase)) return null;
  return saved;
}

export function readPlayCheckpoint(storage, slug, holeCount = null) {
  try {
    const saved = storedCheckpoint(storage, slug, holeCount);
    // History commits the finish. A failed cleanup must never offer a finished round again.
    if (saved && readPlayedRounds(storage).some(r => sameRound(r, saved.round) && r.endedAt != null)) return null;
    return saved;
  } catch { return null; }
}

export function writePlayCheckpoint(storage, round, position, previousRevision) {
  try {
    const rounds = storedRounds(storage);
    const ended = candidate => rounds.some(r => sameRound(r, candidate) && r.endedAt != null);
    if (ended(round)) return { error: 'conflict' };
    const current = storedCheckpoint(storage, round.slug, round.order.length);
    const activeRevision = current?.round && !ended(current.round) ? current.revision ?? null : null;
    if (previousRevision !== undefined && activeRevision !== previousRevision) return { error: 'conflict' };
    const revision = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const key = PLAY_KEYS.checkpoint + round.slug;
    const data = JSON.stringify({ version: 1, revision, round, position });
    storage.setItem(key, data);
    if (storage.getItem(key) !== data) return { error: 'unavailable' };
    return { revision };
  } catch { return { error: 'unavailable' }; }
}

export function savePlayCheckpoint(storage, round, position, previousRevision) {
  return writePlayCheckpoint(storage, round, position, previousRevision).revision ?? null;
}

export function clearPlayCheckpoint(storage, round, revision) {
  try {
    const current = storedCheckpoint(storage, round.slug);
    if (current?.round?.id === round.id && (revision === undefined || current.revision === revision)) storage.removeItem(PLAY_KEYS.checkpoint + round.slug);
  } catch { /* An unavailable store does not interrupt a round. */ }
}

/** Archive once, then discard just this revision's resume point. Archiving is the
    commit, so cleanup can safely be retried if storage closes between writes. */
export function finishPlayRound(storage, round, revision, endedAt = Date.now()) {
  if (!revision) return 'conflict';
  try {
    const rounds = storedRounds(storage);
    const previous = rounds.find(r => sameRound(r, round) && r.endedAt != null);
    if (previous && previous.finishRevision !== revision) return 'conflict';
    if (!previous) {
      const current = storedCheckpoint(storage, round.slug);
      if (current?.round?.id !== round.id || current.revision !== revision) return 'conflict';
      writeHistory(storage, rounds, { ...round, endedAt, finishRevision: revision });
    }
    clearPlayCheckpoint(storage, round, revision);
    return 'finished';
  } catch { return 'unavailable'; }
}
