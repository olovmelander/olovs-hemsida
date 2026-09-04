/* Reviewed lattice and evidence contract for the first Ängsö v2 publication.
   Coordinates address sample centres in EPSG:3006; the source COG's pixel-edge
   window is half a metre wider on every side.

   Ängsö Golfklubb at Stora Bodarna is the LONGEST property here and the one
   that settles what "the reviewed window" costs. The course runs 2,167 m north
   to south along the mainland peninsula and only 894 m across, so the smallest
   rectangle that clears the runbook's zone-A margin is eight tiles by sixteen
   -- and both the frontier contract and the ring topology want a SQUARE tile
   count, the first because it fills a complete square of level-zero tiles, the
   second because each finer ring has to be the middle four tiles of the next
   coarser one. Sixteen per side is therefore not padding: 2,048 m does not
   reach the 12th to the 16th at the north end, and the next legal size is
   4,096 m. That buys 256 level-zero tiles against Veckefjärden's 64, and it
   buys a margin of 964 m rather than 100.

   The window is centred on the played ground rather than produced by
   `alignTerrainGridExtent`, for the reason Veckefjärden records: the aligner
   centres its power-of-two padding with a floor, so an odd tile deficit lands
   entirely east and south. Centring shares the surplus, and here it also puts
   the derived frame origin within 0.4 m of the played centroid.

   Everything is one 10 km Markhöjdmodell square. That is luck rather than
   design -- item 660_60 spans E 600000-610000 and N 6600000-6610000, and the
   4,096 m window sits well inside it -- but it means no seam and no item
   precedence rule is involved at any level of this ground. */
export const ANGSO_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'angso',
  courseSlug: 'angso',
  sourceItemIds: Object.freeze(['660_60']),
  sourceCollection: 'dtm-cog',
  sourceAssetUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_6/m660_60.tif',
  /* full 10 km COG, from the STAC item's own file:checksum multihash */
  sourceCogSha256: '4fc8d1a84207a86a6a14ae65a8a3152e6027832850701300aab92440228790fd',
  sourceCogBytes: 263029392,
  sourceCapture: Object.freeze({
    capturedAt: '2020-09-16T12:00:00Z',
    captureStart: '2020-02-24T00:00:00Z',
    captureEnd: '2021-04-10T00:00:00Z',
    modifiedAt: '2021-07-23T00:00:00Z',
    statedPlanUncertaintyMetres: 0.3,
    statedHeightUncertaintyMetres: 0.1,
  }),
  /* REVIEWED. The bounds every played point of the course falls inside,
     measured over all 1,331 coordinate pairs the committed EPSG:3006
     migration carries for the holes and the practice ground. */
  playedBounds: Object.freeze({
    minEasting: 605218.601,
    maxEasting: 606112.957,
    minNorthing: 6604638.285,
    maxNorthing: 6606805.357,
  }),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 4097,
  height: 4097,
  originEasting: 603617.5,
  originNorthing: 6607769.5,
  pixelEdgeWindow: Object.freeze({
    west: 603617,
    north: 6607770,
    east: 607714,
    south: 6603673,
  }),
  expectedBounds: Object.freeze({
    minEasting: 603617.5,
    minNorthing: 6603673.5,
    maxEasting: 607713.5,
    maxNorthing: 6607769.5,
  }),
  /* The margin the centred window achieves, measured against every played
     point. The north and south figures are the ones that matter: they are
     what eight tiles could not have supplied. */
  reviewedPlayedMarginMetres: Object.freeze({
    west: 1601.1, east: 1600.5, south: 964.8, north: 964.1, minimum: 964.1,
  }),
  expectedCompile: Object.freeze({
    levels: 5,
    tileChunks: 341,
    uniqueChunks: 342,
    rootTiles: 1,
  }),
  /* Stora Bodarna runs from Mälaren's regulated surface up onto the till
     ridge the back nine crosses, and the window reaches a kilometre of open
     water in the south. The band is deliberately far wider than the ground
     can be, so a nodata plane, a wrong item or a decimetre/metre unit slip
     fails loudly without the gate tracking the data it polices. */
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 80 }),
  holeTileBufferMetres: 80,
});

export function assertAngsoCompilation(compilation) {
  const config = ANGSO_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== 1 || compilation.courseSlugs[0] !== config.courseSlug) {
    throw new Error('Ängsö compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Ängsö terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Ängsö terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Ängsö RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Ängsö terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
