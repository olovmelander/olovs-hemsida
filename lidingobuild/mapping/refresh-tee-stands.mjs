#!/usr/bin/env node
/* After compile-lidingo-stands, review-lidingo-stands, source-ledger refresh
 * and pack/routing publication:
 *   node lidingobuild/mapping/refresh-tee-stands.mjs          (prepare only)
 *   node lidingobuild/mapping/refresh-tee-stands.mjs --write
 * Replace exactly the finest stand generation. Terrain, parent links,
 * surfaces, objects, routing and course streaming priorities stay unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { attachLidingoStands, assertLidingoStandSourceHashes } from '../../packages/course-v2/vegetation/compile-lidingo-stands.mjs';
import { canonicalJson, canonicalJsonBytes } from '../../packages/course-v2/canonical-json.mjs';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { verifyAssetGraph } from '../../packages/course-v2/graph-node.mjs';
import { assertValid, validateCourseManifest, validateGroundManifest, validateRootIndex } from '../../packages/course-v2/schema.mjs';
import { decodeStandField, STAND_FLAG_MEASURED, STAND_FLAG_EXCLUDED } from '../../packages/course-v2/stand-field.mjs';
import { inRing } from '../../apps/golf/src/engine/geom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const STAGE = 'lidingobuild/cache/vegetation/stands-stage';
const SOURCE_MANIFEST = 'geo_data/course-v2/lidingo/source-manifest.json';
const STAND_EVIDENCE = 'geo_data/course-v2/lidingo/vegetation/stand-evidence.json';
const STAND_REVIEW = 'geo_data/course-v2/lidingo/vegetation/stand-source-review.json';
const PLAYING_SURFACES = 'lidingobuild/mapping/playing-surfaces.geojson';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const logicalSha = bytes => sha(bytes.toString('utf8').replace(/\r\n/g, '\n'));
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
function inside(directory, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Expected a relative asset path');
  const target = path.resolve(directory, relative);
  if (!target.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error(`Asset path leaves its directory: ${relative}`);
  return target;
}

/** No unrelated ground field or coarse layer is reconstructed. */
export function replaceFinestStandLayers(ground, standLayers, sourceManifestSha256) {
  const finest = new Set(ground.tiles.filter(tile => tile.lod === 0).map(tile => tile.id));
  const supplied = Object.keys(standLayers);
  if (supplied.length !== finest.size || supplied.some(id => !finest.has(id))) throw new Error('Stand generation must cover exactly the existing finest tiles');
  if (!/^[a-f0-9]{64}$/.test(sourceManifestSha256)) throw new Error('Missing current source-manifest hash');
  return { ...ground, sourceManifestSha256, tiles: ground.tiles.map(tile => tile.lod === 0
    ? { ...tile, layers: { ...tile.layers, stands: standLayers[tile.id] } } : tile) };
}

function teeExclusionCheck(standLayers, resources, features) {
  const tees = features.filter(feature => feature.properties?.kind === 'tee').flatMap(feature => {
    const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    return polygons.map(rings => ({ id: feature.id, rings,
      bounds: [Math.min(...rings[0].map(p => p[0])), Math.min(...rings[0].map(p => p[1])),
        Math.max(...rings[0].map(p => p[0])), Math.max(...rings[0].map(p => p[1]))] }));
  });
  let eligibleCells = 0, hits = 0;
  const examples = [];
  for (const [tileId, reference] of Object.entries(standLayers)) {
    const chunk = readChunk(resources.get(reference.url));
    const field = decodeStandField(chunk.payload, chunk.header.standField);
    const nearby = tees.filter(tee => tee.bounds[0] <= chunk.header.bounds.maxEasting && tee.bounds[2] >= chunk.header.bounds.minEasting &&
      tee.bounds[1] <= chunk.header.bounds.maxNorthing && tee.bounds[3] >= chunk.header.bounds.minNorthing);
    for (let row = 0; row < field.height; row++) for (let column = 0; column < field.width; column++) {
      const i = row * field.width + column;
      if (!(field.flags[i] & STAND_FLAG_MEASURED) || (field.flags[i] & STAND_FLAG_EXCLUDED) || field.fraction[i] <= 0) continue;
      eligibleCells++;
      const x = chunk.header.bounds.minEasting + (column + .5) * field.cellMetres;
      const y = chunk.header.bounds.maxNorthing - (row + .5) * field.cellMetres;
      for (const tee of nearby) {
        if (x < tee.bounds[0] || x > tee.bounds[2] || y < tee.bounds[1] || y > tee.bounds[3]) continue;
        if (inRing(x, y, tee.rings[0]) && !tee.rings.slice(1).some(ring => inRing(x, y, ring))) {
          hits++;
          if (examples.length < 20) examples.push({ tileId, teeId: tee.id, x, y });
        }
      }
    }
  }
  return { eligibleCells, checkedTeePolygons: tees.length, teeCentreHits: hits, examples,
    method: 'Independently test every eligible emitted stand-cell centre against current source tee polygons, retaining polygon holes.' };
}

