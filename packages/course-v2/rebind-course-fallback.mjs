#!/usr/bin/env node
/* Re-bind a published v2 course to the GPK1 pack the app can actually fetch.

   The v2 root index and each course manifest carry the exact live GPK1 entry
   (`fallbackV1`: bytes, sha256, packUrl). A rebuilt pack -- new heights, new
   traces, a new card -- changes that entry, and the runtime then refuses the
   graph because its fallback is not the pack it can fetch (check-app-build
   fails on the same comparison). publish-ground-rings re-binds as a side
   effect of republishing, but it needs the ring rasters in the acquisition
   cache, which a machine without the Lantmäteriet credential cannot rebuild.

   This does only the re-binding. The ground manifest is re-emitted from the
   PUBLISHED tiles with the same source-manifest hash, so it comes out
   byte-identical and is never rewritten (writeImmutable refuses a mismatch,
   which is the assertion); the routing chunk is re-derived from the same
   published heights; the course manifest gets the live fallback and a new
   content address; the root moves to it. Previous manifests stay on disk.

     node packages/course-v2/rebind-course-fallback.mjs --ground angso --slug angso [--public apps/golf/public]

   Nothing here touches the terrain, and it says so if it would have to. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { createPublishedGroundLookup, openPublishedGround } from './published-ground-lookup.mjs';
import { ringSpecFor } from './ground-rings-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function migratedCourse(groundId, slug, spec) {
  const declared = spec?.courseModels?.[slug] || null;
  const file = declared?.migration || 'course-model.epsg3006.json';
  const strokeIndexStatus = declared?.strokeIndexStatus || 'verified';
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, `geo_data/course-v2/${groundId}/migration/${file}`), 'utf8'));
  if (model.groundId !== groundId || !Array.isArray(model.geometry?.holes)) throw new Error(`migration model ${file} is missing its hole geometry`);
  return [...model.geometry.holes].sort((left, right) => left.n - right.n).map((hole, index) => {
    if (hole.n !== index + 1) throw new Error(`migrated holes are not numbered 1.. at ${hole.n}`);
    return {
      number: hole.n, par: hole.par,
      strokeIndex: strokeIndexStatus === 'not-applicable' ? null : hole.idx,
      strokeIndexStatus, accuracyTier: 'unrated',
      line: hole.line.map(([easting, northing]) => [easting, northing]),
    };
  });
}

async function main() {
  const groundId = flag('ground');
  if (!groundId) throw new Error('--ground is required');
  const slugs = String(flag('slug', groundId)).split(',').map(s => s.trim()).filter(Boolean);
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  const spec = ringSpecFor(groundId);
  const read = url => fs.readFileSync(path.join(publicDir, url));

  const root = JSON.parse(read('courses/v2-index.json').toString('utf8'));
  const live = JSON.parse(read('courses/index.json').toString('utf8'));
  const { ground, readAsset } = openPublishedGround(fs, path, publicDir, groundId);
  const lookup = createPublishedGroundLookup(ground, readAsset);

  /* the published compilation, exactly as the manifest states it */
  const resources = new Map();
  resources.set(ground.shell.url, read(ground.shell.url));
  for (const tile of ground.tiles) {
    for (const kind of ['terrain', 'surface', 'objects', 'stands']) {
      const layer = tile.layers?.[kind];
      if (layer?.url) resources.set(layer.url, read(layer.url));
    }
  }
  const compilation = {
    groundId,
    courseSlugs: [...new Set(ground.tiles.flatMap(tile => tile.courses))],
    bounds: ground.bounds,
    shell: ground.shell,
    tiles: ground.tiles,
    resources,
  };

  const reports = [];
  for (const slug of slugs) {
    const entry = root.courses.find(course => course.slug === slug);
    if (!entry) throw new Error(`root index has no course ${slug}`);
    const liveEntry = live.courses.find(course => course.slug === slug);
    if (!liveEntry?.sha256 || !Number.isSafeInteger(liveEntry.bytes) || typeof liveEntry.packUrl !== 'string') {
      throw new Error(`courses/index.json has no fetchable GPK1 entry for ${slug}`);
    }
    const fallbackV1 = { bytes: liveEntry.bytes, format: 1, packUrl: liveEntry.packUrl, sha256: liveEntry.sha256 };
    const unchanged = entry.fallbackV1.sha256 === fallbackV1.sha256 && entry.fallbackV1.bytes === fallbackV1.bytes;
    const graph = emitGroundGraph({
      compilation,
      frame: ground.frame,
      sourceManifestSha256: ground.sourceManifestSha256,
      course: { slug, name: entry.name, holes: migratedCourse(groundId, slug, spec) },
      fallbackV1,
      heightAt: (easting, northing) => lookup.heightAt(easting, northing),
    });
    const publishedGroundSha = JSON.parse(read(entry.manifest.url).toString('utf8')).groundManifest.sha256;
    if (graph.report.groundManifestSha256 !== publishedGroundSha) {
      throw new Error(`re-emitting ${groundId} from its published tiles produced ground manifest ${graph.report.groundManifestSha256}, not the published ${publishedGroundSha}; this tool only re-binds and will not move a ground`);
    }
    const written = await writeGroundGraphFiles(publicDir, graph);
    reports.push({
      slug,
      previousCourseManifest: entry.manifest.url,
      courseManifestSha256: graph.report.courseManifestSha256,
      groundManifestSha256: graph.report.groundManifestSha256,
      routingSha256: graph.report.routingSha256,
      fallbackV1,
      fallbackChanged: !unchanged,
      filesWritten: written.length,
    });
  }
  console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
}

await main();
