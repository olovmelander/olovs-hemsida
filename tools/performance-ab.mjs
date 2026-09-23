#!/usr/bin/env node
/* Real-device, same-build interleaved comparisons. Examples in
   docs/performance-phase1-rtx3070-2026-09-23.md. Pixel captures use det=1;
   timing defaults to normal use (see timing-mode.mjs). Never run concurrently. */
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
const course = option('course', 'puttom');
const kind = option('kind', 'frames');
assert.ok(['frames', 'tour', 'shots'].includes(kind));
const det = kind === 'shots' || args.includes('--det');
const variants = Object.fromEntries(option('variants', 'before=shadowcell=0&foliagenoise=pixel&flagcull=0&shadowalpha=0|after=').split('|').map(s => {
  const i = s.indexOf('='); assert.ok(i > 0); return [s.slice(0, i), s.slice(i + 1)];
}));
const order = option('order', kind === 'shots' ? 'before,after' : 'before,after,after,before').split(',');
assert.ok(order.every(k => Object.hasOwn(variants, k)));
const poses = option('poses', null);
const views = poses ? JSON.parse(fs.readFileSync(poses, 'utf8')).map((p, i) => [String(p.hole ?? 1), 'tee', 'golden', p, `tour-${i}`])
  : option('views', '1:tee:golden,12:orbit:golden,14:tee:golden').split(',').map(v => v.split(':'));
