#!/usr/bin/env node
/* Compile the authenticated, aligned Veckefjärden 1 m Float32 window into the
   normal content-addressed v2 graph. The large source raster stays in the
   ignored acquisition cache; its byte identity, lattice and source COG are
   pinned in veckefjarden-ground-graph.mjs and in the course source manifest.

   This is the first ground here that publishes TWO courses. emitGroundGraph
   takes one course per call and its root writer merges by slug, so the
   Mästerskapsbanan and the korthålsbanan are emitted in turn against the SAME
   compilation: one ground manifest (content-addressed, so written once), two
   course manifests, two root entries, one terrain.

   Usage:
     node packages/course-v2/compile-veckefjarden-ground-graph.mjs \
       --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/veckefjarden/terrain-fine.bin \
       --out apps/golf/public                                                */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  VECKEFJARDEN_GROUND_GRAPH_CONFIG as CONFIG,
  assertVeckefjardenCompilation,
} from './veckefjarden-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/* The two courses, each with the migration that carries its geometry and the
   card that carries its index. The Mästerskapsbanan's 144 card values are
   gated exactly by geobuild/check3d.mjs, so its stroke index is 'verified'.
   The korthålsbanan publishes no stroke index at all -- CLAUDE.md records
   that the only column found was 1..9 in hole order, a scrape artifact -- and
   an unrated short course having none is the expected state, not a gap, so it
   is 'not-applicable' and nothing is invented to fill it. */
const COURSES = Object.freeze([
  Object.freeze({
    slug: 'veckefjarden',
    migration: 'geo_data/course-v2/veckefjarden/migration/course-model.epsg3006.json',
    holeCount: 18,
    strokeIndexStatus: 'verified',
  }),
  Object.freeze({
    slug: 'veckefjarden-korthalsbanan',
    migration: 'geo_data/course-v2/veckefjarden/migration/short-course-model.epsg3006.json',
    holeCount: 9,
    strokeIndexStatus: 'not-applicable',
  }),
]);

function argumentsFrom(argv) {
  const options = { terrain: null, out: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--terrain-f32') options.terrain = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!options.terrain || !options.out) {
    throw new Error('usage: --terrain-f32 <aligned little-endian Float32 raster> --out <public directory>');
  }
  return { terrain: path.resolve(options.terrain), out: path.resolve(options.out) };
}

async function migratedHoles(course) {
  const model = JSON.parse(await readFile(path.join(ROOT, course.migration), 'utf8'));
  const source = model.geometry?.holes || model.holes;
  if (model.groundId !== CONFIG.groundId || !Array.isArray(source) || source.length !== course.holeCount) {
    throw new Error(`${course.slug} migration model must contain holes 1..${course.holeCount} in EPSG:3006`);
  }
  return source
    .slice()
    .sort((left, right) => left.n - right.n)
    .map((hole, index) => {
      if (hole.n !== index + 1 || !Array.isArray(hole.line) || hole.line.length < 2) {
        throw new Error(`${course.slug} migrated hole ${index + 1} has invalid routing`);
      }
      return {
        number: hole.n,
        par: hole.par,
        strokeIndex: course.strokeIndexStatus === 'not-applicable' ? null : (hole.idx ?? null),
        strokeIndexStatus: course.strokeIndexStatus,
        /* The routing is the club's GPS survey and the card length, carried
           through cs2cs. It is not an independent control survey, and the
           playing surfaces around it are still the legacy traces. */
        accuracyTier: 'D',
        line: hole.line.map(([easting, northing]) => [easting, northing]),
      };
    });
}

