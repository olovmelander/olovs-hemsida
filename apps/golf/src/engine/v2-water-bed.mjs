/**
 * Lake beds under the laser's water.
 *
 * Airborne laser does not penetrate water, so the published ground inside a
 * lake IS the lake's surface, flat to a few centimetres. Drawn as it is, the
 * water sheet lies a hand's depth over the bed everywhere: the shader reads
 * silt through the whole lake and the two surfaces fight at any distance.
 * This module carves a plausible bed at boot, from the water the model and
 * the ground already know -- the model's rings and the flat water the 4 m
 * ring shows -- so that depth rises with distance from the shore, the way a
 * lake's does, up to a stated maximum. It is a rendering choice and the
 * published tiles are untouched: the same field carves the CPU sampler and
 * every tile the GPU decodes, so what is measured is what is drawn.
 */
import { squaredDistanceTransform } from '../../../../packages/course-v2/distance-transform.mjs';
import { inRingIndexed } from './ring-index.mjs';

const UINT16_NO_DATA_DEFAULT = 65535;

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
}

function bbox(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

/**
 * Build the bed field on the flat-water raster's own grid (grid space,
 * cells of `spacing` metres). A cell is water when it belongs to a kept flat
 * or lies inside a known body's ring; its level is the known body's where
 * one covers it and the flat's own otherwise. Depth is a function of the
 * distance to the nearest non-water cell.
 */
export function buildWaterBedField({
  flatWater,
  knownBodies = [],
  toLegacy = (x, z) => [x, z],
  toGrid = null,
  shoreDepthMetres = 0.15,
  depthPerMetre = 0.12,
  maximumDepthMetres = 3.5,
} = {}) {
  if (!flatWater?.label || !flatWater.components) throw new TypeError('a flat-water result is required');
  const { width, height, spacing, x0, z0, label, components } = flatWater;
  finite(spacing, 'spacing'); finite(x0, 'x0'); finite(z0, 'z0');
  if (!(shoreDepthMetres >= 0) || !(depthPerMetre > 0) || !(maximumDepthMetres > shoreDepthMetres)) {
    throw new RangeError('the depth profile must rise from a non-negative shore depth to a larger maximum');
  }
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const timings = {};
  let phaseStarted = clock();
  const phase = name => { timings[name] = Math.round(clock() - phaseStarted); phaseStarted = clock(); };
  const levelByComponent = new Map(components.map(component => [component.id, component.level]));
  const level = new Float32Array(width * height).fill(Number.NaN);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const componentLevel = levelByComponent.get(label[i]);
    if (componentLevel === undefined) continue;
    mask[i] = 1;
    level[i] = componentLevel;
  }
  phase('mask');
  const known = knownBodies
    .filter(body => body.ring?.length >= 3 && Number.isFinite(body.level))
    .map(body => ({ ring: body.ring, level: body.level, bb: bbox(body.ring) }));
  /* A cell takes the first body, in order, whose ring holds its centre. */
  const claim = (row, column) => {
    const [lx, lz] = toLegacy(x0 + (column + 0.5) * spacing, z0 + (row + 0.5) * spacing);
    for (const body of known) {
      if (lx < body.bb.x0 || lx > body.bb.x1 || lz < body.bb.z0 || lz > body.bb.z1) continue;
      /* the banded crossing test: the same answer as inRing, without walking
         a 118-vertex lake ring for each of 700,000 cells in the lakes' boxes */
      if (!inRingIndexed(lx, lz, body.ring)) continue;
      const i = row * width + column;
      mask[i] = 1;
      level[i] = body.level;   // a measured body's level wins over a flat's mean
      return;
    }
  };
  if (known.length && typeof toGrid === 'function') {
    /* The bridge is linear (a rotation and two scales), so a body's legacy
       box maps to a parallelogram whose corners bound it in grid space:
       a cell centre outside every body's grid box fails every legacy box
       test above and needs no visit. Walking the whole 2049 x 2049 raster
       through the bridge for thirteen lakes cost 3.5 s of Puttom's boot;
       the lakes' boxes are a few thousand cells. Each cell is still claimed
       once, by the same rule, so the field is the same. */
    const visited = new Uint8Array(width * height);
    timings.mode = 'boxed'; timings.bodies = known.length; timings.boxedCells = 0;
    for (const body of known) {
      let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
      for (const [lx, lz] of [[body.bb.x0, body.bb.z0], [body.bb.x1, body.bb.z0], [body.bb.x0, body.bb.z1], [body.bb.x1, body.bb.z1]]) {
        const [gx, gz] = toGrid(lx, lz);
        const column = (gx - x0) / spacing - 0.5, row = (gz - z0) / spacing - 0.5;
        if (column < c0) c0 = column; if (column > c1) c1 = column;
        if (row < r0) r0 = row; if (row > r1) r1 = row;
      }
      const columnStart = Math.max(0, Math.floor(c0)), columnEnd = Math.min(width - 1, Math.ceil(c1));
      const rowStart = Math.max(0, Math.floor(r0)), rowEnd = Math.min(height - 1, Math.ceil(r1));
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let column = columnStart; column <= columnEnd; column++) {
          const i = row * width + column;
          if (visited[i]) continue;
          visited[i] = 1;
          timings.boxedCells++;
          claim(row, column);
        }
      }
    }
  } else if (known.length) {
    timings.mode = 'whole';
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) claim(row, column);
  }
  phase('knownBodies');
  const squared = squaredDistanceTransform(width, height, index => mask[index] === 0);
  phase('distanceTransform');
  const depth = new Float32Array(width * height);
  let cells = 0;
  for (let i = 0; i < depth.length; i++) {
    if (!mask[i]) continue;
    cells++;
    /* the boundary lies on the edge between the last water cell and the
       first land cell, half a cell from either centre */
    const metres = Math.max(0, (Math.sqrt(squared[i]) - 0.5) * spacing);
    depth[i] = Math.min(maximumDepthMetres, shoreDepthMetres + depthPerMetre * metres);
  }
  phase('depth');
  const cellOf = (gridX, gridZ) => {
    const column = Math.floor((gridX - x0) / spacing), row = Math.floor((gridZ - z0) / spacing);
    if (column < 0 || row < 0 || column >= width || row >= height) return -1;
    return row * width + column;
  };
  /* Every cell within one cell of water. The bilinear depth below reads the
     four cell centres around a sample, all inside the 3 x 3 block around
     the sample's own cell, so a sample whose block holds no water has depth
     zero and a carve can reject it with one read instead of the bilinear.
     Seven million samples in the rings were paying the bilinear to learn
     that they stood on dry land. Outside the grid the test stays true: the
     bilinear still reaches half a cell past the edge. */
  const near = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const row = (i / width) | 0, column = i - row * width;
    const r0 = Math.max(0, row - 1), r1 = Math.min(height - 1, row + 1);
    const c0 = Math.max(0, column - 1), c1 = Math.min(width - 1, column + 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) near[r * width + c] = 1;
  }
  const nearWater = (gridX, gridZ) => {
    const i = cellOf(gridX, gridZ);
    return i < 0 || near[i] === 1;
  };
  phase('nearMask');
  const depthAt = (gridX, gridZ) => {
    /* bilinear over cell centres; land cells hold zero, so the bed rises to
       the shore over one cell instead of stepping */
    const fx = (gridX - x0) / spacing - 0.5, fz = (gridZ - z0) / spacing - 0.5;
    const west = Math.floor(fx), north = Math.floor(fz);
    if (west < -1 || north < -1 || west >= width || north >= height) return 0;
    const tx = fx - west, tz = fz - north;
    const at = (column, row) => (column < 0 || row < 0 || column >= width || row >= height) ? 0 : depth[row * width + column];
    const top = at(west, north) * (1 - tx) + at(west + 1, north) * tx;
    const bottom = at(west, north + 1) * (1 - tx) + at(west + 1, north + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  };
  const levelAt = (gridX, gridZ) => {
    const i = cellOf(gridX, gridZ);
    if (i >= 0 && mask[i]) return level[i];
    /* between the last water cell and the bank the bilinear depth is still
       positive; take the level of the nearest water neighbour */
    const column = Math.round((gridX - x0) / spacing - 0.5), row = Math.round((gridZ - z0) / spacing - 0.5);
    let best = Number.NaN;
    for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const c = column + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const j = r * width + c;
      if (mask[j]) { best = level[j]; break; }
    }
    return best;
  };
  return Object.freeze({
    width, height, spacing, x0, z0,
    mask, level, depth,
    cells,
    hectares: +(cells * spacing * spacing / 10000).toFixed(1),
    shoreDepthMetres, depthPerMetre, maximumDepthMetres,
    timings: Object.freeze(timings),
    inWater(gridX, gridZ) {
      const i = cellOf(gridX, gridZ);
      return i >= 0 && mask[i] === 1;
    },
    nearWater,
    depthAt,
    levelAt,
  });
}

