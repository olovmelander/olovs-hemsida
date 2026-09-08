/* Exact projected bridge for the source-derived Visby candidate. The complete
 * source pyramid covers 4096 m; the initial native-metre view is a complete
 * 64-tile rectangle around the played property. Survey approval remains open. */
export const VISBY_V2_CONFIG = Object.freeze({
  slug: 'visby', groundId: 'visby',
  label: 'Visby GK · Lantmäteriet 1 m · Preliminära spelytor',
  frameFingerprint: 'd7631b5ee1a936044fc4f03d7ee13971438b65653cc23a4dd9676b563123f511',
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 685700.5, minNorthing: 6368903.5, maxEasting: 689796.5, maxNorthing: 6372999.5,
  }),
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 686724.5, minNorthing: 6370183.5, maxEasting: 688772.5, maxNorthing: 6372231.5,
  }),
  canonicalOrigin: Object.freeze({ easting: 687748.5, northing: 6370951.5, heightRH2000: 0.10 }),
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
