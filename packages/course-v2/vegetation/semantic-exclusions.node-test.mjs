import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaster } from './canopy-fields.mjs';
import { medianFilter3x3 } from './canopy-fields.mjs';
import { deriveCrownCandidates } from './crown-detect.mjs';
import {
  EXCLUSION_REASONS,
  courseExclusionFeatures,
  rasterizeExclusions,
  rasterizeLine,
  rasterizeRing,
  reasonForKind,
} from './semantic-exclusions.mjs';

const ORIGIN = { originEasting: 697000, originNorthing: 7025100 };

function raster(width = 40, height = 40, spacing = 1, fill = 0) {
  return createRaster({ width, height, sampleSpacingMetres: spacing, ...ORIGIN, fill });
}

test('a square ring fills exactly its cells and a line marks the cells it crosses', () => {
  const grid = raster();
  const target = new Uint8Array(grid.values.length);
  /* a 10 x 10 m square whose edges lie on cell boundaries */
  const square = [[697010, 7025090], [697020, 7025090], [697020, 7025080], [697010, 7025080]];
  assert.equal(rasterizeRing(grid, square, target), 100);
  assert.equal(target[10 * 40 + 10], 1);
  assert.equal(target[19 * 40 + 19], 1);
  assert.equal(target[20 * 40 + 20], 0);
  assert.equal(target[9 * 40 + 10], 0);
  assert.equal(rasterizeRing(grid, [[0, 0], [1, 1]], target), 0, 'a degenerate ring fills nothing');
  const lineTarget = new Uint8Array(grid.values.length);
  const marked = rasterizeLine(grid, [[697000.5, 7025099.5], [697009.5, 7025099.5]], lineTarget);
  assert.equal(marked, 10);
  assert.equal(lineTarget[0], 1);
  assert.equal(lineTarget[9], 1);
  assert.equal(lineTarget[10], 0);
});

test('classes dilate by their buffer, overlap resolves by priority, and every excluded cell has a reason', () => {
  const grid = raster();
  const result = rasterizeExclusions(grid, [
    { kind: 'green', rings: [[[697010, 7025090], [697020, 7025090], [697020, 7025080], [697010, 7025080]]] },
    { kind: 'building', rings: [[[697018, 7025088], [697024, 7025088], [697024, 7025082], [697018, 7025082]]] },
    { kind: 'path', lines: [[[697000.5, 7025060.5], [697039.5, 7025060.5]]], bufferMetres: 0, lineWidthMetres: 2 },
  ]);
  const at = (column, row) => row * 40 + column;
  assert.equal(result.mask[at(15, 15)], 1);
  /* the green's north-west corner is 7.5 m from the building, outside its
     6 m buffer, so the reason there is the green itself */
  assert.equal(result.reason[at(10, 10)], reasonForKind('green').code);
  /* two metres outside the green is still excluded, three is not */
  assert.equal(result.mask[at(8, 15)], 1);
  assert.equal(result.mask[at(7, 15)], 0);
  /* the building outranks the green where they overlap */
  assert.equal(result.reason[at(19, 15)], reasonForKind('building').code);
  /* a six metre building buffer reaches column 29 from a building edge at 24 */
  assert.equal(result.mask[at(29, 15)], 1);
  assert.equal(result.mask[at(31, 15)], 0);
  /* the path: one metre either side of its centre line */
  assert.equal(result.mask[at(20, 39)], 1);
  assert.equal(result.mask[at(20, 38)], 1);
  assert.equal(result.mask[at(20, 37)], 0);
  for (let i = 0; i < result.mask.length; i++) {
    if (result.mask[i]) assert.ok(result.reason[i] > 0);
    else assert.equal(result.reason[i], 0);
  }
  assert.equal(result.excludedCells, result.mask.reduce((sum, value) => sum + value, 0));
  assert.ok(result.cellsByKind.green > 100 && result.cellsByKind.building > 36 && result.cellsByKind.path > 0);
  assert.equal(result.legend[reasonForKind('water').code], 'water');
  assert.throws(() => rasterizeExclusions(grid, [{ kind: 'lava', rings: [] }]), /unknown exclusion kind/);
  assert.equal(new Set(EXCLUSION_REASONS.map(reason => reason.code)).size, EXCLUSION_REASONS.length);
});

