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

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
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
  const levelByComponent = new Map(components.map(component => [component.id, component.level]));
  const level = new Float32Array(width * height).fill(Number.NaN);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const componentLevel = levelByComponent.get(label[i]);
    if (componentLevel === undefined) continue;
    mask[i] = 1;
    level[i] = componentLevel;
  }
  const known = knownBodies
    .filter(body => body.ring?.length >= 3 && Number.isFinite(body.level))
    .map(body => ({ ring: body.ring, level: body.level, bb: bbox(body.ring) }));
  if (known.length) {
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const [lx, lz] = toLegacy(x0 + (column + 0.5) * spacing, z0 + (row + 0.5) * spacing);
        for (const body of known) {
          if (lx < body.bb.x0 || lx > body.bb.x1 || lz < body.bb.z0 || lz > body.bb.z1) continue;
          if (!inRing(lx, lz, body.ring)) continue;
          const i = row * width + column;
          mask[i] = 1;
          level[i] = body.level;   // a measured body's level wins over a flat's mean
          break;
        }
      }
    }
  }
  const squared = squaredDistanceTransform(width, height, index => mask[index] === 0);
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
  const cellOf = (gridX, gridZ) => {
    const column = Math.floor((gridX - x0) / spacing), row = Math.floor((gridZ - z0) / spacing);
    if (column < 0 || row < 0 || column >= width || row >= height) return -1;
    return row * width + column;
  };
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
    inWater(gridX, gridZ) {
      const i = cellOf(gridX, gridZ);
      return i >= 0 && mask[i] === 1;
    },
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
  let carved = 0;
  for (let row = 0; row < height; row++) {
    const gz = tileZ0 + row * spacing;
    for (let column = 0; column < width; column++) {
      const gx = tileX0 + column * spacing;
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
