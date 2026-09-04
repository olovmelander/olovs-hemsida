#!/usr/bin/env node
/* Compile the authenticated, aligned Norrfällsviken 1 m Float32 window into
   the normal content-addressed v2 graph. The large source raster stays in the
   ignored acquisition cache; its byte identity, lattice and source items are
   pinned here, in the acquisition evidence and in the course source manifest.

   node packages/course-v2/compile-norrfallsviken-ground-graph.mjs \
     --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/norrfallsviken-terrain-window/terrain-1m.f32 \
     --out apps/golf/public */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  NORRFALLSVIKEN_GROUND_GRAPH_CONFIG as CONFIG,
  assertNorrfallsvikenCompilation,
} from './norrfallsviken-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MIGRATION_DIR = path.join(ROOT, 'geo_data/course-v2/norrfallsviken/migration');
const ZONE_A_MARGIN_METRES = 100;
/* The window's north pixel edge is anchored here rather than centred. See the
   config's header: centring north-south would cross into a second pair of
   Markhöjdmodell items to buy open sea. */
const ITEM_BOUNDARY_NORTHING = 6990000;

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

function emptyBounds() {
  return { minEasting: Infinity, minNorthing: Infinity, maxEasting: -Infinity, maxNorthing: -Infinity, points: 0 };
}

/* Every EPSG:3006 coordinate pair reachable from a value, accumulated. The
   numeric guard is the same one Ängsö uses: a pair only counts if it lands in
   Sweden's grid, so scalar heights and legacy metres cannot leak in. */
function accumulate(bounds, value) {
  if (Array.isArray(value)) {
    if (value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
        value[0] > 200_000 && value[0] < 1_000_000 && value[1] > 6_000_000 && value[1] < 7_700_000) {
      bounds.minEasting = Math.min(bounds.minEasting, value[0]);
      bounds.maxEasting = Math.max(bounds.maxEasting, value[0]);
      bounds.minNorthing = Math.min(bounds.minNorthing, value[1]);
      bounds.maxNorthing = Math.max(bounds.maxNorthing, value[1]);
      bounds.points++;
      return bounds;
    }
    for (const entry of value) accumulate(bounds, entry);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) accumulate(bounds, entry);
  }
  return bounds;
}

function union(...all) {
  return {
    minEasting: Math.min(...all.map(b => b.minEasting)),
    maxEasting: Math.max(...all.map(b => b.maxEasting)),
    minNorthing: Math.min(...all.map(b => b.minNorthing)),
    maxNorthing: Math.max(...all.map(b => b.maxNorthing)),
  };
}

function marginOf(bounds) {
  const margin = {
    west: bounds.minEasting - CONFIG.expectedBounds.minEasting,
    east: CONFIG.expectedBounds.maxEasting - bounds.maxEasting,
    south: bounds.minNorthing - CONFIG.expectedBounds.minNorthing,
    north: CONFIG.expectedBounds.maxNorthing - bounds.maxNorthing,
  };
  return { ...margin, minimum: Math.min(...Object.values(margin)) };
}

function agrees(actual, expected, tolerance, what) {
  for (const [field, value] of Object.entries(expected)) {
    if (Math.abs(actual[field] - value) > tolerance) {
      throw new Error(`${what} ${field} is ${actual[field]}; the reviewed config records ${value}`);
    }
  }
}

/* The window is REVIEWED rather than produced by `alignTerrainGridExtent`,
   because the aligner returns the smallest power-of-two RECTANGLE and both the
   frontier contract and the ring topology want a square tile count.

   Ängsö states its rule as "the smallest square tile count holding every
   PLAYED point with a 100 m margin, centred on the played bounds". That rule
   is not this ground's rule and copying it would be false: Norrfällsviken's
   course is 784 x 1,286 m and eight tiles hold it comfortably, so a minimality
   check against the played ground alone would reject this window. The real
   reason for sixteen is the off-course ground, and the whole point of writing
   a contract is that it states the reason it is actually true for:

     the smallest square power-of-two tile count whose 256 m tiles hold every
     played point AND the chapel, the harbour piers and the marina basins with
     at least the reviewed 100 m zone-A margin -- placed with its easting
     centred on the played bounds, and its north pixel edge on the 10 km source
     item boundary.

   Both halves of the minimality claim are checked: the chosen size must hold
   that set, and half of it must genuinely fail. Both placement rules are
   checked too, and the landmarks are looked up in the migration by name and by
   feature kind rather than by coordinate, so moving one fails here instead of
   quietly leaving the finest terrain. */
