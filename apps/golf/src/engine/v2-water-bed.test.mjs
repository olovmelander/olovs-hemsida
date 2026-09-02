import { describe, expect, it } from 'vitest';
import { detectFlatWater } from './v2-flat-water.mjs';
import { buildWaterBedField, carveTerrainTile } from './v2-water-bed.mjs';

/* a 4 m raster: land at 52 m sloping gently, one flat lake at 50 m */
function lakeRaster({ width = 48, height = 48, spacing = 4, lake = { c0: 12, c1: 36, r0: 12, r1: 36 }, level = 50 } = {}) {
  const heights = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const i = row * width + column;
      const inLake = column >= lake.c0 && column < lake.c1 && row >= lake.r0 && row < lake.r1;
      heights[i] = inLake ? level : 52 + column * 0.05 + row * 0.02;
    }
  }
  return { width, height, spacing, x0: -96, z0: -96, heights };
}

describe('the lake bed field', () => {
  it('is zero on land and deepens with distance from the shore to a stated maximum', () => {
    const raster = lakeRaster();
    const flat = detectFlatWater({ raster, minimumCells: 100 });
    expect(flat.components.length).toBe(1);
    const field = buildWaterBedField({ flatWater: flat });
    /* the detector's flatness test needs all four neighbours level, so the
       lake's outermost cell ring, which touches the bank, is not flat: the
       field starts one cell in from the true shore and the bilinear depth
       reaches zero on it */
    expect(field.cells).toBe(22 * 22);
    expect(field.inWater(-96 + 2 * 4, -96 + 2 * 4)).toBe(false);
    expect(field.depthAt(-96 + 2 * 4 + 2, -96 + 2 * 4 + 2)).toBe(0);
    /* centre of the lake: 12 cells = 48 m from the nearest bank */
    const centreX = -96 + 24 * 4, centreZ = -96 + 24 * 4;
    expect(field.inWater(centreX, centreZ)).toBe(true);
    expect(field.depthAt(centreX, centreZ)).toBeCloseTo(3.5, 5);
    expect(field.levelAt(centreX, centreZ)).toBeCloseTo(50, 5);
    /* first water cell in from the bank: half a cell = 2 m from the edge */
    const edgeX = -96 + 13.5 * 4, edgeZ = centreZ;
    expect(field.depthAt(edgeX, edgeZ)).toBeCloseTo(0.15 + 0.12 * 2, 3);
    /* and on the rim cell itself the bilinear bed has risen to the shore */
    expect(field.depthAt(-96 + 12.5 * 4, edgeZ)).toBe(0);
    /* monotone inward */
    let previous = -1;
    for (let column = 12; column <= 24; column++) {
      const depth = field.depthAt(-96 + (column + 0.5) * 4, centreZ);
      expect(depth).toBeGreaterThanOrEqual(previous);
      previous = depth;
    }
  });

  it('takes a known body\'s ring and level where the model has one', () => {
    const raster = lakeRaster();
    const ring = [[-40, -40], [-40, 40], [40, 40], [40, -40]];   // a pond the DTM shows as land
    const flat = detectFlatWater({ raster, minimumCells: 100 });
    const field = buildWaterBedField({ flatWater: flat, knownBodies: [{ ring, level: 47 }] });
    expect(field.inWater(0, 0)).toBe(true);
    expect(field.levelAt(0, 0)).toBe(47);
    expect(field.depthAt(0, 0)).toBeGreaterThan(1);
  });
});

describe('carving a tile', () => {
  function tile({ heightLegacy, width = 33, spacing = 4, datum = 20 }) {
    const grid = { width, height: width, sampleSpacingMetres: spacing, heightOffsetMetres: 0, heightScaleMetres: 0.01, noDataValue: 65535 };
    const payload = new Uint8Array(width * width * 2);
    for (let row = 0; row < width; row++) {
      for (let column = 0; column < width; column++) {
        const q = Math.round((heightLegacy(column, row) - datum) / grid.heightScaleMetres);
        const offset = (row * width + column) * 2;
        payload[offset] = q & 0xff; payload[offset + 1] = q >> 8 & 0xff;
      }
    }
    const legacyOrigin = { easting: 1000, northing: 5000 };
    /* the tile covers grid x -64..64, z -64..64 */
    const bounds = { minEasting: 1000 - 64, maxEasting: 1000 + 64, minNorthing: 5000 - 64, maxNorthing: 5000 + 64 };
    return { tile: { id: 't', bounds, grid, payload }, legacyOrigin, datum,
      heightAt: (column, row) => { const o = (row * width + column) * 2; return (payload[o] | payload[o + 1] << 8) * grid.heightScaleMetres + datum; } };
  }

  it('lowers samples on the water surface to level minus depth and leaves banks and islands alone', () => {
    const raster = lakeRaster();
    const flat = detectFlatWater({ raster, minimumCells: 100 });
    const field = buildWaterBedField({ flatWater: flat });
    /* the lake in grid space is x -48..48, z -48..48; the surface stands at 50, the bank at 52+, and an island at 53 in the middle */
    const t = tile({ heightLegacy: (column, row) => {
      const gx = -64 + column * 4, gz = -64 + row * 4;
      const inLake = gx >= -48 && gx < 48 && gz >= -48 && gz < 48;
      if (inLake && Math.abs(gx) <= 4 && Math.abs(gz) <= 4) return 53;
      return inLake ? 50 : 52.5;
    } });
    const carved = carveTerrainTile(t.tile, field, { legacyOrigin: t.legacyOrigin, verticalDatumOffsetMetres: t.datum });
    expect(carved).toBeGreaterThan(400);
    /* deep in the lake (gx = -32, gz = 0 -> column 8, row 16): 16 m from the... nearest bank is 16 m west */
    const column = 8, row = 16;
    const gx = -64 + column * 4, gz = -64 + row * 4;
    expect(t.heightAt(column, row)).toBeCloseTo(50 - field.depthAt(gx, gz), 2);
    expect(t.heightAt(column, row)).toBeLessThan(49);
    /* the bank (column 0) is untouched */
    expect(t.heightAt(0, 16)).toBeCloseTo(52.5, 5);
    /* the island stands */
    expect(t.heightAt(16, 16)).toBeCloseTo(53, 5);
    /* carving twice changes nothing more */
    expect(carveTerrainTile(t.tile, field, { legacyOrigin: t.legacyOrigin, verticalDatumOffsetMetres: t.datum })).toBe(0);
  });

  it('skips a tile that does not touch the field', () => {
    const raster = lakeRaster();
    const field = buildWaterBedField({ flatWater: detectFlatWater({ raster, minimumCells: 100 }) });
    const t = tile({ heightLegacy: () => 50 });
    t.tile.bounds = { minEasting: 9000, maxEasting: 9128, minNorthing: 9000, maxNorthing: 9128 };
    expect(carveTerrainTile(t.tile, field, { legacyOrigin: t.legacyOrigin, verticalDatumOffsetMetres: t.datum })).toBe(0);
  });
});
