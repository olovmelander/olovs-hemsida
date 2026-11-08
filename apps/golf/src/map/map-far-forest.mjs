/* The forest past the 1 m tiles.

   The measured trees stop where the 1 m tiles' stands do, a 4 km square on most
   grounds, and past it the map had only its painted canopy: tilted, or in Min vy,
   the woods ended a kilometre or two out and the hills behind them were bare. The
   simulator dresses that ring with impostors calibrated on the measured stands
   (engine/far-ring-calibration.mjs), and the map now does the same from what it
   already holds:

   - where: the ground's forest picture (tools/bake-map-land.mjs), the one the map
     paints there, so a tree stands only on ground already painted as forest;
   - what: a tree of the measured population on the 1 m tiles, its own species,
     height and crown, so the far wood is the near one continued;
   - how many: one per cell of the simulator's band spacing, 10 m and then 15 m,
     each grown to cover the stems it stands for, capped as the simulator caps it
     and never above the tallest tree measured.

   Pure, so its rules are tested without a GPU. */
import { FAR_RING_BANDS } from '../engine/far-ring-calibration.mjs';
import { hash2 } from '../engine/geom.js';
import { TREE_FLOATS } from './map-trees.mjs';

export const FAR_FOREST = Object.freeze({
  /* A cell is culled, planted and drawn as one: about a hole's width. */
  cellMetres: 512,
  /* How many measured trees the far wood is drawn from, and how few will do. */
  samples: 4096,
  minimumSamples: 500,
  perTile: 256,
  /* A wood the planter calls closed has a stem every 10-50 m²: outside that, the
     sample is open ground with a few trees on it, and says nothing of a forest. */
  stemArea: [10, 60],
});

/* The cells of the ground no 1 m tile with stands covers, each with the height range
   of the smallest published tile that holds it, for the frustum test. */
export function farForestCells(root, metreTiles, cellMetres = FAR_FOREST.cellMetres) {
  if (!metreTiles.length) return { cells: [], core: null, covered: () => false };
  const tileSize = metreTiles[0].size;
  const covered = new Set(metreTiles.map(node => `${Math.round(node.x0 / tileSize)},${Math.round(node.z0 / tileSize)}`));
  const core = metreTiles.reduce((box, node) => [Math.min(box[0], node.x0), Math.min(box[1], node.z0),
    Math.max(box[2], node.x0 + node.size), Math.max(box[3], node.z0 + node.size)], [Infinity, Infinity, -Infinity, -Infinity]);
  const isCovered = (x, z) => covered.has(`${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`);
  const cells = [];
  const across = Math.round(root.size / cellMetres);
  for (let row = 0; row < across; row++) {
    for (let column = 0; column < across; column++) {
      const x0 = root.x0 + column * cellMetres, z0 = root.z0 + row * cellMetres;
      let whole = true;
      for (let z = z0; z < z0 + cellMetres && whole; z += tileSize) {
        for (let x = x0; x < x0 + cellMetres; x += tileSize) if (!isCovered(x + 1, z + 1)) { whole = false; break; }
      }
      if (whole) continue;
      let holder = root;
      for (;;) {
        const next = holder.children.find(child => child && child.size >= cellMetres
          && x0 >= child.x0 && x0 + cellMetres <= child.x0 + child.size && z0 >= child.z0 && z0 + cellMetres <= child.z0 + child.size);
        if (!next) break;
        holder = next;
      }
      cells.push({ id: `far-${column}-${row}`, x0, z0, size: cellMetres, minY: holder.minY, maxY: holder.maxY, far: true });
    }
  }
  return { cells, core, covered: isCovered };
}

/* How far outside the measured trees a point is, in metres: 0 inside their box. */
export const outsideCore = (core, x, z) => Math.hypot(Math.max(core[0] - x, 0, x - core[2]), Math.max(core[1] - z, 0, z - core[3]));

/* The simulator's band spacing past the measured trees. Its first band is the
   measured stem spacing, which the map does not need: its own woods thin with
   distance long before 600 m outside them. */
export const farSpacing = away => (away < FAR_RING_BANDS.middleMetres ? FAR_RING_BANDS.middleSpacing : FAR_RING_BANDS.farSpacing);

/* The measured population, gathered tile by tile as the 1 m trees are planted: each
   sample is a tree's crown scale, height scale and species, and the forest picture's
   cover under the tiles gives the stems a closed wood carries. */
