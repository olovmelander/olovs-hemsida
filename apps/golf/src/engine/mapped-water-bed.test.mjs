import { describe, expect, it } from 'vitest';
import { buildWaterBedField, carveTerrainTile } from './v2-water-bed.mjs';
import { refineMappedWaterBeds } from './mapped-water-bed.mjs';
import { encodePreparedWater, decodePreparedWater, preparedWaterInputs } from './prepared-water.mjs';

const identity = 'a'.repeat(64);
const toGrid = (x, z) => [x, z];
const body = { ring: [[10, 10], [38, 10], [38, 39], [10, 39]], level: 10, exactShore: true };
const other = { ring: [[65, 10], [90, 10], [90, 39], [65, 39]], level: 12 };
const flat = { width: 16, height: 10, spacing: 8, x0: 0, z0: 0,
  label: new Int32Array(160), mask: new Uint8Array(160), components: [], refusedNotLevel: [] };
const knownBodies = [body, other];
const coarse = buildWaterBedField({ flatWater: flat, knownBodies, toGrid });
const fine = refineMappedWaterBeds(coarse, knownBodies, toGrid);

function tile() {
  const grid = { width: 129, height: 81, sampleSpacingMetres: 1, heightOffsetMetres: 0,
    heightScaleMetres: .01, noDataValue: 65535 };
  const payload = new Uint8Array(grid.width * grid.height * 2), v = new DataView(payload.buffer);
  for (let i = 0; i < payload.length; i += 2) v.setUint16(i, 1000, true);
  return { bounds: { minEasting: 0, maxEasting: 128, minNorthing: -80, maxNorthing: 0 }, grid, payload };
}

describe('reviewed mapped pond beds', () => {
  it('removes the actual coarse bank spill without enlarging the world arrays', () => {
    expect(coarse.depthAt(8, 24)).toBeGreaterThan(0);
    expect(fine.depthAt(8, 24)).toBe(0);
    expect(fine.inWater(8, 24)).toBe(false);
    expect(fine.depthAt(24, 24)).toBeGreaterThan(1);
    expect(fine.levelAt(24, 24)).toBe(10);
    expect(fine.mask).toBe(coarse.mask);
    expect(fine.depth).toBe(coarse.depth);
    expect(fine.refinedBodies).toBe(1);
    expect(fine.depthAt(72, 24)).toBe(coarse.depthAt(72, 24));
    expect(fine.levelAt(72, 24)).toBe(coarse.levelAt(72, 24));
  });

  it('keeps every dry terrain sample outside the exact pond intact through tile carving', () => {
    const prior = tile(), after = tile();
    const placement = { legacyOrigin: { easting: 0, northing: 0 }, verticalDatumOffsetMetres: 0 };
    carveTerrainTile(prior, coarse, placement);
    carveTerrainTile(after, fine, placement);
    const h = (t, x, z) => new DataView(t.payload.buffer).getUint16((z * t.grid.width + x) * 2, true);
    expect(h(prior, 8, 24)).toBeLessThan(1000);
    for (let z = 0; z <= 50; z++) for (let x = 0; x <= 50; x++) {
      if (x >= 10 && x <= 38 && z >= 10 && z <= 39) continue;
      expect(h(after, x, z), `${x},${z}`).toBe(1000);
    }
    expect(h(after, 24, 24)).toBeLessThan(900);
  });

  it('preserves a narrow dry causeway and a wet neck that the raster misses', () => {
    const ponds = [
      { ring: [[10,10],[30,10],[30,40],[10,40]], level:10, exactShore:true },
      { ring: [[33,10],[53,10],[53,40],[33,40]], level:11, exactShore:true },
      { ring: [[15,45],[17,45],[17,70],[15,70]], level:9, exactShore:true },
    ];
    const field = buildWaterBedField({ flatWater: flat, knownBodies: ponds, toGrid });
    const refined = refineMappedWaterBeds(field, ponds, toGrid);
    expect(refined.inWater(31.5, 24)).toBe(false);
    expect(refined.depthAt(31.5, 24)).toBe(0);
    expect(refined.levelAt(34, 24)).toBe(11);
    expect(refined.inWater(16, 56)).toBe(true);
    expect(refined.depthAt(16, 56)).toBeGreaterThan(0);
  });

  it('retains an interior island and respects a rotated bridge', () => {
    const pond = { ...body, holes: [[[18,18],[28,18],[28,28],[18,28]]] };
    const field = refineMappedWaterBeds(coarse, [pond], (x,z) => [z,-x]);
    expect(field.inWater(24,-24)).toBe(false);
    expect(field.depthAt(24,-24)).toBe(0);
    expect(field.inWater(14,-14)).toBe(true);
  });

  it('restores exactly the same refinement over a prepared payload', () => {
    const inputs = preparedWaterInputs({ knownBodies, bridge: { rotationRadians:0,scaleX:1,scaleZ:1,verticalDatumOffsetMetres:0 }, origin:{easting:0,northing:0},ocean:null });
    const decoded = decodePreparedWater(encodePreparedWater({ identity, inputs, flatWater: flat, waterBed: fine }), identity);
    const restored = refineMappedWaterBeds(decoded.waterBed, JSON.parse(inputs).knownBodies, toGrid);
    for (let z = 0; z < 70; z += .7) for (let x = 0; x < 100; x += .7) {
      expect(restored.depthAt(x,z)).toBe(fine.depthAt(x,z));
      expect(restored.inWater(x,z)).toBe(fine.inWater(x,z));
    }
  });

  it('leaves courses without reviewed ponds on their established field', () => {
    expect(refineMappedWaterBeds(coarse, [other], toGrid)).toBe(coarse);
  });
});
