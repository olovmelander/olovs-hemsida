#!/usr/bin/env node
/* Publish a compiled vegetation generation into the v2 graph: the existing
   ground's terrain, surface and routing references are kept byte for byte,
   the compiled object registries and stand fields are attached as tile
   layers, and the ground manifest, course manifest and root index are
   re-emitted through the same emitter and verification the terrain went
   through. Old manifests stay on disk, immutable, so a rollback is one root
   reference.

   usage: node packages/course-v2/vegetation/publish-vegetation.mjs
            --ground puttom [--slug a,b] --compile <compile dir> [--public apps/golf/public]

   One ground, one ground manifest: a ground carrying several published
   courses (veckefjarden + veckefjarden-korthalsbanan) must re-emit ALL of
   them in one run against the same layers and source-manifest hash, or
   verifyAssetGraph refuses the ground as "referenced with conflicting
   manifests" -- the same lesson publish-ground-rings already carries. By
   default every root course standing on the ground is published; --slug may
   restate the list but never shrink it.

   Refuses a compile directory whose evidence says it was a harness
   auto-approval: that path exists to prove the pipeline, never to publish.  */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from '../emit-ground-graph-node.mjs';
import { createGroundSampler } from './ground-sampler.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Build the mutable evidence report for the exact vegetation generation the
    root serves after publication. The report is deliberately not a graph
    resource: manifests/chunks remain content-addressed, while this file gives
    operators one current, readable publication summary. */
export function vegetationPublicationReport({
  groundId,
  slug,
  evidence,
  graph,
  activeRootBytes,
  activeRootEntry,
  objectTiles,
  standTiles,
  sourceManifestSha256,
  filesWritten,
}) {
  if (activeRootEntry?.manifest?.sha256 !== graph.references.course.sha256) {
    throw new Error(`published root did not activate emitted course manifest for ${slug}`);
  }
  return {
    schemaVersion: 1,
    kind: 'vegetation-graph-publication',
    state: 'published',
    groundId,
    slug,
    observedOn: evidence.observedOn,
    review: evidence.review,
    activeRoot: {
      url: 'courses/v2-index.json',
      bytes: activeRootBytes.byteLength,
      sha256: sha256(activeRootBytes),
    },
    graph: {
      frameFingerprint: graph.report.frameFingerprint,
      courseManifest: graph.references.course,
      groundManifest: graph.references.ground,
      routing: graph.references.routing,
      sourceManifestSha256,
      fallbackV1: activeRootEntry.fallbackV1,
      holes: graph.report.holes,
      tiles: graph.report.tiles,
      finestTiles: graph.report.finestTiles,
      shellBytes: graph.report.shellBytes,
      chunks: graph.report.chunks,
      encodedChunkBytes: graph.report.encodedChunkBytes,
      decodedChunkBytes: graph.report.decodedChunkBytes,
    },
    vegetation: {
      objectTiles,
      standTiles,
      candidates: evidence.candidates,
      records: evidence.records,
      stands: evidence.stands,
      identity: evidence.identity,
    },
    filesWritten,
  };
}

/**
 * Assemble the new graph in memory. `resources` holds every existing chunk
 * the ground and course reference (url -> bytes); `layerChunks` the new
 * object/stand chunk bytes by url; `objectLayers`/`standLayers` map tile ids
 * to asset references.
 */