export function createFarSample({ templates, spacing = 8 }) {
  const samples = new Float32Array(FAR_FOREST.samples * 3);
  const tiles = [];
  let count = 0, tallest = 0, stemArea = null, read = 0, stems = 0, cover = 0;
  return {
    get count() { return count; },
    get tallest() { return tallest; },
    /* Square metres of closed wood a stem stands for, or null before there is a wood.
       Only a tile with a wood on it says how dense a wood is. */
    stemArea(forestAt) {
      for (; read < tiles.length; read++) {
        const { node, n } = tiles[read];
        let covered = 0;
        for (let z = node.z0 + spacing / 2; z < node.z0 + node.size; z += spacing) {
          for (let x = node.x0 + spacing / 2; x < node.x0 + node.size; x += spacing) covered += forestAt(x, z);
        }
        if (covered > 0.25 * (node.size / spacing) ** 2) {
          cover += covered * spacing * spacing;
          stems += n;
        }
        stemArea = stems >= FAR_FOREST.minimumSamples && cover > 0
          ? Math.min(FAR_FOREST.stemArea[1], Math.max(FAR_FOREST.stemArea[0], cover / stems)) : null;
      }
      return stemArea;
    },
    add(node, trees) {
      const n = trees ? trees.length / TREE_FLOATS : 0;
      if (!n) return;
      tiles.push({ node, n });
      /* Each tile's list is shuffled, so its first trees are a fair sample of it. */
      for (let k = 0; k < Math.min(n, FAR_FOREST.perTile) && count < FAR_FOREST.samples; k++) {
        const at = k * TREE_FLOATS, species = trees[at + 6];
        samples.set([trees[at + 4], trees[at + 5], species], count * 3);
        const template = templates[species] ?? templates[0];
        tallest = Math.max(tallest, trees[at + 5] * template.templateHeight);
        count++;
      }
    },
    pick: r => samples.subarray(Math.floor(r * count) * 3, Math.floor(r * count) * 3 + 3),
  };
}

/* One far cell's trees, packed as the 1 m tiles' are (map-trees.mjs plantTile):
   x, ground, z, yaw, crown scale, height scale, species, tone. Shuffled, so a cell
   drawn thin is the same wood with fewer trees. */
export function plantFarCell({ cell, core, covered, forestAt, heightAt, sample, templates, blocked = () => false }) {
  const stemArea = sample.stemArea(forestAt) ?? 25;
  const out = [];
  for (const spacing of new Set([farSpacing(0), farSpacing(Infinity)])) {
    const grow = Math.min(FAR_RING_BANDS.maximumClumpScale, Math.sqrt((spacing * spacing) / stemArea));
    for (let j = Math.ceil(cell.z0 / spacing); j * spacing < cell.z0 + cell.size; j++) {
      for (let i = Math.ceil(cell.x0 / spacing); i * spacing < cell.x0 + cell.size; i++) {
        /* A spot belongs to the cell its grid corner is in, so neighbours never share one. */
        const x = (i + hash2(i * 1.7 + 3, j * 2.3 + 7)) * spacing, z = (j + hash2(i * 3.1 + 11, j * 1.3 + 5)) * spacing;
        if (farSpacing(outsideCore(core, x, z)) !== spacing || covered(x, z)) continue;
        if (hash2(i * 5.3 + 1, j * 4.1 + 9) >= forestAt(x, z) || blocked(x, z)) continue;
        const y = heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        const [crown, height, species] = sample.pick(hash2(i * 2.9 + 13, j * 3.7 + 17));
        const template = templates[species] ?? templates[0];
        const tall = height * template.templateHeight;
        const scale = Math.max(1, Math.min(grow, sample.tallest / Math.max(tall, 0.1)));
        out.push(x, y, z, hash2(i * 7.7 + 19, j * 6.1 + 23) * Math.PI * 2, crown * scale, height * scale, species, hash2(x * 7, z * 3));
      }
    }
  }
  const trees = new Float32Array(out);
  const n = trees.length / TREE_FLOATS, swap = new Float32Array(TREE_FLOATS);
  for (let k = n - 1; k > 0; k--) {
    const other = Math.floor(hash2(k, cell.x0 + cell.z0 * 3) * (k + 1));
    swap.set(trees.subarray(k * TREE_FLOATS, (k + 1) * TREE_FLOATS));
    trees.copyWithin(k * TREE_FLOATS, other * TREE_FLOATS, (other + 1) * TREE_FLOATS);
    trees.set(swap, other * TREE_FLOATS);
  }
  return trees;
}

