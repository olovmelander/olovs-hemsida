/* From a published tile's bytes to what the renderer reads. Pure.

   The relief on screen comes from here more than from the mesh. The mesh is
   only as fine as the phone can afford, but every 1 m sample reaches the
   screen through two per-pixel channels baked once per tile: the slope, which
   lights the ground, and the local relief, which darkens hollows and lifts
   crests. Baking keeps it to one texture read a pixel. */
import { TILE_SAMPLES } from './map-lod.mjs';

/* A fairway's undulation is a slope of 0.01-0.05 and a bunker face passes 1.
   Eight bits spread linearly over that would band every fairway, so slopes
   are stored by their square root: finest near level, where the eye needs it. */
export const SLOPE_LIMIT = 3;
const RELIEF_NEAR_RADIUS = 3, RELIEF_FAR_RADIUS = 14;
const RELIEF_NEAR_RANGE = 0.5, RELIEF_FAR_RANGE = 3;

export function decodeTileHeights(payload, grid, datum = 0) {
  const { width, height, heightOffsetMetres, heightScaleMetres, noDataValue } = grid;
  if (grid.rowOrder !== 'north-to-south' || grid.columnOrder !== 'west-to-east') {
    throw new Error(`terrain tile has an unsupported sample order ${grid.rowOrder}/${grid.columnOrder}`);
  }
  const count = width * height;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const heights = new Float32Array(count);
  let min = Infinity, max = -Infinity, missing = 0;
  for (let i = 0; i < count; i++) {
    const raw = view.getUint16(i * 2, true);
    if (raw === noDataValue) { heights[i] = NaN; missing++; continue; }
    const value = heightOffsetMetres + raw * heightScaleMetres - datum;
    heights[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  /* A hole in a tile must not reach the shader as NaN, which blanks the patch.
     The tile's lowest ground is a floor nobody reads a distance from. */
  if (missing) for (let i = 0; i < count; i++) if (Number.isNaN(heights[i])) heights[i] = min;
  return { heights, width, height, min, max };
}

const encodeSlope = slope => {
  const e = Math.sign(slope) * Math.sqrt(Math.min(Math.abs(slope) / SLOPE_LIMIT, 1));
  return Math.round((e * 0.5 + 0.5) * 255);
};
export const decodeSlope = byte => {
  const e = byte / 255 * 2 - 1;
  return Math.sign(e) * e * e * SLOPE_LIMIT;
};

function summedArea(heights, width, height) {
  const area = new Float64Array((width + 1) * (height + 1));
  for (let j = 0; j < height; j++) {
    let row = 0;
    for (let i = 0; i < width; i++) {
      row += heights[j * width + i];
      area[(j + 1) * (width + 1) + i + 1] = area[j * (width + 1) + i + 1] + row;
    }
  }
  return area;
}

/* R, G: dh/dx and dh/dz. B, A: how far a point stands below (bright) or above
   (dark) the ground about it, near and broad. The window closes symmetrically
   toward the tile's edge rather than being cut off there: a one-sided window
   reads any plain slope as relief, which drew every tile's outline on a hill. */
export function bakeTileRelief(heights, width, height, spacing) {
  const out = new Uint8Array(width * height * 4);
  const area = summedArea(heights, width, height);
  const stride = width + 1;
  const mean = (i, j, r) => {
    const x0 = i - r, x1 = i + r + 1, y0 = j - r, y1 = j + r + 1;
    const sum = area[y1 * stride + x1] - area[y0 * stride + x1] - area[y1 * stride + x0] + area[y0 * stride + x0];
    return sum / ((2 * r + 1) * (2 * r + 1));
  };
  const relief = (value, range) => Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, value / range)));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i;
    const west = heights[j * width + Math.max(i - 1, 0)], east = heights[j * width + Math.min(i + 1, width - 1)];
    const north = heights[Math.max(j - 1, 0) * width + i], south = heights[Math.min(j + 1, height - 1) * width + i];
    const runX = (Math.min(i + 1, width - 1) - Math.max(i - 1, 0)) * spacing;
    const runZ = (Math.min(j + 1, height - 1) - Math.max(j - 1, 0)) * spacing;
    const edge = Math.min(i, j, width - 1 - i, height - 1 - j);
    const p = k * 4;
    out[p] = encodeSlope((east - west) / runX);
    out[p + 1] = encodeSlope((south - north) / runZ);
    out[p + 2] = relief(mean(i, j, Math.min(RELIEF_NEAR_RADIUS, edge)) - heights[k], RELIEF_NEAR_RANGE);
    out[p + 3] = relief(mean(i, j, Math.min(RELIEF_FAR_RADIUS, edge)) - heights[k], RELIEF_FAR_RANGE);
  }
  return out;
}

export function sampleTile(heights, u, v, samples = TILE_SAMPLES) {
  const last = samples - 1;
  const x = Math.max(0, Math.min(last, u * last)), z = Math.max(0, Math.min(last, v * last));
  const i = Math.min(Math.floor(x), last - 1), j = Math.min(Math.floor(z), last - 1);
  const fx = x - i, fz = z - j;
  const a = heights[j * samples + i], b = heights[j * samples + i + 1];
  const c = heights[(j + 1) * samples + i], d = heights[(j + 1) * samples + i + 1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
