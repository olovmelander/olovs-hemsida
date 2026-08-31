#!/usr/bin/env node
/* Compile the full aligned Puttom AOI into the publishable v2 ground graph.
   Runs on the authenticated CI runner after gdal_translate has produced the
   windowed COG, its gdalinfo JSON and an XYZ dump; everything else — window
   contract, identity gate against the committed retained preview, manifest
   emission and self-verification — is deterministic repository code. */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { verifyChunkAsset } from './chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import {
  PUTTOM_GROUND_GRAPH_CONFIG,
  assertFullSourceCoverage,
  assertPreviewIdentity,
  comparePreviewToMaster,
  decodeFinestLevel,
  puttomAlignedExtent,
} from './puttom-ground-graph.mjs';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function argumentsFrom(argv) {
  const options = { xyz: null, info: null, out: null, itemId: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--xyz') options.xyz = argv[++index];
    else if (argv[index] === '--info') options.info = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--item-id') options.itemId = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  for (const required of ['xyz', 'info', 'out', 'itemId']) {
    if (!options[required]) throw new Error(`--${required.replace('itemId', 'item-id')} is required`);
  }
  return options;
}

function assertWindow(info, aligned) {
  const { width, height } = PUTTOM_GROUND_GRAPH_CONFIG.expectedAligned;
  if (info.size?.[0] !== width || info.size?.[1] !== height) {
    throw new Error(`terrain window is ${info.size?.join('x') || '<missing>'}; expected ${width}x${height}`);
  }
  if (info.metadata?.IMAGE_STRUCTURE?.LAYOUT !== 'COG') {
    throw new Error('compiled terrain output is not identified as a COG');
  }
  const wkt = info.coordinateSystem?.wkt || '';
  if (!wkt.startsWith('COMPOUNDCRS') || !wkt.includes('SWEREF99') || !wkt.includes('RH2000')) {
    throw new Error('compiled terrain output lost SWEREF 99 or RH 2000');
  }
  const spacing = PUTTOM_GROUND_GRAPH_CONFIG.sampleSpacingMetres;
  const transform = info.geoTransform || [];
  const expected = [aligned.projwin.west, spacing, 0, aligned.projwin.north, 0, -spacing];
  if (transform.length !== 6 ||
      transform.some((value, index) => Math.abs(value - expected[index]) > 1e-9)) {
    throw new Error(`unexpected terrain geotransform ${JSON.stringify(transform)}`);
  }
  const band = info.bands?.[0];
  if (!band) throw new Error('terrain window has no raster band');
  return { transform, noDataValue: Number.isFinite(band.noDataValue) ? band.noDataValue : null };
}

