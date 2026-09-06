#!/usr/bin/env node
/**
 * Deterministic render-work accounting, not a hardware/FPS benchmark.
 * Executes each revision's real terrain classes and main shadowRest function,
 * plus installed Three r185 Attributes with observed backend upload callbacks.
 *
 * node tools/check-terrain-shadow-work.mjs --baseline COMMIT --out REPORT.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/golf/package.json', import.meta.url));
const threeUrl = pathToFileURL(require.resolve('three/webgpu')).href;
const THREE = await import(threeUrl);
const threeRoot = path.dirname(path.dirname(require.resolve('three/webgpu')));
const attributesPath = path.join(threeRoot, 'src/renderers/common/Attributes.js');
const { default: Attributes } = await import(pathToFileURL(attributesPath).href);
const { AttributeType } = await import(pathToFileURL(path.join(threeRoot, 'src/renderers/common/Constants.js')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--baseline', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --baseline COMMIT --out REPORT.json');
  options[args[i].slice(2)] = args[i + 1];
}
if (!/^[a-f0-9]{40}$/.test(options.baseline || '') || !options.out) throw new Error('Use an exact 40-character baseline commit');
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
const batchPath = 'apps/golf/src/engine/v2-terrain-batch.mjs', mainPath = 'apps/golf/src/main.js';
const sources = {
  before: { batch: git('show', `${options.baseline}:${batchPath}`), main: git('show', `${options.baseline}:${mainPath}`) },
  after: { batch: fs.readFileSync(path.join(root, batchPath), 'utf8'), main: fs.readFileSync(path.join(root, mainPath), 'utf8') },
};
const temporary = fs.mkdtempSync(path.join(tmpdir(), 'banvy-shadow-work-'));
function relocatable(source) {
  return source.replace("'three/webgpu'", JSON.stringify(threeUrl))
    .replace("'three/tsl'", JSON.stringify(pathToFileURL(require.resolve('three/tsl')).href))
    .replace("'../../../../packages/course-v2/runtime/terrain-grid-topology.mjs'",
      JSON.stringify(pathToFileURL(path.join(root, 'packages/course-v2/runtime/terrain-grid-topology.mjs')).href));
}
function resource(index) {
  return { tileId: `l0/${index}/0`, width: 3, height: 3, decodedSha256: `fixture-${index}`,
    layout: 'rgba8x2-height-parent-octnormal-v1', textureData: new Uint8Array(72).fill(index),
    worldOriginX: index * 2 + 0.1, worldOriginZ: 0.2, heightOffsetWorld: 1 / 3,
    sampleSpacingMetres: 1, heightScaleMetres: 0.01, geometricErrorMetres: 1, maximumMorphDeltaMetres: 2 };
}
function shadowSource(source) {
  const start = source.indexOf('function shadowRest(');
  return source.match(/^const SHADOW_REST_STATE = .*;$/m)[0] + '\n'
    + source.slice(start, source.indexOf('\n}', start) + 2) + '\nthis.state = SHADOW_REST_STATE;';
}
function buffers(layer) {
  return [...layer.batches.values()].flatMap(batch => [batch.attributes.frame, batch.attributes.params]);
}
function geometryFingerprint(layer) {
  return hash(Buffer.concat([...layer.batches.values()].flatMap(batch =>
    [batch.geometry.attributes.position.array, batch.geometry.attributes.normal.array, batch.geometry.index.array]
      .map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength)))));
}
function frameFingerprint(layer) {
  return hash(Buffer.concat([...layer.batches.values()].flatMap(batch =>
    [batch.attributes.frame.array, batch.attributes.params.array, batch.texture.image.data]
      .map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength)))));
}
function fixture(BatchSet, main) {
  const layer = new BatchSet({ maximumTiles: 32 });
  const resources = Array.from({ length: 16 }, (_, i) => resource(i));
  layer.sync(resources, { now: 0 });
  const context = { THREE, GRAPHICS_POLISH: true, SHADOW_REST: true,
    sun: { position: new THREE.Vector3(1, 2, 3), target: { position: new THREE.Vector3() }, shadow: { needsUpdate: false } },
    terrainV2: { runtime: { layer } }, TREE_LOD: { queue: [], qHead: 0 }, treeUploadsThisFrame: 0, flying: 0 };
  runInNewContext(shadowSource(main), context);
  let uploads = 0, uploadBytes = 0, refreshes = 0, shadowFingerprint = null;
  const attrs = new Attributes({
    createAttribute() {},
    updateAttribute(attribute) { uploads++; uploadBytes += attribute.array.byteLength; },
  }, { createAttribute() {} });
  for (const attribute of buffers(layer)) attrs.update(attribute, AttributeType.VERTEX);
  const trace = [];
  return { layer, resources, context,
    frame(now) {
      layer.tick(now); context.shadowRest(now);
      // One common Attributes.update visit per instance buffer per frame.
      // Actual renderer passes may visit a buffer more often; these are real
      // manager callback observations, not measurements of GPU writes.
      for (const attribute of buffers(layer)) attrs.update(attribute, AttributeType.VERTEX);
      const refreshed = context.sun.shadow.needsUpdate;
      if (refreshed) { refreshes++; shadowFingerprint = frameFingerprint(layer); }
      context.sun.shadow.needsUpdate = false;
      trace.push({ now, refreshed, reason: refreshed ? context.state.why : null,
        morph: [...layer.batches.values()][0].attributes.params.array[2] });
    },
    resetCounts() { uploads = 0; uploadBytes = 0; refreshes = 0; trace.length = 0; },
    result() {
      const fingerprint = frameFingerprint(layer);
      return { frames: trace.length, attributeUpdateCallbacks: uploads, attributeUpdateBytes: uploadBytes,
        shadowRefreshRequests: refreshes, finalShadowMatchesTerrain: shadowFingerprint === fingerprint,
        geometryFingerprint: geometryFingerprint(layer), finalTerrainFingerprint: fingerprint,
        instanceBufferBytes: buffers(layer).reduce((sum, attribute) => sum + attribute.array.byteLength, 0),
        textureCapacityBytes: layer.stats().textureCapacityBytes, trace };
    },
  };
}
const scenarios = [
  { id: 'regular_16ms_morph', times: Array.from({ length: 23 }, (_, i) => i * 16) },
  { id: 'slow_final_frame', times: [0, 120, 1000, 1016, 1032] },
  { id: 'settled_60_frames', warm: [0, 1000, 1016], times: Array.from({ length: 60 }, (_, i) => 2000 + i * 16) },
  { id: 'same_count_payload_replacement', warm: [0, 1000, 1016], replace: true,
    times: Array.from({ length: 23 }, (_, i) => 2000 + i * 16) },
];
try {
  const modules = {};
  for (const [label, source] of Object.entries(sources)) {
    const file = path.join(temporary, `${label}.mjs`);
    fs.writeFileSync(file, relocatable(source.batch));
    modules[label] = await import(pathToFileURL(file).href);
  }
  const comparisons = scenarios.map(scenario => {
    const pair = {};
    for (const label of ['before', 'after']) {
      const f = fixture(modules[label].TerrainTileBatchSet, sources[label].main);
      for (const time of scenario.warm || []) f.frame(time);
      f.resetCounts();
      if (scenario.replace) {
        const replacement = { ...f.resources[0], decodedSha256: 'replacement', textureData: f.resources[0].textureData.slice() };
        replacement.textureData[0] = 99;
        f.layer.sync([replacement, ...f.resources.slice(1)], { now: 2000 });
      }
      for (const time of scenario.times) f.frame(time);
      pair[label] = f.result(); f.layer.dispose();
    }
    const same = ['geometryFingerprint', 'finalTerrainFingerprint', 'instanceBufferBytes', 'textureCapacityBytes']
      .every(key => pair.before[key] === pair.after[key]);
    return { id: scenario.id, ...pair, finalGeometryAndResourcesMatch: same,
      passed: same && pair.after.finalShadowMatchesTerrain };
  });
  const report = { schemaVersion: 1, date: new Date().toISOString(), baselineRevision: options.baseline,
    candidateSourceCheckpoint: git('rev-parse', 'HEAD').trim(),
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key,
      { batch: hash(value.batch), main: hash(value.main) }])),
    rendererAttributesSourceSha256: hash(fs.readFileSync(attributesPath)), threeVersion: THREE.REVISION,
    fixture: { kind: 'synthetic', tiles: 16, capacity: 32, textureGrid: [3, 3], morphDurationMilliseconds: 240 },
    method: 'Actual revision terrain classes and main shadowRest; installed Three common Attributes with observed backend callbacks. Initial allocations excluded. One attribute-manager visit per instance buffer per frame.',
    hardwarePerformanceEvidence: false, timingMeasured: false,
    limits: 'No physical GPU, driver upload timing, FPS, startup, total memory or actual shadow draw measurement. Synthetic topology and timings isolate state transitions, not full-course GPU load.',
    comparisons, passed: comparisons.every(result => result.passed) };
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, scenarios: comparisons.map(r => ({ id: r.id,
    shadowRequests: [r.before.shadowRefreshRequests, r.after.shadowRefreshRequests],
    attributeUpdates: [r.before.attributeUpdateCallbacks, r.after.attributeUpdateCallbacks],
    finalShadowCorrect: [r.before.finalShadowMatchesTerrain, r.after.finalShadowMatchesTerrain] })) }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
