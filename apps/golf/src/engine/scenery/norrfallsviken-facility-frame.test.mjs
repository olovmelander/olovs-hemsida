/* norrfallsviken-facility-frame.mjs restates two records the v2 contract owns,
   so the authored facilities can be placed without becoming a second importer
   of that contract -- which would turn it into a shared v2-* chunk reachable by
   static import from the entry, and check-app-build refuses exactly that.

   Restating is only safe while something proves the copies agree. A test is not
   in the bundle, so it may import both. If the reviewed contract's frame or
   grid origin is ever corrected, this fails rather than letting the buildings
   drift away from the terrain they stand on. */
import { describe, expect, it } from 'vitest';
import { NORRFALLSVIKEN_FACILITY_FRAME, NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006 }
  from './norrfallsviken-facility-frame.mjs';
import { NORRFALLSVIKEN_V2_CONFIG } from '../v2-norrfallsviken-config.mjs';

describe('Norrfällsviken facility frame restates its v2 contract', () => {
  it('is the contract\'s legacy frame, field for field', () => {
    expect(NORRFALLSVIKEN_FACILITY_FRAME).toEqual(NORRFALLSVIKEN_V2_CONFIG.legacyFrame);
    /* named explicitly: a frame that silently lost one of these would still
       deep-equal an equally truncated contract */
    for (const key of ['latitude', 'longitude', 'metresPerLatitude', 'metresPerLongitude',
      'verticalDatumOffsetMetres']) {
      expect(Number.isFinite(NORRFALLSVIKEN_FACILITY_FRAME[key]), `${key} must be a number`).toBe(true);
    }
  });

  it('is the contract\'s grid origin', () => {
    expect(NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006).toEqual(NORRFALLSVIKEN_V2_CONFIG.legacyOriginEpsg3006);
    expect(Number.isFinite(NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006.easting)).toBe(true);
    expect(Number.isFinite(NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006.northing)).toBe(true);
  });

  it('carries the MEASURED datum offset, not a copy of another ground\'s', () => {
    /* Norrfällsviken's is 20.3432 m; Puttom's 23.6263 and Veckefjärden's
       20.9924 are the two this has most to fear being confused with. */
    expect(NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres)
      .toBe(NORRFALLSVIKEN_V2_CONFIG.legacyFrame.verticalDatumOffsetMetres);
    expect(NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres).toBeGreaterThan(15);
    expect(NORRFALLSVIKEN_FACILITY_FRAME.verticalDatumOffsetMetres).toBeLessThan(25);
  });
});
