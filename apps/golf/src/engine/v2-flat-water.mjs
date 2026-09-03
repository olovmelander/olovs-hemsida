import { inRingIndexed } from './ring-index.mjs';
/* Water the model does not know, read off the ground itself.
 *
 * The course pack's water rings come from an OpenStreetMap extract that is
 * clipped at its bounding box, so a lake that runs past the box ends in a
 * dead-straight edge, and lakes beyond it are not there at all. The 1 m
 * terrain knows better: laser does not penetrate water, so the Markhöjd-
 * modell over a lake is the lake's surface, flat to a few centimetres,
 * while land is never that flat for long. This finds those flats in a ring
 * raster, labels them, gives each its level, and hands the app a mask it
 * can tint by, keep trees off, and lay a sheet over where no ring does.    */

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function bbox(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
}

/**
 * @param raster  { width, height, spacing, x0, z0, heights } on the lattice
 *                (x east, z south, legacy-origin-centred grid space; heights
 *                on the legacy datum)
 * @param knownBodies  [{ ring (legacy world points), level }] the model draws already
 * @param toLegacy  grid (x, z) -> legacy world [x, z]
 * Returns the mask (1 = flat water no ring covers), the full flat mask, and
 * the labelled components with their levels and footprints.
 */
export function detectFlatWater({
  raster,
  knownBodies = [],
  toLegacy = (x, z) => [x, z],
  flatToleranceMetres = 0.03,
  minimumCells = 300,
  ringMarginMetres = 6,
} = {}) {
  const { width, height, spacing, x0, z0, heights } = raster;
  finite(spacing, 'raster.spacing'); finite(x0, 'raster.x0'); finite(z0, 'raster.z0');
  if (!heights || heights.length !== width * height) throw new RangeError('raster heights must match its dimensions');
  const flat = new Uint8Array(width * height);
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const i = row * width + column;
      const h = heights[i];
      if (!Number.isFinite(h)) continue;
      if (Math.abs(heights[i - 1] - h) > flatToleranceMetres || Math.abs(heights[i + 1] - h) > flatToleranceMetres ||
          Math.abs(heights[i - width] - h) > flatToleranceMetres || Math.abs(heights[i + width] - h) > flatToleranceMetres) continue;
      flat[i] = 1;
    }
  }
  /* label 4-connected flats, keep the ones large enough to be a lake and not a lawn */
  const label = new Int32Array(width * height);
  const components = [];
  const stack = new Int32Array(width * height);
  for (let seed = 0; seed < flat.length; seed++) {
    if (!flat[seed] || label[seed]) continue;
    const id = components.length + 1;
    let top = 0, cells = 0, sum = 0;
    let minColumn = width, maxColumn = 0, minRow = height, maxRow = 0;
    stack[top++] = seed; label[seed] = id;
    while (top) {
      const i = stack[--top];
      cells++; sum += heights[i];
      const column = i % width, row = (i - column) / width;
      if (column < minColumn) minColumn = column; if (column > maxColumn) maxColumn = column;
      if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= flat.length || !flat[j] || label[j]) continue;
        if ((j === i - 1 || j === i + 1) && Math.floor(j / width) !== row) continue;
        label[j] = id; stack[top++] = j;
      }
    }
    components.push({ id, cells, meanHeight: sum / cells, minColumn, maxColumn, minRow, maxRow });
  }
  const kept = new Map(components.filter(component => component.cells >= minimumCells).map(component => [component.id, component]));
  /* cells inside a body the model already draws are left to that body; the
     component takes the body's level so the two sheets meet without a step */
  const known = knownBodies.filter(body => body.ring?.length >= 3).map(body => ({ ...body, bb: bbox(body.ring) }));
  const mask = new Uint8Array(width * height);
  const covered = new Map();
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const i = row * width + column;
      const component = kept.get(label[i]);
      if (!component) continue;
      const [lx, lz] = toLegacy(x0 + (column + 0.5) * spacing, z0 + (row + 0.5) * spacing);
      let inside = null;
      for (const body of known) {
        if (lx < body.bb.x0 - ringMarginMetres || lx > body.bb.x1 + ringMarginMetres ||
            lz < body.bb.z0 - ringMarginMetres || lz > body.bb.z1 + ringMarginMetres) continue;
        if (inRingIndexed(lx, lz, body.ring)) { inside = body; break; }   /* the same crossings, through the ring index */
      }
      if (inside) {
        const entry = covered.get(component.id) || { body: inside, cells: 0 };
        entry.cells++;
        covered.set(component.id, entry);
        continue;
      }
      mask[i] = 1;
    }
  }
  const result = [...kept.values()].map(component => {
    const overlap = covered.get(component.id);
    return Object.freeze({
      id: component.id,
      cells: component.cells,
      hectares: +(component.cells * spacing * spacing / 10000).toFixed(2),
      /* the flat surface IS the water; a known body's measured level wins where they overlap */
      level: overlap ? overlap.body.level : component.meanHeight,
      surfaceHeight: component.meanHeight,
      knownCells: overlap?.cells ?? 0,
      uncoveredCells: component.cells - (overlap?.cells ?? 0),
      bounds: Object.freeze({
        x0: x0 + component.minColumn * spacing, x1: x0 + (component.maxColumn + 1) * spacing,
        z0: z0 + component.minRow * spacing, z1: z0 + (component.maxRow + 1) * spacing,
      }),
    });
  });
  return Object.freeze({
    width, height, spacing, x0, z0,
    mask,
    label,
    components: Object.freeze(result),
    isWaterAt(gridX, gridZ) {
      const column = Math.floor((gridX - x0) / spacing), row = Math.floor((gridZ - z0) / spacing);
      if (column < 0 || row < 0 || column >= width || row >= height) return false;
      return mask[row * width + column] === 1;
    },
    isFlatAt(gridX, gridZ) {
      const column = Math.floor((gridX - x0) / spacing), row = Math.floor((gridZ - z0) / spacing);
      if (column < 0 || row < 0 || column >= width || row >= height) return false;
      return kept.has(label[row * width + column]);
    },
  });
}

