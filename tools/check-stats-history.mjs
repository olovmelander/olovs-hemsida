/* Phone and desktop regressions for statistics from mixed local playing history.
   node tools/check-stats-history.mjs http://127.0.0.1:5173 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { DEFAULT_BAG } from '../apps/golf/src/engine/caddie.js';
import { roundRecord, storeRounds } from '../apps/golf/src/map/map-rounds.mjs';
import { shotAim, storeHistory } from '../apps/golf/src/map/map-shots.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const { courses } = await (await fetch(base + '/courses/index.json')).json();
const [course, guest] = courses.filter(c => c.holes === 18 && c.status !== 'mapping');
const layout = { ...course, holes: Array.from({length: 18}, (_, i) => ({ n: i + 1, par: 4, index: i + 1 })) };
const bag = JSON.stringify({ version: 3, clubs: DEFAULT_BAG.map(c => c.id === 'iron-7' ? { ...c, carry: 140 } : c) });
const round = (id, count, bogeys, putts) => {
  const scores = Object.fromEntries(layout.holes.slice(0, count).map((h, i) =>
    [h.n, { strokes: 4 + (i < bogeys ? 1 : 0), putts: putts[i] ?? null }]));
  const age = id === 1 ? 120 : 5 - id;
  const day = new Date(Date.now() - age * 86400000);
  return roundRecord({ id, startedAt: day.toISOString().slice(0, 10), scores }, layout, {at: day.getTime()});
};
const rounds = [round(1, 18, 7, []), round(2, 9, 4, [2]), round(3, 1, 0, [0]), round(4, 0, 0, [])];
const shot = (id, slug, metres) => ({ course: slug, round: id, hole: 1, club: 'iron-7',
  from: [0, 0], to: [metres, 0], at: Date.now(), fromAccuracy: 3, toAccuracy: 4, outcome: 'played' });
const shots = [...Array.from({ length: 5 }, () => shot(4, course.slug, 175)), shot(5, guest.slug, 121)];
shots[0].aim = shotAim({ source: 'gps', status: 'measured', mode: 'manual', origin: [0, 0], target: [145, 0],
  reading: { plays: 149 }, recommendedClub: { id: 'iron-8' } }, { id: 'iron-7', carry: 140 });

const toggle = page => page.locator('#stats [data-filter-toggle]');
const dialog = page => page.locator('#stats [data-filter-dialog]');

async function headerLayout(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#stats');
    const top = root.querySelector('.st-top');
    const tabs = root.querySelector('.st-tabs');
    const back = root.querySelector('[data-back]');
    const filter = root.querySelector('[data-filter-toggle]');
    const rect = el => el.getBoundingClientRect();
    const ink = document.createElement('canvas').getContext('2d');
    const alpha = el => {
      ink.clearRect(0, 0, 1, 1);
      ink.fillStyle = getComputedStyle(el).backgroundColor;
      ink.fillRect(0, 0, 1, 1);
      return ink.getImageData(0, 0, 1, 1).data[3];
    };
    const layers = [top, root.querySelector('.st-toolbar'), tabs];
    const sticky = [...root.querySelectorAll('*')].filter(el => el.getClientRects().length &&
      getComputedStyle(el).position === 'sticky' && !el.closest('table'));
    const visibleControls = [back, filter, ...tabs.querySelectorAll('button')].filter(el => el.getClientRects().length);
    const small = visibleControls.filter(el => Math.min(rect(el).width, rect(el).height) < 40)
      .map(el => el.getAttribute('aria-label') || el.textContent.trim());
    const fit = visibleControls.every(el => rect(el).left >= -1 && rect(el).right <= innerWidth + 1);
    return {
      width: root.clientWidth, height: root.clientHeight,
      scrollWidth: root.scrollWidth, top: rect(top).top, bottom: Math.max(rect(top).bottom, rect(tabs).bottom),
      navY: rect(tabs).top, topAlpha: alpha(top), tabsOpaque: top.contains(tabs) || alpha(tabs) === 255,
      extraSticky: sticky.filter(el => el !== top && el !== tabs && !top.contains(el)).map(el => el.className),
      translucent: layers.some(el => { const value = alpha(el); return value > 0 && value < 255; }),
      blur: layers.some(el => getComputedStyle(el).backdropFilter !== 'none'),
      small, fit, scroll: root.scrollTop, visible: visibleControls.length,
    };
  });
}

async function compactHeader(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => { document.querySelector('#stats').scrollTop = 400; });
  await page.waitForFunction(() => document.querySelector('#stats').scrollTop > 200);
  // The trend chart regenerates its SVG after a viewport resize.
  await page.waitForFunction(() => {
    const root = document.querySelector('#stats');
    return root.scrollWidth <= root.clientWidth + 1;
  }, null, { timeout: 3000, polling: 50 }).catch(() => {});
  const result = await headerLayout(page);
  if (result.scrollWidth > result.width + 1) {
    const overflow = await page.locator('#stats *').evaluateAll(elements => elements.filter(el =>
      el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1)
      .map(el => el.className || el.tagName).filter(name => typeof name === 'string').slice(0, 16));
    assert.fail(`${width}×${height}: page scroll width ${result.scrollWidth}px; overflow near ${overflow.join(', ')}`);
  }
  assert.equal(result.topAlpha, 255, 'scrolled header has an opaque background');
  assert.ok(result.tabsOpaque && !result.blur && !result.translucent, 'section links sit on an opaque, unblurred header');
  assert.deepEqual(result.extraSticky, [], 'no second fixed-in-place filter toolbar over the statistics');
  assert.deepEqual(result.small, [], 'back, filter and section links offer 40px touch targets');
  assert.ok(result.top <= 1 && result.bottom <= (width > height ? 64 : 104),
    `chrome extends to ${Math.round(result.bottom)}px on ${width}×${height}`);
  if (width > height) {
    assert.ok(result.fit, 'all five section links plus back and filters fit the landscape row');
    assert.ok(result.visible >= 7, 'landscape retains its back and filter controls');
  }
  console.log(`${width}×${height}: statistics header occupies ${Math.round(result.bottom)}px after scrolling`);
}

async function openFilters(page) {
  await toggle(page).tap();
  await dialog(page).waitFor();
  assert.ok(await dialog(page).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.matches(':modal') && rect.left >= -1 && rect.top >= -1 &&
      rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
  }), 'native modal fits the screen and owns interaction');
  assert.equal(await page.locator('#stats [data-course]').count(), 1, 'there is one course selection');
  const tooSmall = await dialog(page).locator('button, select, label:has(input[type="radio"])').evaluateAll(controls =>
    controls.filter(el => el.getClientRects().length && Math.min(el.offsetWidth, el.offsetHeight) < 40).map(el => el.textContent.trim()));
  assert.deepEqual(tooSmall, [], 'filter choices are touch-sized');
}

async function closeFilters(page, escape = false) {
  if (escape) await page.keyboard.press('Escape');
  else await dialog(page).locator('[data-filter-close]').tap();
  await dialog(page).waitFor({ state: 'hidden' });
  assert.ok(await toggle(page).evaluate(el => el === document.activeElement), 'dismissal returns focus to Filter');
  assert.equal(new URL(page.url()).hash, '#statistik', 'closing filters stays in statistics');
}

async function checkRoundExports(browser, phone) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' });
  try {
    await ctx.addInitScript(() => {
      window.cardWords = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (this.canvas.width === 1080 && this.canvas.height === 1350) window.cardWords.push(text);
        return fillText.call(this, text, ...args);
      };
      Object.defineProperty(navigator, 'canShare', { value: () => !window.downloadOnly });
      Object.defineProperty(navigator, 'share', { value: async ({ title, text, files }) => {
        const [file] = files;
        window.sharedRound = { title, text, name: file.name, type: file.type,
          signature: Array.from(new Uint8Array(await file.slice(0, 8).arrayBuffer())) };
      } });
    });
    const page = await ctx.newPage();
    await page.goto(base + '/#statistik');
    await page.locator('#stats [data-example]').click();
    const latest = page.locator('#stats .st-latest');
    const exampleCourse = await latest.locator('.sl-course').innerText();
    const action = latest.locator('[data-jump-round]');
    const [slug, id] = (await action.getAttribute('data-jump-round')).split('|');
    await action.click();
    await page.waitForURL(url => url.hash === `#statistik/${slug}/${id}?exempel=1`);
    await page.reload();
    const opened = page.locator(`#stats details[data-round-key="${slug}|${id}"][open]`);
    await opened.locator('[data-share-round]').click();
    await page.waitForFunction(() => window.sharedRound);
    const example = await page.evaluate(() => ({ ...window.sharedRound, words: window.cardWords }));
    assert.match(example.name, /^banvy-exempel-.*\.png$/);
    assert.equal(example.type, 'image/png');
    assert.deepEqual(example.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(example.title.includes('Exempelrunda') && example.title.includes(exampleCourse));
    assert.ok(example.text.includes('Exempelrunda') && example.text.includes(exampleCourse));
    assert.ok(example.words.includes('EXEMPELRUNDA'));
    assert.ok(exampleCourse.split(' · ').every(name => example.words.includes(name)));
    await page.evaluate(() => { window.downloadOnly = true; });
    const downloading = page.waitForEvent('download');
    await opened.locator('[data-share-round]').click();
    assert.equal((await downloading).suggestedFilename(), example.name);
    assert.equal(await page.evaluate(() => localStorage.getItem('banvy-map-rounds-v1')), null);
    await page.locator('[data-hide-example]').click();
    await page.waitForURL(url => url.hash === '#statistik');
    await page.locator('[data-example]').waitFor();

    // A legacy record may have been saved with just a club name. Its slug still identifies the layout.
    const castle = courses.find(c => c.slug === 'bro-hof-castle');
    const real = roundRecord({ id: 88, startedAt: '2026-11-10', scores: { 1: { strokes: 7, putts: 2 } } },
      { ...layout, slug: castle.slug, name: castle.club });
    const stored = storeRounds([real]);
    await page.evaluate(value => localStorage.setItem('banvy-map-rounds-v1', value), stored);
    await page.goto(base + '/#statistik/' + castle.slug + '/88');
    await page.reload();
    const realCard = page.locator('#stats details[data-round-key="bro-hof-castle|88"][open]');
    await realCard.locator('[data-share-round]').click();
    await page.waitForFunction(() => window.sharedRound);
    const personal = await page.evaluate(() => ({ ...window.sharedRound, words: window.cardWords }));
    assert.match(personal.name, /^banvy-bro-hof-slott-golf-club-the-castle-course-2026-11-10\.png$/);
    assert.equal(personal.title, castle.club + ' · The Castle Course');
    assert.ok(personal.text.includes(personal.title));
    assert.doesNotMatch(personal.name + personal.text + personal.title + personal.words.join(' '), /exempel/i);
    assert.ok([castle.club, 'The Castle Course', '7', '+3'].every(word => personal.words.includes(word)));
    assert.equal(await page.evaluate(() => localStorage.getItem('banvy-map-rounds-v1')), stored);
    console.log(`${phone ? 'Phone' : 'Desktop'} · example watermark, share text, actual PNG/download, and real Castle layout and score`);
  } finally { await ctx.close(); }
}

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: {width, height}, hasTouch: width === 390, isMobile: width === 390, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(({ r, s, b }) => {
        localStorage.setItem('banvy-map-rounds-v1', r);
        localStorage.setItem('banvy-map-shots-v1', s);
        localStorage.setItem('banvy-caddie-bag-v1', b);
      }, { r: storeRounds(rounds), s: storeHistory(shots), b: bag });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#statistik');
      const dashboard = page.locator('#stats');
      await dashboard.locator('.st-leading').waitFor();
      const latest = dashboard.locator('.st-latest');
      assert.match(await latest.innerText(), /Ingen hålscore · 5 loggade slag/);
      for (const selector of ['.sl-course', '.st-leading .st-insight h3']) {
        const rect = await dashboard.locator(selector).boundingBox();
        assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= height, selector + ' visible on entry');
      }
      const best = /79 slag på 18 hål/;
      assert.match(await dashboard.locator('.st-tiles').innerText(), best);
      assert.match(await dashboard.locator('.st-courses').innerText(), best);
      const detail = id => dashboard.locator(`[data-round-key="${course.slug}|${id}"]`);
      assert.match(await detail(1).locator('summary').innerText(), /Puttar ej förda/);
      assert.match(await detail(2).locator('summary').innerText(), /2 puttar på 1 av 9 hål/);
      assert.match(await detail(3).locator('summary').innerText(), /0 puttar/);
      const latestAction = latest.locator('[data-jump-round]');
      await latestAction.scrollIntoViewIfNeeded();
      const origin = await dashboard.evaluate(el => el.scrollTop);
      await latestAction.click();
      await page.waitForURL(url => url.hash === `#statistik/${course.slug}/4`);
      await page.waitForFunction(() => document.activeElement?.closest('details')?.dataset.roundKey?.endsWith('|4'));
      assert.equal(await detail(4).getAttribute('open'), '');
      assert.match(await detail(4).innerText(), /Eget mål 145 m/);
      assert.match(await detail(4).innerText(), /Återupplev i 3D/);
      await page.goBack();
      await page.waitForFunction(() => document.activeElement?.matches('[data-jump-round]'));
      assert.equal(new URL(page.url()).hash, '#statistik');
      assert.ok(Math.abs(await dashboard.evaluate(el => el.scrollTop) - origin) <= 2, 'Back restores the overview position');
      assert.equal(await detail(4).getAttribute('open'), null);
      const chart = dashboard.locator('#statsTrendChart');
      await chart.scrollIntoViewIfNeeded();
      await chart.focus();
      await chart.press('ArrowLeft');
      const selectedPoint = await chart.locator('.st-dot').evaluateAll(dots => dots.findIndex(dot => dot.classList.contains('is-on')));
      await chart.press('Enter');
      await page.waitForURL(url => url.hash === `#statistik/${course.slug}/1`);
      await dashboard.locator(`[data-round-key="${course.slug}|1"][open]`).waitFor();
      await page.goBack();
      await page.waitForFunction(() => document.activeElement?.id === 'statsTrendChart');
      assert.equal(await chart.locator('.st-dot').evaluateAll(dots => dots.findIndex(dot => dot.classList.contains('is-on'))), selectedPoint);
      if (width === 390) {
        const position = await chart.locator('.st-dot').first().evaluate(dot =>
          ({ x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) }));
        await chart.tap({ position });
        assert.equal(new URL(page.url()).hash, '#statistik');
        await dashboard.getByText('Tryck igen för scorekort').waitFor();
        await chart.tap({ position });
        await page.waitForURL(url => url.hash === `#statistik/${course.slug}/1`);
        await page.goBack();
        await page.waitForFunction(() => document.activeElement?.id === 'statsTrendChart');
      }
      await dashboard.locator('[data-view="clubs"]').click();
      const iron = dashboard.locator('#st-clubs tr').filter({hasText: 'Järn 7'});
      assert.match(await iron.innerText(), /175 m/);
      assert.match(await iron.innerText(), /140 m/);
      assert.equal(await page.evaluate(() => localStorage.getItem('banvy-caddie-bag-v1')), bag);
      const mobile = width === 390;
      if (mobile) {
        for (const [w, h] of [[320, 568], [568, 320], [390, 844]]) {
          await compactHeader(page, w, h);
          await openFilters(page);
          await closeFilters(page, w === 320);
        }
        await openFilters(page);
      } else {
        assert.ok(!await toggle(page).isVisible(), 'desktop filters remain inline');
        assert.ok(!await dashboard.locator('[data-course]').evaluate(el => Boolean(el.closest('dialog'))));
      }
      await dashboard.locator('label:has(input[name="st-period"][value="90"])').click();
      assert.equal(await detail(1).count(), 0, 'changing period removes the 120-day-old round');
      assert.equal(await detail(2).count(), 1);
      await dashboard.locator('[data-course]').selectOption(guest.slug);
      if (mobile) {
        await closeFilters(page);
        await openFilters(page);
        await page.goBack();
        await dialog(page).waitFor({ state: 'hidden' });
        assert.ok(await toggle(page).evaluate(el => el === document.activeElement), 'native Back returns focus to Filter');
        assert.equal(new URL(page.url()).hash, '#statistik');
        await page.goForward();
        await dialog(page).waitFor();
        assert.ok(await dialog(page).locator('input[value="90"]').isChecked());
        assert.equal(await dialog(page).locator('[data-course]').inputValue(), guest.slug);
        await closeFilters(page, true);
      }
      assert.match(await dashboard.locator('#st-clubs').innerText(), /1 GPS-uppmätta slag/);
      assert.equal(await dashboard.locator('.st-hero-figure').count(), 0);
      assert.equal(await dashboard.locator('[data-reset]').count(), 0);
      await dashboard.locator('[data-jump="st-rounds"]').click();
      await page.waitForFunction(() => {
        const top = document.querySelector('#st-rounds').getBoundingClientRect().top;
        return top >= document.querySelector('#stats .st-top').getBoundingClientRect().bottom - 1 && top < innerHeight;
      });
      const guestSummary = dashboard.locator(`[data-round-key="${guest.slug}|5"] summary`);
      await guestSummary.scrollIntoViewIfNeeded();
      const filteredY = await dashboard.evaluate(el => el.scrollTop);
      await guestSummary.click();
      await page.waitForURL(url => url.hash === `#statistik/${guest.slug}/5`);
      await dashboard.locator(`[data-round-key="${guest.slug}|5"][open]`).waitFor();
      await page.goBack();
      await page.waitForFunction(id => document.activeElement?.id === id, await guestSummary.getAttribute('id'));
      assert.equal(await dashboard.locator('[data-course]').inputValue(), guest.slug);
      assert.ok(await dashboard.locator('input[name="st-period"][value="90"]').isChecked());
      assert.ok(Math.abs(await dashboard.evaluate(el => el.scrollTop) - filteredY) <= 2, 'returning to a filtered list restores its scroll');
      await page.goto(base + '/#statistik/' + course.slug + '/2');
      await detail(2).locator('summary').waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('details')?.dataset.roundKey?.endsWith('|2'));
      assert.match(await detail(2).innerText(), /2 puttar på 1 av 9 hål/);
      assert.match(await detail(2).innerText(), /2\*/);
      const bounds = await detail(2).locator('summary').boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y < height);
      assert.ok(await dashboard.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.reload();
      await detail(2).locator('table').first().waitFor();
      assert.equal(await detail(2).getAttribute('open'), '', 'the exact scorecard reopens after reload');
      await page.goto(base + '/#statistik/' + course.slug + '/missing');
      await dashboard.getByText('Rundan finns inte i din sparade historik.').waitFor();
      if (!mobile) {
        const deep = await ctx.newPage();
        await deep.goto(base + '/?utm_source=scorecard#statistik/' + course.slug + '/2');
        await deep.locator(`[data-round-key="${course.slug}|2"][open]`).waitFor();
        // A link opened directly has no preceding in-app screens in this tab.
        for (const hash of ['#statistik/' + course.slug, '#statistik', '']) {
          await deep.locator('#stats [data-back]').click();
          await deep.waitForURL(url => url.hash === hash);
        }
        await deep.locator('#home:visible').waitFor();
        await deep.close();
      }
      assert.deepEqual(errors, []);
      console.log(`${width}×${height} · mixed histories, exact round, putt coverage, course ranking and carry preserved`);
    } finally { await ctx.close(); }
  }

  const ctx = await browser.newContext({ viewport: {width: 390, height: 844} });
  await ctx.addInitScript(s => localStorage.setItem('banvy-map-shots-v1', s), storeHistory([shot(5, guest.slug, 121)]));
  const page = await ctx.newPage();
  await page.goto(base + '/#statistik');
  await page.locator('#stats #st-clubs').waitFor();
  assert.match(await page.locator('#stats .st-leading').innerText(), /Dina loggade slag/);
  assert.equal(await page.locator('#stats [data-example]').count(), 0);
  await page.locator(`[data-round-key="${guest.slug}|5"] summary`).click();
  await page.locator(`[data-round-key="${guest.slug}|5"]`).getByRole('link', { name: /Återupplev i 3D/ }).waitFor();
  await page.goto(base + '/');
  await page.locator('[data-stats-summary]').waitFor();
  assert.match(await page.locator('[data-stats-summary]').innerText(), /1 loggat slag · ingen hålscore/);
  const legacy = round(3, 1, 0, [0]);
  legacy.pars = null;
  delete legacy.holes[0].par;
  await page.evaluate(r => localStorage.setItem('banvy-map-rounds-v1', r), storeRounds([legacy]));
  await page.reload();
  await page.locator('[data-stats-summary]').waitFor();
  assert.match(await page.locator('[data-stats-summary]').innerText(), /1 hål med score · par saknas/);
  await page.goto(base + '/#statistik/' + course.slug + '/3');
  const legacyCard = page.locator(`[data-round-key="${course.slug}|3"][open]`);
  await legacyCard.waitFor();
  assert.match(await legacyCard.innerText(), /Par saknas/);
  assert.equal(await legacyCard.locator('.sc-sum').first().innerText(), '4');
  await ctx.close();
  console.log('First measured stroke and a legacy score with missing par remain available.');

  const sparse = roundRecord({
    id: 42, startedAt: new Date().toISOString().slice(0, 10), handicap: 36,
    scores: { 1: { strokes: 4, putts: null } },
  }, layout);
  const small = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  await small.addInitScript(records => localStorage.setItem('banvy-map-rounds-v1', records), storeRounds([sparse]));
  const sparsePage = await small.newPage();
  await sparsePage.goto(base + '/#statistik');
  const result = sparsePage.locator('#stats .st-latest');
  await result.waitFor();
  assert.match(await result.innerText(), /Hål 1\s*· par 4/i);
  assert.match(await result.innerText(), /1 av 18 hål med score/);
  assert.equal(await result.locator('.sl-strokes .sl-reading').innerText(), '4 slag');
  assert.equal(await result.locator('.sl-strokes .sl-fact-label').innerText(), 'Par');
  assert.equal(await result.locator('.sl-points .sl-reading').innerText(), '4 poäng');
  assert.equal(await result.locator('.sl-points .sl-fact-label').innerText(), 'Stableford');
  assert.equal(await sparsePage.locator('#stats .st-hero, #stats [data-plot="trend"], #st-clubs .gap-row, #st-clubs [data-view="clubs"]').count(), 0);
  assert.ok(await sparsePage.locator('#st-clubs a[href="#installningar/bag"]').isVisible());
  // On this taller phone the last three short sections share the same scroll limit.
  await sparsePage.setViewportSize({ width: 390, height: 844 });
  for (const id of ['st-holes', 'st-clubs']) {
    await sparsePage.locator(`[data-jump="${id}"]`).tap();
    await sparsePage.waitForFunction(() => {
      const root = document.querySelector('#stats');
      return root.scrollTop > 0 && root.scrollHeight - root.clientHeight - root.scrollTop <= 1;
    });
    await sparsePage.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const current = await sparsePage.locator('.st-tabs [aria-current="true"]').evaluateAll(chips => chips.map(chip => chip.dataset.jump));
    assert.deepEqual(current, [id], 'the tapped section stays selected at the shared bottom position');
  }
  const roundSummary = sparsePage.locator('.st-round > summary').first();
  await roundSummary.click();
  const bagLink = sparsePage.locator('#statsBag');
  await bagLink.focus();
  await bagLink.scrollIntoViewIfNeeded();
  const beforeBag = await sparsePage.locator('#stats').evaluate(el => el.scrollTop);
  await bagLink.press('Enter');
  await sparsePage.locator('#bagDialog[open]').waitFor();
  await sparsePage.goBack();
  await sparsePage.waitForFunction(() => document.activeElement?.id === 'statsBag');
  const returned = await sparsePage.locator('#stats').evaluate(el => ({ y: el.scrollTop, expanded: Boolean(el.querySelector('.st-round[open]')) }));
  assert.ok(Math.abs(returned.y - beforeBag) <= 2 && returned.expanded, 'Back from Min bag restores the same place and expanded scorecard');
  await sparsePage.goto(base + '/#installningar');
  const settingsIndex = sparsePage.locator('#settings .set-nav button');
  await settingsIndex.first().waitFor();
  const indexInView = await settingsIndex.evaluateAll(buttons => buttons.length === 4 && buttons.every(button => {
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && rect.height >= 44;
  }));
  assert.ok(indexInView, 'all four Settings sections fit the phone without scrolling');
  assert.equal(await sparsePage.locator('#settings .set-section:visible').count(), 1);
  // An evicted Stadium download needs repair while Castle is still unsaved.
  await sparsePage.evaluate(() => localStorage.setItem('banvy-map-offline:bro-hof-stadium', 'evicted-download'));
  await sparsePage.locator('[data-jump="set-offline"]').click();
  await sparsePage.waitForURL('**/#installningar/offline');
  await sparsePage.reload();
  await sparsePage.waitForFunction(() => document.activeElement?.id === 'set-offline-h');
  const headingClear = await sparsePage.evaluate(() => {
    const heading = document.getElementById('set-offline-h').getBoundingClientRect();
    return heading.top >= document.querySelector('#settings .set-nav').getBoundingClientRect().bottom - 1 && heading.top < innerHeight;
  });
  assert.ok(headingClear, 'the reloaded section heading stays visible below the index');
  const bro = sparsePage.locator('[data-offline-club="bro-hof"]');
  await bro.locator('[data-offline-course="bro-hof-castle"] a:visible').waitFor();
  assert.equal(await bro.locator('[data-offline-course]').count(), 2);
  assert.equal(await bro.locator('[data-offline-course="bro-hof-stadium"] a').innerText(), 'Reparera');
  assert.equal(await bro.locator('[data-offline-course="bro-hof-castle"] a').innerText(), 'Spara offline');
  assert.match(await bro.locator('[data-offline-course="bro-hof-stadium"] a').getAttribute('href'), /bana=bro-hof-stadium/);
  assert.match(await bro.locator('[data-offline-course="bro-hof-castle"] a').getAttribute('href'), /bana=bro-hof-castle/);
  await sparsePage.locator('[data-jump="set-account"]').click();
  await sparsePage.waitForURL('**/#installningar/konto');
  await sparsePage.waitForFunction(() => document.activeElement?.id === 'set-account-h');
  await sparsePage.goBack();
  await sparsePage.locator('#set-offline:visible').waitFor();
  assert.equal(await sparsePage.locator('.set-nav [aria-current="page"]').getAttribute('data-jump'), 'set-offline');
  await sparsePage.goForward();
  await sparsePage.locator('#set-account:visible').waitFor();
  // A fresh catalogue can finish after history has restored the Konto heading.
  await sparsePage.evaluate(() => localStorage.removeItem('banvy-hub-catalogue-v1'));
  let releaseCatalogue;
  const catalogue = new Promise(resolve => { releaseCatalogue = resolve; });
  await sparsePage.route('**/courses/index.json', async route => { await catalogue; await route.continue(); });
  await sparsePage.reload({ waitUntil: 'domcontentloaded' });
  await sparsePage.waitForFunction(() => document.activeElement?.id === 'set-account-h');
  releaseCatalogue();
  await sparsePage.locator('[data-offline-course]').first().waitFor({ state: 'attached' });
  const accountY = await sparsePage.locator('#set-account-h').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(accountY >= 0 && accountY < 844, 'Konto remains visible when newly verified course rows arrive above it');
  await sparsePage.goto(base + '/');
  await sparsePage.locator('[data-stats-summary]').waitFor();
  assert.match(await sparsePage.locator('[data-stats-summary]').innerText(), /1 hål med score · 4 slag · [Pp]ar/);
  await small.close();
  console.log('A single recorded hole preserves score coverage and Stableford points. Back from Min bag restores the scorecard; section reloads keep Offlinebanor and Konto visible.');
  await checkRoundExports(browser, true);
  await checkRoundExports(browser, false);
} finally { await browser.close(); }
