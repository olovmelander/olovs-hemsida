import { describe, expect, it } from 'vitest';
import { detectFlatWater, rasterFromRingTiles } from './v2-flat-water.mjs';

function raster(width, height, spacing, fill) {
  const heights = new Float32Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) heights[row * width + column] = fill(column, row);
  return { width, height, spacing, x0: -width * spacing / 2, z0: -height * spacing / 2, heights };
}

describe('flat water from the ground', () => {
  /* a 400 x 400 m raster at 4 m: a sloping hillside, a 200 x 120 m lake at 50 m
     with 1 cm noise, and a tiny 20 x 20 m puddle that is too small to count */
  const lake = (c, r) => c >= 20 && c < 70 && r >= 30 && r < 60;
  const puddle = (c, r) => c >= 80 && c < 85 && r >= 80 && r < 85;
  const field = raster(100, 100, 4, (c, r) => (lake(c, r) ? 50 + ((c * 7 + r * 3) % 3) * 0.005 : puddle(c, r) ? 60 : 40 + c * 0.05 + r * 0.02));

  it('finds the lake, not the slope and not the puddle', () => {
    const water = detectFlatWater({ raster: field, minimumCells: 100 });
    expect(water.components.length).toBe(1);
    const [component] = water.components;
    /* the rim cells touch the slope and are not flat; the rest is the lake */
    expect(component.cells).toBeGreaterThanOrEqual(48 * 28);
    expect(component.level).toBeCloseTo(50, 1);
    expect(component.hectares).toBeCloseTo(2.4, 0);
    expect(water.isWaterAt(field.x0 + 45 * 4, field.z0 + 45 * 4)).toBe(true);
    expect(water.isWaterAt(field.x0 + 82 * 4, field.z0 + 82 * 4)).toBe(false);
    expect(water.isWaterAt(field.x0 + 10 * 4, field.z0 + 10 * 4)).toBe(false);
  });

  it('leaves the part of the lake a known ring already draws, and takes that ring\'s level', () => {
    /* a ring covering the western half of the lake, on the legacy datum */
    const ring = [[field.x0 + 20 * 4, field.z0 + 30 * 4], [field.x0 + 45 * 4, field.z0 + 30 * 4], [field.x0 + 45 * 4, field.z0 + 60 * 4], [field.x0 + 20 * 4, field.z0 + 60 * 4]];
    const water = detectFlatWater({ raster: field, minimumCells: 100, knownBodies: [{ ring, level: 50.4 }], ringMarginMetres: 0 });
    const [component] = water.components;
    expect(component.level).toBe(50.4);
    expect(component.knownCells).toBeGreaterThan(0);
    expect(water.isWaterAt(field.x0 + 30 * 4, field.z0 + 45 * 4)).toBe(false);
    expect(water.isWaterAt(field.x0 + 60 * 4, field.z0 + 45 * 4)).toBe(true);
    expect(water.isFlatAt(field.x0 + 30 * 4, field.z0 + 45 * 4)).toBe(true);
  });
});

describe('a level raster from ring tiles', () => {
  it('places every tile on the lattice and carries the datum', () => {
    const grid = { width: 3, height: 3, sampleSpacingMetres: 4, heightOffsetMetres: 30, heightScaleMetres: 0.04, noDataValue: 65535 };
    const payloadOf = q => { const p = new Uint8Array(18); for (let i = 0; i < 9; i++) { p[i * 2] = q & 0xff; p[i * 2 + 1] = q >> 8; } return p; };
    const tiles = [
      { bounds: { minEasting: 1000, maxEasting: 1008, minNorthing: 1992, maxNorthing: 2000 }, grid, payload: payloadOf(100) },
      { bounds: { minEasting: 1008, maxEasting: 1016, minNorthing: 1992, maxNorthing: 2000 }, grid, payload: payloadOf(200) },
    ];
    const out = rasterFromRingTiles(tiles, { legacyOrigin: { easting: 1000, northing: 2000 }, verticalDatumOffsetMetres: 10 });
    expect([out.width, out.height, out.spacing, out.x0, out.z0]).toEqual([5, 3, 4, 0, 0]);
    expect(out.heights[0]).toBeCloseTo(30 + 4 + 10, 6);
    expect(out.heights[4]).toBeCloseTo(30 + 8 + 10, 6);
  });
});
