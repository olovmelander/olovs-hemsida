/* What a golfer reads off the map, in the map's world (metres, x east, z
   south). The ground rules stay in rangefinder.js and caddie.js: this only
   carries them to a hole in the world frame. Pure. */
import { nearestPointOnLine } from '../engine/caddie.js';
import { greenDistances, playsLike } from '../engine/rangefinder.js';

export const groundDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function greenNumbers(origin, green) {
  const { front, centre, back } = greenDistances(origin, green);
  return { front, centre, back };
}

/* The way a hole is played: from the tee in use, along its line, to the middle of
   the green. A forward tee joins the line where it stands, so a tee past a dogleg
   does not walk back to the bend. */
export function playedPath(hole, tee) {
  const { segment = 0 } = nearestPointOnLine(tee, hole.line);
  const path = [tee, ...hole.line.slice(segment + 1)];
  return groundDistance(path.at(-1), hole.green.c) > 1 ? [...path, hole.green.c] : path;
}

/* The ground along a path, evenly spaced, for the strip under the map. */
export function elevationProfile(path, heightAt, samples = 72) {
  const lengths = path.slice(1).map((point, i) => groundDistance(path[i], point));
  const distance = lengths.reduce((sum, length) => sum + length, 0);
  const points = [];
  let low = Infinity, high = -Infinity, segment = 0, walked = 0;
  for (let i = 0; i < samples; i++) {
    const wanted = distance * i / (samples - 1);
    while (segment < lengths.length - 1 && walked + lengths[segment] < wanted) walked += lengths[segment++];
    const t = lengths[segment] > 0 ? Math.min(1, (wanted - walked) / lengths[segment]) : 0;
    const [ax, az] = path[segment], [bx, bz] = path[segment + 1];
    const y = heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
    if (!Number.isFinite(y)) return null;
    points.push(y);
    if (y < low) low = y;
    if (y > high) high = y;
  }
  return { distance, points, low, high, rise: points.at(-1) - points[0] };
}

/* Where a share of the hole sits across the strip. The player walks along it at
   first; then they stay at `rest`, what is behind them closes up to the left and
   what is ahead spreads out to fill the rest. So the whole hole is always there, and
   the shot in hand is always the largest thing on it: on a 400 m hole the last 60 m,
   the approach, would otherwise be a sliver at the right-hand edge. */
export const STRIP_REST = 0.22;
export function stripX(share, you = 0, rest = STRIP_REST) {
  const at = Math.min(you, rest);
  if (you >= 1) return share >= 1 ? 1 : share * at;
  return share <= you
    ? (you > 0 ? share / you * at : 0)
    : at + (share - you) / (1 - you) * (1 - at);
}

/* Where a point falls on that strip: how far along the path, and the ground there.
   A point further off the path than `reach` is not on this hole at all. */
export function placeOnProfile(point, path, profile, reach = Infinity) {
  const hit = nearestPointOnLine(point, path);
  if (!hit.point || hit.distance > reach || !(hit.total > 0)) return null;
  const share = Math.min(1, hit.along / hit.total);
  const at = share * (profile.points.length - 1);
  const i = Math.min(Math.floor(at), profile.points.length - 2);
  const height = profile.points[i] + (profile.points[i + 1] - profile.points[i]) * (at - i);
  return { share, height, along: hit.along, off: hit.distance };
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
