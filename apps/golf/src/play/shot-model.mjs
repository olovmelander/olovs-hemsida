/* From the player's bag, the lie and the swing to a launch.

   Every club flies as far as the player's own bag says it carries: the full
   swing's ball speed is solved per club (speedForCarry), so the game and the
   real club statistics agree. The lie takes speed and spin off (a flyer from
   the rough, a fat shot from sand), and the swing's two errors become the
   ball's start line (the face) and its curve (the path).

   A shot is set up before it is played, as in the tour games: its type (full,
   punch, pitch, chip, flop, bump-and-run), its shape (draw to fade, the start
   line opened so it still lands on the aim), its height and its spin. The lie
   is read too: how the ball sits (a lie %, seeded per stroke, so a replay is
   the same), and the slope under the feet (uphill launches higher, a ball above
   the feet hooks). */
import { CLUB_LAUNCH, speedForCarry, puttSpeedFor, launchState, simulateShot, groundNormal, BALL, SURFACES } from './ball-physics.mjs';
import { clubKind } from '../engine/club-design.mjs';

/* The detailed course's lies (kikLie) as the physics' surfaces. */
export const LIE_SURFACE = Object.freeze({
  vatten: 'water', green: 'green', bunker: 'sand', tee: 'tee', fairway: 'fairway',
  stig: 'path', skog: 'forest', ruff: 'rough', fringe: 'fringe',
});
export const LIE_NAME = Object.freeze({
  water: 'Vatten', green: 'Green', sand: 'Bunker', tee: 'Tee', fairway: 'Fairway',
  path: 'Stig', forest: 'Skog', rough: 'Ruff', fringe: 'Förgreen',
});

/* What a lie does to a full swing. */
export const LIE_EFFECT = Object.freeze({
  tee:     { speed: 1, spin: 1, launch: 0, error: 1 },
  fairway: { speed: 1, spin: 1, launch: 0, error: 1 },
  fringe:  { speed: .98, spin: .95, launch: 0, error: 1 },
  green:   { speed: 1, spin: 1, launch: 0, error: 1 },
  path:    { speed: .97, spin: .85, launch: -.5, error: 1.15 },
  rough:   { speed: .88, spin: .62, launch: 1.5, error: 1.35 },
  forest:  { speed: .76, spin: .5, launch: 2, error: 1.7 },
  sand:    { speed: .78, spin: .7, launch: 3, error: 1.5 },
});

/* Shot types scale a club's full launch: speed (at full power), launch angle,
   spin and how much of a swing's error reaches the ball. Chips, pitches, flops
   and bump-and-runs are played with the short-game swing. */
export const SHOT_TYPES = Object.freeze({
  full:  { label: 'Full', speed: 1, launch: 1, spin: 1, error: 1, swing: null },
  punch: { label: 'Punch', speed: .92, launch: .7, spin: .85, error: .85, swing: null },
  pitch: { label: 'Pitch', speed: .76, launch: 1.1, spin: 1.02, error: .7, swing: 'Wedge' },
  chip:  { label: 'Chip', speed: .32, launch: .72, spin: .6, error: .55, swing: 'Wedge' },
  flop:  { label: 'Flopp', speed: .56, launch: 1.6, spin: 1.12, error: 1.25, swing: 'Wedge' },
  bump:  { label: 'Bump & run', speed: .23, launch: .5, spin: .3, error: .6, swing: 'Wedge' },
});
/* Shape, height and spin, each a step from the stock shot. */
export const SHAPES = Object.freeze({ '-2': 'Stor draw', '-1': 'Draw', 0: 'Rak', 1: 'Fade', 2: 'Stor fade' });
export const HEIGHTS = Object.freeze({ '-1': 'Låg', 0: 'Normal höjd', 1: 'Hög' });
export const SPINS = Object.freeze({ '-1': 'Toppspinn', 0: 'Normal spinn', 1: 'Bakspinn' });
export const STOCK_SETUP = Object.freeze({ type: 'full', shape: 0, height: 0, spin: 0 });
const WEDGES = new Set(['pw', 'gw', 'sw', 'lw']);

