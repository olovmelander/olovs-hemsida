import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSyntheticAssetGraph } from '../synthetic-fixture.mjs';
import { assetReferenceForChunk, readChunk, writeChunk } from '../chunk-node.mjs';
import { verifyAssetGraph } from '../graph-node.mjs';
import { V2_SUPPORTED_FEATURES } from '../schema.mjs';
import { STAND_FIELD_FEATURE, STAND_FIELD_FORMAT, encodeStandField } from '../stand-field.mjs';
import { canonicalJsonBytes } from '../canonical-json.mjs';
import { assembleVegetationGraph, vegetationPublicationReport } from './publish-vegetation.mjs';

function manifest(graph, url) {
  return JSON.parse(Buffer.from(graph.resources.get(url)).toString('utf8'));
}

test('a stand layer is attached to a published ground and the whole graph re-verifies', async () => {
  const graph = createSyntheticAssetGraph();
  const rootEntry = graph.root.courses.find(course => course.slug === 'synthetic-main');
  const courseManifest = manifest(graph, rootEntry.manifest.url);
  const groundManifest = manifest(graph, courseManifest.groundManifest.url);
  const routingContent = readChunk(graph.resources.get(courseManifest.routing.url)).content;
  const tile = groundManifest.tiles.find(entry => entry.id === 'l0/1/0');
  const field = encodeStandField({
    width: 2, height: 2, cellMetres: 64,
    fraction: Float32Array.from([0.8, 0.3, 0, Number.NaN]),
    meanHeight: Float32Array.from([14, 9, 0, Number.NaN]),
    p95Height: Float32Array.from([18, 11, 0, Number.NaN]),
    measured: Uint8Array.from([1, 1, 1, 0]),
    north: Uint8Array.from([0, 0, 0, 0]),
    excluded: Uint8Array.from([0, 0, 1, 0]),
  });
  const chunk = writeChunk({
    header: {
      schemaVersion: 2, id: tile.id, kind: 'stands', owner: { type: 'ground', id: groundManifest.groundId },
      bounds: tile.bounds, payloadFormat: STAND_FIELD_FORMAT,
      requiredFeatures: ['chunk-envelope-v2', STAND_FIELD_FEATURE], standField: field.standField,
    },
    payload: field.payload,
  });
  const reference = assetReferenceForChunk(chunk, { kind: 'stands', directory: `grounds/${groundManifest.groundId}/stands` });
  /* the chunks the ground itself references: shell, terrain, surface, and
     the fixture's existing object registry; routing is regenerated */
  const resources = new Map();
  resources.set(groundManifest.shell.url, graph.resources.get(groundManifest.shell.url));
  for (const entry of groundManifest.tiles) {
    for (const kind of ['terrain', 'surface', 'objects']) {
      if (entry.layers[kind]) resources.set(entry.layers[kind].url, graph.resources.get(entry.layers[kind].url));
    }
  }
  const emitted = await assembleVegetationGraph({
    slug: 'synthetic-main',
    rootEntry,
    courseManifest,
    groundManifest,
    routingContent,
    resources,
    layerChunks: new Map([[reference.url, chunk]]),
    standLayers: { [tile.id]: reference },
    sourceManifestSha256: groundManifest.sourceManifestSha256,
    replaceExistingLayers: false,
  });
  const newGround = manifest(emitted, emitted.references.ground.url);
  const published = newGround.tiles.find(entry => entry.id === tile.id);
  assert.deepEqual(published.layers.stands, reference);
  assert.equal(newGround.tiles.find(entry => entry.id === 'l0/0/0').layers.stands, null);
  assert.deepEqual(newGround.tiles.find(entry => entry.id === 'l0/0/0').layers.objects, groundManifest.tiles.find(entry => entry.id === 'l0/0/0').layers.objects, 'an existing object layer is kept when asked');
  assert.deepEqual(newGround.tiles.map(entry => entry.layers.terrain.sha256), groundManifest.tiles.map(entry => entry.layers.terrain.sha256), 'terrain untouched');
  assert.ok(newGround.requiredFeatures.includes(STAND_FIELD_FEATURE));
  assert.ok(newGround.requiredFeatures.includes('object-registry-json-v1'), 'the synthetic ground already published objects');
  /* routing heights are the published ones, so every line point keeps its height */
  const newRouting = readChunk(emitted.resources.get(emitted.references.routing.url)).content;
  assert.deepEqual(newRouting.holes.map(hole => hole.line), routingContent.holes.map(hole => hole.line));

  /* the default replaces: a tile without a new layer publishes none */
  const replaced = await assembleVegetationGraph({
    slug: 'synthetic-main', rootEntry, courseManifest, groundManifest, routingContent,
    resources: new Map([...resources].filter(([url]) => !url.includes('/objects/'))),
    layerChunks: new Map([[reference.url, chunk]]), standLayers: { [tile.id]: reference },
    sourceManifestSha256: groundManifest.sourceManifestSha256,
  });
  assert.equal(manifest(replaced, replaced.references.ground.url).tiles.find(entry => entry.id === 'l0/0/0').layers.objects, null);
  const verification = verifyAssetGraph({ root: emitted.root, resources: emitted.resources, supportedFeatures: V2_SUPPORTED_FEATURES, strictResources: true });
  assert.ok(verification.chunks > 0);
  /* the old ground manifest is a different document, so the root moved on */
  assert.notEqual(emitted.references.ground.sha256, courseManifest.groundManifest.sha256);
  assert.notEqual(emitted.references.course.sha256, rootEntry.manifest.sha256);
  const activeRootBytes = Buffer.from(canonicalJsonBytes(emitted.root));
  const report = vegetationPublicationReport({
    groundId: groundManifest.groundId,
    slug: 'synthetic-main',
    evidence: {
      observedOn: '2026-09-04', review: 'machine review fixture',
      candidates: { total: 1 }, records: { records: 1 }, stands: { tiles: 1 }, identity: { added: 1 },
    },
    graph: emitted,
    activeRootBytes,
    activeRootEntry: emitted.root.courses[0],
    objectTiles: 0,
    standTiles: 1,
    sourceManifestSha256: groundManifest.sourceManifestSha256,
    filesWritten: emitted.resources.size + 1,
  });
  assert.equal(report.activeRoot.sha256, createHash('sha256').update(activeRootBytes).digest('hex'));
  assert.equal(report.graph.courseManifest.sha256, emitted.references.course.sha256);
  assert.equal(report.graph.groundManifest.sha256, emitted.references.ground.sha256);
  assert.equal(report.graph.chunks, verification.chunks);
  assert.equal(report.vegetation.standTiles, 1);
  await assert.rejects(assembleVegetationGraph({
    slug: 'synthetic-main', rootEntry, courseManifest, groundManifest, routingContent, resources,
    layerChunks: new Map(), standLayers: { [tile.id]: reference }, sourceManifestSha256: groundManifest.sourceManifestSha256,
  }), /was not supplied/);

  /* Two courses on one ground -- the Veckefjärden shape. Publishing the same
     layers per slug against the same inputs must yield ONE ground manifest,
     and the merged root must verify; a single-slug publish leaves the other
     course on the old ground manifest, which the verifier refuses. */
  const slugs = ['synthetic-main', 'synthetic-short'];
  /* the real two-course ground (Veckefjärden) declares both slugs on every
     finest tile; the fixture keeps one single-course tile for other tests,
     so this section patches its copy to the shape under test */
  const sharedGround = {
    ...groundManifest,
    tiles: groundManifest.tiles.map(entry => ({ ...entry, courses: slugs })),
  };
  const perSlug = [];
  for (const slug of slugs) {
    const entry = graph.root.courses.find(course => course.slug === slug);
    const course = manifest(graph, entry.manifest.url);
    perSlug.push(await assembleVegetationGraph({
      slug, rootEntry: entry, courseManifest: course, groundManifest: sharedGround,
      routingContent: readChunk(graph.resources.get(course.routing.url)).content,
      /* replaceExistingLayers drops the fixture's object layer, so its chunk
         must not be handed over either -- the CLI never reads replaced ones */
      resources: new Map([...resources].filter(([url]) => !url.includes('/objects/'))),
      layerChunks: new Map([[reference.url, chunk]]),
      standLayers: { [tile.id]: reference },
      sourceManifestSha256: groundManifest.sourceManifestSha256,
      courseSlugs: slugs,
    }));
  }
  assert.equal(perSlug[0].references.ground.sha256, perSlug[1].references.ground.sha256,
    'one ground, one ground manifest, whichever course emitted it');
  const mergedRoot = { ...perSlug[0].root, courses: slugs.map((slug, i) => perSlug[i].root.courses.find(course => course.slug === slug)) };
  const mergedResources = new Map([...perSlug[0].resources, ...perSlug[1].resources]);
  /* not strict: the replaced object layer's old chunk legitimately remains in
     the map, the way old content-addressed files remain on disk */
  const both = verifyAssetGraph({ root: mergedRoot, resources: mergedResources, supportedFeatures: V2_SUPPORTED_FEATURES });
  assert.ok(both.chunks > 0, 'the merged two-course root verifies');
  /* leave synthetic-short on its previous manifest: the exact failure a
     one-slug vegetation publish would ship */
  const stale = { ...mergedRoot, courses: [mergedRoot.courses[0], graph.root.courses.find(course => course.slug === 'synthetic-short')] };
  const staleResources = new Map([...graph.resources, ...mergedResources]);
  assert.throws(() => verifyAssetGraph({ root: stale, resources: staleResources, supportedFeatures: V2_SUPPORTED_FEATURES }),
    /conflicting/);
});
