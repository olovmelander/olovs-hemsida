/* Pure caddie logic shared by the bag, GPS mode and the 3D strategy layer.
   There is deliberately no DOM or THREE here: club advice and coordinate
   conversion must be testable without starting the renderer. */

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

function playableLine(hole, teeIndex) {
  const line = hole?.line || [];
  const origin = hole?.tees?.marks?.[teeIndex]?.c || hole?.tees?.marks?.[0]?.c || line[0];
  if (!origin || line.length < 2) return { origin, line: origin ? [origin] : [], total: 0 };
  const hit = nearestPointOnLine(origin, line);
  const out = [[...origin]];
  if (hit.point && Math.hypot(origin[0] - hit.point[0], origin[1] - hit.point[1]) > 0.5) out.push(hit.point);
  for (let i = (hit.segment ?? 0) + 1; i < line.length; i++) out.push([...line[i]]);
  const total = out.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - out[i][0], p[1] - out[i][1]), 0);
  return { origin: [...origin], line: out, total };
}

const statedMaxCarry = note => {
  const match = String(note || '').match(/max(?:imalt)?\s+(\d{2,3})\s*(?:m|meter)/i);
  return match ? Number(match[1]) : null;
};

const statedApproach = note => {
  const match = String(note || '').match(/(\d{2,3})\s*[–—-]\s*(\d{2,3})\s*(?:m|meter)\s+kvar/i);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

export function strategyForHole(hole, teeIndex = 0, value = DEFAULT_BAG) {
  const route = playableLine(hole, teeIndex);
  if (!route.origin || route.total <= 0) return null;
  const clubs = normalizeBag(value).sort((a, b) => b.carry - a.carry);
  const maxCarry = statedMaxCarry(hole.note) || clubs[0].carry;
  const wanted = hole.par <= 3
    ? route.total
    : hole.par >= 5
      ? Math.min(maxCarry, Math.max(90, route.total - 190))
      : Math.min(maxCarry, Math.max(75, route.total - 105));
  const primaryAdvice = recommendClub(wanted, clubs);
  const primaryDistance = hole.par <= 3
    ? route.total
    : Math.min(route.total, statedMaxCarry(hole.note) || primaryAdvice.club.carry);
  const primary = pointAlongLine(route.line, primaryDistance);
  const zones = [{
    kind: hole.par <= 3 || primaryDistance >= route.total - 18 ? 'green' : 'landing',
    point: primary,
    distance: primaryDistance,
    remain: Math.max(0, route.total - primaryDistance),
    club: primaryAdvice.club,
    radiusAcross: hole.par <= 3 ? 10 : 16,
    radiusAlong: hole.par <= 3 ? 13 : 24,
  }];

  const approachRange = statedApproach(hole.note);
  const approachRemain = approachRange ? (approachRange[0] + approachRange[1]) / 2 : (hole.par >= 5 ? 110 : null);
  if (approachRemain && route.total - approachRemain > primaryDistance + 35) {
    const distance = route.total - approachRemain;
    zones.push({
      kind: 'approach', point: pointAlongLine(route.line, distance), distance,
      remain: approachRemain, club: null, radiusAcross: 13, radiusAlong: approachRange ? Math.max(18, Math.abs(approachRange[1] - approachRange[0])) : 20,
    });
  }

  const arcCandidates = [100, 150, 200, Math.round(primaryDistance / 10) * 10];
  const arcs = [...new Set(arcCandidates)].filter(distance => distance >= 60 && distance < route.total - 12).sort((a, b) => a - b);
  return { ...route, primary, primaryDistance, primaryAdvice, zones, arcs, maxCarry: statedMaxCarry(hole.note) };
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
