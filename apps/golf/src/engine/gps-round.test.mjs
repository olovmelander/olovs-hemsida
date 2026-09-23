/* GPS mode's round and course choice: the rules on synthetic holes, where each
   is easiest to read, and then the gate the thresholds were set against --
   simulated rounds walked through all thirteen courses' real geometry. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COURSE_DEFAULTS, ROUND_DEFAULTS, chooseCourse, createCourseWatch, createHoleTracker, formatDistance,
  greenDistance, rankCourses, teeDistance,
} from './gps-round.mjs';
import { gpsToLocal, nearestPointOnLine, pointAlongLine } from './caddie.js';
import { PROJECTED_GPS_FRAMES } from './gps-projected-frames.mjs';
import { sweref99TmToLatLon } from '../../../../packages/course-geo/chmv2/projection.mjs';
import { inflateStream, readPack } from '../../../../packages/course-pack/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const packHoles = slug => JSON.parse(inflateStream(readPack(readFileSync(
  path.join(ROOT, 'apps/golf/public/courses', slug, 'pack.bin'))).sv).toString('utf8')).holes;

const ring = (c, r, n = 16) => Array.from({ length: n }, (_, i) =>
  [c[0] + Math.cos(i / n * Math.PI * 2) * r, c[1] + Math.sin(i / n * Math.PI * 2) * r]);
const hole = (n, tee, green) => ({ n, line: [tee, green], tees: { marks: [{ c: tee }] }, green: { c: green, ring: ring(green, 12) } });

/* North up the page: 1 plays north, 2 east from beside 1's green, 3 south,
   4 west back to the start; 5 runs parallel to 1, 50 m east, the neighbouring
   fairway a slice ends up on. */
const HOLES = [
  hole(1, [0, 0], [0, -300]),
  hole(2, [70, -310], [340, -320]),
  hole(3, [360, -290], [360, 0]),
  hole(4, [330, 30], [100, 60]),
  hole(5, [50, -280], [50, -20]),
];

/* a clock and a fix every two seconds, as a phone delivers them */
function walker(tracker, start = [0, 0]) {
  let time = 0, at = [...start];
  const results = [];
  const fix = (point, accuracy = 5) => {
    const r = tracker.update({ point, accuracy, time });
    results.push(r); time += 2000; at = point;
    return r;
  };
  return {
    results, fix,
    stay: (seconds, point = at) => { let r; for (let s = 0; s < seconds; s += 2) r = fix(point); return r; },
    walk: (to, speed = 1.3) => {
      const from = at, d = Math.hypot(to[0] - from[0], to[1] - from[1]), steps = Math.max(1, Math.ceil(d / (speed * 2)));
      let r; for (let k = 1; k <= steps; k++) r = fix([from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps]);
      return r;
    },
    get time() { return time; },
  };
}

describe('hole geometry', () => {
  it('measures a green to its ring and a tee to its nearest mark', () => {
    expect(greenDistance([0, -300], HOLES[0])).toBe(0);
    expect(greenDistance([0, -330], HOLES[0])).toBeCloseTo(18, 0);
    expect(teeDistance([3, 4], HOLES[0])).toBe(5);
  });
});

describe('the first fix', () => {
  it('takes the green or the tee it stands on over the hole on screen', () => {
    const onGreen = createHoleTracker(HOLES); onGreen.hint(1);
    expect(onGreen.update({ point: [340, -318], accuracy: 5, time: 0 })).toMatchObject({ hole: 2, changed: true, reason: 'initial' });
    const onTee = createHoleTracker(HOLES); onTee.hint(1);
    expect(onTee.update({ point: [362, -288], accuracy: 5, time: 0 }).hole).toBe(3);
  });

  it('keeps the hole on screen when the player is inside its corridor', () => {
    /* 30 m from 1's line and 20 m from 5's: the old nearest-line rule took 5 */
    const kept = createHoleTracker(HOLES); kept.hint(1);
    expect(kept.update({ point: [30, -150], accuracy: 5, time: 0 }).hole).toBe(1);
    const other = createHoleTracker(HOLES); other.hint(5);
    expect(other.update({ point: [30, -150], accuracy: 5, time: 0 }).hole).toBe(5);
  });

  it('never decides on a coarse fix, and says when the player is off the course', () => {
    const t = createHoleTracker(HOLES); t.hint(1);
    expect(t.update({ point: [340, -318], accuracy: 60, time: 0 })).toMatchObject({ hole: 1, changed: false, weak: true });
    expect(t.settled).toBe(false);
    expect(t.update({ point: [3000, 0], accuracy: 5, time: 2000 })).toMatchObject({ hole: 1, offCourse: true });
  });
});

