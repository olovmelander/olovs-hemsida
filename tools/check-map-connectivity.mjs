/* Field regressions for a stationary golfer with an intermittent connection.
   Run against a root-path production build served by tools/serve.mjs. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8620/';
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const location = { latitude: 63.2845, longitude: 18.6735, accuracy: 5 };
let releaseImage;
const slowImage = new Promise(resolve => { releaseImage = resolve; });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    permissions: ['geolocation'], geolocation: location, serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    const open = CacheStorage.prototype.open;
    CacheStorage.prototype.open = function (name) {
      if (name === 'banvy-map-offline-v1') return Promise.reject(new DOMException('Storage unavailable', 'SecurityError'));
      return open.call(this, name);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let imagePending = false, terrainUnavailable = true;
  await page.route('**/models/map-trees/*.webp', async route => {
    if (!imagePending) { imagePending = true; await slowImage; }
    await route.continue();
  });
  await page.route('**/terrain/*.bvch', route => terrainUnavailable
    ? route.fulfill({ status: 503, body: 'Temporary connection failure' }) : route.continue());
  const round = new URL('?bana=veckefjarden&karta=1&runda=1&hal=1&mapquality=3', base);
  await page.goto(round.href, { waitUntil: 'domcontentloaded' });
  const wait = condition => page.waitForFunction(condition, null, { timeout: 60000, polling: 100 });
  await wait(() => globalThis.V3DMap?.state.player && V3DMap.state.guidance?.status === 'unavailable');
  const tee = await page.evaluate(() => {
    const { course, state } = V3DMap;
    const hole = course.holes[0];
    const [x, z] = (hole.tees[state.tee] ?? hole.tees[0]).point;
    const [east, south] = course.frame.toPack(x, z);
    return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 5 };
  });
  await context.setGeolocation(tee);
  assert.ok(imagePending, 'optional tree picture is still in transit');
  console.log('GPS and round startup work before appearance and during a terrain failure');

  // The player stays put and the browser stays online. No synthetic online event.
  terrainUnavailable = false;
  await wait(() => V3DMap.state.guidance?.status === 'playable' && V3DMap.state.guidance.target);
  await wait(() => V3DMap.stats().metreTiles > 0);
  assert.ok(await page.evaluate(() => navigator.onLine));
  console.log('Active hole recovers and draws using the network when offline storage is unavailable');

  const frames = await page.evaluate(() => V3DMap.stats().frames);
  releaseImage();
  await page.waitForFunction(before => V3DMap.stats().appearanceReady && V3DMap.stats().frames > before, frames, { timeout: 60000 });
  assert.deepEqual(errors, []);
} finally {
  releaseImage();
  await browser.close();
}
