/* EPSG:3006 midpoint of the retained 4097-sample source window. WGS84 values
   transformed with pyproj 3.8.0 / PROJ 9.8.1, always_xy, 2026-09-07.
   Horizontal rendering convention only; independent survey approval pending. */
export const VISBY_FRAME = Object.freeze({
  easting: 687748.5, northing: 6370951.5, heightRH2000: 0.10,
  latitude: 57.44236399463288, longitude: 18.12847826436399,
  text: 'local metres from EPSG:3006; east +x, north -z; origin E687748.5 N6370951.5; heights RH 2000',
});
/* Complete 8 x 8 native-metre tile frontier around the played property, from
   columns 4..11 and rows 3..10 of the full retained 16 x 16 source lattice.
   The remaining source terrain stays in the graph and the coarse vista. */
export const VISBY_FRONTIER_BOUNDS = Object.freeze({
  minEasting: 686724.5, minNorthing: 6370183.5,
  maxEasting: 688772.5, maxNorthing: 6372231.5,
});
export const local = ([easting, northing]) => [easting - VISBY_FRAME.easting, VISBY_FRAME.northing - northing];
export const projected = ([x, z]) => [VISBY_FRAME.easting + x, VISBY_FRAME.northing - z];
