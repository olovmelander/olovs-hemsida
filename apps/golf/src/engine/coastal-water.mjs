import { inRingIndexed, ringSDIndexed } from './ring-index.mjs';
import { squaredDistanceTransform } from '../../../../packages/course-v2/distance-transform.mjs';
import { waterShoreDistance } from './water-shore.mjs';

/* Extend a mapped sea into the surrounding DTM, never across its mapped land.
 * The source window is authoritative (including islands and low dry ground).
 * Beyond it, only low cells connected to that sea are eligible. This is a
 * conservative visual extension at the stated spacing, not new shoreline data.
 * No elevation is edited. Missing samples and disconnected depressions stay dry.
 */
export function buildCoastalWater({ bounds, sourceBounds, bodies, heightAt,
  seaLevel, tolerance = 0.05, spacing = 32, growCoast = false } = {}) {
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
  /* THE COAST, NOT THE CELLS (7 November, owner: "sharp lines in the water in the
     distance"). Only cells wet at all eight samples were drawn, so every cell the
     coast crosses was left out: the sea ended in a 32 m staircase, with the laser's
     own sea surface beside it drawn as pale flat ground. The sheet now takes one
     cell more round the drawn sea, outside the mapped window, and the terrain mask
     below covers the same cells: there the low surface gives way to the water and
     anything above the sea's tolerance stays, pixel by pixel, so the coastline is
     the ground's own. Tints and isSeaAt keep the conservative cells. */
  const drawn = extension.slice();
  let grownCells = 0;
  if (growCoast) {
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const i = row * width + col;
      if (extension[i]) continue;
      const x = bounds.x0 + col * spacing, z = bounds.z0 + row * spacing;
      const x1 = Math.min(x + spacing, bounds.x1), z1 = Math.min(z + spacing, bounds.z1);
      if (x < sourceBounds.x1 && x1 > sourceBounds.x0 && z < sourceBounds.z1 && z1 > sourceBounds.z0) continue;
      let touches = false;
      for (let dr = -1; dr <= 1 && !touches; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < height && c >= 0 && c < width && extension[r * width + c]) { touches = true; break; }
      }
      if (!touches) continue;
      drawn[i] = 1; grownCells++;
    }
  }
  /* THE SHALLOWS ACROSS THE WINDOW'S EDGE. Every extension vertex was 60 m from shore,
     so where the mapped window's sheet ran its turquoise shallows into the coast, the
     extension beside it was deep blue: a straight colour seam across the water at the
     window's edge. With growCoast each vertex carries its distance to the coast (the
     nearest cell that is neither drawn sea nor the window's mapped sea), and a cell
     within reach of the coast is drawn on its own so its corners carry it. */
  let coastDistance = null;
  if (growCoast) {
    const land = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const i = row * width + col;
      if (drawn[i]) continue;
      const x = bounds.x0 + (col + 0.5) * spacing, z = bounds.z0 + (row + 0.5) * spacing;
      land[i] = inBox(x, z, sourceBounds) && mappedSea(x, z) ? 0 : 1;
    }
    const d2 = squaredDistanceTransform(width, height, i => land[i] === 1);
    /* a sea cell's centre stands half a cell beyond the coast between it and the land */
    coastDistance = new Float32Array(width * height);
    for (let i = 0; i < d2.length; i++) coastDistance[i] = land[i] ? 0 : Math.min(60, Math.max(0, Math.sqrt(d2[i]) * spacing - spacing / 2));
  }
  const cellShore = (col, row) => (col < 0 || row < 0 || col >= width || row >= height ? 60 : coastDistance[row * width + col]);
  const cornerShore = (col, row) => (cellShore(col - 1, row - 1) + cellShore(col, row - 1) + cellShore(col - 1, row) + cellShore(col, row)) / 4;
  const nearCoast = (col, row) => coastDistance && coastDistance[row * width + col] < 60;
  // Horizontal runs avoid submitting hundreds of thousands of identical quads.
  const positions = [], indices = [], shoreDistances = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width;) {
    if (!drawn[row * width + col]) { col++; continue; }
    const start = col;
    if (nearCoast(col, row)) col++;
    else while (col < width && drawn[row * width + col] && !nearCoast(col, row)) col++;
    const x0 = bounds.x0 + start * spacing, x1 = Math.min(bounds.x0 + col * spacing, bounds.x1);
    const z0 = bounds.z0 + row * spacing, z1 = Math.min(z0 + spacing, bounds.z1);
    const base = positions.length / 3;
    positions.push(x0, seaLevel, z0, x1, seaLevel, z0, x0, seaLevel, z1, x1, seaLevel, z1);
    if (coastDistance) shoreDistances.push(cornerShore(start, row), cornerShore(col, row), cornerShore(start, row + 1), cornerShore(col, row + 1));
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  // The DTM records the sea surface, not a submerged bed. Two nearly coplanar
  // surfaces remain unstable at range even with a deeper buffer. Omit that
  // redundant terrain surface only where a water sheet is already guaranteed.
  // Offshore cells exactly match emitted extension quads. Within the mapped
  // window, keep a full cell diagonal away from every observed shore/island.
  const terrainCoverage = drawn.slice();
  const shoreMargin = spacing * Math.SQRT2;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = bounds.x0 + (col + 0.5) * spacing, z = bounds.z0 + (row + 0.5) * spacing;
    if (x - spacing / 2 < sourceBounds.x0 || x + spacing / 2 > sourceBounds.x1 ||
        z - spacing / 2 < sourceBounds.z0 || z + spacing / 2 > sourceBounds.z1) continue;
    const sea = seas.find(w => inBox(x, z, w) && inRingIndexed(x, z, w.ring));
    if (sea && waterShoreDistance(x, z, sea.water) > shoreMargin) terrainCoverage[row * width + col] = 1;
  }
  /* WATER FOR WHAT STANDS ON THE GROUND. isSeaAt is the conservative cells, and the far
     forest was planted by it alone, so trees stood on the laser's own sea surface along
     the coast -- on a pale strip, and in the sea once the coast was drawn by height.
     Here a drawn cell's ground at the sea's tolerance (plus `margin` for a trunk at the
     waterline) is water too: the same rule the terrain mask draws the coastline by. */
  const isWaterAt = (x, z, h, margin = 0.3) => {
    if (isSeaAt(x, z)) return true;
    if (!inBox(x, z, bounds) || inBox(x, z, sourceBounds) || !Number.isFinite(h)) return false;
    const col = Math.floor((x - bounds.x0) / spacing), row = Math.floor((z - bounds.z0) / spacing);
    return col < width && row < height && drawn[row * width + col] === 1 && h <= seaLevel + tolerance + margin;
  };
  return { positions, indices, isSeaAt, isWaterAt, spacing, cells, grownCells, quads: indices.length / 6,
    shoreDistances: coastDistance ? Float32Array.from(shoreDistances) : null,
    width, height, terrainCoverage, maximumCoveredTerrainHeight: seaLevel + tolerance,
    bounds: { ...bounds }, sourceBounds: { ...sourceBounds } };
}

