/* History and course discovery through the shared production UI. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8711/';
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 608 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  const sheet = page.locator('#courseSheet[open]');
  const picker = page.locator('#clubPicker[open]');
  const tagged = new URL(base);
  tagged.searchParams.set('utm_source', 'course-guide');
  await page.goto(tagged.href);
  const modes = page.locator('#home:visible .mode-card');
  await modes.first().waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  assert.equal(await modes.count(), 5);
  const inaccessible = await modes.evaluateAll(cards => cards.filter(card => {
    const rect = card.getBoundingClientRect();
    return rect.height < 44 || rect.left < 0 || rect.right > innerWidth + 1;
  }).map(card => card.innerText));
  assert.deepEqual(inaccessible, [], 'all five home destinations remain touch-sized and fit the width at 360×608');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator('#home .mode-map').click();
  const search = page.locator('#courseSearchInput');
  const matchingCourses = () => page.locator('.card-item:visible').evaluateAll(cards => cards.map(card => card.dataset.slug));
  await search.fill('Bro Hof');
  const broHof = page.locator('.card-item[data-club-id="bro-hof"] .card');
  assert.equal(await page.locator('.card-item:visible').count(), 1, 'Bro Hof appears once in the catalogue');
  await broHof.click();
  await picker.waitFor();
  assert.deepEqual((await picker.locator('[data-layout]').evaluateAll(buttons => buttons.map(b => b.dataset.layout))).sort(),
    ['bro-hof-castle', 'bro-hof-stadium'], 'both published layouts belong to the same club');
  await picker.locator('[data-layout="bro-hof-stadium"]').click();
  await sheet.waitFor();
  assert.match(page.url(), /#karta\/bro-hof-stadium(?:\?|$)/);
  await page.goBack();
  await picker.waitFor();
  await page.goBack();
  await picker.waitFor({ state: 'hidden' });
  assert.equal(await search.inputValue(), 'Bro Hof');
  await search.fill('Castle');
  await broHof.click();
  await sheet.waitFor();
  assert.match(page.url(), /#karta\/bro-hof-castle(?:\?|$)/, 'an unambiguous layout search skips the club picker');
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await search.inputValue(), 'Castle');
  await search.fill('ornskoldsvik');
  const cityMatches = await matchingCourses();
  assert.ok(cityMatches.includes('puttom') && cityMatches.includes('veckefjarden'));
  await search.fill('  ÖRNSKÖLDSVIK  ');
  await page.goBack();
  await page.locator('#home:visible').waitFor();
  await page.goForward();
  await page.locator('#chooser:visible').waitFor();
  assert.equal(await search.inputValue(), '  ÖRNSKÖLDSVIK  ');
  assert.deepEqual(await matchingCourses(), cityMatches);
  await search.fill('norrfallsviken');
  assert.deepEqual(await matchingCourses(), ['norrfallsviken']);
  await page.locator('#courseSearchInput').fill('Upsala');
  await page.goBack();
  await page.locator('#home:visible').waitFor();
  await page.goForward();
  await page.locator('#chooser:visible').waitFor();
  assert.equal(await page.locator('#courseSearchInput').inputValue(), 'Upsala');
  assert.equal(await page.locator('.card-item:visible').count(), 1);
  await page.locator('#viewMapBtn').click();
  await page.locator('.golf-map-pin').first().waitFor();
  assert.equal(await page.locator('.golf-map-pin').count(), 1);
  await page.locator('.golf-map-pin').first().click();
  await picker.waitFor();
  assert.match(page.url(), /#karta\/klubb\/upsala$/);
  await picker.locator('[data-layout="upsala-mellanbanan"]').click();
  await sheet.waitFor();
  assert.ok(page.url().includes('#karta/upsala-mellanbanan'));
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#courseSearchInput').inputValue(), 'Upsala');
  await picker.waitFor();
  assert.equal(await picker.locator(':focus').getAttribute('data-layout'), 'upsala-mellanbanan', 'Back restores the selected layout');
  await page.goForward();
  await sheet.waitFor();
  await page.reload();
  await sheet.waitFor();
  await sheet.locator('[data-close]').click();
  await picker.waitFor();
  await page.goBack();
  await picker.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#viewMapBtn').getAttribute('aria-pressed'), 'true');
  await page.locator('#viewGridBtn').click();
  const active = { version: 1, startedAt: '2026-05-12', begunAt: Date.now(), playingHole: 3, scores: { 2: { strokes: 4, putts: 2 } } };
  await page.evaluate(round => {
    localStorage.setItem('banvy-map-round-v1:upsala', JSON.stringify(round));
    localStorage.setItem('banvy-map-tee-v1:upsala', '0');
    localStorage.setItem('banvy-map-quality-v1', '3');
  }, active);
  await page.locator('.card[data-slug="upsala"]').click();
  await picker.locator('[data-layout="upsala"]').click();
  await sheet.waitFor();
  const tee = sheet.locator('input[name="cs-tee"]').nth(1);
  await tee.check({ force: true });
  await sheet.locator('#csGuideTitle').click();
  await sheet.locator('[data-guide-preview="7"]').waitFor({ state: 'attached' });
  const destination = page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).searchParams.get('bana') === 'upsala');
  await sheet.locator('[data-guide-preview="7"]').click();
  const query = new URL((await destination).url()).searchParams;
  assert.equal(query.get('hal'), '7');
  assert.equal(query.get('tee'), '2');
  assert.equal(query.get('runda'), 'visa');
  await page.waitForFunction(() => globalThis.V3DMap?.state.guidance, undefined, { timeout: 60000 });
  const inspectPreview = () => page.evaluate(() => ({
    hole: V3DMap.state.hole, tee: V3DMap.state.tee, playing: V3DMap.state.playing,
    storedTee: localStorage.getItem('banvy-map-tee-v1:upsala'),
    round: JSON.parse(localStorage.getItem('banvy-map-round-v1:upsala')),
    gps: document.querySelector('[data-gps]').getAttribute('aria-pressed'),
  }));
  const expected = { hole: 7, tee: 1, playing: 3, storedTee: '0', round: active, gps: 'false' };
  assert.deepEqual(await inspectPreview(), expected);
  await page.reload();
  await page.waitForFunction(() => globalThis.V3DMap?.state.guidance, undefined, { timeout: 60000 });
  assert.deepEqual(await inspectPreview(), expected);
  await page.goBack();
  await sheet.waitFor();
  assert.equal(await sheet.locator('input[name="cs-tee"]:checked').inputValue(), '1');
  await page.goForward();
  await page.waitForFunction(() => globalThis.V3DMap?.state.guidance, undefined, { timeout: 60000 });
  assert.deepEqual(await inspectPreview(), expected);
  const viewerURL = page.url();
  await page.locator('[data-menu]').click();
  await page.locator('[data-menu-pane="runda"] a[href$="#statistik"]').first().click();
  await page.locator('#stats:visible').waitFor();
  await page.goBack();
  await page.waitForFunction(() => globalThis.V3DMap?.state.guidance, undefined, { timeout: 60000 });
  assert.equal(page.url(), viewerURL);
  await page.goForward();
  await page.locator('#stats:visible [data-back]').click();
  await page.waitForFunction(() => globalThis.V3DMap?.state.guidance, undefined, { timeout: 60000 });
  assert.equal(page.url(), viewerURL, 'Tillbaka and native Back both return to the course that opened Statistics');
  assert.deepEqual(await inspectPreview(), expected);

  await page.goto(base);
  await page.locator('#home .mode-settings').click();
  await page.locator('[data-bag-edit]').click();
  await page.locator('#bagDialog[open]').waitFor();
  const carry = page.locator('.bag-distance:not(:disabled)').first();
  await carry.fill('199');
  await page.reload();
  await page.locator('#bagDialog[open]').waitFor();
  assert.equal(await carry.inputValue(), '199');
  await page.goBack();
  await page.locator('#bagDialog[open]').waitFor({ state: 'hidden' });
  assert.match(page.url(), /#installningar$/);
  await page.goForward();
  await page.locator('#bagDialog[open]').waitFor();
  assert.equal(await carry.inputValue(), '199');
  await page.goBack();
  await page.locator('#bagDialog[open]').waitFor({ state: 'hidden' });
  await page.goBack();
  await page.locator('#home:visible').waitFor();
  await page.goForward();
  await page.locator('#settings:visible').waitFor();
  await context.close();

  const nearby = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', permissions: ['geolocation'], geolocation: { latitude: 59.8415, longitude: 17.4955 }, serviceWorkers: 'block' });
  const local = await nearby.newPage();
  await local.goto(base);
  await local.locator('[data-near]').click();
  await local.locator('#chooser:visible').waitFor();
  const localPicker = local.locator('#clubPicker[open]');
  await localPicker.waitFor();
  assert.match(local.url(), /#karta\/klubb\/upsala$/);
  assert.equal(await localPicker.locator('[data-layout]').count(), 2);
  await localPicker.locator('[data-layout="upsala-mellanbanan"]').click();
  await local.locator('#courseSheet[open]').waitFor();
  assert.match(local.url(), /#karta\/upsala-mellanbanan(?:\?|$)/);
  await nearby.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const wide = await desktop.newPage();
  for (const mode of ['3d', 'spela']) {
    await wide.goto(base + '#' + mode + '/klubb/bro-hof');
    await wide.locator('#clubPicker[open] [data-layout="bro-hof-castle"]').click();
    const selected = wide.locator('#courseSheet[open]');
    await selected.waitFor();
    assert.equal(new URL(wide.url()).hash.split('?')[0], '#' + mode + '/bro-hof-castle');
    assert.equal(await selected.locator('[name="cs-mode"]:checked').inputValue(), mode === '3d' ? 'detailed' : 'play');
  }
  await wide.goto(base);
  await wide.locator('#home .mode-stats').click();
  await wide.locator('#stats [data-play]').click();
  await wide.locator('#chooser:visible').waitFor();
  await wide.goBack();
  await wide.locator('#stats:visible').waitFor();
  await wide.goForward();
  await wide.locator('#chooserBack').click();
  await wide.locator('#home:visible').waitFor();
  await desktop.close();

  const cold = await browser.newContext({ serviceWorkers: 'block' });
  const offline = await cold.newPage();
  let available = false;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await offline.route('**/courses/index.json', async route => {
    if (available) return route.continue();
    await pending;
    return route.fulfill({ status: 503, body: '' });
  });
  await offline.goto(base, { waitUntil: 'domcontentloaded' });
  await offline.locator('#home:visible .mode-stats').click({ timeout: 5000 });
  await offline.locator('#stats:visible').waitFor({ timeout: 5000 });
  release();
  await offline.locator('.hub-catalogue-error button').waitFor();
  await offline.goto(base + '#installningar');
  await offline.locator('[data-bag-edit]').click();
  await offline.locator('#bagDialog[open]').waitFor();
  await offline.locator('#bagCloseBtn').click();
  available = true;
  await offline.locator('.hub-catalogue-error:visible button').click();
  await offline.locator('.hub-ready').waitFor();
  await offline.goto(base + '#karta');
  await offline.locator('.card-item:visible').first().waitFor();
  const { courses } = await (await fetch(new URL('courses/index.json', base))).json();
  const clubs = new Set(courses.map(course => course.club));
  assert.equal(await offline.locator('.card-item:visible').count(), clubs.size, 'every published club is listed after recovery');
  for (const club of clubs) {
    const layouts = courses.filter(course => course.club === club);
    const card = offline.locator(`.card-item[data-slug="${layouts[0].slug}"] .card`);
    await card.click();
    if (layouts.length === 1) {
      await offline.locator('#courseSheet[open]').waitFor();
      assert.equal(new URL(offline.url()).hash.split('?')[0], '#karta/' + layouts[0].slug);
    } else {
      const options = offline.locator('#clubPicker[open] [data-layout]');
      await options.first().waitFor();
      assert.deepEqual((await options.evaluateAll(buttons => buttons.map(b => b.dataset.layout))).sort(),
        layouts.map(course => course.slug).sort());
    }
    await offline.goBack();
    await offline.locator('dialog[open]').waitFor({ state: 'hidden' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS · searchable layouts, restorable setup, exact guide preview, bag draft and catalogue recovery');
} finally { await browser.close(); }
