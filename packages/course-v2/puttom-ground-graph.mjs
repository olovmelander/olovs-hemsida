import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { alignTerrainGridExtent } from './terrain-compiler-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

/* The full-AOI graph window is derived from constants that are already
   reviewed and committed: the post-normalisation CORE contract gives the
   required course extent in the legacy frame, the legacy EPSG:3006 origin
   projects it, and the retained preview's north-west sample anchors the tile
   lattice so the verified frontier is an exact subgrid of this graph. Since
   the widening that frontier IS the graph's own finest level -- 8 x 8 tiles at
   the AOI origin -- rather than a 4 x 4 window inside it.
   The expected outcome is pinned so source or code drift fails loudly. */
export const PUTTOM_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'puttom',
  courseSlug: 'puttom',
  expectedSourceItemId: '702_69',
  holeTileBufferMetres: 80,
  tileSegments: 256,
  sampleSpacingMetres: 1,
  expectedAligned: Object.freeze({
    originEasting: 696404.5,
    originNorthing: 7025850.5,
    tilesX: 8,
    tilesY: 8,
    width: 2049,
    height: 2049,
  }),
  expectedProjwin: Object.freeze({
    west: 696404,
    north: 7025851,
    east: 698453,
    south: 7023802,
  }),
  /* Where the committed preview's north-west tile sits in the AOI lattice.
     This was { column: 2, row: 1 } and described the retired 1024 m pilot; the
     widening moved the preview to the AOI origin and left the constant behind,
     which is what has failed every CI run since. It stays a REVIEWED constant
     rather than being derived from the preview it checks -- a gate that reads
     its expectation out of its subject cannot fail -- but the assertion now
     also refuses an offset the lattice cannot hold, which is arithmetic and
     would have named this immediately: 2 + 8 > 8. */
  previewLatticeOffset: Object.freeze({ column: 0, row: 0 }),
  expectedCompile: Object.freeze({
    levels: 4,
    tileChunks: 85,
    uniqueChunks: 86,
    rootTiles: 1,
  }),
  /* gdal_translate -projwin only WARNS when the requested window leaves the
     source item's extent: it pads instead, and the padding is either nodata or
     — when the band declares none — a real 0 m RH2000 plane. Both survive the
     window/geotransform checks, and the identity gate only covers the interior
     preview subgrid, so coverage is asserted separately. Puttom's ground runs
     37-71 m over the retained window; this band is wide enough for the doubled
     AOI's own relief and far from any padded plane. */
  coverageGate: Object.freeze({
    requireDeclaredNoDataValue: true,
    requireEverySampleFinite: true,
    minimumHeightRH2000: 10,
    maximumHeightRH2000: 200,
  }),
  identityGate: Object.freeze({
    maximumAbsoluteDifferenceMetres: 0.0101,
    minimumExactFraction: 0.999,
  }),
});

export function puttomRequiredBoundsEpsg3006() {
  const origin = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006;
  const core = PUTTOM_PREVIEW_CONFIG.legacyCoreCutout.expectedCoreGrid;
  return Object.freeze({
    minEasting: origin.easting + core.x0,
    maxEasting: origin.easting + core.x1,
    minNorthing: origin.northing - core.z1,
    maxNorthing: origin.northing - core.z0,
  });
}

