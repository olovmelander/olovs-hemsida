import assert from 'node:assert/strict';
import test from 'node:test';
import { terrainWindowIntersection, copyTerrainWindow, summarizeTerrainWindow } from './terrain-window-intersection.mjs';

const item = { id: '637_68', minEasting: 680000, maxEasting: 690000, minNorthing: 6370000, maxNorthing: 6380000 };
const coastal = { originX: 685000, originY: 6380000, width: 5000, height: 10000, pixelScaleX: 1, pixelScaleY: 1, factor: 1, isFloat: true, noData: -9999 };
const spec = { originEasting: 685700.5, originNorthing: 6372999.5, width: 4097, height: 4097, sampleSpacingMetres: 1 };

test('cropped coastal COG intersects using its actual geotransform and preserves the full-resolution seam', () => {
  const north = terrainWindowIntersection(spec, item, coastal);
  assert.deepEqual(north.sourceExtent, { west: 685000, north: 6380000, east: 690000, south: 6370000 });
  assert.deepEqual(north.windowPixels, { column0: 700, row0: 7000, columns: 4097, rows: 3000 });
  assert.deepEqual(north.latticeWindow, { column0: 0, row0: 0, columns: 4097, rows: 3000 });
  const south = terrainWindowIntersection(spec,
    { ...item, id: '636_68', minNorthing: 6360000, maxNorthing: 6370000 },
    { ...coastal, originY: 6370000, height: 5000 });
  assert.deepEqual(south.windowPixels, { column0: 700, row0: 0, columns: 4097, rows: 1097 });
  assert.deepEqual(south.latticeWindow, { column0: 0, row0: 3000, columns: 4097, rows: 1097 });
  assert.equal(north.latticeWindow.rows + south.latticeWindow.rows, 4097);
});

test('ordinary full 10 km product keeps the existing Lidingo source-pixel indices', () => {
  const result = terrainWindowIntersection(
    { originEasting: 676676.5, originNorthing: 6587423.5, width: 2049, height: 2049, sampleSpacingMetres: 1 },
    { id: '658_67', minEasting: 670000, maxEasting: 680000, minNorthing: 6580000, maxNorthing: 6590000 },
    { ...coastal, originX: 670000, originY: 6590000, width: 10000, height: 10000 });
  assert.deepEqual(result.windowPixels, { column0: 6676, row0: 2576, columns: 2049, rows: 2049 });
  assert.deepEqual(result.latticeWindow, { column0: 0, row0: 0, columns: 2049, rows: 2049 });
});

test('seam assembly preserves independently identified rows without missing or duplicate samples', () => {
  const destination = new Float32Array(12).fill(Number.NaN);
  copyTerrainWindow(destination, 3, { latticeWindow: { column0: 0, row0: 0, columns: 3, rows: 2 } }, new Float32Array([1, 2, 3, 4, 5, 6]), -9999);
  copyTerrainWindow(destination, 3, { latticeWindow: { column0: 0, row0: 2, columns: 3, rows: 2 } }, new Float32Array([7, 8, 9, 10, 11, 12]), -9999);
  assert.deepEqual([...destination], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(summarizeTerrainWindow(destination, { minimum: -5, maximum: 100 }), { finite: 12, minimum: 1, maximum: 12 });
  assert.throws(() => copyTerrainWindow(destination, 3, { latticeWindow: { column0: 0, row0: 2, columns: 3, rows: 1 } }, new Float32Array([7, 8, 9]), -9999), /overlap/);
});

test('misaligned, coarse, undeclared nodata and displaced source rasters fail before acquisition', () => {
  assert.throws(() => terrainWindowIntersection({ ...spec, originEasting: 685700 }, item, coastal), /pixel centres/);
  assert.throws(() => terrainWindowIntersection(spec, item, { ...coastal, pixelScaleX: 2 }), /full-resolution/);
  assert.throws(() => terrainWindowIntersection(spec, item, { ...coastal, factor: 2 }), /full-resolution/);
  assert.throws(() => terrainWindowIntersection(spec, item, { ...coastal, noData: null }), /nodata/);
  assert.throws(() => terrainWindowIntersection(spec, item, { ...coastal, originX: 686000 }), /nominal 10 km/);
  assert.equal(terrainWindowIntersection({ ...spec, originEasting: 681000.5, width: 257 }, item, coastal), null);
});

test('uncovered coast and nodata never become zero-filled sea or accepted terrain', () => {
  const destination = new Float32Array(4).fill(Number.NaN);
  const intersection = { latticeWindow: { column0: 0, row0: 0, columns: 2, rows: 1 } };
  assert.throws(() => copyTerrainWindow(destination, 2, intersection, new Float32Array([0, -9999]), -9999), /nodata/);
  assert.throws(() => summarizeTerrainWindow(destination, { minimum: -5, maximum: 100 }), /nodata or unread/);
  destination.fill(Number.NaN);
  assert.throws(() => copyTerrainWindow(destination, 2, intersection, new Float32Array([Number.NaN, 0]), -9999), /nodata/);
  assert.throws(() => summarizeTerrainWindow(new Float32Array([0, 101]), { minimum: -5, maximum: 100 }), /reviewed band/);
});
