/* Retained-source Tortuna publication. The default is an isolated staging
 * tree; --out apps/golf/public changes only Tortuna's local root entry. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TORTUNA_GROUND_GRAPH_CONFIG as CONFIG, assertTortunaAcquisition, assertTortunaCompilation, attachTortunaTerrainParents, assertTortunaTerrainRetention } from './tortuna-ground-graph.mjs';
import { compileTerrainAssets, writeTerrainAssetFiles } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { readPack, inflateStream } from '../course-pack/lib.mjs';
import { runtimeWater } from '../course-pack/runtime-water.mjs';
import { planV2LegacyCutout } from '../../apps/golf/src/engine/v2-legacy-cutout.mjs';
import { TORTUNA_FRAME as FRAME, projected } from '../../tortunabuild/frame.mjs';
import { projectedCourseModel } from '../../tortunabuild/build-course.mjs';
import { canonicalJson } from './canonical-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const write = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };

export async function compileTortunaTerrain({ root = ROOT } = {}) {
  const bytes = await readFile(path.join(root, 'tortunabuild/cache/terrain/terrain-1m.f32'));
  assertTortunaAcquisition(await json(path.join(root, 'geo_data/course-v2/tortuna/acquisition/terrain-window.json')), hash(bytes));
  const heights = new Float32Array(CONFIG.width * CONFIG.height);
  for (let i = 0; i < heights.length; i++) heights[i] = bytes.readFloatLE(i * 4);
  const compilation = attachTortunaTerrainParents(assertTortunaCompilation(compileTerrainAssets({ groundId: 'tortuna', courseSlugs: ['tortuna'], heights,
    width: CONFIG.width, height: CONFIG.height, originEasting: CONFIG.originEasting, originNorthing: CONFIG.originNorthing,
    sampleSpacingMetres: 1, tileSegments: 256, heightScaleMetres: 0.01 })));
  const frame = createProvisionalFrame(compilation.bounds);
  if (frame.origin.easting !== FRAME.easting || frame.origin.northing !== FRAME.northing) throw new Error('Tortuna compilation moved its projected frame origin');
  return { compilation, frame };
}

export async function stageTortunaTerrain({ root = ROOT } = {}) {
  const result = await compileTortunaTerrain({ root });
  const { compilation, frame } = result;
  const output = path.join(root, 'tortunabuild/cache/terrain-stage');
  await writeTerrainAssetFiles(output, compilation);
  await write(path.join(output, 'terrain-compilation.json'), { schemaVersion: 1, groundId: 'tortuna', sourceSha256: CONFIG.sourceFloat32Sha256,
    frame, bounds: compilation.bounds, shell: compilation.shell, tiles: compilation.tiles, stats: compilation.stats });
  return result;
}

export function assertTortunaCanonicalRouting(migration, model, pack, modelSha256) {
  if (migration?.groundId !== 'tortuna' || migration.target?.horizontalCrs !== 'EPSG:3006' || migration.geometry?.holes?.length !== 18 || model.holes?.length !== 18 || migration.source?.sha256 !== modelSha256) throw new Error('Tortuna canonical model identity or source digest differs');
  /* The committed migration is the canonical migrator's artifact (CI regenerates it and demands byte
     identity, af1d7d4e), whose geometry is the WHOLE model projected; the generator's own projection is
     the holes alone. Both must agree on the holes exactly -- that is the routing the graph carries. */
  if (canonicalJson(migration.geometry?.holes) !== canonicalJson(projectedCourseModel(model, modelSha256).geometry.holes)) throw new Error('Tortuna canonical geometry differs from the exact authored source offsets');
  if (pack.header.slug !== 'tortuna' || pack.header.GEO.frame !== FRAME.text || model.frame !== FRAME.text || pack.header.GEO.origin.lat !== FRAME.latitude || pack.header.GEO.origin.lon !== FRAME.longitude || model.origin.lat !== FRAME.latitude || model.origin.lon !== FRAME.longitude || pack.header.GEO.mPerLon !== model.mPerLon) throw new Error('Tortuna fallback frame differs from the canonical source offsets');
  const vectors = JSON.parse(inflateStream(pack.sv).toString('utf8'));
  if (vectors.holes.length !== 18 || JSON.stringify(vectors.water) !== JSON.stringify(model.water.map(runtimeWater))) throw new Error('Tortuna fallback water or complete hole set differs');
  return model.holes.map((hole, i) => {
    const source = migration.geometry.holes[i], fallback = vectors.holes[i];
    if (source.n !== hole.n || hole.n !== i + 1 || fallback.n !== hole.n || fallback.par !== hole.par || fallback.idx !== hole.idx || JSON.stringify(fallback.line) !== JSON.stringify(hole.line) || JSON.stringify(fallback.t) !== JSON.stringify(hole.t) || JSON.stringify(fallback.pin) !== JSON.stringify(hole.pin) || JSON.stringify(fallback.green.ring) !== JSON.stringify(hole.green.ring) || JSON.stringify(fallback.fairway.rings) !== JSON.stringify(hole.fairway.rings) || JSON.stringify(fallback.tees.pads.map(p => p.ring)) !== JSON.stringify(hole.tees.pads.map(p => p.ring)) || JSON.stringify(fallback.tees.marks.map(m => m.c)) !== JSON.stringify(hole.tees.marks.map(m => m.c)) || JSON.stringify(fallback.bunkers.map(b => b.ring)) !== JSON.stringify(hole.bunkers.map(b => b.ring))) throw new Error(`Tortuna hole ${i + 1} fallback differs from authored geography`);
    if (source.line.length !== hole.line.length || source.line.some((p, index) => p.some((value, axis) => Math.abs(value - projected(hole.line[index])[axis]) > 1e-7))) throw new Error(`Tortuna hole ${hole.n} moved from its canonical route`);
    return { number: hole.n, par: hole.par, strokeIndex: hole.idx, strokeIndexStatus: hole.strokeIndexStatus, accuracyTier: 'unrated', line: source.line.map(p => [...p]) };
  });
}

