import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blitInterior,
  canopyHeightModel,
  fillGround,
  gridSpec,
  groundAt,
  groundGrid,
  smoothGround,
  windowStatistics,
} from './canopy-build.mjs';

function points(list) {
  return {
    count: list.length,
    x: Float64Array.from(list, p => p[0]),
    y: Float64Array.from(list, p => p[1]),
    z: Float32Array.from(list, p => p[2]),
    classification: Uint8Array.from(list, p => p[3]),
    returnNumber: Uint8Array.from(list, p => p[4] ?? 1),
  };
}

const grid = gridSpec({ minEasting: 1000, maxNorthing: 2000, width: 10, height: 10 });

test('ground grid averages ground returns per cell and fills gaps from the nearest cell', () => {
  const pts = points([
    [1000.5, 1999.5, 10, 2], [1000.6, 1999.4, 12, 2],   // cell (0,0): mean 11
    [1009.5, 1990.5, 20, 2],                               // cell (9,9)
    [1005.5, 1995.5, 99, 1],                               // vegetation, not ground
  ]);
  const { mean, count } = groundGrid(grid, pts);
  assert.equal(count[0], 2);
  assert.equal(mean[0], 11);
  assert.equal(count[9 * 10 + 9], 1);
  assert.ok(Number.isNaN(mean[5 * 10 + 5]));
  const { ground, fillDistance } = fillGround(grid, mean, { radiusCells: 3 });
  assert.equal(ground[1], 11, 'a neighbour of cell (0,0) takes its height');
  assert.equal(fillDistance[1], 1);
  assert.ok(Number.isNaN(ground[5 * 10 + 5]), 'beyond the fill radius stays unknown');
  assert.equal(fillDistance[5 * 10 + 5], -1);
  const wide = fillGround(grid, mean, { radiusCells: 60 });
  assert.ok(!Number.isNaN(wide.ground[5 * 10 + 5]));
  const smooth = smoothGround(grid, wide.ground);
  assert.ok(Math.abs(smooth[0] - 11) < 1e-6);
  assert.ok(smooth[5 * 10 + 5] > 11 && smooth[5 * 10 + 5] < 20 || smooth[5 * 10 + 5] === 11 || smooth[5 * 10 + 5] === 20);
});

test('height above ground is bilinear over the ground and the canopy model keeps the highest return', () => {
  const flat = new Float32Array(100).fill(50);
  assert.equal(groundAt(grid, flat, 1003.3, 1996.7), 50);
  const sloped = new Float32Array(100);
  for (let row = 0; row < 10; row++) for (let column = 0; column < 10; column++) sloped[row * 10 + column] = 50 + column;
  assert.ok(Math.abs(groundAt(grid, sloped, 1002.5, 1995.5) - 52) < 1e-6, 'cell centre reads its own value');
  assert.ok(Math.abs(groundAt(grid, sloped, 1003.0, 1995.5) - 52.5) < 1e-6, 'halfway between centres interpolates');
  const pts = points([
    [1002.5, 1995.5, 62, 1, 1],   // 10 m above the 52 m ground
    [1002.6, 1995.4, 58, 1, 2],   // 6 m: a second return in the same cell
    [1002.4, 1995.6, 52, 2, 3],   // ground return in the same cell
    [1007.5, 1997.5, 57, 2, 1],   // a cell with only ground: open ground, 0
    [1008.5, 1998.5, 999, 7, 1],  // noise
    [1001.5, 1991.5, 200, 1, 1],  // above the ceiling
  ]);
  const model = canopyHeightModel(grid, pts, sloped);
  const cell = 4 * 10 + 2;
  assert.ok(Math.abs(model.chm[cell] - 10) < 1e-6);
  assert.equal(model.allReturns[cell], 3);
  assert.equal(model.firstReturns[cell], 1);
  assert.equal(model.groundReturns[cell], 1);
  assert.equal(model.chm[2 * 10 + 7], 0, 'only ground returns: measured open ground');
  assert.ok(Number.isNaN(model.chm[0]), 'no returns: void');
  assert.equal(model.noise, 1);
  assert.equal(model.clipped, 1);
  const stats = windowStatistics(grid, model);
  assert.equal(stats.allReturns, 5);
  assert.equal(stats.firstReturns, 3);
  assert.equal(stats.pulseDensityPerSquareMetre, 0.03);
  assert.equal(stats.canopyCells, 1);
  assert.equal(stats.openGroundCells, 1);
  /* two measured cells: the clipped 200 m spike's cell holds no other return and stays void */
  assert.equal(stats.voidCells, 100 - 2);
  const interiorStats = windowStatistics(grid, model, { interior: [cell] });
  assert.equal(interiorStats.cells, 1);
  assert.equal(interiorStats.canopyFractionOfMeasured, 1);
});

test('the interior of a window lands in the right cells of the campaign raster', () => {
  const window = gridSpec({ minEasting: 990, maxNorthing: 2010, width: 30, height: 30 });
  const source = new Float32Array(900);
  for (let i = 0; i < 900; i++) source[i] = i;
  const target = new Float32Array(100).fill(Number.NaN);
  const written = blitInterior(source, window, target, grid, [1000, 1990, 1010, 2000]);
  assert.equal(written, 100);
  /* window cell (10,10) has centre (1000.5, 1999.5): target cell (0,0) */
  assert.equal(target[0], 10 * 30 + 10);
  assert.equal(target[99], 19 * 30 + 19);
});
