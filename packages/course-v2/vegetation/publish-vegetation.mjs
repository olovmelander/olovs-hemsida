#!/usr/bin/env node
/* Publish a compiled vegetation generation into the v2 graph: the existing
   ground's terrain, surface and routing references are kept byte for byte,
   the compiled object registries and stand fields are attached as tile
   layers, and the ground manifest, course manifest and root index are
   re-emitted through the same emitter and verification the terrain went
   through. Old manifests stay on disk, immutable, so a rollback is one root
   reference.

   usage: node packages/course-v2/vegetation/publish-vegetation.mjs
            --ground puttom --slug puttom --compile <compile dir> [--public apps/golf/public]

   Refuses a compile directory whose evidence says it was a harness
   auto-approval: that path exists to prove the pipeline, never to publish.  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from '../emit-ground-graph-node.mjs';
import { createGroundSampler } from './ground-sampler.mjs';

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
    courseSlugs: [slug],
    resources: merged,
    shell: groundManifest.shell,
    bounds: groundManifest.bounds,
    tiles: groundManifest.tiles.map(tile => ({
      id: tile.id,
      lod: tile.lod,
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
    fallbackV1: rootEntry.fallbackV1,
    heightAt,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const groundId = flag('ground');
  const slug = flag('slug', groundId);
  const compileDir = flag('compile');
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  if (!groundId || !compileDir) {
    console.error('usage: --ground <id> [--slug <slug>] --compile <dir> [--public <dir>]');
    process.exit(2);
  }
  const evidence = JSON.parse(fs.readFileSync(path.join(compileDir, 'evidence.json'), 'utf8'));
  if (!evidence.review || /^HARNESS/.test(evidence.review)) {
    console.error('refusing to publish a harness auto-approval; compile with --machine-review or an approvals file');
    process.exit(1);
  }
  const rootBytes = fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'));
  const root = JSON.parse(rootBytes.toString('utf8'));
  const rootEntry = root.courses.find(course => course.slug === slug);
  if (!rootEntry) throw new Error(`root index has no course ${slug}`);
  const read = url => fs.readFileSync(path.join(publicDir, url));
  const courseManifest = JSON.parse(read(rootEntry.manifest.url).toString('utf8'));
  const groundManifest = JSON.parse(read(courseManifest.groundManifest.url).toString('utf8'));
  if (groundManifest.groundId !== groundId) throw new Error(`course ${slug} is on ground ${groundManifest.groundId}, not ${groundId}`);
  /* the routing chunk is regenerated by the emitter from the published
     heights, so it is not carried as a resource: identical bytes land on the
     same content-addressed name, and a changed line gets a new one */
  const resources = new Map();
  resources.set(groundManifest.shell.url, read(groundManifest.shell.url));
  for (const tile of groundManifest.tiles) {
    resources.set(tile.layers.terrain.url, read(tile.layers.terrain.url));
    if (tile.layers.surface) resources.set(tile.layers.surface.url, read(tile.layers.surface.url));
  }
  const routingContent = readChunk(read(courseManifest.routing.url)).content;
  const objectLayers = JSON.parse(fs.readFileSync(path.join(compileDir, 'layers.json'), 'utf8'));
  const standLayers = fs.existsSync(path.join(compileDir, 'stand-layers.json'))
    ? JSON.parse(fs.readFileSync(path.join(compileDir, 'stand-layers.json'), 'utf8')) : {};
  const layerChunks = new Map();
  for (const reference of Object.values(objectLayers)) layerChunks.set(reference.url, fs.readFileSync(path.join(compileDir, 'objects', `${reference.sha256}.bvch`)));
  for (const reference of Object.values(standLayers)) layerChunks.set(reference.url, fs.readFileSync(path.join(compileDir, 'stands', `${reference.sha256}.bvch`)));
  /* the source manifest as CI sees it: LF, whatever this checkout did to it */
  const manifestPath = path.join(ROOT, 'geo_data/course-v2', groundId, 'source-manifest.json');
  const manifestLf = fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n');
  const { createHash } = await import('node:crypto');
  const sourceManifestSha256 = createHash('sha256').update(manifestLf).digest('hex');
  const graph = await assembleVegetationGraph({
    slug, rootEntry, courseManifest, groundManifest, routingContent, resources, layerChunks,
    objectLayers, standLayers, sourceManifestSha256, readAsset: async url => read(url),
  });
  const written = await writeGroundGraphFiles(publicDir, graph);
  const objectTiles = Object.keys(objectLayers).length;
  const standTiles = Object.keys(standLayers).length;
  console.log(JSON.stringify({
    ...graph.report,
    objectTiles,
    standTiles,
    previousGroundManifest: courseManifest.groundManifest.url,
    previousCourseManifest: rootEntry.manifest.url,
    review: evidence.review,
    filesWritten: written.length,
  }, null, 2));
}