export async function assembleVegetationGraph({
  slug,
  rootEntry,
  courseManifest,
  groundManifest,
  routingContent,
  resources,
  layerChunks,
  objectLayers = {},
  standLayers = {},
  sourceManifestSha256,
  readAsset,
  /* every course this ground serves; the emitted ground manifest is identical
     for all of them, so a multi-slug publish loops this function per slug
     against the same inputs and asserts one ground manifest hash */
  courseSlugs = null,
  /* the GPK1 entry the app will fetch; defaults to the previous root's copy */
  fallbackV1 = null,
  /* a vegetation generation replaces the previous one wholesale: a tile that
     publishes nothing now has nothing, so felled ground does not keep stale
     trees; pass false only to add layers beside an unrelated existing set */
  replaceExistingLayers = true,
}) {
  if (!(resources instanceof Map) || !(layerChunks instanceof Map)) throw new TypeError('resources and layerChunks must be Maps');
  const groundId = groundManifest.groundId;
  const merged = new Map([...resources, ...layerChunks]);
  const compilation = {
    groundId,
    courseSlugs: courseSlugs && courseSlugs.length ? courseSlugs : [slug],
    resources: merged,
    shell: groundManifest.shell,
    bounds: groundManifest.bounds,
    tiles: groundManifest.tiles.map(tile => ({
      id: tile.id,
      lod: tile.lod,
      /* the ring quadtree's explicit parent link: levels do not share an index
         lattice, so the tile manager reads this instead of deriving it.
         Dropping it silently broke the ring-graph world on every ground this
         publisher touched -- the app fell back to the fixed frontier and only
         a latent cutout contract made anything fail loudly. */
      ...(tile.parentId !== undefined ? { parentId: tile.parentId } : {}),
      bounds: tile.bounds,
      geometricErrorMetres: tile.geometricErrorMetres,
      courses: tile.courses,
      layers: {
        terrain: tile.layers.terrain,
        surface: tile.layers.surface ?? null,
        objects: objectLayers[tile.id] ?? (replaceExistingLayers ? null : tile.layers.objects ?? null),
        stands: standLayers[tile.id] ?? (replaceExistingLayers ? null : tile.layers.stands ?? null),
      },
    })),
  };
  for (const tile of compilation.tiles) {
    for (const kind of ['objects', 'stands']) {
      const reference = tile.layers[kind];
      if (reference && !merged.has(reference.url)) throw new Error(`tile ${tile.id} ${kind} chunk ${reference.url} was not supplied`);
    }
  }
  /* routing heights: the ones already published, so the routing chunk is
     byte-identical; the sampler only backs a point the routing never had */
  const known = new Map();
  for (const hole of routingContent.holes) for (const [e, n, h] of hole.line) known.set(`${e},${n}`, h);
  const sampler = readAsset ? await createGroundSampler(groundManifest, readAsset) : null;
  const heightAt = (easting, northing) => {
    const hit = known.get(`${easting},${northing}`);
    if (Number.isFinite(hit)) return hit;
    if (!sampler) return Number.NaN;
    return Number.NaN;
  };
  const holes = courseManifest.holes.map(hole => {
    const routed = routingContent.holes.find(entry => entry.number === hole.number);
    if (!routed) throw new Error(`routing chunk lacks hole ${hole.number}`);
    return {
      number: hole.number,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      strokeIndexStatus: hole.strokeIndexStatus,
      accuracyTier: hole.accuracyTier,
      line: routed.line.map(([e, n]) => [e, n]),
    };
  });
  return emitGroundGraph({
    compilation,
    frame: groundManifest.frame,
    sourceManifestSha256,
    course: { slug, name: rootEntry.name, holes },
    fallbackV1: fallbackV1 ?? rootEntry.fallbackV1,
    heightAt,
  });
}

/* The GPK1 entry the app will actually fetch, from the live course manifest --
   the same rule as publish-ground-rings: a course whose pack changed re-binds
   here, and the runtime refuses a graph whose fallback is not the pack it can
   fetch. Falls back to the previous root's copy when the live index is absent
   (unit fixtures) or does not know the slug. */
