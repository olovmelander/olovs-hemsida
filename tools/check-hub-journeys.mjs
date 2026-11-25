/* Exercise the shared production UI. Pass [baseUrl] [--setup-only] to run the
   chooser header, club search, setup, scorecard recovery and cached-layout checks alone. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = process.argv.slice(2).find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:8711/';

async function checkChooserHeader(browser) {
  for (const [width, mode] of [[360, '3d'], [320, 'karta'], [390, 'spela'], [1366, '3d']]) {
    const phone = width < 600;
    const page = await browser.newPage({
      viewport: { width, height: phone ? 740 : 768 }, hasTouch: phone, isMobile: phone,
      reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    try {
      await page.goto(new URL('#' + mode, base).href);
      await page.locator('#chooser .card').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const bar = page.locator('.chooser-top-bar');
      const cards = bar.getByRole('button', { name: phone ? 'Kort' : 'Kortvy', exact: true });
      const map = bar.getByRole('button', { name: phone ? 'Karta' : 'Sverigekarta', exact: true });
      if (width === 320) {
        const fontSize = () => map.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const normal = await fontSize();
        await page.addStyleTag({ content: 'html { font-size: 200% !important }' });
        assert.ok(await fontSize() >= normal * 1.95, 'the phone view labels follow the enlarged root text size');
        const search = page.locator('#courseSearchInput');
        await search.fill('Bro Hof');
        assert.ok(await search.evaluate(input => input.scrollWidth <= input.clientWidth + 1),
          'Bro Hof fits in the enlarged search field without horizontal scrolling');
        await search.fill('');
        const modes = page.locator('#chooserModeToggle');
        await modes.tap();
        const modeNames = page.locator('#chooserModes [role=radio] b');
        assert.equal(await modeNames.count(), 3);
        assert.ok(await modeNames.evaluateAll(labels => labels.every(label => {
          const bounds = label.closest('button').getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          const text = range.getBoundingClientRect();
          return text.width > 0 && text.left >= bounds.left && text.right <= bounds.right;
        })), 'each enlarged mode name fits inside its own button');
        await modes.tap();
      }
      const issues = await bar.evaluate((header, phone) => {
        const issues = [];
        const items = [...header.querySelectorAll('.wordmark, button')].filter(el => el.getClientRects().length);
        for (const [i, item] of items.entries()) {
          const r = item.getBoundingClientRect();
          if (r.left < 0 || r.right > innerWidth || r.bottom > innerHeight) issues.push(item.id + ' outside viewport');
          if (phone && item.matches('button') && (r.width < 44 || r.height < 44)) issues.push(item.id + ' small target');
          for (const other of items.slice(i + 1)) {
            const s = other.getBoundingClientRect();
            if (r.left < s.right && s.left < r.right && r.top < s.bottom && s.top < r.bottom) {
              issues.push((item.id || item.textContent) + ' overlaps ' + other.id);
            }
          }
          for (const text of item.querySelectorAll('.cv-long, .cv-short')) {
            if (!text.getClientRects().length) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            const s = range.getBoundingClientRect();
            if (s.left < r.left || s.right > r.right || s.top < r.top || s.bottom > r.bottom) {
              issues.push(text.textContent + ' outside its button');
            }
          }
        }
        return issues;
      }, phone);
      assert.deepEqual(issues, [], width + 'px chooser header');
      for (const [active, inactive, view] of [[map, cards, '#mapViewWrap'], [cards, map, '#cardsViewWrap']]) {
        if (phone) await active.tap(); else await active.click();
        await page.locator(view).waitFor();
        assert.equal(await active.getAttribute('aria-pressed'), 'true');
        assert.equal(await inactive.getAttribute('aria-pressed'), 'false');
      }
    } finally { await page.close(); }
  }
  console.log('PASS · chooser controls and labels fit and switch views on phones, with enlarged text, and on desktop');
}

// The published Castle scorecard has four measured tees. Keep this independent
// of the setup payload so an accidental Stadium payload cannot satisfy the test.
async function checkLayoutSetup(browser) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const packs = [];
    const summaries = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/pack.bin')) packs.push(path);
      const layout = path.match(/\/courses\/([^/]+)\/scorecard-[a-f0-9]{64}\.json$/);
      if (layout) summaries.push(layout[1]);
    });
    let failCastle = true;
    await page.route('**/courses/bro-hof-castle/scorecard-*.json', route => failCastle
      ? route.fulfill({ status: 503, body: '' })
      : route.continue());
    await page.goto(new URL('#karta', base).href);
    const search = page.locator('#courseSearchInput');
    const cards = page.locator('.card-item:visible');
    const setup = page.locator('#courseSheet[open]');
    await search.fill('Stadium Castle');
    assert.equal(await cards.count(), 0, 'tokens from two sibling layouts cannot be combined');
    await search.fill('  UPPSALA 9 HAL ');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 1);
    assert.equal(await cards.first().locator('[data-layout-names]').textContent(), 'Mellanbanan',
      'place, hole count and unaccented text identify the nine-hole layout');
    await cards.first().locator('.card').click();
    await setup.waitFor();
    assert.equal(new URL(page.url()).hash.split('?')[0], '#karta/upsala-mellanbanan');
    await page.waitForFunction(() => /\d/.test(document.querySelector('#courseSheet [data-length]')?.textContent ?? ''));
    await page.goBack();
    await setup.waitFor({ state: 'hidden' });

    await search.fill('Castle Bro Hof');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 1);
    assert.equal(await cards.first().locator('[data-layout-names]').textContent(), 'The Castle Course');
    await cards.first().locator('.card').click();
    await setup.waitFor();
    assert.equal(new URL(page.url()).hash.split('?')[0], '#karta/bro-hof-castle');
    await setup.locator('#csCardTitle').click();
    const retry = setup.locator('[data-card-retry]');
    await retry.waitFor();
    failCastle = false;
    await retry.click();
    const lengths = [['Vit', '6\\s*133'], ['Gul', '5\\s*535'], ['Blå', '5\\s*023'], ['Röd', '4\\s*218']];
    for (const [name, length] of lengths) {
      const tee = setup.getByRole('radio', { name: new RegExp(name + '.*' + length + '\\s*m(?:eter)?\\b', 'i') });
      await tee.waitFor({ state: 'attached' });
      assert.equal(await tee.count(), 1, `${name} exposes its measured total in the radio's accessible name`);
    }
    const footer = await setup.locator('.cs-actions').boundingBox();
    assert.ok(footer && footer.height <= 115 && footer.y >= 0 && footer.y + footer.height <= 668,
      `GPS setup keeps the fixed controls within 115 px on a 375×667 phone (measured ${footer?.height} px)`);
    for (const [name, distance] of [['Vit', '563'], ['Röd', '386']]) {
      const tee = setup.getByRole('radio', { name: new RegExp('^' + name, 'i') });
      await tee.locator('..').click();
      assert.ok(await tee.isChecked());
      const tables = setup.locator('.cs-sc');
      assert.equal(await tables.count(), 2, 'both nines appear');
      assert.equal(await tables.first().locator('.cs-sc-len td').first().innerText(), distance, `hole 1 from the ${name} tee`);
    }
    await setup.locator('#csGuideTitle').click();
    const firstHole = setup.locator('.cs-hole[data-hole="1"]');
    assert.equal(await firstHole.locator('.cs-hole-name').innerText(), 'Ut från gården');
    assert.match(await firstHole.locator('.cs-hole-facts').innerText(), /Par 5.*386 m.*index 5/i);
    assert.equal(await setup.locator('.cs-hole[data-hole]').count(), 18);
    await setup.locator('.cs-scroll').evaluate(scroll => { scroll.scrollTop = scroll.scrollHeight; });
    const afterScroll = await setup.locator('.cs-actions').boundingBox();
    assert.ok(afterScroll && Math.abs(afterScroll.y - footer.y) < 1, 'the primary actions stay in place while reading the guide');
    assert.deepEqual(packs, [], 'browsing clubs, comparing tees and reading the guide never load full course packs');
    assert.deepEqual(summaries, ['upsala-mellanbanan', 'bro-hof-castle', 'bro-hof-castle'],
      'only selected layouts load their compact scorecard and the failed Castle request can be retried');
    console.log('PASS · per-layout search, tee distances, compact GPS setup and retryable pack-free scorecard and guide');
  } finally { await context.close(); }
}

