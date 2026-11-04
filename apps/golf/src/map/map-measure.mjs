/* What a golfer reads off the map, in the map's world (metres, x east, z
   south). The ground rules stay in rangefinder.js and caddie.js: this only
   carries them to a hole in the world frame. Pure. */
import { nearestPointOnLine, pointAlongLine } from '../engine/caddie.js';
import { ringSD } from '../engine/geom.js';
import { compassBearing, greenDistances, playsLike, windAlong } from '../engine/rangefinder.js';

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

/* How far, how much up or down, and what that plays like in this air. */
export function shotReading(from, to, heightAt, weather = null) {
  const distance = groundDistance(from, to);
  const start = heightAt(from[0], from[1]), end = heightAt(to[0], to[1]);
  const rise = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
  const { head, cross } = weather
    ? windAlong(compassBearing(from[0], from[1], to[0], to[1]), weather.windFromDeg, weather.windMs)
    : { head: 0, cross: 0 };
  const plays = rise === null ? null : playsLike({ dist: distance, dh: rise, head, tempC: weather?.tempC ?? null }).total;
  return { distance, rise, plays, head, cross };
}

/* The wind on a shot, in the words a playing partner would use. A breath under a
   metre a second is no wind at all. */
export function windWords({ head, cross }) {
  const words = [];
  if (Math.abs(head) >= 1) words.push(`${head > 0 ? 'motvind' : 'medvind'} ${Math.round(Math.abs(head))} m/s`);
  if (Math.abs(cross) >= 1) words.push(`${Math.round(Math.abs(cross))} m/s från ${cross > 0 ? 'höger' : 'vänster'}`);
  return words;
}

const CORRIDOR_METRES = 45, BUNKER_GROUP_METRES = 14, WATER_NEAR_METRES = 18, WATER_STEP_METRES = 4;
/* Water at the player's feet is scenery: there is nothing to play short of. */
const WATER_WORTH_METRES = 30;

function centreOf(points) {
  const sum = points.reduce((total, [x, z]) => [total[0] + x, total[1] + z], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

/* Bunkers side by side are one hazard to a golfer: a group gets one pair of numbers. */
export function groupBunkers(rings) {
  const groups = [];
  for (const ring of rings) {
    const centre = centreOf(ring);
    const near = groups.find(group => group.rings.some(other => groundDistance(centreOf(other), centre) <= BUNKER_GROUP_METRES));
    if (near) near.rings.push(ring); else groups.push({ rings: [ring] });
  }
  return groups.map(({ rings: members }) => {
    const points = members.flat();
    return { points, c: centreOf(points) };
  });
}

function box(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { ring, x0, z0, x1, z1 };
}
export const waterShape = box;

/* Which side of the line of play a thing lies on, facing the green. World z runs
   south, so a positive cross product is to the right. */
const ON_THE_LINE_METRES = 6;
export function sideOfPlay(point, path) {
  const hit = nearestPointOnLine(point, path);
  if (hit.distance < ON_THE_LINE_METRES) return 'mitt';
  const a = pointAlongLine(path, Math.max(hit.along - 2, 0)), b = pointAlongLine(path, Math.min(hit.along + 2, hit.total));
  return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) > 0 ? 'höger' : 'vänster';
}

/* What lies ahead on this hole, nearest first: the distance to reach each hazard
   and to carry it, from where the ball is. Water beside the line can be reached but
   needs no carrying, so it has no carry. */
export function hazardsAhead({ origin, path, bunkers, waters, limit = 5 }) {
  const start = nearestPointOnLine(origin, path).along;
  const found = [];

  for (const group of bunkers) {
    const hit = nearestPointOnLine(group.c, path);
    if (hit.distance > CORRIDOR_METRES || hit.along <= start + 8) continue;
    const reaches = group.points.map(point => groundDistance(origin, point));
    found.push({ kind: 'bunker', at: group.c, front: Math.min(...reaches), carry: Math.max(...reaches), side: sideOfPlay(group.c, path) });
  }

  const total = nearestPointOnLine(path.at(-1), path).total;
  const hole = box(path);
  for (const water of waters) {
    /* By the path's whole box, not its corners: a long straight hole has a pond
       halfway along that is nowhere near either end of it. */
    if (water.x1 < hole.x0 - WATER_NEAR_METRES || water.x0 > hole.x1 + WATER_NEAR_METRES
      || water.z1 < hole.z0 - WATER_NEAR_METRES || water.z0 > hole.z1 + WATER_NEAR_METRES) continue;
    let first = null, last = null, wet = null;
    for (let along = start; along <= total; along += WATER_STEP_METRES) {
      const point = pointAlongLine(path, along);
      const edge = ringSD(point[0], point[1], water.ring);
      if (edge < WATER_NEAR_METRES && !first) first = point;
      if (edge < 0) wet = point;
      if (edge < WATER_NEAR_METRES) last = point;
      else if (first) break;
    }
    if (!first || (!wet && groundDistance(origin, first) < WATER_WORTH_METRES)) continue;
    const spot = wet ?? last;
    const shore = wet ? spot : water.ring.reduce((best, point) => (groundDistance(spot, point) < groundDistance(spot, best) ? point : best));
    found.push({ kind: 'water', at: shore, front: groundDistance(origin, first), carry: wet ? groundDistance(origin, wet) : null, side: sideOfPlay(shore, path) });
  }

  return found.sort((a, b) => a.front - b.front).slice(0, limit);
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
