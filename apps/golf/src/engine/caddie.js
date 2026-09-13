/* Pure caddie logic shared by the bag, GPS mode and the 3D strategy layer.
   There is deliberately no DOM or THREE here: club advice and coordinate
   conversion must be testable without starting the renderer. */
import { planGolfShots } from './shot-planner.mjs';
import { latLonToSweref99Tm } from '../../../../packages/course-geo/chmv2/projection.mjs';
/* The same exact pack/frame identity as the terrain bridge -- asserted
   field-for-field against the v2 registry by gps-projected-frames.test.mjs
   rather than imported from it, because this is player code and that import
   pulled every v2 config module into the flagless bundle. Applies whether or
   not terrain falls back to GPK1: a GPS fix is WGS84, and a grid-authored
   pack's x/z axes are SWEREF99 TM. */
import { PROJECTED_GPS_FRAMES } from './gps-projected-frames.mjs';

const DEFAULT_CLUBS = [
  ['driver', 'Driver', 210],
  ['wood-3', 'Trä 3', 190],
  ['wood-5', 'Trä 5', 180],
  ['hybrid-4', 'Hybrid 4', 175],
  ['iron-5', 'Järn 5', 160],
  ['iron-6', 'Järn 6', 150],
  ['iron-7', 'Järn 7', 140],
  ['iron-8', 'Järn 8', 130],
  ['iron-9', 'Järn 9', 120],
  ['pw', 'PW', 105],
  ['gw', 'GW', 90],
  ['sw', 'SW', 75],
  ['lw', 'Lobwedge', 55],
];

export const MAX_BAG_CLUBS = 14;

export const DEFAULT_BAG = Object.freeze(DEFAULT_CLUBS.map(([id, name, carry]) =>
  Object.freeze({ id, name, carry })));

const cleanClub = (club, index) => {
  const name = String(club?.name || '').trim().slice(0, 24);
  const carry = Math.round(Number(club?.carry));
  if (!name || !Number.isFinite(carry) || carry < 20 || carry > 350) return null;
  const rawId = String(club?.id || `club-${index + 1}`).toLowerCase();
  const id = rawId.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 32) || `club-${index + 1}`;
  return { id, name, carry };
};

export function normalizeBag(value, fallback = DEFAULT_BAG) {
  const source = Array.isArray(value) ? value : [];
  const usedIds = new Set();
  const clubs = source.map(cleanClub).filter(Boolean).map((club, index) => {
    const baseId = club.id.slice(0, 22);
    let id = club.id, suffix = 1;
    while (usedIds.has(id)) id = `${baseId}-${index + 1}-${suffix++}`.slice(0, 32);
    usedIds.add(id);
    return { ...club, id };
  }).slice(0, MAX_BAG_CLUBS);
  return clubs.length >= 2 ? clubs : fallback.map(club => ({ ...club }));
}

export function parseBag(raw) {
  if (!raw) return normalizeBag(DEFAULT_BAG);
  try {
    const value = JSON.parse(raw);
    return normalizeBag(Array.isArray(value) ? value : value?.clubs);
  } catch {
    return normalizeBag(DEFAULT_BAG);
  }
}

export function recommendClub(distance, value = DEFAULT_BAG) {
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const clubs = normalizeBag(value).sort((a, b) => b.carry - a.carry);
  let best = clubs[0], bestScore = Infinity;
  for (const club of clubs) {
    const delta = distance - club.carry;
    /* Going long is normally the expensive miss, so an over-carry needs to be
       distinctly closer before it beats the club that finishes just short. */
    const score = Math.abs(delta) * (delta < 0 ? 1.3 : 1);
    if (score < bestScore) { best = club; bestScore = score; }
  }
  const longest = clubs[0];
  return {
    club: { ...best },
    distance,
    delta: distance - best.carry,
    beyondBag: distance > longest.carry + 12,
  };
}

export const PACK_METRES_PER_LATITUDE = 111320;

