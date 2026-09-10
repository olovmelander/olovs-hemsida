const easting = 597400.5, northing = 6614899.5;
// Metadata conversion through pyproj 3.8.0 / PROJ 9.8.1, always_xy,
// 2026-09-09. Master geometry remains exact EPSG:3006 offsets.
const latitude = 59.66075504228196, longitude = 16.728689063923202;
export const TORTUNA_FRAME = Object.freeze({ easting, northing, latitude, longitude,
  text: 'local metres from EPSG:3006; east +x, north -z; origin E597400.5 N6614899.5; heights RH 2000' });
export const local = ([e, n]) => [e - easting, northing - n];
export const projected = ([x, z]) => [x + easting, northing - z];
