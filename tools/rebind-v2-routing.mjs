#!/usr/bin/env node
/* Refresh one published course's routing after an accepted model geometry change.
 * Regenerate the pack, courses/index.json and EPSG:3006 migration FIRST. This
 * verifies all three agree, samples moved points from the published terrain,
 * recomputes the hole's streaming tile priorities, and asserts that the entire
 * ground manifest remains content-identical (including vegetation and surfaces).
 * Old content-addressed generations remain available for rollback.
 *
 * Dry run (default):
 * node tools/rebind-v2-routing.mjs --slug upsala-mellanbanan \
 *   --build upsalamellanbuild \
 *   --migration geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json
 * Add --write to publish the three prepared local files. No remote deployment.
 * --repo and --public override the repository/public directory for isolated QA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const textSha = value => sha(value.toString('utf8').replace(/\r\n/g, '\n'));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finitePoint = point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite);

function inside(directory, relativeUrl) {
  if (typeof relativeUrl !== 'string' || !relativeUrl || path.isAbsolute(relativeUrl) || relativeUrl.includes('\\')) {
    throw new Error(`expected a repository-relative path: ${relativeUrl}`);
  }
  const result = path.resolve(directory, relativeUrl);
  if (!result.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error(`path escapes its directory: ${relativeUrl}`);
  return result;
}
async function internals(repoRoot) {
  const load = relative => import(pathToFileURL(inside(repoRoot, relative)).href);
  const [emit, chunks, terrain, canonical, pack, projection] = await Promise.all([
    load('packages/course-v2/emit-ground-graph-node.mjs'),
    load('packages/course-v2/chunk-node.mjs'),
    load('packages/course-v2/terrain-pyramid.mjs'),
    load('packages/course-v2/canonical-json.mjs'),
    load('packages/course-pack/lib.mjs'),
    load('packages/course-geo/chmv2/projection.mjs'),
  ]);
  return { ...emit, ...chunks, ...terrain, ...canonical, ...pack, ...projection };
}

/** Prepare and verify the complete change without writing any file. */
export async function prepareRoutingRebind({ repoRoot = DEFAULT_ROOT, publicDir = null, slug, build, migration, holeTileBufferMetres = 80, maxSampleSpacingMetres = 1 } = {}) {
  repoRoot = path.resolve(repoRoot);
  publicDir = publicDir ? path.resolve(publicDir) : path.join(repoRoot, 'apps/golf/public');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || !build || !migration) throw new Error('--slug, --build and --migration are required');
  if (!Number.isFinite(holeTileBufferMetres) || holeTileBufferMetres < 0 || !Number.isFinite(maxSampleSpacingMetres) || maxSampleSpacingMetres <= 0) throw new Error('invalid terrain spacing or tile buffer');
  const I = await internals(repoRoot);
  const snapshots = new Map();
  const readFile = filename => { const bytes = fs.readFileSync(filename); snapshots.set(filename, sha(bytes)); return bytes; };
  const read = url => readFile(inside(publicDir, url));
  const json = url => JSON.parse(read(url));
  const verifyReference = reference => {
    const bytes = read(reference.url);
    if (bytes.length !== reference.bytes || sha(bytes) !== reference.sha256) throw new Error(`published reference is stale or corrupt: ${reference.url}`);
    return bytes;
  };
  const root = json('courses/v2-index.json');
  if (!Buffer.from(I.canonicalJsonBytes(root)).equals(fs.readFileSync(inside(publicDir, 'courses/v2-index.json')))) throw new Error('published v2 root is not canonical');
  const previousEntry = root.courses.find(course => course.slug === slug);
  if (!previousEntry) throw new Error(`v2 root has no ${slug}`);
  const previousCourse = JSON.parse(verifyReference(previousEntry.manifest));
  const groundBytes = verifyReference(previousCourse.groundManifest);
  const ground = JSON.parse(groundBytes);
  const oldRouting = I.verifyChunkAsset(previousCourse.routing, verifyReference(previousCourse.routing)).content;
  if (previousCourse.slug !== slug || previousEntry.groundId !== ground.groundId || oldRouting.courseSlug !== slug) throw new Error('published course/ground/routing identity mismatch');
  if (ground.frame.horizontalCrs !== 'EPSG:3006' || ground.frame.verticalCrs !== 'EPSG:5613') throw new Error('routing rebinder requires published EPSG:3006 / RH 2000 terrain');

  const modelPath = inside(repoRoot, `${build}/course-model.json`);
  const modelBytes = readFile(modelPath);
  const model = JSON.parse(modelBytes);
  const migrated = JSON.parse(readFile(inside(repoRoot, migration)));
  if (migrated.groundId !== ground.groundId || migrated.target?.horizontalCrs !== 'EPSG:3006' ||
      !equal(migrated.target.coordinateOrder, ['easting', 'northing'])) throw new Error('migration belongs to another ground or coordinate system');
  if (inside(repoRoot, migrated.source?.path) !== modelPath || migrated.source?.sha256 !== textSha(modelBytes)) throw new Error('migration does not identify the current build bytes; regenerate it first');
  const frame = migrated.source.localFrame;
  if (frame?.originWgs84?.latitude !== model.origin?.lat || frame?.originWgs84?.longitude !== model.origin?.lon ||
      frame?.metresPerLatitude !== model.mPerLat || frame?.metresPerLongitude !== model.mPerLon) throw new Error('migration and model legacy frames differ');
  const sourceHoles = migrated.geometry?.holes || migrated.holes;
  if (!Array.isArray(sourceHoles) || sourceHoles.length !== previousCourse.holes.length || model.holes?.length !== sourceHoles.length) throw new Error('hole count changed; this tool refreshes existing course routing only');

  const live = json('courses/index.json').courses.find(course => course.slug === slug);
  if (!live?.packUrl || !live.sha256 || !Number.isSafeInteger(live.bytes)) throw new Error(`live pack index has no complete ${slug} entry`);
  const fallbackV1 = { format: 1, packUrl: live.packUrl.replace(/^\//, ''), bytes: live.bytes, sha256: live.sha256 };
  const packBytes = read(fallbackV1.packUrl);
  if (sha(packBytes) !== live.sha256 || packBytes.length !== live.bytes) throw new Error('live pack index differs from the pack; run emit-manifest first');
  const packed = I.readPack(packBytes);
  const vectors = JSON.parse(I.inflateStream(packed.sv));
  if (packed.header.slug !== slug || !equal(packed.header.GEO.origin, model.origin) || packed.header.GEO.mPerLon !== model.mPerLon || vectors.holes?.length !== model.holes.length) throw new Error('live pack belongs to another build/frame');

  const holes = previousCourse.holes.map((published, index) => {
    const hole = sourceHoles[index], local = model.holes[index], packedHole = vectors.holes[index];
    if (hole?.n !== index + 1 || local?.n !== hole.n || packedHole?.n !== hole.n || !Array.isArray(hole.line) || hole.line.length < 2 || hole.line.length !== local.line?.length || !hole.line.every(finitePoint)) throw new Error(`hole ${index + 1}: invalid migration routing`);
    if (hole.par !== published.par || (hole.idx ?? null) !== published.strokeIndex || local.par !== hole.par || local.idx !== hole.idx || packedHole.par !== hole.par || packedHole.idx !== hole.idx) throw new Error(`hole ${hole.n}: card changed; verify and publish that change separately`);
    if (!equal(local.line, packedHole.line) || !equal(local.green?.c, packedHole.green?.c)) throw new Error(`hole ${hole.n}: live pack does not contain current routing/green; emit the pack first`);
    for (let k = 0; k < local.line.length; k++) {
      if (!finitePoint(local.line[k])) throw new Error(`hole ${hole.n}: invalid local routing point`);
      const [x, z] = local.line[k];
      const projected = I.latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon);
      if (Math.hypot(projected[0] - hole.line[k][0], projected[1] - hole.line[k][1]) > 0.005) throw new Error(`hole ${hole.n}: migration point ${k} disagrees with the current model projection`);
    }
    return { number: hole.n, par: published.par, strokeIndex: published.strokeIndex, strokeIndexStatus: published.strokeIndexStatus, accuracyTier: published.accuracyTier, line: hole.line.map(point => point.slice(0, 2)) };
  });

  const resources = new Map();
  for (const reference of [ground.shell, ...ground.tiles.flatMap(tile => Object.values(tile.layers).filter(Boolean))]) {
    if (!resources.has(reference.url)) resources.set(reference.url, verifyReference(reference));
  }
  const decoded = new Map();
  const known = new Map(oldRouting.holes.flatMap(hole => hole.line.map(([e, n, h]) => [`${e},${n}`, h])));
  let reusedHeights = 0, sampledHeights = 0;
  const sampledTiles = new Set();
  const heightAt = (e, n) => {
    const hit = known.get(`${e},${n}`);
    if (Number.isFinite(hit)) { reusedHeights++; return hit; }
    const candidates = ground.tiles.filter(tile => e >= tile.bounds.minEasting && e <= tile.bounds.maxEasting && n >= tile.bounds.minNorthing && n <= tile.bounds.maxNorthing).sort((a, b) => a.lod - b.lod || a.id.localeCompare(b.id));
    for (const tile of candidates) {
      if (!decoded.has(tile.layers.terrain.url)) {
        const chunk = I.verifyChunkAsset(tile.layers.terrain, resources.get(tile.layers.terrain.url));
        decoded.set(tile.layers.terrain.url, { bounds: tile.bounds, grid: chunk.header.grid, payload: chunk.payload });
      }
      const sampleTile = decoded.get(tile.layers.terrain.url);
      if (sampleTile.grid.sampleSpacingMetres > maxSampleSpacingMetres) continue;
      const value = I.sampleTerrainTile(sampleTile, e, n);
      if (Number.isFinite(value)) { sampledHeights++; sampledTiles.add(tile.id); return value; }
    }
    throw new Error(`moved point (${e}, ${n}) has no published terrain sample at ${maxSampleSpacingMetres} m or finer`);
  };
  const compilation = { groundId: ground.groundId, courseSlugs: [...new Set(ground.tiles.flatMap(tile => tile.courses))], resources, shell: ground.shell, bounds: ground.bounds, tiles: ground.tiles };
  const graph = I.emitGroundGraph({ compilation, frame: ground.frame, sourceManifestSha256: ground.sourceManifestSha256, course: { slug, name: previousEntry.name, holes }, fallbackV1, heightAt, holeTileBufferMetres });
  if (graph.references.ground.sha256 !== previousCourse.groundManifest.sha256 || !Buffer.from(graph.resources.get(graph.references.ground.url)).equals(groundBytes)) throw new Error('canonical re-emission changed the ground manifest; refusing routing-only publication');
  const nextEntry = graph.root.courses[0];
  const nextRoot = { ...root, courses: root.courses.map(entry => entry.slug === slug ? nextEntry : entry) };
  const changedHoles = holes.filter(hole => !equal(hole.line, oldRouting.holes.find(previous => previous.number === hole.number)?.line.map(point => point.slice(0, 2)))).map(hole => hole.number);
  const writes = new Map([
    [graph.references.routing.url, graph.resources.get(graph.references.routing.url)],
    [graph.references.course.url, graph.resources.get(graph.references.course.url)],
    ['courses/v2-index.json', I.canonicalJsonBytes(nextRoot)],
  ]);
  return { publicDir, snapshots, writes, report: { slug, groundId: ground.groundId, changedHoles, sourceModelSha256: textSha(modelBytes), previousRoutingSha256: previousCourse.routing.sha256, routingSha256: graph.references.routing.sha256, courseManifest: graph.references.course.url, fallbackV1, groundManifestUnchanged: previousCourse.groundManifest.sha256, frameFingerprintUnchanged: ground.frame.fingerprint, preservedTileLayers: Object.fromEntries(['terrain', 'surface', 'objects', 'stands'].map(kind => [kind, ground.tiles.filter(tile => tile.layers[kind]).length])), reusedHeights, sampledHeights, sampledTiles: [...sampledTiles].sort(), holeTileBufferMetres, maxSampleSpacingMetres } };
}