async function assertReviewedWindow() {
  const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, 'course-model.epsg3006.json'), 'utf8'));
  if (model.groundId !== CONFIG.groundId) throw new Error('migration file is not a Norrfällsviken migration');
  const geometry = model.geometry;

  /* The holes are the played ground; `scenery` carries the practice range and
     greens, which are facilities the runbook's zone A includes. */
  const played = accumulate(accumulate(emptyBounds(), geometry.holes), geometry.scenery);
  if (played.points < 800) throw new Error(`only ${played.points} played coordinate pairs found in the migration`);
  agrees(played, CONFIG.playedBounds, 1e-3, 'played');

  const chapels = (geometry.infra?.buildings || []).filter(building => /kapell/i.test(building.name || ''));
  if (chapels.length !== 1) {
    throw new Error(`the migration carries ${chapels.length} buildings named as a chapel; exactly one is reviewed`);
  }
  const landmarks = {
    kapell: accumulate(emptyBounds(), chapels),
    harbourPiers: accumulate(emptyBounds(), geometry.infra?.piers || []),
    marinaBasins: accumulate(emptyBounds(), geometry.infra?.basins || []),
  };
  for (const [name, bounds] of Object.entries(landmarks)) {
    if (!bounds.points) throw new Error(`the migration carries no geometry for the reviewed landmark ${name}`);
    agrees(bounds, CONFIG.landmarkBounds[name], 0.05, `landmark ${name}`);
  }

  const contained = union(played, ...Object.values(landmarks));
  const playedMargin = marginOf(played);
  const containedMargin = marginOf(contained);
  if (!(containedMargin.minimum >= ZONE_A_MARGIN_METRES)) {
    throw new Error(`the reviewed window clears the played ground and its landmarks by only ${containedMargin.minimum.toFixed(1)} m; ${ZONE_A_MARGIN_METRES} m is required`);
  }

  /* Minimality, both ways. */
  const tileSpan = CONFIG.tileSegments * CONFIG.sampleSpacingMetres;
  const required = Math.max(
    contained.maxEasting - contained.minEasting,
    contained.maxNorthing - contained.minNorthing,
  ) + 2 * ZONE_A_MARGIN_METRES;
  let tilesPerSide = 1;
  while (tilesPerSide * tileSpan < required) tilesPerSide *= 2;
  if (tilesPerSide * CONFIG.tileSegments + 1 !== CONFIG.width || CONFIG.width !== CONFIG.height) {
    throw new Error(`the smallest legal square is ${tilesPerSide} tiles per side; the config declares ${CONFIG.width} x ${CONFIG.height} samples`);
  }
  if ((tilesPerSide / 2) * tileSpan >= required) {
    throw new Error('a window half this size would have held the reviewed ground; the reviewed size is not minimal');
  }

  /* Placement: easting centred on the played bounds, snapped to the source's
     own sample lattice, because the course rather than the harbour is what the
     finest ground is centred on. */
  const span = (CONFIG.width - 1) * CONFIG.sampleSpacingMetres;
  const snap = value => Math.round(value - 0.5) + 0.5;
  const expectedEasting = snap((played.minEasting + played.maxEasting) / 2 - span / 2);
  if (Math.abs(expectedEasting - CONFIG.originEasting) > 1e-9) {
    throw new Error(`centring the easting on the played ground gives ${expectedEasting}; the config declares ${CONFIG.originEasting}`);
  }
  /* Placement: the north pixel edge is the item boundary, so the first sample
     centre is half a metre south of it. */
  const expectedNorthing = ITEM_BOUNDARY_NORTHING - CONFIG.sampleSpacingMetres / 2;
  if (Math.abs(expectedNorthing - CONFIG.originNorthing) > 1e-9) {
    throw new Error(`anchoring the north edge on N ${ITEM_BOUNDARY_NORTHING} gives ${expectedNorthing}; the config declares ${CONFIG.originNorthing}`);
  }
  if (CONFIG.pixelEdgeWindow.north !== ITEM_BOUNDARY_NORTHING) {
    throw new Error(`the reviewed pixel-edge north is ${CONFIG.pixelEdgeWindow.north}, not the item boundary ${ITEM_BOUNDARY_NORTHING}`);
  }

  return {
    playedBounds: played,
    playedPoints: played.points,
    landmarkBounds: landmarks,
    containedBounds: contained,
    playedMargin,
    containedMargin,
    tilesPerSide,
    halvedSpanMetres: (tilesPerSide / 2) * tileSpan,
    requiredSpanMetres: required,
  };
}

