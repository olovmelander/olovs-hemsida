import { inRingIndexed } from './ring-index.mjs';
import { waterShoreDistance } from './water-shore.mjs';

/* Extend a mapped sea into the surrounding DTM, never across its mapped land.
 * The source window is authoritative (including islands and low dry ground).
 * Beyond it, only low cells connected to that sea are eligible. This is a
 * conservative visual extension at the stated spacing, not new shoreline data.
 * No elevation is edited. Missing samples and disconnected depressions stay dry.
 */
export function buildCoastalWater({ bounds, sourceBounds, bodies, heightAt,
  seaLevel, tolerance = 0.05, spacing = 32 } = {}) {
  for (const box of [bounds, sourceBounds]) {
    if (!box || !['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(box[k])) ||
        box.x1 <= box.x0 || box.z1 <= box.z0) throw new TypeError('Coastal water needs finite ordered bounds');
  }
  if (!(spacing > 0) || !Number.isFinite(spacing) || !Number.isFinite(seaLevel) ||
      !Number.isFinite(tolerance) || tolerance < 0 || typeof heightAt !== 'function') {
    throw new TypeError('Coastal water needs a sampler, level and positive spacing');
  }
  const width = Math.ceil((bounds.x1 - bounds.x0) / spacing);
  const height = Math.ceil((bounds.z1 - bounds.z0) / spacing);
  if (width * height > 2e6) throw new RangeError('Coastal water grid exceeds its boot budget');
  const seas = bodies.filter(w => w.isSea && w.ring?.length >= 3).map(w => ({
    water: w,
    ring: w.ring,
    x0: Math.min(...w.ring.map(p => p[0])), x1: Math.max(...w.ring.map(p => p[0])),
    z0: Math.min(...w.ring.map(p => p[1])), z1: Math.max(...w.ring.map(p => p[1])),
  }));
  const inBox = (x, z, b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  const mappedSea = (x, z) => seas.some(w => inBox(x, z, w) && inRingIndexed(x, z, w.ring));
  const wet = (x, z) => {
    if (inBox(x, z, sourceBounds)) return mappedSea(x, z);
    const h = heightAt(x, z);
    return Number.isFinite(h) && h <= seaLevel + tolerance;
  };
  const candidate = new Uint8Array(width * height);
  const connected = new Uint8Array(candidate.length);
  const queue = new Int32Array(candidate.length);
  let head = 0, tail = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = bounds.x0 + (col + 0.5) * spacing, z = bounds.z0 + (row + 0.5) * spacing;
    const i = row * width + col;
    if (!wet(x, z)) continue;
    candidate[i] = 1;
    if (inBox(x, z, sourceBounds) && mappedSea(x, z)) {
      connected[i] = 1; queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++], col = i % width;
    for (const n of [col ? i - 1 : -1, col + 1 < width ? i + 1 : -1, i - width, i + width]) {
      if (n < 0 || n >= candidate.length || connected[n] || !candidate[n]) continue;
      connected[n] = 1; queue[tail++] = n;
    }
  }
  const extension = new Uint8Array(candidate.length);
  let cells = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col;
    if (!connected[i]) continue;
    const x = bounds.x0 + col * spacing, z = bounds.z0 + row * spacing;
    const x1 = Math.min(x + spacing, bounds.x1), z1 = Math.min(z + spacing, bounds.z1);
    // Mapped water already has exact meshes. Never overlay the source window.
    if (x < sourceBounds.x1 && x1 > sourceBounds.x0 && z < sourceBounds.z1 && z1 > sourceBounds.z0) continue;
    // A centre alone can miss a headland/island. Check corners and edge centres.
    if (![[x,z], [x1,z], [x,z1], [x1,z1], [(x+x1)/2,z], [(x+x1)/2,z1],
      [x,(z+z1)/2], [x1,(z+z1)/2]].every(([a,b]) => wet(a,b))) continue;
    extension[i] = 1; cells++;
  }
  const isSeaAt = (x, z) => {
    if (!inBox(x, z, bounds)) return false;
    if (inBox(x, z, sourceBounds)) return mappedSea(x, z);
    const col = Math.floor((x - bounds.x0) / spacing), row = Math.floor((z - bounds.z0) / spacing);
    return col < width && row < height && extension[row * width + col] === 1;
  };
  // Horizontal runs avoid submitting hundreds of thousands of identical quads.
  const positions = [], indices = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width;) {
    if (!extension[row * width + col]) { col++; continue; }
    const start = col;
    while (col < width && extension[row * width + col]) col++;
    const x0 = bounds.x0 + start * spacing, x1 = Math.min(bounds.x0 + col * spacing, bounds.x1);
    const z0 = bounds.z0 + row * spacing, z1 = Math.min(z0 + spacing, bounds.z1);
    const base = positions.length / 3;
    positions.push(x0, seaLevel, z0, x1, seaLevel, z0, x0, seaLevel, z1, x1, seaLevel, z1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  // The DTM records the sea surface, not a submerged bed. Two nearly coplanar
  // surfaces remain unstable at range even with a deeper buffer. Omit that
  // redundant terrain surface only where a water sheet is already guaranteed.
  // Offshore cells exactly match emitted extension quads. Within the mapped
  // window, keep a full cell diagonal away from every observed shore/island.
  const terrainCoverage = extension.slice();
  const shoreMargin = spacing * Math.SQRT2;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = bounds.x0 + (col + 0.5) * spacing, z = bounds.z0 + (row + 0.5) * spacing;
    if (x - spacing / 2 < sourceBounds.x0 || x + spacing / 2 > sourceBounds.x1 ||
        z - spacing / 2 < sourceBounds.z0 || z + spacing / 2 > sourceBounds.z1) continue;
    const sea = seas.find(w => inBox(x, z, w) && inRingIndexed(x, z, w.ring));
    if (sea && waterShoreDistance(x, z, sea.water) > shoreMargin) terrainCoverage[row * width + col] = 1;
  }
  return { positions, indices, isSeaAt, spacing, cells, quads: indices.length / 6,
    width, height, terrainCoverage, maximumCoveredTerrainHeight: seaLevel + tolerance,
    bounds: { ...bounds }, sourceBounds: { ...sourceBounds } };
}