// Simulate an upgrade from a GPS download completed before compact cards were published.
async function checkCachedLayout(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(new URL('#statistik', base).href);
    const manifest = await context.request.get(new URL('courses/index.json', base).href);
    const { courses } = await manifest.json();
    const castle = courses.find(course => course.slug === 'bro-hof-castle');
    const url = new URL(castle.packUrl, base);
    url.searchParams.set('v', castle.sha256.slice(0, 16));
    const fixture = await context.request.get(url.href);
    assert.ok(fixture.ok());
    await page.evaluate(async ({ url, bytes }) => {
      const cache = await caches.open('banvy-map-offline-v1');
      const pack = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
      await cache.put(url, new Response(pack));
    }, { url: url.href, bytes: (await fixture.body()).toString('base64') });

    const requests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pack.bin')) requests.push(request.url()); });
    await page.route('**/courses/bro-hof-castle/scorecard-*.json', route => route.abort('internetdisconnected'));
    await page.goto(new URL('#karta/bro-hof-castle', base).href);
    const setup = page.locator('#courseSheet[open]');
    await setup.getByRole('radio', { name: /Vit.*6\s*133\s*m/i }).waitFor({ state: 'attached' });
    await setup.locator('#csGuideTitle').click();
    assert.equal(await setup.locator('.cs-hole[data-hole="1"] .cs-hole-name').innerText(), 'Ut från gården');
    assert.deepEqual(requests, [], 'a downloaded layout opens its guide while the network scorecard is unavailable');
    console.log('PASS · offline setup reads the previously saved layout');
  } finally { await context.close(); }
}