export function puttomAlignedExtent() {
  const aligned = alignTerrainGridExtent({
    requiredBounds: puttomRequiredBoundsEpsg3006(),
    sourceOriginEasting: PUTTOM_PREVIEW_CONFIG.expectedBoundsEpsg5845.minEasting,
    sourceOriginNorthing: PUTTOM_PREVIEW_CONFIG.expectedBoundsEpsg5845.maxNorthing,
    sampleSpacingMetres: PUTTOM_GROUND_GRAPH_CONFIG.sampleSpacingMetres,
    tileSegments: PUTTOM_GROUND_GRAPH_CONFIG.tileSegments,
  });
  const expected = PUTTOM_GROUND_GRAPH_CONFIG.expectedAligned;
  for (const [field, value] of Object.entries(expected)) {
    if (aligned[field] !== value) {
      throw new Error(`aligned Puttom extent ${field} is ${aligned[field]}; reviewed value is ${value}`);
    }
  }
  /* projwin takes pixel EDGES while the lattice is stated in sample CENTRES,
     so each side moves out by half a sample and the span is the sample COUNT
     times the spacing. Derived from the spacing rather than a 1 m literal. */
  const spacing = aligned.sampleSpacingMetres;
  const west = aligned.originEasting - spacing / 2;
  const north = aligned.originNorthing + spacing / 2;
  const projwin = Object.freeze({
    west,
    north,
    east: west + aligned.width * spacing,
    south: north - aligned.height * spacing,
  });
  for (const [field, value] of Object.entries(PUTTOM_GROUND_GRAPH_CONFIG.expectedProjwin)) {
    if (projwin[field] !== value) {
      throw new Error(`aligned Puttom projwin ${field} is ${projwin[field]}; reviewed value is ${value}`);
    }
  }
  return Object.freeze({ ...aligned, projwin });
}

/* Reassemble the finest compiled level into one decoded master grid so the
   retained preview can be compared sample-for-sample by index arithmetic,
   without any interpolation or NaN spreading. */
export function decodeFinestLevel(pyramid) {
  const level = pyramid?.levels?.[0];
  if (!level?.tiles?.length) throw new TypeError('a compiled terrain pyramid is required');
  const width = level.tilesX * level.tileSegments + 1;
  const height = level.tilesY * level.tileSegments + 1;
  const heights = new Float64Array(width * height).fill(Number.NaN);
  for (const tile of level.tiles) {
    const decoded = decodeTerrainGrid(tile.payload, tile.grid);
    const columnOffset = tile.column * level.tileSegments;
    const rowOffset = tile.row * level.tileSegments;
    for (let row = 0; row < tile.grid.height; row++) {
      const target = (rowOffset + row) * width + columnOffset;
      heights.set(decoded.subarray(row * tile.grid.width, (row + 1) * tile.grid.width), target);
    }
  }
  return Object.freeze({
    originEasting: pyramid.originEasting,
    originNorthing: pyramid.originNorthing,
    sampleSpacingMetres: level.sampleSpacingMetres,
    width,
    height,
    heights,
  });
}

/**
 * Compare decoded retained-preview tiles against the decoded finest level of
 * a larger compilation covering the same ground. Both sides quantize the same
 * source to the same 1 cm lattice from different offsets, so agreement means
 * exact equality except for float-noise ties at a quantization boundary,
 * which may differ by exactly one quantum and are counted separately.
 */
export function comparePreviewToMaster(previewTiles, master) {
  if (!Array.isArray(previewTiles) || !previewTiles.length) {
    throw new TypeError('decoded preview tiles are required');
  }
  let samples = 0;
  let exactlyEqual = 0;
  let offByOneQuantum = 0;
  let noDataMismatches = 0;
  let maximumAbsoluteDifferenceMetres = 0;
  for (const tile of previewTiles) {
    const { bounds, grid, heights } = tile;
    for (let row = 0; row < grid.height; row++) {
      const northing = bounds.maxNorthing - row * grid.sampleSpacingMetres;
      const masterRow = Math.round((master.originNorthing - northing) / master.sampleSpacingMetres);
      for (let column = 0; column < grid.width; column++) {
        const easting = bounds.minEasting + column * grid.sampleSpacingMetres;
        const masterColumn = Math.round((easting - master.originEasting) / master.sampleSpacingMetres);
        if (masterRow < 0 || masterColumn < 0 ||
            masterRow >= master.height || masterColumn >= master.width) {
          throw new Error(`preview sample ${easting},${northing} lies outside the compiled master`);
        }
        const previewValue = heights[row * grid.width + column];
        const masterValue = master.heights[masterRow * master.width + masterColumn];
        samples++;
        if (Number.isNaN(previewValue) || Number.isNaN(masterValue)) {
          if (Number.isNaN(previewValue) !== Number.isNaN(masterValue)) noDataMismatches++;
          else exactlyEqual++;
          continue;
        }
        const difference = Math.abs(previewValue - masterValue);
        maximumAbsoluteDifferenceMetres = Math.max(maximumAbsoluteDifferenceMetres, difference);
        if (difference === 0) exactlyEqual++;
        else if (difference < 0.0101) offByOneQuantum++;
      }
    }
  }
  return Object.freeze({
    samples,
    exactlyEqual,
    offByOneQuantum,
    noDataMismatches,
    maximumAbsoluteDifferenceMetres,
    exactFraction: samples ? exactlyEqual / samples : 0,
  });
}

