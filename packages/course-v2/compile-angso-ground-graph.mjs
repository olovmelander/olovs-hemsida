#!/usr/bin/env node
/* Compile the authenticated, aligned Ängsö 1 m Float32 window into the normal
   content-addressed v2 graph. The large source raster stays in the ignored
   acquisition cache; its byte identity, lattice and source item are pinned
   here, in the acquisition evidence and in the course source manifest.

   node packages/course-v2/compile-angso-ground-graph.mjs \
     --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/angso-terrain-window/terrain-1m.f32 \
     --out apps/golf/public */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  ANGSO_GROUND_GRAPH_CONFIG as CONFIG,
  assertAngsoCompilation,
} from './angso-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MIGRATION_DIR = path.join(ROOT, 'geo_data/course-v2/angso/migration');
const ZONE_A_MARGIN_METRES = 100;

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

/* The window is REVIEWED rather than produced by `alignTerrainGridExtent`,
   because the aligner returns the smallest power-of-two RECTANGLE and both the
   frontier contract and the ring topology want a square tile count. The rule
   is therefore stated here in full and checked against the migrated geometry
   rather than against the four numbers in the config:

     the smallest SQUARE power-of-two tile count whose 256 m tiles hold every
     played point with at least the reviewed 100 m zone-A margin, centred on
     the played bounds and snapped to the source's own sample lattice.

   Ängsö's played ground is 894 x 2,167 m, so eight tiles (2,048 m) fails on
   the north-south axis and sixteen is the smallest square that passes. That
   claim is checked both ways: the chosen size must hold the course, and half
   of it must genuinely fail. */
async function assertReviewedWindow() {
  const bounds = { minEasting: Infinity, minNorthing: Infinity, maxEasting: -Infinity, maxNorthing: -Infinity };
  let points = 0;
  const visit = value => {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          value[0] > 200_000 && value[0] < 1_000_000 && value[1] > 6_000_000 && value[1] < 7_700_000) {
        bounds.minEasting = Math.min(bounds.minEasting, value[0]);
        bounds.maxEasting = Math.max(bounds.maxEasting, value[0]);
        bounds.minNorthing = Math.min(bounds.minNorthing, value[1]);
        bounds.maxNorthing = Math.max(bounds.maxNorthing, value[1]);
        points++;
        return;
      }
      for (const entry of value) visit(entry);
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, 'course-model.epsg3006.json'), 'utf8'));
  if (model.groundId !== CONFIG.groundId) throw new Error('migration file is not an Ängsö migration');
  /* The holes are the played ground; `scenery` carries the practice ground,
     which is a facility the runbook's zone A includes. */
  visit(model.geometry.holes);
  visit(model.geometry.scenery);
  if (points < 1000) throw new Error(`only ${points} played coordinate pairs found in the migration`);
  for (const [field, expected] of Object.entries(CONFIG.playedBounds)) {
    if (Math.abs(bounds[field] - expected) > 1e-3) {
      throw new Error(`played ${field} is ${bounds[field]}; the reviewed config records ${expected}`);
    }
  }

  const margin = {
    west: bounds.minEasting - CONFIG.expectedBounds.minEasting,
    east: CONFIG.expectedBounds.maxEasting - bounds.maxEasting,
    south: bounds.minNorthing - CONFIG.expectedBounds.minNorthing,
    north: CONFIG.expectedBounds.maxNorthing - bounds.maxNorthing,
  };
  const smallest = Math.min(...Object.values(margin));
  if (!(smallest >= ZONE_A_MARGIN_METRES)) {
    throw new Error(`played ground clears the reviewed window by only ${smallest.toFixed(1)} m; ${ZONE_A_MARGIN_METRES} m is required`);
  }

  const tileSpan = CONFIG.tileSegments * CONFIG.sampleSpacingMetres;
  const required = Math.max(
    bounds.maxEasting - bounds.minEasting,
    bounds.maxNorthing - bounds.minNorthing,
  ) + 2 * ZONE_A_MARGIN_METRES;
  let tilesPerSide = 1;
  while (tilesPerSide * tileSpan < required) tilesPerSide *= 2;
  if (tilesPerSide * CONFIG.tileSegments + 1 !== CONFIG.width || CONFIG.width !== CONFIG.height) {
    throw new Error(`the smallest legal square is ${tilesPerSide} tiles per side; the config declares ${CONFIG.width} x ${CONFIG.height} samples`);
  }
  if ((tilesPerSide / 2) * tileSpan >= required) {
    throw new Error('a window half this size would have held the played ground; the reviewed size is not minimal');
  }

  const span = (CONFIG.width - 1) * CONFIG.sampleSpacingMetres;
  const centre = {
    easting: (bounds.minEasting + bounds.maxEasting) / 2,
    northing: (bounds.minNorthing + bounds.maxNorthing) / 2,
  };
  /* Centred on the played bounds and snapped to the source lattice: sample
     centres sit on the half metre, so the origin is the nearest of those to
     centre -/+ span/2. */
  const snap = value => Math.round(value - 0.5) + 0.5;
  const expectedOrigin = {
    easting: snap(centre.easting - span / 2),
    northing: snap(centre.northing + span / 2),
  };
  if (Math.abs(expectedOrigin.easting - CONFIG.originEasting) > 1e-9 ||
      Math.abs(expectedOrigin.northing - CONFIG.originNorthing) > 1e-9) {
    throw new Error(`centring on the played ground gives origin ${expectedOrigin.easting},${expectedOrigin.northing}; the config declares ${CONFIG.originEasting},${CONFIG.originNorthing}`);
  }
  return { playedBounds: bounds, playedPoints: points, margin, smallest, tilesPerSide };
}