/* The lobby (25 November): the start menu leads with the clubs, by Swedish name, each
   row naming its layouts in the club page's order. A row opens the club's page over the
   lobby, in the golfer's last mode or else the device's own, and Back returns to the
   lobby with that row in focus. */
async function checkLobby(browser) {
  for (const { label, options, lastMode, mode, route } of [
    { label: 'phone', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, lastMode: null, mode: 'map', route: 'karta' },
    { label: 'desktop', options: { viewport: { width: 1440, height: 900 } }, lastMode: 'play', mode: 'play', route: 'spela' },
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      if (lastMode) await context.addInitScript(value => localStorage.setItem('banvy-last-mode', value), lastMode);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      const rows = page.locator('#home .home-club');
      await rows.first().waitFor();
      const names = await rows.locator('strong').allInnerTexts();
      assert.ok(names.length > 1, `${label}: the lobby lists the clubs`);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'sv')), `${label}: by Swedish name`);
      const broHof = page.locator('#homeClub-bro-hof');
      assert.match(await broHof.locator('small').innerText(), /Stadium.*Castle/, `${label}: Bro Hof's row names both layouts, the host course first`);
      await broHof.click();
      const sheet = page.locator('#courseSheet[open]');
      await sheet.waitFor();
      assert.match(page.url(), new RegExp(`#${route}/bro-hof-stadium(?:\\?|$)`), `${label}: a club with no history opens on its host course, in ${mode}`);
      assert.equal(await sheet.locator('[name="cs-mode"]:checked').inputValue(), mode, `${label}: the club page shows the mode it opened in`);
      assert.ok(await page.locator('#home').isVisible() && !(await page.locator('#chooser').isVisible()), `${label}: the club page lies over the lobby, not the list`);
      await page.goBack();
      await sheet.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.id === 'homeClub-bro-hof');
      assert.ok(await page.locator('#home').isVisible(), `${label}: one Back returns to the lobby`);
      assert.deepEqual(errors, [], `${label}: no page errors`);
    } finally { await context.close(); }
  }
  console.log('PASS · the lobby lists the clubs by name, opens a club page over itself in the last or the device\'s mode, and Back returns to the row');
}

