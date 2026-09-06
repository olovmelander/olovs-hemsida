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
  expectedBoundsEpsg5845: Object.freeze({
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
