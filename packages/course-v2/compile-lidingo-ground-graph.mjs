/* Build the provisional Lidingö 3D graph from retained, checksummed sources.
 * This software publication does not approve the pending surveyed controls. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIDINGO_GROUND_GRAPH_CONFIG as CONFIG, assertLidingoAcquisition, assertLidingoCompilation } from './lidingo-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { planV2LegacyCutout } from '../../apps/golf/src/engine/v2-legacy-cutout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async p => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (p, obj) => writeFile(path.join(ROOT, p), JSON.stringify(obj, null, 2) + '\n');
const terrainPath = path.join(ROOT, 'lidingobuild/cache/terrain-review/terrain-1m.f32');
const sourceBytes = await readFile(terrainPath);
assertLidingoAcquisition(await json('geo_data/course-v2/lidingo/acquisition/terrain-window.json'), hash(sourceBytes));
const { heights } = await readFloat32TerrainFile(terrainPath, { width: CONFIG.width, height: CONFIG.height, littleEndian: true, noDataValue: -9999 });
let compilation = assertLidingoCompilation(compileTerrainAssets({
  groundId: CONFIG.groundId, courseSlugs: [CONFIG.courseSlug], heights,
  width: CONFIG.width, height: CONFIG.height, originEasting: CONFIG.originEasting,
  originNorthing: CONFIG.originNorthing, sampleSpacingMetres: 1, tileSegments: 256, heightScaleMetres: 0.01,
}));
const frame = createProvisionalFrame(compilation.bounds);
const sourceManifest = await readFile(path.join(ROOT, 'geo_data/course-v2/lidingo/source-manifest.json'), 'utf8');
const migrated = await json('geo_data/course-v2/lidingo/migration/course-model.epsg3006.json');
const model = await json('lidingobuild/course-model.json');
const holes = (migrated.geometry?.holes || migrated.holes).map(h => ({
  number: h.n, par: h.par, strokeIndex: h.idx, strokeIndexStatus: 'verified',
  accuracyTier: 'unrated', line: h.line.map(([e, n]) => [e, n]),
}));
if (migrated.groundId !== 'lidingo' || holes.length !== 18) throw new Error('Incomplete Lidingö migration');
const index = await json('apps/golf/public/courses/index.json');
const entry = index.courses.find(c => c.slug === 'lidingo');
if (!entry) throw new Error('Publish the compatibility pack before the graph');
const sampler = new TerrainPyramidSampler(compilation.pyramid);
/* attachLidingoStands verifies source rasters, exclusions, bounds and the
 * frame fingerprint before returning a compilation with stand-layer refs. */
const { attachLidingoStands } = await import('./vegetation/compile-lidingo-stands.mjs');
compilation = await attachLidingoStands(compilation, frame);
const graph = emitGroundGraph({ compilation, frame, sourceManifestSha256: hash(sourceManifest.replace(/\r\n/g, '\n')),
  course: { slug: 'lidingo', name: entry.name, holes },
  fallbackV1: { format: 1, packUrl: entry.packUrl, bytes: entry.bytes, sha256: entry.sha256 },
  heightAt: (e, n) => sampler.sample(e, n)?.heightRH2000 ?? NaN, holeTileBufferMetres: 90,
});
await writeGroundGraphFiles(path.join(ROOT, 'apps/golf/public'), graph);
const points = model.holes.flatMap(h => [...h.line, ...h.green.ring]).concat(
  model.scenery.greens.flat(), model.scenery.range.flat());
const snap = v => Math.round(v / 36) * 36;
const grid = { dx: 4,
  x0: snap(Math.min(...points.map(p => p[0])) - 150), x1: snap(Math.max(...points.map(p => p[0])) + 150),
  z0: snap(Math.min(...points.map(p => p[1])) - 150), z1: snap(Math.max(...points.map(p => p[1])) + 150),
};
const cut = planV2LegacyCutout({ grid, previewBounds: { x0: -1024, x1: 1024, z0: -1024, z1: 1024 }, enabled: true, preflightStatus: 'ready', guardCells: 2 });
await write('lidingobuild/mapping/runtime-contract.json', { frame, bounds: compilation.bounds,
  packOriginWgs84: { latitude: model.origin.lat, longitude: model.origin.lon }, packMetresPerLongitude: model.mPerLon,
  packFrame: model.frame, core: grid, cutout: cut });
await write('apps/golf/public/lidingo-ground-graph-report.json', {
  schemaVersion: 1, kind: 'lidingo-ground-graph', state: 'published-provisional',
  provisionalReasons: ['independent-origin-and-local-residual-controls-pending', 'playing-surfaces-machine-traced-2019-not-as-built',
    'canopy-capture-2021-and-current-course-changes-need-review', 'tee-colour-and-flag-positions-unknown'],
  source: { terrainItem: '658_67', terrainFloat32Sha256: CONFIG.sourceFloat32Sha256, sampleSpacingMetres: 1 },
  frame, terrain: compilation.stats, graph: graph.report,
});
console.log(JSON.stringify({ graph: graph.report, frame, core: grid, cutout: cut }, null, 2));
