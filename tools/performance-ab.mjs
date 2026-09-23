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
  uncapped: kind === 'frames', frames, seconds, variants, order, viewConfig: views, runs: [] };
if (args.includes('--resume')) {
  const previous = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  for (const key of ['build', 'base', 'course', 'kind', 'det', 'quality', 'backend', 'viewport', 'dpr', 'uncapped', 'frames', 'seconds', 'variants', 'order'])
    assert.deepEqual(previous[key], report[key], `cannot resume changed ${key}`);
  if (previous.viewConfig) assert.deepEqual(previous.viewConfig, views, 'cannot resume changed views/poses');
  else assert.ok(!poses, 'legacy report does not record exact custom poses');
  const expectedViews = kind === 'tour' ? 1 : views.length;
  // Keep only a contiguous prefix of wholly completed, error-free runs.
  for (const run of previous.runs) {
    if (run.index !== report.runs.length || run.views.length !== expectedViews || run.errors.length) break;
    assert.equal(run.variant, order[run.index], 'cannot resume changed run order');
    const expectedIds = kind === 'tour' ? ['h1-tee-golden'] : views.map(([h, c, p, , id]) => id ?? `h${h}-${c}-${p}`);
    assert.deepEqual(run.views.map(v => v.id), expectedIds, 'cannot resume changed view sequence');
    report.runs.push(run);
  }
  report.resumed = { at: report.date, originalDate: previous.date, retainedRuns: report.runs.length,
    discardedPartialRuns: previous.runs.length - report.runs.length };
}
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
  const roots = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "$benchmarkBrowsers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|firefox|brave|opera)\\.exe$' }); $benchmarkRoots = @($benchmarkBrowsers | Where-Object { $_.ParentProcessId -notin $benchmarkBrowsers.ProcessId -and $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ParentProcessId,Name); ConvertTo-Json -InputObject $benchmarkRoots -Compress"],
  { encoding: 'utf8', windowsHide: true }));
  assert.equal(roots.length, 1, `competing browser roots: ${JSON.stringify(roots)}; discard the interrupted run`);
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
  if (index < report.runs.length) continue;
  const gpuIdle = await assertGpuIdle();
  assert.ok(gpuIdle.checked, 'RTX comparison requires a working GPU idle probe');
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
    const boot = await page.evaluate(async () => ({ adapters: window.__startupAdapters, backend: V3D.v2Terrain().backend,
      gpuTiming: V3D.gpuTimingEnabled(), perf: V3D.perf(), trees: V3D.stats.trees,
      quality: V3D.quality(), treePolicy: V3D.treeLodPx(), fingerprint: await V3D.startupWorldFingerprint() }));
    assert.equal(boot.backend, 'webgpu');
    assert.ok(boot.adapters.some(a => a.vendor === 'nvidia' && a.isFallbackAdapter !== true), 'NVIDIA device required');
    assert.ok(boot.gpuTiming, 'timestamp queries required');
    assert.equal(boot.quality.lowq, false, 'comparison requires high quality');
    assert.equal(boot.quality.qualityLocked, true, 'quality must stay locked');
    assert.equal(boot.quality.pixelRatio, 1, 'comparison requires DPR 1');
    if (report.runs[0]?.boot.fingerprint)
      assert.deepEqual(boot.fingerprint, report.runs[0].boot.fingerprint, 'variant changed planting data');
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
        const state = await page.evaluate(() => ({ camera: V3D.camInfo(), cameraExact: V3D.cameraInfo(), terrain: V3D.v2Terrain().adapter.stream,
          tiers: V3D.treeTiers(), shadow: V3D.shadowRest(), frame: V3D.frame() }));
        await page.evaluate(() => V3D.prepareCapture());
        await page.locator('body > canvas').screenshot({ path: path.join(out, image) });
        const shadowMap = await page.evaluate(async () => {
          const { renderer, sun } = V3D.harness(), device = renderer.backend.device;
          const texture = renderer.backend.get(sun.shadow.map.depthTexture).texture;
          // depth24plus cannot be copied directly. Read native depth texels
          // through textureLoad into f32 storage without changing the map.
          const size = texture.width * texture.height * 4;
          const storage = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
          const buffer = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          device.pushErrorScope('validation');
          try {
            const module = device.createShaderModule({ code: `
              @group(0) @binding(0) var source: texture_depth_2d;
              @group(0) @binding(1) var<storage, read_write> depths: array<f32>;
              @compute @workgroup_size(8, 8)
              fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                let dims = textureDimensions(source);
                if (all(id.xy < dims)) { depths[id.y * dims.x + id.x] = textureLoad(source, vec2<i32>(id.xy), 0); }
              }` });
            const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
            const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
              { binding: 0, resource: texture.createView({ aspect: 'depth-only' }) }, { binding: 1, resource: { buffer: storage } }] });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(texture.width / 8), Math.ceil(texture.height / 8)); pass.end();
            encoder.copyBufferToBuffer(storage, 0, buffer, 0, size);
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer.getMappedRange()))].map(v => v.toString(16).padStart(2, '0')).join('');
            const error = await device.popErrorScope();
            if (error) throw new Error(error.message);
            return { sha256, width: texture.width, height: texture.height, format: texture.format,
              matrix: sun.shadow.matrix.toArray(), sun: sun.position.toArray(), target: sun.target.position.toArray() };
          } finally { buffer.destroy(); storage.destroy(); }
        });
        assertOnlyOneBrowser();
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
