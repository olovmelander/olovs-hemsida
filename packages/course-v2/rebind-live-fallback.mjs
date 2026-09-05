#!/usr/bin/env node
/* Re-bind a published v2 ground graph to the LIVE GPK1 pack after the pack
   changed, re-using every published chunk byte for byte.

   The v2 root index and each course manifest carry the exact live GPK1 entry
   (fallbackV1: bytes, sha256, packUrl) and the runtime refuses a graph whose
   fallback is not the pack it can fetch -- so re-emitting a course's pack
   (a reconcile that adds a bunker, a re-traced pond) silently drops every
   flagless visit back to GPK1 until the graph is re-bound, and
   check-app-build fails the build. This is publish-vegetation's per-course
   loop with the object and stand layers taken from the PUBLISHED ground
   manifest instead of a compile directory, so it needs no LiDAR artifacts and
   no PROJ: the ground manifest comes out identical except for the source
   manifest hash, the course manifest gets the live fallback, and the root
   activates both. Superseded manifests stay on disk, content-addressed.

     node packages/course-v2/rebind-live-fallback.mjs <groundId>

   Run it after emit-pack + emit-manifest for any course with a published v2
   ground, then rebuild the app and run check-app-build and check-course-v2. */
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { assembleVegetationGraph, liveFallback } from './vegetation/publish-vegetation.mjs';
import { writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { readChunk } from './chunk-node.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
if (!process.argv[2]) { console.error('usage: node packages/course-v2/rebind-live-fallback.mjs <groundId>'); process.exit(2); }
const publicDir = path.join(ROOT, 'apps/golf/public');
const groundId = process.argv[2];
const read = url => fs.readFileSync(path.join(publicDir, url));
const root = JSON.parse(fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'), 'utf8'));
const groundCourses = root.courses.filter(c => JSON.parse(read(JSON.parse(read(c.manifest.url)).groundManifest.url)).groundId === groundId);
const slugs = groundCourses.map(c => c.slug);
const groundManifest = JSON.parse(read(JSON.parse(read(groundCourses[0].manifest.url)).groundManifest.url));
const resources = new Map(); resources.set(groundManifest.shell.url, read(groundManifest.shell.url));
const objectLayers = {}, standLayers = {}, layerChunks = new Map();
for (const tile of groundManifest.tiles) {
  resources.set(tile.layers.terrain.url, read(tile.layers.terrain.url));
  if (tile.layers.surface) resources.set(tile.layers.surface.url, read(tile.layers.surface.url));
  if (tile.layers.objects) { objectLayers[tile.id] = tile.layers.objects; layerChunks.set(tile.layers.objects.url, read(tile.layers.objects.url)); }
  if (tile.layers.stands) { standLayers[tile.id] = tile.layers.stands; layerChunks.set(tile.layers.stands.url, read(tile.layers.stands.url)); }
}
const manifestLf = fs.readFileSync(path.join(ROOT, 'geo_data/course-v2', groundId, 'source-manifest.json'), 'utf8').replace(/\r\n/g, '\n');
const sourceManifestSha256 = createHash('sha256').update(manifestLf).digest('hex');
const grounds = new Set();
for (const slug of slugs) {
  const rootEntry = root.courses.find(c => c.slug === slug);
  const courseManifest = JSON.parse(read(rootEntry.manifest.url));
  const routingContent = readChunk(read(courseManifest.routing.url)).content;
  const fallbackV1 = liveFallback(read, slug, rootEntry.fallbackV1);
  const graph = await assembleVegetationGraph({ slug, rootEntry, courseManifest, groundManifest, routingContent, resources, layerChunks,
    objectLayers, standLayers, sourceManifestSha256, readAsset: async url => read(url), courseSlugs: slugs, fallbackV1 });
  const written = await writeGroundGraphFiles(publicDir, graph);
  grounds.add(graph.references.ground.sha256);
  console.log(slug, 'fallback', rootEntry.fallbackV1.sha256.slice(0, 12), '->', fallbackV1.sha256.slice(0, 12),
    'course manifest', rootEntry.manifest.sha256.slice(0, 12), '->', graph.references.course.sha256.slice(0, 12),
    'ground manifest', JSON.parse(read(rootEntry.manifest.url)).groundManifest.sha256.slice(0, 12), '->', graph.references.ground.sha256.slice(0, 12),
    'objects', Object.keys(objectLayers).length, 'stands', Object.keys(standLayers).length, 'files written', written.length);
}
if (grounds.size !== 1) throw new Error('one ground must have one manifest');
