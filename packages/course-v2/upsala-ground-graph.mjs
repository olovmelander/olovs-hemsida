/* Reviewed lattice and evidence contract for the first Upsala v2 publication.
   Coordinates address sample centres in EPSG:3006; the source COGs' pixel-edge
   window is half a metre wider on every side.

   Upsala Golfklubb at Håmö gård is the second ground here carrying two courses
   on one physical property -- the 18-hole Stora banan and the nine-hole
   Mellanbanan -- and, unlike Veckefjärden's short course, Mellanbanan does not
   sit inside the long one's box: it lies immediately EAST of it. Their played
   geometry together spans 1,686 m east to west and 1,156 m north to south, so
   one 2,048 m square holds both with 180 m clear east and west and 446 m north
   and south. That is past the runbook's 80-100 m zone-A margin but it is the
   tightest of any ground here, and it is a consequence of the two courses
   standing side by side rather than a choice: a wider window would have to be
   a wider TILE COUNT, and the frontier contract wants a square one.

   The window is centred on the played ground rather than produced by
   `alignTerrainGridExtent`, for the reason Veckefjärden records: the aligner
   centres its power-of-two padding with a floor, so an odd tile deficit lands
   entirely east and south. Centring shares the surplus.

   Upsala is the FIRST ground here whose window crosses a source seam. The
   course straddles easting 640000, so the west 880 m come from Markhöjdmodell
   item 663_63 and the east 1,168 m from 663_64. Both are the same product,
   the same 1 m lattice and the same RH 2000 datum, and both are read at
   factor 1 -- so every published sample is a source pixel copied exactly and
   the seam is a seam in provenance only, not in geometry. The two items were
   captured a day apart (2023-04-26 and 2023-04-27) and both carry the same
   stated 0.3 m plan / 0.1 m height uncertainty. */
export const UPSALA_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'upsala',
  courseSlug: 'upsala',
  courseSlugs: Object.freeze(['upsala', 'upsala-mellanbanan']),
  /* Two 10 km Markhöjdmodell squares, west then east of easting 640000. */
  sourceItemIds: Object.freeze(['663_63', '663_64']),
  sourceCollection: 'dtm-cog',
  sourceItems: Object.freeze([
    Object.freeze({
      id: '663_63',
      assetUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_6/m663_63.tif',
      /* full 10 km COG, from the STAC item's own file:checksum multihash */
      cogSha256: '95655f47fc991c4adb6a97458d3f75cf3ec2a82d85da29ee15b360afda4641a8',
      cogBytes: 312121246,
      breakGeometryUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_6/m663_63_brytgeometri.gpkg',
      breakGeometrySha256: 'b95c4407e0afce8640524011711cf2442348bed51b9c999616f4a5fb5995550a',
      capturedAt: '2023-04-27T00:00:00Z',
      captureStart: '2021-03-08T00:00:00Z',
      captureEnd: '2025-06-15T00:00:00Z',
    }),
    Object.freeze({
      id: '663_64',
      assetUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_6/m663_64.tif',
      cogSha256: '8d0107f4aa85d02200ecf91547813e93499571b995a293bdbe1b80509e34541e',
      cogBytes: 315120737,
      breakGeometryUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_6/m663_64_brytgeometri.gpkg',
      breakGeometrySha256: '3699df61f8f747eda55c9266ba77adf69b6da7050fb372c60c8c58a9c9d21636',
      capturedAt: '2023-04-26T00:00:00Z',
      captureStart: '2021-03-07T00:00:00Z',
      captureEnd: '2025-06-14T00:00:00Z',
    }),
  ]),
  sourceCapture: Object.freeze({
    statedPlanUncertaintyMetres: 0.3,
    statedHeightUncertaintyMetres: 0.1,
    method: 'Luftburen laserskanning',
  }),
  /* The mosaicked 2049 x 2049 little-endian Float32 window the compiler reads,
     written by packages/course-geo/acquisition/build-terrain-window.mjs. There
     is no intermediate window COG here: the Node COG reader copies source
     pixels at factor 1 and writes the raster directly, so this is the only
     retained byte identity between the items and the compile. */
  sourceFloat32Sha256: '5a45dc491db0650503df91054ffc69ccb7607887dc90f8a267c7fa725fa34854',
  /* The union of every played point both migrated course models carry. */
  playedBounds: Object.freeze({
    minEasting: 639299.8,
    maxEasting: 640986.3,
    minNorthing: 6635567.4,
    maxNorthing: 6636723.6,
  }),
  reviewedZoneAMarginMetres: 100,
  reviewedPlayedMarginMetres: Object.freeze({
    west: 180.3, east: 181.2, south: 445.9, north: 445.9, minimum: 180.3,
  }),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 2049,
  height: 2049,
  originEasting: 639119.5,
  originNorthing: 6637169.5,
  pixelEdgeWindow: Object.freeze({
    west: 639119,
    north: 6637170,
    east: 641168,
    south: 6635121,
  }),
  expectedBounds: Object.freeze({
    minEasting: 639119.5,
    minNorthing: 6635121.5,
    maxEasting: 641167.5,
    maxNorthing: 6637169.5,
  }),
  expectedCompile: Object.freeze({
    levels: 4,
    tileChunks: 85,
    uniqueChunks: 86,
    rootTiles: 1,
  }),
  /* Measured: the retained window runs 13.286-54.386 m RH 2000. Håmö sits on
     the Uppsala plain, where the clay flats by the Hågaån stream lie under
     20 m and the Håmö and Läby ridges the back nine climbs reach the low
     fifties. The band is deliberately far wider than the ground can be so a
     nodata plane, a wrong item or a unit slip fails loudly, without the gate
     tracking the data it polices. Puttom's 10..200 course gate would pass a
     nodata plane here; Veckefjärden's -2..180 would too. */
  plausibleHeightRangeRH2000: Object.freeze({ minimum: 5, maximum: 90 }),
  holeTileBufferMetres: 80,
});

/* The one constant here that is neither derived nor reviewed but MEASURED.
   Filled by tools/measure-vertical-datum.mjs --ground upsala and copied here
   deliberately; see the runtime config for what it is used for. */
export const UPSALA_VERTICAL_DATUM = Object.freeze({
  offsetMetres: null,
  evidence: null,
});

export function assertUpsalaCompilation(compilation) {
  const config = UPSALA_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== config.courseSlugs.length ||
      compilation.courseSlugs.some((slug, index) => slug !== config.courseSlugs[index])) {
    throw new Error('Upsala compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Upsala terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Upsala terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Upsala RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Upsala terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
