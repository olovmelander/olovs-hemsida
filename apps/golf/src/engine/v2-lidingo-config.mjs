/* Exact source-grid bridge, independently checked against the 1 m window and
 * compatibility model. Survey/control approval remains a separate open gate. */
export const LIDINGO_V2_CONFIG = Object.freeze({
  slug: 'lidingo', groundId: 'lidingo',
  label: 'Lidingö GK · Lantmäteriet 1 m · Preliminära spelytor',
  frameFingerprint: '8b9f61aba7ef3d78a14219d10ba79ce09322ac947c52a4f1551acc9c4447a7d6',
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 676676.5, minNorthing: 6585375.5, maxEasting: 678724.5, maxNorthing: 6587423.5,
  }),
  canonicalOrigin: Object.freeze({ easting: 677700.5, northing: 6586399.5, heightRH2000: -0.05 }),
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
  legacyOriginEpsg3006: Object.freeze({ easting: 677700.5, northing: 6586399.5 }),
  packOriginWgs84: Object.freeze({ latitude: 59.378715385375614, longitude: 18.12816746741512 }),
  packMetresPerLongitude: 56702.08,
  packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000',
  bridgeMode: 'epsg3006-local-rh2000', expectedTileCount: 64, expectedSurfaceTileCount: 0,
  surfacePolicy: 'legacy-ground-atlas',
  legacyCoreCutout: Object.freeze({
    guardCells: 2, guardMetres: 8,
    expectedCoreGrid: Object.freeze({ dx: 4, x0: -684, x1: 576, z0: -756, z1: 720, nx: 316, nz: 370 }),
    expectedSkippedBasePoints: 112840, expectedTotalBasePoints: 116920,
  }),
});
export const LIDINGO_V2_CONFIGS = Object.freeze({ lidingo: LIDINGO_V2_CONFIG });