async function migratedHoles() {
  const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, 'course-model.epsg3006.json'), 'utf8'));
  const source = model.geometry?.holes;
  if (model.groundId !== CONFIG.groundId || !Array.isArray(source) || source.length !== 18) {
    throw new Error('Ängsö migration model must contain holes 1..18 in EPSG:3006');
  }
  return source
    .slice()
    .sort((left, right) => left.n - right.n)
    .map((hole, index) => {
      if (hole.n !== index + 1 || !Array.isArray(hole.line) || hole.line.length < 2) {
        throw new Error(`Ängsö migrated hole ${index + 1} has invalid routing`);
      }
      return {
        number: hole.n,
        par: hole.par,
        strokeIndex: hole.idx ?? null,
        /* All 126 card cells -- par, index and five tee columns over
           eighteen holes -- are gated exactly by angsobuild/check3d.mjs
           against the club's published card, so par and index are verified.
           The LINE is not: fourteen of the eighteen are satellite traces slid
           to the card length, and only four carry an OSM hole way. */
        strokeIndexStatus: 'verified',
        accuracyTier: 'D',
        line: hole.line.map(([easting, northing]) => [easting, northing]),
      };
    });
}

async function liveCourseEntry() {
  const index = JSON.parse(await readFile(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
  const entry = index.courses?.find(course => course.slug === CONFIG.courseSlug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || !entry.packUrl || !entry.name) {
    throw new Error('live GPK1 manifest has no complete Ängsö entry');
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
  const reviewedWindow = await assertReviewedWindow();
  const sourceBytes = await readFile(options.terrain);
  const sourceFloat32Sha256 = sha256(sourceBytes);
  const acquisition = JSON.parse(await readFile(
    path.join(ROOT, 'geo_data/course-v2/angso/acquisition/terrain-window.json'), 'utf8'));
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
  const compilation = assertAngsoCompilation(compileTerrainAssets({
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
  const manifestPath = path.join(ROOT, 'geo_data/course-v2/angso/source-manifest.json');
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
    kind: 'angso-terrain-graph',
    state: 'published-provisional',
    provisionalReasons: [
      'course-origin-awaits-independent-control-approval',
      'playing-surfaces-are-satellite-traces-and-osm-outlines-not-survey',
      'legacy-terrarium-water-levels-disagree-with-the-measured-dtm-by-5-to-15-m',
    ],
    source: {
      itemIds: CONFIG.sourceItemIds,
      sourceCogSha256: CONFIG.sourceCogSha256,
      sourceFloat32Sha256,
      acquisitionEvidence: 'geo_data/course-v2/angso/acquisition/terrain-window.json',
      acquiredOn: acquisition.acquiredOn,
      capture: CONFIG.sourceCapture,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow,
      sourceItems: acquisition.sourceItems.map(({ id, etag, contentLength, lastModified }) =>
        ({ id, etag, contentLength, lastModified })),
    },
    reviewedWindow: {
      playedBoundsEpsg3006: reviewedWindow.playedBounds,
      playedCoordinatePairs: reviewedWindow.playedPoints,
      tilesPerSide: reviewedWindow.tilesPerSide,
      marginMetres: reviewedWindow.margin,
      smallestMarginMetres: Math.round(reviewedWindow.smallest * 10) / 10,
      note: 'the smallest square power-of-two tile count holding every played point with a 100 m zone-A margin, centred on the played bounds; half this size was checked and fails',
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
  await writeFile(path.join(options.out, 'angso-terrain-graph-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Ängsö ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
