import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { TORTUNA_GROUND_GRAPH_CONFIG as config, assertTortunaAcquisition, assertTortunaCompilation, attachTortunaTerrainParents, assertTortunaTerrainRetention } from './tortuna-ground-graph.mjs';
import { compileTortunaTerrain } from './compile-tortuna-ground-graph.mjs';
import { TERRAIN_WINDOW_SPECS } from '../course-geo/acquisition/terrain-window-specs.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';

const receipt = () => JSON.parse(readFileSync(new URL('../../geo_data/course-v2/tortuna/acquisition/terrain-window.json', import.meta.url), 'utf8'));

test('Tortuna native source identity agrees with independently stated 4096 m acquisition bounds', () => {
  const evidence = receipt();
  assert.equal(assertTortunaAcquisition(evidence, config.sourceFloat32Sha256), evidence);
  const spec = TERRAIN_WINDOW_SPECS.tortuna;
  for (const field of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) assert.equal(spec[field], config[field]);
  assert.deepEqual(spec.pixelEdgeWindow, config.pixelEdgeWindow);
  assert.deepEqual(spec.sourceItemIds, config.sourceItemIds);
});

test('Tortuna rejects coordinated raster/receipt mutation, shifted grid, overview substitution and missing native samples', () => {
  const changes = [
    value => { value.raster.sha256 = 'a'.repeat(64); },
    value => { value.lattice.originEasting += 0.5; },
    value => { value.lattice.verticalCrs = 'EPSG:4979'; },
    value => { value.lattice.coordinateOrder.reverse(); },
    value => { value.lattice.pixelEdgeWindow.north--; },
    value => { value.sourceItems[0].overviewFactorUsed = 2; },
    value => { value.sourceItems[0].href = 'https://example.invalid/dtm.tif'; },
    value => { value.sourceItems[0].etag = '"another-source"'; },
    value => { value.sourceItems[0].contentLength--; },
    value => { value.samples.finite--; },
    value => { value.raster.bytes -= 4; },
  ];
  for (const change of changes) { const value = receipt(); change(value); assert.throws(() => assertTortunaAcquisition(value, value.raster.sha256)); }
});

// A clean clone verifies every committed measured tile and shell without the
// private raw cache. Before initial publication, exercise the real 16.8 million
// sample compiler directly. The separate native checker repeats raw controls.
async function retainedTerrain() {
  const publicRoot = new URL('../../apps/golf/public/', import.meta.url);
  const reportUrl = new URL('tortuna-ground-graph-report.json', publicRoot);
  if (!existsSync(reportUrl)) return compileTortunaTerrain();
  const read = relative => JSON.parse(readFileSync(new URL(relative, publicRoot), 'utf8'));
  const report = JSON.parse(readFileSync(reportUrl, 'utf8'));
  const entry = read('courses/v2-index.json').courses.find(course => course.slug === 'tortuna');
  const ground = read(read(entry.manifest.url).groundManifest.url);
  const resources = new Map();
  for (const reference of [ground.shell, ...ground.tiles.map(tile => tile.layers.terrain)]) {
    const bytes = readFileSync(new URL(reference.url, publicRoot));
    verifyChunkAsset(reference, bytes);
    resources.set(reference.url, bytes);
  }
  const evidence = receipt();
  return { frame: ground.frame, compilation: { groundId: 'tortuna', courseSlugs: ['tortuna'], bounds: ground.bounds, shell: ground.shell, tiles: ground.tiles, resources,
    stats: report.terrain, pyramid: { sourceMinimumHeightRH2000: evidence.samples.minimumHeightRH2000, sourceMaximumHeightRH2000: evidence.samples.maximumHeightRH2000,
      levels: report.terrain.levels.map(level => ({ ...level, tiles: ground.tiles.filter(tile => tile.lod === level.lod) })) } } };
}
const compiled = retainedTerrain();

test('all 341 measured terrain tiles retain exact bytes and explicit containing parents', async () => {
  const { compilation, frame } = await compiled;
  assert.deepEqual(compilation.stats.levels.map(level => level.tiles), [256, 64, 16, 4, 1]);
  assert.equal(frame.fingerprint, '37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f');
  assert.deepEqual(frame.origin, { easting: 597400.5, northing: 6614899.5, heightRH2000: 16.31 });
  const attached = attachTortunaTerrainParents(compilation);
  assert.equal(attached.resources, compilation.resources);
  assert.equal(attached.shell, compilation.shell);
  assert.equal(attached.tiles.filter(tile => tile.parentId !== null).length, 340);
  for (const tile of attached.tiles) {
    const original = compilation.tiles.find(item => item.id === tile.id);
    assert.equal(tile.layers.terrain, original.layers.terrain);
    assert.equal(tile.bounds, original.bounds);
    assert.ok(compilation.resources.has(tile.layers.terrain.url));
    if (tile.parentId) assert.ok(attached.tiles.some(parent => parent.id === tile.parentId && parent.lod === tile.lod + 1));
  }
  const broken = { ...compilation, pyramid: { ...compilation.pyramid, levels: compilation.pyramid.levels.slice(0, -1) } };
  assert.throws(() => attachTortunaTerrainParents(broken), /containing parent/);
});

test('publication rejects terrain replacement, removed parent links, coverage shrinkage and moved frames', async () => {
  const { compilation, frame } = await compiled;
  const ground = { groundId: 'tortuna', frame, bounds: compilation.bounds, shell: compilation.shell, tiles: compilation.tiles };
  assert.doesNotThrow(() => assertTortunaTerrainRetention(ground, structuredClone(ground)));
  const changes = [
    value => { value.frame.origin.easting++; },
    value => { value.bounds.minNorthing += 256; },
    value => { value.shell.sha256 = 'a'.repeat(64); },
    value => { value.tiles.pop(); },
    value => { value.tiles[0] = structuredClone(value.tiles[1]); },
    value => { value.tiles[0].parentId = null; },
    value => { value.tiles[0].layers.terrain.sha256 = 'a'.repeat(64); },
  ];
  for (const change of changes) { const altered = structuredClone(ground); change(altered); assert.throws(() => assertTortunaTerrainRetention(ground, altered)); }
  const decoration = structuredClone(ground);
  decoration.tiles[0].layers.stands = { source: 'new measured stands' };
  assert.doesNotThrow(() => assertTortunaTerrainRetention(ground, decoration));
  const incomplete = { ...compilation, stats: { ...compilation.stats, finiteSamples: 1 } };
  assert.throws(() => assertTortunaCompilation(incomplete), /missing source samples/);
});