/** The shot types a club can play. */
export function shotTypesFor(club) {
  if (!club || club.cat === 'putter') return ['full'];
  if (WEDGES.has(club.cat)) return club.cat === 'pw' ? ['full', 'punch', 'pitch', 'chip'] : ['full', 'punch', 'pitch', 'chip', 'flop'];
  if (club.cat === 'iron7' || club.cat === 'iron8' || club.cat === 'iron9') return ['full', 'punch', 'bump'];
  if (/^iron/.test(club.cat) || club.cat === 'hybrid') return ['full', 'punch'];
  return ['full'];
}
/** Whether a shot type can be shaped (the short game is played straight). */
export const shapeable = type => type === 'full' || type === 'punch';
/** The golfer's swing for a club and a shot: short shots take the chip swing, full wedges the iron swing. */
export function swingFor(club, type = 'full') {
  if (!club || club.cat === 'putter') return 'Putter';
  if (SHOT_TYPES[type]?.swing) return SHOT_TYPES[type].swing;
  return club.swing === 'Wedge' ? 'Iron' : club.swing;
}
/** A setup that fits the club: an unplayable type falls back to full, the short game is straight. */
export function fitSetup(club, setup = STOCK_SETUP) {
  const type = shotTypesFor(club).includes(setup.type) ? setup.type : 'full';
  const clampStep = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
  return { type, shape: shapeable(type) && club.cat !== 'putter' ? clampStep(setup.shape, -2, 2) : 0,
    height: club.cat === 'putter' ? 0 : clampStep(setup.height, -1, 1), spin: club.cat === 'putter' ? 0 : clampStep(setup.spin, -1, 1) };
}

/**
 * The set-up after a change of club: the new club starts its own full swing, a
 * punch, the shape, height and spin kept where it can play them. A chip, pitch or
 * flop stays only from one wedge to another, where the short game is chosen club
 * by club. (Carried on to an iron or a wood, a chip read as that club's distance.)
 */
export function setupForClub(setup, from, to) {
  const wedge = c => WEDGES.has(c?.cat);
  const keep = setup.type === 'full' || setup.type === 'punch' || (wedge(from) && wedge(to));
  return fitSetup(to, { ...setup, type: keep ? setup.type : 'full' });
}

/* How the ball sits. The lie % is the share of a clean strike's speed the lie
   allows (the tour games' number); each lie's spread is seeded per stroke. */
export function lieQuality(surface, rand = Math.random, { plugged = false } = {}) {
  const base = LIE_EFFECT[surface] || LIE_EFFECT.fairway;
  let q = { label: 'Perfekt', speed: 1, spin: 1, launch: 0, error: 1 };
  if (surface === 'fringe' || surface === 'path') q.label = 'Bra';
  if (surface === 'rough') {
    const r = rand();
    q = r < .3 ? { label: 'Ligger uppe', speed: 1.06, spin: 1.15, launch: -.5, error: .85 }
      : r < .75 ? { label: 'Normal', speed: 1, spin: 1, launch: 0, error: 1 }
        : { label: 'Ligger djupt', speed: .86, spin: .7, launch: 1, error: 1.35 };
  } else if (surface === 'forest') {
    q = rand() < .5 ? { label: 'Normal', speed: 1, spin: 1, launch: 0, error: 1 } : { label: 'Ligger djupt', speed: .88, spin: .8, launch: 1, error: 1.25 };
  } else if (surface === 'sand') {
    q = plugged ? { label: 'Pluggad', speed: .72, spin: .4, launch: 3, error: 1.6 }
      : rand() < .35 ? { label: 'Ligger fint', speed: 1.08, spin: 1.15, launch: 0, error: .85 } : { label: 'Normal', speed: 1, spin: 1, launch: 0, error: 1 };
  }
  return { ...q, pct: Math.round(100 * Math.min(1, base.speed * q.speed)) };
}

