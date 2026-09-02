/* The Puttom vegetation generation, held as a test.

   Phase 0 of docs/puttom-v2-lidar-tree-placement-plan.md froze the graph at
   zero object references; Phase 4 flipped it on 2026-09-02: every finest tile
   of the published ground now carries a measured stand field and, where
   machine review approved individuals, an object registry, and the app's
   vegetation runtime plants them while the legacy lattice is cut out of
   their coverage. This test walks the committed graph exactly as the loader
   would -- root, course, ground, every referenced chunk verified by hash,
   header and payload -- and states what the generation must contain. It is
   the place to change when the next generation is published.               */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { verifyAssetGraph } from './graph-node.mjs';
import { V2_SUPPORTED_FEATURES } from './schema.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'apps/golf/public');

function readJson(relative) {
  return JSON.parse(readFileSync(join(PUBLIC, relative), 'utf8'));
}

function publishedGraph() {
  const root = readJson('courses/v2-index.json');
  const entry = root.courses.find(course => course.slug === 'puttom');
  assert.ok(entry, 'the root index publishes puttom');
  const course = readJson(entry.manifest.url);
  const ground = readJson(course.groundManifest.url);
  return { root, entry, course, ground };
}

test('the published Puttom ground carries stand fields and object registries on its finest tiles', () => {
  const { ground } = publishedGraph();
  assert.equal(ground.groundId, 'puttom');
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  assert.equal(finest.length, 64);
  const withStands = finest.filter(tile => tile.layers.stands);
  const withObjects = finest.filter(tile => tile.layers.objects);
  assert.ok(withStands.length >= 60, `${withStands.length} of 64 finest tiles carry a stand field`);
  assert.ok(withObjects.length >= 48, `${withObjects.length} of 64 finest tiles carry an object registry`);
  assert.ok(ground.requiredFeatures.includes('object-registry-json-v1'));
  assert.ok(ground.requiredFeatures.includes('stand-field-u8-v1'));
  for (const tile of ground.tiles.filter(tile => tile.lod > 0)) {
    assert.equal(tile.layers.objects ?? null, null, 'objects live on finest tiles only');
    assert.equal(tile.layers.stands ?? null, null, 'stand fields live on finest tiles only');
  }
});

test('every chunk the graph references exists on disk and verifies as the loader would verify it', () => {
  const { root, entry, course, ground } = publishedGraph();
  const resources = new Map();
  const add = url => {
    const file = join(PUBLIC, url);
    assert.ok(existsSync(file), `${url} is published`);
    resources.set(url, readFileSync(file));
  };
  add(entry.manifest.url);
  add(course.groundManifest.url);
  add(course.routing.url);
  add(ground.shell.url);
  for (const tile of ground.tiles) {
    for (const kind of ['terrain', 'surface', 'objects', 'stands']) if (tile.layers[kind]) add(tile.layers[kind].url);
  }
  const verification = verifyAssetGraph({ root, resources, supportedFeatures: V2_SUPPORTED_FEATURES, strictResources: false });
  assert.ok(verification.chunks >= 64 + 64 + 1 + 1, `verified ${verification.chunks} chunks`);
});

test('the generation says how it was reviewed, and the seam still runs through the ground', () => {
  const evidence = JSON.parse(readFileSync(join(ROOT, 'geo_data/course-v2/puttom/vegetation/vegetation-evidence.json'), 'utf8'));
  assert.match(evidence.compile.review, /^machine review v1/, 'the records were approved by the versioned machine rules, not by a person, and the evidence says so');
  assert.ok(evidence.compile.records.records > 3000);
  assert.ok(evidence.compile.stands.tiles >= 60);
  const campaigns = JSON.parse(readFileSync(join(ROOT, 'geo_data/course-v2/puttom/acquisition/laser-campaigns.json'), 'utf8'));
  const { ground } = publishedGraph();
  assert.equal(campaigns.seams.length, 1);
  const [seam] = campaigns.seams;
  assert.equal(seam.axis, 'northing');
  assert.ok(seam.value > ground.bounds.minNorthing && seam.value < ground.bounds.maxNorthing);
  assert.deepEqual([...campaigns.activeItemIds].sort(), ['23f028-702_69', '26f015-702_69']);
  assert.deepEqual(campaigns.supersededItemIds, ['20f015-702_69']);
  /* the previous generation's manifests stay on disk, immutable */
  const groundDir = join(PUBLIC, 'grounds/puttom');
  assert.ok(readdirSync(groundDir).filter(name => /^ground-v2-[a-f0-9]{64}\.json$/.test(name)).length >= 2, 'the prior ground manifest is retained for rollback');
});
