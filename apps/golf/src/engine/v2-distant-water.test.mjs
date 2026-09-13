import { describe, expect, it } from 'vitest';
import { V2GraphTerrainAdapter } from './v2-graph-terrain.mjs';
import { buildWaterBedField, carveTerrainTile } from './v2-water-bed.mjs';

const legacyOrigin = { easting: 1000, northing: 2000 };
function tile(lod, spacing, extent) {
  const size = extent * 2 / spacing + 1;
  const payload = new Uint8Array(size * size * 2);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const x = -extent + c * spacing, z = -extent + r * spacing;
    // A lake straddles the old ring boundary at x = -128, with a dry island.
    const lake = x >= -240 && x <= -48 && Math.abs(z) <= 96;
    const island = x >= -208 && x <= -176 && Math.abs(z) <= 24;
    const h = lake && !island ? 12 : 24 + (x + 256) * 0.12 + (z + 256) * 0.07;
    const q = Math.round(h * 100), i = (r * size + c) * 2;
    payload[i] = q & 255; payload[i + 1] = q >> 8;
  }
  return {
    lod, payload,
    grid: { width: size, height: size, sampleSpacingMetres: spacing, heightOffsetMetres: 0, heightScaleMetres: 0.01 },
    bounds: { minEasting: 1000 - extent, maxEasting: 1000 + extent, minNorthing: 2000 - extent, maxNorthing: 2000 + extent },
  };
}

describe('water across terrain ring boundaries', () => {
  it.each([3, 5])('continues a lake and its bed into the complete outer ring (LOD %i)', outerLod => {
    const inner = tile(2, 4, 128), outer = tile(outerLod, 8, 256), root = tile(6, 16, 256);
    const adapter = {
      ringTiles: new Map([[6, [root]], [2, [inner]], [outerLod, [outer]]]),
      legacyOrigin,
      bridge: { verticalDatumOffsetMetres: 10, toLegacy: (x, z) => [x, z] },
    };
    const knownBodies = [{ level: 22.2, ring: [[-120, -80], [-48, -80], [-48, 80], [-120, 80]] }];
    const water = V2GraphTerrainAdapter.prototype.detectFlatWater.call(adapter, knownBodies);
    expect(water.spacing).toBe(8); // Finest ring covering the world, independent of LOD name/order.
    expect(water.components).toHaveLength(1);
    expect(water.components[0].level).toBe(22.2);
    for (let x = -160; x <= -124; x += 2) expect(water.isWaterAt(x, 50)).toBe(true);
    expect(water.isWaterAt(-200, 50)).toBe(true);
    expect(water.isWaterAt(-200, 0)).toBe(false); // Island stays dry.
    expect(water.isWaterAt(-200, 120)).toBe(false); // Bank stays dry.
    expect(water.isWaterAt(-80, 50)).toBe(false); // Existing mesh owns the mapped part.
    expect(water.isFlatAt(-80, 50)).toBe(true);
    const bed = buildWaterBedField({ flatWater: water, knownBodies });
    for (const x of [-144, -128, -112]) {
      expect(bed.inWater(x, 50)).toBe(true);
      expect(bed.levelAt(x, 50)).toBeCloseTo(22.2, 5);
      expect(bed.depthAt(x, 50)).toBeGreaterThan(1);
    }
    expect(carveTerrainTile(outer, bed, { legacyOrigin, verticalDatumOffsetMetres: 10 })).toBeGreaterThan(0);
  });
});
