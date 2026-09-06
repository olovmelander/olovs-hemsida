#!/usr/bin/env node
/** CPU-only component benchmark, not scene frame time or hardware FPS.
 * node tools/check-terrain-idle-work.mjs --baseline REV --out REPORT.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/golf/package.json', import.meta.url));
const args = process.argv.slice(2), arg = name => args[args.indexOf(`--${name}`) + 1];
if (!args.includes('--baseline') || !args.includes('--out')) throw new Error('Provide --baseline REV --out REPORT.json');
const baseline = arg('baseline'), out = path.resolve(arg('out'));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
const file = 'apps/golf/src/engine/v2-terrain-batch.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = { before: git('show', `${baseline}:${file}`), after: fs.readFileSync(path.join(root, file), 'utf8') };
const temp = fs.mkdtempSync(path.join(tmpdir(), 'banvy-idle-'));
const resources = Array.from({ length: 277 }, (_, index) => Object.freeze({ tileId: `l0/${index}/0`,
  width: 3, height: 3, decodedSha256: `fixture-${index}`, layout: 'rgba8x2-height-parent-octnormal-v1',
  textureData: new Uint8Array(72).fill(index), worldOriginX: index * 2 + 0.1, worldOriginZ: 0.2,
  heightOffsetWorld: 1 / 3, sampleSpacingMetres: 1, heightScaleMetres: 0.01,
  geometricErrorMetres: 1, maximumMorphDeltaMetres: 2 }));
const layers = {}, samples = { before: [], after: [] }, batchFrames = 200;
let now = 1000;
function sample(side) {
  const started = performance.now();
  for (let i = 0; i < batchFrames; i++) { now += 16; layers[side].tick(now); layers[side].sync(resources, { now }); }
  return (performance.now() - started) / batchFrames;
}
try {
  for (const [side, source] of Object.entries(sources)) {
    const relocated = source.replace("'three/webgpu'", JSON.stringify(pathToFileURL(require.resolve('three/webgpu')).href))
      .replace("'three/tsl'", JSON.stringify(pathToFileURL(require.resolve('three/tsl')).href))
      .replace("'../../../../packages/course-v2/runtime/terrain-grid-topology.mjs'",
        JSON.stringify(pathToFileURL(path.join(root, 'packages/course-v2/runtime/terrain-grid-topology.mjs')).href));
    const target = path.join(temp, `${side}.mjs`); fs.writeFileSync(target, relocated);
    const { TerrainTileBatchSet } = await import(pathToFileURL(target).href);
    layers[side] = new TerrainTileBatchSet({ maximumTiles: 320 });
    layers[side].sync(resources, { now: 0 }); layers[side].tick(1000);
  }
  for (let i = 0; i < 6; i++) { sample('before'); sample('after'); }
  for (let i = 0; i < 30; i++) {
    for (const side of i % 2 ? ['after', 'before'] : ['before', 'after']) samples[side].push(sample(side));
  }
  const fingerprint = layer => hash(Buffer.concat([...layer.batches.values()].flatMap(batch =>
    [batch.attributes.frame.array, batch.attributes.params.array, batch.texture.image.data].map(array =>
      Buffer.from(array.buffer, array.byteOffset, array.byteLength)))));
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { medianMs: sorted[Math.floor(sorted.length / 2)], p95BatchMeanMs: sorted[Math.ceil(sorted.length * .95) - 1] };
  };
  const report = { baselineRevision: baseline, candidateCheckpoint: git('rev-parse', 'HEAD').trim(),
    hardwarePerformanceEvidence: false,
    method: 'Node CPU only: real TerrainTileBatchSet.tick plus sync, 277 frozen synthetic 3x3 resources, 320-slot capacity. Six warmups, 30 alternating A/B batches of 200 settled frames. p95 is a batch-mean distribution, NOT scene slow-frame p95.',
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, hash(v)])), samples,
    summary: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, summary(v)])),
    finalBuffersMatch: fingerprint(layers.before) === fingerprint(layers.after) };
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, finalBuffersMatch: report.finalBuffersMatch }));
  if (!report.finalBuffersMatch) process.exitCode = 1;
} finally { for (const layer of Object.values(layers)) layer.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