describe('through a round', () => {
  it('moves on once the green is done and the player heads for the next tee', () => {
    const t = createHoleTracker(HOLES); t.hint(1);
    const w = walker(t);
    w.stay(30);
    w.walk([0, -290]); w.stay(60);
    expect(t.hole).toBe(1);
    const r = w.walk([70, -310]);
    expect(r.hole).toBe(2);
    /* before the tee: at the latest where the walk leaves the green's reach */
    const firstOn2 = w.results.findIndex(x => x.hole === 2);
    expect(w.results[firstOn2].reason).toBe('next-tee');
    expect(w.results.slice(0, firstOn2).every(x => x.hole === 1)).toBe(true);
  });

  it('does not move on from a ball beside the next tee before the green', () => {
    const holes = [hole(1, [0, 0], [0, -300]), hole(2, [40, -150], [300, -150])];
    const t = createHoleTracker(holes); t.hint(1);
    const w = walker(t);
    w.stay(10);
    w.walk([35, -150]);
    expect(w.stay(60).hole).toBe(1);
    /* a player who picked up and waits on the tee is on the next hole */
    expect(w.stay(40).hole).toBe(2);
  });

  it('holds on the neighbouring fairway and when crossing other holes', () => {
    const t = createHoleTracker(HOLES); t.hint(1);
    const w = walker(t);
    w.stay(10);
    w.walk([55, -120]); w.stay(80);          /* a slice onto 5's fairway, 55 m off line */
    expect(t.hole).toBe(1);
    w.walk([0, -290]); w.stay(40);
    w.walk([70, -310]);                      /* on to 2 */
    expect(t.hole).toBe(2);
    w.walk([340, -318]); w.stay(40);         /* green 2 */
    w.walk([100, 60]);                       /* a stroll across to 4's green, and straight back */
    w.walk([360, -290]);
    expect(w.results.every(x => [1, 2, 3].includes(x.hole))).toBe(true);
    expect(t.hole).toBe(3);
  });

  it('believes another hole after a minute and a half on its tee', () => {
    const t = createHoleTracker(HOLES); t.hint(1);
    const w = walker(t);
    w.stay(10);
    /* by cart, straight from the 1st tee to the 3rd, skipping the 2nd */
    expect(w.walk([362, -288], 8).hole).toBe(1);
    expect(w.stay(40).hole).toBe(1);
    expect(w.stay(60)).toMatchObject({ hole: 3 });
    expect(w.results.find(x => x.hole === 3).reason).toBe('jump');
  });

  it('needs two and a half minutes to go back to a tee already played', () => {
    const t = createHoleTracker(HOLES); t.hint(3);
    const w = walker(t, [360, -290]);
    w.stay(10);
    w.walk([2, 2]);
    expect(w.stay(120).hole).toBe(3);
    expect(w.stay(40).hole).toBe(1);
  });
});