/* THE SEA'S OWN SHORE, IN METRES (27 November, owner report on Visby: "square shapes
   in the water" and "the jigsaw pattern close to the water").

   Inside the mapped window the terrain mask worked in the extension's 32 m cells and
   kept the laser's flat sea plate (0.23 m, 6 cm under the sheet) in every cell within
   a cell's diagonal of a shore. The water's reflection (water-reflection.mjs) finds
   that plate under the sheet and reads its dark colour, so every kept cell drew as a
   darker square: a 32 m staircase along the whole coast, gone with ?waterreflect=0.
   And the sheet was opaque to its polygon's edge, so the waterline was wherever it cut
   the laser's own coast -- the 1 m raster step from the flattened sea (0.23 m) to the
   land (0.6 m), drawn by the terrain's triangles as a sawtooth.

   This is the distance to the mapped sea's shore at `spacing` metres over the window,
   signed (into the sea positive, onto the land negative), from the same polygons the
   sheets draw. The mask removes the plate wherever the sea lies `plateMargin` past its
   shore, so only a thin strip under the sheet's faded edge keeps it; the sheet comes
   in from nothing over its first `fadeMetres`; and the ground just above the sea takes
   the lakes' damp bank (water-reach.mjs SHORE_DAMP) where it lies within `dampReach`
   of the sea. Bilinear in the shader, so the lines it draws are curves, not cells.
   ?seashore=0 is the before. */
export const SEA_SHORE = Object.freeze({ spacing: 3, plateMargin: 4.5, fadeMetres: 3, dampReach: 6, rangeMetres: 32 });

/** The signed distance to the mapped sea's shore over `sourceBounds`, as bytes for a
    texture (128 the shore, 4 a metre, into the sea upward) and a CPU sampler. */
