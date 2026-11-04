#!/usr/bin/env node
/* The map mode as it is used on a course: walking with GPS, measuring a shot,
 * standing idle, losing the graphics context and playing with no signal.
 *
 * pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/check-map-field.mjs [--url http://localhost:8620/] [--slug veckefjarden]
 *
 * Fails on any broken expectation or console error. Screenshots go to
 * tools/goldens/map/field/ (ignored). */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = flag('url', 'http://localhost:8620/'), SLUG = flag('slug', 'veckefjarden');
const OUT = path.resolve('tools/goldens/map/field');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const settled = page => page.waitForFunction(() => {
  const s = V3DMap.stats();
  return s.frames > 0 && s.busy === 0 && !V3DMap.state.flight && !V3DMap.state.opening;
}, null, { timeout: 60000, polling: 100 });
const note = async (page, label) => {
  if (args.includes('--trace')) console.log('  ' + label, JSON.stringify(await page.evaluate(() => {
    const c = V3DMap.camera.state, p = V3DMap.state.player;
    return { x: c.x, z: c.z, d: c.distance, patches: V3DMap.stats().patches, flight: Boolean(V3DMap.state.flight), mode: V3DMap.state.mode, player: p?.point, on: p?.onCourse };
  })));
};
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const problems = [];
page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
page.on('pageerror', error => problems.push(error.message));
const refused = [];
page.on('requestfailed', request => refused.push(request.url()));

await page.goto(`${BASE}?bana=${SLUG}&karta=1&hal=3`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.V3DMap);
await settled(page);
await page.waitForTimeout(800);

/* ---- the engine stays out of it ---- */
const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ name: entry.name, bytes: entry.encodedBodySize })));
const scripts = loaded.filter(entry => /\.js(\?|$)/.test(entry.name));
expect(!scripts.some(entry => /three[.-]|ghibli|v2-terrain/.test(entry.name)), `no 3D engine loaded (${scripts.length} scripts)`);

/* ---- idle: nothing draws ---- */
const framesBefore = (await page.evaluate(() => V3DMap.stats())).frames;
await page.waitForTimeout(2500);
const framesAfter = (await page.evaluate(() => V3DMap.stats())).frames;
expect(framesAfter === framesBefore, `an idle map draws no frames (${framesAfter - framesBefore} in 2.5 s)`);

/* ---- walking: a fix down the hole, from the tee toward the green ---- */
const walk = await page.evaluate(() => {
  const { course, state } = V3DMap;
  const hole = course.holes[state.hole - 1];
  return { tee: hole.line[0], green: hole.green.c, geo: course.geo };
});
const toLatLon = async (share, side = 0) => page.evaluate(([from, to, t, offset]) => {
  /* Back through the same frame the map reads a fix with, by search: there is no
     inverse in the app, and a fix only has to land on the spot. */
  const { course } = V3DMap;
  const x = from[0] + (to[0] - from[0]) * t + offset, z = from[1] + (to[1] - from[1]) * t;
  const { origin, mPerLon } = course.geo;
  let lat = origin.lat, lon = origin.lon;
  for (let i = 0; i < 40; i++) {
    const at = V3DMap.worldOf(lat, lon);
    lon += (x - at[0]) / mPerLon;
    lat -= (z - at[1]) / 111320;
  }
  return [lat, lon];
}, [walk.tee, walk.green, share, side]);

const expected = async share => page.evaluate(([from, to, t]) => {
  const x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t;
  return Math.hypot(to[0] - x, to[1] - z);
}, [walk.tee, walk.green, share]);

const fixAt = async share => {
  const [lat, lon] = await toLatLon(share);
  await page.evaluate(([a, b]) => V3DMap.fix(a, b, 5), [lat, lon]);
  await settled(page);
};
const midNumber = () => page.evaluate(() => Number(document.querySelector('[data-mid-number]').textContent));

