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

  it('claims the same cells for known bodies whether it walks the whole raster or only their boxes', () => {
    const raster = lakeRaster();
    const flat = detectFlatWater({ raster, minimumCells: 100 });
    /* a rotated, scaled bridge, as the real one is: grid -> legacy */
    const angle = 0.061, scaleX = 1.0034, scaleZ = 1.0013, cos = Math.cos(angle), sin = Math.sin(angle);
    const toLegacy = (gx, gz) => [scaleX * (gx * cos - gz * sin), scaleZ * (gx * sin + gz * cos)];
    const toGrid = (lx, lz) => { const x = lx / scaleX, z = lz / scaleZ; return [x * cos + z * sin, -x * sin + z * cos]; };
    /* two bodies in legacy space, one overlapping the flat and one on land, overlapping each other */
    const knownBodies = [
      { ring: [[-30, -30], [40, -30], [40, 40], [-30, 40]], level: 50.5 },
      { ring: [[20, 20], [80, 20], [80, 70], [20, 70]], level: 51 },
    ];
    const whole = buildWaterBedField({ flatWater: flat, knownBodies, toLegacy });
    const boxed = buildWaterBedField({ flatWater: flat, knownBodies, toLegacy, toGrid });
    expect(boxed.cells).toBe(whole.cells);
    expect(Buffer.from(boxed.mask).equals(Buffer.from(whole.mask))).toBe(true);
    expect(Buffer.from(boxed.level.buffer).equals(Buffer.from(whole.level.buffer))).toBe(true);
    expect(Buffer.from(boxed.depth.buffer).equals(Buffer.from(whole.depth.buffer))).toBe(true);
    /* and the overlap took the first body's level, in both */
    const [gx, gz] = toGrid(30, 30);
    expect(boxed.levelAt(gx, gz)).toBe(50.5);
  });

  it('rejects with nearWater only samples whose bilinear depth is zero, inside the grid and past its edge', () => {
    const raster = lakeRaster();
    const field = buildWaterBedField({ flatWater: detectFlatWater({ raster, minimumCells: 100 }) });
    let checked = 0, rejected = 0;
    /* a sweep at quarter-cell steps, reaching a cell and a half past every edge */
    for (let gz = field.z0 - 6; gz <= field.z0 + field.height * field.spacing + 6; gz += 1) {
      for (let gx = field.x0 - 6; gx <= field.x0 + field.width * field.spacing + 6; gx += 1) {
        const depth = field.depthAt(gx, gz);
        if (depth > 0) expect(field.nearWater(gx, gz)).toBe(true);
        if (!field.nearWater(gx, gz)) rejected++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(rejected).toBeGreaterThan(checked / 2);   /* most of the raster is land, and it is rejected */
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

  it('carves exactly what a field without the near-water reject carves', () => {
    const raster = lakeRaster();
    const field = buildWaterBedField({ flatWater: detectFlatWater({ raster, minimumCells: 100 }) });
    const make = () => tile({ heightLegacy: (column, row) => {
      const gx = -64 + column * 4, gz = -64 + row * 4;
      return gx >= -48 && gx < 48 && gz >= -48 && gz < 48 ? 50 : 52.5;
    } });
    const fast = make(), slow = make();
    const options = { legacyOrigin: fast.legacyOrigin, verticalDatumOffsetMetres: fast.datum };
    const { nearWater, ...withoutReject } = field;
    expect(carveTerrainTile(fast.tile, field, options)).toBe(carveTerrainTile(slow.tile, withoutReject, options));
    expect(Buffer.from(fast.tile.payload).equals(Buffer.from(slow.tile.payload))).toBe(true);
  });

  it('skips a tile that does not touch the field', () => {
    const raster = lakeRaster();
    const field = buildWaterBedField({ flatWater: detectFlatWater({ raster, minimumCells: 100 }) });
    const t = tile({ heightLegacy: () => 50 });
    t.tile.bounds = { minEasting: 9000, maxEasting: 9128, minNorthing: 9000, maxNorthing: 9128 };
    expect(carveTerrainTile(t.tile, field, { legacyOrigin: t.legacyOrigin, verticalDatumOffsetMetres: t.datum })).toBe(0);
  });
});

import { buildFrontierWaterBedField, carveDecodedTerrainTile } from './v2-water-bed.mjs';

describe('the frontier bed field', () => {
  /* a frontier window x -64..64, z -64..64 with a lake ring covering x -48..48, z -48..200:
     the lake runs OUT of the window to the south */
  const bounds = { x0: -64, x1: 64, z0: -64, z1: 64 };
  const lake = { ring: [[-48, -48], [48, -48], [48, 200], [-48, 200]], level: 50 };

  it('is water inside the model ring only, at the ring level, deepening with shore distance', () => {
    const field = buildFrontierWaterBedField({ bounds, knownBodies: [lake], spacing: 2 });
    expect(field.kind).toBe('frontier');
    expect(field.inWater(0, 0)).toBe(true);
    expect(field.inWater(-56, 0)).toBe(false);
    expect(field.levelAt(0, 0)).toBe(50);
    /* the centre of the ring's width: 48 m from either shore, the boundary
       half a cell in from the last water cell centre, so 47 m on the ramp */
    expect(field.depthAt(0, 20)).toBeCloseTo(0.15 + 0.1 * 47, 2);
    expect(field.maximumDepthMetres).toBe(5.5);
    /* two metres inside the west shore: the shore depth plus the slope */
    expect(field.depthAt(-46, 20)).toBeGreaterThan(0.15);
    expect(field.depthAt(-46, 20)).toBeLessThan(1);
  });

  it('keeps deepening to the window edge where the lake runs out of it, because the field is padded', () => {
    const field = buildFrontierWaterBedField({ bounds, knownBodies: [lake], spacing: 2, paddingMetres: 64 });
    /* at the window's south edge (z = 64) the lake continues for 136 m: no
       shore here, so the bed keeps the depth its distance from the west shore
       gives it -- while an unpadded raster ends there, its bilinear reads zero
       past the edge, and the last cell shoals to half */
    expect(field.depthAt(0, 63.5)).toBeCloseTo(0.15 + 0.1 * 47, 2);
    const unpadded = buildFrontierWaterBedField({ bounds, knownBodies: [lake], spacing: 2, paddingMetres: 0 });
    expect(unpadded.depthAt(0, 63.5)).toBeLessThan(field.depthAt(0, 63.5) * 0.8);
  });

  it('caps the bed inside a traced shallows ring', () => {
    const shallows = [[[-48, -48], [0, -48], [0, 0], [-48, 0]]];
    const field = buildFrontierWaterBedField({ bounds, knownBodies: [lake], shallows, spacing: 2 });
    expect(field.depthAt(-24, -24)).toBeCloseTo(0.28, 5);
    /* outside the shallows the bed keeps its shore-distance depth: 24 m from the east shore */
    expect(field.depthAt(24, 24)).toBeGreaterThan(2.3);
    expect(field.depthAt(24, 24)).toBeLessThan(2.7);
    expect(field.shallowCells).toBeGreaterThan(0);
  });
});

describe('carving a decoded frontier tile', () => {
  /* a tile whose floor IS the lake surface, as the encoder writes it: offset = its minimum */
  function decodedTile({ heightAt, width = 33, spacing = 4, originX = -64, originZ = -64, offset = 50, scale = 0.01 }) {
    const payload = new Uint8Array(width * width * 2);
    for (let row = 0; row < width; row++) for (let column = 0; column < width; column++) {
      const q = Math.round((heightAt(originX + column * spacing, originZ + row * spacing) - offset) / scale);
      if (q < 0) throw new Error('fixture height below its own floor');
      const o = (row * width + column) * 2;
      payload[o] = q & 0xff; payload[o + 1] = q >> 8 & 0xff;
    }
    const span = (width - 1) * spacing;
    return {
      header: {
        id: 't', payloadFormat: 'terrain-grid-u16-le-v1',
        bounds: { minEasting: originX, maxEasting: originX + span, minNorthing: -(originZ + span), maxNorthing: -originZ },
        grid: { width, height: width, sampleSpacingMetres: spacing, heightOffsetMetres: offset, heightScaleMetres: scale, noDataValue: 65535 },
      },
      payload,
    };
  }
  const sampleOf = (decoded, column, row) => {
    const { grid } = decoded.header, o = (row * grid.width + column) * 2;
    return grid.heightOffsetMetres + (decoded.payload[o] | decoded.payload[o + 1] << 8) * grid.heightScaleMetres;
  };
  const options = { legacyOrigin: { easting: 0, northing: 0 }, verticalDatumOffsetMetres: 0 };
  const bounds = { x0: -64, x1: 64, z0: -64, z1: 64 };
  const lake = { ring: [[-48, -48], [48, -48], [48, 48], [-48, 48]], level: 50 };

  it('re-floors a tile whose offset is the lake surface, so the bed can go metres below it', () => {
    const field = buildFrontierWaterBedField({ bounds, knownBodies: [lake], spacing: 2 });
    const decoded = decodedTile({ heightAt: (x, z) => {
      const inLake = x >= -48 && x < 48 && z >= -48 && z < 48;
      if (inLake && Math.abs(x) <= 4 && Math.abs(z) <= 4) return 53;   /* an island the ring encloses */
      return inLake ? 50.05 : 52.5;                                     /* the laser's water surface, and the bank */
    } });
    const before = Uint8Array.from(decoded.payload);
    const carved = carveDecodedTerrainTile(decoded, field, options);
    expect(carved).not.toBe(decoded);
    expect(carved.waterBed.carvedSamples).toBeGreaterThan(400);
    /* the new floor sits below the deepest bed this 96 m lake asks for, with room to spare */
    expect(carved.waterBed.rebasedOffsetMetres).toBeLessThan(sampleOf(carved, 8, 16) - 0.4);
    expect(carved.waterBed.rebasedOffsetMetres).toBeLessThan(46);
    expect(carved.header.grid.heightOffsetMetres).toBe(carved.waterBed.rebasedOffsetMetres);
    /* the verified bytes were not touched; the carved copy has the bed */
    expect(Buffer.from(decoded.payload).equals(Buffer.from(before))).toBe(true);
    /* mid-lake (x -32, z 0 -> column 8, row 16), 16 m from the west shore: the field's depth below the level */
    expect(sampleOf(carved, 8, 16)).toBeCloseTo(50 - field.depthAt(-32, 0), 2);
    expect(sampleOf(carved, 8, 16)).toBeLessThan(49);
    /* the lake's middle reaches the profile's maximum, which the old floor could never hold */
    expect(sampleOf(carved, 4, 4)).toBeGreaterThan(50 - 5.5 - 0.02);
    /* the bank and the island read exactly as before through the new offset */
    expect(sampleOf(carved, 0, 16)).toBeCloseTo(52.5, 5);
    expect(sampleOf(carved, 16, 16)).toBeCloseTo(53, 5);
    /* carving the carved tile again changes nothing */
    expect(carveDecodedTerrainTile(carved, field, options)).toBe(carved);
  });

  it('keeps the offset when the tile already has room, and returns the same object when nothing is in water', () => {
    const field = buildFrontierWaterBedField({ bounds, knownBodies: [lake], spacing: 2 });
    const roomy = decodedTile({ offset: 40, heightAt: (x, z) => (x >= -48 && x < 48 && z >= -48 && z < 48 ? 50.05 : 52.5) });
    const carved = carveDecodedTerrainTile(roomy, field, options);
    expect(carved.header.grid.heightOffsetMetres).toBe(40);
    expect(carved.waterBed.rebasedOffsetMetres).toBeNull();
    const dry = decodedTile({ originX: 5000, originZ: 5000, heightAt: () => 60 });
    expect(carveDecodedTerrainTile(dry, field, options)).toBe(dry);
  });
});
