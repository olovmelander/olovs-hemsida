/* The shot log: what the club wheel writes. Pure.

   A golfer locks a club at the ball, which starts a shot from that spot, and locks
   the next club at the ball's new lie, which ends it there. So every shot is two
   GPS fixes and a club, and a round becomes the distance of every club and the path
   of every hole. See docs/club-wheel.md for why it is built the way it is.

   What GPS can and cannot say sets the rules here. A phone is good to about 5 m, so
   one shot's length is rough and a club's typical length, over many shots, is good.
   A putt is shorter than the error: putts are counted, never measured. And the ball
   stops where it stops, so these are total lengths, roll included, not carry. */
import { ringSD } from '../engine/geom.js';

export const LOG_VERSION = 1;
/* The same ball, near enough: a second lock here is a retake or a change of mind. */
export const SAME_SPOT_METRES = 12;
/* A fix looser than this still counts the stroke, but says nothing of a length. */
export const MEASURABLE_ACCURACY_METRES = 15;
/* A club's length is told only by enough of its shots. */
export const LEAST_SHOTS = 5;
const PUTTER_ID = 'putter';

/* By what it does, since a bag's own putter can have any name. */
export const isPutter = club => club?.carry === 0 || club?.id === PUTTER_ID || club === PUTTER_ID;
export const isPutt = shot => shot.putt === true || shot.club === PUTTER_ID;
const metresBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const shotLength = shot => (shot.to ? metresBetween(shot.from, shot.to) : null);
/* Past this a club cannot have gone: a lock was missed on the way. */
export const reachOf = club => (club?.carry ? club.carry * 1.4 + 20 : Infinity);
export const openShot = shots => {
  const last = shots.at(-1);
  return last && !last.to && last.outcome === 'open' ? last : null;
};

/* What a point is on the course: the tightest surface first. */
export function surfaceAt(point, hole, waters = []) {
  const inside = ring => ringSD(point[0], point[1], ring) < 0;
  if (hole.green?.ring && inside(hole.green.ring)) return 'green';
  if (hole.bunkers?.some(inside)) return 'bunker';
  if (hole.teePads?.some(inside)) return 'tee';
  if (hole.fairways?.some(inside)) return 'fairway';
  if (waters.some(water => inside(water.ring))) return 'water';
  return 'rough';
}

/* A lock at the ball: the shot under way ends here, and a new one starts. Returns a
   new list, and a shot left open on another hole never reaches this far. */
export function lockShot(shots, { hole, club, point, accuracy, at, lie = null, rise = null, farthest = Infinity, meta = {} }) {
  const list = shots.slice();
  const open = openShot(list);
  if (open) {
    /* Further than the club goes: a lock was missed in between, and this is two shots. */
    const suspect = metresBetween(open.from, point) > farthest;
    list[list.length - 1] = { ...open, to: point, toAccuracy: accuracy, toLie: lie, outcome: 'played', rise, suspect };
  }
  list.push({ ...meta, hole, club: club.id, ...(isPutter(club) ? { putt: true } : {}), at, from: point, fromAccuracy: accuracy, fromLie: lie, to: null, toAccuracy: null, toLie: null, outcome: 'open', penalty: 0, rise: null });
  return list;
}

/* A club changed at the same spot before the ball was struck. */
export const changeClub = (shots, club) => {
  const open = openShot(shots);
  return open ? [...shots.slice(0, -1), { ...open, club: club.id }] : shots;
};

/* The wrong club found out later, on any shot of the round. The length stands, since
   GPS measured it, and is now this club's, so the check for a missed lock is made again.
   A putt is counted rather than measured, and has no club to put right. */
export function correctClub(shots, shot, club) {
  const index = shots.indexOf(shot);
  if (index < 0 || isPutt(shot) || isPutter(club)) return shots;
  const list = shots.slice();
  list[index] = { ...shot, club: club.id, ...(shot.to ? { suspect: shotLength(shot) > reachOf(club) } : {}) };
  return list;
}

/* Out of bounds or lost: the ball goes again from the same place, one stroke on. The
   shot stays a stroke and leaves the clubs' lengths, since it has no end. */
