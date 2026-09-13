#!/usr/bin/env node
// Exact indexed/map comparisons over published terrain, plus optional CPU timing.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyChunkAsset, sha256Bytes } from '../packages/course-v2/chunk-node.mjs';
import { createRingHeightSampler } from '../apps/golf/src/engine/v2-graph-terrain.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(flag('public', 'apps/golf/public'));
const requested = flag('courses', 'all').split(',');
const count = Number(flag('queries', '50000'));
const passes = Number(flag('passes', '0'));
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 2000000, 'invalid query count');
assert.ok(Number.isSafeInteger(passes) && passes >= 0 && passes <= 100, 'invalid pass count');
const read = ref => {
  const bytes = fs.readFileSync(path.join(root, ref.url));
  assert.equal(bytes.length, ref.bytes);
  assert.equal(sha256Bytes(bytes), ref.sha256);
  return bytes;
};
const index = JSON.parse(fs.readFileSync(path.join(root, 'courses/v2-index.json')));
if (!requested.includes('all')) for (const slug of requested) assert.ok(index.courses.some(c => c.slug === slug), slug);
const reports = [];
for (const entry of index.courses.filter(c => requested.includes('all') || requested.includes(c.slug))) {
  const course = JSON.parse(read(entry.manifest)), ground = JSON.parse(read(course.groundManifest));
  const groups = new Map();
  for (const tile of ground.tiles.filter(t => t.lod >= 1 && t.courses.includes(course.slug))) {
    const decoded = verifyChunkAsset(tile.layers.terrain, read(tile.layers.terrain));
    if (!groups.has(tile.lod)) groups.set(tile.lod, []);
    groups.get(tile.lod).push({ ...tile, grid: decoded.header.grid, payload: decoded.payload });
  }
  const origin = { easting: ground.bounds.minEasting, northing: ground.bounds.maxNorthing };
  const options = { levels: [...groups].map(([lod, tiles]) => ({ lod, tiles })),
    legacyOrigin: origin, verticalDatumOffsetMetres: -19.123 };
  const samplers = { map: createRingHeightSampler({ ...options, indexed: false }), index: createRingHeightSampler(options) };
  const coordinates = new Float64Array(count * 2), results = { map: new Float64Array(count), index: new Float64Array(count) };
  let seed = 123456789;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    coordinates[i * 2] = random() * (ground.bounds.maxEasting - origin.easting);
    coordinates[i * 2 + 1] = random() * (origin.northing - ground.bounds.minNorthing);
  }
  const run = kind => {
    const start = performance.now(), sampler = samplers[kind], output = results[kind];
    for (let i = 0; i < count; i++) output[i] = sampler.sample(coordinates[i * 2], coordinates[i * 2 + 1]);
    return performance.now() - start;
  };
  run('map'); run('index');
  assert.deepEqual(results.index, results.map, course.slug);
  let edges = 0;
  for (const tiles of groups.values()) for (const tile of tiles) {
    for (const x of [tile.bounds.minEasting - origin.easting, tile.bounds.maxEasting - origin.easting]) {
      for (const z of [origin.northing - tile.bounds.minNorthing, origin.northing - tile.bounds.maxNorthing]) {
        for (const epsilon of [-1e-7, 0, 1e-7]) {
          assert.deepEqual(samplers.index.inspect(x + epsilon, z + epsilon), samplers.map.inspect(x + epsilon, z + epsilon));
          edges++;
        }
      }
    }
  }
  const timings = { map: [], index: [] };
  for (let i = 0; i < passes; i++) for (const kind of i % 2 ? ['index', 'map'] : ['map', 'index']) timings[kind].push(run(kind));
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const mapMs = median(timings.map), indexedMs = median(timings.index);
  reports.push({ course: course.slug, queries: count, edges, exact: true, mapMs, indexedMs, timings });
  console.log(`${course.slug}: ${count} exact heights + ${edges} exact edge inspections${passes ? `; map ${mapMs.toFixed(1)} ms, index ${indexedMs.toFixed(1)} ms` : ''}`);
}
const output = flag('out', null);
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ physicalPhone: false, microbenchmark: true, reports }, null, 2) + '\n');
}
