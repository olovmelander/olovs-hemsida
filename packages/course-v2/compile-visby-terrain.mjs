#!/usr/bin/env node
/* Stage only; never writes a live ground/course/root manifest.
   node packages/course-v2/compile-visby-terrain.mjs [--terrain-f32 FILE] [--out visbybuild/cache/terrain-stage] */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISBY_GROUND_GRAPH_CONFIG as CONFIG, assertVisbyAcquisition, assertVisbyReferenceExtent, assertVisbyCompilation } from './visby-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { writeTerrainPreviewBundle } from './terrain-preview-node.mjs';
import { readChunk } from './chunk-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

async function main() {
  const options = { terrain: 'visbybuild/cache/terrain-review/terrain-1m.f32', out: 'visbybuild/cache/terrain-stage' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--terrain-f32' && args[index + 1]) options.terrain = args[++index];
    else if (args[index] === '--out' && args[index + 1]) options.out = args[++index];
    else throw new Error(`unknown or incomplete argument ${args[index]}`);
  }
  const output = path.resolve(ROOT, options.out);
  if (!output.startsWith(`${path.resolve(ROOT, 'visbybuild/cache')}${path.sep}`)) throw new Error('Visby terrain is not release-approved: --out must stay beneath visbybuild/cache');
  const terrainPath = path.resolve(ROOT, options.terrain);
  const acquired = await json('geo_data/course-v2/visby/acquisition/terrain-window.json');
  const discovery = await json('geo_data/course-v2/visby/acquisition/d2-discovery.json');
  assertVisbyAcquisition(acquired, sha256(await readFile(terrainPath)), discovery);
  const referencePath = 'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson';
  const reference = await json(referencePath);
  const referenceExtent = assertVisbyReferenceExtent(reference);
  const source = await readFloat32TerrainFile(terrainPath, { width: CONFIG.width, height: CONFIG.height, littleEndian: true, noDataValue: -9999 });
  const encodedSamples = Buffer.allocUnsafe(source.heights.length * 4);
  source.heights.forEach((height, index) => encodedSamples.writeFloatLE(height, index * 4));
  assertVisbyAcquisition(acquired, sha256(encodedSamples), discovery);
  const compilation = assertVisbyCompilation(compileTerrainAssets({
    groundId: CONFIG.groundId, courseSlugs: CONFIG.courseSlugs, heights: source.heights,
    width: CONFIG.width, height: CONFIG.height, originEasting: CONFIG.originEasting, originNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: CONFIG.sampleSpacingMetres, tileSegments: CONFIG.tileSegments, heightScaleMetres: 0.01,
  }));
  for (const bytes of compilation.resources.values()) readChunk(bytes);
  // The screenshot-only descriptor has a 64-tile budget. Persist the entire
  // 341-tile 1 m pyramid, but show its existing 2 m level in the broad preview.
  // No source samples or finest assets are replaced by this preview selection.
  const bundle = await writeTerrainPreviewBundle(output, { ...compilation, tiles: compilation.tiles.filter(tile => tile.lod >= 1) }, { label: 'Visby GK - 2 m terrain overview; retained finest terrain is 1 m' });
  const descriptorBytes = await readFile(bundle.descriptorPath);
  const stagingManifestPath = path.join(output, 'terrain-stage-assets.json');
  const stagingManifestBytes = `${JSON.stringify({ schemaVersion: 1, kind: 'terrain-intake-assets', state: 'staged-terrain-only', groundId: CONFIG.groundId, courseSlugs: CONFIG.courseSlugs, frame: bundle.descriptor.frame, bounds: compilation.bounds, shell: compilation.shell, tiles: compilation.tiles }, null, 2)}\n`;
  await writeFile(stagingManifestPath, stagingManifestBytes);
  const report = {
    schemaVersion: 1, groundId: CONFIG.groundId, courseSlugs: CONFIG.courseSlugs, kind: 'visby-terrain-intake-compilation', state: 'staged-terrain-only', acquiredOn: acquired.acquiredOn,
    source: { itemIds: CONFIG.sourceItemIds, sourceFloat32Sha256: CONFIG.sourceFloat32Sha256, acquisitionEvidence: 'geo_data/course-v2/visby/acquisition/terrain-window.json', sourceRaster: acquired.raster.path, sampleSpacingMetres: 1, pixelEdgeWindowEpsg3006: CONFIG.pixelEdgeWindow },
    referenceExtent: { ...referenceExtent, sourcePath: referencePath, status: 'unreviewed-supplementary-OSM', note: 'Coverage checked against the identified property polygon. This is not an approved property or playing-surface survey.' },
    bounds: compilation.bounds, frame: bundle.descriptor.frame, frameStatus: 'provisional-preview-convention-not-approved-canonical-origin',
    compile: compilation.stats, validation: { allChunksDecoded: compilation.resources.size, missingSamples: 0 },
    stagingManifest: { path: path.relative(ROOT, stagingManifestPath).split(path.sep).join('/'), bytes: Buffer.byteLength(stagingManifestBytes), sha256: sha256(stagingManifestBytes) },
    preview: { path: path.relative(ROOT, bundle.descriptorPath).split(path.sep).join('/'), bytes: descriptorBytes.length, sha256: sha256(descriptorBytes), sampleSpacingMetres: 2, tiles: bundle.descriptor.tiles.length, note: 'The screenshot descriptor uses the existing 2 m LOD under its 64-tile limit; all 256 finest 1 m tiles and coarser assets are retained in this staging tree.' },
    releaseGates: { playableCourse: false, authoritativeSurfaces: false, canonicalOriginApproved: false, measuredVegetation: false, perHoleVisualReview: false, remotePublication: false },
    next: 'Register current routing and surfaces against licensed imagery and independent controls before authoring a playable course graph. Source sea heights represent the water surface, never bathymetry.',
  };
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(output, 'terrain-stage-report.json'), reportBytes);
  await writeFile(path.join(ROOT, 'geo_data/course-v2/visby/acquisition/terrain-compile.json'), reportBytes);
  console.log(JSON.stringify({ state: report.state, sourceSha256: CONFIG.sourceFloat32Sha256, sourceSamples: compilation.stats.sourceSamples, tiles: compilation.stats.tileChunks, chunks: compilation.resources.size, encodedBytes: compilation.stats.encodedBytes, preview: report.preview, report: 'geo_data/course-v2/visby/acquisition/terrain-compile.json' }, null, 2));
}
main().catch(error => { console.error(`Visby terrain compilation failed: ${error.message}`); process.exitCode = 1; });