async function migratedHoles() {
  const model = JSON.parse(await readFile(path.join(MIGRATION_DIR, 'course-model.epsg3006.json'), 'utf8'));
  const source = model.geometry?.holes;
  if (model.groundId !== CONFIG.groundId || !Array.isArray(source) || source.length !== 18) {
    throw new Error('Norrfällsviken migration model must contain holes 1..18 in EPSG:3006');
  }
  return source
    .slice()
    .sort((left, right) => left.n - right.n)
    .map((hole, index) => {
      if (hole.n !== index + 1 || !Array.isArray(hole.line) || hole.line.length < 2) {
        throw new Error(`Norrfällsviken migrated hole ${index + 1} has invalid routing`);
      }
      return {
        number: hole.n,
        par: hole.par,
        strokeIndex: hole.idx ?? null,
        /* The 144 card cells are gated exactly by nvgkbuild/check3d.mjs against
           the club's own 2025 scorecard, so par and index are verified -- and
           the numbering is the CARD's, not the survey's: this club renumbered
           the par-5 west corridor and the par-4 east corridor the other way
           round, and reconcile.mjs asserts that swap by centreline length
           rather than assuming it. The LINE is not verified: every one is a
           satellite trace anchored on the club's GPS survey and slid to the
           card length, because OSM has no golf mapping here at all. */
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
    throw new Error('live GPK1 manifest has no complete Norrfällsviken entry');
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
    path.join(ROOT, 'geo_data/course-v2/norrfallsviken/acquisition/terrain-window.json'), 'utf8'));
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
  const compilation = assertNorrfallsvikenCompilation(compileTerrainAssets({
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
  const manifestPath = path.join(ROOT, 'geo_data/course-v2/norrfallsviken/source-manifest.json');
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
    kind: 'norrfallsviken-terrain-graph',
    state: 'published-provisional',
    provisionalReasons: [
      'course-origin-awaits-independent-control-approval',
      'playing-surfaces-are-satellite-traces-anchored-on-the-club-gps-survey-not-survey-grade',
      'legacy-terrarium-water-levels-and-the-measured-dtm-are-not-yet-reconciled',
    ],
    source: {
      itemIds: CONFIG.sourceItemIds,
      sourceAssets: CONFIG.sourceAssets,
      sourceFloat32Sha256,
      acquisitionEvidence: 'geo_data/course-v2/norrfallsviken/acquisition/terrain-window.json',
      acquiredOn: acquisition.acquiredOn,
      capture: CONFIG.sourceCapture,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow,
      sourceItems: acquisition.sourceItems,
    },
    reviewedWindow: {
      playedBoundsEpsg3006: reviewedWindow.playedBounds,
      playedCoordinatePairs: reviewedWindow.playedPoints,
      landmarkBoundsEpsg3006: reviewedWindow.landmarkBounds,
      containedBoundsEpsg3006: reviewedWindow.containedBounds,
      tilesPerSide: reviewedWindow.tilesPerSide,
      playedMarginMetres: reviewedWindow.playedMargin,
      containedMarginMetres: reviewedWindow.containedMargin,
      requiredSpanMetres: Math.round(reviewedWindow.requiredSpanMetres * 10) / 10,
      halvedSpanMetres: reviewedWindow.halvedSpanMetres,
      note: 'the smallest square power-of-two tile count holding every played point and the chapel, harbour piers and marina basins with a 100 m zone-A margin; the easting is centred on the played bounds and the north pixel edge is the 10 km item boundary. Half this size was checked and fails.',
    },
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
  await writeFile(path.join(options.out, 'norrfallsviken-terrain-graph-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Norrfällsviken ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
