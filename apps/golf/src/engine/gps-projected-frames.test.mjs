/* gps-projected-frames.mjs restates constants the v2 registry owns, so that
   player code does not have to import that registry and drag every course
   config into the flagless bundle. Restating is only safe while something
   proves the two agree, and that is this file: it imports BOTH -- a test is
   not in the bundle, so it may reach for the registry freely -- and fails if a
   value drifts, if a grid-authored course is added to the registry and not
   here, or if one listed here stops being grid-authored. */
import { describe, expect, it } from 'vitest';
import { PROJECTED_GPS_FRAMES } from './gps-projected-frames.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';

const GRID_BRIDGE = 'epsg3006-local-rh2000';
const registryGrid = Object.entries(V2_GRAPH_FRONTIER_CONFIGS)
  .filter(([, config]) => config.bridgeMode === GRID_BRIDGE);

/* Exactly the fields the caddie reads off a frame. A field the caddie starts
   using must be added here, or it would be restated without being checked. */
const READ_BY_CADDIE = ['packFrame', 'packOriginWgs84', 'packMetresPerLongitude',
  'legacyOriginEpsg3006', 'bridgeMode'];
const pick = source => Object.fromEntries(READ_BY_CADDIE.map(key => [key, source[key]]));

describe('projected GPS frames restate the v2 registry exactly', () => {
  it('covers every grid-authored course and no others', () => {
    expect(PROJECTED_GPS_FRAMES.map(frame => frame.slug).sort())
      .toEqual(registryGrid.map(([slug]) => slug).sort());
    for (const frame of PROJECTED_GPS_FRAMES) expect(frame.bridgeMode).toBe(GRID_BRIDGE);
    expect(PROJECTED_GPS_FRAMES.length).toBeGreaterThan(0);
  });

  it('agrees field for field with the registry the terrain bridge uses', () => {
    for (const [slug, config] of registryGrid) {
      const frame = PROJECTED_GPS_FRAMES.find(candidate => candidate.slug === slug);
      expect(frame, `${slug} is grid-authored but has no projected GPS frame`).toBeDefined();
      expect(pick(frame), `${slug} frame differs from its v2 contract`).toEqual(pick(config));
    }
  });

  it('states a usable frame for each: a real origin and a positive scale', () => {
    for (const frame of PROJECTED_GPS_FRAMES) {
      expect(Number.isFinite(frame.legacyOriginEpsg3006.easting)).toBe(true);
      expect(Number.isFinite(frame.legacyOriginEpsg3006.northing)).toBe(true);
      expect(Number.isFinite(frame.packOriginWgs84.latitude)).toBe(true);
      expect(Number.isFinite(frame.packOriginWgs84.longitude)).toBe(true);
      expect(frame.packMetresPerLongitude).toBeGreaterThan(0);
      /* the caddie matches on this string, so an empty one would silently send
         a grid-authored course down the flat-earth path */
      expect(frame.packFrame).toMatch(/EPSG:3006/);
    }
  });
});
