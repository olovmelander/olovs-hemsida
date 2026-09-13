#!/usr/bin/env node
// Sequential ABBA comparisons, one fresh browser process per cold visit. Keep
// diagnostic instrumentation, visual gates and bakes out of this timing batch.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8645';
const out = path.resolve(flag('out', 'tools/reference/gpu-startup-benchmark'));
const count = +flag('runs', '10');
assert.ok(Number.isInteger(count) && count > 0 && count <= 50);
await fs.mkdir(out, { recursive: true });
const revision = await (await fetch(`${base}/course-startup-build.json`)).json();
const conditions = Object.fromEntries(['course', 'q', 'ghibli', 'gl', 'cpu', 'mbps', 'latency'].map(name => [name, flag(name,
  ({ course: 'veckefjarden', q: 'hi', ghibli: '1', gl: '0', cpu: '1', mbps: '50', latency: '40' })[name])]));
const report = { revision, conditions, mobileEmulation: args.includes('--mobile'), physicalPhone: false, instrumented: false, runs: [] };
let world;
const average = values => values.reduce((s, v) => s + v, 0) / values.length;
const round = n => Math.round(n * 10) / 10;
function summarize(startup) {
  const runs = report.runs.filter(run => run.startup === startup), ready = runs.map(run => run.readyMs).sort((a, b) => a - b);
  if (!runs.length) return null;
  return { count: runs.length, meanReadyMs: round(average(ready)), p75ReadyMs: ready[Math.ceil(ready.length * .75) - 1],
    meanGpuStartupMs: round(average(runs.map(run => run.gpuStartupMs))),
    meanPreparationMs: round(average(runs.map(run => run.preparationMs))),
    meanFirstFrameCpuMs: round(average(runs.map(run => run.firstFrameCpuMs))),
    meanFenceWaitMs: round(average(runs.map(run => run.fenceWaitMs))) };
}
async function save() {
  report.baseline = summarize('unprepared-gpu'); report.candidate = summarize('1');
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
try {
  for (let pair = 0; pair < count; pair++) for (const startup of (pair % 2 ? ['1', 'unprepared-gpu'] : ['unprepared-gpu', '1'])) {
    let gpuBefore = null;
    try { gpuBefore = execFileSync('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used', '--format=csv,noheader'], { windowsHide: true, encoding: 'utf8' }).trim(); } catch {}
    const name = `run-${String(report.runs.length + 1).padStart(2, '0')}`, output = path.join(out, `${name}.json`);
    const childArgs = ['tools/boot-profile.mjs', base, '--startup', startup, '--fingerprint', '--out', output,
      ...Object.entries(conditions).flatMap(([key, value]) => [`--${key}`, value]), ...(args.includes('--mobile') ? ['--mobile'] : [])];
    const child = spawn(process.execPath, childArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    await fs.writeFile(path.join(out, `${name}.log`), log);
    assert.equal(code, 0, `${name} failed: ${log.slice(-1000)}`);
    const result = JSON.parse(await fs.readFile(output, 'utf8')), run = result.runs[0], p = run.perf;
    assert.equal(run.booted, true); assert.deepEqual(run.errors, []);
    assert.equal(run.stats.backend, conditions.gl === '1' ? 'webgl2' : 'webgpu');
    assert.equal(p.preparedTint, true); assert.equal(p.courseData.complete, true);
    assert.deepEqual(p.courseData.fallbackReasons, []);
    assert.equal(Boolean(p.gpuPreparation), startup === '1');
    const fingerprint = { exactTables: run.fingerprint.exactTables, treeInstances: run.fingerprint.treeInstances,
      tintNear: run.fingerprint.tintNear, tintFar: run.fingerprint.tintFar };
    if (world) assert.deepEqual(fingerprint, world, 'world changed between visits'); else world = fingerprint;
    const preparationMs = p.spans.find(span => span.name === 'GPU startup: compile opening scene')?.ms ?? 0;
    const firstFrameCpuMs = p.firstFrames[0].ms, fenceWaitMs = round(p.firstSceneGpuReadyAtMs - p.firstSceneSubmittedAtMs);
    report.runs.push({ startup, name, gpuBefore, readyMs: p.courseReadyAtNavigationMs, preparationMs, firstFrameCpuMs, fenceWaitMs,
      gpuStartupMs: round(preparationMs + firstFrameCpuMs + fenceWaitMs), adapters: run.adapters });
    await save();
    console.log(`${name} startup=${startup}: ready ${p.courseReadyAtNavigationMs} ms; GPU startup ${report.runs.at(-1).gpuStartupMs} ms`);
  }
  assert.deepEqual(await (await fetch(`${base}/course-startup-build.json`)).json(), revision, 'served build changed');
  report.world = world;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
await save();
console.log(JSON.stringify({ baseline: report.baseline, candidate: report.candidate, error: report.error }, null, 2));
