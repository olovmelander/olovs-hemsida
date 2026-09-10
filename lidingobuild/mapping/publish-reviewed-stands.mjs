#!/usr/bin/env node
/* Publish Lidingö's rebuilt tee exclusions onto the existing terrain rings.
 * Compile/review stands and refresh the source ledger first. Dry run by default;
 * --write updates only the local Lidingö graph and its diagnostic report. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { writeGroundGraphFiles } from '../../packages/course-v2/emit-ground-graph-node.mjs';
import { attachLidingoStands } from '../../packages/course-v2/vegetation/compile-lidingo-stands.mjs';
import { assembleVegetationGraph, liveFallback } from '../../packages/course-v2/vegetation/publish-vegetation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertLidingoTerrainPreserved(previous, next) {
  for (const field of ['groundId', 'bounds', 'frame', 'shell']) assert.deepEqual(next[field], previous[field], `Preserve ${field}`);
  assert.equal(next.tiles.length, previous.tiles.length, 'Preserve terrain tile count');
  for (const tile of previous.tiles) {
    const after = next.tiles.find(t => t.id === tile.id);
    assert.ok(after, `Preserve tile ${tile.id}`);
    for (const field of ['id', 'lod', 'parentId', 'bounds', 'geometricErrorMetres', 'courses']) {
      assert.deepEqual(after[field], tile[field], `Preserve ${tile.id}.${field}`);
    }
    for (const kind of ['terrain', 'surface', 'objects']) assert.deepEqual(after.layers[kind] ?? null, tile.layers[kind] ?? null, `Preserve ${tile.id}.${kind}`);
    if (tile.lod !== 0) assert.deepEqual(after.layers.stands ?? null, tile.layers.stands ?? null, `Preserve coarse stands ${tile.id}`);
  }
}

export async function prepareLidingoStandPublication() {
  const snapshots = new Map();
  const readFile = file => { const bytes = fs.readFileSync(file); snapshots.set(file, sha(bytes)); return bytes; };
  const read = url => readFile(path.join(PUBLIC, url));
  const reference = ref => {
    const bytes = read(ref.url);
    assert.equal(bytes.length, ref.bytes, `Reference byte count ${ref.url}`);
    assert.equal(sha(bytes), ref.sha256, `Reference hash ${ref.url}`);
    return bytes;
  };
  const root = JSON.parse(read('courses/v2-index.json'));
  const entry = root.courses.find(c => c.slug === 'lidingo');
  assert.ok(entry, 'Published Lidingö entry');
  const course = JSON.parse(reference(entry.manifest));
  const ground = JSON.parse(reference(course.groundManifest));
  const routing = readChunk(reference(course.routing)).content;
  const sourceBytes = readFile(path.join(ROOT, 'geo_data/course-v2/lidingo/source-manifest.json'));
  const indexFile = path.join(ROOT, 'lidingobuild/cache/vegetation/stands-stage/layer-index.json');
  const index = JSON.parse(readFile(indexFile));
  for (const input of index.inputs) readFile(path.join(ROOT, input.path));
  const resources = new Map();
  for (const ref of [ground.shell, ...ground.tiles.flatMap(t => Object.values(t.layers).filter(Boolean))]) {
    if (!resources.has(ref.url)) resources.set(ref.url, reference(ref));
  }
  // The existing attachment validates every new source hash, tile identity,
  // retained chunk checksum and the exact original 64-tile finest extent.
  const attached = await attachLidingoStands({ groundId: 'lidingo', tiles: ground.tiles, resources }, ground.frame);
  const layerChunks = new Map();
  for (const ref of Object.values(index.standLayers)) {
    const file = path.join(ROOT, index.resourceRoot, ref.url);
    const bytes = readFile(file);
    assert.equal(sha(bytes), ref.sha256, `Retained stand identity ${ref.url}`);
    layerChunks.set(ref.url, attached.resources.get(ref.url));
  }
  const standLayers = { ...Object.fromEntries(ground.tiles.filter(t => t.lod !== 0 && t.layers.stands).map(t => [t.id, t.layers.stands])), ...index.standLayers };
  const objectLayers = Object.fromEntries(ground.tiles.filter(t => t.layers.objects).map(t => [t.id, t.layers.objects]));
  const fallback = liveFallback(read, 'lidingo', null);
  assert.ok(fallback, 'Current published pack identity');
  const pack = read(fallback.packUrl);
  assert.equal(pack.length, fallback.bytes, 'Published pack byte count');
  assert.equal(sha(pack), fallback.sha256, 'Published pack hash');
  const sourceManifestSha256 = sha(sourceBytes.toString('utf8').replace(/\r\n/g, '\n'));
  // Retired finest stand chunks stay on disk for rollback, but cannot remain
  // in the strict resource graph after their layer references are replaced.
  const retainedUrls = new Set([ground.shell.url, ...ground.tiles.flatMap(tile =>
    ['terrain', 'surface', 'objects', ...(tile.lod === 0 ? [] : ['stands'])]
      .map(kind => tile.layers[kind]?.url).filter(Boolean))]);
  const retainedResources = new Map([...resources].filter(([url]) => retainedUrls.has(url)));
  const graph = await assembleVegetationGraph({ slug: 'lidingo', rootEntry: entry,
    courseManifest: course, groundManifest: ground, routingContent: routing,
    resources: retainedResources, layerChunks, objectLayers, standLayers, sourceManifestSha256, fallbackV1: fallback });
  const nextGround = JSON.parse(Buffer.from(graph.resources.get(graph.references.ground.url)));
  assertLidingoTerrainPreserved(ground, nextGround);
  const nextRouting = readChunk(graph.resources.get(graph.references.routing.url)).content;
  assert.deepEqual(nextRouting.holes.map(h => h.line), routing.holes.map(h => h.line), 'Preserve route geometry and source terrain heights');
  const changedTiles = ground.tiles.filter(t => t.layers.stands?.sha256 !== nextGround.tiles.find(n => n.id === t.id).layers.stands?.sha256).map(t => t.id);
  return { graph, snapshots, report: { schemaVersion: 1, kind: 'lidingo-reviewed-tee-stand-publication', groundId: 'lidingo',
    sourceManifestSha256, previousGroundManifest: course.groundManifest,
    groundManifest: graph.references.ground, courseManifest: graph.references.course,
    routingSha256: graph.references.routing.sha256, fallbackV1: fallback,
    preservedTerrainTiles: ground.tiles.length, preservedTerrainBounds: ground.bounds,
    preservedFrameFingerprint: ground.frame.fingerprint, preservedRoutingCoordinates: true,
    changedStandTiles: changedTiles, standLayers: Object.keys(index.standLayers).length } };
}

export async function publishLidingoStandPlan(plan) {
  for (const [file, hash] of plan.snapshots) assert.equal(sha(fs.readFileSync(file)), hash, `Input changed: ${file}`);
  await writeGroundGraphFiles(PUBLIC, plan.graph);
  const rootBytes = fs.readFileSync(path.join(PUBLIC, 'courses/v2-index.json'));
  const root = JSON.parse(rootBytes), active = root.courses.find(c => c.slug === 'lidingo');
  assert.deepEqual(active.manifest, plan.graph.references.course);
  const previousFile = path.join(PUBLIC, 'lidingo-ground-graph-report.json');
  const previous = JSON.parse(fs.readFileSync(previousFile));
  previous.graph = { ...plan.graph.report, rootBytes: rootBytes.length, rootSha256: sha(rootBytes) };
  previous.teeAlignmentPublication = plan.report;
  previous.terrainScope = 'Historical initial-pyramid compilation statistics above; current graph retains the complete published 277-tile terrain ring hierarchy.';
  fs.writeFileSync(previousFile, JSON.stringify(previous, null, 2) + '\n');
  const report = { ...plan.report, state: 'published-locally', graph: previous.graph };
  fs.writeFileSync(path.join(ROOT, 'lidingobuild/mapping/tee-stand-publication.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = await prepareLidingoStandPublication();
  console.log(JSON.stringify(process.argv.includes('--write') ? await publishLidingoStandPlan(plan) : { ...plan.report, state: 'dry-run' }, null, 2));
}
