/* Compile Visby's source-derived 3D graph. Defaults to isolated staging;
   --out apps/golf/public activates only Visby's merged root entry.
   node packages/course-v2/compile-visby-ground-graph.mjs [--out DIRECTORY]
   A software publication does not approve pending source or survey controls. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISBY_GROUND_GRAPH_CONFIG as CONFIG, assertVisbyAcquisition, assertVisbyCompilation } from './visby-ground-graph.mjs';
import { compileTerrainAssets, readFloat32TerrainFile } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { readPack, inflateStream } from '../course-pack/lib.mjs';
import { runtimeWater } from '../course-pack/runtime-water.mjs';
import { planV2LegacyCutout } from '../../apps/golf/src/engine/v2-legacy-cutout.mjs';
import { VISBY_FRAME, VISBY_FRONTIER_BOUNDS, projected } from '../../visbybuild/frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, object) => writeFile(file, `${JSON.stringify(object, null, 2)}\n`);

export function assertVisbyCanonicalRouting(geometry, model, pack) {
  if (geometry?.groundId !== 'visby' || geometry.courseSlug !== 'visby' || geometry.horizontalCrs !== 'EPSG:3006' || geometry.holes?.length !== 18 || model.holes?.length !== 18) throw new Error('Visby graph needs all 18 canonical routes and the authored model');
  if (pack.header.slug !== 'visby' || pack.header.GEO.frame !== VISBY_FRAME.text ||
      pack.header.GEO.origin.lat !== VISBY_FRAME.latitude || pack.header.GEO.origin.lon !== VISBY_FRAME.longitude ||
      model.frame !== VISBY_FRAME.text || model.origin.lat !== VISBY_FRAME.latitude || model.origin.lon !== VISBY_FRAME.longitude ||
      pack.header.GEO.mPerLon !== model.mPerLon) throw new Error('Visby pack and canonical frame differ');
  const vectors = JSON.parse(inflateStream(pack.sv).toString('utf8'));
  if (vectors.holes.length !== 18) throw new Error('Visby fallback has an incomplete hole set');
  if (model.water && JSON.stringify(vectors.water) !== JSON.stringify(model.water.map(runtimeWater))) throw new Error('Visby fallback water or original shoreline evidence differs from the authored model');
  const holes = model.holes.map((hole, index) => {
    const source = geometry.holes.find(record => record.n === hole.n), fallback = vectors.holes[index];
    if (!source || hole.n !== index + 1 || fallback.n !== hole.n || fallback.par !== hole.par || fallback.idx !== hole.idx ||
        JSON.stringify(fallback.line) !== JSON.stringify(hole.line) || JSON.stringify(fallback.t) !== JSON.stringify(hole.t) ||
        JSON.stringify(fallback.green.ring) !== JSON.stringify(hole.green.ring) ||
        JSON.stringify(fallback.fairway.rings) !== JSON.stringify(hole.fairway.rings) ||
        fallback.tees.status !== hole.tees.status || JSON.stringify(fallback.tees.pads.map(pad => pad.ring)) !== JSON.stringify(hole.tees.pads.map(pad => pad.ring)) ||
        JSON.stringify(fallback.tees.marks.map(mark => mark.c)) !== JSON.stringify(hole.tees.marks.map(mark => mark.c)) ||
        JSON.stringify(fallback.bunkers.map(bunker => bunker.ring)) !== JSON.stringify(hole.bunkers.map(bunker => bunker.ring))) throw new Error(`Visby hole ${index + 1} fallback differs from authored geometry`);
    if (source.line.length !== hole.line.length || source.line.some((point, number) => point.some((value, axis) => Math.abs(value - projected(hole.line[number])[axis]) > 1e-7))) throw new Error(`Visby hole ${hole.n} was moved from its canonical source route`);
    return { number: hole.n, par: hole.par, strokeIndex: hole.idx, strokeIndexStatus: 'verified', accuracyTier: 'unrated', line: source.line.map(point => [...point]) };
  });
  return holes;
}

export function visbyRuntimeContract(model, frame, bounds) {
  const points = model.holes.flatMap(hole => [...hole.line, ...hole.green.ring]).concat(model.scenery.greens.flat(), model.scenery.range.flat());
  const snap = value => Math.round(value / 36) * 36;
  const core = { dx: 4, x0: snap(Math.min(...points.map(p => p[0])) - 150), x1: snap(Math.max(...points.map(p => p[0])) + 150), z0: snap(Math.min(...points.map(p => p[1])) - 150), z1: snap(Math.max(...points.map(p => p[1])) + 150) };
  const previewBounds = { x0: VISBY_FRONTIER_BOUNDS.minEasting - VISBY_FRAME.easting, x1: VISBY_FRONTIER_BOUNDS.maxEasting - VISBY_FRAME.easting, z0: VISBY_FRAME.northing - VISBY_FRONTIER_BOUNDS.maxNorthing, z1: VISBY_FRAME.northing - VISBY_FRONTIER_BOUNDS.minNorthing };
  if (model.holes.flatMap(hole => [...hole.line, ...hole.green.ring, ...hole.tees.pads.flatMap(pad => pad.ring), ...hole.fairway.rings.flat()]).some(([x, z]) => x < previewBounds.x0 || x > previewBounds.x1 || z < previewBounds.z0 || z > previewBounds.z1)) throw new Error('Visby played geometry leaves the active native-metre terrain frontier');
  const cutout = planV2LegacyCutout({ grid: core, previewBounds, enabled: true, preflightStatus: 'ready', guardCells: 2 });
  return { frame, bounds, frontierBounds: VISBY_FRONTIER_BOUNDS, expectedTileCount: 64, packOriginWgs84: { latitude: model.origin.lat, longitude: model.origin.lon }, packMetresPerLongitude: model.mPerLon, packFrame: model.frame, core, cutout };
}

/** The ground manifest the given public directory currently serves, or null. */
export async function readLiveGroundManifest(publicDirectory) {
  try {
    const rootIndex = JSON.parse(await readFile(path.join(publicDirectory, 'courses/v2-index.json'), 'utf8'));
    const entry = rootIndex.courses.find(course => course.groundId === 'visby');
    if (!entry) return null;
    const courseManifest = JSON.parse(await readFile(path.join(publicDirectory, entry.manifest.url), 'utf8'));
    return JSON.parse(await readFile(path.join(publicDirectory, courseManifest.groundManifest.url), 'utf8'));
  } catch { return null; /* nothing published yet, or a partial tree: nothing to defend */ }
}

