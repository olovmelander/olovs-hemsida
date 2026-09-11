import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { TORTUNA_GROUND_GRAPH_CONFIG as config, assertTortunaAcquisition, assertTortunaCompilation, attachTortunaTerrainParents, assertTortunaTerrainRetention } from './tortuna-ground-graph.mjs';
import { compileTortunaTerrain } from './compile-tortuna-ground-graph.mjs';
import { TERRAIN_WINDOW_SPECS } from '../course-geo/acquisition/terrain-window-specs.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import { ringSpecFor, ringLevelExtent } from './ground-rings-registry.mjs';

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

/* The retained 4 km native window IS the standard's 1 m level: sixteen tiles
   per side centred on the frame origin, so the ring publish keeps all 256
   measured tiles under the ids they have always had. A clean clone verifies
   every committed measured tile without the private raw cache; before initial
   publication the real 16.8 million sample compiler is exercised directly. */
const publicRoot = new URL('../../apps/golf/public/', import.meta.url);
const read = relative => JSON.parse(readFileSync(new URL(relative, publicRoot), 'utf8'));

function liveGround() {
  if (!existsSync(new URL('courses/v2-index.json', publicRoot))) return null;
  const entry = read('courses/v2-index.json').courses.find(course => course.slug === 'tortuna');
  return entry ? read(read(entry.manifest.url).groundManifest.url) : null;
}

test('all 256 measured terrain tiles retain exact bytes on the standard lattice with explicit containing parents', async () => {
  const ground = liveGround();
  if (!ground) {
    const { compilation, frame } = await compileTortunaTerrain();
    assert.deepEqual(compilation.stats.levels.map(level => level.tiles), [256, 64, 16, 4, 1]);
    assert.equal(frame.fingerprint, '37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f');
    assert.equal(attachTortunaTerrainParents(compilation).tiles.filter(tile => tile.parentId !== null).length, 340);
    return;
  }
  assert.equal(ground.frame.fingerprint, '37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f');
  assert.deepEqual(ground.frame.origin, { easting: 597400.5, northing: 6614899.5, heightRH2000: 16.31 });
  const level0 = ringLevelExtent(ringSpecFor('tortuna').levels[0]);
  for (const key of ['minEasting', 'maxEasting', 'minNorthing', 'maxNorthing']) assert.equal(level0[key], config.expectedBounds[key], `${key}: the standard's 1 m level is the retained window`);
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  assert.equal(finest.length, 256);
  const ids = new Set(finest.map(tile => tile.id));
  for (let column = 0; column < 16; column++) for (let row = 0; row < 16; row++) {
    const id = `l0/${column}/${row}`;
    assert.ok(ids.has(id), `${id} is published`);
    const tile = finest.find(candidate => candidate.id === id);
    assert.equal(tile.bounds.minEasting, config.originEasting + column * 256);
    assert.equal(tile.bounds.maxNorthing, config.originNorthing - row * 256);
  }
  const byId = new Map(ground.tiles.map(tile => [tile.id, tile]));
  let roots = 0;
  for (const tile of ground.tiles) {
    for (const kind of ['terrain', 'surface', 'objects', 'stands']) {
      const reference = tile.layers[kind];
      if (!reference) continue;
      const bytes = readFileSync(new URL(reference.url, publicRoot));
      const decoded = verifyChunkAsset(reference, bytes);
      assert.equal(decoded.header.id, tile.id, `${kind} chunk of ${tile.id} names its tile`);
    }
    if (tile.parentId === null || tile.parentId === undefined) { roots++; continue; }
    const parent = byId.get(tile.parentId);
    assert.ok(parent && parent.lod === tile.lod + 1, `${tile.id} has a parent one level up`);
    const a = parent.bounds, b = tile.bounds;
    assert.ok(a.minEasting <= b.minEasting && a.maxEasting >= b.maxEasting && a.minNorthing <= b.minNorthing && a.maxNorthing >= b.maxNorthing, `${tile.id} lies inside ${tile.parentId}`);
  }
  assert.equal(roots, 1, 'one root');
  const shell = readFileSync(new URL(ground.shell.url, publicRoot));
  verifyChunkAsset(ground.shell, shell);
});

test('publication rejects terrain replacement, removed parent links, coverage shrinkage and moved frames', async () => {
  const live = liveGround();
  const ground = live ? structuredClone(live) : await (async () => {
    const { compilation, frame } = await compileTortunaTerrain();
    return { groundId: 'tortuna', frame, bounds: compilation.bounds, shell: compilation.shell, tiles: compilation.tiles };
  })();
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
});