export async function prepareLidingoStandRefresh() {
  const snapshots = new Map();
  const readFile = filename => {
    const bytes = fs.readFileSync(filename), hash = sha(bytes);
    if (snapshots.has(filename) && snapshots.get(filename) !== hash) throw new Error(`Input changed during preparation: ${filename}`);
    snapshots.set(filename, hash);
    return bytes;
  };
  const read = relative => readFile(inside(ROOT, relative));
  const readPublic = relative => readFile(inside(PUBLIC, relative));
  const json = relative => JSON.parse(read(relative));
  const root = JSON.parse(readPublic('courses/v2-index.json'));
  const entries = root.courses.filter(entry => entry.groundId === 'lidingo');
  if (entries.length !== 1 || entries[0].slug !== 'lidingo') throw new Error('Expected the single published Lidingo course');
  const entry = entries[0];
  const resources = new Map();
  const verifyReference = reference => {
    const bytes = readPublic(reference.url);
    if (bytes.length !== reference.bytes || sha(bytes) !== reference.sha256) throw new Error(`Stale published asset: ${reference.url}`);
    resources.set(reference.url, bytes);
    return bytes;
  };
  const course = JSON.parse(verifyReference(entry.manifest));
  const ground = JSON.parse(verifyReference(course.groundManifest));
  verifyReference(course.routing);
  verifyReference(ground.shell);
  for (const tile of ground.tiles) for (const reference of Object.values(tile.layers).filter(Boolean)) {
    if (!resources.has(reference.url)) verifyReference(reference);
  }
  if (ground.groundId !== 'lidingo' || ground.tiles.filter(tile => tile.lod === 0).length !== 64 || !ground.tiles.some(tile => tile.parentId)) {
    throw new Error('Expected the existing Lidingo ring graph with 64 finest tiles');
  }
  const live = JSON.parse(readPublic('courses/index.json')).courses.find(value => value.slug === 'lidingo');
  if (live?.sha256 !== entry.fallbackV1.sha256 || live?.bytes !== entry.fallbackV1.bytes) throw new Error('Publish the current pack/routing references before replacing stands');
  const sourceBytes = read(SOURCE_MANIFEST), source = JSON.parse(sourceBytes);
  for (const relative of [STAND_EVIDENCE, PLAYING_SURFACES]) {
    const artifact = source.artifacts.find(item => item.path === relative);
    if (!artifact || artifact.sha256 !== logicalSha(read(relative))) throw new Error(`Source ledger has a stale ${relative}; run update-source-manifest.mjs first`);
  }
  const indexBytes = read(`${STAGE}/layer-index.json`), index = JSON.parse(indexBytes);
  assertLidingoStandSourceHashes(index, read);
  const evidence = json(STAND_EVIDENCE), review = json(STAND_REVIEW);
  if (evidence.layerIndex?.sha256 !== sha(indexBytes) || evidence.layerIndex?.path !== `${STAGE}/layer-index.json` ||
      review.sourceLayerIndex?.sha256 !== sha(indexBytes) || review.state !== 'source-exclusion-check-passed' || review.hits?.length !== 0) {
    throw new Error('Stand evidence and passed source review must identify the current compiled generation');
  }
  const attached = await attachLidingoStands({ groundId: 'lidingo', tiles: ground.tiles, resources: new Map() }, ground.frame);
  for (const [url, bytes] of attached.resources) {
    const staged = read(`${STAGE}/${url}`);
    if (!staged.equals(Buffer.from(bytes))) throw new Error(`Stand stage changed during preparation: ${url}`);
    resources.set(url, staged);
  }
  const teeCheck = teeExclusionCheck(index.standLayers, resources, json(PLAYING_SURFACES).features);
  if (!teeCheck.eligibleCells || !teeCheck.checkedTeePolygons || teeCheck.teeCentreHits) throw new Error(`Rebuilt stands violate tee exclusions: ${JSON.stringify(teeCheck)}`);
  const nextGround = replaceFinestStandLayers(ground, index.standLayers, logicalSha(sourceBytes));
  assertValid('updated Lidingo ground', validateGroundManifest(nextGround));
  const writes = new Map();
  for (const [url, bytes] of attached.resources) writes.set(url, bytes);
  const manifest = (document, oldReference, prefix) => {
    const bytes = canonicalJsonBytes(document), hash = sha(bytes);
    const reference = { ...oldReference, url: `${prefix}-${hash}.json`, bytes: bytes.length, sha256: hash };
    resources.set(reference.url, bytes); writes.set(reference.url, bytes);
    return reference;
  };
  const groundReference = manifest(nextGround, course.groundManifest, 'grounds/lidingo/ground-v2');
  const nextCourse = { ...course, groundManifest: groundReference };
  assertValid('updated Lidingo course', validateCourseManifest(nextCourse));
  const courseReference = manifest(nextCourse, entry.manifest, 'courses/lidingo/course-v2');
  const nextEntry = { ...entry, manifest: courseReference };
  const nextRoot = { ...root, courses: root.courses.map(value => value.slug === 'lidingo' ? nextEntry : value) };
  assertValid('updated root', validateRootIndex(nextRoot));
  const verification = verifyAssetGraph({ root: { ...nextRoot, courses: [nextEntry] }, resources, strictResources: false });
  const preservedGround = ({ sourceManifestSha256, tiles, ...rest }) => ({ ...rest,
    tiles: tiles.map(tile => ({ ...tile, layers: { ...tile.layers, stands: tile.lod === 0 ? null : tile.layers.stands } })) });
  if (!same(preservedGround(ground), preservedGround(nextGround)) || !same(course.routing, nextCourse.routing) || !same(course.holes, nextCourse.holes)) {
    throw new Error('Stand refresh attempted to modify terrain, routing or unrelated layers');
  }
  writes.set('courses/v2-index.json', canonicalJsonBytes(nextRoot));
  return { snapshots, writes, report: { schemaVersion: 1, kind: 'lidingo-reviewed-tee-stand-refresh', groundId: 'lidingo',
    sourceManifestSha256: nextGround.sourceManifestSha256, sourceLayerIndexSha256: sha(indexBytes),
    sourceReviewSha256: logicalSha(read(STAND_REVIEW)), previousGroundManifest: course.groundManifest,
    groundManifest: groundReference, courseManifest: courseReference,
    unchangedRouting: course.routing, unchangedFrameFingerprint: ground.frame.fingerprint,
    unchangedTerrainTiles: ground.tiles.length, unchangedParentLinks: ground.tiles.filter(tile => tile.parentId).length,
    replacedStandLayers: Object.keys(index.standLayers).length,
    changedStandLayers: ground.tiles.filter(tile => tile.lod === 0 && !same(tile.layers.stands, index.standLayers[tile.id])).length,
    unchangedSurfaceLayers: ground.tiles.filter(tile => tile.layers.surface).length,
    unchangedObjectLayers: ground.tiles.filter(tile => tile.layers.objects).length,
    unchangedHoleStreamingPriorities: true, teeExclusions: teeCheck, graphVerification: verification } };
}

