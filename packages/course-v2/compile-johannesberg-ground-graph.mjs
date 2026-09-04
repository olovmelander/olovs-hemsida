#!/usr/bin/env node
/* Compile the authenticated, aligned Johannesberg 1 m Float32 window into the
   normal content-addressed v2 graph. The large source raster stays in the
   ignored acquisition cache; its byte identity, lattice and source items are
   pinned here, in the acquisition evidence and in the course source manifest.

   node packages/course-v2/compile-johannesberg-ground-graph.mjs \
     --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/johannesberg-terrain-window/terrain-1m.f32 \
     --out apps/golf/public */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  JOHANNESBERG_GROUND_GRAPH_CONFIG as CONFIG,
  assertJohannesbergCompilation,
} from './johannesberg-ground-graph.mjs';
import { alignTerrainGridExtent, compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MIGRATION_DIR = path.join(ROOT, 'geo_data/course-v2/johannesberg/migration');

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

/* Both courses on this ground fix the window: it must hold every played point
   of the eighteen AND of the nine, with the reviewed zone-A margin. Deriving
   it here from the migrated geometry -- rather than trusting the four numbers
   in the config -- is what makes the lattice reviewed rather than typed. */
async function assertReviewedWindow() {
  const bounds = { minEasting: Infinity, minNorthing: Infinity, maxEasting: -Infinity, maxNorthing: -Infinity };
  const visit = value => {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          value[0] > 200_000 && value[0] < 1_000_000 && value[1] > 6_000_000 && value[1] < 7_700_000) {
        bounds.minEasting = Math.min(bounds.minEasting, value[0]);
        bounds.maxEasting = Math.max(bounds.maxEasting, value[0]);
        bounds.minNorthing = Math.min(bounds.minNorthing, value[1]);
        bounds.maxNorthing = Math.max(bounds.maxNorthing, value[1]);
        return;
      }
      for (const entry of value) visit(entry);
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  for (const file of ['course-model.epsg3006.json', 'nine-course-model.epsg3006.json']) {
    const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, file), 'utf8'));
    if (model.groundId !== CONFIG.groundId) throw new Error(`${file} is not a Johannesberg migration`);
    visit(model.geometry.holes);
  }
  const margin = {
    west: bounds.minEasting - CONFIG.expectedBounds.minEasting,
    east: CONFIG.expectedBounds.maxEasting - bounds.maxEasting,
    south: bounds.minNorthing - CONFIG.expectedBounds.minNorthing,
    north: CONFIG.expectedBounds.maxNorthing - bounds.maxNorthing,
  };
  const smallest = Math.min(...Object.values(margin));
  if (!(smallest >= 100)) {
    throw new Error(`played ground clears the reviewed window by only ${smallest.toFixed(1)} m; 100 m is required`);
  }
  /* The aligner must reproduce the window from the required bounds alone. */
  const aligned = alignTerrainGridExtent({
    requiredBounds: {
      minEasting: bounds.minEasting - 100,
      maxEasting: bounds.maxEasting + 100,
      minNorthing: bounds.minNorthing - 100,
      maxNorthing: bounds.maxNorthing + 100,
    },
    sourceOriginEasting: CONFIG.originEasting,
    sourceOriginNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: CONFIG.sampleSpacingMetres,
    tileSegments: CONFIG.tileSegments,
  });
  if (aligned.width !== CONFIG.width || aligned.height !== CONFIG.height ||
      Math.abs(aligned.originEasting - CONFIG.originEasting) > 1e-9 ||
      Math.abs(aligned.originNorthing - CONFIG.originNorthing) > 1e-9) {
    throw new Error('alignTerrainGridExtent does not reproduce the reviewed Johannesberg window');
  }
  return { playedBounds: bounds, margin, smallest };
}

async function migratedHoles() {
  const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, 'course-model.epsg3006.json'), 'utf8'));
  const source = model.geometry?.holes;
  if (model.groundId !== CONFIG.groundId || !Array.isArray(source) || source.length !== 18) {
    throw new Error('Johannesberg migration model must contain holes 1..18 in EPSG:3006');
  }
  return source
    .slice()
    .sort((left, right) => left.n - right.n)
    .map((hole, index) => {
      if (hole.n !== index + 1 || !Array.isArray(hole.line) || hole.line.length < 2) {
        throw new Error(`Johannesberg migrated hole ${index + 1} has invalid routing`);
      }
      return {
        number: hole.n,
        par: hole.par,
        strokeIndex: hole.idx ?? null,
        /* The card reproduces the club's 2026 hole plans in all 144 cells, but
           the LINE is a satellite trace slid to the card length, not a survey
           or a club GIS export. The routing therefore stays unverified until
           club or control data arrives. */
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
    throw new Error('live GPK1 manifest has no complete Johannesberg entry');
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
  const window = await assertReviewedWindow();
  const sourceBytes = await readFile(options.terrain);
  const sourceFloat32Sha256 = sha256(sourceBytes);
  const acquisition = JSON.parse(await readFile(
    path.join(ROOT, 'geo_data/course-v2/johannesberg/acquisition/terrain-window.json'), 'utf8'));
  if (acquisition.raster.sha256 !== sourceFloat32Sha256) {
    throw new Error(`raster is ${sourceFloat32Sha256}; the acquisition evidence records ${acquisition.raster.sha256}`);
  }
  if (acquisition.lattice.width !== CONFIG.width || acquisition.lattice.height !== CONFIG.height ||
      acquisition.lattice.originEasting !== CONFIG.originEasting ||
      acquisition.lattice.originNorthing !== CONFIG.originNorthing) {
    throw new Error('acquisition evidence and compile config describe different lattices');
  }
  const { heights } = await readFloat32TerrainFile(options.terrain, {
    width: CONFIG.width,
    height: CONFIG.height,
    littleEndian: true,
    noDataValue: -9999,
  });
  const compilation = assertJohannesbergCompilation(compileTerrainAssets({
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
  const manifestPath = path.join(ROOT, 'geo_data/course-v2/johannesberg/source-manifest.json');
  /* Source-manifest checksums use the repository's cross-platform text
     contract: a Windows checkout must identify the same committed LF bytes
     as CI. */
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
    kind: 'johannesberg-terrain-graph',
    state: 'published-provisional',
    provisionalReasons: [
      'course-origin-awaits-independent-control-approval',
      'hole-routing-and-playing-surfaces-await-club-or-survey-control',
      'nine-hole-course-johannesberg-9-shares-this-ground-but-is-not-yet-published-as-a-v2-course',
    ],
    source: {
      itemIds: CONFIG.sourceItemIds,
      sourceFloat32Sha256,
      acquisitionEvidence: 'geo_data/course-v2/johannesberg/acquisition/terrain-window.json',
      acquiredOn: acquisition.acquiredOn,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow,
      sourceItems: acquisition.sourceItems.map(({ id, etag, contentLength, lastModified }) =>
        ({ id, etag, contentLength, lastModified })),
    },
    reviewedWindow: {
      playedBoundsEpsg3006: window.playedBounds,
      marginMetres: window.margin,
      smallestMarginMetres: Math.round(window.smallest * 10) / 10,
      note: 'derived from every played point of both courses on this ground and reproduced by alignTerrainGridExtent',
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
  await writeFile(path.join(options.out, 'johannesberg-terrain-graph-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Johannesberg ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
