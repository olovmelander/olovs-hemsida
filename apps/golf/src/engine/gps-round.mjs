/* GPS mode's round: which hole the player is on, and which course.

   Pure -- no DOM, no THREE, no clock of its own (every fix brings its time) --
   so a whole round can be walked through it in a unit test on every course's
   real geometry, which is how the thresholds below were chosen.

   THE HOLE. Nearest centreline was the old rule, and on a real course it is
   wrong exactly where a golfer notices: the walk from a green to the next tee
   crosses other holes, and a slice into the neighbouring fairway is nearer
   that fairway's line than your own. The apps golfers already hold follow the
   ROUND instead, and so does this:

   - on your own green you are on your hole, whatever else is near;
   - the next hole starts once you have been on your green and head for its
     tee -- past the halfway point of the walk, or standing on it when the tee
     is right beside the green. Without a visit to your green (a ball picked
     up) the next tee has to hold you for a minute and a half, because a next
     tee often sits beside the current fairway and a ball lies there;
   - anywhere in your own corridor or on your own tee you stay put;
   - any OTHER hole needs sustained evidence -- standing on its tee or its
     green, or on its fairway while far from your own line -- for a minute and
     a half. A crossing on the walk between holes never lasts that long, and a
     ball that comes to rest on another hole is usually played within it.

   Every threshold was set by walking simulated rounds -- tee, fairway, green,
   next tee, at a golfer's pace, with GPS error that drifts as a phone's does --
   through all thirteen courses' real geometry; gps-round.test.mjs keeps that
   walk as the gate.

   A hole picked by hand wins until the player walks away from where they
   picked it (`holdRelease`): looking ahead at the next hole from the current
   tee is the most natural thing in the world, and GPS must not snatch the view
   back while they do. After that the tracker looks afresh, with the picked
   hole as its first guess, so a correction sticks and a preview lapses.

   THE COURSE. `rankCourses` measures a fix against every course's hole lines
   -- the compact `gps` record emit-manifest derives from each pack -- through
   the same gpsToLocal the player uses, so a grid-authored pack is placed by
   its SWEREF 99 TM frame and a flat-earth one by its own origin, and the
   course ranking cannot disagree with the hole tracking about where a fix is. */
import { gpsToLocal, nearestHole, nearestPointOnLine } from './caddie.js';

export const ROUND_DEFAULTS = Object.freeze({
  /* at a tee: metres from any of the hole's tee marks. A pad is ten metres
     long and the marks sit on it, so this is the pad, the ground where a
     group waits beside it, and GPS slack. */
  teeZone: 22,
  /* on a green: metres outside its surveyed ring, which takes in the collar */
  greenZone: 8,
  /* ANOTHER hole's tee or green is evidence only when the player is ON it --
     the pad itself, the putting surface -- never beside it, because a ball
     comes to rest beside other holes' tees and greens all the time */
  onOtherTee: 12,
  onOtherGreen: 4,
  /* inside a hole's corridor: metres from its centreline */
  corridor: 45,
  /* another hole's fairway only counts while you are this far from your own
     line -- adjacent fairways run 40-80 m apart and a slice lands between */
  corridorInner: 25,
  farFromCurrent: 80,
  /* Nearer the next tee than your green and this far from the green: the hole
     changes on that fix. Closer in -- the next tee beside the green, which is
     common -- the collar and the tee are a few metres apart, inside GPS error,
     so `nearTeeVotes` of the last `nearTeeWindow` fixes must say "tee", over
     at least `nearTeeMs`. A player putting out never produces that; one
     standing on the tee does within seconds. */
  leaveGreen: 25,
  nearTeeWindow: 6,
  nearTeeVotes: 5,
  nearTeeMs: 6000,
  /* the next tee without a visit to your green (standing ON it, onOtherTee),
     and any other hole: this long, over at least this many fixes, most of them
     agreeing -- a fix that lands just outside a zone is GPS noise, a run of
     them is somewhere else. At 45 s the simulated rounds still jumped: a ball
     at rest for 40 s plus the walk in and out is 45 s of evidence. */
  unreadyDwellMs: 90000,
  jumpDwellMs: 90000,
  jumpFixes: 3,
  jumpAgreement: 0.8,
  /* A round never goes back to a tee it has played, but a ball comes to rest
     on one: the tee of a hole BEHIND the one on screen has to hold the player
     for two and a half minutes. (Its green does not -- that is the correction
     when the tracker moved on too soon.) */
  behindTeeDwellMs: 150000,
  /* a hand-picked hole holds until the player is this far from where they picked it */
  holdRelease: 40,
  /* a fix coarser than this is drawn but never changes the hole */
  maxAccuracy: 40,
  /* nearer no hole than this: not on this course */
  offCourse: 450,
});

