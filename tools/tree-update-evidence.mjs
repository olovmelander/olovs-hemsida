#!/usr/bin/env node
// Keep paired measurements, exact parity and unavailable metrics distinct.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { courseSourceRevision } from './course-source-revision.mjs';

const root = path.resolve('output/performance-audit/frame-stability-2026-09-22');
const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const replay = await read('tree-replay.json'), calibration = await read('tree-calibration-final.json');
const coverage = await read('tree-parity-other.json'), high = await read('tree-parity-high.json');
const revision = courseSourceRevision(process.cwd());
for (const r of [replay, calibration, coverage, high]) assert.equal(r.revision, revision);
const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * p, i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at - i);
};
const stats = values => ({ n: values.length, median: quantile(values, .5), p75: quantile(values, .75), min: Math.min(...values), max: Math.max(...values) });
function summarize(result) {
  return { ...result, scenarios: result.scenarios.map(s => {
    assert.equal(s.exact, true);
    for (const key of ['uploads', 'uploadBytes', 'fragmentedBytes']) assert.equal(s.baseline[key], s.candidate[key], `upload ${key} differs`);
    if (!s.samples.length) return s;
    const paired = Array.from({ length: 6 }, (_, round) => {
      const sample = variant => {
        const matches = s.samples.filter(x => x.round === round && x.variant === variant);
        assert.equal(matches.length, 1); assert.ok(Number.isFinite(matches[0].totalMs)); return matches[0].totalMs / s.frames;
      };
      return sample('baseline') - sample('candidate');
    });
    const cpu = Object.fromEntries(['baseline', 'candidate'].map(v => [v, stats(s.samples.filter(x => x.variant === v).map(x => x.totalMs / s.frames))]));
    return { ...s, meanCpuMsPerUpdate: cpu, pairedMeanCpuSavingsMs: stats(paired), fasterPairs: paired.filter(n => n > 0).length,
      medianCpuReductionPercent: 100 * (1 - cpu.candidate.median / cpu.baseline.median) };
  }) };
}
const baselineCatalog = JSON.parse(execFileSync('git', ['show', `${replay.baseline}:apps/golf/public/courses/index.json`], { encoding: 'utf8' }));
assert.deepEqual([...new Set([...replay.results, ...coverage.results].map(r => r.course))].sort(), baselineCatalog.courses.map(c => c.slug).sort());
assert.equal(high.results.length, 3); assert.ok(high.results.every(r => r.quality === 'hi'));
const tint = await read('tint-publication.json'), water = await read('water-publication.json'), prepared = await read('prepared-gate.json');
for (const r of [tint, water, prepared]) assert.equal(r.revision, revision);
assert.equal(tint.results.length, 26); assert.equal(water.results.length, 13); assert.equal(prepared.courses.length, 13);
for (const t of tint.results) assert.equal(t.sha256, baselineCatalog.courses.find(c => c.slug === t.course).preparedTint[t.variant].decodedSha256, 'tint changed');
// The previous batch's committed fingerprints are durable opening controls.
const previous = JSON.parse(execFileSync('git', ['show', `${replay.baseline}:docs/performance-reconstruction-2026-09-22-evidence.json`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
const waterParity = water.results.map(r => {
  const oldMeta = baselineCatalog.courses.find(c => c.slug === r.course);
  assert.equal(r.supported, !!oldMeta.preparedWater, 'water support changed');
  if (!r.supported) return { course: r.course, supported: false };
  const fingerprint = hash(JSON.stringify({ fingerprint: r.fingerprint, levels: r.levels }));
  assert.equal(fingerprint, previous.waterParity.find(p => p.course === r.course).exactSha256, 'water fields changed');
  return { course: r.course, supported: true, exactFields: true, fingerprint };
});
const openings = await read('openings.json');
assert.equal(openings.results.length, 3);
const openingParity = openings.results.map(r => {
  const old = previous.openings.find(p => p.course === r.course).candidate;
  assert.deepEqual(r.world, old.world, 'world changed');
  assert.equal(hash(JSON.stringify(r.water)), old.waterSha256, 'water changed');
  assert.equal(r.perf.preparedTint, true); assert.equal(r.perf.courseData.complete, true); assert.deepEqual(r.perf.courseData.fallbackReasons, []);
  return { course: r.course, exactWorldAndWater: true, adapter: r.adapter, preparedTint: r.perf.preparedTint,
    preparedWater: r.perf.preparedWater, completeCourse: r.perf.courseData.complete, world: r.world, waterSha256: old.waterSha256 };
});
const rawNames = ['tree-replay.json', 'tree-calibration-final.json', 'tree-parity-other.json', 'tree-parity-high.json',
  'water-publication.json', 'tint-publication.json', 'prepared-gate.json', 'openings.json', 'vitest.txt', 'node-tests.txt', 'validation.txt'];
const rawFiles = {};
for (const name of rawNames) { const bytes = await fs.readFile(path.join(root, name)); rawFiles[name] = { bytes: bytes.length, sha256: hash(bytes) }; }
const logCount = (text, pattern) => { const match = text.match(pattern); assert.ok(match, 'missing test summary'); return Number(match[1]); };
const vitest = await fs.readFile(path.join(root, 'vitest.txt'), 'utf8'), node = await fs.readFile(path.join(root, 'node-tests.txt'), 'utf8');
const tests = { vitestPassed: logCount(vitest, /Tests\s+(\d+) passed/), vitestTotal: logCount(vitest, /Tests\s+\d+ passed \((\d+)\)/),
  nodePassed: logCount(node, /ℹ pass (\d+)/), nodeFailed: logCount(node, /ℹ fail (\d+)/), nodeSkipped: logCount(node, /ℹ skipped (\d+)/) };
assert.equal(tests.vitestPassed, tests.vitestTotal); assert.equal(tests.nodeFailed, 0);
const evidence = { baseline: replay.baseline, revision, sourceHashes: replay.sourceHashes,
  environment: { node: process.version, browser: replay.browser, cpu: os.cpus()[0]?.model, availableParallelism: os.availableParallelism() },
  limitations: ['CPU diagnostic replay, not normal-use FPS or complete boot timing', 'Synthetic camera paths through real placements; no GPU draw calls in replay',
    'Proxy geometries omit static vertex payloads; full geometry-cloning cost during buffer growth is not represented',
    'Reported upload bytes are unchanged requested attribute ranges; not a measured GPU bandwidth reduction',
    'No new hardware GPU, physical-phone, sustained-frame or screenshot measurements'],
  measurements: replay.results.map(summarize), calibration: calibration.results.map(summarize),
  additionalCourseParity: coverage.results.map(summarize), highQualityParity: high.results.map(summarize),
  exactTintVariants: tint.results.length, waterParity, prepared, openings: openingParity, tests, rawFiles };
await fs.writeFile('docs/performance-frame-stability-2026-09-22-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ revision, courses: baselineCatalog.courses.length, tests, openingParity: openingParity.length }));