describe('a hole picked by hand', () => {
  it('holds while the player stays put, then lapses when they walk on', () => {
    const t = createHoleTracker(HOLES); t.hint(1);
    const w = walker(t);
    w.stay(10);
    t.manual(3, [0, 0]);                     /* a look at the 3rd from the 1st tee */
    expect(w.stay(60)).toMatchObject({ hole: 3, held: true });
    w.walk([0, -60]);
    expect(t.hole).toBe(1);
  });

  it('sticks when it is where the player is', () => {
    const t = createHoleTracker(HOLES); t.hint(5);
    const w = walker(t, [30, -150]);
    expect(w.fix([30, -150]).hole).toBe(5);
    t.manual(1, [30, -150]);                 /* "no -- I am playing the 1st" */
    w.walk([10, -230]);
    expect(t.hole).toBe(1);
    expect(t.held).toBe(false);
  });

  it('is only a first guess before there is any fix', () => {
    const t = createHoleTracker(HOLES);
    t.manual(4);
    expect(t.update({ point: [340, -318], accuracy: 5, time: 0 }).hole).toBe(2);
  });
});

/* ------------------------------------------------------------ the courses */

const gpsOf = slug => MANIFEST.courses.find(c => c.slug === slug).gps;
/* the inverse of gpsToLocal, for building fixes: the grid frames through
   SWEREF 99 TM, the rest through their own flat-earth origin */
function toCoords(point, gps) {
  const projected = PROJECTED_GPS_FRAMES.find(f => f.packFrame === gps.frame);
  if (projected) {
    const [latitude, longitude] = sweref99TmToLatLon(
      projected.legacyOriginEpsg3006.easting + point[0], projected.legacyOriginEpsg3006.northing - point[1]);
    return { latitude, longitude, accuracy: 5 };
  }
  return { latitude: gps.origin.lat - point[1] / 111320, longitude: gps.origin.lon + point[0] / gps.mPerLon, accuracy: 5 };
}
const courseDistance = (point, gps) => Math.min(...gps.lines.map(line => nearestPointOnLine(point, line).distance));

describe('the manifest places every course', () => {
  it.each(MANIFEST.courses.map(c => [c.slug]))('%s: a fix on each hole ranks that course and hole first', slug => {
    const gps = gpsOf(slug);
    gps.lines.forEach((line, i) => {
      const mid = pointAlongLine(line, 0.5 * line.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - line[k][0], p[1] - line[k][1]), 0));
      const coords = toCoords(mid, gps);
      const local = gpsToLocal(coords, gps);
      expect(Math.hypot(local[0] - mid[0], local[1] - mid[1])).toBeLessThan(0.01);
      const [first] = rankCourses(coords, MANIFEST.courses);
      expect(first).toMatchObject({ slug, hole: i + 1 });
      expect(first.distance).toBeLessThan(0.01);
    });
  });
});