/**
 * Prove the compiled AOI is real source everywhere, not GDAL padding. The
 * window and geotransform checks cannot see padding — the raster still has the
 * requested size and origin — so this reads the compiled data itself: every
 * sample finite, and the whole height range inside a reviewed plausibility
 * band that a padded 0 m plane cannot satisfy. A band with no declared nodata
 * is refused because that is exactly the case where padding turns into
 * indistinguishable real-looking zeros.
 */
export function assertFullSourceCoverage({ stats, pyramid, noDataValue },
  gate = PUTTOM_GROUND_GRAPH_CONFIG.coverageGate) {
  if (gate.requireDeclaredNoDataValue && !Number.isFinite(noDataValue)) {
    throw new Error('terrain source coverage gate: the raster band declares no nodata value, so padding outside the source extent would be indistinguishable from real ground');
  }
  if (!Number.isSafeInteger(stats?.sourceSamples) || stats.sourceSamples < 1 ||
      !Number.isSafeInteger(stats?.finiteSamples)) {
    throw new TypeError('terrain source coverage gate needs compiled sample statistics');
  }
  if (gate.requireEverySampleFinite && stats.finiteSamples !== stats.sourceSamples) {
    throw new Error(`terrain source coverage gate: ${
      stats.sourceSamples - stats.finiteSamples} of ${stats.sourceSamples} samples are nodata; the requested window may leave the source item`);
  }
  const minimum = pyramid?.sourceMinimumHeightRH2000;
  const maximum = pyramid?.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new TypeError('terrain source coverage gate needs compiled height extremes');
  }
  if (minimum < gate.minimumHeightRH2000 || maximum > gate.maximumHeightRH2000) {
    throw new Error(`terrain source coverage gate: compiled RH 2000 range ${minimum}-${maximum} m leaves the reviewed ${
      gate.minimumHeightRH2000}-${gate.maximumHeightRH2000} m band for this ground`);
  }
  return Object.freeze({
    sourceSamples: stats.sourceSamples,
    finiteSamples: stats.finiteSamples,
    noDataValue,
    minimumHeightRH2000: minimum,
    maximumHeightRH2000: maximum,
  });
}

export function assertPreviewIdentity(comparison, gate = PUTTOM_GROUND_GRAPH_CONFIG.identityGate) {
  if (!Number.isSafeInteger(comparison?.samples) || comparison.samples < 1) {
    throw new Error('preview identity comparison covered no samples');
  }
  if (comparison.noDataMismatches !== 0) {
    throw new Error(`preview identity gate: ${comparison.noDataMismatches} no-data mismatches`);
  }
  if (!(comparison.maximumAbsoluteDifferenceMetres <= gate.maximumAbsoluteDifferenceMetres)) {
    throw new Error(`preview identity gate: maximum difference ${
      comparison.maximumAbsoluteDifferenceMetres} m exceeds ${gate.maximumAbsoluteDifferenceMetres} m`);
  }
  if (!(comparison.exactFraction >= gate.minimumExactFraction)) {
    throw new Error(`preview identity gate: only ${(comparison.exactFraction * 100).toFixed(3)}% exact`);
  }
  return comparison;
}