/** Commit a prepared local graph only while every input still matches. */
export function writeRoutingRebind(plan) {
  for (const [filename, expected] of plan.snapshots) if (sha(fs.readFileSync(filename)) !== expected) throw new Error(`input changed during preparation: ${filename}; prepare again`);
  for (const [url, value] of plan.writes) {
    if (url === 'courses/v2-index.json') continue;
    const filename = inside(plan.publicDir, url), bytes = Buffer.from(value);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (fs.existsSync(filename)) {
      if (!fs.readFileSync(filename).equals(bytes)) throw new Error(`immutable content-addressed file has different bytes: ${url}`);
    } else fs.writeFileSync(filename, bytes, { flag: 'wx' });
  }
  const target = inside(plan.publicDir, 'courses/v2-index.json');
  if (sha(fs.readFileSync(target)) !== plan.snapshots.get(target)) throw new Error('v2 root changed during publication; new immutable files are unreferenced, prepare again');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, plan.writes.get('courses/v2-index.json'), { flag: 'wx' }); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { ...plan.report, written: [...plan.writes.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  let write = false;
  const flags = { slug: 'slug', build: 'build', migration: 'migration', repo: 'repoRoot', public: 'publicDir', 'tile-buffer': 'holeTileBufferMetres', 'max-spacing': 'maxSampleSpacingMetres' };
  try {
    for (let index = 2; index < process.argv.length; index++) {
      const arg = process.argv[index];
      if (arg === '--write') { write = true; continue; }
      const key = flags[arg.replace(/^--/, '')];
      if (!arg.startsWith('--') || !key || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`unknown or incomplete argument ${arg}`);
      const value = process.argv[++index]; options[key] = ['holeTileBufferMetres', 'maxSampleSpacingMetres'].includes(key) ? Number(value) : value;
    }
    const plan = await prepareRoutingRebind(options);
    console.log(JSON.stringify(write ? writeRoutingRebind(plan) : { ...plan.report, dryRun: true, wouldWrite: [...plan.writes.keys()] }, null, 2));
  } catch (error) { console.error(`routing rebind failed: ${error.message}`); process.exitCode = 1; }
}
