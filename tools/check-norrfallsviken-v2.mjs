#!/usr/bin/env node
/* Offline acceptance for Norrfällsviken's published 1 m ground graph.

   usage:
     node tools/check-norrfallsviken-v2.mjs [apps/golf/dist]

   This is the per-course half of check-app-build, run without a browser: root
   index -> course manifest -> ground manifest -> every chunk's own content hash
   -> decode, plus the two contracts that are specific to this ground and were
   both got wrong on the way in.

   The FIRST is the frontier. `expectedTileCount` is the level-zero set the app
   installs eagerly, and the graph frontier loader caps it at 8 MiB; all 256
   level-zero tiles here are 13.64 MB, so the reviewed frontier is a strict
   sub-rectangle and the rest of level zero streams. Asserting the config's
   bounds actually SELECT expectedTileCount whole tiles, and that they fit the
   budget, is what stops a future window change from failing closed at boot.

   The SECOND is that every decoded sample is finite. Markhöjdmodell does not
   tile the open Gulf of Bothnia -- one of the 10 km squares this ground's rings
   need is not published at all -- so the ring builder fills reviewed sea holes.
   A regression there would arrive as NaN ground rather than as an error. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../packages/course-v2/canonical-json.mjs';
import { verifyChunkAsset } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { NORRFALLSVIKEN_V2_CONFIG as CONFIG } from '../apps/golf/src/engine/v2-norrfallsviken-config.mjs';
import { V2_PUBLISHED_GRAPH_SLUGS } from '../apps/golf/src/engine/v2-terrain-select.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'apps/golf/dist'));
/* the same budget apps/golf/src/engine/v2-graph-frontier.mjs enforces */
const MAX_FRONTIER_ENCODED_BYTES = 8 * 1024 * 1024;
const MAX_TERRAIN_CHUNK_BYTES = 256 * 1024;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ok = [];
function fail(message) { throw new Error(message); }

if (!fs.existsSync(path.join(DIST, 'courses/v2-index.json'))) {
  fail(`${DIST} has no courses/v2-index.json; run the Vite build first`);
}
if (!V2_PUBLISHED_GRAPH_SLUGS.includes(CONFIG.slug)) fail(`${CONFIG.slug} is not registered as published`);
ok.push('registered in V2_PUBLISHED_GRAPH_SLUGS');

const rootBytes = fs.readFileSync(path.join(DIST, 'courses/v2-index.json'));
if (canonicalJson(JSON.parse(rootBytes)) !== rootBytes.toString('utf8')) {
  fail('courses/v2-index.json is not byte-exact canonical JSON; the runtime root store will refuse it');
}
const entry = JSON.parse(rootBytes).courses.find(course => course.slug === CONFIG.slug) ||
  fail(`no root entry for ${CONFIG.slug}`);
ok.push('root index is byte-exact canonical JSON');

const courseBytes = fs.readFileSync(path.join(DIST, entry.manifest.url));
if (sha(courseBytes) !== entry.manifest.sha256) fail('course manifest hash mismatch');
if (courseBytes.byteLength !== entry.manifest.bytes) fail('course manifest byte count mismatch');
const course = JSON.parse(courseBytes);
ok.push(`course manifest verified (${courseBytes.byteLength} bytes)`);

const groundBytes = fs.readFileSync(path.join(DIST, course.groundManifest.url));
if (sha(groundBytes) !== course.groundManifest.sha256) fail('ground manifest hash mismatch');
const ground = JSON.parse(groundBytes);
ok.push(`ground manifest verified (${groundBytes.byteLength} bytes)`);

if (ground.frame.fingerprint !== CONFIG.frameFingerprint) {
  fail(`published frame ${ground.frame.fingerprint} is not the reviewed ${CONFIG.frameFingerprint}`);
}
for (const [field, value] of Object.entries(CONFIG.expectedBoundsEpsg5845)) {
  if (Math.abs(ground.bounds[field] - value) > 1e-9) fail(`graph ${field} is ${ground.bounds[field]}, contract says ${value}`);
}
for (const [field, value] of Object.entries(CONFIG.canonicalOrigin)) {
  if (Math.abs(ground.frame.origin[field] - value) > 1e-9) fail(`origin ${field} is ${ground.frame.origin[field]}, contract says ${value}`);
}
ok.push('frame fingerprint, bounds and origin match the reviewed contract');

