/* Bro Hof Slott's two routings on one ground. The packs are authored directly on the SWEREF 99 TM grid
 * (local metres from EPSG:3006, RH 2000 heights), so the bridge is an exact offset and no datum is fitted.
 * DERIVED values come from packages/course-v2/bro-hof-ground-rings.mjs, bootstrap-terrain.mjs (frame) and
 * planV2LegacyCutout on each pack's own CORE grid. Independent survey approval remains pending. */
const SHARED = Object.freeze({
  groundId: 'bro-hof',
  frameFingerprint: 'c4b165ba2fa965cb58fcfe59c4bf410c48f03a00bc9cc5c9d23574b93bdc88d0',
  expectedBoundsEpsg5845: Object.freeze({ minEasting: 640902.5, minNorthing: 6590376.5, maxEasting: 657286.5, maxNorthing: 6606760.5 }),
  ringGraph: Object.freeze({ levels: 7, tiles: 469, rootSpanMetres: 16384, tilesByLod: Object.freeze([256, 64, 64, 64, 16, 4, 1]) }),
  /* the 8 x 8 frontier preloaded: the middle of level zero. Every hole of both courses, and the range, lies inside it */
  expectedFrontierBoundsEpsg5845: Object.freeze({ minEasting: 648070.5, minNorthing: 6597544.5, maxEasting: 650118.5, maxNorthing: 6599592.5 }),
  canonicalOrigin: Object.freeze({ easting: 649094.5, northing: 6598568.5, heightRH2000: 4.76 }),
  legacyOriginEpsg3006: Object.freeze({ easting: 649094.5, northing: 6598568.5 }),
  packOriginWgs84: Object.freeze({ latitude: 59.49897348570647, longitude: 17.633748664771936 }),
  packMetresPerLongitude: 56500.89,
  packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E649094.5 N6598568.5; heights RH 2000',
  bridgeMode: 'epsg3006-local-rh2000', expectedTileCount: 64, expectedSurfaceTileCount: 0,
  surfacePolicy: 'legacy-ground-atlas',
});

export const BRO_HOF_STADIUM_V2_CONFIG = Object.freeze({
  slug: 'bro-hof-stadium',
  label: 'Bro Hof Slott · Stadium · Lantmäteriet 1 m terräng',
  ...SHARED,
  legacyCoreCutout: Object.freeze({
    guardCells: 2, guardMetres: 8,
    expectedCoreGrid: Object.freeze({ dx: 4, x0: -1080, x1: 1080, z0: -900, z1: 1152, nx: 541, nz: 514 }),
    expectedSkippedBasePoints: 241332, expectedTotalBasePoints: 278074,
  }),
});

/* The same ground and frontier; its own CORE, since the Castle's holes end 170 m further north. */
export const BRO_HOF_CASTLE_V2_CONFIG = Object.freeze({
  slug: 'bro-hof-castle',
  label: 'Bro Hof Slott · Castle · Lantmäteriet 1 m terräng',
  ...SHARED,
  legacyCoreCutout: Object.freeze({
    guardCells: 2, guardMetres: 8,
    expectedCoreGrid: Object.freeze({ dx: 4, x0: -1080, x1: 1080, z0: -900, z1: 972, nx: 541, nz: 469 }),
    expectedSkippedBasePoints: 234741, expectedTotalBasePoints: 253729,
  }),
});

export const BRO_HOF_V2_CONFIGS = Object.freeze({
  'bro-hof-stadium': BRO_HOF_STADIUM_V2_CONFIG,
  'bro-hof-castle': BRO_HOF_CASTLE_V2_CONFIG,
});
