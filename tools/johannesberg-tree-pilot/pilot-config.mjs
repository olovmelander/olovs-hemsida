/* The Johannesberg tree pilot's fixed inputs: one physical ground (routings
   johannesberg and johannesberg-9), the inner 2,048 m detailed frontier, the
   re-pinned laser items over it and the orthophoto items, and where raw bytes
   and committed evidence go. Every script of the pilot reads these instead of
   carrying its own copy, so a second ground needs a second config, not edits
   scattered through the scripts. Paths are repository-relative.             */
export const PILOT = Object.freeze({
  groundId: 'johannesberg',
  courseSlugs: Object.freeze(['johannesberg', 'johannesberg-9']),
  reviewId: 'review-2026-11-08',
  reviewDir: 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08',
  /* the published ground's 2,048 m reviewed frontier (64 finest tiles) */
  innerWindow: Object.freeze({ minEasting: 678403.5, minNorthing: 6624276.5, maxEasting: 680451.5, maxNorthing: 6626324.5 }),
  haloMetres: 60,
  chmCellMetres: 0.5,
  laserCampaigns: 'geo_data/course-v2/johannesberg/acquisition/laser-campaigns-2026-11-08.json',
  laserItems: Object.freeze(['21c039-66225_6775_25', '21c039-66225_6800_25', '21c039-66250_6775_25', '21c039-66250_6800_25']),
  cacheDir: 'johannesbergbuild/cache/trees-2026-11-08',
  copcCache: 'johannesbergbuild/cache/trees-2026-11-08/copc',
  rasterDir: 'johannesbergbuild/cache/trees-2026-11-08/rasters',
  orthoCache: 'johannesbergbuild/cache/trees-2026-11-08/ortho',
  /* orthophoto campaigns over the window, all four 2.5 km items each; band
     order is verified from the TIFF tags at fetch time, never assumed */
  orthoCampaigns: Object.freeze([
    Object.freeze({ key: '2025', collection: 'orto-o2-2025', suffix: 'mr25', date: '2025-06-14', season: 'leaf-on' }),
    Object.freeze({ key: '2021', collection: 'orto-o2-2021', suffix: 'mr21', date: '2021-04-18', season: 'leaf-off' }),
  ]),
  orthoItems: Object.freeze(['66225_6775_25', '66225_6800_25', '66250_6775_25', '66250_6800_25']),
  /* the published terrain trees stand on */
  publicDir: 'apps/golf/public',
  auditCarryForward: null,
});

export function haloWindow(config = PILOT) {
  const { innerWindow: w, haloMetres: h } = config;
  return Object.freeze({ minEasting: w.minEasting - h, minNorthing: w.minNorthing - h, maxEasting: w.maxEasting + h, maxNorthing: w.maxNorthing + h });
}

/** The CHM lattice over the halo window: cell edges on the window bounds. */
export function chmGrid(config = PILOT) {
  const window = haloWindow(config);
  const cell = config.chmCellMetres;
  return Object.freeze({
    minEasting: window.minEasting,
    maxNorthing: window.maxNorthing,
    width: Math.round((window.maxEasting - window.minEasting) / cell),
    height: Math.round((window.maxNorthing - window.minNorthing) / cell),
    sampleSpacingMetres: cell,
  });
}
