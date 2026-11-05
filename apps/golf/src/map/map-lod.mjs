/* Which tiles a view draws. Pure, so its rules are tested without a GPU.

   The published ground is a strict quadtree: 16,384 m at the root down to
   256 m tiles of 1 m samples, every tile the same 257 x 257 grid. Choosing a
   tile by how large one of its samples lands on screen is what lets a whole
   course stand on the phone with the 1 m data in view: the hole in front of
   the camera reads 1 m tiles, and the far side of the course a handful of
   coarse ones.

   A view is drawn in PATCHES, not tiles. A tile whose child has not arrived
   (or does not exist) draws just that quadrant itself, from its own textures,
   so the ground never opens while fine tiles stream in and there is no rule
   that all four children must be present. */
export const TILE_SEGMENTS = 256;
export const TILE_SAMPLES = TILE_SEGMENTS + 1;
/* Two metres between vertices is the finest mesh there is, even on a 1 m tile:
   the relief is lit per pixel from every sample, so more triangles would add
   cost and no shape a golfer could see. */
export const PATCH_GRIDS = Object.freeze([16, 32, 64, 128]);

export function buildTileTree(ground) {
  const { easting, northing, heightRH2000 } = ground.frame.origin;
  const nodes = new Map();
  for (const tile of ground.tiles) {
    const b = tile.bounds;
    nodes.set(tile.id, {
      id: tile.id,
      lod: tile.lod,
      x0: b.minEasting - easting,
      z0: northing - b.maxNorthing,
      size: b.maxEasting - b.minEasting,
      minY: b.minHeightRH2000 - heightRH2000,
      maxY: b.maxHeightRH2000 - heightRH2000,
      spacing: (b.maxEasting - b.minEasting) / TILE_SEGMENTS,
      layers: tile.layers,
      parent: null,
      children: [null, null, null, null],
    });
  }
  let root = null;
  for (const tile of ground.tiles) {
    const node = nodes.get(tile.id);
    if (tile.parentId === null || tile.parentId === undefined) { root = node; continue; }
    const parent = nodes.get(tile.parentId);
    if (!parent) throw new Error(`tile ${tile.id} names a missing parent ${tile.parentId}`);
    const half = parent.size / 2;
    const east = node.x0 >= parent.x0 + half - 1e-6 ? 1 : 0;
    const south = node.z0 >= parent.z0 + half - 1e-6 ? 1 : 0;
    node.parent = parent;
    parent.children[south * 2 + east] = node;
  }
  if (!root) throw new Error('the ground has no root tile');
  return { nodes, root };
}

/* Six planes (a, b, c, d) of a clip-from-world matrix, normals pointing in. */
export function frustumPlanes(m) {
  const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
  const add = (a, b, s) => a.map((v, i) => v + s * b[i]);
  return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), add(r3, r2, 1), add(r3, r2, -1)];
}

/* False only when the box is wholly outside one plane. That leaves a few
   coarse tiles a true test would reject; the price is a tile, not a hole. */
