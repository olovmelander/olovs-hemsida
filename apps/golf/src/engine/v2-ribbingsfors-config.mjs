/* Reviewed live contract for the Ribbingsfors graph frontier.

   Unlike the retained Puttom pilot, this GPK1 pack was authored directly in
   the canonical EPSG:3006 grid frame. Its local x/z coordinates are therefore
   exactly easting-originEasting / originNorthing-northing: no meridian-
   convergence rotation, scale fit or vertical datum fit belongs in the
   bridge. Keeping every reviewed number here makes a regenerated graph or a
   changed compatibility pack fail before it can cut the legacy CORE. */
export const RIBBINGSFORS_V2_CONFIG = Object.freeze({
  slug: 'ribbingsfors',
  groundId: 'ribbingsfors',
  label: 'Ribbingsfors Golf & Kultur · Lantmäteriet 1 m terräng',
  frameFingerprint: '5d616311e246c109899b52223af5ed4a68f372f9b923787d6c0354b33b2c968f',
  /* DERIVED from the ring spec (ribbingsfors-ground-rings.mjs): the 16 km root of the
     standard ring graph, which the ground manifest's bounds must reproduce. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 440783.5,
    minNorthing: 6527832.5,
    maxEasting: 457167.5,
    maxNorthing: 6544216.5,
  }),
  /* DERIVED from the published ground manifest: seven levels, 469 tiles on the
     STANDARD topology, a parent link on every one but the root, reaching
     16,384 m. Declaring ringGraph is what makes check-course-v2 assert that the
     graph ACTUALLY SERVES rather than the fixed frontier. */
  ringGraph: Object.freeze({
    levels: 7,
    tiles: 469,
    rootSpanMetres: 16384,
    tilesByLod: Object.freeze({ 0: 256, 1: 64, 2: 64, 3: 64, 4: 16, 5: 4, 6: 1 }),
  }),
  /* REVIEWED — the 8 x 8 frontier the app PRELOADS: the reviewed 2,048 m
     window, now the middle of the standard's sixteen-wide level zero, not the
     whole 256-tile level. */
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 447951.5,
    minNorthing: 6535000.5,
    maxEasting: 449999.5,
    maxNorthing: 6537048.5,
  }),
  canonicalOrigin: Object.freeze({
    easting: 448975.5,
    northing: 6536024.5,
    heightRH2000: 69.14,
  }),
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
  legacyOriginEpsg3006: Object.freeze({ easting: 448975.5, northing: 6536024.5 }),
  packOriginWgs84: Object.freeze({
    latitude: 58.9607905493,
    longitude: 14.1128725388,
  }),
  packMetresPerLongitude: 57399.32,
  packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E448975.5 N6536024.5; heights RH 2000',
  bridgeMode: 'epsg3006-local-rh2000',
  expectedTileCount: 64,
  expectedSurfaceTileCount: 0,
  surfacePolicy: 'legacy-ground-atlas',
  /* MEASURED (ribbingsforsbuild/frontier-edge-step.mjs, 2026-09-10): the pack's
     4 m HF0 is cut from the same laser item as the tiles and agrees with them
     to 0.05 m everywhere inside the window -- but HF0 ends exactly at the
     window's edge, so the legacy MID mesh outside it reads the 32 m HF1
     alone: median 0.02 m off the 1 m tiles along the edge, MAD 0.25 m, p05/p95
     -0.81/+0.97 m, worst 3.10 m. Presentation only, Johannesberg's six MID
     cells: the legacy heights ease onto the frontier's own edge over 72 m and
     no measured sample inside the window is altered. Declaring it also gives
     the surroundings the frontier's decorated material, which is the half the
     owner's phone saw -- a square whose colour did not match the world. */
  legacyBoundaryBlendMetres: 72,
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -468,
      x1: 864,
      z0: -612,
      z1: 540,
      nx: 334,
      nz: 289,
    }),
    /* CORE is playB +- 150 m snapped to 36, and playB takes scenery.range, so
       every re-measurement of the practice ground moves it. Read off the
       assertion's own "got" line, never typed. 316 x 298 (90,520 / 94,168,
       x -468..792, z -612..576) with the GolfTraxx seed routes; 307 x 289
       (85,183 / 88,723, x -468..756) once the routes were traced by rule; and
       334 x 289 now the range is the pasture EAST of the 1st reaching x 715
       rather than a dormant strip at x 435 */
    expectedSkippedBasePoints: 92_824,
    expectedTotalBasePoints: 96_526,
  }),
});

export const V2_GRAPH_FRONTIER_CONFIGS = Object.freeze({
  [RIBBINGSFORS_V2_CONFIG.slug]: RIBBINGSFORS_V2_CONFIG,
});
