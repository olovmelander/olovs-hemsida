/* THE ONE RING TOPOLOGY EVERY GROUND SHARES.

   Every course in the app works the same way and is the same size: a 16 km
   root (16,384 x 16,384 m) in seven nested levels, cut from Lantmäteriet's
   Markhöjdmodell and nothing else, with the 1 m level covering the whole
   central 4,096 m -- the course, the practice ground and the near
   surroundings the LiDAR vegetation is measured over -- and each coarser
   ring exactly the middle four tiles of the next one out:

     lod  spacing  tiles/side   span     source
      0     1 m       16       4,096 m   the published course tiles + the DTM at factor 1
      1     2 m        8       4,096 m   the 1 m data subsampled at even positions
      2     4 m        8       8,192 m   the averaged 4x overview
      3     8 m        8      16,384 m   the averaged 8x overview
      4    16 m        4      16,384 m   the averaged 16x overview
      5    32 m        2      16,384 m   the averaged 32x overview
      6    64 m        1      16,384 m   the 32x overview subsampled: the root

   469 tiles, all but the root carrying an explicit parent. This is Ängsö's
   topology (the first ground whose course was longer than 2 km), and it is
   now every ground's, by the owner's decision of 2026-09-11: the four grounds
   whose 1 m level used to be eight tiles per side (Puttom, Upsala,
   Veckefjärden, Lidingö) keep their published 64 tiles in the middle of a
   sixteen-wide level and gain 192 around them; Tortuna's 4 km pyramid gains
   the rings; Johannesberg and Ribbingsfors leave their fixed frontiers.

   Two rules the topology carries and that must not be edited apart:

   - Level 1 spans the SAME square as level 0 rather than twice it, because
     level 0 is already sixteen tiles wide. Every level-1 tile still has
     exactly four level-0 children, which is the rule that matters: the
     runtime replaces a coarse tile by its children and draws nothing where
     they are missing, so a coarse tile half covered by finer ones opens a
     hole the size of its other half (Puttom's first cut, six-wide rings, sky
     through the ground in tile-shaped plates). Do not narrow any ring.
   - The whole graph is centred on ONE point, the ground's reviewed frame
     centre, and the level-0 lattice must be the lattice the course tiles
     were published on -- publish-ground-rings carries every published 1 m
     tile across and asserts that it decodes to what it compiled from the
     same DTM. The centre is the only number a ground supplies.

   What a ground still owns: its centre, its course slugs and their migration
   models, its measured coverage band, its own terrain source ids, and -- on
   a coast -- its sea-fill rule. Everything else here is the standard. */

const TILE_SEGMENTS = 256;

export const STANDARD_RING_LEVELS = Object.freeze([
  /* lod, spacing, tiles per side, quantisation, half span about the centre, source */
  Object.freeze({ lod: 0, sampleSpacingMetres: 1, tilesPerSide: 16, heightScaleMetres: 0.01, halfSpan: 2048, source: Object.freeze({ kind: 'published-and-dtm', factor: 1, subsample: 1 }) }),
  Object.freeze({ lod: 1, sampleSpacingMetres: 2, tilesPerSide: 8, heightScaleMetres: 0.02, halfSpan: 2048, source: Object.freeze({ kind: 'dtm', factor: 1, subsample: 2 }) }),
  Object.freeze({ lod: 2, sampleSpacingMetres: 4, tilesPerSide: 8, heightScaleMetres: 0.04, halfSpan: 4096, source: Object.freeze({ kind: 'dtm', factor: 4, subsample: 1 }) }),
  Object.freeze({ lod: 3, sampleSpacingMetres: 8, tilesPerSide: 8, heightScaleMetres: 0.08, halfSpan: 8192, source: Object.freeze({ kind: 'dtm', factor: 8, subsample: 1 }) }),
  Object.freeze({ lod: 4, sampleSpacingMetres: 16, tilesPerSide: 4, heightScaleMetres: 0.16, halfSpan: 8192, source: Object.freeze({ kind: 'dtm', factor: 16, subsample: 1 }) }),
  Object.freeze({ lod: 5, sampleSpacingMetres: 32, tilesPerSide: 2, heightScaleMetres: 0.16, halfSpan: 8192, source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 1 }) }),
  Object.freeze({ lod: 6, sampleSpacingMetres: 64, tilesPerSide: 1, heightScaleMetres: 0.16, halfSpan: 8192, source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 2 }) }),
]);

/* The tile count the standard produces, per level and in all: what every
   ring-graph contract's `ringGraph` pins. */
export const STANDARD_TILES_BY_LOD = Object.freeze(Object.fromEntries(STANDARD_RING_LEVELS.map(level => [level.lod, level.tilesPerSide * level.tilesPerSide])));
export const STANDARD_TILE_COUNT = STANDARD_RING_LEVELS.reduce((sum, level) => sum + level.tilesPerSide * level.tilesPerSide, 0);
export const STANDARD_ROOT_SPAN_METRES = STANDARD_RING_LEVELS.at(-1).tilesPerSide * TILE_SEGMENTS * STANDARD_RING_LEVELS.at(-1).sampleSpacingMetres;
export const STANDARD_LEVEL0_SPAN_METRES = STANDARD_RING_LEVELS[0].tilesPerSide * TILE_SEGMENTS * STANDARD_RING_LEVELS[0].sampleSpacingMetres;

/* Lantmäteriet dtm-cog items are 10 km squares named <northing/10 km>_<easting/10 km> */
export const LANTMATERIET_DTM = Object.freeze({
  collection: 'dtm-cog',
  hrefTemplate: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif',
  itemMetres: 10000,
});