export function retakeShot(shots, { club, at }) {
  const open = openShot(shots);
  if (!open) return shots;
  return [...shots.slice(0, -1), { ...open, outcome: 'out', penalty: 1 },
    { ...open, club: club.id, at, penalty: 0 }];
}

/* Putts are counted, not walked: the hole's putter shots become this many. */
export function setPutts(shots, hole, count, matches = () => true) {
  const putt = shot => shot.hole === hole && isPutt(shot) && matches(shot);
  const first = shots.find(putt);
  if (!first) return shots;
  return [...shots.filter(shot => !putt(shot)), ...Array.from({ length: count }, () => ({ ...first, outcome: 'ended', to: null }))];
}

/* A penalty taken where the ball is, as from water: on the shot that went there. */
export function addPenalty(shots) {
  for (let k = shots.length - 2; k >= 0; k--) {
    if (shots[k].outcome === 'played') {
      const list = shots.slice();
      list[k] = { ...shots[k], penalty: shots[k].penalty + 1, inHazard: true };
      return list;
    }
  }
  return shots;
}

/* The hole is over. The last shot was a putt, or went in, or nobody locked its end:
   it counts as a stroke either way, with no length to its name. */
export function closeHole(shots, hole) {
  const open = openShot(shots);
  if (!open || open.hole !== hole) return shots;
  return [...shots.slice(0, -1), { ...open, outcome: 'ended' }];
}

/* Strokes the log can vouch for on a hole, with the putts told apart: the card takes
   them from here. */
export function holeTally(shots, hole) {
  let strokes = 0, penalties = 0, putts = 0;
  for (const shot of shots) {
    if (shot.hole !== hole) continue;
    strokes++;
    penalties += shot.penalty;
    if (isPutt(shot)) putts++;
  }
  return { strokes: strokes + penalties, shots: strokes, penalties, putts };
}

export const isMeasured = shot => shot.outcome === 'played' && shot.to && !shot.inHazard && !shot.suspect
  && !isPutt(shot) && shot.fromAccuracy <= MEASURABLE_ACCURACY_METRES && shot.toAccuracy <= MEASURABLE_ACCURACY_METRES;

/* A club's length is what it does when struck in earnest, and a log also holds every
   chip, top and punch-out with that club. So the lower third goes: a median of what
   is left stands up to them without a player marking each one. Its spread is where
   those earnest shots land, without the one in ten that went furthest. */
export function clubStats(shots) {
  const byClub = new Map();
  for (const shot of shots) {
    if (!isMeasured(shot)) continue;
    if (!byClub.has(shot.club)) byClub.set(shot.club, []);
    byClub.get(shot.club).push(shotLength(shot));
  }
  const stats = new Map();
  for (const [club, lengths] of byClub) {
    const sorted = [...lengths].sort((a, b) => a - b);
    const earnest = sorted.slice(Math.floor(sorted.length / 3));
    stats.set(club, {
      shots: sorted.length,
      typical: earnest[earnest.length >> 1],
      longest: sorted.at(-1),
      shortest: earnest[0],
      reach: earnest[Math.ceil(earnest.length * 0.9) - 1],
      known: sorted.length >= LEAST_SHOTS,
    });
  }
  return stats;
}

/* The bag as the player really hits it: their own length where the log can say, and
   the bag's figure where it cannot yet. */
export const learnedBag = (bag, stats) => bag.map(club => {
  const own = stats.get(club.id);
  return own?.known && club.carry > 0 ? { ...club, carry: Math.round(own.typical), learned: true } : club;
});

const MAX_STORED_SHOTS = 6000;

/* The history a player's lengths are drawn from, across every round. An old or
   damaged store is a fresh start, never a broken map. */
export function parseHistory(text) {
  try {
    const stored = JSON.parse(text);
    return stored?.version === LOG_VERSION && Array.isArray(stored.shots) ? stored.shots : [];
  } catch { return []; }
}
export const storeHistory = shots => JSON.stringify({ version: LOG_VERSION, shots: shots.slice(-MAX_STORED_SHOTS) });