const DEFAULT_GREEN_RADIUS = 12;

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* 0 on the putting surface, else the metres to its edge. Some rings are stored
   closed and some open, and the closing edge is walked either way. */
export function greenDistance(point, hole) {
  const ring = hole?.green?.ring;
  if (Array.isArray(ring) && ring.length >= 3) {
    if (pointInRing(point, ring)) return 0;
    return nearestPointOnLine(point, [...ring, ring[0]]).distance;
  }
  const c = hole?.green?.c || hole?.pin || hole?.line?.at(-1);
  return c ? Math.max(0, Math.hypot(point[0] - c[0], point[1] - c[1]) - DEFAULT_GREEN_RADIUS) : Infinity;
}

/* metres to the nearest of the hole's tee marks -- every tee counts, since the
   forward tees are where half the field starts */
export function teeDistance(point, hole) {
  const marks = (hole?.tees?.marks || []).map(m => m?.c).filter(Array.isArray);
  const points = marks.length ? marks : hole?.line?.[0] ? [hole.line[0]] : [];
  let best = Infinity;
  for (const c of points) best = Math.min(best, Math.hypot(point[0] - c[0], point[1] - c[1]));
  return best;
}

function measure(point, holes) {
  const out = new Map();
  let nearest = null;
  for (const hole of holes) {
    const line = nearestPointOnLine(point, hole.line || []).distance;
    const m = { n: hole.n, line, tee: teeDistance(point, hole), green: greenDistance(point, hole) };
    out.set(hole.n, m);
    if (!nearest || line < nearest.distance) nearest = { hole: hole.n, distance: line };
  }
  return { byHole: out, nearest };
}

