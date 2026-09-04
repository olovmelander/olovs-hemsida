#!/usr/bin/env node
/* Compile the authenticated, aligned Ribbingsfors 1 m Float32 window into the
   normal content-addressed v2 graph. The large source raster stays in the
   ignored acquisition cache; its byte identity, lattice and source COG are
   pinned here and in the course source manifest. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  RIBBINGSFORS_GROUND_GRAPH_CONFIG as CONFIG,
  assertRibbingsforsCompilation,
} from './ribbingsfors-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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

async function migratedHoles() {
  const file = path.join(ROOT, 'geo_data/course-v2/ribbingsfors/migration/course-model.epsg3006.json');
  const model = JSON.parse(await readFile(file, 'utf8'));
  const source = model.geometry?.holes || model.holes;
  if (model.groundId !== CONFIG.groundId || !Array.isArray(source) || source.length !== 9) {
    throw new Error('Ribbingsfors migration model must contain holes 1..9 in EPSG:3006');
  }
  return source
    .slice()
    .sort((left, right) => left.n - right.n)
    .map((hole, index) => {
      if (hole.n !== index + 1 || !Array.isArray(hole.line) || hole.line.length < 2) {
        throw new Error(`Ribbingsfors migrated hole ${index + 1} has invalid routing`);
      }
      return {
        number: hole.n,
        par: hole.par,
        strokeIndex: hole.idx ?? null,
        /* Per-hole indices and geometry are independently sourced but still
           await the club's GIT card/control approval. */
        strokeIndexStatus: 'unverified',
        accuracyTier: 'D',
        line: hole.line.map(([easting, northing]) => [easting, northing]),
      };
    });
}

async function liveCourseEntry() {
  const index = JSON.parse(await readFile(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
  const entry = index.courses?.find(course => course.slug === CONFIG.courseSlug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || !entry.packUrl || !entry.name) {
    throw new Error('live GPK1 manifest has no complete Ribbingsfors entry');
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
  const compilation = assertRibbingsforsCompilation(compileTerrainAssets({
    groundId: CONFIG.groundId,
    courseSlugs: [CONFIG.courseSlug],
    heights,
    width: CONFIG.width,
    height: CONFIG.height,
    originEasting: CONFIG.originEasting,
    originNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: CONFIG.sampleSpacingMetres,
    tileSegments: CONFIG.tileSegments,
    heightScaleMetres: 0.01,
  }));
  const manifestPath = path.join(ROOT, 'geo_data/course-v2/ribbingsfors/source-manifest.json');
  /* Source-manifest checksums use the repository's cross-platform text
     contract: a Windows checkout must identify the same committed LF bytes
     as CI and vegetation publication. */
  const sourceManifestSha256 = sha256(Buffer.from((await readFile(manifestPath, 'utf8')).replace(/\r\n/g, '\n')));
  const { name, fallbackV1 } = await liveCourseEntry();
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  const graph = emitGroundGraph({
    compilation,
    frame: createProvisionalFrame(compilation.bounds),
    sourceManifestSha256,
    course: { slug: CONFIG.courseSlug, name, holes: await migratedHoles() },
    fallbackV1,
    heightAt: (easting, northing) => sampler.sample(easting, northing)?.heightRH2000 ?? Number.NaN,
    holeTileBufferMetres: CONFIG.holeTileBufferMetres,
  });
  await writeGroundGraphFiles(options.out, graph);
  const mergedRoot = await readFile(path.join(options.out, 'courses/v2-index.json'));
  const report = {
    schemaVersion: 1,
    kind: 'ribbingsfors-terrain-graph',
    state: 'published-provisional',
    provisionalReasons: [
      'course-origin-awaits-independent-control-approval',
      'hole-routing-and-playing-surfaces-await-club-or-survey-control',
    ],
    source: {
      itemId: CONFIG.sourceItemId,
      sourceCogSha256: CONFIG.sourceCogSha256,
      sourceWindowCogSha256: CONFIG.sourceWindowCogSha256,
      sourceFloat32Sha256: sourceSha256,
      capture: CONFIG.sourceCapture,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow,
    },
    frame: graph.root.courses[0].groundId,
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
    graph: graph.report,
    mergedRoot: { bytes: mergedRoot.byteLength, sha256: sha256(mergedRoot) },
  };
  /* This report describes the terrain-only generation produced here. A later
     vegetation publication emits its own report, so neither file can be
     mistaken for a description of the other generation. */
  await writeFile(path.join(options.out, 'ribbingsfors-terrain-graph-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Ribbingsfors ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
