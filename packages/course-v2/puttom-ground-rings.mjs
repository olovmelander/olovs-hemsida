/* The nested resolution rings that make Puttom's v2 ground the ONLY ground:
   1 m over the course, 2 m to 1.5 km, 4 m to 3 km, 8 m to 6 km, and 16 m
   and coarser to a 16 km root, all cut from Lantmäteriet's Markhöjdmodell so
   nothing is ever stitched to the Terrarium field.

   Every origin is a whole number of the finer level's tile spans from that
   level's origin (checked by the compiler), so each tile lies inside one
   tile of the next coarser level. The course level keeps the published
   tiles byte for byte; the compiler asserts they decode to what it would
   have compiled from the same DTM.                                          */

const FRAME_ORIGIN = Object.freeze({ easting: 697428.5, northing: 7024826.5 });

function centred(halfSpan) {
  return { originEasting: FRAME_ORIGIN.easting - halfSpan, originNorthing: FRAME_ORIGIN.northing + halfSpan };
}

export const PUTTOM_GROUND_RINGS = Object.freeze({
  groundId: 'puttom',
  courseSlugs: Object.freeze(['puttom']),
  tileSegments: 256,
  /* Lantmäteriet dtm-cog items are 10 km squares named <northing/10 km>_<easting/10 km> */
  dtm: Object.freeze({
    collection: 'dtm-cog',
    hrefTemplate: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif',
    itemMetres: 10000,
  }),
  levels: Object.freeze([
    /* lod, spacing, tiles per side, quantisation, and where the samples come from.
       Every ring is eight tiles wide, so each finer ring is exactly the middle
       four tiles of the next coarser one: a coarser tile is then either
       wholly covered by finer tiles or not at all. The first cut used six-wide
       rings, and a coarser tile at a ring's edge was covered by finer tiles
       on one half only -- when the planner refined it, the other half was
       drawn by nothing, and the sky showed through the ground in
       tile-shaped plates with the trees and lakes floating over the gap. */
    Object.freeze({ lod: 0, sampleSpacingMetres: 1, tilesPerSide: 8, heightScaleMetres: 0.01, ...centred(1024), source: Object.freeze({ kind: 'published-and-dtm', factor: 1, subsample: 1 }) }),
    Object.freeze({ lod: 1, sampleSpacingMetres: 2, tilesPerSide: 8, heightScaleMetres: 0.02, ...centred(2048), source: Object.freeze({ kind: 'dtm', factor: 1, subsample: 2 }) }),
    Object.freeze({ lod: 2, sampleSpacingMetres: 4, tilesPerSide: 8, heightScaleMetres: 0.04, ...centred(4096), source: Object.freeze({ kind: 'dtm', factor: 4, subsample: 1 }) }),
    Object.freeze({ lod: 3, sampleSpacingMetres: 8, tilesPerSide: 8, heightScaleMetres: 0.08, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 8, subsample: 1 }) }),
    Object.freeze({ lod: 4, sampleSpacingMetres: 16, tilesPerSide: 4, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 16, subsample: 1 }) }),
    Object.freeze({ lod: 5, sampleSpacingMetres: 32, tilesPerSide: 2, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 1 }) }),
    Object.freeze({ lod: 6, sampleSpacingMetres: 64, tilesPerSide: 1, heightScaleMetres: 0.16, ...centred(8192), source: Object.freeze({ kind: 'dtm', factor: 32, subsample: 2 }) }),
  ]),
  /* a healthy compile lands inside this band: Puttom's ground runs 26-103 m
     over the course and the 16 km square reaches the coast to the south-east */
  coverageGate: Object.freeze({ minimumHeightRH2000: -5, maximumHeightRH2000: 400, requireEverySampleFinite: true }),
});

export function ringLevelExtent(level, tileSegments = PUTTOM_GROUND_RINGS.tileSegments) {
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
export function dtmItemsFor(level, { tileSegments = PUTTOM_GROUND_RINGS.tileSegments, itemMetres = PUTTOM_GROUND_RINGS.dtm.itemMetres } = {}) {
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
      href: PUTTOM_GROUND_RINGS.dtm.hrefTemplate.replace('{dir}', dir).replace('{item}', item),
      minEasting: e * itemMetres,
      maxEasting: (e + 1) * itemMetres,
      minNorthing: n * itemMetres,
      maxNorthing: (n + 1) * itemMetres,
    }));
  }
  return Object.freeze(items);
}