async function readXyzGrid(xyzPath, { transform, width, height, noDataValue }) {
  const heights = new Float32Array(width * height);
  let sampleIndex = 0;
  const lines = createInterface({
    input: createReadStream(xyzPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    if (sampleIndex >= heights.length) throw new Error('XYZ terrain contains too many samples');
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) throw new Error(`invalid XYZ terrain line ${sampleIndex + 1}`);
    const [easting, northing, sourceHeight] = parts.map(Number);
    const column = sampleIndex % width;
    const row = Math.floor(sampleIndex / width);
    const expectedEasting = transform[0] + transform[1] * (column + 0.5);
    const expectedNorthing = transform[3] + transform[5] * (row + 0.5);
    if (Math.abs(easting - expectedEasting) > 1e-6 || Math.abs(northing - expectedNorthing) > 1e-6) {
      throw new Error(`XYZ terrain sample ${sampleIndex} is out of row-major grid order`);
    }
    if (!Number.isFinite(sourceHeight)) throw new Error(`XYZ terrain sample ${sampleIndex} is not finite`);
    heights[sampleIndex++] = sourceHeight === noDataValue ? Number.NaN : sourceHeight;
  }
  if (sampleIndex !== heights.length) {
    throw new Error(`XYZ terrain contains ${sampleIndex} samples; expected ${heights.length}`);
  }
  return heights;
}

function committedPreviewTiles() {
  const previewRoot = path.join(ROOT, 'apps/golf/public/v2/puttom');
  const descriptor = assertTerrainPreview(
    JSON.parse(readFileSync(path.join(previewRoot, 'preview.json'), 'utf8')),
  );
  return descriptor.tiles.map(tile => {
    const file = path.resolve(previewRoot, tile.reference.url);
    if (!file.startsWith(`${previewRoot}${path.sep}`)) {
      throw new Error(`committed preview asset escapes its root: ${tile.reference.url}`);
    }
    const decoded = verifyChunkAsset(tile.reference, readFileSync(file));
    return {
      id: tile.id,
      bounds: decoded.header.bounds,
      grid: decoded.header.grid,
      heights: decodeTerrainGrid(decoded.payload, decoded.header.grid),
    };
  });
}

function assertPreviewLattice(previewTiles, aligned) {
  const { column, row } = PUTTOM_GROUND_GRAPH_CONFIG.previewLatticeOffset;
  const span = PUTTOM_GROUND_GRAPH_CONFIG.tileSegments * PUTTOM_GROUND_GRAPH_CONFIG.sampleSpacingMetres;
  const first = previewTiles.find(tile => tile.id === 'l0/0/0');
  if (!first) throw new Error('committed preview is missing tile l0/0/0');
  const expectedEasting = aligned.originEasting + column * span;
  const expectedNorthing = aligned.originNorthing - row * span;
  if (Math.abs(first.bounds.minEasting - expectedEasting) > 1e-9 ||
      Math.abs(first.bounds.maxNorthing - expectedNorthing) > 1e-9) {
    throw new Error('retained preview lattice is not the reviewed subgrid of the aligned AOI');
  }
}

function migratedCourse() {
  const model = JSON.parse(readFileSync(
    path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json'), 'utf8',
  ));
  if (model.groundId !== 'puttom' || !Array.isArray(model.geometry?.holes)) {
    throw new Error('Puttom migration model is missing its hole geometry');
  }
  const holes = [...model.geometry.holes].sort((left, right) => left.n - right.n).map((hole, index) => {
    if (hole.n !== index + 1) throw new Error(`migrated Puttom holes are not numbered 1..18 at ${hole.n}`);
    return {
      number: hole.n,
      par: hole.par,
      strokeIndex: hole.idx,
      strokeIndexStatus: 'verified',
      accuracyTier: 'unrated',
      line: hole.line.map(([easting, northing]) => [easting, northing]),
    };
  });
  if (holes.length !== 18) throw new Error(`migrated Puttom model has ${holes.length} holes; expected 18`);
  return holes;
}

function liveCourseEntry() {
  const index = JSON.parse(readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
  const entry = index.courses?.find(course => course.slug === PUTTOM_GROUND_GRAPH_CONFIG.courseSlug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || !entry.packUrl || !entry.name) {
    throw new Error('live GPK1 manifest has no complete Puttom entry');
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
  const aligned = puttomAlignedExtent();
  if (options.itemId !== PUTTOM_GROUND_GRAPH_CONFIG.expectedSourceItemId) {
    throw new Error(`terrain source item is ${options.itemId}; the reviewed window expects ${
      PUTTOM_GROUND_GRAPH_CONFIG.expectedSourceItemId}`);
  }
  const info = JSON.parse(readFileSync(options.info, 'utf8'));
  const { transform, noDataValue } = assertWindow(info, aligned);
  const heights = await readXyzGrid(options.xyz, {
    transform,
    width: aligned.width,
    height: aligned.height,
    noDataValue,
  });

  const compiled = compileTerrainAssets({
    groundId: PUTTOM_GROUND_GRAPH_CONFIG.groundId,
    courseSlugs: [PUTTOM_GROUND_GRAPH_CONFIG.courseSlug],
    heights,
    width: aligned.width,
    height: aligned.height,
    originEasting: transform[0] + transform[1] / 2,
    originNorthing: transform[3] + transform[5] / 2,
    sampleSpacingMetres: PUTTOM_GROUND_GRAPH_CONFIG.sampleSpacingMetres,
    tileSegments: PUTTOM_GROUND_GRAPH_CONFIG.tileSegments,
    heightScaleMetres: 0.01,
  });
  const expectedCompile = PUTTOM_GROUND_GRAPH_CONFIG.expectedCompile;
  if (compiled.stats.levels.length !== expectedCompile.levels ||
      compiled.stats.tileChunks !== expectedCompile.tileChunks ||
      compiled.stats.uniqueChunks !== expectedCompile.uniqueChunks ||
      compiled.stats.rootTiles !== expectedCompile.rootTiles) {
    throw new Error(`unexpected BVCH pyramid ${JSON.stringify(compiled.stats)}`);
  }

  /* Coverage before identity: the identity gate only sees the interior
     preview subgrid, so it cannot notice a padded outer ring at all. */
  const coverage = assertFullSourceCoverage({
    stats: compiled.stats,
    pyramid: compiled.pyramid,
    noDataValue,
  });

  const previewTiles = committedPreviewTiles();
  assertPreviewLattice(previewTiles, aligned);
  const identity = assertPreviewIdentity(
    comparePreviewToMaster(previewTiles, decodeFinestLevel(compiled.pyramid)),
  );

  const { name, fallbackV1 } = liveCourseEntry();
  const sampler = new TerrainPyramidSampler(compiled.pyramid);
  const graph = emitGroundGraph({
    compilation: compiled,
    frame: createProvisionalFrame(compiled.bounds),
    sourceManifestSha256: createHash('sha256')
      .update(readFileSync(path.join(ROOT, 'geo_data/course-v2/puttom/source-manifest.json')))
      .digest('hex'),
    course: {
      slug: PUTTOM_GROUND_GRAPH_CONFIG.courseSlug,
      name,
      holes: migratedCourse(),
    },
    fallbackV1,
    heightAt: (easting, northing) => sampler.sample(easting, northing)?.heightRH2000 ?? Number.NaN,
    holeTileBufferMetres: PUTTOM_GROUND_GRAPH_CONFIG.holeTileBufferMetres,
  });
  await writeGroundGraphFiles(options.out, graph);

  const report = {
    schemaVersion: 1,
    kind: 'puttom-ground-graph',
    provisional: true,
    provisionalReason: 'origin-not-approved-and-renderer-not-activated',
    sourceItemId: options.itemId,
    alignedWindow: {
      originEasting: aligned.originEasting,
      originNorthing: aligned.originNorthing,
      tilesX: aligned.tilesX,
      tilesY: aligned.tilesY,
      width: aligned.width,
      height: aligned.height,
      projwin: aligned.projwin,
    },
    compile: {
      sourceSamples: compiled.stats.sourceSamples,
      finiteSamples: compiled.stats.finiteSamples,
      tileChunks: compiled.stats.tileChunks,
      uniqueChunks: compiled.stats.uniqueChunks,
      encodedBytes: compiled.stats.encodedBytes,
      decodedBytes: compiled.stats.decodedBytes,
      shellEncodedBytes: compiled.stats.shellEncodedBytes,
      sharedHeightOffsetMetres: compiled.pyramid.commonHeightOffsetMetres,
      heightScaleMetres: compiled.pyramid.heightScaleMetres,
      seamsVerified: compiled.pyramid.seamsVerified,
      levels: compiled.stats.levels,
    },
    sourceCoverage: coverage,
    previewIdentity: identity,
    graph: graph.report,
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    path.join(path.resolve(options.out), 'puttom-ground-graph-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`Puttom ground-graph compilation failed: ${error.message}`);
  process.exitCode = 1;
});