async function checkHubHistory(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 608 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  const sheet = page.locator('#courseSheet[open]');
  /* a club's layouts are the club page's own switch (course-sheet.js switchLayout) */
  const layoutsOn = dialog => dialog.locator('input[name="cs-layout"]').evaluateAll(inputs => inputs.map(input => input.value));
  const chooseLayout = (dialog, slug) => dialog.locator(`label.cs-layout:has(input[value="${slug}"])`).click();
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
  await sheet.waitFor();
  assert.deepEqual(await layoutsOn(sheet), ['bro-hof-stadium', 'bro-hof-castle'],
    'both published layouts belong to the same club page, the host course first');
  assert.match(page.url(), /#karta\/bro-hof-stadium(?:\?|$)/, 'a club with no history opens on its host course');
  await chooseLayout(sheet, 'bro-hof-castle');
  await page.waitForURL(/#karta\/bro-hof-castle(?:\?|$)/);
  assert.equal(await sheet.locator('#csTitle').textContent(), 'The Castle Course', 'the club page switches layout in place');
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await search.inputValue(), 'Bro Hof', 'one Back leaves the club page for the list');
  await search.fill('Castle');
  await broHof.click();
  await sheet.waitFor();
  assert.match(page.url(), /#karta\/bro-hof-castle(?:\?|$)/, 'an unambiguous layout search opens that layout');
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
  await sheet.waitFor();
  assert.match(page.url(), /#karta\/upsala(?:\?|$)/, 'the pin opens the club page on its host course');
  await chooseLayout(sheet, 'upsala-mellanbanan');
  await page.waitForURL(/#karta\/upsala-mellanbanan(?:\?|$)/);
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#courseSearchInput').inputValue(), 'Upsala');
  await page.goForward();
  await sheet.waitFor();
  assert.equal(await sheet.locator('input[name="cs-layout"]:checked').inputValue(), 'upsala-mellanbanan', 'Forward returns to the layout chosen on the club page');
  await page.reload();
  await sheet.waitFor();
  assert.equal(await sheet.locator('input[name="cs-layout"]:checked').inputValue(), 'upsala-mellanbanan', 'and so does a reload');
  await sheet.locator('[data-close]').click();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#viewMapBtn').getAttribute('aria-pressed'), 'true');
  await page.locator('#viewGridBtn').click();
  const active = { version: 1, startedAt: '2026-05-12', begunAt: Date.now(), playingHole: 3, scores: { 2: { strokes: 4, putts: 2 } } };
  await page.evaluate(round => {
    localStorage.setItem('banvy-map-round-v1:upsala', JSON.stringify(round));
    localStorage.setItem('banvy-map-tee-v1:upsala', '0');
    localStorage.setItem('banvy-map-quality-v1', '3');
  }, active);
  await page.locator('.card[data-slug="upsala"]').click();
  await sheet.waitFor();
  assert.match(page.url(), /#karta\/upsala(?:\?|$)/, 'a club opens on the layout with its round under way, over the one last chosen');
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
  const localSheet = local.locator('#courseSheet[open]');
  await localSheet.waitFor();
  assert.match(local.url(), /#karta\/upsala(?:\?|$)/, 'Nära dig opens the club page on its host course');
  assert.equal((await layoutsOn(localSheet)).length, 2);
  await chooseLayout(localSheet, 'upsala-mellanbanan');
  await local.waitForURL(/#karta\/upsala-mellanbanan(?:\?|$)/);
  await nearby.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const wide = await desktop.newPage();
  for (const mode of ['3d', 'spela']) {
    await wide.goto(base + '#' + mode + '/klubb/bro-hof');
    const selected = wide.locator('#courseSheet[open]');
    await selected.waitFor();
    await chooseLayout(selected, 'bro-hof-castle');
    await wide.waitForURL(new RegExp('#' + mode + '/bro-hof-castle(?:\\?|$)'));
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
      const clubPage = offline.locator('#courseSheet[open]');
      await clubPage.waitFor();
      assert.deepEqual((await layoutsOn(clubPage)).sort(), layouts.map(course => course.slug).sort());
    }
    await offline.goBack();
    await offline.locator('dialog[open]').waitFor({ state: 'hidden' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS · searchable layouts, restorable setup, exact guide preview, bag draft and catalogue recovery');
}

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  await checkChooserHeader(browser);
  await checkLayoutSetup(browser);
  await checkCachedLayout(browser);
  await checkLobby(browser);
  if (!process.argv.includes('--setup-only')) await checkHubHistory(browser);
} finally { await browser.close(); }
