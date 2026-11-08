/* From the player's bag, the lie and the swing to a launch.

   Every club flies as far as the player's own bag says it carries: the full
   swing's ball speed is solved per club (speedForCarry), so the game and the
   real club statistics agree. The lie takes speed and spin off (a flyer from
   the rough, a fat shot from sand), and the swing's two errors become the
   ball's start line (the face) and its curve (the path). */
import { CLUB_LAUNCH, speedForCarry, puttSpeedFor, launchState, simulateShot, BALL } from './ball-physics.mjs';

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

/* Difficulty: how much of a swing's error reaches the ball, and how much of
   the shot the aid shows ahead. */
export const DIFFICULTY = Object.freeze({
  latt:   { label: 'Lätt', error: .35, preview: 'full' },
  normal: { label: 'Normal', error: .75, preview: 'carry' },
  svar:   { label: 'Svår', error: 1.2, preview: 'none' },
});

/** The launch family of a bag club: by its id first, by its carry otherwise. */
export function clubCategory(club) {
  const id = String(club?.id || '').toLowerCase(), name = String(club?.name || '').toLowerCase();
  if (id === 'putter' || club?.carry === 0 || name.includes('putter')) return 'putter';
  if (id === 'driver' || name === 'driver') return 'driver';
  if (/^wood|^trä|wood/.test(id) || /^trä|wood/.test(name)) return 'wood';
  if (/hybrid/.test(id) || /hybrid/.test(name)) return 'hybrid';
  const iron = /iron-?(\d)/.exec(id) || /järn\s*(\d)/.exec(name);
  if (iron) return `iron${Math.min(9, Math.max(3, Number(iron[1])))}`;
  for (const w of ['pw', 'gw', 'sw', 'lw']) if (id === w || name === w) return w;
  if (/lob/.test(name)) return 'lw';
  const carry = Number(club?.carry) || 0;
  return carry >= 200 ? 'driver' : carry >= 180 ? 'wood' : carry >= 170 ? 'hybrid' : carry >= 160 ? 'iron5'
    : carry >= 150 ? 'iron6' : carry >= 140 ? 'iron7' : carry >= 128 ? 'iron8' : carry >= 115 ? 'iron9'
    : carry >= 100 ? 'pw' : carry >= 85 ? 'gw' : carry >= 65 ? 'sw' : 'lw';
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
 */
export function launchFor({ club, power, face = 0, path = 0, lie = 'fairway', yaw, difficulty = 'normal', puttRange = 10 }) {
  const level = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const p = Math.max(0, Math.min(1.1, power));
  if (club.cat === 'putter') {
    // A putt: its meter is a distance on a flat green; the face pushes or pulls it.
    const startError = face * level.error * 1.2 * Math.PI / 180;
    return { speed: puttSpeedFor(p * puttRange), launchDeg: 0, spinRpm: 0, yaw: yaw + startError, axisDeg: 0, roll: true };
  }
  const spec = CLUB_LAUNCH[club.cat] || CLUB_LAUNCH.iron7;
  const effect = LIE_EFFECT[lie] || LIE_EFFECT.fairway;
  // A forced swing past 100% gains a little speed and loses accuracy.
  const over = Math.max(0, p - 1);
  const speedShare = p <= 1 ? Math.pow(p, .85) : 1 + over * .5;
  const speed = fullSpeed(club) * speedShare * effect.speed;
  const launchDeg = spec.launch * (.85 + .15 * Math.min(1, p)) + effect.launch;
  const spinRpm = spec.spin * (.55 + .45 * Math.min(1, p)) * effect.spin;
  const error = level.error * effect.error * (1 + over * 6);
  // Longer clubs start further offline and curve more for the same miss.
  const length = club.cat === 'driver' ? 1.25 : club.cat === 'wood' || club.cat === 'hybrid' ? 1.1 : /^iron[3-5]/.test(club.cat) ? 1 : .85;
  const startDeg = face * 4.5 * error * length;
  const axisDeg = path * 18 * error * length;
  return { speed, launchDeg, spinRpm, yaw: yaw + startDeg * Math.PI / 180 * -1, axisDeg, roll: false };
}

/** The putt meter's full length for a putt of d metres: a round number past the hole. */
export function puttRangeFor(distance) {
  const steps = [3, 5, 8, 12, 16, 20, 25, 30, 40];
  return steps.find(s => s >= distance * 1.25) ?? 40;
}

/** How far a swing of this power carries and rolls on flat fairway with no wind. */
export function flatShot(club, power, lie = 'fairway') {
  const L = launchFor({ club, power, yaw: 0, lie, difficulty: 'normal' });
  const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: 0, spinRpm: L.spinRpm });
  const r = simulateShot({ heightAt: () => 0, surfaceAt: () => 'fairway', cup: null },
    { start: [0, BALL.radius, 0], velocity, spin }, { record: false, dt: 1 / 120 });
  return { carry: r.carry, total: r.total };
}

/** The share of a full swing that sends the ball `distance` metres in all (bisection), at most 1. */
export function powerFor(club, distance, lie = 'fairway') {
  if (club.cat === 'putter') return null;
  if (flatShot(club, 1, lie).total <= distance) return 1;
  let lo = .05, hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (flatShot(club, mid, lie).total < distance) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2 * 100) / 100;
}
