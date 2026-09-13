#!/usr/bin/env node
// Chrome DevTools-compatible CPU trace, including separate first-frame windows.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { recordRequestedAdapters } from './startup-adapter-probe.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8633';
const output = path.resolve(flag('out', 'tools/reference/startup-cpu'));
await fs.mkdir(path.dirname(output), { recursive: true });
const query = new URLSearchParams({ bana: flag('course', 'veckefjarden'), q: flag('q', 'hi'),
  startup: flag('startup', '1'), ghibli: flag('look', '1'), v2: 'require', det: '1', qualitylock: '1', hal: '1', vy: 'tee' });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  await page.addInitScript(recordRequestedAdapters);
  await page.addInitScript(({ boundTerrain, gateInitialFrame }) => {
    window.__startupTextureWrites = [];
    if (gateInitialFrame) {
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => request(function ready(time) {
        const perf = window.V3D?.perf();
        if (perf?.firstSceneSubmittedAtMs && !perf.firstSceneGpuReadyAtMs) request(ready);
        else callback(time);
      });
    }
    if (!globalThis.GPUQueue) return;
    const original = GPUQueue.prototype.writeTexture;
    const ids = new WeakMap(); let nextId = 0;
    GPUQueue.prototype.writeTexture = function(destination, data, layout, size) {
      const texture = destination.texture;
      if (!ids.has(texture)) ids.set(texture, ++nextId);
      const started = performance.now();
      const backingBytes = data.byteLength;
      if (boundTerrain && texture.label.startsWith('banvy-v2-terrain-') && texture.format === 'rgba8unorm'
          && size.width === texture.width && size.height === texture.height
          && (size.depthOrArrayLayers ?? 1) === 1 && layout.bytesPerRow === texture.width * 4
          && ArrayBuffer.isView(data)) {
        const bytes = texture.width * texture.height * 4, offset = layout.offset || 0;
        if (data.byteLength > bytes && offset + bytes <= data.byteLength) {
          data = new Uint8Array(data.buffer, data.byteOffset + offset, bytes);
          layout = { offset: 0, bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rowsPerImage };
        }
      }
      try { return original.call(this, destination, data, layout, size); }
      finally {
        window.__startupTextureWrites.push({ atMs: started, ms: performance.now() - started,
          id: ids.get(texture), width: texture.width, height: texture.height,
          format: texture.format, label: texture.label, bytes: data.byteLength, backingBytes,
          stack: performance.now() - started > 20 ? new Error().stack : undefined });
      }
    };
  }, { boundTerrain: args.includes('--bound-terrain'), gateInitialFrame: args.includes('--gate-initial-frame') });
  const errors = [];
  const messages = [];
  page.on('console', message => messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => { errors.push(error.stack || error.message); console.error(error); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 90000 }).catch(error => errors.push(error.message));
  const { profile } = await cdp.send('Profiler.stop');
  const perf = await page.evaluate(() => window.V3D?.perf() ?? { firstFrames: [] });
  const { metrics } = await cdp.send('Performance.getMetrics');
  const navigationStart = metrics.find(metric => metric.name === 'NavigationStart').value * 1e6;
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const id of node.children || []) parent.set(id, node.id);
  function summarize(start = -Infinity, end = Infinity) {
    const self = new Map(), inclusive = new Map();
    let at = profile.startTime;
    for (let i = 0; i < profile.samples.length; i++) {
      const elapsed = profile.timeDeltas[i]; at += elapsed;
      if (at < start || at > end) continue;
      const id = profile.samples[i]; self.set(id, (self.get(id) || 0) + elapsed);
      for (let p = id; p !== undefined; p = parent.get(p)) inclusive.set(p, (inclusive.get(p) || 0) + elapsed);
    }
    const top = table => [...table].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([id, microseconds]) => {
      const frame = nodes.get(id).callFrame;
      return { ms: +(microseconds / 1000).toFixed(1), ...frame, parent: nodes.get(parent.get(id))?.callFrame.functionName };
    });
    return { self: top(self), inclusive: top(inclusive) };
  }
  const frames = perf.firstFrames.slice(0, 3).map(frame => {
    const start = navigationStart + (perf.engineStartedAtNavigationMs + frame.atMs) * 1000;
    return { ...frame, ...summarize(start, start + frame.ms * 1000) };
  });
  const textureWrites = await page.evaluate(() => window.__startupTextureWrites);
  const report = { url: page.url(), errors, messages, perf, navigationStart, whole: summarize(), frames, textureWrites,
    boot: await page.locator('#boot').evaluate(element => element.outerHTML),
    adapters: await page.evaluate(() => window.__startupAdapters) };
  await fs.writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
  await fs.writeFile(`${output}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ readyMs: perf.courseReadyAtNavigationMs, errors,
    frames: frames.map(frame => ({ ms: frame.ms, top: frame.self.slice(0, 8) })) }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
