import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ringSpecFor, ringLevelExtent } from './ground-rings-registry.mjs';
import { LIDINGO_V2_CONFIG as config } from '../../apps/golf/src/engine/v2-lidingo-config.mjs';
import { refusePublishedRingOverwrite } from './ground-ring-publication-guard.mjs';
import { readChunk } from './chunk-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

const publicDirectory = new URL('../../apps/golf/public/', import.meta.url);
const repositoryDirectory = new URL('../../', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, publicDirectory)));
const sourceBytes = p => fs.readFileSync(new URL(p, repositoryDirectory));
const source = p => JSON.parse(sourceBytes(p));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const course = read(read('courses/v2-index.json').courses.find(c => c.slug === 'lidingo').manifest.url);
const ground = read(course.groundManifest.url);
const boundsKey = b => `${b.minEasting}|${b.maxNorthing}`;

test('Lidingö serves one complete 16 km quadtree, shaped as its contract pins it', () => {
  const spec = ringSpecFor('lidingo');
  /* the counts are the CONTRACT's: the live graph must be what the reviewed
     config says it is, and the config moves with the publish that changes it */
  assert.equal(ground.tiles.length, config.ringGraph.tiles);
  assert.equal(ground.tiles.filter(t => t.parentId).length, config.ringGraph.tiles - 1);
  assert.deepEqual(spec.levels.map(l => ground.tiles.filter(t => t.lod === l.lod).length), [...Object.values(config.ringGraph.tilesByLod)]);
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
  /* the frontier the app preloads is a whole-tile sub-rectangle of the
     spec's level zero, on its lattice; it need not be the whole level */
  const level0 = ringLevelExtent(spec.levels[0]);
  const frontier = config.expectedFrontierBoundsEpsg5845;
  const tileSpan = spec.tileSegments * spec.levels[0].sampleSpacingMetres;
  assert.ok(frontier.minEasting >= level0.minEasting && frontier.maxEasting <= level0.maxEasting &&
    frontier.minNorthing >= level0.minNorthing && frontier.maxNorthing <= level0.maxNorthing, 'the frontier lies inside level zero');
  for (const value of [frontier.minEasting - level0.minEasting, level0.maxNorthing - frontier.maxNorthing,
    frontier.maxEasting - frontier.minEasting, frontier.maxNorthing - frontier.minNorthing]) {
    assert.equal(value % tileSpan, 0, 'the frontier is whole level-zero tiles on the level-zero lattice');
  }
  /* and every published level-zero tile stands on that lattice */
  for (const tile of ground.tiles.filter(t => t.lod === 0)) {
    assert.equal((tile.bounds.minEasting - level0.minEasting) % tileSpan, 0, `${tile.id} is off the lattice`);
    assert.equal((level0.maxNorthing - tile.bounds.maxNorthing) % tileSpan, 0, `${tile.id} is off the lattice`);
  }
});

test('expanded Lidingö preserves the exact original course terrain', () => {
  /* The original 64 tiles are matched by WHERE they are, never by id: the
     standard's sixteen-wide level zero keeps them in its middle under new
     lattice ids, with the same heights to the quantum -- the payload is
     carried verbatim, so the decoded grid is byte-identical -- and the
     stand layer they carried. */
  const previous = read('grounds/lidingo/ground-v2-6732ca39f30b00dbce720225d42149da5d0f9d9fd0753d0f871fc67f4184877a.json');
  const originals = previous.tiles.filter(t => t.lod === 0);
  assert.equal(originals.length, 64);
  const current = new Map(ground.tiles.filter(t => t.lod === 0).map(t => [boundsKey(t.bounds), t]));
  for (const tile of originals) {
    const now = current.get(boundsKey(tile.bounds));
    assert.ok(now, `original native terrain tile missing at ${tile.bounds.minEasting}/${tile.bounds.maxNorthing}`);
    assert.deepEqual(now.bounds, tile.bounds);
    assert.equal(now.geometricErrorMetres, tile.geometricErrorMetres);
    const was = readChunk(fs.readFileSync(new URL(tile.layers.terrain.url, publicDirectory)));
    const is = readChunk(fs.readFileSync(new URL(now.layers.terrain.url, publicDirectory)));
    assert.equal(is.header.id, now.id, 'the chunk names the tile it is served as');
    assert.deepEqual(is.header.grid, was.header.grid);
    assert.deepEqual(is.header.bounds, was.header.bounds);
    assert.equal(Buffer.compare(is.payload, was.payload), 0, `original terrain heights changed at ${now.id}`);
    assert.deepEqual(decodeTerrainGrid(is.payload, is.header.grid), decodeTerrainGrid(was.payload, was.header.grid));
    for (const kind of ['surface', 'objects']) {
      assert.equal((now.layers[kind] ?? null) === null, (tile.layers[kind] ?? null) === null, `${kind} presence changed at ${now.id}`);
    }
    if (now.id === tile.id) {
      for (const kind of ['terrain', 'surface', 'objects']) assert.deepEqual(now.layers[kind], tile.layers[kind], `${kind} changed in ${tile.id}`);
      const bytes = fs.readFileSync(new URL(now.layers.terrain.url, publicDirectory));
      assert.equal(bytes.length, tile.layers.terrain.bytes);
      assert.equal(sha(bytes), tile.layers.terrain.sha256, `original terrain bytes changed in ${tile.id}`);
    }
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
  assert.ok(finest.length >= 64);
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
  /* the compiled generation's tiles are matched by position too: a stand
     field re-addressed onto the standard lattice keeps its payload */
  const compiledAt = new Map(compiledGround.tiles.filter(t => t.lod === 0).map(t => [boundsKey(t.bounds), t]));
  for (const tile of finest.filter(t => t.layers.stands)) {
    const compiled = compiledAt.get(boundsKey(tile.bounds));
    assert.ok(compiled?.layers.stands, `no compiled stand field at ${tile.id}`);
    const bytes = fs.readFileSync(new URL(tile.layers.stands.url, publicDirectory));
    assert.equal(bytes.length, tile.layers.stands.bytes);
    assert.equal(sha(bytes), tile.layers.stands.sha256, `stand bytes changed in ${tile.id}`);
    const is = readChunk(bytes);
    const was = readChunk(fs.readFileSync(new URL(compiled.layers.stands.url, publicDirectory)));
    assert.equal(is.header.id, tile.id);
    assert.equal(is.header.decodedSha256, was.header.decodedSha256, `published stand generation changed: ${tile.id}`);
    if (compiled.id === tile.id) {
      assert.deepEqual(tile.layers.stands, compiled.layers.stands, `published stand generation changed: ${tile.id}`);
      if (stagedLayers) assert.deepEqual(tile.layers.stands, stagedLayers[tile.id], `published stands differ from retained compilation: ${tile.id}`);
    } else if (stagedLayers) {
      assert.equal(is.header.decodedSha256, readChunk(fs.readFileSync(new URL(stagedLayers[compiled.id].url, publicDirectory))).header.decodedSha256,
        `published stands differ from retained compilation: ${tile.id}`);
    }
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