/**
 * The slope under a ball, against the aim: up is the rise along the aim in
 * degrees (positive uphill), side is the tilt across it (positive when the ball
 * sits above the feet of a right-handed golfer, who stands left of the ball).
 */
export function slopeLie(heightAt, x, z, yaw) {
  const n = groundNormal(heightAt, x, z, .6);
  const d = [Math.sin(yaw), Math.cos(yaw)], left = [Math.cos(yaw), -Math.sin(yaw)];
  // The ground's gradient is (-nx, -nz) / ny.
  const gx = -n[0] / n[1], gz = -n[2] / n[1];
  const deg = g => Math.atan(g) * 180 / Math.PI;
  const up = deg(gx * d[0] + gz * d[1]), side = -deg(gx * left[0] + gz * left[1]);
  const clampDeg = a => Math.max(-15, Math.min(15, a));
  return { up: clampDeg(up), side: clampDeg(side) };
}
/** A slope's words for the screen, or '' on level ground. */
export function slopeWords({ up = 0, side = 0 } = {}) {
  const words = [];
  if (up > 2) words.push(`uppför ${Math.round(up)}°`); else if (up < -2) words.push(`nedför ${Math.round(-up)}°`);
  if (side > 2) words.push('boll över fötterna'); else if (side < -2) words.push('boll under fötterna');
  return words.join(', ');
}

/* Difficulty: how much of a swing's error reaches the ball, and how much of
   the shot the aid shows ahead. */
export const DIFFICULTY = Object.freeze({
  latt:   { label: 'Lätt', error: .35, preview: 'full' },
  normal: { label: 'Normal', error: .75, preview: 'carry' },
  svar:   { label: 'Svår', error: 1.2, preview: 'none' },
});

/* A club's family by its carry alone: for a club nothing in the bag names. */
const byCarry = carry => (carry >= 200 ? 'driver' : carry >= 180 ? 'wood' : carry >= 170 ? 'hybrid' : carry >= 160 ? 'iron5'
  : carry >= 150 ? 'iron6' : carry >= 140 ? 'iron7' : carry >= 128 ? 'iron8' : carry >= 115 ? 'iron9'
  : carry >= 100 ? 'pw' : carry >= 85 ? 'gw' : carry >= 65 ? 'sw' : 'lw');
const IRON_WORD = /iron|järn|^i\d|^\d+i$/;

/**
 * The launch family of a bag club, read as the bag editor reads it
 * (engine/club-design.mjs clubKind: the kind the player chose, then the name,
 * then the id), so a club the editor shows as an iron plays as an iron. An
 * iron's number and a wedge's loft come from the name before the id (a renamed
 * row keeps its old id); a club nothing names is placed by its carry.
 * Until 9 November the id came first, the kind was ignored and "6-järn" (the
 * number first) went unread, so a 110 m "7-järn" played as a pitching wedge,
 * took a chip or a pitch carried over from the last club, and its distance read
 * as that short shot's.
 */