const byLod = {};
for (const tile of ground.tiles) byLod[tile.lod] = (byLod[tile.lod] || 0) + 1;
if (ground.tiles.length !== CONFIG.ringGraph.tiles) {
  fail(`graph has ${ground.tiles.length} tiles, contract says ${CONFIG.ringGraph.tiles}`);
}
for (const [lod, count] of Object.entries(CONFIG.ringGraph.tilesByLod)) {
  if (byLod[lod] !== count) fail(`lod ${lod} has ${byLod[lod]} tiles, contract says ${count}`);
}
let roots = 0;
const ids = new Set(ground.tiles.map(tile => tile.id));
for (const tile of ground.tiles) {
  if (tile.parentId === null || tile.parentId === undefined) { roots++; continue; }
  if (!ids.has(tile.parentId)) fail(`tile ${tile.id} names a missing parent ${tile.parentId}`);
}
if (roots !== 1) fail(`the graph has ${roots} roots; a shell needs exactly one`);
ok.push(`ring graph verified: ${ground.tiles.length} tiles over ${Object.keys(byLod).length} levels, one root`);

const bounds = CONFIG.expectedFrontierBoundsEpsg5845;
const frontier = ground.tiles.filter(tile => tile.lod === 0 &&
  tile.bounds.minEasting >= bounds.minEasting - 1e-6 && tile.bounds.maxEasting <= bounds.maxEasting + 1e-6 &&
  tile.bounds.minNorthing >= bounds.minNorthing - 1e-6 && tile.bounds.maxNorthing <= bounds.maxNorthing + 1e-6);
if (frontier.length !== CONFIG.expectedTileCount) {
  fail(`the reviewed frontier bounds select ${frontier.length} level-zero tiles, contract says ${CONFIG.expectedTileCount}`);
}
if (!(byLod[0] > CONFIG.expectedTileCount)) {
  fail('this ground publishes more level-zero tiles than it boots; the frontier must be a strict subset');
}
const frontierBytes = frontier.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0);
if (frontierBytes > MAX_FRONTIER_ENCODED_BYTES) {
  fail(`the frontier is ${(frontierBytes / 1048576).toFixed(2)} MB, over the loader's 8 MiB budget`);
}
const fattest = Math.max(...ground.tiles.map(tile => tile.layers.terrain.bytes));
if (fattest > MAX_TERRAIN_CHUNK_BYTES) fail(`a terrain chunk is ${fattest} bytes, over the per-chunk cap`);
ok.push(`frontier verified: ${frontier.length} of ${byLod[0]} level-zero tiles, ${(frontierBytes / 1048576).toFixed(2)} MB of the 8 MiB budget`);

let bytes = 0;
let samples = 0;
let minimum = Infinity;
let maximum = -Infinity;
for (const tile of ground.tiles) {
  const reference = tile.layers.terrain;
  const file = path.resolve(DIST, reference.url);
  if (!file.startsWith(DIST)) fail('a chunk reference escaped the published root');
  const raw = fs.readFileSync(file);
  const chunk = await verifyChunkAsset(reference, new Uint8Array(raw));
  bytes += raw.byteLength;
  const heights = decodeTerrainGrid(chunk.payload, chunk.header.grid);
  for (const height of heights) {
    if (!Number.isFinite(height)) fail(`tile ${tile.id} decodes a non-finite height`);
    if (height < minimum) minimum = height;
    if (height > maximum) maximum = height;
  }
  samples += heights.length;
}
ok.push(`all ${ground.tiles.length} chunks verified and decoded: ${samples.toLocaleString('en')} samples, ${(bytes / 1048576).toFixed(1)} MB`);
ok.push(`decoded RH 2000 range ${minimum.toFixed(3)} .. ${maximum.toFixed(3)} m, every sample finite`);

if (course.routing) {
  const raw = fs.readFileSync(path.resolve(DIST, course.routing.url));
  await verifyChunkAsset(course.routing, new Uint8Array(raw));
  ok.push(`routing chunk verified (${raw.byteLength} bytes)`);
}

const pack = fs.readFileSync(path.join(DIST, entry.fallbackV1.packUrl));
if (sha(pack) !== entry.fallbackV1.sha256) fail('GPK1 fallback hash mismatch');
if (pack.byteLength !== entry.fallbackV1.bytes) fail('GPK1 fallback byte count mismatch');
ok.push(`GPK1 fallback verified (${pack.byteLength} bytes)`);

for (const line of ok) console.log('  ok  ', line);
console.log('\nNorrfällsviken v2 graph verified end to end.');