const frames = +option('frames', 600), seconds = +option('seconds', 45);
assert.ok(frames >= 300 && seconds > 0);
const out = path.resolve(option('out', `tools/reference/performance-${course}-${kind}${det ? '-det' : ''}`));
fs.mkdirSync(out, { recursive: true });
const build = await (await fetch(`${base}/course-startup-build.json`)).json();
const report = { date: new Date().toISOString(), source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  build, base, course, kind, det, quality: 'hi', backend: 'webgpu', viewport: [1920, 1080], dpr: 1,
  uncapped: kind === 'frames', frames, seconds, variants, order, runs: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const summary = values => {
  const s = [...values].sort((a, b) => a - b), q = p => s[Math.floor((s.length - 1) * p)];
  return s.length ? { n: s.length, p50: q(.5), p95: q(.95), p99: q(.99), max: s.at(-1),
    mean: s.reduce((a, b) => a + b, 0) / s.length, over50: s.filter(x => x > 50).length,
    over50Percent: 100 * s.filter(x => x > 50).length / s.length } : null;
};
const hardware = () => execFileSync('nvidia-smi', ['--query-gpu=name,driver_version,utilization.gpu,clocks.gr,clocks.mem,power.draw,temperature.gpu,pstate', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true }).trim();
function assertOnlyOneBrowser() {
  if (process.platform !== 'win32') return;
  const count = +execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|firefox|brave|opera)\\.exe$' -and $_.CommandLine -notmatch '--type=' }).Count"], { encoding: 'utf8', windowsHide: true });
  assert.equal(count, 1, 'another browser appeared during the run; discard this batch');
}
async function settle(page) {
  await page.waitForFunction(() => {
    const V = window.V3D;
    return V.settled() && V.v2Terrain().adapter?.stream?.loadingTiles === 0;
  }, null, { polling: 50 });
  const f = await page.evaluate(() => V3D.frame());
  await page.waitForFunction(f => V3D.frame() >= f + 2 && V3D.settled() &&
    V3D.v2Terrain().adapter?.stream?.loadingTiles === 0, f, { polling: 20 });
}
for (const [index, variant] of order.entries()) {
  const gpuIdle = await assertGpuIdle();
  const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs({ uncappedFrameRate: kind === 'frames' }) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && /GPUValidationError|validation error|shader.*error|pipeline.*failed/i.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(recordRequestedAdapters);
    const query = new URLSearchParams({ bana: course, q: 'hi', qualitylock: '1', v2: 'require', gl: '0',
      gputime: '1', ren: '1', ljus: 'kvall', hal: '1', vy: 'tee', ...(det ? { det: '1' } : {}) });
    for (const [k, v] of new URLSearchParams(variants[variant])) query.set(k, v);
    const url = `${base}/?${query}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#boot.done');
    const boot = await page.evaluate(() => ({ adapters: window.__startupAdapters, backend: V3D.v2Terrain().backend,
      gpuTiming: V3D.gpuTimingEnabled(), perf: V3D.perf(), trees: V3D.stats.trees }));
    assert.equal(boot.backend, 'webgpu');
    assert.ok(boot.adapters.some(a => a.vendor === 'nvidia' && a.isFallbackAdapter !== true), 'NVIDIA device required');
    assert.ok(boot.gpuTiming, 'timestamp queries required');
    const run = { index, variant, url, gpuIdle, hardwareAfterBoot: hardware(), chrome: browser.version(), boot, errors, views: [] };
    console.log(`${index + 1}/${order.length} ${variant}: boot complete; ${run.hardwareAfterBoot}`);
    report.runs.push(run); save();
    for (const [hole, camera, preset, pose, customId] of kind === 'tour' ? [['1', 'tee', 'golden']] : views) {
      const id = customId ?? `h${hole}-${camera}-${preset}`;
      await page.evaluate(([h, c, p]) => { V3D.setPreset(p); V3D.goHole(+h, true, true); V3D.setCam(c, true); }, [hole, camera, preset]);
      if (pose) await page.evaluate(p => { V3D.placeCamera(p.position, p.target); V3D.setFov(p.fov); }, pose);
      await settle(page);
      assertOnlyOneBrowser();
      if (kind === 'shots') {
        const image = `${index}-${variant}-${id}.png`;
        const state = await page.evaluate(() => ({ camera: V3D.camInfo(), terrain: V3D.v2Terrain().adapter.stream,
          tiers: V3D.treeTiers(), shadow: V3D.shadowRest(), frame: V3D.frame() }));
        await page.evaluate(() => V3D.prepareCapture());
        await page.locator('body > canvas').screenshot({ path: path.join(out, image) });
        const shadowMap = await page.evaluate(async () => {
          const { renderer, sun } = V3D.harness(), device = renderer.backend.device;
          const texture = renderer.backend.get(sun.shadow.map.depthTexture).texture;
          if (texture.format !== 'depth32float') throw new Error(`unsupported shadow format ${texture.format}`);
          const bytesPerRow = Math.ceil(texture.width * 4 / 256) * 256;
          const buffer = device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          device.pushErrorScope('validation');
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture, aspect: 'depth-only' }, { buffer, bytesPerRow }, [texture.width, texture.height, 1]);
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const bytes = new Uint8Array(buffer.getMappedRange()), compact = new Uint8Array(texture.width * texture.height * 4);
            for (let row = 0; row < texture.height; row++) compact.set(bytes.subarray(row * bytesPerRow, row * bytesPerRow + texture.width * 4), row * texture.width * 4);
            const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compact))].map(v => v.toString(16).padStart(2, '0')).join('');
            const error = await device.popErrorScope();
            if (error) throw new Error(error.message);
            return { sha256, width: texture.width, height: texture.height, format: texture.format,
              matrix: sun.shadow.matrix.toArray(), sun: sun.position.toArray(), target: sun.target.position.toArray() };
          } finally { buffer.destroy(); }
        });
        run.views.push({ id, image, state, shadowMap });
        console.log(`${index + 1}/${order.length} ${variant} ${id}: ${image}`);
      } else {
        const raw = await page.evaluate(async ({ frames, seconds, tour }) => {
          const V = window.V3D;
          await new Promise(resolve => { let n = 0; const tick = () => ++n >= 90 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick); });
          // Drain old timestamp batches before this view's window.
          await V.gpuTime();
          if (tour) V.startTour();
          const shadowBefore = V.shadowRest(), switches = V.treeTiers().switches;
          const ms = [], gpu = [], triangles = [], cameras = [];
          let pending = null, previousFrame = -1, last = null, first = null, maxLoadingTiles = 0;
          await new Promise(resolve => {
            const tick = now => {
              if (first === null) first = now;
              if (last !== null) ms.push(now - last);
              last = now;
              maxLoadingTiles = Math.max(maxLoadingTiles, V.v2Terrain().adapter.stream.loadingTiles);
              if (!pending) pending = V.gpuTime().then(r => {
                if (r.frame > previousFrame && r.ms > 0) gpu.push(r);
                previousFrame = r.frame;
              }).finally(() => { pending = null; });
              if (ms.length % 30 === 0) { triangles.push(V.rendererInfo().triangles); if (tour) cameras.push({ ...V.cameraInfo(), hole: V.flightState().hole, elapsedMs: now - first }); }
              if (tour ? now - first < seconds * 1000 : ms.length < frames) requestAnimationFrame(tick); else resolve();
            };
            requestAnimationFrame(tick);
          });
          if (pending) await pending;
          const result = { ms, gpu, triangles, cameras, maxLoadingTiles, shadowBefore, shadowAfter: V.shadowRest(),
            tiers: V.treeTiers(), switches: V.treeTiers().switches - switches, flight: V.flightState() };
          if (tour) V.endTour();
          return result;
        }, { frames, seconds, tour: kind === 'tour' });
        const row = { id, frameMs: summary(raw.ms), gpuMs: summary(raw.gpu.map(r => r.ms)), hardwareAfterWindow: hardware(), raw };
        assert.ok(row.gpuMs?.n >= 3, 'insufficient GPU samples');
        assertOnlyOneBrowser();
        run.views.push(row);
        console.log(`${index + 1}/${order.length} ${variant} ${id}: frame ${row.frameMs.p50.toFixed(2)} ms; GPU ${row.gpuMs.p50.toFixed(2)} ms (${row.gpuMs.n} samples); >50ms ${row.frameMs.over50Percent.toFixed(2)}%`);
      }
      save();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  assert.deepEqual(await (await fetch(`${base}/course-startup-build.json`)).json(), build, 'build changed');
}
save();
console.log(`wrote ${out}/report.json`);
