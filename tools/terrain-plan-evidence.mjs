#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { courseSourceRevision } from './course-source-revision.mjs';

const directory = 'output/performance-audit/terrain-plans-2026-09-22';
const read = async file => JSON.parse(await fs.readFile(path.join(directory, file)));
const sha = data => createHash('sha256').update(data).digest('hex');
const replay = await read('terrain-plans.json'), calibration = await read('terrain-calibration.json');
const browserParity = await read('terrain-browser-parity.json');
const parity = await read('all-course-parity.json'), prepared = await read('prepared-gate.json');
const water = await read('water-publication.json'), tint = await read('tint-publication.json'), openings = await read('openings.json');
const revision = courseSourceRevision(process.cwd());
for (const report of [replay, browserParity, parity, prepared, water, tint]) assert.equal(report.revision, revision);
assert.deepEqual(browserParity.sourceHashes, replay.sourceHashes);
assert.equal(browserParity.results.length, replay.results.length);
for (const result of browserParity.results) {
  const measured = replay.results.find(r => r.course === result.course);
  assert.equal(result.inputSha256, measured.inputSha256);
  assert.equal(result.parity.exact, true);
}
assert.equal(calibration.sourceHashes.baseline, replay.sourceHashes.baseline);
assert.equal(calibration.sourceHashes.candidate, replay.sourceHashes.baseline);
assert.equal(parity.baselineSourceSha256, replay.sourceHashes.baseline);
assert.equal(replay.sourceHashes.candidate, sha(await fs.readFile('packages/course-v2/runtime/terrain-tile-manager.mjs')));
const baselineCatalog = JSON.parse(execFileSync('git', ['show', `${replay.baseline}:apps/golf/public/courses/index.json`], { encoding: 'utf8' }));
const previous = JSON.parse(execFileSync('git', ['show', `${replay.baseline}:docs/performance-frame-stability-2026-09-22-evidence.json`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
assert.deepEqual(parity.results.map(r => r.course).sort(), baselineCatalog.courses.map(c => c.slug).sort());
assert.ok(parity.results.every(r => r.exact));
assert.equal(prepared.courses.length, 13); assert.equal(water.results.length, 13); assert.equal(tint.results.length, 26);
for (const result of tint.results) assert.equal(result.sha256,
  baselineCatalog.courses.find(c => c.slug === result.course).preparedTint[result.variant].decodedSha256, 'tint changed');
const waterParity = water.results.map(result => {
  const old = previous.waterParity.find(r => r.course === result.course);
  assert.equal(result.supported, old.supported);
  if (!result.supported) return { course: result.course, supported: false };
  const fingerprint = sha(JSON.stringify({ fingerprint: result.fingerprint, levels: result.levels }));
  assert.equal(fingerprint, old.fingerprint, 'water fields changed');
  return { course: result.course, supported: true, exactFields: true, fingerprint };
});
assert.deepEqual(openings.results.map(r => r.course).sort(), ['puttom', 'veckefjarden', 'visby']);
const openingParity = openings.results.map(result => {
  const old = previous.openings.find(r => r.course === result.course);
  assert.deepEqual(result.world, old.world); assert.equal(sha(JSON.stringify(result.water)), old.waterSha256);
  assert.equal(result.perf.preparedTint, true); assert.equal(result.perf.courseData.complete, true);
  assert.deepEqual(result.perf.courseData.fallbackReasons, []);
  return { course: result.course, exactWorldAndWater: true, adapter: result.adapter,
    completeCourse: true, preparedTint: true, world: result.world, waterSha256: old.waterSha256 };
});
const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b), offset = (sorted.length - 1) * p, i = Math.floor(offset);
  return sorted[i] + (sorted[Math.ceil(offset)] - sorted[i]) * (offset - i);
};
const stats = values => ({ n: values.length, median: quantile(values, .5), p75: quantile(values, .75), min: Math.min(...values), max: Math.max(...values) });
const summarize = result => {
  assert.equal(result.parity.exact, true);
  // These are baseline component probes; they are not candidate GPU evidence.
  assert.deepEqual(result.statsBefore, result.statsAfter, 'settled baseline buffers changed');
  return { ...result, scenarios: result.scenarios.map(scenario => {
    const sample = (round, variant) => {
      const match = scenario.samples.filter(r => r.round === round && r.variant === variant);
      assert.equal(match.length, 1); assert.ok(Number.isFinite(match[0].meanMs)); return match[0].meanMs;
    };
    const paired = Array.from({ length: 6 }, (_, i) => sample(i, 'baseline') - sample(i, 'candidate'));
    const cpu = Object.fromEntries(['baseline', 'candidate'].map(variant => [variant,
      stats(Array.from({ length: 6 }, (_, i) => sample(i, variant)))]));
    return { ...scenario, meanCpuMsPerPlan: cpu, pairedSavingsMs: stats(paired), fasterPairs: paired.filter(v => v > 0).length,
      medianCpuReductionPercent: 100 * (1 - cpu.candidate.median / cpu.baseline.median) };
  }) };
};
const rawFiles = {};
for (const name of ['terrain-plans.json', 'terrain-calibration.json', 'terrain-browser-parity.json', 'all-course-parity.json', 'prepared-gate.json',
  'water-publication.json', 'tint-publication.json', 'openings.json', 'vitest.txt', 'node-tests.txt', 'validation.txt']) {
  const bytes = await fs.readFile(path.join(directory, name)); rawFiles[name] = { bytes: bytes.length, sha256: sha(bytes) };
}
const vitest = await fs.readFile(path.join(directory, 'vitest.txt'), 'utf8'), node = await fs.readFile(path.join(directory, 'node-tests.txt'), 'utf8');
const count = (text, pattern) => { const match = text.match(pattern); assert.ok(match); return Number(match[1]); };
const tests = { vitestPassed: count(vitest, /Tests\s+(\d+) passed/), vitestTotal: count(vitest, /Tests\s+\d+ passed \((\d+)\)/),
  nodePassed: count(node, /ℹ pass (\d+)/), nodeFailed: count(node, /ℹ fail (\d+)/), nodeSkipped: count(node, /ℹ skipped (\d+)/) };
assert.equal(tests.vitestPassed, tests.vitestTotal); assert.equal(tests.nodeFailed, 0);
const evidence = { baseline: replay.baseline, revision, sourceHashes: replay.sourceHashes,
  environment: { node: process.version, browser: replay.browser, cpu: os.cpus()[0]?.model, availableParallelism: os.availableParallelism() },
  limitations: ['CPU planner replay, not complete frame times, FPS or boot timing',
    'Synthetic orbit and instantaneous hole changes; fixed opening residency in timing; changing residency checked separately',
    'Frustum construction/testing and manager construction excluded from replay timer',
    'Baseline component probes use live frustum tests; replay uses captured visibility sets',
    'No hardware GPU, physical-phone, thermal or new screenshot measurements'],
  measurements: replay.results.map(summarize), calibration: calibration.results.map(summarize),
  browserParity: browserParity.results, allCourseParity: parity, exactTintVariants: tint.results.length, waterParity, prepared, openings: openingParity, tests, rawFiles };
await fs.writeFile('docs/performance-terrain-plans-2026-09-22-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ revision, tests, allCoursePlans: parity.results.reduce((n, r) => n + r.comparisons, 0), openings: openingParity.length }));
