/* The mobile map and the shared stroke planner use the same ground metres. A hole
   owns its targets. Hazards and physical obstructions belong to the ground and
   can affect a shot even when they were published under a neighbouring layout. */
import { nearestPointOnLine } from '../engine/caddie.js';
import { ringBBox, ringSD, ptSegD, inRing } from '../engine/geom.js';
import { createShotEnvironment } from '../engine/shot-planner.mjs';
import { sampleTile } from './map-height.mjs';
import { drawShores, shoreSprites } from './map-shores.mjs';

const intersects = (a, b, margin = 0) => a.x1 + margin >= b.x0 && a.x0 - margin <= b.x1
  && a.z1 + margin >= b.z0 && a.z0 - margin <= b.z1;

function waterMask(course, bounds, land, shores) {
  if (!land?.water) return null;
  // Only the part of the ground picture around this hole crosses to the worker.
  const spacing = Math.min(4, land.spacing);
  const width = Math.ceil((bounds.x1 - bounds.x0) / spacing) + 1;
  const height = Math.ceil((bounds.z1 - bounds.z0) / spacing) + 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.setTransform(1 / spacing, 0, 0, 1 / spacing, -bounds.x0 / spacing, -bounds.z0 / spacing);
  context.drawImage(land.water, land.x0, land.z0, land.water.width * land.spacing, land.water.height * land.spacing);
  if (shores) {
    const local = shoreSprites(course, shores.lakes).filter(({ sprite }) => intersects(bounds, sprite));
    drawShores(context, shores.picture, local.map(({ sprite }) => sprite));
  }
  const rgba = context.getImageData(0, 0, width, height).data;
  const wet = new Uint8Array(width * height);
  for (let i = 0; i < wet.length; i++) wet[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  return { x0: bounds.x0, z0: bounds.z0, spacing, width, height, wet };
}

/* Share camera reads already in flight, but take our own snapshot of all the
   published 1 m tiles for this hole. Their coverage includes the hole corridor
   and rough. An unloaded or failed tile cannot silently become level, empty land. */
export async function loadMapShotGeometry(course, hole, store, { signal, land, shores } = {}) {
  if (!hole.tileIds?.length) throw new Error('Hålets höjddata saknas');
  const tiles = [];
  let next = 0;
  const read = async () => {
    while (next < hole.tileIds.length) {
      signal?.throwIfAborted();
      const index = next++;
      tiles[index] = await store.shotTile(hole.tileIds[index]);
    }
  };
  await Promise.all([read(), read()]);
  signal?.throwIfAborted();
  const bounds = ringBBox(tiles.flatMap(t => [[t.x0, t.z0], [t.x0 + t.size, t.z0 + t.size]]));
  const near = ring => intersects(ringBBox(ring), bounds, 5);
  const f = course.features;
  const mask = waterMask(course, bounds, land, shores);
  const bunkerRings = [...course.holes.flatMap(h => h.bunkers), ...f.otherBunkers].filter(near);
  // If a corrected sea outline is the only water evidence, its enclosed region
  // stays conservative until its measured replacement can be read.
  const water = f.water.filter(w => !w.overLand).map(w => w.ring);
  const uncertainWater = mask ? [] : f.water.filter(w => w.overLand && near(w.ring)).map(w => w.ring);
  const strips = (features, width) => features.filter(item => near(item.line))
    .flatMap(item => stripsOf(item.line, item.width ?? width));
  const watercourses = [...strips(f.streams, 2), ...strips(f.drains, 1.2)];
  const hardGround = [...f.parking, ...f.paved].filter(near)
    .concat(strips(f.roads, 5), strips(f.tracks, 2.6), strips(f.paths, 2), strips(f.railways, 3));
  return {
    hole: { n: hole.n, par: hole.par, note: hole.note, line: hole.line, green: hole.green,
      pin: hole.pin, greensApproximate: course.greensApproximate, fairway: { rings: hole.fairways },
      tees: { marks: hole.tees.map(t => ({ c: t.point })) }, bunkers: hole.bunkers.map(ring => ({ ring })) },
    tiles, mask, uncertainWater,
    bunkers: bunkerRings, water: [...water.filter(near), ...f.basins.filter(near), ...watercourses], hardGround,
    boundaries: f.obRuns.filter(run => (!run.holes?.length || run.holes.includes(hole.n)) && near(run.line))
      .map(run => ({ line: run.line, holeSpecific: Boolean(run.holes?.length) })),
    buildings: [...f.buildings, ...f.farBuildings].filter(near),
  };
}

// Distance along a shot to its intersection with one polygon/OB edge.
// Touching or running along an edge counts, including the far end of an overlap.
function crossing(a, b, c, d) {
  const x = b[0] - a[0], z = b[1] - a[1], u = d[0] - c[0], v = d[1] - c[1];
  const px = c[0] - a[0], pz = c[1] - a[1], denom = x * v - z * u;
  if (Math.abs(denom) < 1e-8) {
    const length2 = x * x + z * z;
    if (!length2 || Math.abs(px * z - pz * x) > 1e-8) return -1;
    const start = (px * x + pz * z) / length2, end = start + (u * x + v * z) / length2;
    return Math.min(start, end) <= 1 && Math.max(start, end) >= 0 ? Math.min(1, Math.max(start, end)) : -1;
  }
  const t = (px * v - pz * u) / denom, at = (px * z - pz * x) / denom;
  return t >= 0 && t <= 1 && at >= 0 && at <= 1 ? t : -1;
}

// Convert a stream with published width into strips, so short diagonal crossings
// between samples are just as visible to the planner as a wide lake.
function stripsOf(line, width) {
  const rings = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (!len) continue;
    const u = -dz / len * width / 2, v = dx / len * width / 2;
    rings.push([[a[0] + u, a[1] + v], [b[0] + u, b[1] + v], [b[0] - u, b[1] - v], [a[0] - u, a[1] - v]]);
  }
  return rings;
}