/** Why this compiler must not write over a published ground, or null if it may.
    A ring quadtree is recognised by its explicit parent links: levels share no
    index lattice, so the tile manager reads parentId rather than deriving it,
    and a pyramid written over the top would carry none. */
export function ringGraphRefusal(liveGroundManifest) {
  const tiles = liveGroundManifest?.tiles;
  if (!Array.isArray(tiles)) return null;
  const parents = tiles.filter(tile => tile.parentId).length;
  if (!parents) return null;
  return `a ring graph is published for this ground (${tiles.length} tiles, ${parents} with a parent); publish-ground-rings.mjs owns apps/golf/public now. Compile to the staged default and publish through the rings.`;
}

export async function compileVisbyGroundGraph({ outputDirectory = 'visbybuild/cache/graph-stage' } = {}) {
  const terrainPath = path.join(ROOT, 'visbybuild/cache/terrain-review/terrain-1m.f32');
  const sourceBytes = await readFile(terrainPath);
  const acquisition = await json('geo_data/course-v2/visby/acquisition/terrain-window.json');
  const discovery = await json('geo_data/course-v2/visby/acquisition/d2-discovery.json');
  assertVisbyAcquisition(acquisition, hash(sourceBytes), discovery);
  const { heights } = await readFloat32TerrainFile(terrainPath, { width: CONFIG.width, height: CONFIG.height, littleEndian: true, noDataValue: -9999 });
  // Re-read validation on exactly the source values supplied to compilation.
  const checkBytes = Buffer.allocUnsafe(heights.length * 4);
  heights.forEach((value, index) => checkBytes.writeFloatLE(value, index * 4));
  assertVisbyAcquisition(acquisition, hash(checkBytes), discovery);
  let compilation = assertVisbyCompilation(compileTerrainAssets({ groundId: 'visby', courseSlugs: ['visby'], heights, width: CONFIG.width, height: CONFIG.height, originEasting: CONFIG.originEasting, originNorthing: CONFIG.originNorthing, sampleSpacingMetres: 1, tileSegments: 256, heightScaleMetres: 0.01 }));
  const frame = createProvisionalFrame(compilation.bounds);
  if (['easting', 'northing', 'heightRH2000'].some(key => frame.origin[key] !== VISBY_FRAME[key])) throw new Error('Visby terrain origin differs from its agreed source frame');
  const model = await json('visbybuild/course-model.json');
  const geometry = await json('visbybuild/mapping/geometry.json');
  const packBytes = await readFile(path.join(ROOT, 'apps/golf/public/courses/visby/pack.bin'));
  const holes = assertVisbyCanonicalRouting(geometry, model, readPack(packBytes));
  const contract = visbyRuntimeContract(model, frame, compilation.bounds);
  const sourceManifest = await readFile(path.join(ROOT, 'geo_data/course-v2/visby/source-manifest.json'), 'utf8');
  const parsedManifest = JSON.parse(sourceManifest);
  if (parsedManifest.groundId !== 'visby' || JSON.stringify(parsedManifest.courseSlugs) !== JSON.stringify(['visby'])) throw new Error('Visby source manifest identity differs');
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  const { attachVisbyStands } = await import('../../geo_data/course-v2/visby/vegetation/compile-stands.mjs');
  compilation = attachVisbyStands(compilation, frame);
  const graph = emitGroundGraph({ compilation, frame, sourceManifestSha256: hash(sourceManifest.replace(/\r\n/g, '\n')),
    course: { slug: 'visby', name: 'Visby GK', holes },
    fallbackV1: { format: 1, packUrl: 'courses/visby/pack.bin', bytes: packBytes.length, sha256: hash(packBytes) },
    heightAt: (easting, northing) => sampler.sample(easting, northing)?.heightRH2000 ?? NaN, holeTileBufferMetres: 90 });
  const output = path.resolve(ROOT, outputDirectory);
  /* THIS COMPILER NO LONGER OWNS apps/golf/public. It writes the 341-tile
     source pyramid, and publish-ground-rings writes a 469-tile ring quadtree
     over the same paths -- so re-running this with --out apps/golf/public
     after a ring publish would replace the ring world with the pyramid, and
     because the pyramid carries no parentId the tile manager would silently
     fall back to the fixed 64-tile frontier with no error anywhere. That is
     the Ribbingsfors rule ("a rerun of one script must not undo the next
     one's work") meeting the parentId strip the notes record. The staged
     default is untouched; only the published directory is defended, and only
     when a ring graph is actually there to defend. */
  if (output === path.join(ROOT, 'apps/golf/public')) {
    const refusal = ringGraphRefusal(await readLiveGroundManifest(output));
    if (refusal) throw new Error(refusal);
  }
  await writeGroundGraphFiles(output, graph);
  await write(path.join(ROOT, 'visbybuild/mapping/runtime-contract.json'), contract);
  const report = { schemaVersion: 1, kind: 'visby-ground-graph', state: output === path.join(ROOT, 'apps/golf/public') ? 'published-provisional' : 'staged-provisional',
    provisionalReasons: ['independent-origin-and-local-residual-controls-pending', 'playing-surfaces-and-routes-source-derived-not-as-built', 'numeric-tee-marker-and-daily-flag-positions-unverified'],
    source: { terrainItems: CONFIG.sourceItemIds, terrainFloat32Sha256: CONFIG.sourceFloat32Sha256, sampleSpacingMetres: 1 }, frame, terrain: compilation.stats, graph: graph.report };
  await write(path.join(output, 'visby-ground-graph-report.json'), report);
  console.log(JSON.stringify({ output: path.relative(ROOT, output), graph: graph.report, frame, core: contract.core, cutout: contract.cutout }, null, 2));
  return { graph, compilation, contract, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('usage: compile-visby-ground-graph.mjs [--out DIRECTORY]');
  compileVisbyGroundGraph({ ...(args.length ? { outputDirectory: args[1] } : {}) }).catch(error => { console.error(`Visby graph compilation failed: ${error.message}`); process.exitCode = 1; });
}