export function createHoleTracker(holes, options = {}) {
  const o = { ...ROUND_DEFAULTS, ...options };
  const list = (holes || []).filter(h => Number.isInteger(h?.n) && Array.isArray(h.line) && h.line.length);
  const numbers = list.map(h => h.n).sort((a, b) => a - b);
  const known = n => numbers.includes(n);
  const nextOf = n => numbers[(numbers.indexOf(n) + 1) % numbers.length];

  /* `hole` is always a hole (the one on screen until a fix says otherwise);
     `settled` says whether a fix has chosen it yet. */
  let hole = numbers[0] ?? null, settled = false, visitedGreen = false;
  let pending = null, hold = null, lastPoint = null, nearTee = [];

  /* Evidence for a hole other than the one on screen: the fixes that agree, and
     the ones in between that point nowhere in particular. A fix on the current
     hole clears it; a fix for a different hole starts it again. */
  const vote = (n, time) => {
    if (pending?.hole === n) pending.votes++;
    else pending = { hole: n, since: time, votes: 1, misses: 0 };
    return pending;
  };
  const sustained = (p, time, dwell) => p.votes >= o.jumpFixes && time - p.since >= dwell &&
    p.votes >= o.jumpAgreement * (p.votes + p.misses);
  const change = (n, reason, m) => {
    hole = n; settled = true; pending = null; nearTee = [];
    visitedGreen = m.byHole.get(n).green <= o.greenZone;
    return { reason, changed: true };
  };

  /* No history to lean on: a green, then a tee, then the hole on screen if the
     player is inside its corridor, then the nearest line with the hole on
     screen favoured -- the old rule, which is right when nothing better is known. */
  function initial(m, hint) {
    const all = [...m.byHole.values()];
    const onGreen = all.filter(x => x.green <= o.greenZone).sort((a, b) => a.green - b.green);
    const onTee = all.filter(x => x.tee <= o.teeZone).sort((a, b) => a.tee - b.tee);
    const hinted = m.byHole.get(hint);
    let pick;
    if (onGreen.length) pick = onGreen.some(x => x.n === hint) ? hint : onGreen[0].n;
    else if (onTee.length) pick = onTee.some(x => x.n === hint) ? hint : onTee[0].n;
    else if (hinted && hinted.line <= o.corridor) pick = hint;
    else pick = nearestHole(lastPoint, list, hint)?.hole ?? m.nearest.hole;
    const moved = pick !== hole;
    hole = pick; settled = true; pending = null; nearTee = [];
    visitedGreen = m.byHole.get(pick).green <= o.greenZone;
    return { reason: 'initial', changed: moved };
  }

  function track(m, time) {
    const cur = m.byHole.get(hole);
    const nextN = nextOf(hole), next = nextN !== hole ? m.byHole.get(nextN) : null;
    if (cur.green <= o.greenZone) visitedGreen = true;

    /* the next hole: once your green is done, being nearer its tee than your
       green is the round moving on */
    if (next && visitedGreen && cur.green < o.leaveGreen) {
      nearTee.push({ time, tee: next.tee <= o.teeZone && next.tee < cur.green });
      if (nearTee.length > o.nearTeeWindow) nearTee.shift();
      if (nearTee.filter(x => x.tee).length >= o.nearTeeVotes && time - nearTee[0].time >= o.nearTeeMs) {
        return change(nextN, 'next-tee', m);
      }
    }
    if (next && next.tee < cur.green) {
      if (visitedGreen) {
        if (cur.green >= o.leaveGreen) return change(nextN, 'next-tee', m);
        return { reason: 'next-tee-pending', changed: false };
      }
      if (next.tee <= o.onOtherTee) {
        if (sustained(vote(nextN, time), time, o.unreadyDwellMs)) return change(nextN, 'next-tee-dwell', m);
        return { reason: 'next-tee-pending', changed: false };
      }
    }
    if (cur.green <= o.greenZone) { pending = null; return { reason: 'green', changed: false }; }
    if (cur.line <= o.corridor || cur.tee <= o.teeZone) { pending = null; return { reason: 'corridor', changed: false }; }

    /* somewhere else: the strongest evidence for any other hole, and time */
    let best = null;
    const behind = n => (numbers.indexOf(n) - numbers.indexOf(hole) + numbers.length) % numbers.length > numbers.length / 2;
    for (const x of m.byHole.values()) {
      if (x.n === hole) continue;
      const onGreen = x.green <= o.onOtherGreen, onTee = x.tee <= o.onOtherTee;
      const strong = Math.min(onTee ? x.tee : Infinity, onGreen ? x.green : Infinity);
      const weak = x.line <= o.corridorInner && cur.line >= (x.n === nextN && visitedGreen ? o.corridor : o.farFromCurrent)
        ? 100 + x.line : Infinity;
      const score = Math.min(strong, weak);
      const dwell = onTee && !onGreen && strong < Infinity && behind(x.n) ? o.behindTeeDwellMs : o.jumpDwellMs;
      if (score < Infinity && (!best || score < best.score)) best = { n: x.n, score, dwell };
    }
    if (!best) {
      if (pending) pending.misses++;
      return { reason: 'between', changed: false };
    }
    const p = vote(best.n, time);
    if (best.n === nextN && visitedGreen) {
      if (p.votes >= 2) return change(best.n, 'next-hole', m);
    } else if (sustained(p, time, best.dwell)) {
      return change(best.n, 'jump', m);
    }
    return { reason: 'jump-pending', changed: false };
  }

  return {
    get hole() { return hole; },
    get settled() { return settled; },
    get held() { return Boolean(hold); },

    /* the hole on screen before any fix -- a first guess, not a claim */
    hint(n) {
      if (!known(n) || settled) return;
      hole = n;
    },

    /* The player picked a hole. With a position, it holds until they walk away
       from it; without one, it is only the first guess for the first fix. */
    manual(n, point = lastPoint) {
      if (!known(n)) return;
      hole = n; pending = null; visitedGreen = false; nearTee = [];
      if (point) { hold = { anchor: [...point] }; settled = true; }
      else { hold = null; settled = false; }
    },

    /* fix: { point: [x, z] in the course frame, accuracy (m), time (ms) } */
    update(fix) {
      const point = fix?.point;
      if (!Array.isArray(point) || !numbers.length) return { hole, changed: false, reason: 'no-fix' };
      const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : 0;
      const time = Number.isFinite(fix.time) ? fix.time : 0;
      const m = measure(point, list);
      const base = { nearest: m.nearest, distance: m.byHole.get(hole).line };
      if (m.nearest.distance > o.offCourse) return { ...base, hole, changed: false, reason: 'off-course', offCourse: true };
      if (accuracy > o.maxAccuracy) return { ...base, hole, changed: false, reason: 'weak', weak: true };
      lastPoint = [...point];

      let step;
      if (hold) {
        if (Math.hypot(point[0] - hold.anchor[0], point[1] - hold.anchor[1]) < o.holdRelease) {
          return { ...base, hole, changed: false, reason: 'held', held: true };
        }
        hold = null;
        step = initial(m, hole);
      } else if (!settled) step = initial(m, hole);
      else step = track(m, time);
      return { ...base, distance: m.byHole.get(hole).line, hole, ...step };
    },
  };
}

/* ------------------------------------------------------------------ courses */