/* What a far tree may not stand on: the houses and the roads and railways the map
   draws out there. The forest picture is the land cover's, on 8 m cells, so a garden's
   trees reach over its house and a wood's over the road through it. A ground has
   thousands of each, so they are only sorted into cells here, and a cell's own grid is
   built when that cell is planted. */
export function createFarBlocker({ buildings = [], lines = [] }, { cellMetres = FAR_FOREST.cellMetres, bucket = 32 } = {}) {
  /* A crown's edge is a couple of metres from its stem. */
  const CLEAR = 2;
  const cells = new Map();
  const key = (i, j) => i * 65536 + j;
  const sort = item => {
    const [x0, z0, x1, z1] = item.reach;
    for (let j = Math.floor(z0 / cellMetres); j <= Math.floor(z1 / cellMetres); j++) {
      for (let i = Math.floor(x0 / cellMetres); i <= Math.floor(x1 / cellMetres); i++) {
        const k = key(i, j);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      }
    }
  };
  for (const corners of buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of corners) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const box = [x0 - CLEAR, z0 - CLEAR, x1 + CLEAR, z1 + CLEAR];
    sort({ box, reach: box });
  }
  for (const { line, width } of lines) {
    const half = (width ?? 4) / 2 + CLEAR;
    for (let k = 1; k < line.length; k++) {
      const [ax, az] = line[k - 1], [bx, bz] = line[k];
      sort({ segment: [ax, az, bx, bz], half, reach: [Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half] });
    }
  }
  const clear = () => false;
  return cell => {
    const items = cells.get(key(Math.floor(cell.x0 / cellMetres), Math.floor(cell.z0 / cellMetres)));
    if (!items) return clear;
    const grid = new Map();
    for (const item of items) {
      const [x0, z0, x1, z1] = item.reach;
      for (let j = Math.floor(Math.max(z0, cell.z0 - bucket) / bucket); j <= Math.floor(Math.min(z1, cell.z0 + cell.size + bucket) / bucket); j++) {
        for (let i = Math.floor(Math.max(x0, cell.x0 - bucket) / bucket); i <= Math.floor(Math.min(x1, cell.x0 + cell.size + bucket) / bucket); i++) {
          const k = key(i, j);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(item);
        }
      }
    }
    return (x, z) => {
      const near = grid.get(key(Math.floor(x / bucket), Math.floor(z / bucket)));
      if (!near) return false;
      for (const { box, segment, half } of near) {
        if (box) {
          if (x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]) return true;
          continue;
        }
        const [ax, az, bx, bz] = segment, dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(dx * dx + dz * dz, 1e-9)));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half) return true;
      }
      return false;
    };
  };
}

/* The forest picture as tools/bake-map-land.mjs writes it: a palette PNG of one or
   two bits a sample, no row filters, its levels in the transparency chunk. Read as
   it is packed, a megabyte, and inflated off the main thread; a picture written any
   other way is refused, and the map keeps its painted canopy past the 1 m tiles. */
export async function readForestPicture(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, k) => bytes[k] === byte)) throw new Error('not a PNG');
  let width = 0, height = 0, bits = 0, levels = null;
  const data = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      bits = body[8];
      if (body[9] !== 3 || (bits !== 1 && bits !== 2) || body[12] !== 0) throw new Error('not a 1- or 2-bit palette picture');
    } else if (type === 'tRNS') levels = Uint8Array.from(body);
    else if (type === 'IDAT') data.push(body);
    at += length + 12;
  }
  if (!width || !levels || !data.length) throw new Error('a picture without its size, levels or samples');
  const inflated = new Uint8Array(await new Response(new Blob(data).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = Math.ceil(width * bits / 8) + 1;
  if (inflated.length < stride * height) throw new Error('a picture cut short');
  for (let row = 0; row < height; row++) if (inflated[row * stride] !== 0) throw new Error('a filtered row');
  const mask = (1 << bits) - 1;
  return {
    width,
    height,
    /* 0 to 255 at one sample. */
    at(column, row) {
      const shift = 8 - bits - ((column * bits) & 7);
      return levels[(inflated[row * stride + 1 + ((column * bits) >> 3)] >> shift) & mask] ?? 0;
    },
  };
}

/* The picture's cover at a point in the map's world, from its nearest sample: 0 to 1. */
export function pictureSampler({ picture, x0, z0, spacing }) {
  return (x, z) => {
    const column = Math.round((x - x0) / spacing), row = Math.round((z - z0) / spacing);
    if (column < 0 || row < 0 || column >= picture.width || row >= picture.height) return 0;
    return picture.at(column, row) / 255;
  };
}
