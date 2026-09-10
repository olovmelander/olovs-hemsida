/* The pack frames a GPS fix must be projected into, for the courses authored
   DIRECTLY in the grid: their x/z axes are SWEREF 99 TM, so a WGS84 fix is
   projected rather than run through the flat-earth formula every other course
   uses.

   WHY THIS IS NOT READ FROM THE v2 REGISTRY. It used to be, and it cost the
   flagless visit the entire v2 config tree: caddie.js is player code, so one
   static import of v2-frontier-configs.mjs made all nine course config modules
   reachable from main, which check-app-build refuses -- every v2 module must
   stay behind a dynamic import so a visitor who never opens a v2 ground
   downloads none of them. GPS, meanwhile, works on every course, v2 or not.

   So the constants live here, where the caddie uses them, and
   gps-projected-frames.test.mjs asserts they are field-for-field what the v2
   registry declares. The guarantee the old import gave -- the SAME pack frame
   identity as the terrain bridge -- is now a gate rather than a coupling, and
   a drifted or newly grid-authored course fails that test loudly. */
export const PROJECTED_GPS_FRAMES = Object.freeze([
  {
    slug: "lidingo",
    packFrame: "local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000",
    packOriginWgs84: { latitude: 59.378715385375614, longitude: 18.12816746741512 },
    packMetresPerLongitude: 56702.08,
    legacyOriginEpsg3006: { easting: 677700.5, northing: 6586399.5 },
    bridgeMode: "epsg3006-local-rh2000",
  },
  {
    slug: "ribbingsfors",
    packFrame: "local metres from EPSG:3006; east +x, north -z; origin E448975.5 N6536024.5; heights RH 2000",
    packOriginWgs84: { latitude: 58.9607905493, longitude: 14.1128725388 },
    packMetresPerLongitude: 57399.32,
    legacyOriginEpsg3006: { easting: 448975.5, northing: 6536024.5 },
    bridgeMode: "epsg3006-local-rh2000",
  },
  {
    slug: "visby",
    packFrame: "local metres from EPSG:3006; east +x, north -z; origin E687748.5 N6370951.5; heights RH 2000",
    packOriginWgs84: { latitude: 57.44236399463288, longitude: 18.12847826436399 },
    packMetresPerLongitude: 59906.61,
    legacyOriginEpsg3006: { easting: 687748.5, northing: 6370951.5 },
    bridgeMode: "epsg3006-local-rh2000",
  },
  {
    slug: "tortuna",
    packFrame: "local metres from EPSG:3006; east +x, north -z; origin E597400.5 N6614899.5; heights RH 2000",
    packOriginWgs84: { latitude: 59.66075504228196, longitude: 16.728689063923202 },
    packMetresPerLongitude: 56229.83,
    legacyOriginEpsg3006: { easting: 597400.5, northing: 6614899.5 },
    bridgeMode: "epsg3006-local-rh2000",
  },
].map(Object.freeze));