export function writeLidingoStandRefresh(plan) {
  for (const [filename, expected] of plan.snapshots) if (sha(fs.readFileSync(filename)) !== expected) throw new Error(`Input changed since preparation: ${filename}`);
  let createdImmutableFiles = 0;
  for (const [url, value] of plan.writes) {
    if (url === 'courses/v2-index.json') continue;
    const filename = inside(PUBLIC, url), bytes = Buffer.from(value);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (fs.existsSync(filename)) {
      if (!fs.readFileSync(filename).equals(bytes)) throw new Error(`Immutable asset collision: ${url}`);
    } else { fs.writeFileSync(filename, bytes, { flag: 'wx' }); createdImmutableFiles++; }
  }
  const target = inside(PUBLIC, 'courses/v2-index.json');
  if (sha(fs.readFileSync(target)) !== plan.snapshots.get(target)) throw new Error('Root changed during stand publication; prepare again');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, plan.writes.get('courses/v2-index.json'), { flag: 'wx' }); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  const report = { ...plan.report, state: 'published', createdImmutableFiles };
  fs.writeFileSync(inside(ROOT, 'lidingobuild/mapping/tee-stand-refresh-validation.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(argument => argument !== '--write')) throw new Error('Use no arguments to prepare, or --write to publish');
    const plan = await prepareLidingoStandRefresh();
    console.log(JSON.stringify(process.argv.includes('--write') ? writeLidingoStandRefresh(plan)
      : { ...plan.report, state: 'prepared-not-published', wouldWrite: [...plan.writes.keys()] }, null, 2));
  } catch (error) { console.error(`Lidingo stand refresh failed: ${error.message}`); process.exitCode = 1; }
}
