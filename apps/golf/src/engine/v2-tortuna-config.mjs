/* Generated from retained Tortuna terrain and source geometry by compile-tortuna-ground-graph.mjs. Independent survey approval remains pending. */
export const TORTUNA_V2_CONFIG = Object.freeze({
  "slug": "tortuna",
  "groundId": "tortuna",
  "label": "Tortuna GK · Lantmäteriet 1 m · Preliminär källkarta",
  "frameFingerprint": "37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f",
  "expectedBoundsEpsg5845": {
    "minEasting": 595352.5,
    "minNorthing": 6612851.5,
    "maxEasting": 599448.5,
    "maxNorthing": 6616947.5
  },
  "ringGraph": {
    "levels": 5,
    "tiles": 341,
    "rootSpanMetres": 4096,
    "tilesByLod": [
      256,
      64,
      16,
      4,
      1
    ]
  },
  "expectedFrontierBoundsEpsg5845": {
    "minEasting": 596888.5,
    "maxEasting": 597912.5,
    "minNorthing": 6613619.5,
    "maxNorthing": 6616179.5
  },
  "canonicalOrigin": {
    "easting": 597400.5,
    "northing": 6614899.5,
    "heightRH2000": 16.31
  },
  "legacyOriginEpsg3006": {
    "easting": 597400.5,
    "northing": 6614899.5
  },
  "packOriginWgs84": {
    "latitude": 59.66075504228196,
    "longitude": 16.728689063923202
  },
  "packMetresPerLongitude": 56229.83,
  "packFrame": "local metres from EPSG:3006; east +x, north -z; origin E597400.5 N6614899.5; heights RH 2000",
  "bridgeMode": "epsg3006-local-rh2000",
  "expectedTileCount": 40,
  "expectedSurfaceTileCount": 0,
  "surfacePolicy": "legacy-ground-atlas",
  "legacyCoreCutout": {
    "guardCells": 2,
    "guardMetres": 8,
    "expectedCoreGrid": {
      "dx": 4,
      "x0": -468,
      "x1": 540,
      "z0": -1152,
      "z1": 1188,
      "nx": 253,
      "nz": 586
    },
    "expectedSkippedBasePoints": 139200,
    "expectedTotalBasePoints": 148258
  }
});
export const TORTUNA_V2_CONFIGS = Object.freeze({ tortuna: TORTUNA_V2_CONFIG });