export function clubCategory(club) {
  const carry = Number(club?.carry) || 0;
  const kind = clubKind(club);
  if (kind === 'putter' || carry === 0) return 'putter';
  if (kind === 'driver') return 'driver';
  if (kind === 'fairway') return 'wood';
  if (kind === 'hybrid') return 'hybrid';
  const name = String(club?.name || '').toLowerCase().trim();
  // a custom id is a base-36 time, whose digits and letters say nothing
  const id = /^custom-/.test(String(club?.id || '')) ? '' : String(club?.id || '').toLowerCase();
  const number = Number(name.match(/\d+/)?.[0]);
  if (kind === 'wedge') {
    const words = `${name} ${id}`;
    if (/\blw\b|lob/.test(words) || number >= 58) return 'lw';
    if (/\bsw\b|sand/.test(words) || number >= 54) return 'sw';
    if (/\bgw\b|gap|\baw\b/.test(words) || number >= 48) return 'gw';
    if (/\bpw\b|pitch/.test(words) || Number.isFinite(number)) return 'pw';
    // a wedge with no name for its loft: among the wedges, by its carry
    return carry >= 100 ? 'pw' : carry >= 85 ? 'gw' : carry >= 65 ? 'sw' : 'lw';
  }
  const named = club?.kind === 'iron' || IRON_WORD.test(name) || IRON_WORD.test(id);
  if (!named) return byCarry(carry);
  const n = Number.isFinite(number) ? number : Number(/iron-?(\d)/.exec(id)?.[1]);
  return Number.isFinite(n) ? `iron${Math.min(9, Math.max(3, n))}` : byCarry(carry);
}

/** The bag as the game plays it: longest first, a putter always last. */
export function playBag(bag) {
  const clubs = (Array.isArray(bag) ? bag : []).filter(c => c && Number.isFinite(Number(c.carry)))
    .map(c => ({ id: String(c.id), name: String(c.name || c.id), carry: Number(c.carry), cat: clubCategory(c) }));
  const playing = clubs.filter(c => c.cat !== 'putter' && c.carry > 0).sort((a, b) => b.carry - a.carry);
  const putter = clubs.find(c => c.cat === 'putter') || { id: 'putter', name: 'Putter', carry: 0, cat: 'putter' };
  return [...playing, putter].map(c => ({ ...c, swing: CLUB_LAUNCH[c.cat]?.swing || 'Iron' }));
}

const speeds = new Map();
/** The ball speed of a full swing with this club (memoised). */
export function fullSpeed(club) {
  const key = `${club.cat}:${club.carry}`;
  if (!speeds.has(key)) speeds.set(key, speedForCarry(club.cat, club.carry));
  return speeds.get(key);
}

/** The club for a distance: the shortest one that still carries it (lie included). */
export function suggestClub(clubs, distance, lie = 'fairway') {
  const effect = LIE_EFFECT[lie] || LIE_EFFECT.fairway;
  const playing = clubs.filter(c => c.cat !== 'putter');
  if (lie === 'green') return clubs.find(c => c.cat === 'putter');
  const reach = c => c.carry * effect.speed * 1.08;     // a little roll counts too
  const fits = playing.filter(c => reach(c) >= distance);
  return fits.length ? fits[fits.length - 1] : playing[0];
}

/**
 * The launch of a swing.
 *   club      a playBag entry
 *   power     0..1.1 of a full swing (past 1 is a forced swing: faster, less true)
 *   face      -1..1 start-line error (positive opens the face: starts right)
 *   path      -1..1 curve error (positive curves right)
 *   lie       a physics surface
 *   yaw       aim direction in radians (0 = +z, the world's south; x = sin, z = cos)
 *   difficulty  DIFFICULTY key
 *   puttRange the putt meter's full length in metres
 *   setup     { type, shape, height, spin } (STOCK_SETUP when left out)
 *   quality   lieQuality() of the lie, or none for a clean one
 *   slope     slopeLie() at the ball, or none for level ground
 *   tempo     tempoOf() of the swing, or none
 *   greenRoll the green's rolling resistance today (a putt's meter is metres on this green)
 */