async function liveCourseEntry(slug) {
  const index = JSON.parse(await readFile(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
  const entry = index.courses?.find(course => course.slug === slug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || !entry.packUrl || !entry.name) {
    throw new Error(`live GPK1 manifest has no complete ${slug} entry`);
  }
  return {
    name: entry.name,
    fallbackV1: {
      format: 1,
      packUrl: String(entry.packUrl).replace(/^\//, ''),
      bytes: entry.bytes,
      sha256: entry.sha256,
    },
  };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const sourceBytes = await readFile(options.terrain);
  const sourceSha256 = sha256(sourceBytes);
  if (sourceSha256 !== CONFIG.sourceFloat32Sha256) {
    throw new Error(`aligned Float32 source is ${sourceSha256}; reviewed value is ${CONFIG.sourceFloat32Sha256}`);
  }
  const { heights } = await readFloat32TerrainFile(options.terrain, {
    width: CONFIG.width,
    height: CONFIG.height,
    littleEndian: true,
    noDataValue: -9999,
  });
  const compilation = assertVeckefjardenCompilation(compileTerrainAssets({
    groundId: CONFIG.groundId,
    courseSlugs: [...CONFIG.courseSlugs],
    heights,
    width: CONFIG.width,
    height: CONFIG.height,
    originEasting: CONFIG.originEasting,
    originNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: CONFIG.sampleSpacingMetres,
    tileSegments: CONFIG.tileSegments,
    heightScaleMetres: 0.01,
  }));
  const manifestPath = path.join(ROOT, 'geo_data/course-v2/veckefjarden/source-manifest.json');
  /* Source-manifest checksums use the repository's cross-platform text
     contract: a Windows checkout must identify the same committed LF bytes
     as CI and vegetation publication. */
  const sourceManifestSha256 = sha256(Buffer.from((await readFile(manifestPath, 'utf8')).replace(/\r\n/g, '\n')));
  const frame = createProvisionalFrame(compilation.bounds);
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  const heightAt = (easting, northing) => sampler.sample(easting, northing)?.heightRH2000 ?? Number.NaN;

  const published = [];
  for (const course of COURSES) {
    const { name, fallbackV1 } = await liveCourseEntry(course.slug);
    const graph = emitGroundGraph({
      compilation,
      frame,
      sourceManifestSha256,
      course: { slug: course.slug, name, holes: await migratedHoles(course) },
      fallbackV1,
      heightAt,
      holeTileBufferMetres: CONFIG.holeTileBufferMetres,
    });
    await writeGroundGraphFiles(options.out, graph);
    published.push({ slug: course.slug, name, holes: course.holeCount, report: graph.report });
  }

  const mergedRoot = await readFile(path.join(options.out, 'courses/v2-index.json'));
  const report = {
    schemaVersion: 1,
    kind: 'veckefjarden-terrain-graph',
    state: 'published-provisional',
    provisionalReasons: [
      'course-origin-awaits-independent-control-approval',
      'playing-surfaces-are-migrated-legacy-traces-not-survey',
      'korthalsbanan-card-is-unverified-and-publishes-no-stroke-index',
    ],
    source: {
      itemId: CONFIG.sourceItemId,
      collection: CONFIG.sourceCollection,
      assetUrl: CONFIG.sourceAssetUrl,
      sourceCogSha256: CONFIG.sourceCogSha256,
      sourceCogBytes: CONFIG.sourceCogBytes,
      sourceWindowCogSha256: CONFIG.sourceWindowCogSha256,
      sourceFloat32Sha256: sourceSha256,
      capture: CONFIG.sourceCapture,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow,
    },
    frame: { fingerprint: frame.fingerprint, bounds: compilation.bounds },
    compile: {
      sourceSamples: compilation.stats.sourceSamples,
      finiteSamples: compilation.stats.finiteSamples,
      sourceMinimumHeightRH2000: compilation.pyramid.sourceMinimumHeightRH2000,
      sourceMaximumHeightRH2000: compilation.pyramid.sourceMaximumHeightRH2000,
      levels: compilation.stats.levels,
      tileChunks: compilation.stats.tileChunks,
      uniqueChunks: compilation.stats.uniqueChunks,
      encodedBytes: compilation.stats.encodedBytes,
      decodedBytes: compilation.stats.decodedBytes,
    },
    courses: published,
    mergedRoot: { bytes: mergedRoot.byteLength, sha256: sha256(mergedRoot) },
  };
  /* This report describes the terrain-only generation produced here. A later
     ring or vegetation publication emits its own report, so no file can be
     mistaken for a description of another generation. */
  await writeFile(path.join(options.out, 'veckefjarden-terrain-graph-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Veckefjärden ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
