import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ringSpecFor, ringLevelExtent } from './ground-rings-registry.mjs';
import { LIDINGO_V2_CONFIG as config } from '../../apps/golf/src/engine/v2-lidingo-config.mjs';
import { refusePublishedRingOverwrite } from './ground-ring-publication-guard.mjs';

const publicDirectory = new URL('../../apps/golf/public/', import.meta.url);
const repositoryDirectory = new URL('../../', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, publicDirectory)));
const sourceBytes = p => fs.readFileSync(new URL(p, repositoryDirectory));
const source = p => JSON.parse(sourceBytes(p));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const course = read(read('courses/v2-index.json').courses.find(c => c.slug === 'lidingo').manifest.url);
const ground = read(course.groundManifest.url);

test('Lidingö serves one complete 16 km quadtree with the exact native course window', () => {
  const spec = ringSpecFor('lidingo');
  assert.equal(ground.tiles.length, 277);
  assert.equal(ground.tiles.filter(t => t.parentId).length, 276);
  assert.deepEqual(spec.levels.map(l => ground.tiles.filter(t => t.lod === l.lod).length), config.ringGraph.tilesByLod);
  const byId = new Map(ground.tiles.map(t => [t.id, t]));
  for (const tile of ground.tiles) {
    if (!tile.parentId) continue;
    const parent = byId.get(tile.parentId);
    assert.equal(parent.lod, tile.lod + 1);
    const a = parent.bounds, b = tile.bounds;
    assert.ok(a.minEasting <= b.minEasting && a.maxEasting >= b.maxEasting && a.minNorthing <= b.minNorthing && a.maxNorthing >= b.maxNorthing);
  }
  for (const [key, value] of Object.entries(config.expectedBoundsEpsg5845)) {
    assert.equal(ground.bounds[key], value);
    assert.equal(ringLevelExtent(spec.levels.at(-1))[key], value);
  }
  for (const [key, value] of Object.entries(config.expectedFrontierBoundsEpsg5845)) assert.equal(ringLevelExtent(spec.levels[0])[key], value);
});

test('expanded Lidingö preserves the exact original course terrain', () => {
  const previous = read('grounds/lidingo/ground-v2-6732ca39f30b00dbce720225d42149da5d0f9d9fd0753d0f871fc67f4184877a.json');
  const originals = previous.tiles.filter(t => t.lod === 0);
  assert.equal(originals.length, 64);
  for (const tile of originals) {
    const current = ground.tiles.find(t => t.id === tile.id);
    assert.ok(current, `original native terrain tile missing: ${tile.id}`);
    assert.deepEqual(current.bounds, tile.bounds);
    assert.equal(current.geometricErrorMetres, tile.geometricErrorMetres);
    for (const kind of ['terrain', 'surface', 'objects']) {
      assert.deepEqual(current.layers[kind], tile.layers[kind], `${kind} changed in ${tile.id}`);
    }
    const bytes = fs.readFileSync(new URL(current.layers.terrain.url, publicDirectory));
    assert.equal(bytes.length, tile.layers.terrain.bytes);
    assert.equal(sha(bytes), tile.layers.terrain.sha256, `original terrain bytes changed in ${tile.id}`);
  }
});

test('published Lidingö stands match the current reviewed compilation and exclusion sources', () => {
  const evidence = source('geo_data/course-v2/lidingo/vegetation/stand-evidence.json');
  const review = source('geo_data/course-v2/lidingo/vegetation/stand-source-review.json');
  const publication = source('lidingobuild/mapping/tee-stand-refresh-validation.json');
  const compiledGround = read(publication.groundManifest.url);
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  assert.equal(publication.state, 'published');
  assert.equal(evidence.stands.tiles, 64);
  assert.equal(finest.length, 64);
  assert.equal(ground.tiles.filter(tile => tile.layers.stands).length, 64);
  assert.equal(publication.sourceLayerIndexSha256, evidence.layerIndex.sha256);
  assert.equal(review.sourceLayerIndex.sha256, evidence.layerIndex.sha256);
  assert.equal(review.state, 'source-exclusion-check-passed');
  assert.deepEqual(review.hits, []);
  assert.equal(ground.frame.fingerprint, evidence.frameFingerprint);
  for (const input of evidence.inputs) {
    assert.equal(sha(sourceBytes(input.path)), input.sha256, `stand exclusion source changed: ${input.path}`);
  }
  const stagedPath = new URL(evidence.layerIndex.path, repositoryDirectory);
  const staged = fs.existsSync(stagedPath) ? fs.readFileSync(stagedPath) : null;
  if (staged) assert.equal(sha(staged), evidence.layerIndex.sha256, 'retained stand stage changed');
  const stagedLayers = staged ? JSON.parse(staged).standLayers : null;
  for (const tile of finest) {
    const compiled = compiledGround.tiles.find(candidate => candidate.id === tile.id);
    assert.deepEqual(tile.layers.stands, compiled.layers.stands, `published stand generation changed: ${tile.id}`);
    if (stagedLayers) assert.deepEqual(tile.layers.stands, stagedLayers[tile.id], `published stands differ from retained compilation: ${tile.id}`);
    const bytes = fs.readFileSync(new URL(tile.layers.stands.url, publicDirectory));
    assert.equal(bytes.length, tile.layers.stands.bytes);
    assert.equal(sha(bytes), tile.layers.stands.sha256, `stand bytes changed in ${tile.id}`);
  }
});

test('the old Lidingö pyramid compiler cannot erase the surrounding world', async () => {
  const rootPath = new URL('courses/v2-index.json', publicDirectory);
  const before = fs.readFileSync(rootPath);
  // URL.pathname is /C:/... on Windows, which names an absent directory rather
  // than the compiler's real C:\... path and falsely looks unpublished.
  await assert.rejects(refusePublishedRingOverwrite(fileURLToPath(publicDirectory), 'lidingo'), /Refusing to replace the surrounding terrain/);
  assert.deepEqual(fs.readFileSync(rootPath), before, 'refused compilation must not change the live root');
});