export function launchFor({ club, power, face = 0, path = 0, lie = 'fairway', yaw, difficulty = 'normal', puttRange = 10,
  setup = STOCK_SETUP, quality = null, slope = null, tempo = null, compensate = true, greenRoll = SURFACES.green.roll }) {
  const level = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const p = Math.max(0, Math.min(1.1, power));
  const t = tempo || {};
  if (club.cat === 'putter') {
    // A putt: its meter is a distance on a flat green; the face pushes or pulls it.
    // A stroke's tempo counts for less than a full swing's.
    const faceTotal = face * (t.errorMul ?? 1) + (t.faceAdd ?? 0) * .6;
    const startError = faceTotal * level.error * 1.2 * Math.PI / 180;
    const powerMul = 1 - (1 - (t.powerMul ?? 1)) * .5;
    return { speed: puttSpeedFor(p * puttRange * powerMul, greenRoll), launchDeg: 0, spinRpm: 0, yaw: yaw + startError, axisDeg: 0, roll: true, error: level.error };
  }
  const spec = CLUB_LAUNCH[club.cat] || CLUB_LAUNCH.iron7;
  const effect = LIE_EFFECT[lie] || LIE_EFFECT.fairway;
  const q = quality || { speed: 1, spin: 1, launch: 0, error: 1 };
  const set = fitSetup(club, setup), type = SHOT_TYPES[set.type];
  const s = slope || { up: 0, side: 0 };
  // A forced swing past 100% gains a little speed and loses accuracy.
  const over = Math.max(0, p - 1);
  const speedShare = p <= 1 ? Math.pow(p, .85) : 1 + over * .5;
  // Height and spin: a low shot flies flatter and spins less, a high one the opposite.
  const heightLaunch = [.78, 1, 1.18][set.height + 1], heightSpin = [.88, 1, 1.1][set.height + 1], heightSpeed = [1, 1, .97][set.height + 1];
  const spinSpin = [.55, 1, 1.3][set.spin + 1], spinLaunch = [.96, 1, 1][set.spin + 1], spinSpeed = [1, 1, .98][set.spin + 1];
  // A draw comes out a little lower with less spin; a fade higher with more.
  const shapeSpin = 1 + .05 * set.shape, shapeLaunch = .6 * set.shape;
  const speed = fullSpeed(club) * speedShare * effect.speed * q.speed * type.speed * heightSpeed * spinSpeed * (t.powerMul ?? 1)
    * (1 - .004 * Math.abs(s.up));
  const launchDeg = Math.max(1, Math.min(60, (spec.launch * (.85 + .15 * Math.min(1, p))) * type.launch * heightLaunch * spinLaunch
    + effect.launch + q.launch + shapeLaunch + s.up * .85));
  const spinRpm = spec.spin * (.55 + .45 * Math.min(1, p)) * effect.spin * q.spin * type.spin * heightSpin * spinSpin * shapeSpin;
  const error = level.error * effect.error * q.error * type.error * (1 + over * 6) * (1 + .08 * Math.abs(set.shape))
    * (1 + (Math.abs(s.up) + Math.abs(s.side)) / 30);
  // Longer clubs start further offline and curve more for the same miss.
  const length = club.cat === 'driver' ? 1.25 : club.cat === 'wood' || club.cat === 'hybrid' ? 1.1 : /^iron[3-5]/.test(club.cat) ? 1 : .85;
  const faceTotal = face * (t.errorMul ?? 1) + (t.faceAdd ?? 0), pathTotal = path * (t.errorMul ?? 1) + (t.pathAdd ?? 0);
  // A ball above the feet starts left and hooks; below them, right and fades.
  const startDeg = faceTotal * 4.5 * error * length - s.side * .35;
  const axisDeg = pathTotal * 18 * error * length + set.shape * shapeTilt(club) - s.side * 1.5;
  // A shaped shot is started away from the aim so that it lands on it.
  const aimFix = compensate && set.shape ? shapeAim(club, p, set, lie) : 0;
  return { speed, launchDeg, spinRpm, yaw: yaw + aimFix - startDeg * Math.PI / 180, axisDeg, roll: false, error };
}

