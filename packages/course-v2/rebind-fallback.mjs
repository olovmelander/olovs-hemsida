#!/usr/bin/env node
/* Re-bind a published v2 course to a NEW GPK1 pack.

   The runtime refuses a v2 graph whose fallbackV1 is not the pack the live
   course manifest serves, and the app's build gate refuses a surface preview
   bound to any other pack -- so every model change that reaches the pack has
   to travel through here or the course silently boots on GPK1. This is the
   documented "a new GPK1 changes bindings" step, made one command:

     1. the surface preview must already be recompiled against the new pack
        (compile-<ground>-surface-preview.mjs --replace) -- checked, not done
        here, because that step has a reviewed config hash of its own;
     2. the course manifest is re-emitted with fallbackV1 taken from the LIVE
        courses/index.json (the publish-ground-rings rule), every terrain,
        surface, object and stand layer of the ground carried byte for byte
        and the routing chunk regenerated from the published heights, so
        unchanged lines land on the same content-addressed name;
     3. the root index moves to the new course manifest.

   The ground manifest comes out content-identical (it never carried the
   pack), which the tool asserts; a ground whose rings or vegetation changed
   is not this tool's job.
     node packages/course-v2/rebind-fallback.mjs --ground puttom [--slug a,b] [--public apps/golf/public] */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readChunk } from './chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { liveFallback } from './vegetation/publish-vegetation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };

export async function rebindFallback({ groundId, slugs = null, publicDir = path.join(ROOT, 'apps/golf/public') }) {
  const read = url => fs.readFileSync(path.join(publicDir, url));
  const root = JSON.parse(read('courses/v2-index.json').toString('utf8'));
  const groundCourses = root.courses.filter(course => {
    const manifest = JSON.parse(read(course.manifest.url).toString('utf8'));
    return JSON.parse(read(manifest.groundManifest.url).toString('utf8')).groundId === groundId;
  });
  if (!groundCourses.length) throw new Error(`root index has no course on ground ${groundId}`);
  const wanted = slugs && slugs.length ? slugs : groundCourses.map(course => course.slug);
  const missing = groundCourses.map(course => course.slug).filter(slug => !wanted.includes(slug));
  if (missing.length) throw new Error(`ground ${groundId} also serves ${missing.join(', ')}; a re-bind must re-emit every course of a ground in one run`);
  const groundManifest = JSON.parse(read(JSON.parse(read(groundCourses[0].manifest.url).toString('utf8')).groundManifest.url).toString('utf8'));
  const previousGroundSha256 = sha256(read(JSON.parse(read(groundCourses[0].manifest.url).toString('utf8')).groundManifest.url));

  /* every layer the ground already carries, byte for byte */
  const resources = new Map();
  resources.set(groundManifest.shell.url, read(groundManifest.shell.url));
  const layerChunks = new Map();
  for (const tile of groundManifest.tiles) {
    resources.set(tile.layers.terrain.url, read(tile.layers.terrain.url));
    if (tile.layers.surface) resources.set(tile.layers.surface.url, read(tile.layers.surface.url));
    if (tile.layers.objects) layerChunks.set(tile.layers.objects.url, read(tile.layers.objects.url));
    if (tile.layers.stands) layerChunks.set(tile.layers.stands.url, read(tile.layers.stands.url));
  }
  /* the ground is re-emitted against the source manifest it was PUBLISHED
     from, so it comes out byte-identical: the pointer records what the rings
     and vegetation were built from, and nothing about them moved here. The
     checkout's manifest may hash differently by now (every publish registers
     its artifacts in it) -- that is reported, never adopted. */
  const sourceManifestSha256 = groundManifest.sourceManifestSha256;
  const manifestPath = path.join(ROOT, 'geo_data/course-v2', groundId, 'source-manifest.json');
  const checkoutSha256 = sha256(fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n'));

  const reports = [];
  for (const slug of wanted) {
    const rootEntry = root.courses.find(course => course.slug === slug);
    if (!rootEntry) throw new Error(`course ${slug} is not in the v2 root index`);
    const courseManifest = JSON.parse(read(rootEntry.manifest.url).toString('utf8'));
    const routingContent = readChunk(read(courseManifest.routing.url)).content;
    const fallbackV1 = liveFallback(read, slug, null);
    if (!fallbackV1) throw new Error(`courses/index.json carries no pack for ${slug}`);
    /* the ground's compilation, rebuilt field for field from the published
       manifest. Each tile's layers travel VERBATIM -- the publishers differ on
       whether a layer a tile lacks is written null or left out, and to a
       byte-identity check those are two manifests */
    const compilation = {
      groundId, courseSlugs: wanted, resources: new Map([...resources, ...layerChunks]),
      shell: groundManifest.shell, bounds: groundManifest.bounds,
      tiles: groundManifest.tiles.map(tile => ({
        id: tile.id, lod: tile.lod,
        ...(tile.parentId !== undefined ? { parentId: tile.parentId } : {}),
        bounds: tile.bounds, geometricErrorMetres: tile.geometricErrorMetres, courses: tile.courses,
        layers: { ...tile.layers },
      })),
    };
    /* routing heights: the ones already published, so an unchanged line lands
       on the same content-addressed routing chunk */
    const known = new Map();
    for (const hole of routingContent.holes) for (const [e, n, h] of hole.line) known.set(`${e},${n}`, h);
    const heightAt = (easting, northing) => { const hit = known.get(`${easting},${northing}`); return Number.isFinite(hit) ? hit : Number.NaN; };
    const holes = courseManifest.holes.map(hole => {
      const routed = routingContent.holes.find(entry => entry.number === hole.number);
      if (!routed) throw new Error(`routing chunk lacks hole ${hole.number}`);
      return { number: hole.number, par: hole.par, strokeIndex: hole.strokeIndex, strokeIndexStatus: hole.strokeIndexStatus,
        accuracyTier: hole.accuracyTier, line: routed.line.map(([e, n]) => [e, n]) };
    });
    const graph = emitGroundGraph({
      compilation, frame: groundManifest.frame, sourceManifestSha256,
      course: { slug, name: rootEntry.name, holes }, fallbackV1, heightAt,
    });
    if (graph.references.ground.sha256 !== previousGroundSha256) {
      throw new Error(`re-emitting ${slug} produced a different ground manifest (${graph.references.ground.sha256} vs ${previousGroundSha256}); the ground itself changed and needs a real publish`);
    }
    const written = await writeGroundGraphFiles(publicDir, graph);
    const activeRoot = JSON.parse(read('courses/v2-index.json').toString('utf8'));
    const activeEntry = activeRoot.courses.find(course => course.slug === slug);
    reports.push({
      slug,
      previousFallback: rootEntry.fallbackV1,
      fallbackV1: activeEntry.fallbackV1,
      previousCourseManifest: rootEntry.manifest.url,
      courseManifest: activeEntry.manifest.url,
      routingUnchanged: graph.references.routing.sha256 === courseManifest.routing.sha256,
      groundManifest: graph.references.ground.sha256,
      filesWritten: written.length,
    });
  }
  return { groundId, slugs: wanted, sourceManifestSha256, checkoutSourceManifestSha256: checkoutSha256, reports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const groundId = flag('ground');
  if (!groundId) { console.error('usage: --ground <id> [--slug <a,b>] [--public <dir>]'); process.exit(2); }
  const slugs = flag('slug', null)?.split(',').map(value => value.trim()).filter(Boolean) || null;
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  rebindFallback({ groundId, slugs, publicDir })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exit(1); });
}