describe('choosing a course', () => {
  const coords = (slug, point) => toCoords(point, gpsOf(slug));
  const on = (slug, n, f = 0.5) => { const line = gpsOf(slug).lines[n - 1]; return pointAlongLine(line, f * 200); };

  it('moves a player off the course on screen to the course they stand on, at once', () => {
    const ranked = rankCourses(coords('puttom', on('puttom', 12, 0.3)), MANIFEST.courses);
    expect(chooseCourse(ranked, { current: 'visby', accuracy: 8 })).toMatchObject({ slug: 'puttom', hole: 12, immediate: true });
    expect(chooseCourse(ranked, { current: 'puttom', accuracy: 8 })).toBeNull();
    expect(chooseCourse(ranked, { current: 'visby', accuracy: 150 })).toBeNull();
  });

  it('leaves a player nowhere near a course where they are', () => {
    const far = rankCourses({ latitude: 61.5, longitude: 16.0 }, MANIFEST.courses);
    expect(far[0].distance).toBeGreaterThan(50000);
    expect(chooseCourse(far, { current: 'angso', accuracy: 5 })).toBeNull();
  });

  /* a point near both of Veckefjärden's courses but on neither's holes, the
     korthålsbana the nearer: the car park rule has to open the eighteen */
  it('opens the club\'s first-listed course from ground both courses share', () => {
    const big = gpsOf('veckefjarden'), kort = gpsOf('veckefjarden-korthalsbanan');
    let found = null;
    for (let x = -300; x <= 100 && !found; x += 5) for (let z = -400; z <= 50 && !found; z += 5) {
      const dk = courseDistance([x, z], kort), db = courseDistance([x, z], big);
      if (dk > COURSE_DEFAULTS.onHole && db > COURSE_DEFAULTS.onHole && dk < db && db < 300) found = [x, z];
    }
    expect(found).not.toBeNull();
    const ranked = rankCourses(coords('veckefjarden', found), MANIFEST.courses);
    expect(ranked[0].slug).toBe('veckefjarden-korthalsbanan');
    expect(chooseCourse(ranked, { current: 'angso', accuracy: 8 })).toMatchObject({ slug: 'veckefjarden', immediate: true });
  });

  it('takes a shared-ground course only from its own line, well clear of the course on screen', () => {
    const kort = gpsOf('veckefjarden-korthalsbanan'), big = gpsOf('veckefjarden');
    const clear = kort.lines.flatMap(line => [0.2, 0.5, 0.8].map(f => pointAlongLine(line, f * 100)))
      .find(p => courseDistance(p, big) > 70);
    const ranked = rankCourses(coords('veckefjarden', clear), MANIFEST.courses);
    expect(chooseCourse(ranked, { current: 'veckefjarden', accuracy: 8 }))
      .toMatchObject({ slug: 'veckefjarden-korthalsbanan', immediate: false, reason: 'shared-ground' });
    expect(chooseCourse(ranked, { current: 'veckefjarden', accuracy: 40 })).toBeNull();
    expect(chooseCourse(ranked, { current: 'veckefjarden', accuracy: 8, declined: ['veckefjarden-korthalsbanan'] })).toBeNull();
  });

  it('holds a shared-ground choice for a minute before acting on it', () => {
    const watch = createCourseWatch();
    const choice = { slug: 'b', immediate: false };
    expect(watch.step(choice, 0)).toBeNull();
    expect(watch.step(choice, 30000)).toBeNull();
    expect(watch.step(null, 40000)).toBeNull();
    expect(watch.step(choice, 50000)).toBeNull();
    expect(watch.step(choice, 80000)).toBeNull();
    expect(watch.step(choice, 112000)).toBe(choice);
    expect(watch.step({ slug: 'c', immediate: true }, 0)).toMatchObject({ slug: 'c' });
    expect(watch.step(choice, 0, { first: true })).toBe(choice);
  });

  it('formats a distance the way the HUD does', () => {
    expect(formatDistance(0.4)).toBe('1 m');
    expect(formatDistance(320.4)).toBe('320 m');
    expect(formatDistance(3240)).toBe('3,2 km');
    expect(formatDistance(12400)).toBe('12 km');
  });
});

