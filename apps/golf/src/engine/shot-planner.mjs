/* Golf navigation is a graph of strokes, not a walking path. Each edge is a
   straight shot; only fairway/green interiors can be vertices. The authored
   route provides hole ownership and forward progress, never tee connectors.
   Crown footprints are deliberately conservative: no assumed shot over trees.
   A failed search returns no recommendation rather than an unchecked fallback. */
import { hyp, inRing, ringSD, ringBBox, ptSegD, polyLen } from './geom.js';

const validRing = ring => Array.isArray(ring) && ring.length >= 3;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentDistance(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0;
  return Math.min(ptSegD(...a, ...c, ...d), ptSegD(...b, ...c, ...d),
    ptSegD(...c, ...a, ...b), ptSegD(...d, ...a, ...b));
}

/** Build once from the same placed tree population used by the renderer.
 *  Both trunks and crowns are blocked, including crowns overhanging fairways.
 *  Water and bunkers exclude landings but may be carried. */
export function createShotEnvironment({ trees = [], buildings = [], landingAllowed = () => true,
  terrainHeight = null, clearance = 2 } = {}) {
  const cell = 24, grid = new Map(), key = (i, j) => `${i},${j}`;
  for (const tree of trees) {
    const radius = Math.max(0, tree.radius) + clearance;
    const disc = { x: tree.x, z: tree.z, radius };
    for (let i = Math.floor((tree.x - radius) / cell); i <= Math.floor((tree.x + radius) / cell); i++) {
      for (let j = Math.floor((tree.z - radius) / cell); j <= Math.floor((tree.z + radius) / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(disc);
      }
    }
  }
  const walls = buildings.map(b => b.ring || b).filter(validRing).map(ring => ({ ring, box: ringBBox(ring) }));
  function clearSegment(a, b) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    const seen = new Set();
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        for (const tree of grid.get(key(i, j)) || []) {
          if (seen.has(tree)) continue;
          seen.add(tree);
          if (ptSegD(tree.x, tree.z, ...a, ...b) <= tree.radius) return false;
        }
      }
    }
    for (const { ring, box } of walls) {
      if (box.x1 + clearance < x0 || box.x0 - clearance > x1 ||
          box.z1 + clearance < z0 || box.z0 - clearance > z1) continue;
      if (inRing(...a, ring) || inRing(...b, ring)) return false;
      for (let i = 0; i < ring.length; i++) {
        if (segmentDistance(a, b, ring[i], ring[(i + 1) % ring.length]) <= clearance) return false;
      }
    }
    // A nominal lofted carry envelope also rejects intervening terrain. This
    // is a planning check, not a ball-flight prediction or a clearance over trees.
    if (terrainHeight) {
      const length = hyp(a, b), steps = Math.ceil(length / 2);
      const y0 = terrainHeight(...a), y1 = terrainHeight(...b);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) return false;
      const apex = Math.min(28, Math.max(3, length * 0.14));
      for (let i = 1; i < steps; i++) {
        const t = i / steps, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const ground = terrainHeight(x, z);
        if (!Number.isFinite(ground) || ground > y0 + (y1 - y0) * t + 4 * apex * t * (1 - t)) return false;
      }
    }
    return true;
  }
  return { clearSegment, landingAllowed, clearance, treeCount: trees.length };
}

function station(point, line) {
  let best = Infinity, along = 0, walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = hyp(a, b);
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * (b[0] - a[0]) +
      (point[1] - a[1]) * (b[1] - a[1])) / (length * length)));
    const d = Math.hypot(point[0] - a[0] - (b[0] - a[0]) * t, point[1] - a[1] - (b[1] - a[1]) * t);
    if (d < best) { best = d; along = walked + length * t; }
    walked += length;
  }
  return along;
}

function separatedCandidates(points, count, separation) {
  const chosen = [];
  points.sort((a, b) => b.inset - a.inset);
  for (const p of points) {
    if (chosen.every(other => hyp(p.point, other.point) >= separation)) chosen.push(p);
    if (chosen.length === count) break;
  }
  return chosen;
}

function coverageCandidates(points, count) {
  const chosen = separatedCandidates(points, 4, 7);
  while (chosen.length < count) {
    let next = null, gap = 4;
    for (const candidate of points) {
      const distance = Math.min(...chosen.map(p => hyp(p.point, candidate.point)));
      if (distance > gap) { next = candidate; gap = distance; }
    }
    if (!next) break;
    chosen.push(next);
  }
  return chosen;
}