/**
 * Carve one decoded terrain tile in place: every sample standing at or
 * near the water's level inside the field is lowered to level minus depth.
 * Samples well above the level -- banks and islands a loose ring encloses --
 * are left alone. Returns the number of samples changed.
 */
export function carveTerrainTile(tile, field, { legacyOrigin, verticalDatumOffsetMetres, surfaceToleranceMetres = 0.5 } = {}) {
  const { bounds, grid, payload } = tile;
  finite(legacyOrigin?.easting, 'legacyOrigin.easting');
  finite(legacyOrigin?.northing, 'legacyOrigin.northing');
  finite(verticalDatumOffsetMetres, 'verticalDatumOffsetMetres');
  if (!(payload instanceof Uint8Array) || payload.byteLength !== grid.width * grid.height * 2) {
    throw new TypeError('tile payload must be a Uint8Array of width * height samples');
  }
  const { width, height, sampleSpacingMetres: spacing, heightOffsetMetres, heightScaleMetres } = grid;
  const noData = grid.noDataValue ?? UINT16_NO_DATA_DEFAULT;
  /* a tile entirely outside the field is not worth walking */
  const tileX0 = bounds.minEasting - legacyOrigin.easting, tileX1 = bounds.maxEasting - legacyOrigin.easting;
  const tileZ0 = legacyOrigin.northing - bounds.maxNorthing, tileZ1 = legacyOrigin.northing - bounds.minNorthing;
  const fieldX1 = field.x0 + field.width * field.spacing, fieldZ1 = field.z0 + field.height * field.spacing;
  if (tileX1 < field.x0 || tileX0 > fieldX1 || tileZ1 < field.z0 || tileZ0 > fieldZ1) return 0;
  /* the bilinear depth is zero more than half a field cell past the field's
     edge, so a coarse tile that reaches beyond it walks only the rows and
     columns the field can touch */
  const rowStart = Math.max(0, Math.floor((field.z0 - field.spacing - tileZ0) / spacing));
  const rowEnd = Math.min(height - 1, Math.ceil((fieldZ1 + field.spacing - tileZ0) / spacing));
  const columnStart = Math.max(0, Math.floor((field.x0 - field.spacing - tileX0) / spacing));
  const columnEnd = Math.min(width - 1, Math.ceil((fieldX1 + field.spacing - tileX0) / spacing));
  const nearWater = typeof field.nearWater === 'function' ? field.nearWater : () => true;
  let carved = 0;
  for (let row = rowStart; row <= rowEnd; row++) {
    const gz = tileZ0 + row * spacing;
    for (let column = columnStart; column <= columnEnd; column++) {
      const gx = tileX0 + column * spacing;
      if (!nearWater(gx, gz)) continue;
      const depth = field.depthAt(gx, gz);
      if (!(depth > 0)) continue;
      const level = field.levelAt(gx, gz);
      if (!Number.isFinite(level)) continue;
      const offset = (row * width + column) * 2;
      const q = payload[offset] | payload[offset + 1] << 8;
      if (q === noData) continue;
      const legacyHeight = heightOffsetMetres + q * heightScaleMetres + verticalDatumOffsetMetres;
      if (legacyHeight > level + surfaceToleranceMetres) continue;
      const target = Math.max(0, Math.round((level - depth - verticalDatumOffsetMetres - heightOffsetMetres) / heightScaleMetres));
      if (target >= q) continue;
      payload[offset] = target & 0xff;
      payload[offset + 1] = target >> 8 & 0xff;
      carved++;
    }
  }
  return carved;
}