/** Assemble one level of ring tiles (decoded payloads) into a raster in grid space. */
export function rasterFromRingTiles(tiles, { legacyOrigin, verticalDatumOffsetMetres }) {
  if (!tiles?.length) throw new TypeError('ring tiles are required');
  const spacing = tiles[0].grid.sampleSpacingMetres;
  const size = tiles[0].grid.width;
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const tile of tiles) {
    minE = Math.min(minE, tile.bounds.minEasting); maxE = Math.max(maxE, tile.bounds.maxEasting);
    minN = Math.min(minN, tile.bounds.minNorthing); maxN = Math.max(maxN, tile.bounds.maxNorthing);
  }
  const span = tiles[0].bounds.maxEasting - tiles[0].bounds.minEasting;
  const tilesX = Math.round((maxE - minE) / span), tilesZ = Math.round((maxN - minN) / span);
  const width = tilesX * (size - 1) + 1, height = tilesZ * (size - 1) + 1;
  const heights = new Float32Array(width * height).fill(Number.NaN);
  for (const tile of tiles) {
    const column0 = Math.round((tile.bounds.minEasting - minE) / span) * (size - 1);
    const row0 = Math.round((maxN - tile.bounds.maxNorthing) / span) * (size - 1);
    const { grid, payload } = tile;
    const noData = grid.noDataValue ?? 65535;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const o = (r * size + c) * 2;
      const q = payload[o] | payload[o + 1] << 8;
      heights[(row0 + r) * width + column0 + c] = q === noData ? Number.NaN : grid.heightOffsetMetres + q * grid.heightScaleMetres + verticalDatumOffsetMetres;
    }
  }
  return Object.freeze({
    width, height, spacing,
    x0: minE - legacyOrigin.easting,
    z0: legacyOrigin.northing - maxN,
    heights,
  });
}