export const COURSE_DEFAULTS = Object.freeze({
  /* within this of a course's nearest hole line: at that course. The same
     number the hole tracker calls off-course, so the two never disagree. */
  atCourse: 450,
  /* standing on a hole of a course: its line this near */
  onHole: 45,
  /* a fix coarser than this never moves anyone to another course */
  maxAccuracy: 100,
  /* A course that shares its ground with the one on screen -- a nine beside
     its eighteen -- wins only from its own line, clearly away from every line
     of the course on screen, with a fix good enough to tell the two apart.
     The closest a korthålsbana line comes to a Mästerskapsbana line is 33 m,
     measured, which is what these sit around. */
  sharedOnHole: 20,
  sharedMargin: 50,
  sharedAccuracy: 25,
  sharedDwellMs: 60000,
  sharedFixes: 3,
});

const sameGround = (a, b) => a.gps?.origin?.lat === b.gps?.origin?.lat &&
  a.gps?.origin?.lon === b.gps?.origin?.lon && a.gps?.frame === b.gps?.frame;

/* Every course with a `gps` record, measured against one WGS84 fix: the metres
   to its nearest hole line, which hole that is, and the course's manifest
   order. Nearest first. A course whose frame cannot place the fix is skipped
   rather than guessed at. */
export function rankCourses(coords, courses) {
  const out = [];
  (courses || []).forEach((course, order) => {
    const gps = course?.gps;
    if (!Array.isArray(gps?.lines) || !gps.lines.length) return;
    let local;
    try { local = gpsToLocal(coords, gps); } catch { return; }
    let best = null;
    gps.lines.forEach((line, i) => {
      const hit = nearestPointOnLine(local, line);
      if (!best || hit.distance < best.distance) best = { hole: i + 1, distance: hit.distance };
    });
    if (best) out.push({ slug: course.slug, name: course.name, order, course, point: local, ...best });
  });
  return out.sort((a, b) => a.distance - b.distance);
}

/* Which course a ranked fix says the player is on, or null to stay put.

   Off the course on screen (the case every "wrong course" is), any course
   within reach wins: the one whose hole the player stands on, else the
   nearest -- and in a car park shared by two courses, the club's first-listed
   one, so the eighteen opens rather than its nine. On the course on screen,
   only a course sharing its ground can take over, and only from its own line
   (`immediate: false` -- the caller wants it held for a while mid-round). */
export function chooseCourse(ranked, { current = null, accuracy = 0, declined = [], options = {} } = {}) {
  const o = { ...COURSE_DEFAULTS, ...options };
  if (!ranked?.length || !(accuracy <= o.maxAccuracy)) return null;
  const here = ranked.find(r => r.slug === current);
  const hereDistance = here ? here.distance : Infinity;
  const allowed = r => r.slug !== current && !declined.includes(r.slug);

  if (hereDistance > o.atCourse) {
    const within = ranked.filter(r => r.distance <= o.atCourse && allowed(r));
    if (!within.length) return null;
    let pick = within.find(r => r.distance <= o.onHole) || within[0];
    if (pick.distance > o.onHole) {
      const first = within.filter(r => sameGround(r.course, pick.course)).sort((a, b) => a.order - b.order)[0];
      if (first) pick = first;
    }
    return { ...pick, reason: 'off-course', immediate: true };
  }
  if (!(accuracy <= o.sharedAccuracy)) return null;
  const sibling = ranked.find(r => allowed(r) && r.distance <= o.sharedOnHole &&
    hereDistance >= r.distance + o.sharedMargin && (!here || sameGround(r.course, here.course)));
  return sibling ? { ...sibling, reason: 'shared-ground', immediate: false } : null;
}

/* Holds a shared-ground choice until it has been the answer for a while; an
   off-course choice (or the first good fix of a session) passes straight
   through. Any fix that does not agree starts the wait again. */
export function createCourseWatch(options = {}) {
  const o = { ...COURSE_DEFAULTS, ...options };
  let pending = null;
  return {
    step(choice, time, { first = false } = {}) {
      if (!choice) { pending = null; return null; }
      if (choice.immediate || first) { pending = null; return choice; }
      if (pending?.slug !== choice.slug) pending = { slug: choice.slug, since: time, count: 0 };
      pending.count++;
      if (pending.count >= o.sharedFixes && time - pending.since >= o.sharedDwellMs) {
        pending = null;
        return choice;
      }
      return null;
    },
    reset() { pending = null; },
  };
}

/* "320 m" or "3,2 km" -- the Swedish decimal comma, as everywhere in the HUD */
export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '';
  if (metres < 1000) return `${Math.max(1, Math.round(metres))} m`;
  const km = metres / 1000;
  return `${(km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',')} km`;
}
