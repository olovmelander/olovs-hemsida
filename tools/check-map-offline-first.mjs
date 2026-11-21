/* A new phone saves a course before its first service worker is installed.
   Point this at a production build served by tools/serve.mjs. A local proxy
   cuts off the origin itself, including requests made by the service worker. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const upstream = new URL(process.argv[2] || 'http://127.0.0.1:8620/');
let releaseInstall, disconnected = false;
const installing = new Promise(resolve => { releaseInstall = resolve; });
const proxy = http.createServer(async (request, response) => {
  const url = new URL(request.url, upstream);
  if (url.pathname.endsWith('/sw.js')) await installing;
  if (disconnected) { request.socket.destroy(); return; }
  const forward = http.get(url, { headers: request.headers }, source => {
    response.writeHead(source.statusCode, source.headers);
    source.pipe(response);
  });
  forward.on('error', () => response.destroy());
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const base = new URL(upstream.pathname, `http://127.0.0.1:${proxy.address().port}`);
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: 57.5, longitude: 18.1, accuracy: 5 },
  });
  const page = await context.newPage();
  const wait = test => page.waitForFunction(test, null, { timeout: 90000, polling: 150 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('?bana=visby&karta=1', base).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-start-download]').click();
  await wait(() => document.querySelector('[data-start-download]').disabled);
  assert.deepEqual(await page.evaluate(() => [
    !!navigator.serviceWorker.controller, localStorage.getItem('banvy-map-offline:visby'),
  ]), [false, null]);
  releaseInstall();
  const ready = () => document.querySelector('[data-download]').textContent === 'Sparad';
  await wait(() => ['Sparad', 'Försök spara offline igen'].includes(document.querySelector('[data-download]').textContent));
  assert.ok(await page.evaluate(ready), await page.locator('[data-status]').textContent());
  const savedRow = page.locator('[data-offline-course="visby"]');
  const openSettings = () => page.goto(new URL('#installningar', base).href, { waitUntil: 'domcontentloaded' });
  await openSettings();
  await savedRow.getByText('Redo för spel offline').waitFor();
  const count = await page.evaluate(async () => {
    const cache = await caches.open('banvy-map-offline-v1'), keys = await cache.keys();
    for (const pattern of [/\/decode-web-.*\.js$/, /\/terrain\/.*\.bvch$/, /\.offline\.json$/]) {
      const file = keys.find(request => pattern.test(request.url));
      if (!file || !await cache.delete(file)) throw new Error(`Missing eviction candidate (${pattern})`);
    }
    const name = (await caches.keys()).find(name => name.startsWith('workbox-precache-'));
    const shell = await caches.open(name);
    const index = (await shell.keys()).find(request => {
      const url = new URL(request.url);
      return url.pathname === new URL('.', location.href).pathname && url.searchParams.has('__WB_REVISION__');
    });
    if (!index || !await shell.delete(index)) throw new Error('Missing revisioned shell');
    return keys.length;
  });
  async function openHubCourse() {
    await page.goto(new URL('#karta', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#chooser .card[data-slug="visby"]').click();
  }
  await openHubCourse();
  await page.getByRole('button', { name: 'Reparera offlinebanan' }).waitFor();
  await openSettings();
  await savedRow.getByRole('link', { name: /Reparera/ }).click();
  await page.locator('[data-menu-sheet]:visible [data-download]').waitFor();
  assert.deepEqual(await page.evaluate(() => [V3DMap.round().begunAt || null, document.querySelector('[data-gps]').getAttribute('aria-pressed')]), [null, 'false']);
  await wait(() => document.querySelector('[data-download]').textContent === 'Reparera offlinebanan');
  await page.locator('[data-download]').click();
  await wait(ready);
  console.log(`First install verified. Evicted code, terrain, download inventory and shell repaired (${count} durable entries).`);

  await page.evaluate(() => caches.delete('banvy-map-offline-v1'));
  await page.locator('[data-menu-sheet] [data-close]').click();
  await page.locator('[data-menu]').click();
  await page.locator('[data-menu-tab="bana"]').click();
  await wait(() => document.querySelector('[data-download]').textContent === 'Reparera offlinebanan');
  await page.locator('[data-download]').click();
  await wait(ready);
  console.log('A deleted course cache is detected and rebuilt within the same session.');

  // Remove every incidental runtime copy, including the shared graph loader's
  // last root. Only the explicitly saved course and installed shell survive.
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name !== 'banvy-map-offline-v1' && !name.startsWith('workbox-precache-')) await caches.delete(name);
    }
  });
  disconnected = true;
  await context.setOffline(true);
  await openHubCourse();
  await wait(() => document.querySelector('[data-offline-status]')?.textContent.includes('klar för spel offline'));
  await page.goto(new URL('?bana=visby&karta=1&runda=1&hal=9', base).href, { waitUntil: 'domcontentloaded' });
  await wait(() => globalThis.V3DMap?.state.hole === 9);
  const tee = await page.evaluate(() => {
    const { course, state } = V3DMap, hole = course.holes.find(hole => hole.number === 9) ?? course.holes[8];
    const [x, z] = (hole.tees[state.tee] ?? hole.tees[0]).point;
    const [east, south] = course.frame.toPack(x, z);
    return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 5 };
  });
  await context.setGeolocation(tee);
  await wait(() => V3DMap.stats().metreTiles > 0 && V3DMap.state.guidance?.source === 'gps' &&
    V3DMap.state.guidance?.status === 'playable');
  await page.locator('[data-menu]').click();
  await page.locator('[data-menu-tab="bana"]').click();
  await wait(ready);
  assert.deepEqual(errors, []);
  console.log('Hard-disconnected cold navigation to hole 9 displays 1 m terrain, playable GPS guidance and verified offline status.');
  await page.goto(new URL('index.html#statistik', base).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#stats:not([hidden])').waitFor();
  assert.equal(new URL(page.url()).hash, '#statistik');
  console.log('A direct legacy index.html link opens Statistik offline.');
} finally {
  releaseInstall();
  await browser.close();
  proxy.closeAllConnections();
  proxy.close();
}