export function liveFallback(read, slug, previous) {
  let manifest;
  try { manifest = JSON.parse(read('courses/index.json').toString('utf8')); } catch { return previous; }
  const entry = (manifest.courses || []).find(course => course.slug === slug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || typeof entry.packUrl !== 'string') return previous;
  return { bytes: entry.bytes, format: 1, packUrl: entry.packUrl, sha256: entry.sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const groundId = flag('ground');
  const compileDir = flag('compile');
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  if (!groundId || !compileDir) {
    console.error('usage: --ground <id> [--slug <a,b>] --compile <dir> [--public <dir>]');
    process.exit(2);
  }
  const evidence = JSON.parse(fs.readFileSync(path.join(compileDir, 'evidence.json'), 'utf8'));
  if (!evidence.review || /^HARNESS/.test(evidence.review)) {
    console.error('refusing to publish a harness auto-approval; compile with --machine-review or an approvals file');
    process.exit(1);
  }
  const rootBytes = fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'));
  const root = JSON.parse(rootBytes.toString('utf8'));
  const read = url => fs.readFileSync(path.join(publicDir, url));
  /* every root course standing on this ground, resolved through its own
     manifest -- the set a run must cover, or the courses left out keep the
     pre-vegetation ground manifest and the merged root stops verifying */
  const groundCourses = root.courses.filter(course => {
    const manifest = JSON.parse(read(course.manifest.url).toString('utf8'));
    return JSON.parse(read(manifest.groundManifest.url).toString('utf8')).groundId === groundId;
  });
  if (!groundCourses.length) throw new Error(`root index has no course on ground ${groundId}`);
  const slugs = (flag('slug', null) || groundCourses.map(course => course.slug).join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const missing = groundCourses.map(course => course.slug).filter(value => !slugs.includes(value));
  if (missing.length) {
    throw new Error(`ground ${groundId} also serves ${missing.join(', ')}; a vegetation publish must re-emit every course of a ground in one run`);
  }
  for (const value of slugs) {
    if (!groundCourses.some(course => course.slug === value)) throw new Error(`course ${value} does not stand on ground ${groundId}`);
  }
  const groundManifest = JSON.parse(read(JSON.parse(read(groundCourses[0].manifest.url).toString('utf8')).groundManifest.url).toString('utf8'));
  /* the routing chunk is regenerated by the emitter from the published
     heights, so it is not carried as a resource: identical bytes land on the
     same content-addressed name, and a changed line gets a new one */
  const resources = new Map();
  resources.set(groundManifest.shell.url, read(groundManifest.shell.url));
  for (const tile of groundManifest.tiles) {
    resources.set(tile.layers.terrain.url, read(tile.layers.terrain.url));
    if (tile.layers.surface) resources.set(tile.layers.surface.url, read(tile.layers.surface.url));
  }
  const objectLayers = JSON.parse(fs.readFileSync(path.join(compileDir, 'layers.json'), 'utf8'));
  const standLayers = fs.existsSync(path.join(compileDir, 'stand-layers.json'))
    ? JSON.parse(fs.readFileSync(path.join(compileDir, 'stand-layers.json'), 'utf8')) : {};
  const layerChunks = new Map();
  for (const reference of Object.values(objectLayers)) layerChunks.set(reference.url, fs.readFileSync(path.join(compileDir, 'objects', `${reference.sha256}.bvch`)));
  for (const reference of Object.values(standLayers)) layerChunks.set(reference.url, fs.readFileSync(path.join(compileDir, 'stands', `${reference.sha256}.bvch`)));
  /* the source manifest as CI sees it: LF, whatever this checkout did to it */
  const manifestPath = path.join(ROOT, 'geo_data/course-v2', groundId, 'source-manifest.json');
  const manifestLf = fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n');
  const sourceManifestSha256 = sha256(manifestLf);
  const objectTiles = Object.keys(objectLayers).length;
  const standTiles = Object.keys(standLayers).length;
  /* every course of the ground, against the SAME layers and hash: the emitted
     ground manifest must come out content-identical for all of them */
  const reports = [];
  for (const slug of slugs) {
    const rootEntry = root.courses.find(course => course.slug === slug);
    const courseManifest = JSON.parse(read(rootEntry.manifest.url).toString('utf8'));
    const routingContent = readChunk(read(courseManifest.routing.url)).content;
    const graph = await assembleVegetationGraph({
      slug, rootEntry, courseManifest, groundManifest, routingContent, resources, layerChunks,
      objectLayers, standLayers, sourceManifestSha256, readAsset: async url => read(url),
      courseSlugs: slugs,
      /* the exact LIVE GPK1 entry, never the previous root's copy -- the same
         re-binding rule publish-ground-rings carries */
      fallbackV1: liveFallback(read, slug, rootEntry.fallbackV1),
    });
    const written = await writeGroundGraphFiles(publicDir, graph);
    const activeRootBytes = fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'));
    const activeRootEntry = JSON.parse(activeRootBytes.toString('utf8')).courses.find(course => course.slug === slug);
    reports.push(vegetationPublicationReport({
      groundId, slug, evidence, graph, activeRootBytes, activeRootEntry,
      objectTiles, standTiles, sourceManifestSha256, filesWritten: written.length,
    }));
  }
  const groundManifests = new Set(reports.map(entry => entry.graph.groundManifest.sha256));
  if (groundManifests.size !== 1) {
    throw new Error(`publishing ${slugs.join(', ')} produced ${groundManifests.size} ground manifests; one ground must have one`);
  }
  const report = reports.length === 1 ? reports[0] : {
    schemaVersion: 1,
    kind: 'vegetation-graph-publication',
    state: 'published',
    groundId,
    slugs,
    groundManifestSha256: [...groundManifests][0],
    courses: reports,
  };
  fs.writeFileSync(path.join(publicDir, `${groundId}-vegetation-graph-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
