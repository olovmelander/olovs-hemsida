import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PUTTOM_GROUND_GRAPH_CONFIG,
  assertFullSourceCoverage,
  assertPreviewIdentity,
  comparePreviewToMaster,
  decodeFinestLevel,
  puttomAlignedExtent,
  puttomRequiredBoundsEpsg3006,
} from './puttom-ground-graph.mjs';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

const ORIGIN_EASTING = 650000.5;
const ORIGIN_NORTHING = 6640008.5;

function sourceHeight(column, row) {
  return 40 + column * 0.25 + row * 0.5;
}

function fullCompilation() {
  const size = 9;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = sourceHeight(column, row);
  }
  return compileTerrainAssets({
    groundId: 'fixture-ground',
    courseSlugs: ['fixture-course'],
    heights,
    width: size,
    height: size,
    originEasting: ORIGIN_EASTING,
    originNorthing: ORIGIN_NORTHING,
    tileSegments: 4,
    codec: 'raw',
  });
}

function subwindowPreviewTiles() {
  const size = 5;
  const offset = 2;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = sourceHeight(column + offset, row + offset);
  }
  const compiled = compileTerrainAssets({
    groundId: 'fixture-preview',
    courseSlugs: ['fixture-course'],
    heights,
    width: size,
    height: size,
    originEasting: ORIGIN_EASTING + offset,
    originNorthing: ORIGIN_NORTHING - offset,
    tileSegments: 4,
    codec: 'raw',
  });
  return compiled.pyramid.levels[0].tiles.map(tile => ({
    id: tile.id,
    bounds: tile.bounds,
    grid: tile.grid,
    heights: decodeTerrainGrid(tile.payload, tile.grid),
  }));
}

test('the aligned Puttom AOI reproduces its reviewed window exactly', () => {
  const aligned = puttomAlignedExtent();
  assert.deepEqual(
    {
      originEasting: aligned.originEasting,
      originNorthing: aligned.originNorthing,
      tilesX: aligned.tilesX,
      tilesY: aligned.tilesY,
      width: aligned.width,
      height: aligned.height,
    },
    { ...PUTTOM_GROUND_GRAPH_CONFIG.expectedAligned },
  );
  assert.deepEqual({ ...aligned.projwin }, { ...PUTTOM_GROUND_GRAPH_CONFIG.expectedProjwin });
  const required = puttomRequiredBoundsEpsg3006();
  assert.ok(aligned.bounds.minEasting <= required.minEasting - 80);
  assert.ok(aligned.bounds.maxEasting >= required.maxEasting + 80);
  assert.ok(aligned.bounds.maxNorthing >= required.maxNorthing + 80);
  assert.ok(aligned.bounds.minNorthing <= required.minNorthing - 80);
  const previewSpan = PUTTOM_GROUND_GRAPH_CONFIG.tileSegments;
  const offset = PUTTOM_GROUND_GRAPH_CONFIG.previewLatticeOffset;
  assert.equal(aligned.originEasting + offset.column * previewSpan, 696916.5);
  assert.equal(aligned.originNorthing - offset.row * previewSpan, 7025594.5);

  /* projwin states pixel EDGES around sample CENTRES, so it must be derived
     from the spacing: each side moves out half a sample and the span is the
     sample COUNT times the spacing, never the count added to a metre value. */
  const spacing = aligned.sampleSpacingMetres;
  assert.equal(aligned.projwin.west, aligned.originEasting - spacing / 2);
  assert.equal(aligned.projwin.north, aligned.originNorthing + spacing / 2);
  assert.equal(aligned.projwin.east - aligned.projwin.west, aligned.width * spacing);
  assert.equal(aligned.projwin.north - aligned.projwin.south, aligned.height * spacing);
});

test('decodeFinestLevel reassembles the exact quantized master', () => {
  const compiled = fullCompilation();
  const master = decodeFinestLevel(compiled.pyramid);
  assert.equal(master.width, 9);
  assert.equal(master.height, 9);
  for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) {
    const expected = Math.round(sourceHeight(column, row) * 100) / 100;
    assert.ok(Math.abs(master.heights[row * 9 + column] - expected) < 1e-9);
  }
});

test('a subwindow compiled with its own offset agrees exactly on the shared lattice', () => {
  const master = decodeFinestLevel(fullCompilation().pyramid);
  const comparison = comparePreviewToMaster(subwindowPreviewTiles(), master);
  assert.equal(comparison.samples, 25);
  assert.equal(comparison.exactlyEqual, 25);
  assert.equal(comparison.offByOneQuantum, 0);
  assert.equal(comparison.noDataMismatches, 0);
  assert.equal(comparison.maximumAbsoluteDifferenceMetres, 0);
  assert.equal(assertPreviewIdentity(comparison), comparison);
});

test('the coverage gate catches GDAL padding that the window checks cannot see', () => {
  /* A padded window keeps its requested size and geotransform, so coverage is
     the only signal. Both padding modes are exercised: nodata padding, and the
     0 m plane GDAL writes when the band declares no nodata at all. */
  const good = {
    stats: { sourceSamples: 4198401, finiteSamples: 4198401 },
    pyramid: { sourceMinimumHeightRH2000: 37.2, sourceMaximumHeightRH2000: 84.6 },
    noDataValue: -9999,
  };
  assert.deepEqual({ ...assertFullSourceCoverage(good) }, {
    sourceSamples: 4198401,
    finiteSamples: 4198401,
    noDataValue: -9999,
    minimumHeightRH2000: 37.2,
    maximumHeightRH2000: 84.6,
  });

  assert.throws(() => assertFullSourceCoverage({
    ...good,
    stats: { sourceSamples: 4198401, finiteSamples: 4198401 - 262144 },
  }), /262144 of 4198401 samples are nodata/);

  assert.throws(() => assertFullSourceCoverage({
    ...good,
    pyramid: { sourceMinimumHeightRH2000: 0, sourceMaximumHeightRH2000: 84.6 },
  }), /leaves the reviewed 10-200 m band/);

  assert.throws(() => assertFullSourceCoverage({ ...good, noDataValue: null }),
    /declares no nodata value/);
});

test('the identity gate fails closed on height and no-data disagreement', () => {
  const previewTiles = subwindowPreviewTiles();
  const master = decodeFinestLevel(fullCompilation().pyramid);
  master.heights[4 * 9 + 4] += 0.05;
  const drifted = comparePreviewToMaster(previewTiles, master);
  assert.ok(drifted.maximumAbsoluteDifferenceMetres > 0.0101);
  assert.throws(() => assertPreviewIdentity(drifted), /maximum difference/);

  master.heights[4 * 9 + 4] = Number.NaN;
  const missing = comparePreviewToMaster(previewTiles, master);
  assert.equal(missing.noDataMismatches, 1);
  assert.throws(() => assertPreviewIdentity(missing), /no-data mismatches/);

  const outside = [{
    ...previewTiles[0],
    bounds: { ...previewTiles[0].bounds, minEasting: ORIGIN_EASTING - 40, maxNorthing: ORIGIN_NORTHING + 40 },
  }];
  assert.throws(() => comparePreviewToMaster(outside, master), /outside the compiled master/);
});