/** The spin-axis tilt of one shape step: long clubs bend more. */
function shapeTilt(club) {
  return club.cat === 'driver' ? 7 : club.cat === 'wood' || club.cat === 'hybrid' ? 6 : /^iron[3-5]/.test(club.cat) ? 5.5
    : /^iron/.test(club.cat) ? 5 : 3.5;
}
const aims = new Map();
/** The start-line turn (radians) that lands a shaped shot on its aim, on flat ground with no wind. */
function shapeAim(club, power, setup, lie) {
  const key = `${club.cat}:${club.carry}:${Math.round(power * 20)}:${setup.type}:${setup.shape}:${setup.height}:${setup.spin}:${lie}`;
  if (!aims.has(key)) {
    if (aims.size > 2000) aims.clear();
    const L = launchFor({ club, power: Math.round(power * 20) / 20, lie, yaw: 0, setup, compensate: false });
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: 0, spinRpm: L.spinRpm, axisDeg: L.axisDeg });
    const r = simulateShot({ heightAt: () => 0, surfaceAt: () => 'fairway', cup: null }, { start: [0, BALL.radius, 0], velocity, spin }, { record: false, dt: 1 / 120 });
    const land = r.landing || r.rest;
    aims.set(key, -Math.atan2(land[0], land[2]));
  }
  return aims.get(key);
}

/** The putt meter's full length for a putt of d metres: a round number past the hole. */
export function puttRangeFor(distance) {
  const steps = [3, 5, 8, 12, 16, 20, 25, 30, 40];
  return steps.find(s => s >= distance * 1.25) ?? 40;
}

const flats = new Map();
/** How far a swing of this power carries and rolls on flat ground (fairway, or the green it lands on) with no wind. */
export function flatShot(club, power, lie = 'fairway', setup = STOCK_SETUP, quality = null, landOn = 'fairway') {
  const set = fitSetup(club, setup);
  const key = `${club.cat}:${club.carry}:${power.toFixed(4)}:${lie}:${set.type}:${set.height}:${set.spin}:${quality ? `${quality.speed}:${quality.spin}:${quality.launch}` : ''}:${landOn}`;
  if (flats.has(key)) return flats.get(key);
  // Straight: the shape's start line is turned so the carry is the same.
  const L = launchFor({ club, power, yaw: 0, lie, difficulty: 'normal', setup: { ...set, shape: 0 }, quality });
  const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: 0, spinRpm: L.spinRpm });
  const r = simulateShot({ heightAt: () => 0, surfaceAt: () => landOn, cup: null },
    { start: [0, BALL.radius, 0], velocity, spin }, { record: false, dt: 1 / 120 });
  const out = { carry: r.carry, total: r.total };
  if (flats.size > 6000) flats.clear();
  flats.set(key, out);
  return out;
}

/**
 * How far a club goes at full power from this lie, as the shot is set up: a full
 * swing's carry, another shot type's whole run. On flat ground in still,
 * standard air, as "Spelas som" is reckoned, so the two compare like with like.
 * From a clean fairway lie a stock full swing is the bag's own carry; the rough,
 * sand, a lie's quality and a low, high or spun shot all change it, as they change
 * the shot (the HUD used to show the bag's carry from every lie).
 */
export function clubReach(club, lie = 'fairway', setup = STOCK_SETUP, quality = null) {
  if (!club || club.cat === 'putter') return null;
  const shot = flatShot(club, 1, lie, setup, quality);
  return fitSetup(club, setup).type === 'full' ? shot.carry : shot.total;
}

/**
 * The power a shot is planned at to reach `distance` (the pin, or a set target),
 * which the swing pad's line and the landing ring show. A full swing or a punch
 * flies to it: it lands at the distance less the roll a full one has on that
 * ground, and runs on. So every club's ring stands by the target, a little shorter
 * for a club that runs further, and a long club swung softly runs on past it, as it
 * would. (Planned by its whole run, a soft long iron had to land far short and skid
 * the rest, and its ring stood well short of the next shorter club's.) The short
 * game is played to run, so a chip, a pitch or a bump and run is planned by its
 * whole run (powerFor).
 */
