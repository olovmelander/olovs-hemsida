#!/usr/bin/env node
/* Cold localhost desktop startup, interleaved prepared-vista/scatter factorial.
   BANVY_GPU=1 node tools/startup-ab.mjs --base http://127.0.0.1:8648
   Each run gets a fresh Chrome process/context; OS and driver caches persist.
   Keep all GPU work sequential. This is not a phone or network proxy. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';
import { assertGpuIdle } from './timing-mode.mjs';
import { recordRequestedAdapters } from './startup-adapter-probe.mjs';

const args = process.argv.slice(2);
const option = (k, fallback) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : fallback;
assert.ok(GPU, 'BANVY_GPU=1 required');
const base = option('base', 'http://127.0.0.1:8648');
const course = option('course', 'veckefjarden');
const control = option('control', 'query');
assert.ok(['query', 'assets'].includes(control));
const out = path.resolve(option('out', 'tools/reference/rtx3070/startup'));
fs.mkdirSync(out, { recursive: true });
const variants = { before: 'prepvista=0&prepscatter=0', after: '', vista: 'prepscatter=0', scatter: 'prepvista=0' };
const order = option('order', 'before,after,vista,scatter,scatter,vista,after,before,before,after,vista,scatter').split(',');
assert.ok(order.every(k => Object.hasOwn(variants, k)));
const build = await (await fetch(`${base}/course-startup-build.json`)).json();
const catalog = await (await fetch(`${base}/courses/index.json`)).json();
const courseRecord = catalog.courses.find(c => c.slug === course);
assert.ok(courseRecord, 'unknown course');
const scatterReference = courseRecord.preparedScatter?.['scatter-hi'];
const scatterSections = Object.entries(scatterReference?.sections ?? {}).filter(([, value]) => value !== null).map(([name]) => name).sort();
const report = { date: new Date().toISOString(), source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  build, base, course, control, det: false, quality: 'hi', viewport: [1920, 1080], dpr: 1, cpuRate: 1,
  network: 'localhost; fresh browser/context; service workers blocked; server no-store; OS and driver caches retained',
  variants, order, runs: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
function assertOnlyOneBrowser() {
  if (process.platform !== 'win32') return;
  const roots = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "$benchmarkBrowsers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|firefox|brave|opera)\\.exe$' }); $benchmarkRoots = @($benchmarkBrowsers | Where-Object { $_.ParentProcessId -notin $benchmarkBrowsers.ProcessId -and $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ParentProcessId,Name); ConvertTo-Json -InputObject $benchmarkRoots -Compress"],
  { encoding: 'utf8', windowsHide: true }));
  assert.equal(roots.length, 1, `competing browser roots: ${JSON.stringify(roots)}; discard this startup run`);
}
let expectedFingerprint;
for (const [index, variant] of order.entries()) {
  const gpuIdle = await assertGpuIdle();
  assert.ok(gpuIdle.checked, 'RTX comparison requires a working GPU idle probe');
  const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    page.setDefaultTimeout(180000);
    const errors = [];
    const blockedPreparedAssets = [];
    page.on('pageerror', e => errors.push(e.message));
    // PR #89's query allowlist couples these controls to other prepared data.
    // This optional arm holds the URL constant and exercises each loader's
    // ordinary missing-asset fallback, with world identity checked below.
    if (control === 'assets') await page.route('**/prepared/*.bin', async route => {
      const url = route.request().url();
      const block = (/\/vista-/.test(url) && ['before', 'scatter'].includes(variant)) ||
        (/\/scatter-/.test(url) && ['before', 'vista'].includes(variant));
      if (block) { blockedPreparedAssets.push(url); await route.abort('failed'); }
      else await route.continue();
    });
    await page.addInitScript(recordRequestedAdapters);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let requests = 0, transferredBytes = 0;
    cdp.on('Network.requestWillBeSent', () => requests++);
    cdp.on('Network.loadingFinished', e => { transferredBytes += e.encodedDataLength; });
    const query = new URLSearchParams({ bana: course, q: 'hi', qualitylock: '1', v2: 'require', gl: '0',
      ljus: 'kvall', hal: '1', vy: 'tee' });
    if (control === 'query') for (const [k, v] of new URLSearchParams(variants[variant])) query.set(k, v);
    const url = `${base}/?${query}`, start = performance.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#boot.done');
    const readyWallMs = performance.now() - start;
    await page.waitForFunction(() => V3D.perf().firstFrames.length >= 6);
    assertOnlyOneBrowser();
    const data = await page.evaluate(async () => ({ adapters: window.__startupAdapters, backend: V3D.v2Terrain().backend,
      perf: V3D.perf(), fingerprint: await V3D.startupWorldFingerprint(),
      counts: { trees: V3D.stats.trees, vista: V3D.stats.vista, reeds: V3D.stats.reeds, tufts: V3D.stats.tufts } }));
    assert.equal(data.backend, 'webgpu');
    assert.ok(data.adapters.some(a => a.vendor === 'nvidia' && a.isFallbackAdapter !== true));
    assert.deepEqual(errors, []);
    if (control === 'assets') {
      assert.equal(data.perf.preparedTint, true, 'tint must remain prepared in isolated comparison');
      assert.equal(!!data.perf.preparedWater, !!courseRecord.preparedWater, 'water eligibility must remain unchanged');
      assert.equal(data.perf.preparedVista, ['after', 'vista'].includes(variant) && !courseRecord.preparedVista?.['vista-hi']?.none);
      const expectedSections = ['after', 'scatter'].includes(variant) ? scatterSections : [];
      assert.deepEqual(Object.keys(data.perf.preparedScatter).sort(), expectedSections, 'scatter control must affect only scatter');
      assert.ok(Object.values(data.perf.preparedScatter).every(value => value === true), 'scatter replay mismatch');
    }
    expectedFingerprint ??= data.fingerprint;
    assert.deepEqual(data.fingerprint, expectedFingerprint, 'prepared startup changed world fingerprint');
    assertOnlyOneBrowser();
    const hardware = execFileSync('nvidia-smi', ['--query-gpu=name,driver_version,clocks.gr,power.draw,temperature.gpu', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true }).trim();
    report.runs.push({ index, variant, url, gpuIdle, chrome: browser.version(), readyWallMs, requests, transferredBytes, hardware, blockedPreparedAssets, errors, ...data });
    save();
    console.log(`${index + 1}/${order.length} ${variant}: total ${data.perf.totalMs} ms; ready ${data.perf.doneAtMs} ms; wall ${readyWallMs.toFixed(1)} ms; fingerprint identical`);
  } finally { await browser.close(); }
  assert.deepEqual(await (await fetch(`${base}/course-startup-build.json`)).json(), build, 'build changed');
}
console.log(`wrote ${out}/report.json`);