/**
 * The bed field for a FIXED FRONTIER: a ground served as one level-zero
 * window of decoded tiles, with no 4 m ring to find flat water in. The
 * model's own rings are the only water it knows, so the field is built on
 * an empty flat-water raster over the frontier's box -- padded so a lake
 * that runs out of the window keeps deepening to its maximum instead of
 * shoaling to the shore depth along the window's edge -- and every cell a
 * ring encloses is water at that ring's level. `shallows` are rings (the
 * traced silt margins) whose water is capped at `shallowDepthMetres`, the
 * same rule the legacy terrain builder applies.
 */
export function buildFrontierWaterBedField({
  bounds,
  knownBodies = [],
  toLegacy = (x, z) => [x, z],
  toGrid = (x, z) => [x, z],
  spacing = 2,
  paddingMetres = 64,
  shallows = [],
  shallowDepthMetres = 0.28,
  shoreDepthMetres = 0.15,
  depthPerMetre = 0.1,
  maximumDepthMetres = 5.5,
} = {}) {
  for (const key of ['x0', 'x1', 'z0', 'z1']) finite(bounds?.[key], `bounds.${key}`);
  if (!(spacing > 0) || !(paddingMetres >= 0)) throw new RangeError('spacing must be positive and padding non-negative');
  const x0 = bounds.x0 - paddingMetres, z0 = bounds.z0 - paddingMetres;
  const width = Math.ceil((bounds.x1 - bounds.x0 + 2 * paddingMetres) / spacing);
  const height = Math.ceil((bounds.z1 - bounds.z0 + 2 * paddingMetres) / spacing);
  const empty = Object.freeze({
    width, height, spacing, x0, z0,
    label: new Int32Array(width * height),
    components: Object.freeze([]),
  });
  const field = buildWaterBedField({
    flatWater: empty, knownBodies, toLegacy, toGrid,
    shoreDepthMetres, depthPerMetre, maximumDepthMetres,
  });
  /* the silt shallows: a bed a few decimetres down, whatever the shore distance says */
  const rings = shallows.filter(ring => ring?.length >= 3).map(ring => ({ ring, bb: bbox(ring) }));
  let capped = 0;
  if (rings.length) {
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const i = row * width + column;
      if (!field.mask[i] || field.depth[i] <= shallowDepthMetres) continue;
      const [lx, lz] = toLegacy(x0 + (column + 0.5) * spacing, z0 + (row + 0.5) * spacing);
      for (const { ring, bb } of rings) {
        if (lx < bb.x0 || lx > bb.x1 || lz < bb.z0 || lz > bb.z1) continue;
        if (!inRingIndexed(lx, lz, ring)) continue;
        field.depth[i] = shallowDepthMetres;
        capped++;
        break;
      }
    }
  }
  return Object.freeze({ ...field, shallowCells: capped, kind: 'frontier' });
}

