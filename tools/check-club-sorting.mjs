/* Club sorting through the public chooser. Pass a local Worker or Vite URL. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { COURSE_LOCATIONS } from '../apps/golf/src/shell/course-places.mjs';

const url = new URL('#karta', process.argv[2] || 'http://127.0.0.1:5173/');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 800 } };
const atAngso = { latitude: COURSE_LOCATIONS.angso.lat, longitude: COURSE_LOCATIONS.angso.lng };
const chooser = page => page.locator('#chooserSort');
const shown = page => page.locator('#coursesCardList > .card-item:visible');
const clubIds = page => shown(page).evaluateAll(rows => rows.map(row => row.dataset.clubId));
const context = options => browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block', ...options });

async function checkNameOrder(page) {
  const names = await shown(page).locator('.club-name').allTextContents();
  assert.ok(names.length > 2, 'the unfiltered club list is populated');
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'sv')));
  assert.equal(new Set(names).size, names.length);
  const ids = await clubIds(page);
  assert.equal(ids[0], 'bro-hof');
  assert.ok(ids.indexOf('angso') >= 0 && ids.indexOf('angso') < ids.indexOf('puttom'), 'Ängsö precedes Örnsköldsviks');
}

async function checkLayoutOrder(page, club, expected) {
  await page.locator(`.card[data-club-id="${club}"]`).click();
  const picker = page.locator('#clubPicker[open]');
  await picker.waitFor();
  assert.deepEqual(await picker.locator('[data-layout]').evaluateAll(rows => rows.map(row => row.dataset.layout)), expected);
  await picker.locator('[data-close]').click();
  await picker.waitFor({ state: 'hidden' });
}

async function openChooser(page) {
  if (page.url() === url.href) await page.reload();
  else await page.goto(url.href);
  await chooser(page).waitFor();
  await shown(page).first().waitFor();
}

try {
  for (const device of [phone, desktop]) {
    const ctx = await context({ ...device, permissions: ['geolocation'], geolocation: atAngso });
    await ctx.addInitScript(() => {
      globalThis.gpsRequests = 0;
      const getPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => { globalThis.gpsRequests++; return getPosition(...args); };
    });
    const page = await ctx.newPage();
    await openChooser(page);
    await page.waitForFunction(() => document.querySelector('#coursesCardList .card-item')?.dataset.clubId === 'angso');
    assert.equal(await chooser(page).inputValue(), 'distance');
    const distanceOrder = await clubIds(page);
    if (device === desktop) await checkLayoutOrder(page, 'bro-hof', ['bro-hof-castle', 'bro-hof-stadium']);
    assert.equal(new Set(distanceOrder).size, distanceOrder.length, 'each clubhouse occurs once in distance order');
    await page.locator('#courseSearchInput').fill('västerås');
    assert.deepEqual(await clubIds(page), ['angso', 'tortuna']);
    await chooser(page).selectOption('name');
    assert.deepEqual(await clubIds(page), ['tortuna', 'angso']);
    await page.locator('#courseSearchInput').fill('');
    await checkNameOrder(page);
    await openChooser(page);
    await checkNameOrder(page);
    assert.equal(await chooser(page).inputValue(), 'name');
    assert.equal(await page.evaluate(() => globalThis.gpsRequests), 0, 'explicit name order avoids GPS even with permission');
    await chooser(page).selectOption('distance');
    await page.waitForFunction(() => document.querySelector('#coursesCardList .card-item')?.dataset.clubId === 'angso');
    assert.deepEqual(await clubIds(page), distanceOrder, 'manual distance selection restores the complete proximity order');
    await ctx.close();
  }
  console.log('Phone and desktop use a granted position, retain the selected order during search and remember an explicit name preference.');

  // Keep the platform callbacks under test control so a late reply can be delivered
  // after a new selection, without depending on a prompt, timer or machine speed.
  const ctx = await context(phone);
  await ctx.addInitScript(() => {
    localStorage.setItem('banvy-last-course', 'upsala');
    globalThis.gpsQueue = [];
    navigator.geolocation.getCurrentPosition = (ok, fail) => globalThis.gpsQueue.push({ ok, fail });
  });
  const page = await ctx.newPage();
  await openChooser(page);
  await checkNameOrder(page);
  assert.equal(await chooser(page).inputValue(), 'name');
  assert.equal(await page.evaluate(() => globalThis.gpsQueue.length), 0, 'first visit does not request location');
  await checkLayoutOrder(page, 'upsala', ['upsala-mellanbanan', 'upsala']);
  await chooser(page).selectOption('recent');
  const recentOrder = await clubIds(page);
  assert.equal(recentOrder[0], 'upsala', 'the last opened layout promotes its club');
  await checkLayoutOrder(page, 'upsala', ['upsala', 'upsala-mellanbanan']);
  await openChooser(page);
  assert.equal(await chooser(page).inputValue(), 'recent');
  assert.deepEqual(await clubIds(page), recentOrder);
  const retry = page.locator('#chooserSortRetry');
  await chooser(page).selectOption('distance');
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(() => globalThis.gpsQueue.shift().fail({ code: 2, message: 'Position unavailable' }));
  await retry.waitFor();
  assert.equal(await chooser(page).inputValue(), 'recent');
  assert.deepEqual(await clubIds(page), recentOrder, 'a failed reading preserves the usable order');
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-club-sort-v1')), 'recent');
  assert.ok((await page.locator('#chooserSortStatus').innerText()).trim(), 'the failed request is explained');
  await retry.click();
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await chooser(page).selectOption('name');
  await page.evaluate(coords => globalThis.gpsQueue.shift().ok({ coords }), atAngso);
  await checkNameOrder(page);
  assert.equal(await chooser(page).inputValue(), 'name', 'an old location response cannot replace a newer choice');
  await chooser(page).selectOption('distance');
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(() => globalThis.gpsQueue.shift().fail({ code: 1, message: 'Permission denied' }));
  await retry.waitFor();
  await retry.click();
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(coords => globalThis.gpsQueue.shift().ok({ coords }), atAngso);
  await retry.waitFor({ state: 'hidden' });
  assert.equal(await chooser(page).inputValue(), 'distance');
  assert.equal((await clubIds(page))[0], 'angso');
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-club-sort-v1')), 'distance');
  await ctx.close();

  const unavailable = await context(desktop);
  await unavailable.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: undefined }));
  const noGps = await unavailable.newPage();
  await openChooser(noGps);
  await chooser(noGps).selectOption('distance');
  await noGps.locator('#chooserSortRetry').waitFor();
  assert.equal(await chooser(noGps).inputValue(), 'name');
  await checkNameOrder(noGps);
  await unavailable.close();
  console.log('Recent layout, missing GPS, permission denial, retry and a superseded position all preserve the chosen club order.');
} finally {
  await browser.close();
}
