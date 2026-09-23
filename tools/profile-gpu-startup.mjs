#!/usr/bin/env node
// Observe native GPU calls without changing the application or its prepared-data
// identity. API call time is CPU time; fence latency is NOT shader compile time.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';
import { recordRequestedAdapters } from './startup-adapter-probe.mjs';
import { assertGpuIdle } from './timing-mode.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8645';
const output = path.resolve(flag('out', 'tools/reference/gpu-startup-profile.json'));
await fs.mkdir(path.dirname(output), { recursive: true });
const query = new URLSearchParams({ bana: flag('course', 'veckefjarden'), startup: flag('startup', '1'),
  q: flag('q', 'hi'), ghibli: flag('look', '1'), gl: flag('gl', '0'), v2: 'require',
  qualitylock: '1', hal: '1', vy: 'tee', ljus: flag('light', 'kvall') });
// Normal use unless --det (tools/timing-mode.mjs): det cold-solves every
// flag cloth in the first frames, which is what these windows measure.
if (args.includes('--det')) query.set('det', '1');
const gpuIdle = GPU ? await assertGpuIdle({ allowBusy: args.includes('--allow-busy-gpu') }) : { checked: false, utilisation: null, allowedBusy: false };
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  await page.addInitScript(recordRequestedAdapters);
  await page.addInitScript(({ gate, timestamps }) => {
    const events = [], ids = new WeakMap(); let nextId = 0;
    const id = object => { if (!object) return null; if (!ids.has(object)) ids.set(object, ++nextId); return ids.get(object); };
    window.__startupGPU = { events, dropped: 0, gate };
    const record = event => { if (events.length < 100000) events.push(event); else window.__startupGPU.dropped++; };
    if (gate) {
      const request = requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => request(function ready(time) {
        const perf = window.V3D?.perf();
        if (perf?.firstSceneSubmittedAtMs && !perf.firstSceneGpuReadyAtMs) request(ready);
        else callback(time);
      });
    }
    if (globalThis.WebGL2RenderingContext) {
      for (const name of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter']) {
        const original = WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name] = function(...values) {
          const atMs = performance.now();
          try { return Reflect.apply(original, this, values); }
          finally { record({ name: `WebGL2.${name}`, atMs, cpuMs: performance.now() - atMs }); }
        };
      }
    }
    if (!globalThis.GPUDevice) return;
    // Optional GPU execution timestamps. They exclude CPU/driver compilation
    // and make it possible to distinguish a slow draw from queue startup.
    if (timestamps) {
      let device, queries;
      const passes = [];
      const requestDevice = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function(descriptor = {}) {
        const features = [...(descriptor.requiredFeatures || [])];
        if (this.features.has('timestamp-query') && !features.includes('timestamp-query')) features.push('timestamp-query');
        device = await requestDevice.call(this, { ...descriptor, requiredFeatures: features });
        if (device.features.has('timestamp-query')) queries = device.createQuerySet({ type: 'timestamp', count: 128 });
        return device;
      };
      const begin = GPUCommandEncoder.prototype.beginRenderPass;
      GPUCommandEncoder.prototype.beginRenderPass = function(descriptor) {
        if (queries && window.V3D?.perf().firstFrames.length === 0 && passes.length < 64 && !descriptor.timestampWrites) {
          const index = passes.length * 2;
          passes.push({ label: descriptor.label ?? '', index });
          descriptor = { ...descriptor, timestampWrites: { querySet: queries, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } };
        }
        return begin.call(this, descriptor);
      };
      window.__readStartupGPUTimestamps = async () => {
        if (!queries || !passes.length) return null;
        const size = passes.length * 16;
        const resolved = device.createBuffer({ size, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        const mapped = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          const encoder = device.createCommandEncoder();
          encoder.resolveQuerySet(queries, 0, passes.length * 2, resolved, 0);
          encoder.copyBufferToBuffer(resolved, 0, mapped, 0, size);
          device.queue.submit([encoder.finish()]);
          await mapped.mapAsync(GPUMapMode.READ);
          const values = new BigUint64Array(mapped.getMappedRange());
          return passes.map(p => ({ label: p.label, ms: Number(values[p.index + 1] - values[p.index]) / 1e6 }));
        } finally { mapped.unmap(); mapped.destroy(); resolved.destroy(); queries.destroy(); }
      };
    }
    function wrap(prototype, name, describe, asynchronous = false) {
      const original = prototype[name];
      if (!original) return;
      prototype[name] = function(...values) {
        const event = { name, atMs: performance.now(), ...describe(values) };
        try {
          const result = Reflect.apply(original, this, values);
          event.cpuMs = performance.now() - event.atMs;
          if (asynchronous) result.then(() => { event.readyAtMs = performance.now(); }, error => { event.error = String(error); });
          if (result && typeof result === 'object' && !asynchronous) event.id = id(result);
          record(event); return result;
        } catch (error) { event.error = String(error); record(event); throw error; }
      };
    }
    const pipeline = ([d]) => ({ label: d.label, vertex: id(d.vertex?.module), fragment: id(d.fragment?.module),
      targets: d.fragment?.targets?.map(t => t?.format), samples: d.multisample?.count ?? 1 });
    wrap(GPUDevice.prototype, 'createShaderModule', ([d]) => ({ label: d.label, characters: d.code.length }));
    wrap(GPUDevice.prototype, 'createRenderPipeline', pipeline);
    wrap(GPUDevice.prototype, 'createRenderPipelineAsync', pipeline, true);
    wrap(GPUDevice.prototype, 'createComputePipeline', ([d]) => ({ label: d.label }));
    wrap(GPUDevice.prototype, 'createBuffer', ([d]) => ({ label: d.label, bytes: d.size, usage: d.usage }));
    wrap(GPUDevice.prototype, 'createTexture', ([d]) => ({ label: d.label, size: d.size, format: d.format }));
    wrap(GPUQueue.prototype, 'submit', ([commands]) => ({ commands: commands.length }));
    wrap(GPUQueue.prototype, 'writeBuffer', ([buffer, offset, data, start = 0, size]) => ({
      label: buffer.label, bytes: size === undefined ? data.byteLength - start * (data.BYTES_PER_ELEMENT || 1) : size * (data.BYTES_PER_ELEMENT || 1) }));
    wrap(GPUQueue.prototype, 'writeTexture', ([destination, data, layout, size]) => ({
      label: destination.texture.label, sourceViewBytes: data.byteLength, size, layout }));
    wrap(GPUQueue.prototype, 'copyExternalImageToTexture', ([, destination, size]) => ({ label: destination.texture.label, size }));
    wrap(GPUQueue.prototype, 'onSubmittedWorkDone', () => ({}), true);
  }, { gate: args.includes('--gate'), timestamps: args.includes('--timestamps') });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) warnings.push(message.text()); });
  const cdp = await page.context().newCDPSession(page);
  const mbps = +flag('mbps', '50'), latency = +flag('latency', '40');
  await cdp.send('Network.enable');
  if (mbps > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency,
    downloadThroughput: mbps * 1e6 / 8, uploadThroughput: mbps * 1e6 / 8 });
  const cpu = +flag('cpu', '1');
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (args.includes('--trace')) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
  }
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 180000 });
  if (args.includes('--trace')) {
    const { profile } = await cdp.send('Profiler.stop');
    await fs.writeFile(output.replace(/\.json$/, '') + '.cpuprofile', JSON.stringify(profile));
  }
  const report = await page.evaluate(() => ({ perf: V3D.perf(), stats: V3D.stats,
    adapters: window.__startupAdapters, gpu: window.__startupGPU }));
  report.det = query.get('det') === '1'; report.gpuIdle = gpuIdle;
  const { perf, gpu } = report;
  if (args.includes('--timestamps')) report.execution = await page.evaluate(() => window.__readStartupGPUTimestamps?.());
  const submitted = perf.engineStartedAtNavigationMs + perf.firstSceneSubmittedAtMs;
  const ready = perf.engineStartedAtNavigationMs + perf.firstSceneGpuReadyAtMs;
  const summarize = list => Object.fromEntries([...new Set(list.map(e => e.name))].map(name => {
    const found = list.filter(e => e.name === name);
    return [name, { count: found.length, cpuMs: +found.reduce((sum, e) => sum + (e.cpuMs || 0), 0).toFixed(1),
      bytes: found.reduce((sum, e) => sum + (e.bytes || 0), 0) }];
  }));
  report.summary = { readyMs: perf.courseReadyAtNavigationMs, firstFrame: perf.firstFrames[0],
    firstFrameWaitMs: +(ready - submitted).toFixed(1), beforeSubmit: summarize(gpu.events.filter(e => e.atMs <= submitted)),
    whileWaiting: summarize(gpu.events.filter(e => e.atMs > submitted && e.atMs <= ready)),
    fences: gpu.events.filter(e => e.name === 'onSubmittedWorkDone') };
  Object.assign(report, { url: page.url(), errors, warnings, conditions: { mbps, latency, cpu, physicalPhone: false } });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, execution: report.execution, errors }, null, 2));
  if (errors.length || warnings.some(w => /GPUValidationError|validation error|shader.*error|pipeline.*error/i.test(w))) process.exitCode = 1;
} finally { await browser.close(); }
