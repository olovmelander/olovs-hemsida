/* What a golfer reads off the map, in the map's world (metres, x east, z
   south). The ground rules stay in rangefinder.js and caddie.js: this only
   carries them to a hole in the world frame. Pure. */
import { greenDistances, playsLike } from '../engine/rangefinder.js';

export const groundDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function greenNumbers(origin, green) {
  const { front, centre, back } = greenDistances(origin, green);
  return { front, centre, back };
}

/* A straight line's ground heights from a to b, for the strip under the map. */
export function elevationProfile(a, b, heightAt, samples = 64) {
  const points = [];
  let low = Infinity, high = -Infinity;
  const distance = groundDistance(a, b);
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = heightAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!Number.isFinite(y)) return null;
    points.push(y);
    if (y < low) low = y;
    if (y > high) high = y;
  }
  return { distance, points, low, high, rise: points.at(-1) - points[0] };
}

/* How far, how much up or down, and what that plays like. */
export function shotReading(from, to, heightAt) {
  const distance = groundDistance(from, to);
  const start = heightAt(from[0], from[1]), end = heightAt(to[0], to[1]);
  const rise = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
  const plays = rise === null ? null : playsLike({ dist: distance, dh: rise }).total;
  return { distance, rise, plays };
}

/* The compass direction of play: up the screen on a hole view. */
export const bearingOf = (from, to) => Math.atan2(to[0] - from[0], -(to[1] - from[1]));

/* The overview lies along the course's long axis, so a phone held upright shows
   as much of it as it can. */
export function principalBearing(points) {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cz = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  let xx = 0, zz = 0, xz = 0;
  for (const [x, z] of points) {
    xx += (x - cx) ** 2; zz += (z - cz) ** 2; xz += (x - cx) * (z - cz);
  }
  const axis = 0.5 * Math.atan2(2 * xz, xx - zz);
  /* Keep it within a quarter turn of north, so the map is never upside down. */
  let bearing = Math.atan2(Math.cos(axis), -Math.sin(axis));
  if (bearing > Math.PI / 2) bearing -= Math.PI;
  if (bearing < -Math.PI / 2) bearing += Math.PI;
  return bearing;
}

/* Contour spacing for how much ground a screen holds: tight enough on a green
   to show its slopes, open enough over a course to show its hills. */
export function contourInterval(metresPerPixel) {
  const widest = metresPerPixel * 14;
  for (const interval of [0.25, 0.5, 1, 2, 5, 10, 20]) if (interval * 3 >= widest) return interval;
  return 50;
}
