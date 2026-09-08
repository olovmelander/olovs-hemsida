/* Exact projected bridge for the source-derived Visby candidate. The complete
 * source pyramid covers 4096 m; the initial native-metre view is a complete
 * 64-tile rectangle around the played property. Survey approval remains open. */
export const VISBY_V2_CONFIG = Object.freeze({
  slug: 'visby', groundId: 'visby',
  label: 'Visby GK · Lantmäteriet 1 m · Preliminära spelytor',
  frameFingerprint: 'd7631b5ee1a936044fc4f03d7ee13971438b65653cc23a4dd9676b563123f511',
  /* THE GROUND'S OWN EXTENT, which the ring publish moved from the 4,096 m
     source window to the 16,384 m root. Derived from the ring spec rather than
     typed: the root level is 1 tile of 256 segments at 64 m centred on the
     frame origin, so ringLevelExtent gives exactly these four numbers. If a
     publish ever disagrees, read the assertion's own "got" line -- it is the
     measurement, and this is the prediction. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 679556.5, minNorthing: 6362759.5, maxEasting: 695940.5, maxNorthing: 6379143.5,
  }),
  /* Declaring ringGraph is what makes check-course-v2 assert that a graph
     ACTUALLY SERVES rather than that the fixed frontier does, which is the
     branch that would have caught the published-pyramid state this replaced:
     341 tiles with no parentId on any of them, so the streaming runtime never
     engaged and every boot silently fell back to the 64-tile frontier while
     the gate passed. The counts are the spec's own topology --
     16^2 + 8^2 + 8^2 + 8^2 + 4^2 + 2^2 + 1^2 -- and are verified by the
     publish, not assumed by it. */
  ringGraph: Object.freeze({
    levels: 7, tiles: 469, rootSpanMetres: 16384,
    tilesByLod: Object.freeze([256, 64, 64, 64, 16, 4, 1]),
  }),
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 686724.5, minNorthing: 6370183.5, maxEasting: 688772.5, maxNorthing: 6372231.5,
  }),
  canonicalOrigin: Object.freeze({ easting: 687748.5, northing: 6370951.5, heightRH2000: 0.10 }),
  /* THE EPSG:3006 COORDINATES OF LOCAL (0, 0), which every consumer of a
     published tile needs: a tile states its bounds in the grid and the engine
     draws in local metres, x = easting - origin.easting and z =
     origin.northing - northing. On a pack authored in the older flat-earth
     frame this is a SEPARATE point from the canonical grid origin -- 6 m apart
     at Norrfällsviken, 313 m at Upsala, 460 m at Veckefjärden. This pack is
     authored directly in the grid, so the two are the same point by
     construction and the numbers are written once, above.

     It is declared rather than inferred because inference is what broke: the
     frontier loader fell back to `canonicalOrigin` for a bridge like this one
     and the ring adapter's caller did not, so the first grid-authored ground
     to get a ring graph threw `legacyOriginEpsg3006.easting must be finite`,
     its v2 source failed, and the flagless visit fell back to GPK1 in silence
     while every data gate passed. */
  legacyOriginEpsg3006: Object.freeze({ easting: 687748.5, northing: 6370951.5 }),
  packOriginWgs84: Object.freeze({ latitude: 57.44236399463288, longitude: 18.12847826436399 }),
  packMetresPerLongitude: 59906.61,
  packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E687748.5 N6370951.5; heights RH 2000',
  bridgeMode: 'epsg3006-local-rh2000', expectedTileCount: 64, expectedSurfaceTileCount: 0,
  surfacePolicy: 'legacy-ground-atlas',
  legacyCoreCutout: Object.freeze({
    guardCells: 2, guardMetres: 8,
    expectedCoreGrid: Object.freeze({ dx: 4, x0: -720, x1: 720, z0: -1116, z1: 540, nx: 361, nz: 415 }),
    expectedSkippedBasePoints: 145195, expectedTotalBasePoints: 149815,
  }),
});
export const VISBY_V2_CONFIGS = Object.freeze({ visby: VISBY_V2_CONFIG });