export function planPower(club, distance, lie = 'fairway', setup = STOCK_SETUP, quality = null, landOn = 'fairway') {
  if (club.cat === 'putter') return null;
  const set = fitSetup(club, setup);
  if (set.type !== 'full' && set.type !== 'punch') return powerFor(club, distance, lie, set, quality, landOn);
  const carry = p => flatShot(club, p, lie, set, quality, landOn).carry;
  const full = flatShot(club, 1, lie, set, quality, landOn);
  // The roll allowed for is at most a tenth of the distance (4-15 m): a wood or a punch
  // runs 40 m and more on a flat model green, and a ball planned to land that far short
  // would come down off the green, so its ring stood far short of the irons'.
  const aim = distance - Math.min(full.total - full.carry, Math.max(4, Math.min(15, distance * .1)));
  if (full.carry <= aim) return 1;
  let lo = .05, hi = 1;
  if (carry(lo) >= aim) return lo;
  // a harder swing always carries further, so a bisection finds the one swing
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (carry(mid) < aim) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2 * 100) / 100;
}

/**
 * The share of a full swing that sends the ball `distance` metres in all, at most 1:
 * the strongest swing that does. A harder swing does not always run further. A long
 * club swung softly comes out low with little spin and skids a long way, most of all
 * on a green, so a plain bisection could settle on that skid (a 6-iron at 42% to land
 * 36 m out and run 104 m to a 140 m pin, where the 7-iron flew 130 m at 94%), and the
 * landing ring jumped short as the club got longer. So the search steps down from a
 * full swing to the first that falls short, and bisects between it and the one above.
 */
export function powerFor(club, distance, lie = 'fairway', setup = STOCK_SETUP, quality = null, landOn = 'fairway') {
  if (club.cat === 'putter') return null;
  const run = p => flatShot(club, p, lie, setup, quality, landOn).total;
  if (run(1) <= distance) return 1;
  let hi = 1, lo = null;
  for (let k = 19; k >= 1; k--) {
    if (run(k / 20) <= distance) { lo = k / 20; break; }
    hi = k / 20;
  }
  if (lo === null) return hi;                     // even the softest swing runs further
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < distance) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2 * 100) / 100;
}

/**
 * The club and shot type for a distance, as a caddie would hand them over:
 * the putter on the green, a chip or a bump-and-run close to it, a pitch a
 * little further out, a full swing otherwise.
 */
export function suggestShot(clubs, distance, lie = 'fairway') {
  if (lie === 'green') return { club: clubs.find(c => c.cat === 'putter'), type: 'full' };
  const playing = clubs.filter(c => c.cat !== 'putter');
  const reach = (club, type) => flatShot(club, 1, lie, { type }).total;
  if (lie !== 'sand' && distance <= 40) {
    // Short of the green's edge: the chip that reaches with the least loft, a lob when it must.
    const chips = playing.filter(c => shotTypesFor(c).includes('chip')).sort((a, b) => a.carry - b.carry);
    const chip = chips.find(c => reach(c, 'chip') >= distance * 1.05);
    if (chip) return { club: chip, type: 'chip' };
  }
  if (distance <= 95) {
    const pitches = playing.filter(c => shotTypesFor(c).includes('pitch')).sort((a, b) => a.carry - b.carry);
    const pitch = pitches.find(c => reach(c, 'pitch') >= distance * 1.04 && c.carry * (LIE_EFFECT[lie]?.speed ?? 1) * 1.08 >= distance * 1.15);
    if (pitch) return { club: pitch, type: 'pitch' };
  }
  return { club: suggestClub(clubs, distance, lie), type: 'full' };
}

/** A putt's length as it plays: a rise of h metres adds (5/7) h / roll of flat green. */
export function puttPlaysLike(distance, rise, roll = SURFACES.green.roll) {
  return Math.max(.3, distance + rise * 5 / 7 / roll);
}
