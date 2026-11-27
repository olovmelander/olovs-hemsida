/* What a golfer reads off the map, in the map's world (metres, x east, z
   south). The ground rules stay in rangefinder.js and caddie.js: this only
   carries them to a hole in the world frame. Pure. */
import { nearestPointOnLine, pointAlongLine } from '../engine/caddie.js';
import { crossing } from './map-hazard-geometry.mjs';
import { inRing, ptSegD, ringBBox, ringSD } from '../engine/geom.js';
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

/* Smooths single-sample ground bumps along the strip while keeping both ends exact. */
export function smoothProfile(points, radius = 3) {
  if (!Array.isArray(points) || points.length < 3 || radius <= 0) return Array.isArray(points) ? [...points] : [];
  const last = points.length - 1;
  return points.map((value, index) => {
    if (index === 0 || index === last) return value;
    let total = 0, weightSum = 0;
    const from = Math.max(0, index - radius), to = Math.min(last, index + radius);
    for (let i = from; i <= to; i++) {
      const w = radius + 1 - Math.abs(i - index);
      total += points[i] * w;
      weightSum += w;
    }
    return weightSum ? total / weightSum : value;
  });
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

const CORRIDOR_METRES = 45, BUNKER_GROUP_METRES = 14, WATER_NEAR_METRES = 18;
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

export { waterShape } from './map-hazard-geometry.mjs';

/* Which side of the line of play a thing lies on, facing the green. World z runs
   south, so a positive cross product is to the right. */
const ON_THE_LINE_METRES = 6;
export function sideOfPlay(point, path) {
  const hit = nearestPointOnLine(point, path);
  if (hit.distance < ON_THE_LINE_METRES) return 'mitt';
  const a = pointAlongLine(path, Math.max(hit.along - 2, 0)), b = pointAlongLine(path, Math.min(hit.along + 2, hit.total));
  return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) > 0 ? 'höger' : 'vänster';
}

const bankEpsilon = 1e-7;
const between = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/* Intersect a leg with the surveyed banks. Classifying the open intervals
   handles concave lakes, bends, tangencies and a stream narrower than a metre.
   The 18 m corridor only identifies nearby water beside the line. */
function waterAlongLine(water, path, origin) {
  const spans = [];
  let walked = 0, nearby = false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = groundDistance(a, b);
    if (!length) continue;
    const left = Math.min(a[0], b[0]) - WATER_NEAR_METRES, right = Math.max(a[0], b[0]) + WATER_NEAR_METRES;
    const low = Math.min(a[1], b[1]) - WATER_NEAR_METRES, high = Math.max(a[1], b[1]) + WATER_NEAR_METRES;
    for (const ring of water.rings) {
      const cuts = [0, 1];
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const c = ring[j], d = ring[k];
        if (Math.max(c[0], d[0]) < left || Math.min(c[0], d[0]) > right ||
            Math.max(c[1], d[1]) < low || Math.min(c[1], d[1]) > high) continue;
        const cut = crossing(a, b, c, d);
        if (cut >= 0) { cuts.push(cut); nearby = true; }
        else if (!nearby) nearby = Math.min(ptSegD(...a, ...c, ...d), ptSegD(...b, ...c, ...d),
          ptSegD(...c, ...a, ...b), ptSegD(...d, ...a, ...b)) <= WATER_NEAR_METRES;
      }
      cuts.sort((x, y) => x - y);
      for (let k = 1; k < cuts.length; k++) {
        const lo = cuts[k - 1], hi = cuts[k];
        if ((hi - lo) * length <= bankEpsilon) continue;
        const middle = between(a, b, (lo + hi) / 2);
        if (!inRing(...middle, ring) || ringSD(...middle, ring) >= -bankEpsilon) continue;
        spans.push({ start: walked + lo * length, end: walked + hi * length,
          entry: between(a, b, lo), exit: between(a, b, hi) });
      }
    }
    walked += length;
  }
  if (spans.length) {
    // Adjacent legs through the same pond and overlapping stream strips make
    // one crossing. Dry ground between two arms of a lake separates them.
    const runs = [];
    for (const span of spans.sort((a, b) => a.start - b.start)) {
      const last = runs.at(-1);
      if (!last || span.start > last.end + bankEpsilon) runs.push(span);
      else if (span.end > last.end) { last.end = span.end; last.exit = span.exit; }
    }
    return runs.map(({ start, end, entry, exit }) => {
      const endsInWater = end >= walked - bankEpsilon && water.rings.some(ring => ringSD(...exit, ring) < -bankEpsilon);
      return { kind: 'water', at: start < bankEpsilon && !endsInWater ? exit : entry, front: groundDistance(origin, entry),
        carry: endsInWater ? null : groundDistance(origin, exit), openWater: endsInWater, side: 'mitt' };
    });
  }
  if (!nearby) return [];
  let nearest = null;
  for (const ring of water.rings) {
    const hit = nearestPointOnLine(origin, [...ring, ring[0]]);
    if (!nearest || hit.distance < nearest.distance) nearest = hit;
  }
  if (!nearest || nearest.distance < WATER_WORTH_METRES) return [];
  return [{ kind: 'water', at: nearest.point, front: nearest.distance, carry: null, side: sideOfPlay(nearest.point, path) }];
}

/* The reference line runs from the current ball to the next point on the
   hole's route and then to the green. Bank distances are measured directly
   from the ball, regardless of the length of the route between its bends. */
export function hazardsAhead({ origin, path, bunkers, waters, limit = 5 }) {
  const { along: start, segment } = nearestPointOnLine(origin, path);
  const found = [];

  for (const group of bunkers) {
    const hit = nearestPointOnLine(group.c, path);
    if (hit.distance > CORRIDOR_METRES || hit.along <= start + 8) continue;
    const reaches = group.points.map(point => groundDistance(origin, point));
    found.push({ kind: 'bunker', at: group.c, outline: group.points, front: Math.min(...reaches), carry: Math.max(...reaches), side: sideOfPlay(group.c, path) });
  }

  const remaining = [origin, ...path.slice(segment + 1)];
  const hole = ringBBox(remaining);
  for (const water of waters) {
    if (water.x1 < hole.x0 - WATER_NEAR_METRES || water.x0 > hole.x1 + WATER_NEAR_METRES
      || water.z1 < hole.z0 - WATER_NEAR_METRES || water.z0 > hole.z1 + WATER_NEAR_METRES) continue;
    for (const hazard of waterAlongLine(water, remaining, origin)) {
      if (water.approximate) hazard.approximate = true;
      found.push(hazard);
    }
  }
  return found.sort((a, b) => a.front - b.front).slice(0, limit);
}

/* Keeps only the nearest hazards within shot reach so the map overlay stays calm. */
export function reachableHazards(hazards, maxReach, { limit = 3 } = {}) {
  if (!Array.isArray(hazards)) return [];
  const cap = Number.isFinite(maxReach) && maxReach > 0 ? maxReach : Infinity;
  return hazards
    .filter(hazard => hazard.front <= cap)
    .sort((a, b) => a.front - b.front)
    .slice(0, limit);
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
