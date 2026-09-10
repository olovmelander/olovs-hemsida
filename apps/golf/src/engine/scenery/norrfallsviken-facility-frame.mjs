/* The legacy frame and grid origin the authored Norrfallsviken facilities are
   placed by. They are the v2 contract's numbers, restated here and asserted
   against it by norrfallsviken-facility-frame.test.mjs.

   WHY NOT IMPORT THE CONTRACT. main.js already reaches v2-frontier-configs
   statically through v2-terrain-select, which rolldown INLINES into the player
   chunk -- harmless, and how it has always been. A SECOND importer changes
   that: the config becomes a shared chunk named v2-*, and check-app-build
   refuses one reachable by static import from the entry, because a flagless
   visit must fetch no v2 modules. This module is that second importer, so it
   restates instead, and the test is what keeps the two identical. */
export const NORRFALLSVIKEN_FACILITY_FRAME = Object.freeze({
  "latitude": 62.9825,
  "longitude": 18.5325,
  "metresPerLatitude": 111320,
  "metresPerLongitude": 50568.5149714403,
  "verticalDatumOffsetMetres": 20.3432
});

export const NORRFALLSVIKEN_FACILITY_ORIGIN_EPSG3006 = Object.freeze({
  "easting": 678970.625,
  "northing": 6988556.634
});