function finiteHalfMetre(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  /* every level's samples sit on the metre lattice's centres (x.5), so the
     centre of a whole number of 256 m tiles is itself an x.5 coordinate */
  if (Math.abs(value - Math.floor(value) - 0.5) > 1e-9) throw new RangeError(`${label} must sit on a sample centre (n + 0.5); got ${value}`);
  return value;
}

/**
 * A ground's ring specification on the standard topology.
 *
 * @param {object} ground
 * @param {string} ground.groundId
 * @param {string[]} ground.courseSlugs
 * @param {object} ground.courseModels  slug -> { migration, strokeIndexStatus }
 * @param {{easting:number, northing:number}} ground.centre  the frame centre, on sample centres
 * @param {object} ground.coverageGate  the ground's MEASURED plausibility band
 * @param {string[]} [ground.terrainSourceIds]  the source-manifest ids the rings derive from
 * @param {object} [ground.seaFill]  a coast's reviewed nodata-fill rule
 * @param {number} [ground.holeTileBufferMetres]  how far round a hole line its course manifest lists finest tiles (emit-ground-graph's own 80 m default)
 * @param {string} [ground.notes]  free text kept beside the spec
 */
export function standardGroundRings({ groundId, courseSlugs, courseModels, centre, coverageGate, terrainSourceIds, seaFill, holeTileBufferMetres, notes } = {}) {
  if (typeof groundId !== 'string' || !groundId) throw new TypeError('groundId is required');
  if (!Array.isArray(courseSlugs) || !courseSlugs.length) throw new TypeError(`${groundId}: courseSlugs must be a non-empty array`);
  if (!courseModels || courseSlugs.some(slug => !courseModels[slug]?.migration)) {
    throw new TypeError(`${groundId}: every course slug needs a courseModels entry naming its migration file`);
  }
  const easting = finiteHalfMetre(centre?.easting, `${groundId}: centre.easting`);
  const northing = finiteHalfMetre(centre?.northing, `${groundId}: centre.northing`);
  if (!coverageGate || !Number.isFinite(coverageGate.minimumHeightRH2000) || !Number.isFinite(coverageGate.maximumHeightRH2000) ||
      coverageGate.requireEverySampleFinite !== true) {
    throw new TypeError(`${groundId}: coverageGate needs a finite height band and requireEverySampleFinite: true`);
  }
  const levels = Object.freeze(STANDARD_RING_LEVELS.map(({ halfSpan, ...level }) => Object.freeze({
    ...level,
    originEasting: easting - halfSpan,
    originNorthing: northing + halfSpan,
  })));
  const spec = {
    groundId,
    courseSlugs: Object.freeze([...courseSlugs]),
    courseModels: Object.freeze(Object.fromEntries(Object.entries(courseModels).map(([slug, model]) => [slug, Object.freeze({ ...model })]))),
    centre: Object.freeze({ easting, northing }),
    tileSegments: TILE_SEGMENTS,
    dtm: LANTMATERIET_DTM,
    levels,
    coverageGate: Object.freeze({ ...coverageGate }),
  };
  if (terrainSourceIds) spec.terrainSourceIds = Object.freeze([...terrainSourceIds]);
  if (seaFill) spec.seaFill = Object.freeze({ ...seaFill });
  if (holeTileBufferMetres !== undefined) {
    if (!Number.isFinite(holeTileBufferMetres) || holeTileBufferMetres < 0) throw new RangeError(`${groundId}: holeTileBufferMetres must be a non-negative number`);
    spec.holeTileBufferMetres = holeTileBufferMetres;
  }
  if (notes) spec.notes = notes;
  return Object.freeze(spec);
}

/** A level's extent on the ground, from its origin and size. */
export function ringLevelExtent(level, tileSegments = TILE_SEGMENTS) {
  const span = level.tilesPerSide * tileSegments * level.sampleSpacingMetres;
  return Object.freeze({
    minEasting: level.originEasting,
    maxEasting: level.originEasting + span,
    maxNorthing: level.originNorthing,
    minNorthing: level.originNorthing - span,
    spanMetres: span,
    size: level.tilesPerSide * tileSegments + 1,
  });
}

/** The DTM items (10 km squares) a level's extent touches. */
export function dtmItemsFor(level, { tileSegments = TILE_SEGMENTS, itemMetres = LANTMATERIET_DTM.itemMetres, hrefTemplate = LANTMATERIET_DTM.hrefTemplate } = {}) {
  const extent = ringLevelExtent(level, tileSegments);
  const items = [];
  const e0 = Math.floor(extent.minEasting / itemMetres);
  const e1 = Math.floor((extent.maxEasting - 1e-6) / itemMetres);
  const n0 = Math.floor(extent.minNorthing / itemMetres);
  const n1 = Math.floor((extent.maxNorthing - 1e-6) / itemMetres);
  for (let n = n0; n <= n1; n++) for (let e = e0; e <= e1; e++) {
    const item = `${n}_${e}`;
    const dir = `${String(n).slice(0, 2)}_${String(e).slice(0, 1)}`;
    items.push(Object.freeze({
      id: item,
      dir,
      href: hrefTemplate.replace('{dir}', dir).replace('{item}', item),
      minEasting: e * itemMetres,
      maxEasting: (e + 1) * itemMetres,
      minNorthing: n * itemMetres,
      maxNorthing: (n + 1) * itemMetres,
    }));
  }
  return Object.freeze(items);
}

/** The `ringGraph` block a v2 contract pins for a ground on the standard. */
export function standardRingGraphContract() {
  return Object.freeze({
    levels: STANDARD_RING_LEVELS.length,
    tiles: STANDARD_TILE_COUNT,
    rootSpanMetres: STANDARD_ROOT_SPAN_METRES,
    tilesByLod: STANDARD_TILES_BY_LOD,
  });
}