export function gpsToLocal(coords, geo, metresPerLatitude = PACK_METRES_PER_LATITUDE) {
  const latitude = Number(coords?.latitude ?? coords?.lat);
  const longitude = Number(coords?.longitude ?? coords?.lon ?? coords?.lng);
  const lat0 = Number(geo?.origin?.lat), lon0 = Number(geo?.origin?.lon);
  const metresPerLongitude = Number(geo?.mPerLon);
  if (![latitude, longitude, lat0, lon0, metresPerLatitude, metresPerLongitude].every(Number.isFinite)) {
    throw new TypeError('GPS-fixen eller banans koordinatram är ofullständig');
  }
  const projectedFrame = PROJECTED_GPS_FRAMES.find(config => config.packFrame === geo.frame);
  if (projectedFrame) {
    if (lat0 !== projectedFrame.packOriginWgs84.latitude || lon0 !== projectedFrame.packOriginWgs84.longitude ||
        metresPerLongitude !== projectedFrame.packMetresPerLongitude) {
      throw new TypeError('GPS-banans projicerade koordinatram stämmer inte med dess deklarerade ursprung');
    }
    const [easting, northing] = latLonToSweref99Tm(latitude, longitude);
    const origin = projectedFrame.legacyOriginEpsg3006;
    return [easting - origin.easting, origin.northing - northing];
  }
  return [(longitude - lon0) * metresPerLongitude, (lat0 - latitude) * metresPerLatitude];
}

function segmentProjection(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length2 = dx * dx + dz * dz;
  const t = length2 > 0
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2))
    : 0;
  const x = a[0] + dx * t, z = a[1] + dz * t;
  return { point: [x, z], t, distance: Math.hypot(point[0] - x, point[1] - z), length: Math.sqrt(length2) };
}

export function nearestPointOnLine(point, line) {
  if (!Array.isArray(line) || line.length === 0) return { point: null, distance: Infinity, along: 0, total: 0 };
  if (line.length === 1) return { point: [...line[0]], distance: Math.hypot(point[0] - line[0][0], point[1] - line[0][1]), along: 0, total: 0 };
  let walked = 0, total = 0, best = null;
  for (let i = 0; i < line.length - 1; i++) total += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  for (let i = 0; i < line.length - 1; i++) {
    const hit = segmentProjection(point, line[i], line[i + 1]);
    if (!best || hit.distance < best.distance) best = { ...hit, along: walked + hit.length * hit.t, segment: i };
    walked += hit.length;
  }
  return { ...best, total };
}

export function pointAlongLine(line, distance) {
  if (!Array.isArray(line) || line.length === 0) return null;
  let left = Math.max(0, Number(distance) || 0);
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= length || i === line.length - 2) {
      const t = length > 0 ? Math.min(1, left / length) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= length;
  }
  return [...line[line.length - 1]];
}

const statedMaxCarry = note => {
  const match = String(note || '').match(/max(?:imalt)?\s+(\d{2,3})\s*(?:m|meter)/i);
  return match ? Number(match[1]) : null;
};

export function strategyForHole(hole, teeIndex = 0, value = DEFAULT_BAG, environment) {
  const origin = hole?.tees?.marks?.[teeIndex]?.c || hole?.tees?.marks?.[0]?.c || hole?.line?.[0];
  if (!origin) return null;
  const clubs = normalizeBag(value).sort((a, b) => b.carry - a.carry);
  const maxCarry = statedMaxCarry(hole.note);
  const plan = planGolfShots({ hole, origin, clubs, maxCarry, environment });
  const line = [[...origin], ...plan.shots.map(shot => [...shot.point])];
  const total = plan.shots.reduce((sum, shot) => sum + shot.distance, 0);
  let walked = 0;
  const zones = plan.shots.map((shot, index) => {
    walked += shot.distance;
    return { kind: index === 0 ? shot.kind : 'approach', surface: shot.kind === 'green' ? 'green' : 'fairway',
      point: shot.point, from: shot.from, distance: walked, shotDistance: shot.distance,
      remain: Math.max(0, total - walked), club: shot.club,
      radiusAcross: shot.radiusAcross, radiusAlong: shot.radiusAlong, inset: shot.inset };
  });
  const first = plan.shots[0];
  const primaryDistance = first?.distance || 0;
  const arcs = [100, 150, 200].filter(distance => distance < primaryDistance - 12);
  return { status: plan.status, origin: [...origin], line, total, zones, arcs, maxCarry,
    primary: first?.point || null, primaryDistance,
    primaryAdvice: first ? { club: first.club, distance: first.distance,
      delta: first.distance - first.club.carry, beyondBag: false } : null };
}

export function nearestHole(point, holes, currentHoleNumber = null, hysteresis = 28) {
  let best = null, current = null;
  for (const hole of holes || []) {
    const hit = nearestPointOnLine(point, hole.line);
    const candidate = { hole: hole.n, distance: hit.distance, point: hit.point, along: hit.along, total: hit.total };
    if (!best || candidate.distance < best.distance) best = candidate;
    if (hole.n === currentHoleNumber) current = candidate;
  }
  if (current && best && current.distance <= best.distance + hysteresis) return current;
  return best;
}