export function boxInFrustum(planes, x0, y0, z0, x1, y1, z1) {
  for (const [a, b, c, d] of planes) {
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}

function boxDistance(eye, x0, y0, z0, x1, y1, z1) {
  const dx = Math.max(x0 - eye[0], 0, eye[0] - x1);
  const dy = Math.max(y0 - eye[1], 0, eye[1] - y1);
  const dz = Math.max(z0 - eye[2], 0, eye[2] - z1);
  return Math.hypot(dx, dy, dz);
}

function gridFor(patchPixels, vertexPixels, maxSegments) {
  const want = patchPixels / vertexPixels;
  for (const n of PATCH_GRIDS) if (n >= want || n >= maxSegments) return Math.min(n, maxSegments);
  return Math.min(PATCH_GRIDS.at(-1), maxSegments);
}

function selectOnce(view, texelPixels) {
  const { root, isReady, eye, planes, pixelsPerRadian, exaggeration, vertexPixels } = view;
  /* Every ready tile the walk went through, whether or not it drew anything. A parent
     tests a quadrant with its own wide height range and a child with its tight one, so
     a child can be wanted, arrive, and turn out to show nothing: it still has to stay,
     or the parent wants it straight back, for ever. */
  const patches = [], wanted = [], visited = [];
  const yLow = node => node.minY * exaggeration, yHigh = node => node.maxY * exaggeration;

  const emit = (node, u0, v0, span, distance) => {
    const size = node.size * span;
    const patchPixels = size * pixelsPerRadian / Math.max(distance, 1);
    patches.push({ node, u0, v0, span, grid: gridFor(patchPixels, vertexPixels, Math.round(TILE_SEGMENTS * span)) });
  };

  const visit = node => {
    visited.push(node);
    const x1 = node.x0 + node.size, z1 = node.z0 + node.size;
    const distance = boxDistance(eye, node.x0, yLow(node), node.z0, x1, yHigh(node), z1);
    const samplePixels = node.spacing * pixelsPerRadian / Math.max(distance, 1);
    if (node.lod === 0 || samplePixels <= texelPixels) { emit(node, 0, 0, 1, distance); return; }
    const half = node.size / 2;
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const east = quadrant & 1, south = quadrant >> 1;
      const qx = node.x0 + east * half, qz = node.z0 + south * half;
      if (!boxInFrustum(planes, qx, yLow(node), qz, qx + half, yHigh(node), qz + half)) continue;
      const child = node.children[quadrant];
      if (child && isReady(child)) { visit(child); continue; }
      const reach = boxDistance(eye, qx, yLow(node), qz, qx + half, yHigh(node), qz + half);
      if (child) wanted.push({ node: child, distance: reach });
      emit(node, east / 2, south / 2, 0.5, reach);
    }
  };
  if (isReady(root)) visit(root); else wanted.push({ node: root, distance: 0 });
  return { patches, wanted, visited };
}

/* Coarse before fine: a missing parent costs more of the picture than a
   missing child, and a tile's children are only reachable through it. */
/* How many of each tile's trees to draw. The nearest are all there; past them a wood
   thins evenly as the budget runs out, and thins a little with distance anyway, so a
   wide view keeps every wood instead of drawing the near ones and none of the rest.
   Each tile's list is shuffled, so a thinner wood is the same wood with fewer trees. */
const ALL_TREES_WITHIN_METRES = 400;
export function shareTrees(sources, budget, reach) {
  const wants = sources.map(source => source.count * (1 - Math.min(1, Math.max(0, source.reach / reach)) * 0.55));
  let left = budget, wanting = wants.reduce((sum, want) => sum + want, 0);
  return sources.map((source, k) => {
    const ratio = source.reach < ALL_TREES_WITHIN_METRES ? 1 : Math.min(1, left / Math.max(wanting, 1));
    const count = Math.min(Math.round(wants[k] * ratio), left);
    wanting -= wants[k];
    left -= count;
    return { ...source, count };
  }).filter(source => source.count > 0);
}

const loadOrder = (a, b) => b.node.lod - a.node.lod || a.distance - b.distance;

export function selectPatches({
  root, isReady, eye, planes, pixelsPerRadian, exaggeration = 1,
  texelPixels = 2.6, vertexPixels = 22, maxPatches = 96,
}) {
  const view = { root, isReady, eye, planes, pixelsPerRadian, exaggeration, vertexPixels };
  let limit = texelPixels, result = selectOnce(view, limit);
  /* A steep view of a large screen can ask for more than the budget. Coarsen
     the whole view evenly rather than truncate the far side of it. */
  for (let i = 0; i < 12 && result.patches.length + result.wanted.length > maxPatches; i++) {
    limit *= 1.35;
    result = selectOnce(view, limit);
  }
  result.wanted.sort(loadOrder);
  return result;
}