export function createMapShotGeometry({ hole, tiles, mask, bunkers, water, hardGround = [], uncertainWater = [], boundaries, buildings }) {
  const trees = [];
  for (const { crowns } of tiles) for (let i = 0; i < crowns.length; i += 3) {
    trees.push({ x: crowns[i], z: crowns[i + 1], radius: crowns[i + 2] });
  }
  const heightAt = (x, z) => {
    const t = tiles.find(tile => x >= tile.x0 && z >= tile.z0 && x <= tile.x0 + tile.size && z <= tile.z0 + tile.size);
    return t ? sampleTile(t.heights, (x - t.x0) / t.size, (z - t.z0) / t.size, t.width) : NaN;
  };
  function wetAt(x, z) {
    if (!mask) return false;
    const col = Math.floor((x - mask.x0) / mask.spacing), row = Math.floor((z - mask.z0) / mask.spacing);
    return col >= 0 && row >= 0 && col < mask.width && row < mask.height && Boolean(mask.wet[row * mask.width + col]);
  }
  const boxed = ring => ({ ring, box: ringBBox(ring) });
  const ponds = water.map(boxed);
  const carries = [...ponds, ...bunkers.map(boxed)];
  const areas = [...carries, ...hardGround.map(boxed)];
  const lines = boundaries.map(run => ({ ...run, box: ringBBox(run.line) }));
  const originAllowed = (x, z) => Number.isFinite(heightAt(x, z)) && !wetAt(x, z)
    && !ponds.some(({ ring, box }) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && inRing(x, z, ring))
    && !uncertainWater.some(ring => inRing(x, z, ring)) && onPlayableSide(x, z);
  function landingInset(x, z) {
    if (wetAt(x, z)) return 0;
    let nearest = Infinity;
    for (const { ring, box } of areas) {
      // No point inside this box can be closer than its nearest face.
      if (Math.max(box.x0 - x, x - box.x1, box.z0 - z, z - box.z1) >= nearest) continue;
      nearest = Math.min(nearest, ringSD(x, z, ring));
      if (nearest <= 0) break;
    }
    for (const { line, box } of lines) {
      if (Math.max(box.x0 - x, x - box.x1, box.z0 - z, z - box.z1) >= nearest) continue;
      for (let i = 1; i < line.length; i++) nearest = Math.min(nearest, ptSegD(x, z, ...line[i - 1], ...line[i]));
    }
    return nearest;
  }
  // A ball may fly over an OB boundary and come back into play. Check the
  // landing side of a hole-specific rule against this hole's route. Unowned
  // stake runs indicate a margin only: joining them or extending their ends
  // would put perfectly playable grass on a neighbouring hole out of bounds.
  const localRules = lines.filter(run => run.holeSpecific);
  function onPlayableSide(x, z) {
    if (!localRules.length) return true;
    const candidate = [x, z], anchor = nearestPointOnLine(candidate, hole.line).point;
    const box = ringBBox([anchor, candidate]);
    for (const { line, box: bounds } of localRules) {
      if (!intersects(box, bounds)) continue;
      const hits = [];
      for (let i = 1; i < line.length; i++) {
        const t = crossing(anchor, candidate, line[i - 1], line[i]);
        if (t >= 0 && hits.every(other => Math.abs(t - other) > 1e-8)) {
          hits.push(t);
        }
      }
      if (hits.length % 2) return false;
    }
    return true;
  }
  const makeEnvironment = obstacles => createShotEnvironment({ trees: obstacles,
    buildings: [...buildings, ...uncertainWater], terrainHeight: heightAt,
    landingAllowed: (x, z) => Number.isFinite(heightAt(x, z)) && landingInset(x, z) >= 2 && onPlayableSide(x, z) });
  const physical = makeEnvironment(trees);
  // If a GPS lie starts inside a clearance margin but outside every physical
  // crown, it can regain the margin by heading directly away. Only those
  // initial crowns receive this treatment. Keep every other obstacle checked
  // by the shared planner, including roofs, terrain, and the next tree.
  const starts = new WeakMap();
  function departure(point) {
    if (starts.has(point)) return starts.get(point);
    let start = null;
    if (!physical.clearSegment(point, point)) {
      const initial = trees.filter(t => Math.hypot(point[0] - t.x, point[1] - t.z) <= t.radius + physical.clearance);
      if (initial.length && initial.every(t => Math.hypot(point[0] - t.x, point[1] - t.z) > t.radius)) {
        const rest = makeEnvironment(trees.filter(t => !initial.includes(t)));
        if (rest.clearSegment(point, point)) start = { initial, rest };
      }
    }
    starts.set(point, start);
    return start;
  }
  const canStartAt = p => physical.clearSegment(p, p) || Boolean(departure(p));
  function clearSegment(a, b) {
    if (physical.clearSegment(a, b)) return true;
    if (a[0] === b[0] && a[1] === b[1]) return false;
    const start = departure(a);
    if (!start) return false;
    for (const tree of start.initial) {
      const dot = (b[0] - a[0]) * (a[0] - tree.x) + (b[1] - a[1]) * (a[1] - tree.z);
      if (dot < 0 || Math.hypot(b[0] - tree.x, b[1] - tree.z) <= tree.radius + physical.clearance) return false;
    }
    return start.rest.clearSegment(a, b);
  }
  function carryRequired(a, b) {
    const box = ringBBox([a, b]), distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let last = -1;
    for (const { ring, box: bounds } of carries) {
      if (!intersects(box, bounds)) continue;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        last = Math.max(last, crossing(a, b, ring[j], ring[i]));
      }
    }
    if (mask) {
      const steps = Math.max(1, Math.ceil(distance / (mask.spacing / 2)));
      // From the target backwards: only the last wet cell affects required carry.
      for (let i = steps; i >= 0 && i / steps > last; i--) {
        const t = i / steps;
        if (wetAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) {
          last = Math.min(1, (i + 1) / steps);
          break;
        }
      }
    }
    return last < 0 ? 0 : last * distance + 2;
  }
  return { hole, heightAt, environment: { ...physical, canStartAt, clearSegment, originAllowed, landingInset, carryRequired } };
}