await note(page, 'before fix');
await fixAt(0.25);
await note(page, 'fix 1');
const quarter = await midNumber(), wantQuarter = await expected(0.25);
expect(Math.abs(quarter - wantQuarter) <= 1, `distance to the green follows the fix (${quarter} m, expected ${wantQuarter.toFixed(1)} m)`);
await fixAt(0.75);
await note(page, 'fix 2');
const late = await midNumber(), wantLate = await expected(0.75);
expect(Math.abs(late - wantLate) <= 1, `and keeps following it (${late} m, expected ${wantLate.toFixed(1)} m)`);
expect(late < quarter, 'the number falls as the player walks to the green');
expect((await page.textContent('[data-from]')).includes('dig'), 'distances are from the player');
await shot(page, 'gps');

/* ---- measuring: tap the ground ---- */
const box = page.locator('.map-marks');
await box.tap({ position: { x: 160, y: 430 } });
await page.waitForTimeout(500);
const reading = await page.textContent('[data-reading]');
expect(/\d+ m/.test(reading) && /kvar/.test(reading), `a tap reads the shot: ${reading}`);
await note(page, 'measured');
await shot(page, 'measure');

/* ---- the next hole, the whole course ---- */
const hole = await page.evaluate(() => V3DMap.state.hole);
await page.click('[data-next]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === hole + 1, 'the next hole opens');
expect(await page.evaluate(() => Number.isFinite(V3DMap.camera.state.x) && V3DMap.stats().patches < 120), 'the camera frames it from close in on the last green');
await note(page, 'next hole');
await page.click('[data-overview]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.mode) === 'course', 'the overview opens');
await note(page, 'overview');
await shot(page, 'overview');
await note(page, 'overview shot');

/* ---- the light ---- */
const lightState = () => page.evaluate(() => ({ key: V3DMap.state.lightKey, light: V3DMap.state.light.key, sun: V3DMap.state.light.sun, autumn: V3DMap.state.light.autumn, pressed: document.querySelector('[data-now]').getAttribute('aria-pressed') }));
await page.click('[data-light]');
expect(await page.isVisible('[data-light-sheet]'), 'Ljus opens its picker');
expect(await page.locator('[data-lights] button').count() === 9, 'with the simulator\'s nine lights');
await page.click('[data-lights] [data-key="host"]');
await page.waitForTimeout(250);
const autumn = await lightState();
expect(autumn.key === 'host' && autumn.autumn === 1, 'Höst turns the leaves');
await page.click('[data-close]');
await page.click('[data-now]');
await page.waitForTimeout(250);
const sunNow = await lightState();
expect(sunNow.key === 'nu' && sunNow.pressed === 'true', `Nu takes the sun of this moment ${JSON.stringify(sunNow.sun.map(n => +n.toFixed(2)))}`);
await page.click('[data-now]');
await page.waitForTimeout(250);
expect((await lightState()).pressed === 'false', 'and lets it go again');
await page.click('[data-menu]');
expect(await page.isVisible('[data-menu-sheet]'), 'Meny opens');
expect(await page.locator('[data-holes] button').count() === await page.evaluate(() => V3DMap.course.holes.length), 'with every hole in it');
await page.click('[data-menu]');
const stillDrawing = await page.evaluate(() => V3DMap.stats().frames);
await page.waitForTimeout(1500);
expect((await page.evaluate(() => V3DMap.stats().frames)) === stillDrawing, 'a light costs nothing while nothing moves');

/* ---- a lost graphics context comes back ---- */
await page.evaluate(() => {
  const gl = document.querySelector('.map-ground').getContext('webgl2');
  const loser = gl.getExtension('WEBGL_lose_context');
  globalThis.mapLoser = loser;
  loser.loseContext();
});
await page.waitForTimeout(300);
await note(page, 'lost');
await page.evaluate(() => globalThis.mapLoser.restoreContext());
await page.waitForTimeout(500);
await settled(page);
await page.evaluate(() => V3DMap.invalidate());
await page.waitForTimeout(600);
await note(page, 'restored');
const restored = await page.evaluate(() => V3DMap.stats());
expect(restored.patches > 0 && restored.patches < 120, `the map redraws after a lost context (${restored.patches} patches)`);
const view = restored.camera;
expect(['x', 'y', 'z', 'distance', 'bearing', 'tilt'].every(key => Number.isFinite(view[key])), `the camera survives it ${JSON.stringify(view)}`);

/* ---- no signal ---- */
await page.click('[data-overview]');
await settled(page);
await page.click('[data-menu]');
const saved = page.waitForFunction(() => document.querySelector('[data-download]').textContent === 'Sparad', null, { timeout: 120000 });
await page.click('[data-download]');
await saved;
const held = await page.evaluate(async () => (await (await caches.open('banvy-map-offline-v1')).keys()).length);
expect(held > 20, `the course is saved (${held} files)`);
const worker = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker?.ready;
  return Boolean(registration?.active);
});
if (worker) {
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.goto(`${BASE}?bana=${SLUG}&karta=1&hal=9`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.V3DMap, null, { timeout: 30000 });
  await settled(page);
  const offline = await page.evaluate(() => V3DMap.stats());
  expect(offline.failures === 0 && offline.metreTiles > 0, `a saved course opens with no signal, on 1 m tiles (${offline.metreTiles} tiles, ${offline.failures} failures)`);
  await shot(page, 'offline');
  await context.setOffline(false);
} else console.log('skip offline check: no service worker on this server');

