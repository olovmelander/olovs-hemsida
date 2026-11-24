/* Bro Hof Slott Golf Club retained native 1 m sample lattice (EPSG:5845).
 * Centred on E 649,094.5, N 6,598,568.5 — enclosing both The Stadium Course
 * and The Castle Course plus Lake Mälaren shoreline & club campus inside one
 * shared 4,096 m LOD0 square and 16,384 m 7-LOD standard ring topology. */
export const BRO_HOF_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'bro-hof',
  courseSlugs: Object.freeze(['bro-hof-stadium', 'bro-hof-castle']),
  sourceItemIds: Object.freeze(['659_64', '659_65', '660_64', '660_65']),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 4097,
  height: 4097,
  originEasting: 647046.5,
  originNorthing: 6600616.5,
  pixelEdgeWindow: Object.freeze({ west: 647046, north: 6600617, east: 651143, south: 6596520 }),
  expectedBounds: Object.freeze({
    minEasting: 647046.5,
    minNorthing: 6596520.5,
    maxEasting: 651142.5,
    maxNorthing: 6600616.5,
  }),
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 150 }),
});