export function tortunaRuntimeContract(model, frame, bounds) {
  const points = model.holes.flatMap(h => [...h.line, ...h.green.ring]).concat(model.scenery.greens.flat(), model.scenery.range.flat());
  const allPlayed = model.holes.flatMap(h => [...h.line, ...h.green.ring, ...h.tees.marks.map(m => m.c), ...h.tees.pads.flatMap(p => p.ring), ...h.fairway.rings.flat(), ...h.bunkers.flatMap(b => b.ring)]).concat(model.scenery.greens.flat(), model.scenery.range.flat());
  const snap = value => Math.round(value / 36) * 36;
  const core = { dx: 4, x0: snap(Math.min(...points.map(p => p[0])) - 150), x1: snap(Math.max(...points.map(p => p[0])) + 150), z0: snap(Math.min(...points.map(p => p[1])) - 150), z1: snap(Math.max(...points.map(p => p[1])) + 150) };
  const edge = (values, maximum) => Math.max(-2048, Math.min(2048, (maximum ? Math.ceil((Math.max(...values) + 64 + 2048) / 256) : Math.floor((Math.min(...values) - 64 + 2048) / 256)) * 256 - 2048));
  const preview = { x0: edge(allPlayed.map(p => p[0]), false), x1: edge(allPlayed.map(p => p[0]), true), z0: edge(allPlayed.map(p => p[1]), false), z1: edge(allPlayed.map(p => p[1]), true) };
  if (allPlayed.some(([x, z]) => x < preview.x0 || x > preview.x1 || z < preview.z0 || z > preview.z1)) throw new Error('Tortuna source geography leaves its retained terrain frontier');
  const expectedTileCount = (preview.x1 - preview.x0) * (preview.z1 - preview.z0) / 256 ** 2;
  const frontierBounds = { minEasting: FRAME.easting + preview.x0, maxEasting: FRAME.easting + preview.x1, minNorthing: FRAME.northing - preview.z1, maxNorthing: FRAME.northing - preview.z0 };
  const cutout = planV2LegacyCutout({ grid: core, previewBounds: preview, enabled: true, preflightStatus: 'ready', guardCells: 2 });
  return { frame, bounds, frontierBounds, expectedTileCount, packOriginWgs84: { latitude: model.origin.lat, longitude: model.origin.lon }, packMetresPerLongitude: model.mPerLon, packFrame: model.frame, core, cutout };
}

export async function writeTortunaRuntimeConfig(contract, root = ROOT) {
  const { frame, bounds, frontierBounds, expectedTileCount, core, cutout } = contract;
  const config = { slug: 'tortuna', groundId: 'tortuna', label: 'Tortuna GK · Lantmäteriet 1 m · Preliminär källkarta', frameFingerprint: frame.fingerprint,
    expectedBoundsEpsg5845: Object.fromEntries(['minEasting', 'minNorthing', 'maxEasting', 'maxNorthing'].map(k => [k, bounds[k]])),
    ringGraph: { levels: 5, tiles: 341, rootSpanMetres: 4096, tilesByLod: [256, 64, 16, 4, 1] },
    expectedFrontierBoundsEpsg5845: frontierBounds, canonicalOrigin: frame.origin, legacyOriginEpsg3006: { easting: FRAME.easting, northing: FRAME.northing },
    packOriginWgs84: contract.packOriginWgs84, packMetresPerLongitude: contract.packMetresPerLongitude, packFrame: contract.packFrame,
    bridgeMode: 'epsg3006-local-rh2000', expectedTileCount, expectedSurfaceTileCount: 0, surfacePolicy: 'legacy-ground-atlas',
    legacyCoreCutout: { guardCells: 2, guardMetres: 8, expectedCoreGrid: { ...core, nx: cutout.nx, nz: cutout.nz }, expectedSkippedBasePoints: cutout.skippedBasePoints, expectedTotalBasePoints: cutout.totalBasePoints } };
  const file = path.join(root, 'apps/golf/src/engine/v2-tortuna-config.mjs');
  await writeFile(file, `/* Generated from retained Tortuna terrain and source geometry by compile-tortuna-ground-graph.mjs. Independent survey approval remains pending. */\nexport const TORTUNA_V2_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\nexport const TORTUNA_V2_CONFIGS = Object.freeze({ tortuna: TORTUNA_V2_CONFIG });\n`);
}