export function buildSeaShoreField({ sourceBounds, bodies, spacing = SEA_SHORE.spacing } = {}) {
  const b = sourceBounds;
  if (!b || !['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(b[k])) || b.x1 <= b.x0 || b.z1 <= b.z0)
    throw new TypeError('The sea shore field needs finite ordered bounds');
  if (!(spacing > 0)) throw new TypeError('The sea shore field needs a positive spacing');
  const seas = (bodies ?? []).filter(w => w.isSea && w.ring?.length >= 3);
  if (!seas.length) return null;
  const width = Math.ceil((b.x1 - b.x0) / spacing), height = Math.ceil((b.z1 - b.z0) / spacing);
  if (width * height > 1.7e7) throw new RangeError('The sea shore field exceeds its boot budget');
  /* every texel centre inside a sea ring, by scanline (the rings are simple: islands are
     partitioned out of them, so a centre inside any ring is sea) */
  const inside = new Uint8Array(width * height);
  for (const { ring } of seas) {
    let zMin = Infinity, zMax = -Infinity;
    for (const p of ring) { zMin = Math.min(zMin, p[1]); zMax = Math.max(zMax, p[1]); }
    const r0 = Math.max(0, Math.floor((zMin - b.z0) / spacing - 0.5)), r1 = Math.min(height - 1, Math.ceil((zMax - b.z0) / spacing - 0.5));
    const xs = [];
    for (let row = r0; row <= r1; row++) {
      const z = b.z0 + (row + 0.5) * spacing;
      xs.length = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const zi = ring[i][1], zj = ring[j][1];
        if ((zi > z) !== (zj > z)) xs.push(ring[i][0] + (z - zi) / (zj - zi) * (ring[j][0] - ring[i][0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - b.x0) / spacing - 0.5));
        const c1 = Math.min(width - 1, Math.floor((xs[k + 1] - b.x0) / spacing - 0.5));
        for (let col = c0; col <= c1; col++) inside[row * width + col] = 1;
      }
    }
  }
  /* a texel's distance to the nearest texel of the other kind, less half a texel, so
     the two either side of a shore read +-half a texel and the zero lies on their edge.
     The window's own edge is no shore: nothing beyond it is counted as land. */
  const toLand = squaredDistanceTransform(width, height, i => inside[i] === 0);
  const toSea = squaredDistanceTransform(width, height, i => inside[i] === 1);
  const range = SEA_SHORE.rangeMetres;
  /* ...and exact within a few texels of the coast, where the fade and the mask's margin are read:
     the texel's own distance to the sea's shoreline (its source shore lines, so a partition's cut
     or a source tile's edge is never a shore; else its ring), since a centre-sampled raster puts
     the coast up to half a texel off */
  const near = 3 * spacing;
  const boxes = seas.map(w => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of w.ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { w, x0: x0 - near, x1: x1 + near, z0: z0 - near, z1: z1 + near };
  });
  const exactShore = (x, z) => {
    let best = Infinity;
    for (const box of boxes) {
      if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue;
      const w = box.w;
      best = Math.min(best, w.shoreline ? waterShoreDistance(x, z, w) : Math.abs(ringSDIndexed(x, z, w.ring)));
    }
    return best;
  };
  const bytes = new Uint8Array(width * height);
  let seaTexels = 0;
  for (let i = 0; i < bytes.length; i++) {
    const d = inside[i] ? Math.sqrt(toLand[i]) : -Math.sqrt(toSea[i]);
    let metres = Number.isFinite(d) ? Math.sign(d) * Math.max(0, Math.abs(d) - 0.5) * spacing : (inside[i] ? range : -range);
    if (Math.abs(metres) <= near) {
      const exact = exactShore(b.x0 + (i % width + 0.5) * spacing, b.z0 + (Math.floor(i / width) + 0.5) * spacing);
      if (Number.isFinite(exact) && exact < near + spacing) metres = inside[i] ? exact : -exact;
    }
    bytes[i] = Math.max(0, Math.min(255, Math.round(128 + Math.max(-range, Math.min(range, metres)) * 4)));
    seaTexels += inside[i];
  }
  const decode = v => (v - 128) / 4;
  /** metres into the sea (negative on land), bilinear as the shader reads it; `outside` beyond the window */
  const distanceAt = (x, z, outside = -range) => {
    const u = (x - b.x0) / spacing - 0.5, v = (z - b.z0) / spacing - 0.5;
    if (u < -0.5 || v < -0.5 || u > width - 0.5 || v > height - 0.5) return outside;
    const c = Math.max(0, Math.min(width - 1, Math.floor(u))), r = Math.max(0, Math.min(height - 1, Math.floor(v)));
    const c1 = Math.min(width - 1, c + 1), r1 = Math.min(height - 1, r + 1);
    const fu = Math.max(0, Math.min(1, u - c)), fv = Math.max(0, Math.min(1, v - r));
    const at = (cc, rr) => decode(bytes[rr * width + cc]);
    return (at(c, r) * (1 - fu) + at(c1, r) * fu) * (1 - fv) + (at(c, r1) * (1 - fu) + at(c1, r1) * fu) * fv;
  };
  return { bytes, width, height, spacing, x0: b.x0, z0: b.z0, rangeMetres: range,
    sizeX: width * spacing, sizeZ: height * spacing, seaTexels, distanceAt };
}
