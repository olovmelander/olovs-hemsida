/* Tjusta Golfklubb retained native 1 m sample lattice (EPSG:5845).
 * Centred on E 669,130.5, N 6,611,250.5: the middle of the box round the club's 18 holes and
 * practice ground at Tjusta Gård, Rosersberg, inside one 4,096 m LOD0 square and the 16,384 m
 * 7-LOD standard ring topology. */
export const TJUSTA_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'tjusta',
  courseSlugs: Object.freeze(['tjusta']),
  sourceItemIds: Object.freeze(['660_66', '660_67', '661_66', '661_67']),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 4097,
  height: 4097,
  originEasting: 667082.5,
  originNorthing: 6613298.5,
  pixelEdgeWindow: Object.freeze({ west: 667082, north: 6613299, east: 671179, south: 6609202 }),
  expectedBounds: Object.freeze({
    minEasting: 667082.5,
    minNorthing: 6609202.5,
    maxEasting: 671178.5,
    maxNorthing: 6613298.5,
  }),
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 150 }),
});
