import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRaster } from './canopy-fields.mjs';
import { lidingoExclusionFeatures, lidingoExclusionMask, excludeInvalidLidingoCanopy } from './lidingo-stand-exclusions.mjs';

const collection = features => ({ type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'EPSG:3006' } }, features });
const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];

test('Lidingö maps physical surfaces and context roads to explicit exclusion classes without synthesizing polygons', () => {
  const features = lidingoExclusionFeatures([collection([
    { id: 'green18', properties: { kind: 'green' }, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 8, 8)] } },
    { id: 'path', properties: { tags: { highway: 'footway' } }, geometry: { type: 'LineString', coordinates: [[0, 4], [20, 4]] } },
    { id: 'road', properties: { tags: { highway: 'residential' } }, geometry: { type: 'LineString', coordinates: [[4, 0], [4, 20]] } },
  ])]);
  assert.deepEqual(features.map(feature => feature.kind), ['green', 'path', 'road']);
  assert.deepEqual(features[1].polygons, []);
  assert.deepEqual(features[1].lines, [[[0, 4], [20, 4]]]);
  assert.throws(() => lidingoExclusionFeatures([{ type: 'FeatureCollection', features: [] }]), /explicit EPSG:3006/);
});

test('water polygon islands remain plantable beyond the stated shore buffer', () => {
  const raster = createRaster({ width: 40, height: 40, sampleSpacingMetres: 1,
    originEasting: 0, originNorthing: 40, fill: 10 });
  const outer = ring(0, 0, 40, 40);
  const island = ring(8, 8, 32, 32);
  const features = lidingoExclusionFeatures([collection([
    { id: 'water', properties: { tags: { natural: 'water' } }, geometry: { type: 'Polygon', coordinates: [outer, island] } },
  ])]);
  const exclusions = lidingoExclusionMask(raster, features);
  assert.equal(exclusions.mask[20 * 40 + 20], 0, 'island interior must stay outside the water exclusion');
  assert.equal(exclusions.mask[2 * 40 + 2], 1, 'water interior is excluded');
  assert.equal(exclusions.mask[8 * 40 + 8], 1, 'the stated 3m shore buffer reaches the island shore');
  assert.equal(exclusions.counts.water.bufferMetres, 3);
});

test('a separate building on an island remains excluded and malformed geometry cannot silently pass', () => {
  const raster = createRaster({ width: 40, height: 40, sampleSpacingMetres: 1,
    originEasting: 0, originNorthing: 40, fill: 10 });
  const features = lidingoExclusionFeatures([collection([
    { id: 'water', properties: { tags: { natural: 'water' } }, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 40, 40), ring(8, 8, 32, 32)] } },
    { id: 'building', properties: { tags: { building: 'yes' } }, geometry: { type: 'Polygon', coordinates: [ring(18, 18, 22, 22)] } },
  ])]);
  assert.equal(lidingoExclusionMask(raster, features).mask[20 * 40 + 20], 1);
  const invalid = structuredClone(features);
  invalid[0].polygons[0][0][0][0] = Number.NaN;
  assert.throws(() => lidingoExclusionMask(raster, invalid), /Invalid exclusion polygon/);
});

test('unknown, non-finite and negative source cells cannot produce vegetation', () => {
  const mask = new Uint8Array(6);
  const counts = excludeInvalidLidingoCanopy(mask,
    new Float32Array([12, Number.NaN, -1, 8, 7, Number.POSITIVE_INFINITY]),
    new Float32Array([2, 2, 2, Number.NaN, -0.01, 2]));
  assert.deepEqual([...mask], [0, 1, 1, 1, 1, 1]);
  assert.equal(counts.invalidCanopyCells, 3);
  assert.equal(counts.unknownGroundCells, 1);
  assert.equal(counts.belowVegetationElevationThresholdCells, 1);
  assert.equal(counts.excludedAdditionalCells, 5);
});

test('clipped Lantmäteriet 3D water retains island rings and drops only the height ordinate for exclusion rasterization', () => {
  const outer = ring(0, 0, 40, 40).map(([x, y]) => [x, y, 0.1]);
  const island = ring(8, 8, 32, 32).map(([x, y]) => [x, y, 0.1]);
  const features = lidingoExclusionFeatures([collection([
    { id: 'lm-water', properties: { kind: 'flattened-water-surface', sourceId: 'water-breaks-lm-1m' },
      geometry: { type: 'MultiPolygon', coordinates: [[outer, island]] } },
  ])]);
  assert.equal(features[0].kind, 'water');
  assert.equal(features[0].sourceId, 'water-breaks-lm-1m');
  assert.equal(features[0].polygons[0].length, 2);
  assert.deepEqual(features[0].polygons[0][0][0], [0, 0]);
  const raster = createRaster({ width: 40, height: 40, sampleSpacingMetres: 1,
    originEasting: 0, originNorthing: 40, fill: 10 });
  assert.equal(lidingoExclusionMask(raster, features).mask[20 * 40 + 20], 0);
});