/* ------------------------------------------------ simulated rounds, the gate
   A player walks every hole of every course: a minute on the tee, the shots
   down the line (one in seven missed by 35 m), forty seconds at each ball, two
   minutes on the green, then straight to the next tee -- at 1.3 m/s with a fix
   every two seconds. The GPS error is 4 m, white in one round and drifting as a
   phone's does (a ten-second memory) in the other. The tracker must follow the
   round with no false switch and no early one, and pick up each new hole at its
   tee at once -- except where a tee stands within GPS error of the green before
   it (Ribbingsfors' 3rd, 2 m from the 2nd green), where it waits until the
   player walks on rather than guess. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const polyLength = line => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);

function simulateRound(course, holes, { seed, phi }) {
  const r = rng(seed);
  const gauss = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const sigma = 4, innov = sigma * Math.sqrt(1 - phi * phi);
  const tracker = createHoleTracker(holes);
  tracker.hint(holes[0].n);
  let time = 0, pos = null, bias = [gauss() * sigma, gauss() * sigma];
  const log = [];
  const fix = truth => {
    bias = [bias[0] * phi + gauss() * innov, bias[1] * phi + gauss() * innov];
    log.push({ truth, hole: tracker.update({ point: [pos[0] + bias[0], pos[1] + bias[1]], accuracy: 6, time: time * 1000 }).hole });
    time += 2;
  };
  const walk = (to, truth) => {
    const from = [...pos], steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2.6));
    for (let k = 1; k <= steps; k++) { pos = [from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps]; fix(truth); }
  };
  const dwell = (seconds, truth, jitter = 1.5) => {
    const c = [...pos];
    for (let s = 0; s < seconds; s += 2) { pos = [c[0] + gauss() * jitter, c[1] + gauss() * jitter]; fix(truth); }
    pos = c;
  };
  const arrivals = [];
  holes.forEach((h, i) => {
    const mark = h.tees.marks[Math.min(course.tees.def ?? 0, h.tees.marks.length - 1)].c;
    if (i === 0) pos = [...mark]; else walk(mark, [holes[i - 1].n, h.n]);
    arrivals.push({ n: h.n, at: log.length });
    dwell(60, [h.n]);
    const L = polyLength(h.line);
    const shots = h.par <= 3 ? [] : h.par === 4 ? [Math.min(230, L - 90)] : [Math.min(235, L - 250), Math.min(420, L - 100)];
    for (const d0 of shots) {
      const d = Math.max(60, d0), on = pointAlongLine(h.line, d);
      const a = pointAlongLine(h.line, Math.max(0, d - 2)), b = pointAlongLine(h.line, d + 2);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, miss = r() < 0.15 ? gauss() * 35 : gauss() * 12;
      walk([on[0] - (b[1] - a[1]) / l * miss, on[1] + (b[0] - a[0]) / l * miss], [h.n]);
      dwell(40, [h.n]);
    }
    walk([h.green.c[0] + gauss() * 4, h.green.c[1] + gauss() * 4], [h.n]);
    dwell(120, [h.n], 4);
  });
  let switches = 0;
  for (let k = 1; k < log.length; k++) if (log[k].hole !== log[k - 1].hole) switches++;
  const early = log.filter(e => e.truth.length === 1 && e.hole !== e.truth[0] &&
    holes.findIndex(h => h.n === e.hole) > holes.findIndex(h => h.n === e.truth[0])).length;
  const stray = log.filter(e => !e.truth.includes(e.hole) && Math.abs(
    holes.findIndex(h => h.n === e.hole) - holes.findIndex(h => h.n === e.truth[0])) > 1).length;
  const latency = arrivals.slice(1).map(a => {
    let k = a.at; while (k < log.length && log[k].hole !== a.n) k++;
    return { n: a.n, seconds: (k - a.at) * 2 };
  });
  return { switches, early, stray, latency };
}

describe('simulated rounds on every course', () => {
  it.each(MANIFEST.courses.map(c => [c.slug, c]))('%s', (slug, course) => {
    const holes = packHoles(slug);
    for (const [seed, phi] of [[7919, 0], [15838, 0.82]]) {
      const round = simulateRound(course, holes, { seed, phi });
      expect(round.switches, `${slug} seed ${seed}: one switch per hole`).toBe(holes.length - 1);
      expect(round.early, `${slug} seed ${seed}: never ahead of the player`).toBe(0);
      expect(round.stray, `${slug} seed ${seed}: never on an unrelated hole`).toBe(0);
      const slow = round.latency.filter(l => l.seconds > 30);
      expect(slow.length, `${slug} seed ${seed}: slow at ${slow.map(l => `${l.n} (${l.seconds}s)`).join(', ')}`)
        .toBeLessThanOrEqual(slug === 'ribbingsfors' ? 1 : 0);
      expect(Math.max(...round.latency.map(l => l.seconds))).toBeLessThanOrEqual(120);
    }
  });

  it('keeps the round-tracking defaults the simulations were run with', () => {
    expect(ROUND_DEFAULTS).toMatchObject({ teeZone: 22, greenZone: 8, jumpDwellMs: 90000, holdRelease: 40, offCourse: 450 });
    expect(COURSE_DEFAULTS.atCourse).toBe(ROUND_DEFAULTS.offCourse);
  });
});
