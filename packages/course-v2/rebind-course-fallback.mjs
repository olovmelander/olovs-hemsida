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

   Nothing here touches the terrain, and it says so if it would have to.

   The one thing it may change about a ground is WHICH COURSES stand on it.
   A ground manifest lists its courses per tile, so a second course on a
   published ground (the Johannesberg nine on the eighteen's 64 tiles) is a
   new ground manifest that differs from the published one in that list and
   nothing else -- and every course of the ground must then be re-emitted
   against it in one run, or the root carries two ground manifests for one
   ground and refuses to verify. `--add-slug` does exactly that, and asserts
   the "nothing else": the two ground manifests must be identical once the
   per-tile course lists are removed from both.

     node packages/course-v2/rebind-course-fallback.mjs --ground johannesberg \
       --add-slug johannesberg-9 --migration nine-course-model.epsg3006.json \
       --stroke-index-status unverified --accuracy-tier D

   The added course's hole metadata comes from those flags; a course already
   in the root keeps the metadata its published manifest carries, so a
   re-emit changes no course's own claim about itself. A ground with no ring
   specification (a fixed frontier) is served from its published manifests
   alone. `--output <directory>` stages the complete graph in a separate
   public directory, leaving the input root untouched for a coordinated merge. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { createPublishedGroundLookup, openPublishedGround } from './published-ground-lookup.mjs';
import { GROUND_RINGS } from './ground-rings-registry.mjs';
import { COURSE_MODEL_PATHS } from '../course-geo/acquisition/hole-source-controls.mjs';
import { readChunk } from './chunk-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const STROKE_INDEX_STATUSES = new Set(['verified', 'unverified', 'not-applicable']);
const ACCURACY_TIERS = new Set(['A', 'B', 'C', 'D', 'E', 'unrated']);

/* Which migration model a course is read from and what it claims about its
   holes: the ring registry's declaration where the ground has one, the
   published course manifest's own metadata where it does not (the model file
   then comes from the acquisition registry's fail-closed path table), and
   the CLI flags for a course being added. */
function registeredModelFile(groundId, slug) {
  const registered = COURSE_MODEL_PATHS[slug];
  const prefix = `geo_data/course-v2/${groundId}/migration/`;
  return registered && registered.startsWith(prefix) ? registered.slice(prefix.length) : null;
}

function courseModelSpec(groundId, slug, { spec, published, added }) {
  const declared = spec?.courseModels?.[slug] || null;
  if (added) {
    if (!added.migration) throw new Error(`--migration is required to add ${slug}`);
    if (!STROKE_INDEX_STATUSES.has(added.strokeIndexStatus)) throw new Error(`--stroke-index-status must be one of ${[...STROKE_INDEX_STATUSES].join(', ')}`);
    if (!ACCURACY_TIERS.has(added.accuracyTier)) throw new Error(`--accuracy-tier must be one of ${[...ACCURACY_TIERS].join(', ')}`);
    return { file: added.migration, strokeIndexStatus: added.strokeIndexStatus, accuracyTier: added.accuracyTier };
  }
  if (published) {
    const statuses = new Set(published.holes.map(hole => hole.strokeIndexStatus));
    const tiers = new Set(published.holes.map(hole => hole.accuracyTier));
    if (statuses.size !== 1 || tiers.size !== 1) throw new Error(`published ${slug} carries mixed hole metadata; declare it explicitly`);
    return {
      file: declared?.migration || registeredModelFile(groundId, slug) || (slug === groundId ? 'course-model.epsg3006.json' : null),
      strokeIndexStatus: [...statuses][0],
      accuracyTier: [...tiers][0],
    };
  }
  if (declared) {
    return { file: declared.migration, strokeIndexStatus: declared.strokeIndexStatus || 'verified', accuracyTier: 'unrated' };
  }
  return { file: registeredModelFile(groundId, slug) || 'course-model.epsg3006.json', strokeIndexStatus: 'verified', accuracyTier: 'unrated' };
}

function migratedCourse(repoRoot, groundId, slug, { file, strokeIndexStatus, accuracyTier }) {
  if (!file) throw new Error(`no migration model is declared for ${slug} on ground ${groundId}; the ring registry or --migration must name it`);
  const model = JSON.parse(fs.readFileSync(path.join(repoRoot, `geo_data/course-v2/${groundId}/migration/${file}`), 'utf8'));
  if (model.groundId !== groundId || !Array.isArray(model.geometry?.holes)) throw new Error(`migration model ${file} is missing its hole geometry`);
  if (!model.source?.path || !model.source.sha256) throw new Error(`migration model ${file} does not identify its source model`);
  const sourceBytes = fs.readFileSync(path.resolve(repoRoot, model.source.path), 'utf8').replace(/\r\n/g, '\n');
  if (createHash('sha256').update(sourceBytes).digest('hex') !== model.source.sha256) {
    throw new Error(`migration model ${file} is stale; regenerate it from the current source model`);
  }
  return [...model.geometry.holes].sort((left, right) => left.n - right.n).map((hole, index) => {
    if (hole.n !== index + 1) throw new Error(`migrated holes are not numbered 1.. at ${hole.n}`);
    return {
      number: hole.n, par: hole.par,
      strokeIndex: strokeIndexStatus === 'not-applicable' ? null : hole.idx,
      strokeIndexStatus, accuracyTier,
      line: hole.line.map(([easting, northing]) => [easting, northing]),
    };
  });
}

/* the ground manifest with every tile's course list removed: what a course
   addition must leave untouched */
function groundManifestWithoutCourses(manifest) {
  return JSON.stringify({
    ...manifest,
    tiles: manifest.tiles.map(({ courses, ...tile }) => tile),
  });
}

/** Prepare all courses before writing, so a rejected addition cannot move only
    some siblings onto the new shared ground manifest. */
export function prepareCourseFallbackRebind({
  repoRoot = ROOT,
  publicDir = path.join(repoRoot, 'apps/golf/public'),
  groundId,
  addSlug = null,
  added = null,
  slugs: requestedSlugs = [groundId],
} = {}) {
  if (!groundId) throw new Error('--ground is required');
  const spec = GROUND_RINGS[groundId] || null;
  if (spec && spec.groundId !== groundId) throw new Error(`ring specification registered as ${groundId} declares groundId ${spec.groundId}`);
  const read = url => fs.readFileSync(path.join(publicDir, url));

  const root = JSON.parse(read('courses/v2-index.json').toString('utf8'));
  const live = JSON.parse(read('courses/index.json').toString('utf8'));
  const { ground, readAsset } = openPublishedGround(fs, path, publicDir, groundId);
  const lookup = createPublishedGroundLookup(ground, readAsset);
  /* every root course standing on this ground, resolved through its own
     manifest (the vegetation publisher's rule): an addition re-emits them all */
  const groundCourses = root.courses.filter(course =>
    JSON.parse(read(JSON.parse(read(course.manifest.url).toString('utf8')).groundManifest.url).toString('utf8')).groundId === groundId);
  if (!groundCourses.length) throw new Error(`root index has no course on ground ${groundId}`);
  if (addSlug && root.courses.some(course => course.slug === addSlug)) throw new Error(`${addSlug} is already published; rebind it without --add-slug`);
  if (addSlug && !added) throw new Error(`migration and hole metadata are required to add ${addSlug}`);
  const slugs = addSlug
    ? [...groundCourses.map(course => course.slug), addSlug]
    : requestedSlugs;

  /* the published compilation, exactly as the manifest states it */
  const resources = new Map();
  resources.set(ground.shell.url, read(ground.shell.url));
  for (const tile of ground.tiles) {
    for (const kind of ['terrain', 'surface', 'objects', 'stands']) {
      const layer = tile.layers?.[kind];
      if (layer?.url) resources.set(layer.url, read(layer.url));
    }
  }
  const tiles = addSlug
    ? ground.tiles.map(tile => ({ ...tile, courses: [...new Set([...tile.courses, addSlug])].sort() }))
    : ground.tiles;
  const compilation = {
    groundId,
    courseSlugs: [...new Set(tiles.flatMap(tile => tile.courses))],
    bounds: ground.bounds,
    shell: ground.shell,
    tiles,
    resources,
  };

  const reports = [], graphs = [];
  for (const slug of slugs) {
    const entry = root.courses.find(course => course.slug === slug) || null;
    if (!entry && slug !== addSlug) throw new Error(`root index has no course ${slug}`);
    const liveEntry = live.courses.find(course => course.slug === slug);
    if (!liveEntry?.sha256 || !Number.isSafeInteger(liveEntry.bytes) || typeof liveEntry.packUrl !== 'string' || !liveEntry.name) {
      throw new Error(`courses/index.json has no fetchable GPK1 entry for ${slug}`);
    }
    const fallbackV1 = { bytes: liveEntry.bytes, format: 1, packUrl: liveEntry.packUrl, sha256: liveEntry.sha256 };
    const packBytes = read(fallbackV1.packUrl);
    if (packBytes.length !== fallbackV1.bytes || createHash('sha256').update(packBytes).digest('hex') !== fallbackV1.sha256) {
      throw new Error(`published GPK1 entry is stale or corrupt for ${slug}`);
    }
    const unchanged = Boolean(entry) && entry.fallbackV1.sha256 === fallbackV1.sha256 && entry.fallbackV1.bytes === fallbackV1.bytes;
    const published = entry ? JSON.parse(read(entry.manifest.url).toString('utf8')) : null;
    const modelSpec = courseModelSpec(groundId, slug, { spec, published, added: slug === addSlug ? added : null });
    const holes = migratedCourse(repoRoot, groundId, slug, modelSpec);
    if (holes.length !== liveEntry.holes || holes.reduce((sum, hole) => sum + hole.par, 0) !== liveEntry.par) {
      throw new Error(`migration card disagrees with the live ${slug} course`);
    }
    const knownHeights = new Map(published ? readChunk(read(published.routing.url)).content.holes
      .flatMap(hole => hole.line.map(([easting, northing, height]) => [`${easting},${northing}`, height])) : []);
    const graph = emitGroundGraph({
      compilation,
      frame: ground.frame,
      sourceManifestSha256: ground.sourceManifestSha256,
      course: { slug, name: entry?.name || liveEntry.name, holes },
      fallbackV1,
      heightAt: (easting, northing) => knownHeights.get(`${easting},${northing}`) ?? lookup.heightAt(easting, northing),
    });
    if (addSlug) {
      /* the tiles' course lists are the ONLY difference an addition may make */
      const publishedGround = JSON.parse(read(JSON.parse(read(groundCourses[0].manifest.url).toString('utf8')).groundManifest.url).toString('utf8'));
      const emittedGround = JSON.parse(new TextDecoder().decode(graph.resources.get(graph.references.ground.url)));
      if (groundManifestWithoutCourses(emittedGround) !== groundManifestWithoutCourses(publishedGround)) {
        throw new Error(`adding ${addSlug} to ${groundId} changed more than the tiles' course lists; this tool will not move a ground`);
      }
    } else if (graph.report.groundManifestSha256 !== published.groundManifest.sha256) {
      throw new Error(`re-emitting ${groundId} from its published tiles produced ground manifest ${graph.report.groundManifestSha256}, not the published ${published.groundManifest.sha256}; this tool only re-binds and will not move a ground`);
    }
    graphs.push(graph);
    reports.push({
      slug,
      previousCourseManifest: entry?.manifest.url || null,
      courseManifestSha256: graph.report.courseManifestSha256,
      groundManifestSha256: graph.report.groundManifestSha256,
      routingSha256: graph.report.routingSha256,
      fallbackV1,
      fallbackChanged: !unchanged,
    });
  }
  const groundManifests = new Set(reports.map(report => report.groundManifestSha256));
  if (groundManifests.size !== 1) {
    throw new Error(`emitting ${slugs.join(', ')} produced ${groundManifests.size} ground manifests; one ground must have one`);
  }
  return { graphs, reports };
}

async function main() {
  const groundId = flag('ground');
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  const outputDir = path.resolve(ROOT, flag('output', publicDir));
  const addSlug = flag('add-slug');
  const { graphs, reports } = prepareCourseFallbackRebind({
    groundId, publicDir, addSlug,
    added: addSlug ? {
      migration: flag('migration'),
      strokeIndexStatus: flag('stroke-index-status'),
      accuracyTier: flag('accuracy-tier'),
    } : null,
    slugs: String(flag('slug', groundId)).split(',').map(s => s.trim()).filter(Boolean),
  });
  for (let index = 0; index < graphs.length; index++) {
    reports[index].filesWritten = (await writeGroundGraphFiles(outputDir, graphs[index])).length;
  }
  console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
