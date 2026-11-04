#!/usr/bin/env node
/* How fast the map opens, on the phone proxy docs/load-times-2026-11-04.md uses for
 * the player: 4x CPU slowdown, 20 Mbps, 80 ms. Serve a production build first:
 *
 * node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/map-timing.mjs [--url http://localhost:8620/] [--slug veckefjarden] [--hole 7]
 *
 * The proxy runs on this machine's GPU, so it says how long the network and the
 * JavaScript take and nothing of a real phone's graphics. */
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = flag('url', 'http://localhost:8620/'), SLUG = flag('slug', 'veckefjarden'), HOLE = flag('hole', '7');
const MBPS = 20, LATENCY = 80, CPU = 4;

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });

async function open(label) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: MBPS * 125000, uploadThroughput: MBPS * 125000 / 4 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  let bytes = 0;
  cdp.on('Network.loadingFinished', event => { bytes += event.encodedDataLength; });
  const started = Date.now();
  await page.goto(`${BASE}?bana=${SLUG}&karta=1&hal=${HOLE}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => globalThis.V3DMap?.stats().frames > 0, null, { timeout: 120000, polling: 50 });
  const first = Date.now() - started;
  await page.waitForFunction(() => {
    const s = V3DMap.stats();
    return s.busy === 0 && s.metreTiles > 0 && !V3DMap.state.opening;
  }, null, { timeout: 120000, polling: 50 });
  const sharp = Date.now() - started;
  console.log(`${label.padEnd(14)} first picture ${(first / 1000).toFixed(2)} s · all 1 m ground ${(sharp / 1000).toFixed(2)} s · ${(bytes / 1048576).toFixed(2)} MB on the wire`);

  /* What a pan costs the main thread: the JavaScript of one frame, slowed 4x. */
  const pan = await page.evaluate(async () => {
    const { camera, state, invalidate } = V3DMap;
    state.follow = false;
    const times = [];
    for (let i = 0; i < 40; i++) {
      camera.state.x += 4;
      invalidate();
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      times.push(state.stats.lastDrawMs);
    }
    times.sort((a, b) => a - b);
    return { median: times[20], worst: times.at(-1) };
  });
  console.log(`${''.padEnd(14)} pan, per frame: median ${pan.median.toFixed(1)} ms of script, worst ${pan.worst.toFixed(1)} ms, at ${CPU}x CPU`);
  await page.close();
}

await open('cold');
await new Promise(done => setTimeout(done, 2500));   /* the worker takes over */
await open('reopen');
await open('reopen again');
await browser.close();
