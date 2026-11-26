/* Tjusta Golfklubb's one routing on its own ground. The pack is authored directly on the SWEREF 99 TM grid
 * (local metres from EPSG:3006, RH 2000 heights), so the bridge is an exact offset and no datum is fitted.
 * DERIVED values come from packages/course-v2/tjusta-ground-rings.mjs, bootstrap-terrain.mjs (frame) and
 * planV2LegacyCutout on the pack's own CORE grid. Independent survey approval remains pending. */
export const TJUSTA_V2_CONFIG = Object.freeze({
  slug: 'tjusta',
  label: 'Tjusta Golfklubb · Lantmäteriet 1 m terräng',
  groundId: 'tjusta',
  frameFingerprint: '36822f4a128f4f97370201288083f6dc01735cb51f54b074b68b0e294eb373ad',
  expectedBoundsEpsg5845: Object.freeze({ minEasting: 660938.5, minNorthing: 6603058.5, maxEasting: 677322.5, maxNorthing: 6619442.5 }),
  ringGraph: Object.freeze({ levels: 7, tiles: 469, rootSpanMetres: 16384, tilesByLod: Object.freeze([256, 64, 64, 64, 16, 4, 1]) }),
  /* the 8 x 8 frontier preloaded: the middle of level zero. Every hole, the range and the farm lie inside it */
  expectedFrontierBoundsEpsg5845: Object.freeze({ minEasting: 668106.5, minNorthing: 6610226.5, maxEasting: 670154.5, maxNorthing: 6612274.5 }),
  canonicalOrigin: Object.freeze({ easting: 669130.5, northing: 6611250.5, heightRH2000: 21.75 }),
  legacyOriginEpsg3006: Object.freeze({ easting: 669130.5, northing: 6611250.5 }),
  packOriginWgs84: Object.freeze({ latitude: 59.60510013186263, longitude: 17.997252241795543 }),
  packMetresPerLongitude: 56323.13,
  packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E669130.5 N6611250.5; heights RH 2000',
  bridgeMode: 'epsg3006-local-rh2000', expectedTileCount: 64, expectedSurfaceTileCount: 0,
  surfacePolicy: 'legacy-ground-atlas',
  legacyCoreCutout: Object.freeze({
    guardCells: 2, guardMetres: 8,
    expectedCoreGrid: Object.freeze({ dx: 4, x0: -720, x1: 720, z0: -972, z1: 900, nx: 361, nz: 469 }),
    expectedSkippedBasePoints: 164365, expectedTotalBasePoints: 169309,
  }),
});

export const TJUSTA_V2_CONFIGS = Object.freeze({
  tjusta: TJUSTA_V2_CONFIG,
});
