/* Club sorting through the unified Lobby filter popover. Pass a local Worker or Vite URL. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { COURSE_LOCATIONS } from '../apps/golf/src/shell/course-places.mjs';

const url = new URL('', process.argv[2] || 'http://127.0.0.1:5173/');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 800 } };
const atAngso = { latitude: COURSE_LOCATIONS.angso.lat, longitude: COURSE_LOCATIONS.angso.lng };
const shown = page => page.locator('#homeClubList > .home-club-card:visible');
const clubIds = page => shown(page).evaluateAll(rows => rows.map(row => row.querySelector('.home-club').dataset.club));
const context = options => browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block', ...options });

async function ensureFilterOpen(page) {
  const pop = page.locator('#lobbyFilterPop');
  if (await pop.isHidden()) {
    await page.locator('[data-filter-trigger]:visible, #lobbyFilterBtn:visible').first().click();
    await pop.waitFor();
  }
  return pop;
}

async function closeFilter(page) {
  const pop = page.locator('#lobbyFilterPop');
  if (await pop.isVisible()) {
    await pop.locator('[data-filter-done]').click();
    await pop.waitFor({ state: 'hidden' });
  }
}

async function selectSort(page, order) {
  const pop = await ensureFilterOpen(page);
  await pop.locator(`[data-sort="${order}"]`).click();
}

async function currentSort(page) {
  return page.locator('#lobbyFilterPop [data-sort][aria-checked="true"]').getAttribute('data-sort');
}

async function checkNameOrder(page) {
  const names = await shown(page).locator('.home-club strong').allTextContents();
  assert.ok(names.length > 2, 'the unfiltered club list is populated');
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'sv')));
  assert.equal(new Set(names).size, names.length);
  const ids = await clubIds(page);
  assert.equal(ids[0], 'bro-hof');
  assert.ok(ids.indexOf('angso') >= 0 && ids.indexOf('angso') < ids.indexOf('puttom'), 'Ängsö precedes Örnsköldsviks');
}

/* A club page lists its layouts host course first, whatever the sort, and opens on
   the layout last opened there (course-clubs.mjs clubLayouts and preferredLayout). */
async function checkClubPage(page, club, order, selected) {
  await closeFilter(page);
  await page.locator(`#homeClub-${club}`).click();
  const clubPage = page.locator('#courseSheet[open]');
  await clubPage.waitFor();
  assert.deepEqual(await clubPage.locator('input[name="cs-layout"]').evaluateAll(inputs => inputs.map(input => input.value)), order);
  assert.equal(await clubPage.locator('input[name="cs-layout"]:checked').inputValue(), selected);
  await clubPage.locator('[data-close]').first().click();
  await clubPage.waitFor({ state: 'hidden' });
}

async function openLobby(page) {
  if (page.url() === url.href) await page.reload();
  else await page.goto(url.href);
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
    await openLobby(page);
    await page.waitForFunction(() => document.querySelector('#homeClubList .home-club')?.dataset.club === 'angso');
    assert.equal(await currentSort(page), 'distance');
    const distanceOrder = await clubIds(page);
    if (device === desktop) await checkClubPage(page, 'bro-hof', ['bro-hof-stadium', 'bro-hof-castle'], 'bro-hof-stadium');
    assert.equal(new Set(distanceOrder).size, distanceOrder.length, 'each clubhouse occurs once in distance order');
    await page.locator('#homeClubQuery').fill('västerås');
    assert.deepEqual(await clubIds(page), ['angso', 'tortuna']);
    await selectSort(page, 'name');
    assert.deepEqual(await clubIds(page), ['tortuna', 'angso']);
    await closeFilter(page);
    await page.locator('#homeClubQuery').fill('');
    await checkNameOrder(page);
    await openLobby(page);
    await checkNameOrder(page);
    assert.equal(await currentSort(page), 'name');
    assert.equal(await page.evaluate(() => globalThis.gpsRequests), 0, 'explicit name order avoids GPS even with permission');
    await selectSort(page, 'distance');
    await page.waitForFunction(() => document.querySelector('#homeClubList .home-club')?.dataset.club === 'angso');
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
  await openLobby(page);
  await checkNameOrder(page);
  assert.equal(await currentSort(page), 'name');
  assert.equal(await page.evaluate(() => globalThis.gpsQueue.length), 0, 'first visit does not request location');
  await checkClubPage(page, 'upsala', ['upsala', 'upsala-mellanbanan'], 'upsala');
  await selectSort(page, 'recent');
  const recentOrder = await clubIds(page);
  assert.equal(recentOrder[0], 'upsala', 'the last opened layout promotes its club');
  await checkClubPage(page, 'upsala', ['upsala', 'upsala-mellanbanan'], 'upsala');
  await openLobby(page);
  assert.equal(await currentSort(page), 'recent');
  assert.deepEqual(await clubIds(page), recentOrder);
  const retry = page.locator('#lobbyFilterPop [data-sort-retry]');
  await selectSort(page, 'distance');
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(() => globalThis.gpsQueue.shift().fail({ code: 2, message: 'Position unavailable' }));
  await retry.waitFor();
  assert.equal(await currentSort(page), 'recent');
  assert.deepEqual(await clubIds(page), recentOrder, 'a failed reading preserves the usable order');
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-club-sort-v1')), 'recent');
  assert.ok((await page.locator('#lobbyFilterPop [data-sort-status]').innerText()).trim(), 'the failed request is explained');
  await retry.click();
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await selectSort(page, 'name');
  await page.evaluate(coords => globalThis.gpsQueue.shift().ok({ coords }), atAngso);
  await checkNameOrder(page);
  assert.equal(await currentSort(page), 'name', 'an old location response cannot replace a newer choice');
  await selectSort(page, 'distance');
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(() => globalThis.gpsQueue.shift().fail({ code: 1, message: 'Permission denied' }));
  await retry.waitFor();
  await retry.click();
  await page.waitForFunction(() => globalThis.gpsQueue.length === 1);
  await page.evaluate(coords => globalThis.gpsQueue.shift().ok({ coords }), atAngso);
  await retry.waitFor({ state: 'hidden' });
  assert.equal(await currentSort(page), 'distance');
  assert.equal((await clubIds(page))[0], 'angso');
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-club-sort-v1')), 'distance');
  await ctx.close();

  const unavailable = await context(desktop);
  await unavailable.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: undefined }));
  const noGps = await unavailable.newPage();
  await openLobby(noGps);
  await selectSort(noGps, 'distance');
  await noGps.locator('#lobbyFilterPop [data-sort-retry]').waitFor();
  assert.equal(await currentSort(noGps), 'name');
  await checkNameOrder(noGps);
  await unavailable.close();
  console.log('Recent layout, missing GPS, permission denial, retry and a superseded position all preserve the chosen club order.');
} finally {
  await browser.close();
}