/** Sampling is cached per hole/environment, independently of tee and bag. */
const candidateCache = new WeakMap();
function holeCandidates(hole, environment) {
  let cache = candidateCache.get(hole);
  if (!cache) { cache = new WeakMap(); candidateCache.set(hole, cache); }
  if (cache.has(environment)) return cache.get(environment);
  const fairways = (hole.fairway?.rings || []).filter(validRing);
  const green = validRing(hole.green?.ring) ? hole.green.ring : null;
  const hazards = (hole.bunkers || []).map(b => b.ring).filter(validRing);
  const route = hole.line?.length >= 2 ? hole.line : [hole.tees?.marks?.[0]?.c, hole.green?.c].filter(Boolean);
  const total = polyLen(route), buckets = new Map(), greens = [];
  function insetAt(point, kind) {
    const surfaces = kind === 'green' ? (green ? [green] : []) : fairways;
    let inset = -Infinity;
    for (const ring of surfaces) inset = Math.max(inset, -ringSD(...point, ring));
    for (const ring of hazards) inset = Math.min(inset, ringSD(...point, ring));
    return inset;
  }
  function add(point, kind) {
    const inset = insetAt(point, kind);
    if (inset < 2 || !environment.landingAllowed(...point) || !environment.clearSegment(point, point)) return;
    const candidate = { point, inset, kind, along: kind === 'green' ? total : station(point, route) };
    if (kind === 'green') greens.push(candidate);
    else {
      const bucket = Math.floor(candidate.along / 12);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(candidate);
    }
  }
  for (const [rings, kind, spacing] of [[fairways, 'landing', 4], [green ? [green] : [], 'green', 2]]) {
    for (const ring of rings) {
      const box = ringBBox(ring);
      for (let x = box.x0 + spacing / 2; x < box.x1; x += spacing) {
        for (let z = box.z0 + spacing / 2; z < box.z1; z += spacing) {
          if (inRing(x, z, ring) && (kind === 'green' || !green || !inRing(x, z, green))) add([x, z], kind);
        }
      }
    }
  }
  // A surveyed centre is preferred whenever it lies safely inside the green.
  if (hole.green?.c) add([...hole.green.c], 'green');
  const centre = hole.green?.c && greens.find(p => hyp(p.point, hole.green.c) < 0.01);
  const greenPoints = separatedCandidates(greens, 5, 5);
  if (centre && !greenPoints.includes(centre)) greenPoints.unshift(centre);
  const points = [...buckets.values()].flatMap(bucket => separatedCandidates(bucket, 4, 7));
  points.push(...greenPoints);
  points.sort((a, b) => a.along - b.along);
  points.forEach((point, id) => { point.id = id; });
  const result = { points, route, total, visibility: new Map(), greenCentre: centre?.point || greenPoints[0]?.point,
    refine: () => {
      if (result.refinedPoints) return result.refinedPoints;
      const extra = [...buckets.values()].flatMap(bucket => coverageCandidates(bucket, 12));
      extra.push(...separatedCandidates(greens, 15, 2));
      const refined = [...new Set([...points, ...extra])];
      let id = points.length;
      for (const point of refined) if (point.id === undefined) point.id = id++;
      result.refinedPoints = refined.sort((a, b) => a.along - b.along);
      return result.refinedPoints;
    } };
  cache.set(environment, result);
  return result;
}

const emptyEnvironment = createShotEnvironment();
export function planGolfShots({ hole, origin, clubs, maxCarry, environment = emptyEnvironment, refine = false }) {
  const data = holeCandidates(hole, environment);
  if (!data.greenCentre) return { status: 'unavailable', shots: [] };
  const start = { point: origin, along: station(origin, data.route), kind: 'tee' };
  const candidates = refine ? data.refine() : data.points;
  const points = [start, ...candidates.filter(p => p.kind === 'green' || p.along >= start.along + 25)];
  const longest = Math.max(...clubs.map(c => c.carry));
  const scores = new Float64Array(points.length).fill(Infinity), next = new Int32Array(points.length).fill(-1);
  const shotData = new Array(points.length);
  function edge(a, b, limit, bestCost) {
    const distance = hyp(a.point, b.point);
    if (distance > limit + 1e-6 || distance < 15 || (b.kind !== 'green' && b.along < a.along + 25)) return null;
    // Carry describes a real stroke length, not distance walked around a dogleg.
    const club = clubs.reduce((best, c) => Math.abs(c.carry - distance) < Math.abs(best.carry - distance) ? c : best, clubs[0]);
    const across = Math.max(3, distance * 0.065), along = Math.max(4, distance * 0.09);
    // Compare dispersion with the inscribed safe radius. It is a conservative
    // geometric risk score, not a measured probability for this player's swing.
    const dispersionRisk = Math.max(0, 1 - b.inset / along);
    const centreCost = b.kind === 'green' ? hyp(b.point, data.greenCentre) * 0.05 : 1.8 / (1 + b.inset / 3);
    const cost = 1 + centreCost + dispersionRisk * 0.65 +
      (b.kind === 'green' ? distance / longest * 0.8 : (1 - distance / limit) * 0.45) + Math.abs(club.carry - distance) * 0.006;
    if (cost >= bestCost) return null;
    const key = `${a.id ?? `tee:${origin[0]},${origin[1]}`}:${b.id}`;
    if (!data.visibility.has(key)) data.visibility.set(key, environment.clearSegment(a.point, b.point));
    if (!data.visibility.get(key)) return null;
    return { cost, distance, club, radiusAcross: across, radiusAlong: along };
  }
  // Forward progress makes this a DAG. Backward dynamic programming considers
  // the approach too, so a clear drive into a dead end cannot win the search.
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].kind === 'green') { scores[i] = 0; continue; }
    for (let j = points.length - 1; j > i; j--) {
      if (!Number.isFinite(scores[j])) continue;
      const shot = edge(points[i], points[j], i === 0 ? Math.min(longest, maxCarry || longest) : longest, scores[i] - scores[j]);
      if (shot && shot.cost + scores[j] < scores[i]) {
        scores[i] = shot.cost + scores[j]; next[i] = j; shotData[i] = shot;
      }
    }
  }
  if (next[0] < 0) {
    // A narrow opening may need a less central landing than the fast search
    // retains. Retry with denser safe candidates before giving up. A tee
    // inside an obstacle cannot be repaired by changing the landing target.
    if (!refine && environment.clearSegment(origin, origin)) {
      return planGolfShots({ hole, origin, clubs, maxCarry, environment, refine: true });
    }
    return { status: 'blocked', shots: [] };
  }
  const shots = [];
  for (let i = 0; next[i] >= 0; i = next[i]) {
    const target = points[next[i]];
    shots.push({ ...shotData[i], point: [...target.point], from: [...points[i].point],
      kind: target.kind, inset: target.inset });
  }
  return { status: 'playable', shots };
}
