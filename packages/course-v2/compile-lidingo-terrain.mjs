#!/usr/bin/env node
/* Compile the retained 1 m Lidingö DTM into an isolated terrain preview.
   This writes no course, ground or root runtime manifest.

   node packages/course-v2/compile-lidingo-terrain.mjs
   Optional: --terrain-f32 FILE --out lidingobuild/cache/terrain-stage */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIDINGO_GROUND_GRAPH_CONFIG as CONFIG, assertLidingoAcquisition,
  assertLidingoReferenceExtent, assertLidingoCompilation } from './lidingo-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { writeTerrainPreviewBundle } from './terrain-preview-node.mjs';
import { readChunk } from './chunk-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const options = { terrain: 'lidingobuild/cache/terrain-review/terrain-1m.f32', out: 'lidingobuild/cache/terrain-stage' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--terrain-f32' && args[index + 1]) options.terrain = args[++index];
    else if (args[index] === '--out' && args[index + 1]) options.out = args[++index];
    else throw new Error(`unknown or incomplete argument ${args[index]}`);
  }
  const output = path.resolve(ROOT, options.out);
  const cache = path.resolve(ROOT, 'lidingobuild/cache');
  if (!output.startsWith(`${cache}${path.sep}`)) {
    throw new Error('Lidingö terrain is not release-approved: --out must stay beneath lidingobuild/cache');
  }
  const terrainPath = path.resolve(ROOT, options.terrain);
  const acquired = JSON.parse(await readFile(path.join(ROOT, 'geo_data/course-v2/lidingo/acquisition/terrain-window.json'), 'utf8'));
  assertLidingoAcquisition(acquired, sha256(await readFile(terrainPath)));
  const reference = JSON.parse(await readFile(path.join(ROOT, 'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson'), 'utf8'));
  const referenceExtent = assertLidingoReferenceExtent(reference);
  const source = await readFloat32TerrainFile(terrainPath, { width: CONFIG.width, height: CONFIG.height, littleEndian: true, noDataValue: -9999 });
  // Recheck the bytes actually decoded; a file changed between reads must fail.
  const encodedSamples = Buffer.allocUnsafe(source.heights.length * 4);
  source.heights.forEach((height, index) => encodedSamples.writeFloatLE(height, index * 4));
  assertLidingoAcquisition(acquired, sha256(encodedSamples));
  const compilation = assertLidingoCompilation(compileTerrainAssets({
    groundId: CONFIG.groundId, courseSlugs: [CONFIG.courseSlug], heights: source.heights,
    width: CONFIG.width, height: CONFIG.height,
    originEasting: CONFIG.originEasting, originNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: CONFIG.sampleSpacingMetres, tileSegments: CONFIG.tileSegments,
    heightScaleMetres: 0.01,
  }));
  for (const bytes of compilation.resources.values()) readChunk(bytes);
  const bundle = await writeTerrainPreviewBundle(output, compilation, { label: 'Lidingö GK – terrängunderlag, ej godkänd bana' });
  const descriptorBytes = await readFile(bundle.descriptorPath);
  const report = {
    schemaVersion: 1, groundId: CONFIG.groundId, kind: 'lidingo-terrain-intake-compilation',
    state: 'staged-terrain-only', acquiredOn: acquired.acquiredOn,
    source: { itemIds: [...CONFIG.sourceItemIds], sourceFloat32Sha256: CONFIG.sourceFloat32Sha256,
      acquisitionEvidence: 'geo_data/course-v2/lidingo/acquisition/terrain-window.json',
      sourceRaster: acquired.raster.path, sampleSpacingMetres: CONFIG.sampleSpacingMetres,
      pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow },
    referenceExtent: { ...referenceExtent, status: 'unreviewed-supplementary-OSM',
      note: 'Margin is checked against retained reference vertices. It is not an approved property or playing-surface survey.' },
    bounds: compilation.bounds, frame: bundle.descriptor.frame,
    frameStatus: 'provisional-preview-convention-not-approved-canonical-origin',
    compile: compilation.stats,
    validation: { allChunksDecoded: compilation.resources.size, missingSamples: 0 },
    preview: { path: path.relative(ROOT, bundle.descriptorPath).split(path.sep).join('/'), bytes: descriptorBytes.length, sha256: sha256(descriptorBytes) },
    releaseGates: { playableCourse: false, authoritativeSurfaces: false, canonicalOriginApproved: false,
      measuredVegetation: false, perHoleVisualReview: false, remotePublication: false },
    next: 'Review current source geometry, close missing played-surface inventory and independent-origin gates before emitting a playable course graph.',
  };
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(output, 'terrain-stage-report.json'), reportBytes);
  await writeFile(path.join(ROOT, 'geo_data/course-v2/lidingo/acquisition/terrain-compile.json'), reportBytes);
  console.log(JSON.stringify({ state: report.state, sourceSha256: CONFIG.sourceFloat32Sha256,
    sourceSamples: compilation.stats.sourceSamples, tiles: compilation.stats.tileChunks,
    chunks: compilation.resources.size, encodedBytes: compilation.stats.encodedBytes,
    preview: report.preview, report: 'geo_data/course-v2/lidingo/acquisition/terrain-compile.json' }, null, 2));
}

main().catch(error => { console.error(`Lidingö terrain compilation failed: ${error.message}`); process.exitCode = 1; });