/**
 * Carve one decoded frontier tile, re-basing its quantisation if the bed has
 * to go below the tile's floor. A frontier tile is encoded with its own
 * minimum as `heightOffsetMetres`, and over a lake that minimum IS the
 * water surface: a carve clamped at q = 0 lands a hand's depth under the
 * sheet, which is the defect it exists to remove. So the tile's offset is
 * lowered to hold the deepest bed the field asks of it (with a margin), every
 * finite sample shifted by the same count, and the carve applied against the
 * new offset. Returns the same object untouched when nothing is carved,
 * otherwise a new decoded record whose header grid carries the new offset.
 * The rebased quantisation is checked against the uint16 range and the
 * nodata value before anything is written.
 */
export function carveDecodedTerrainTile(decoded, field, { legacyOrigin, verticalDatumOffsetMetres, floorMarginMetres = 0.5 } = {}) {
  const header = decoded?.header;
  if (!header?.grid || !header.bounds) throw new TypeError('a decoded terrain tile with header.grid and header.bounds is required');
  const grid = header.grid;
  const payload = decoded.payload instanceof Uint8Array ? decoded.payload : new Uint8Array(decoded.payload);
  const noData = grid.noDataValue ?? UINT16_NO_DATA_DEFAULT;
  /* the deepest bed this tile is asked for, and whether it is below the floor */
  const tileX0 = header.bounds.minEasting - legacyOrigin.easting, tileZ0 = legacyOrigin.northing - header.bounds.maxNorthing;
  const { width, height, sampleSpacingMetres: spacing } = grid;
  let deepest = Infinity;
  for (let row = 0; row < height; row++) {
    const gz = tileZ0 + row * spacing;
    for (let column = 0; column < width; column++) {
      const gx = tileX0 + column * spacing;
      if (!field.nearWater(gx, gz)) continue;
      const depth = field.depthAt(gx, gz);
      if (!(depth > 0)) continue;
      const level = field.levelAt(gx, gz);
      if (!Number.isFinite(level)) continue;
      const q = payload[(row * width + column) * 2] | payload[(row * width + column) * 2 + 1] << 8;
      if (q === noData) continue;
      const legacyHeight = grid.heightOffsetMetres + q * grid.heightScaleMetres + verticalDatumOffsetMetres;
      if (legacyHeight > level + 0.5) continue;
      deepest = Math.min(deepest, level - depth - verticalDatumOffsetMetres);
    }
  }
  if (!Number.isFinite(deepest)) return decoded;
  let offset = grid.heightOffsetMetres;
  let work = payload;
  if (deepest - floorMarginMetres < offset) {
    const scale = grid.heightScaleMetres;
    const nextOffset = Math.floor((deepest - floorMarginMetres) / scale) * scale;
    const shift = Math.round((offset - nextOffset) / scale);
    work = new Uint8Array(payload);   /* the verified bytes stay as they were decoded */
    for (let i = 0; i < work.length; i += 2) {
      const q = work[i] | work[i + 1] << 8;
      if (q === noData) continue;
      const next = q + shift;
      if (next >= noData || next > 65535) throw new RangeError('re-basing the tile for its lake bed exceeds the uint16 quantisation range');
      work[i] = next & 0xff; work[i + 1] = next >> 8 & 0xff;
    }
    offset = nextOffset;
  } else if (work === decoded.payload) {
    work = new Uint8Array(payload);
  }
  const carvedGrid = { ...grid, heightOffsetMetres: offset };
  const carved = carveTerrainTile({ bounds: header.bounds, grid: carvedGrid, payload: work }, field, { legacyOrigin, verticalDatumOffsetMetres });
  if (!carved) return decoded;
  return {
    ...decoded,
    header: { ...header, grid: carvedGrid },
    payload: work,
    terrainRenderData: null,
    waterBed: { carvedSamples: carved, rebasedOffsetMetres: offset !== grid.heightOffsetMetres ? offset : null },
  };
}