async function liveGround(output) {
  let index;
  try { index = await json(path.join(output, 'courses/v2-index.json')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const entry = index.courses.find(c => c.slug === 'tortuna');
  if (!entry) return null;
  const course = await json(path.join(output, entry.manifest.url));
  return json(path.join(output, course.groundManifest.url));
}

async function defaultStandAttacher(root) {
  const modulePath = path.join(root, 'geo_data/course-v2/tortuna/vegetation/compile-stands.mjs');
  try { await readFile(modulePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const attach = (await import(pathToFileURL(modulePath).href)).attachTortunaStands;
  if (typeof attach !== 'function') throw new Error('Tortuna stand module lacks attachTortunaStands');
  return attach;
}

export async function compileTortunaGroundGraph({ root = ROOT, outputDirectory = 'tortunabuild/cache/graph-stage', attachStands = undefined } = {}) {
  let { compilation, frame } = await compileTortunaTerrain({ root });
  const modelBytes = await readFile(path.join(root, 'tortunabuild/course-model.json'));
  const model = JSON.parse(modelBytes);
  const migration = await json(path.join(root, 'geo_data/course-v2/tortuna/migration/course-model.epsg3006.json'));
  const packBytes = await readFile(path.join(root, 'apps/golf/public/courses/tortuna/pack.bin'));
  const holes = assertTortunaCanonicalRouting(migration, model, readPack(packBytes), hash(modelBytes));
  const contract = tortunaRuntimeContract(model, frame, compilation.bounds);
  const sourceBytes = await readFile(path.join(root, 'geo_data/course-v2/tortuna/source-manifest.json'));
  const manifest = JSON.parse(sourceBytes);
  if (manifest.groundId !== 'tortuna' || JSON.stringify(manifest.courseSlugs) !== '["tortuna"]') throw new Error('Tortuna source manifest identity differs');
  const attach = attachStands === undefined ? await defaultStandAttacher(root) : attachStands;
  if (attach !== null && typeof attach !== 'function') throw new Error('Tortuna stand attacher must be a function or explicit null');
  if (attach) compilation = await attach(compilation, frame);
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  const graph = emitGroundGraph({ compilation, frame, sourceManifestSha256: hash(sourceBytes.toString('utf8').replace(/\r\n/g, '\n')),
    course: { slug: 'tortuna', name: 'Tortuna GK', holes }, fallbackV1: { format: 1, packUrl: 'courses/tortuna/pack.bin', bytes: packBytes.length, sha256: hash(packBytes) },
    heightAt: (e, n) => sampler.sample(e, n)?.heightRH2000 ?? NaN, holeTileBufferMetres: 90 });
  const output = path.resolve(root, outputDirectory);
  const ground = JSON.parse(Buffer.from(graph.resources.get(graph.references.ground.url)).toString('utf8'));
  assertTortunaTerrainRetention(await liveGround(output), ground);
  await writeGroundGraphFiles(output, graph);
  await write(path.join(root, 'tortunabuild/mapping/runtime-contract.json'), contract);
  if (output === path.join(root, 'apps/golf/public')) await writeTortunaRuntimeConfig(contract, root);
  const report = { schemaVersion: 1, kind: 'tortuna-ground-graph', state: output === path.join(root, 'apps/golf/public') ? 'published-provisional' : 'staged-provisional',
    provisionalReasons: ['independent-horizontal-and-vertical-controls-pending', 'source-derived-playing-surfaces-not-surveyed', 'coloured-tee-and-daily-flag-positions-unverified', 'current-tree-and-facility-completeness-unverified'],
    source: { terrainItem: '661_59', terrainFloat32Sha256: CONFIG.sourceFloat32Sha256, sampleSpacingMetres: 1 }, frame, terrain: compilation.stats, graph: graph.report };
  await write(path.join(output, 'tortuna-ground-graph-report.json'), report);
  return { graph, compilation, contract, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const run = async () => {
    if (args.length === 1 && args[0] === '--terrain-only') { const { compilation, frame } = await stageTortunaTerrain(); console.log(JSON.stringify({ frame, stats: compilation.stats }, null, 2)); return; }
    if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('usage: compile-tortuna-ground-graph.mjs [--terrain-only | --out DIRECTORY]');
    const result = await compileTortunaGroundGraph({ ...(args.length ? { outputDirectory: args[1] } : {}) });
    console.log(JSON.stringify({ graph: result.graph.report, frame: result.contract.frame, core: result.contract.core }, null, 2));
  };
  run().catch(error => { console.error(`Tortuna graph compilation failed: ${error.message}`); process.exitCode = 1; });
}
