import { inRingIndexed } from './ring-index.mjs';

const MAX_CELLS = 2e6;
const SHORE_DISTANCE_CAP = 60;
const finite = Number.isFinite;

/* A visual sea surface on an unmodified terrain sampler, in the caller's
 * coordinate and height frame. Mapped sea polygons seed connectivity only:
 * their offshore closure edges never clip the mesh or acquire shoreline foam.
 * Height contours refine the coast; neither missing terrain nor disconnected
 * inland depressions become water. This is not a new surveyed shoreline.
 */
export function buildContinuousOcean({ bounds, heightAt, seaLevel, tolerance = 0.15,
  spacing = 16, refineSpacing = 4, bodies = [] } = {}) {
  if (!bounds || !['x0', 'x1', 'z0', 'z1'].every(k => finite(bounds[k])) ||
      bounds.x0 >= bounds.x1 || bounds.z0 >= bounds.z1) {
    throw new TypeError('Continuous ocean needs finite ordered bounds');
  }
  if (typeof heightAt !== 'function' || !finite(seaLevel) || !finite(tolerance) || tolerance < 0 ||
      !finite(spacing) || spacing <= 0 || !finite(refineSpacing) || refineSpacing <= 0 || !Array.isArray(bodies)) {
    throw new TypeError('Continuous ocean needs a sampler, finite level, nonnegative tolerance and positive spacing');
  }
  const width = Math.ceil((bounds.x1 - bounds.x0) / spacing);
  const height = Math.ceil((bounds.z1 - bounds.z0) / spacing);
  const cellCount = width * height;
  if (cellCount > MAX_CELLS) throw new RangeError('Continuous ocean grid exceeds its cell budget');
  const ratio = Math.max(1, Math.ceil(spacing / refineSpacing));
  if (ratio > 16) throw new RangeError('Continuous ocean refinement exceeds its sampling budget');
  const maximumCoveredTerrainHeight = seaLevel + tolerance;
  if (!finite(maximumCoveredTerrainHeight)) throw new TypeError('Continuous ocean height limit must be finite');
  const seas = bodies.filter(w => w.isSea).map(w => {
    if (!Array.isArray(w.ring) || w.ring.length < 3 ||
        w.ring.some(p => !Array.isArray(p) || !finite(p[0]) || !finite(p[1]))) {
      throw new TypeError('Continuous ocean needs finite mapped sea rings');
    }
    return { ring: w.ring, x0: Math.min(...w.ring.map(p => p[0])), x1: Math.max(...w.ring.map(p => p[0])),
      z0: Math.min(...w.ring.map(p => p[1])), z1: Math.max(...w.ring.map(p => p[1])) };
  });
  const positions = [], indices = [], shorelineDistances = [];
  const terrainCoverage = new Uint8Array(cellCount);
  const result = { kind: 'continuous-ocean', bounds: { ...bounds }, sourceBounds: null,
    seaLevel, spacing, refineSpacing: spacing / ratio, width, height, positions, indices,
    shorelineDistances, terrainCoverage, maximumCoveredTerrainHeight, cells: 0, quads: 0,
    triangles: 0, refinedCells: 0, shorelineSegments: 0, sampleCount: 0, isSeaAt: () => false };
  if (!seas.length) return result;

  const stride = width + 1, vertexCount = stride * (height + 1), baseCount = vertexCount + cellCount;
  const heights = new Float64Array(baseCount);
  const gx = i => Math.min(bounds.x1, bounds.x0 + i * spacing);
  const gz = j => Math.min(bounds.z1, bounds.z0 + j * spacing);
  const sample = (x, z) => { const h = heightAt(x, z); return finite(h) ? h : Number.NaN; };
  for (let j = 0; j <= height; j++) for (let i = 0; i <= width; i++) heights[j * stride + i] = sample(gx(i), gz(j));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    heights[vertexCount + j * width + i] = sample((gx(i) + gx(i + 1)) / 2, (gz(j) + gz(j + 1)) / 2);
  }
  const extraH = [], extraX = [], extraZ = [], fineNodes = new Map();
  const hAt = id => id < baseCount ? heights[id] : extraH[id - baseCount];
  const wet = id => hAt(id) <= maximumCoveredTerrainHeight;
  const point = id => {
    if (id < vertexCount) return [gx(id % stride), gz(Math.floor(id / stride))];
    if (id < baseCount) {
      const k = id - vertexCount, i = k % width, j = Math.floor(k / width);
      return [(gx(i) + gx(i + 1)) / 2, (gz(j) + gz(j + 1)) / 2];
    }
    return [extraX[id - baseCount], extraZ[id - baseCount]];
  };
  const coarseIds = k => {
    const a = Math.floor(k / width) * stride + k % width;
    return [a, a + 1, a + stride + 1, a + stride, vertexCount + k];
  };
  const coarseValid = new Uint8Array(cellCount), coarseWet = new Uint8Array(cellCount);
  const refine = new Set(), pending = [];
  const addRefinement = k => {
    if (ratio === 1 || refine.has(k)) return;
    if (cellCount + (refine.size + 1) * (ratio * ratio - 1) > MAX_CELLS) {
      throw new RangeError('Continuous ocean refined coast exceeds its cell budget');
    }
    refine.add(k); pending.push(k);
  };
  for (let k = 0; k < cellCount; k++) {
    const ids = coarseIds(k);
    coarseValid[k] = ids.every(id => finite(hAt(id))) ? 1 : 0;
    coarseWet[k] = ids.reduce((n, id) => n + Number(wet(id)), 0);
  }
  // Refine a band around mixed cells, including the dry side of the contour.
  for (let k = 0; k < cellCount; k++) {
    if (!coarseWet[k] || (coarseValid[k] && coarseWet[k] === 5)) continue;
    const i = k % width, j = Math.floor(k / width);
    for (let z = Math.max(0, j - 1); z <= Math.min(height - 1, j + 1); z++) {
      for (let x = Math.max(0, i - 1); x <= Math.min(width - 1, i + 1); x++) addRefinement(z * width + x);
    }
  }
  const fineStride = width * ratio * 2 + 1;
  const fineCoordinate = (n, coord) => {
    const a = n / (ratio * 2), c = Math.floor(a);
    return coord(c) + (coord(c + 1) - coord(c)) * (a - c);
  };
  const node = (x, z) => {
    const unit = ratio * 2, rx = x % unit, rz = z % unit;
    if (rx === 0 && rz === 0) return (z / unit) * stride + x / unit;
    if (rx === ratio && rz === ratio) return vertexCount + Math.floor(z / unit) * width + Math.floor(x / unit);
    const key = z * fineStride + x;
    let id = fineNodes.get(key);
    if (id !== undefined) return id;
    id = baseCount + extraH.length;
    const px = fineCoordinate(x, gx), pz = fineCoordinate(z, gz);
    extraX.push(px); extraZ.push(pz); extraH.push(sample(px, pz)); fineNodes.set(key, id);
    return id;
  };
  const blocks = new Map();
  for (let q = 0; q < pending.length; q++) {
    const k = pending[q], col = k % width, row = Math.floor(k / width), n = ratio + 1;
    const vs = new Int32Array(n * n), cs = new Int32Array(ratio * ratio);
    for (let b = 0; b <= ratio; b++) for (let a = 0; a <= ratio; a++) {
      vs[b * n + a] = node((col * ratio + a) * 2, (row * ratio + b) * 2);
    }
    for (let b = 0; b < ratio; b++) for (let a = 0; a < ratio; a++) {
      cs[b * ratio + a] = node((col * ratio + a) * 2 + 1, (row * ratio + b) * 2 + 1);
    }
    blocks.set(k, { vs, cs });
    // A newly sampled headland on a shared edge must refine the adjacent
    // all-water cell too; a coarse quad must not cover that dry edge sample.
    const edges = [Array.from({ length: n }, (_, a) => vs[a]),
      Array.from({ length: n }, (_, b) => vs[b * n + ratio]),
      Array.from({ length: n }, (_, a) => vs[ratio * n + a]),
      Array.from({ length: n }, (_, b) => vs[b * n])];
    const neighbours = [row ? k - width : -1, col + 1 < width ? k + 1 : -1,
      row + 1 < height ? k + width : -1, col ? k - 1 : -1];
    for (let e = 0; e < 4; e++) if (neighbours[e] >= 0 && coarseWet[neighbours[e]] === 5 &&
        edges[e].some(id => !wet(id))) addRefinement(neighbours[e]);
  }
  const fineIds = (block, k) => {
    const n = ratio + 1, a = Math.floor(k / ratio) * n + k % ratio;
    return [block.vs[a], block.vs[a + 1], block.vs[a + n + 1], block.vs[a + n], block.cs[k]];
  };
  const visitCells = fn => {
    for (let k = 0; k < cellCount; k++) {
      const block = blocks.get(k);
      if (block) for (let c = 0; c < ratio * ratio; c++) fn(fineIds(block, c), k, true);
      else fn(coarseIds(k), k, false);
    }
  };
  const count = baseCount + extraH.length, parent = new Int32Array(count).fill(-1), rank = new Uint8Array(count);
  for (let id = 0; id < count; id++) if (wet(id)) parent[id] = id;
  const find = id => {
    let r = id;
    while (parent[r] !== r) r = parent[r];
    while (parent[id] !== id) { const next = parent[id]; parent[id] = r; id = next; }
    return r;
  };
  const join = (a, b) => {
    if (parent[a] < 0 || parent[b] < 0) return;
    a = find(a); b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  };
  visitCells(ids => {
    if (!ids.every(id => finite(hAt(id)))) return;
    for (let a = 0; a < 4; a++) { join(ids[a], ids[(a + 1) % 4]); join(ids[a], ids[4]); }
  });
  const seeded = new Uint8Array(count), connected = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    if (parent[id] < 0) continue;
    const root = find(id);
    if (seeded[root]) continue;
    const [x, z] = point(id);
    if (seas.some(s => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && inRingIndexed(x, z, s.ring))) seeded[root] = 1;
  }
  for (let id = 0; id < count; id++) if (parent[id] >= 0) connected[id] = seeded[find(id)];

  const segments = [], pieces = [], full = new Uint8Array(cellCount), drawn = new Uint8Array(cellCount);
  const clippedTriangle = ids => {
    if (!ids.some(id => connected[id])) return null;
    const polygon = [], cuts = [];
    for (let a = 0; a < 3; a++) {
      const id = ids[a], next = ids[(a + 1) % 3], p = point(id), q = point(next);
      if (wet(id)) polygon.push({ x: p[0], z: p[1], id });
      if (wet(id) !== wet(next)) {
        const t = (maximumCoveredTerrainHeight - hAt(id)) / (hAt(next) - hAt(id));
        const cut = { x: p[0] + (q[0] - p[0]) * t, z: p[1] + (q[1] - p[1]) * t, id: -1 };
        polygon.push(cut); cuts.push(cut);
      }
    }
    if (cuts.length === 2) segments.push([cuts[0].x, cuts[0].z, cuts[1].x, cuts[1].z]);
    return polygon;
  };
  visitCells((ids, k, refined) => {
    if (!ids.every(id => finite(hAt(id))) || !ids.some(id => connected[id])) return;
    drawn[k] = 1;
    if (ids.every(id => connected[id])) {
      if (!refined) full[k] = terrainCoverage[k] = 1;
      else pieces.push(ids.slice(0, 4).map(id => { const [x, z] = point(id); return { x, z, id }; }));
      return;
    }
    for (let a = 0; a < 4; a++) {
      const polygon = clippedTriangle([ids[a], ids[(a + 1) % 4], ids[4]]);
      if (polygon?.length >= 3) pieces.push(polygon);
    }
  });
  // A spatial index of height contours, excluding world edges and missing
  // data, supplies continuous metre distances without artificial crop foam.
  const binSize = SHORE_DISTANCE_CAP, bx0 = Math.floor(bounds.x0 / binSize) - 1;
  const bz0 = Math.floor(bounds.z0 / binSize) - 1, binWidth = Math.ceil((bounds.x1 - bounds.x0) / binSize) + 4;
  const bins = new Map(), distances = new Float32Array(count).fill(-1);
  const keyAt = (i, j) => (j - bz0) * binWidth + i - bx0;
  for (const s of segments) {
    for (let j = Math.floor(Math.min(s[1], s[3]) / binSize); j <= Math.floor(Math.max(s[1], s[3]) / binSize); j++) {
      for (let i = Math.floor(Math.min(s[0], s[2]) / binSize); i <= Math.floor(Math.max(s[0], s[2]) / binSize); i++) {
        const key = keyAt(i, j), list = bins.get(key);
        if (list) list.push(s); else bins.set(key, [s]);
      }
    }
  }
  const shoreDistance = id => {
    if (distances[id] >= 0) return distances[id];
    const [x, z] = point(id), bx = Math.floor(x / binSize), bz = Math.floor(z / binSize);
    let d2 = SHORE_DISTANCE_CAP ** 2;
    for (let j = bz - 1; j <= bz + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) {
      for (const s of bins.get(keyAt(i, j)) ?? []) {
        const dx = s[2] - s[0], dz = s[3] - s[1], length2 = dx * dx + dz * dz;
        const t = length2 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / length2)) : 0;
        d2 = Math.min(d2, (x - s[0] - t * dx) ** 2 + (z - s[1] - t * dz) ** 2);
      }
    }
    return distances[id] = Math.sqrt(d2);
  };
  const addVertex = (x, z, distance) => {
    const id = positions.length / 3;
    positions.push(x, seaLevel, z); shorelineDistances.push(distance);
    return id;
  };
  const quad = (x0, z0, x1, z1, sh) => {
    const a = addVertex(x0, z0, sh[0]); addVertex(x1, z0, sh[1]);
    addVertex(x1, z1, sh[2]); addVertex(x0, z1, sh[3]);
    indices.push(a, a + 2, a + 1, a, a + 3, a + 2); result.quads++;
  };
  const deep = k => full[k] && coarseIds(k).slice(0, 4).every(id => shoreDistance(id) >= SHORE_DISTANCE_CAP);
  for (let j = 0; j < height; j++) for (let i = 0; i < width;) {
    const k = j * width + i;
    if (!full[k]) { i++; continue; }
    if (!deep(k)) {
      quad(gx(i), gz(j), gx(i + 1), gz(j + 1), coarseIds(k).slice(0, 4).map(shoreDistance)); i++; continue;
    }
    const start = i++;
    while (i < width && deep(j * width + i)) i++;
    quad(gx(start), gz(j), gx(i), gz(j + 1), [60, 60, 60, 60]);
  }
  for (const polygon of pieces) {
    const ids = polygon.map(p => addVertex(p.x, p.z, p.id < 0 ? 0 : shoreDistance(p.id)));
    for (let i = 1; i + 1 < ids.length; i++) {
      const a = polygon[0], b = polygon[i], c = polygon[i + 1];
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) > 1e-10) indices.push(ids[0], ids[i + 1], ids[i]);
    }
  }
  const cellContains = (ids, u, v) => {
    if (!ids.every(id => finite(hAt(id)))) return false;
    let side, a, b, c;
    if (v <= u && v <= 1 - u) { side = 0; a = 1 - u - v; b = u - v; c = 2 * v; }
    else if (u >= v && u >= 1 - v) { side = 1; a = u - v; b = u + v - 1; c = 2 * (1 - u); }
    else if (v >= u && v >= 1 - u) { side = 2; a = u + v - 1; b = v - u; c = 2 * (1 - v); }
    else { side = 3; a = v - u; b = 1 - u - v; c = 2 * u; }
    const p = ids[side], q = ids[(side + 1) % 4], r = ids[4];
    return Boolean(connected[p] || connected[q] || connected[r]) && a * hAt(p) + b * hAt(q) + c * hAt(r) <= maximumCoveredTerrainHeight + 1e-9;
  };
  result.isSeaAt = (x, z) => {
    if (!finite(x) || !finite(z) || x < bounds.x0 || z < bounds.z0 || x >= bounds.x1 || z >= bounds.z1) return false;
    const i = Math.floor((x - bounds.x0) / spacing), j = Math.floor((z - bounds.z0) / spacing), k = j * width + i;
    if (full[k]) return true;
    if (!drawn[k]) return false;
    const u = (x - gx(i)) / (gx(i + 1) - gx(i)), v = (z - gz(j)) / (gz(j + 1) - gz(j));
    const block = blocks.get(k);
    if (!block) return cellContains(coarseIds(k), u, v);
    const a = Math.min(ratio - 1, Math.floor(u * ratio)), b = Math.min(ratio - 1, Math.floor(v * ratio));
    return cellContains(fineIds(block, b * ratio + a), u * ratio - a, v * ratio - b);
  };
  result.cells = drawn.reduce((n, value) => n + value, 0);
  result.triangles = indices.length / 3; result.refinedCells = blocks.size;
  result.shorelineSegments = segments.length; result.sampleCount = count;
  return result;
}
