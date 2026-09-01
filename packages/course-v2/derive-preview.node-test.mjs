import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePreviewFromGraph, finestFrontier } from './derive-preview-from-graph.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUND = path.join(ROOT, 'apps/golf/public/grounds/puttom');

function publishedGraph() {
  const name = fs.readdirSync(GROUND).find(file => /^ground-v2-[0-9a-f]{64}\.json$/.test(file));
  assert.ok(name, 'a published Puttom ground graph must exist');
  return JSON.parse(fs.readFileSync(path.join(GROUND, name), 'utf8'));
}

test('the published graph already carries a full-course finest frontier', () => {
  const { finest, tiles } = finestFrontier(publishedGraph());
  assert.equal(finest, 0);
  /* 8 x 8 at 256 m: the 2048 m window alignTerrainGridExtent derives from the
     CORE contract, which is the only power-of-two extent that holds the whole
     course. The 1024 m pilot cannot, at any placement. */
  assert.equal(tiles.length, 64);
  for (const tile of tiles) assert.match(tile.layers.terrain.url, /^grounds\/puttom\/terrain\/[0-9a-f]{64}\.bvch$/);
});

test('a preview derived from it is a valid preview over the same ground', () => {
  const graph = publishedGraph();
  const descriptor = derivePreviewFromGraph(graph, { label: 'test' });
  assertTerrainPreview(descriptor);
  assert.equal(descriptor.tiles.length, 64);
  /* The same ground means the same frame: a different origin would move every
     tile, so the derivation refuses rather than emitting a plausible lie. */
  assert.equal(descriptor.frame.fingerprint, graph.frame.fingerprint);
  assert.deepEqual(descriptor.bounds, graph.bounds);
  assert.equal(descriptor.bounds.maxEasting - descriptor.bounds.minEasting, 2048);
  assert.equal(descriptor.bounds.maxNorthing - descriptor.bounds.minNorthing, 2048);
  /* assets stay inside the descriptor's own directory, or the loader refuses */
  for (const tile of descriptor.tiles) assert.match(tile.reference.url, /^terrain\/[0-9a-f]{64}\.bvch$/);
});

test('it is deterministic, and refuses a graph it cannot describe', () => {
  const graph = publishedGraph();
  const first = derivePreviewFromGraph(graph, { label: 'test' });
  const second = derivePreviewFromGraph(graph, { label: 'test' });
  assert.deepEqual(first, second);
  assert.throws(() => derivePreviewFromGraph(graph, {}), /label is required/);
  assert.throws(() => derivePreviewFromGraph({ tiles: [] }, { label: 'x' }), /tiles is required|with tiles/);
  const moved = { ...graph, frame: { ...graph.frame, fingerprint: 'f'.repeat(64) } };
  assert.throws(() => derivePreviewFromGraph(moved, { label: 'x' }), /does not match the graph/);
});

test('the committed derivation matches what the tool produces now', () => {
  const target = path.join(GROUND, 'preview.json');
  if (!fs.existsSync(target)) return;   // not yet wired in
  const committed = JSON.parse(fs.readFileSync(target, 'utf8'));
  const derived = derivePreviewFromGraph(publishedGraph(), { label: committed.label });
  assert.deepEqual(committed, derived);
});