/* ---- what a course link opens ---- */
const isMap = target => target.evaluate(() => document.body.classList.contains('course-map'));
const phone = await context.newPage();
await phone.goto(`${BASE}?bana=${SLUG}`, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || Boolean(globalThis.V3D), null, { timeout: 60000 });
expect(await isMap(phone), 'a plain course link opens the map on a phone');
await phone.waitForSelector('[data-full][href]', { state: 'attached', timeout: 60000 });
const detailed = new URL(await phone.getAttribute('[data-full]', 'href'), BASE).href;
expect(detailed.includes(`bana=${SLUG}`) && detailed.includes('karta=0'), `the 3D button says so: ${detailed}`);
await phone.goto(detailed, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(phone)) && await phone.evaluate(() => Boolean(globalThis.V3D)), 'the 3D button opens the detailed course on a phone, and stays there');
await phone.goto(`${BASE}?bana=${SLUG}&det=1&gl=1`, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(phone)), 'a link that asks for the player still gets it on a phone');
await phone.goto(BASE, { waitUntil: 'domcontentloaded' });
await phone.waitForSelector('.card-map', { timeout: 60000, state: 'attached' });
expect((await phone.textContent('.card-map')) === '3D', 'the chooser offers a phone the detailed course');
await phone.close();
const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const desktop = await desktopContext.newPage();
await desktop.goto(`${BASE}?bana=${SLUG}`, { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(desktop)), 'a computer still opens the detailed course');
await desktop.goto(BASE, { waitUntil: 'domcontentloaded' });
await desktop.waitForSelector('.card-map', { timeout: 60000, state: 'attached' });
expect((await desktop.textContent('.card-map')) === 'Karta', 'and its chooser offers the map');
await desktopContext.close();

console.log(refused.length ? `requests refused: ${[...new Set(refused)].slice(0, 8).join(' ')}` : 'no requests refused');
/* The service worker's own loader is not in its precache; by then the worker is
   running, so this one refusal offline changes nothing. Any other still fails. */
const harmless = refused.length > 0 && refused.every(url => url.endsWith('/registerSW.js'));
if (harmless) problems.splice(0, problems.length, ...problems.filter(text => !text.includes('ERR_INTERNET_DISCONNECTED')));
expect(!problems.length, `no console errors${problems.length ? `: ${problems.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
