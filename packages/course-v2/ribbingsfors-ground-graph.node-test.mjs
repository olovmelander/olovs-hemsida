import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIBBINGSFORS_GROUND_GRAPH_CONFIG as config } from './ribbingsfors-ground-graph.mjs';

test('Ribbingsfors 1 m lattice is an exact eight-by-eight 256 m tile grid', () => {
  assert.equal(config.width, config.tileSegments * 8 + 1);
  assert.equal(config.height, config.tileSegments * 8 + 1);
  assert.equal(config.expectedBounds.maxEasting - config.expectedBounds.minEasting, 2048);
  assert.equal(config.expectedBounds.maxNorthing - config.expectedBounds.minNorthing, 2048);
  assert.equal(config.originEasting, config.pixelEdgeWindow.west + 0.5);
  assert.equal(config.originNorthing, config.pixelEdgeWindow.north - 0.5);
  assert.equal(config.pixelEdgeWindow.east - config.pixelEdgeWindow.west, 2049);
  assert.equal(config.pixelEdgeWindow.north - config.pixelEdgeWindow.south, 2049);
});