test('the course adapter maps the migration model onto the classes', () => {
  const geometry = {
    holes: [{
      green: { ring: [[1, 1], [2, 1], [2, 2]] },
      fairway: { rings: [[[3, 3], [4, 3], [4, 4]]] },
      tees: { pads: [{ ring: [[5, 5], [6, 5], [6, 6]] }] },
      bunkers: [{ ring: [[7, 7], [8, 7], [8, 8]] }, { ring: [[9, 9]] }],
    }],
    scenery: { greens: [[[10, 10], [11, 10], [11, 11]]], range: [[12, 12], [13, 12], [13, 13]] },
    water: [{ ring: [[14, 14], [15, 14], [15, 15]] }],
    streams: [{ line: [[16, 16], [17, 17]], w: 1.5 }],
    infra: {
      buildings: [{ ring: [[18, 18], [19, 18], [19, 19]] }],
      roads: [{ line: [[20, 20], [21, 21]] }],
      tracks: [{ line: [[22, 22], [23, 23]] }],
      railway: [{ line: [[24, 24], [25, 25]] }],
      power: { lines: [{ line: [[26, 26], [27, 27]], voltage: 130000 }, { line: [[28, 28], [29, 29]], voltage: 400 }] },
      landuse: [{ kind: 'farmland', ring: [[30, 30], [31, 30], [31, 31]] }, { kind: 'residential', ring: [[32, 32], [33, 32], [33, 33]] }],
    },
  };
  const features = courseExclusionFeatures(geometry);
  const kinds = features.map(feature => feature.kind).sort();
  assert.deepEqual(kinds, ['building', 'bunker', 'fairway', 'farmland', 'green', 'path', 'power-corridor', 'practice', 'practice', 'railway', 'road', 'stream', 'tee', 'water']);
  assert.equal(features.find(feature => feature.kind === 'bunker').rings.length, 1, 'a one-point bunker ring is dropped');
  assert.equal(features.find(feature => feature.kind === 'stream').lineWidthMetres, 9);
  assert.equal(features.find(feature => feature.kind === 'power-corridor').lines.length, 1, 'only the 130 kV line');
  assert.equal(features.find(feature => feature.kind === 'farmland').rings.length, 1, 'residential land keeps its gardens');
  const practice = features.filter(feature => feature.kind === 'practice');
  assert.equal(practice.reduce((sum, feature) => sum + feature.rings.length, 0), 2, 'the practice green and the single-ring range');
  /* the migrated model carries the range as a LIST of rings */
  const listed = courseExclusionFeatures({ holes: [], scenery: { range: [[[1, 1], [2, 1], [2, 2]], [[5, 5], [6, 5], [6, 6]]] } });
  assert.equal(listed.filter(feature => feature.kind === 'practice').reduce((sum, feature) => sum + feature.rings.length, 0), 2);
});

test('a maximum over a green is not a candidate', () => {
  const grid = raster(60, 60);
  /* one 15 m crown centred on the green, one 15 m crown in the rough */
  for (let row = 0; row < 60; row++) {
    for (let column = 0; column < 60; column++) {
      const e = ORIGIN.originEasting + column + 0.5;
      const n = ORIGIN.originNorthing - row - 0.5;
      const onGreen = Math.hypot(e - 697015, n - 7025085);
      const inRough = Math.hypot(e - 697045, n - 7025055);
      grid.values[row * 60 + column] = Math.max(15 * Math.exp(-(onGreen ** 2) / 8), 15 * Math.exp(-(inRough ** 2) / 8));
    }
  }
  const green = [[697005, 7025095], [697025, 7025095], [697025, 7025075], [697005, 7025075]];
  const detection = medianFilter3x3(grid);
  const without = deriveCrownCandidates({ heights: grid, detection });
  assert.equal(without.maxima.length, 2);
  const exclusions = rasterizeExclusions(grid, [{ kind: 'green', rings: [green] }]);
  const withMask = deriveCrownCandidates({ heights: grid, detection, excludeMask: exclusions.mask });
  assert.equal(withMask.maxima.length, 1);
  /* the apex is found on the smoothed copy and may sit one cell off; the
     height-weighted centroid is the position a record carries */
  assert.ok(Math.hypot(withMask.crowns[0].apex.easting - 697045, withMask.crowns[0].apex.northing - 7025055) < 2);
  assert.ok(Math.hypot(withMask.crowns[0].centroid.easting - 697045, withMask.crowns[0].centroid.northing - 7025055) < 1);
});
