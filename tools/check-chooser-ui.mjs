/* Measure the course discovery and setup journeys on phones, tablets and desktop.
   Run with node tools/check-chooser-ui.mjs [baseUrl] [--player] [--shots dir].
   --player additionally exercises the in-course chooser and keyboard shortcuts. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620').replace(/\/$/, '');
const PLAYER = args.includes('--player');
const SHOTS = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.BANVY_CHROME_PATH || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const manifest = JSON.parse(fs.readFileSync(new URL('../apps/golf/public/courses/index.json', import.meta.url), 'utf8'));
const clubCount = new Set(manifest.courses.map(course => course.club)).size;
const LAST_KEY = 'banvy-last-course';
/* the course list, one step in from the start menu */
const LIST = '/#3d';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
/* A section that throws is a FAILED section, not a crashed gate: pointed at a
   build that predates an element it reads, the run still reports the rest. */
const section = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    const detail = String(error).split('\n').filter(line => line.trim() && !line.includes('Call log:')).slice(0, 3);
    gate(false, `${name}: ${detail.join(' ')}`);
  }
};

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});

async function open({ width, height, touch = false, last = null, url = LIST, blockWorker = false, seed = null }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch,
    /* a navigation the service worker answers never reaches page.route */
    ...(blockWorker ? { serviceWorkers: 'block' } : {}),
  });
  if (last) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [LAST_KEY, last]);
  /* other keys to hold before the page loads, as { key: value } */
  if (seed) await ctx.addInitScript(entries => { try { for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch {} }, seed);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await page.goto(BASE + url, { waitUntil: 'load', timeout: 120000 });
  return { ctx, page, errs };
}

/* One measurement, shared by every viewport: everything is read off the page
   as drawn, never re-derived from the stylesheet. */
const measure = page => page.evaluate(async () => {
  const chooser = document.getElementById('chooser');
  const r = e => e.getBoundingClientRect();
  const cards = [...chooser.querySelectorAll('.card')].filter(c => c.offsetParent);
  const vh = innerHeight;
  const controls = [...chooser.querySelectorAll('button, input, select')].filter(e => e.offsetParent && !e.classList.contains('card'));
  const small = controls.map(e => ({ e, b: r(e) })).filter(x => x.b.width < 40 || x.b.height < 40)
    .map(x => `${x.e.id || String(x.e.className).split(' ')[0]} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
  const filters = chooser.querySelector('.chooser-filters');
  const fr = r(filters);
  const chips = [...filters.querySelectorAll('.c-filter-btn')];
  /* a chip is reachable if it is on screen, or its row can scroll to it */
  const rowScrolls = filters.scrollWidth - filters.clientWidth > 1 && fr.right <= innerWidth + 0.5;
  const lostChips = chips.filter(c => r(c).right > innerWidth + 0.5 && !rowScrolls).length;
  const rest = {
    cols: new Set(cards.map(c => Math.round(r(c).left))).size,
    full: cards.filter(c => r(c).top >= 0 && r(c).bottom <= vh).length,
    cardH: Math.round(r(cards[cards.length - 1]).height),
    cardW: Math.round(r(cards[cards.length - 1]).width),
    firstTop: Math.round(r(cards[0]).top),
    sideways: chooser.scrollWidth > chooser.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    small, lostChips, chips: chips.length,
    searchFont: parseFloat(getComputedStyle(chooser.querySelector('#courseSearchInput')).fontSize),
    vh,
  };
  /* move the list and see what is still in the way */
  chooser.scrollTop = 600;
  await new Promise(done => setTimeout(done, 400));
  let pinned = 0;
  for (let y = 0; y < vh; y += 2) {
    const hit = document.elementFromPoint(Math.round(innerWidth / 4), y);
    if (hit && hit.closest('.card')) { pinned = y; break; }
  }
  const moved = chooser.scrollTop > 0;
  const chipsPinned = moved ? chips.every(c => r(c).bottom > 0 && r(c).top < pinned + 2) : null;
  chooser.scrollTop = 0;
  return { ...rest, pinned, moved, chipsPinned };
});

/* ------------------------------------------------------------ the layouts */
console.log('layout');
const PHONES = [[320, 568], [360, 740], [390, 844], [430, 932]];
for (const [w, h] of PHONES) await section(`${w}x${h}`, async () => {
  const { ctx, page, errs } = await open({ width: w, height: h, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(500);
  const m = await measure(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${w}x${h}.png`) });
  const tag = `${w}x${h}`;
  gate(m.cols === 1, `${tag}: single-column club list (${m.cardW}×${m.cardH} rows)`);
  /* one card was the complaint; a 568 px screen holds two whole ones, the rest four or more */
  gate(m.full >= (h < 700 ? 2 : 4), `${tag}: ${m.full} whole cards on screen at rest`);
  gate(m.cardH <= 134, `${tag}: a compact club row is ${m.cardH} px tall`);
  gate(m.moved && m.pinned <= 72 && m.chipsPinned, `${tag}: ${m.pinned} px stays pinned once the list moves, and it is the chips (was 215-233 px, always)`);
  gate(!m.sideways, `${tag}: nothing scrolls sideways`);
  gate(m.lostChips === 0, `${tag}: all ${m.chips} filter chips can be reached`);
  gate(m.small.length === 0, `${tag}: every control is at least 40x40${m.small.length ? ' -- ' + m.small.join(', ') : ''}`);
  gate(m.searchFont >= 16, `${tag}: search field is ${m.searchFont} px (under 16 iOS zooms the page on focus)`);
  gate(errs.length === 0, `${tag}: no page errors${errs.length ? ' -- ' + errs[0] : ''}`);
  await ctx.close();
});
await section('820x1180 tablet', async () => {
  const { ctx, page } = await open({ width: 820, height: 1180, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(500);
  const m = await measure(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tablet-820x1180.png') });
  gate(m.cols >= 2, `820x1180 tablet: ${m.cols} columns, cards ${m.cardW}x${m.cardH} (was one card 754x531)`);
  gate(m.small.length === 0 && !m.sideways, `820x1180 tablet: touch targets and no sideways scroll${m.small.length ? ' -- ' + m.small.join(', ') : ''}`);
  await ctx.close();
});
await section('844x390 phone on its side', async () => {
  const { ctx, page } = await open({ width: 844, height: 390, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(500);
  const m = await measure(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-landscape-844x390.png') });
  gate(m.full >= 2 && m.firstTop <= 0.45 * m.vh, `844x390 phone on its side: ${m.full} whole cards, the first at ${m.firstTop} px (was none, the header took 61%)`);
  gate(m.small.length === 0 && !m.sideways && m.lostChips === 0, `844x390: touch targets, chips and no sideways scroll${m.small.length ? ' -- ' + m.small.join(', ') : ''}`);
  await ctx.close();
});
await section('1366x768 desktop', async () => {
  const { ctx, page } = await open({ width: 1366, height: 768 });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(500);
  const m = await measure(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-1366x768.png') });
  gate(m.cols === 3 && m.full >= 3, `1366x768 desktop: ${m.cols} columns, ${m.full} whole cards at rest`);
  gate(m.moved && m.pinned <= 72 && m.chipsPinned, `1366x768 desktop: ${m.pinned} px pinned once the list moves (was 211 px, always)`);
  gate(!m.sideways, '1366x768 desktop: nothing scrolls sideways');

  const packs = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pack.bin')) packs.push(request.url()); });
  await page.hover('#chooser .card[data-club-id="bro-hof"]');
  await page.hover('#chooser .card[data-slug="lidingo"]');
  await page.focus('#chooser .card[data-slug="lidingo"]');
  await page.waitForTimeout(900);
  gate(packs.length === 0, `hover and keyboard focus leave full course packs unloaded (${packs.length} requested)`);

  /* ---------------------------------------------------- search and chips */
  console.log('search');
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#chooser .card-item')].filter(c => c.offsetParent).map(c => c.dataset.slug).sort());
  const count = () => page.evaluate(() => document.getElementById('chooserCount').textContent.trim());
  const total = clubCount;
  await page.keyboard.press('/');
  gate(await page.evaluate(() => document.activeElement?.id === 'courseSearchInput'), '"/" puts the cursor in the search field');
  await page.keyboard.type('västerås');
  const byPlace = await shown();
  gate(byPlace.includes('angso') && byPlace.includes('tortuna') && byPlace.length < total,
    `"västerås" finds by place: ${byPlace.join(', ')} -- ${await count()}`);
  await page.fill('#courseSearchInput', 'par 27');
  const byPar = await shown();
  const par27 = manifest.courses.filter(c => c.par === 27)
    .map(c => manifest.courses.find(cover => cover.club === c.club).slug).sort();
  gate(JSON.stringify(byPar) === JSON.stringify(par27), `"par 27" finds by par: ${byPar.join(', ')} (the manifest has ${par27.join(', ')})`);
  gate((await count()) === '1 klubb · 1 bana', `the count says what matched: "${await count()}"`);
  await page.fill('#courseSearchInput', 'zzzz');
  gate((await shown()).length === 0 && await page.evaluate(() => !!document.getElementById('noCoursesMsg').offsetParent), 'a search that matches nothing says so');
  await page.click('#resetSearchBtn');
  gate((await shown()).length === total && (await count()) === `${total} klubbar · ${manifest.courses.length} banor`, `and its button brings all ${total} back`);
  await page.fill('#courseSearchInput', 'vis');
  await page.focus('#courseSearchInput');
  await page.keyboard.press('Escape');
  gate(await page.evaluate(() => document.getElementById('courseSearchInput').value === '') && (await shown()).length === total, 'Escape empties the search field');
  await page.click('.c-filter-btn[data-filter="slott"]');
  const gotSlott = await shown();
  gate(gotSlott.length > 0 && gotSlott.length < total && gotSlott.includes('bro-hof-stadium') && gotSlott.includes('johannesberg')
    && await page.evaluate(() => document.querySelector('.c-filter-btn[data-filter="slott"]').getAttribute('aria-pressed') === 'true'
      && document.querySelector('.c-filter-btn[data-filter="all"]').getAttribute('aria-pressed') === 'false'),
    `the Slott chip shows its ${gotSlott.length} clubs and says it is pressed`);
  await ctx.close();
});

/* ------------------------------------ nothing of the player behind it */
/* The bare route loads no player, yet index.html carries its HUD. Before
   body.hub hid it, the hole card ("1", "—") and the rail's camera buttons showed
   through the chooser's 95%-opaque glass, and Tab walked into 40-odd player
   controls that do nothing on this route. */
await section('no player behind the chooser', async () => {
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  const shown = await page.evaluate(() => [...document.body.children]
    .filter(e => !['chooser', 'boot', 'toast'].includes(e.id) && e.tagName !== 'SCRIPT')
    .filter(e => getComputedStyle(e).display !== 'none' && e.getClientRects().length)
    .map(e => e.id || e.className));
  gate(shown.length === 0, `no player HUD is laid out behind the chooser${shown.length ? `: ${shown.join(', ')}` : ''}`);
  const strays = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const a = document.activeElement;
      return !a || a === document.body || a.closest('#chooser') ? null : a.id || a.className || a.tagName;
    });
    if (where) strays.push(where);
  }
  gate(strays.length === 0, `Tab stays in the chooser${strays.length ? `; it reached ${[...new Set(strays)].join(', ')}` : ''}`);
  await ctx.close();
});

/* --------------------------------------------- a finger is not a pointer */
await section('touch warm-up', async () => {
  const { ctx, page } = await open({ width: 390, height: 844, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  const asked = [];
  page.on('request', q => { if (/pack\.bin/.test(q.url())) asked.push(q.url()); });
  await page.evaluate(() => {
    const card = document.querySelector('#chooser .card[data-club-id="lidingo"]');
    card.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch', bubbles: false }));
  });
  await page.waitForTimeout(700);
  gate(asked.length === 0, 'a finger landing on a card to scroll fetches no course pack');
  await ctx.close();
});

/* While browsing, every club has a single resting image. Gallery assets belong
   to the individual layout detail and should never load on a catalogue timer. */
for (const [width, height, touch] of [[390, 844, true], [1366, 768, false]]) {
  await section(`static covers ${width}×${height}`, async () => {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const covers = [];
    page.on('request', request => {
      const frame = /\/courses\/([^/]+)\/hero-(\d+)\.webp/.exec(request.url());
      if (frame) covers.push({ slug: frame[1], number: Number(frame[2]) });
    });
    await page.goto(BASE + LIST);
    await page.locator('#chooser .card').first().waitFor();
    await page.waitForTimeout(6500);
    const coverSlugs = await page.locator('.card-item').evaluateAll(cards => cards.map(item => item.dataset.slug));
    gate(covers.length > 0 && covers.every(frame => frame.number === 1 && coverSlugs.includes(frame.slug)),
      `${width}×${height}: the catalogue fetches only the clubs’ static covers (${covers.length} requests)`);
    await ctx.close();
  });
}

/* ------------------------------------------------- the last-opened course */
console.log('last opened');
await section('last opened', async () => {
  const last = 'upsala-mellanbanan';
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, last });
  const cards = page.locator('#chooser .card-item:visible');
  await cards.first().waitFor();
  gate(await page.locator('#chooserSort').inputValue() === 'name' && await cards.first().getAttribute('data-club-id') === 'bro-hof',
    'a previous layout keeps the default Swedish club-name order');
  await page.selectOption('#chooserSort', 'recent');
  const first = cards.first();
  gate(await first.getAttribute('data-club-id') === 'upsala' && /Senast öppnad/.test(await first.locator('.club-state').innerText()),
    'selecting recent brings the club of the last opened layout to the top');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-last.png') });
  await ctx.close();
});
await section('stale memory', async () => {
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, last: 'no-such-course' });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  const first = page.locator('#chooser .card-item:visible').first();
  gate(await first.getAttribute('data-club-id') === 'bro-hof' && !(await page.locator('#chooser .club-state:visible').count()),
    'a remembered course that no longer exists leaves the alphabetical club list unchanged');
  await ctx.close();
});

/* ------------------------------------------------------------------ the map */
console.log('map');
await section('map', async () => {
  const { ctx, page } = await open({ width: 390, height: 844, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.click('#viewMapBtn');
  await page.waitForSelector('.sweden-map-container .golf-map-pin', { timeout: 60000 });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const map = document.querySelector('.sweden-map-container').getBoundingClientRect();
    const chooser = document.getElementById('chooser');
    return { share: map.height / innerHeight, bottomGap: Math.round(innerHeight - map.bottom),
      preview: !!document.querySelector('#clubPicker[open], #courseSheet[open]'),
      sideways: chooser.scrollWidth > chooser.clientWidth + 1,
      plates: [...document.querySelectorAll('.golf-map-pin')].filter(p => !p.classList.contains('label-off')).map(p => p.querySelector('.pin-label').getBoundingClientRect()) };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-map.png') });
  gate(Math.round(m.share * 100) >= 80 && m.bottomGap <= 40, `phone map fills the screen: ${(100 * m.share).toFixed(0)}% of it, ${m.bottomGap} px under it (was 60% with 199 px of nothing beneath)`);
  gate(!m.preview, 'and opens on the map, not on a preview nobody asked for');
  const clash = m.plates.some((a, i) => m.plates.some((b, j) => j > i && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)));
  gate(!clash && m.plates.length > 0, `no two of the ${m.plates.length} name plates drawn overlap`);
  gate(await page.locator('.golf-map-pin').count() === clubCount, 'the map has one pin per club');
  const pin = page.locator('.golf-map-pin[data-club-id="bro-hof"]');
  await pin.locator('..').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#clubPicker[open]');
  const rows = page.locator('#clubPicker[open] [data-layout]');
  const targets = await rows.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  gate(targets.length === 2 && targets.every(size => size >= 44), 'the Bro Hof pin opens two touch-sized layout choices');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-map-pin.png') });
  await page.keyboard.press('Escape');
  await page.locator('#clubPicker[open]').waitFor({ state: 'hidden' });
  gate(await pin.locator('..').evaluate(marker => marker === document.activeElement), 'Back restores focus to the original map pin');
  await page.keyboard.press('Space');
  await page.locator('#clubPicker[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#clubPicker[open]').waitFor({ state: 'hidden' });
  await page.click('#viewGridBtn');
  await page.waitForTimeout(300);
  gate(await page.evaluate(() => [...document.querySelectorAll('#chooser .card')].filter(c => c.offsetParent).length > 0
    && !!document.getElementById('chooserControls').offsetParent), 'and the cards come back');
  await ctx.close();
});

/* -------------------------------------------------------- the start menu */
console.log('start menu');
/* Every course link the hub opens is caught and aborted, so a launch is read
   off its URL without booting the player. */
async function catchLaunch(page) {
  const seen = [];
  await page.route(url => url.searchParams.has('bana'), route => {
    seen.push(route.request().url());
    return route.abort();
  });
  return seen;
}
const paramsOf = url => Object.fromEntries(new URL(url).searchParams);

for (const [w, h, touch, name] of [[390, 844, true, 'phone'], [1440, 900, false, 'desktop'], [1366, 768, false, 'laptop']]) {
  await section(`start menu ${w}x${h}`, async () => {
    const { ctx, page, errs } = await open({ width: w, height: h, touch, last: 'bro-hof-castle', url: '/' });
    await page.waitForSelector('#home .mode-card', { timeout: 60000 });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#home .mode-card')].map(c => ({ mode: c.dataset.mode, r: c.getBoundingClientRect() }));
      const home = document.getElementById('home');
      const small = [...home.querySelectorAll('a, button')].filter(e => e.offsetParent)
        .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.width < 44 || x.b.height < 44)
        .map(x => `${x.e.className || x.e.tagName} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
      return { cards: cards.map(c => ({ mode: c.mode, top: Math.round(c.r.top), height: c.r.height })),
        resume: document.querySelector('#home [data-resume]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        chooser: !!document.getElementById('chooser') && !document.getElementById('chooser').hidden,
        sideways: home.scrollWidth > home.clientWidth + 1, small, vh: innerHeight };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `home-${w}x${h}.png`) });
    const tag = `${name} ${w}x${h}`;
    gate(m.cards.map(c => c.mode).join(',') === (touch ? 'map,detailed,play,stats,settings' : 'detailed,play,map,stats,settings'), `${tag}: five cards, Detaljerad 3D, Lätt 3D, Spela, Statistik, Inställningar (${m.cards.map(c => c.mode).join(', ')})`);
    gate(m.cards[0].top < m.vh && m.cards.every(c => c.height >= 44),
      `${tag}: the recommended activity is visible and all five destinations are touch-sized`);
    gate(!!m.resume && m.resume.includes('The Castle Course') && m.resume.includes('Bro Hof'), `${tag}: Fortsätt offers the last course: "${m.resume}"`);
    gate(!m.chooser && !m.sideways && m.small.length === 0, `${tag}: the list waits behind the menu, nothing sideways, every target 44 px${m.small.length ? ' -- ' + m.small.join(', ') : ''}`);
    gate(errs.length === 0, `${tag}: no page errors${errs.length ? ' -- ' + errs[0] : ''}`);
    await ctx.close();
  });
}

/* A card opens the course's own page (course-sheet.js), where the round is set
   up; its button starts it. `choose` picks a tee and a starting hole first. */
async function startFromSheet(page, slug, { tee = null, hole = null, look = false } = {}) {
  await page.click(`#chooser .card[data-slug="${slug}"]`);
  await page.waitForSelector('#courseSheet[open] [data-go]');
  if (tee !== null) await page.click(`#courseSheet .cs-tee:has(input[value="${tee}"])`);
  if (hole !== null) await page.click(`#courseSheet .seg-opt:has(input[name="cs-hole"][value="${hole}"])`);
  await page.click(look ? '#courseSheet [data-look]' : '#courseSheet [data-go]');
  await page.waitForTimeout(500);
}

await section('launch urls', async () => {
  const course = manifest.courses.find(c => c.holes === 18 && (c.tees?.names?.length ?? 0) > 2) || manifest.courses[0];
  const slug = course.slug;
  /* a phone: the detailed course must say karta=0, the map karta=1 */
  {
    const { ctx, page } = await open({ width: 390, height: 844, touch: true, url: '/', blockWorker: true });
    const seen = await catchLaunch(page);
    await page.waitForSelector('#home .mode-card');
    await page.click('#home .mode-card[data-mode="detailed"]');
    await page.waitForSelector('#chooser:not([hidden]) .card');
    gate(await page.evaluate(() => location.hash) === '#3d', 'phone: Detaljerad 3D opens the list at #3d');
    await page.click(`#chooser .card[data-slug="${slug}"]`);
    await page.waitForSelector('#courseSheet[open]');
    await page.waitForTimeout(700); /* it slides up into place */
    gate(!await page.locator('#courseSheet .cs-lights').isVisible(), 'advanced lighting starts collapsed');
    await page.click('#csOptionsTitle');
    const sheet = await page.evaluate(() => {
      const d = document.getElementById('courseSheet');
      const small = [...d.querySelectorAll('button, .cs-tee span, .cs-mode, .seg-opt, .cs-light')].filter(e => e.offsetParent)
        .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.height < 40)
        .map(x => `${String(x.e.className).split(' ')[0] || x.e.tagName} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
      const lights = d.querySelector('.cs-lights');
      const lightBoxes = lights ? [...lights.querySelectorAll('.cs-light')].map(el => el.getBoundingClientRect()) : [];
      const lightsInSight = Boolean(lights) && lights.scrollWidth <= lights.clientWidth + 1
        && lightBoxes.length >= 11 && lightBoxes.every(b => b.left >= lights.getBoundingClientRect().left - 1 && b.right <= lights.getBoundingClientRect().right + 1);
      const go = d.querySelector('[data-go]').getBoundingClientRect();
      return { title: d.querySelector('#csTitle').textContent, tees: d.querySelectorAll('.cs-tee').length, go: go.bottom <= innerHeight && go.top >= 0,
        mode: d.querySelector('input[name="cs-mode"]:checked')?.value, small, lightsInSight, lightCount: lightBoxes.length };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'course-sheet-390x844.png') });
    gate(sheet.title === course.name && sheet.tees === course.tees.names.length && sheet.mode === 'detailed',
      `phone: a card opens its course's page first (${sheet.title}, ${sheet.tees} tees, mode ${sheet.mode})`);
    gate(sheet.go && sheet.small.length === 0, `phone: its start button is on screen and every choice is a 40 px target${sheet.small.length ? ' -- ' + sheet.small.join(', ') : ''}`);
    gate(sheet.lightsInSight, `phone: all ${sheet.lightCount} lights fit in view without hidden horizontal scrolling`);
    /* The course's scorecard follows the tee chosen on the setup page. */
    await page.click('#csCardTitle');
    await page.waitForSelector('#courseSheet .cs-sc', { timeout: 20000 });
    const card = await page.evaluate(() => {
      const tables = [...document.querySelectorAll('#courseSheet .cs-sc')];
      return {
        holes: tables.flatMap(t => [...t.querySelectorAll('thead th')].slice(1, -1).map(th => Number(th.textContent))),
        par: tables.reduce((sum, t) => sum + Number(t.querySelector('tbody td.cs-sc-sum').textContent), 0),
        tee: Number(document.querySelector('#courseSheet input[name="cs-tee"]:checked')?.value ?? 0),
        length: document.querySelector('#courseSheet [data-length]').textContent,
        guide: [...document.querySelectorAll('#courseSheet .cs-hole')].filter(li => li.querySelector('.cs-hole-note')).length,
      };
    });
    gate(card.holes.length === course.holes && card.holes.every((n, i) => n === i + 1) && card.par === course.par,
      `phone: the page shows the course's scorecard (${card.holes.length} holes, par ${card.par})`);
    gate(card.guide === course.holes, `phone: and its guide has each hole in the course's own words (${card.guide})`);
    const otherTee = card.tee === 0 ? 1 : 0;
    await page.click(`#courseSheet .cs-tee:has(input[value="${otherTee}"])`);
    const swapped = await page.evaluate(() => ({
      label: document.querySelector('#courseSheet .cs-sc-len th').textContent.trim(),
      length: document.querySelector('#courseSheet [data-length]').textContent,
    }));
    gate(swapped.label === course.tees.names[otherTee] && swapped.length !== card.length && /\d/.test(swapped.length),
      `phone: the card and the length follow the tee (${card.length} -> ${swapped.length} m, ${swapped.label})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    gate(await page.evaluate(() => !document.getElementById('courseSheet').open && location.hash === '#3d'), 'Escape closes the course page and stays on the list');
    await startFromSheet(page, slug, { tee: 0, hole: 10 });
    const d = seen[0] ? paramsOf(seen[0]) : {};
    gate(seen.length === 1 && d.karta === '0' && d.bana === slug && d.tee === '1' && d.hal === '10',
      `phone: Spela i 3D opens ${seen[0]?.replace(BASE, '')} -- karta=0, the tee and the hole chosen`);
    /* an aborted navigation leaves the tab on the browser's error page */
    seen.length = 0;
    await page.goto(BASE + '/#karta', { waitUntil: 'load' });
    await page.waitForSelector('#chooser:not([hidden]) .card');
    gate((await page.locator('#chooserModeToggle').innerText()).includes('Lätt 3D'), 'phone: the active mode is visible before a course is opened');
    await startFromSheet(page, slug, { tee: 1 });
    const m = seen[0] ? paramsOf(seen[0]) : {};
    gate(seen.length === 1 && m.karta === '1' && m.runda === '1' && m.hal === '1', `phone: Starta rundan opens ${seen[0]?.replace(BASE, '')} -- karta=1 and the round begun`);
    seen.length = 0;
    await page.goto(BASE + '/#karta', { waitUntil: 'load' });
    await page.waitForSelector('#chooser:not([hidden]) .card');
    await startFromSheet(page, slug, { look: true });
    gate(seen.length === 1 && paramsOf(seen[0]).karta === '1' && paramsOf(seen[0]).runda === 'visa', `phone: Bara titta opens the map without a round: ${seen[0]?.replace(BASE, '')}`);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const remembered = await page.evaluate(s => [localStorage.getItem('banvy-last-course'), localStorage.getItem('banvy-last-mode'), localStorage.getItem(`banvy-map-tee-v1:${s}`)], slug);
    gate(remembered[0] === slug && remembered[1] === 'map' && remembered[2] === '1', `and the menu will offer it again, with the tee kept for the map: ${remembered.join(', ')}`);
    await ctx.close();
  }
  /* a desktop, with settings: they ride on the detailed course's link */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('banvy-settings-v1', JSON.stringify({ quality: 'hi', renderer: 'webgl', light: 'nu', view: 'tee' })); } catch {} });
    const page = await ctx.newPage();
    const seen = await catchLaunch(page);
    await page.goto(BASE + LIST, { waitUntil: 'load' });
    await page.waitForSelector('#chooser .card');
    await startFromSheet(page, slug);
    const p = seen[0] ? paramsOf(seen[0]) : {};
    gate(p.bana === slug && !('karta' in p) && p.q === 'hi' && p.gl === '1' && p.ljus === 'nu' && p.vy === 'tee' && p.tee === String((course.tees.def ?? 0) + 1),
      `desktop: the settings and the course's own tee ride on the link the player reads: ${seen[0]?.replace(BASE, '')}`);
    await ctx.close();
  }
});

/* A round under way in the map is what the golfer is standing in: the menu
   offers it first, its card says so, and it resumes without a new round. */
await section('a round under way', async () => {
  const course = manifest.courses.find(c => c.holes === 18) || manifest.courses[0];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(slug => {
    try {
      const now = Date.now();
      localStorage.setItem(`banvy-map-round-v1:${slug}`, JSON.stringify({ version: 1, startedAt: '2026-11-08', handicap: 18, begunAt: now - 3600e3, scores: { 1: { strokes: 5, putts: 2 }, 2: { strokes: 4, putts: 2 } } }));
      localStorage.setItem(`banvy-map-hole-v1:${slug}`, JSON.stringify({ value: 3, at: now - 300e3 }));
    } catch {}
  }, course.slug);
  const page = await ctx.newPage();
  const seen = await catchLaunch(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#home [data-resume]');
  const card = await page.evaluate(() => {
    const b = document.querySelector('#home [data-resume]');
    return { live: b.classList.contains('is-live'), text: b.textContent.replace(/\s+/g, ' ').trim() };
  });
  gate(card.live && /Fortsätt GPS-rundan/.test(card.text) && card.text.includes(course.name) && /Hål 3/.test(card.text) && /9 slag/.test(card.text),
    `the menu offers the round under way first: "${card.text}"`);
  await page.click('#home [data-resume]');
  await page.waitForTimeout(500);
  const p = seen[0] ? paramsOf(seen[0]) : {};
  gate(p.bana === course.slug && p.karta === '1' && p.runda === 'fortsatt' && !('hal' in p), `and resumes it in the map, without beginning another: ${seen[0]?.replace(BASE, '')}`);
  await page.goto(BASE + '/#karta', { waitUntil: 'load' });
  await page.waitForSelector('#chooser:not([hidden]) .card');
  const badge = await page.evaluate(s => document.querySelector(`#chooser .card-item[data-slug="${s}"] .club-state`)?.textContent, course.slug);
  gate(badge?.includes('GPS-runda pågår'), `its course's card says so too: "${badge}"`);
  await ctx.close();
});

/* Offline packs belong to an individual layout, including two at the same club. */
await section('a layout kept for offline play', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('banvy-map-offline:bro-hof-castle', '1'));
  const page = await ctx.newPage();
  await page.goto(BASE + '/#karta');
  const card = page.locator('.card-item[data-club-id="bro-hof"] .card');
  await card.click();
  const picker = page.locator('#clubPicker[open]');
  await picker.waitFor();
  const castle = picker.locator('[data-layout="bro-hof-castle"]');
  const stadium = picker.locator('[data-layout="bro-hof-stadium"]');
  gate(/Tidigare nedladdad/.test(await castle.innerText()) && !/nedladdad/i.test(await stadium.innerText()),
    'only the previously downloaded Castle layout is marked in Lätt 3D');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  await page.click('#chooserModeToggle');
  await page.click('.c-mode-btn[data-mode="detailed"]');
  await card.click();
  gate(!/nedladdad/i.test(await picker.innerText()), 'the desktop renderer does not advertise an offline GPS pack');
  await ctx.close();
});

/* With rounds kept on a course, its page's scorecard carries the golfer's own
   average on each hole (stats-model perHole), coloured against par. */
await section('your own card on the course page', async () => {
  const course = manifest.courses.find(c => c.holes === 18 && c.status !== 'mapping') || manifest.courses[0];
  const holes = Array.from({ length: course.holes }, (_, i) => ({ n: i + 1, par: 4, strokes: i === 0 ? 3 : i === 1 ? 6 : 4, putts: 2, fairway: 'hit', picked: false }));
  const strokes = holes.reduce((s, h) => s + h.strokes, 0);
  const round = { id: 1, course: course.slug, courseName: course.name, date: '2026-11-01', endedAt: 1, tee: 1, handicap: 18, holeCount: course.holes,
    pars: holes.map(h => h.par), holes, totals: { played: course.holes, strokes, par: 4 * course.holes, putts: 36, points: 36, fairways: 14, fairwaysTried: 14, greens: 9, greensTried: 18, toPar: strokes - 4 * course.holes } };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(r => { try { localStorage.setItem('banvy-map-rounds-v1', JSON.stringify({ version: 1, rounds: [r] })); } catch {} }, round);
  const page = await ctx.newPage();
  await page.goto(BASE + '/#karta', { waitUntil: 'load' });
  await page.waitForSelector(`#chooser .card[data-slug="${course.slug}"]`);
  await page.click(`#chooser .card[data-slug="${course.slug}"]`);
  await page.click('#csCardTitle');
  await page.waitForSelector('#courseSheet .cs-sc-mine', { timeout: 20000 });
  const mine = await page.$$eval('#courseSheet .cs-sc-mine', rows => rows.map(r => [...r.querySelectorAll('td')].map(td => ({ text: td.textContent, tone: td.className }))));
  const first = mine[0] ?? [];
  gate(mine.length === 2 && first.length === 10 && first[0].text === '3,0' && /is-under/.test(first[0].tone) && first[1].text === '6,0' && /is-over/.test(first[1].tone) && first[2].tone === '',
    `the scorecard has a Snitt row a nine, under par blue and over orange (${first.slice(0, 3).map(c => c.text).join(' ')})`);
  const guideMine = await page.$$eval('#courseSheet .cs-hole-mine', els => els.map(e => e.textContent.trim()));
  gate(guideMine.length === course.holes && guideMine[0] === 'Ditt snitt 3,0', `and each guide card says your average on its hole (${guideMine.length}, "${guideMine[0]}")`);
  /* and the page leads on to that course in Statistik, hole by hole, clear of the header */
  await page.click('#csInfoTitle');
  await page.click('#courseSheet .cs-past-more');
  await page.waitForSelector('#stats:not([hidden]) [data-card="holes"] .shb-col', { timeout: 15000 });
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() => ({
    hash: location.hash,
    columns: document.querySelectorAll('#stats .shb-col').length,
    top: Math.round(document.querySelector('#stats [data-card="holes"]').getBoundingClientRect().top),
    header: Math.round(document.querySelector('#stats .set-top').getBoundingClientRect().bottom),
  }));
  gate(stats.hash === `#statistik/${course.slug}` && stats.columns === course.holes && stats.top >= stats.header && stats.top < 400,
    `its "Hål för hål i Statistik" opens that course's holes in view (${stats.hash}, ${stats.columns} holes, card at ${stats.top} px under a ${stats.header} px header)`);
  /* and from there the course is played next: its page, in the map the rounds came from */
  await page.click('#stats [data-play-course]');
  await page.waitForSelector('#courseSheet[open]');
  const again = await page.evaluate(() => ({ title: document.getElementById('csTitle').textContent, mode: document.querySelector('#courseSheet input[name="cs-mode"]:checked')?.value }));
  gate(again.title === course.name && again.mode === 'map', `and its Spela opens the course's page in Lätt 3D (${again.title}, ${again.mode})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  /* a kept round, opened, plays its course again */
  await page.click('#stats .st-round summary');
  await page.click('#stats .sr-actions [data-play-course]');
  await page.waitForSelector('#courseSheet[open]');
  const fromRound = await page.evaluate(() => document.getElementById('csTitle').textContent);
  gate(fromRound === course.name, `and a kept round's "Spela banan igen" opens its course's page (${fromRound})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#stats [data-back]');
  // The scorecard has its own history entry above the course's statistics.
  await page.waitForURL(url => url.hash === '#statistik/' + course.slug);
  await page.click('#stats [data-back]');
  await page.waitForSelector('#courseSheet[open]');
  gate((await page.evaluate(() => location.hash)).startsWith(`#karta/${course.slug}`), 'and Tillbaka returns to the exact course setup that opened Statistik');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#courseSheet:not([open])', { state: 'attached' });
  gate((await page.evaluate(() => location.hash)) === '#karta', 'closing the restored setup returns to its list');
  await ctx.close();
});

await section('mode switch and the way back', async () => {
  const { ctx, page } = await open({ width: 1440, height: 900, url: '/' });
  await page.waitForSelector('#home .mode-card');
  await page.keyboard.press('1');
  await page.waitForSelector('#chooser:not([hidden]) .card');
  gate(await page.evaluate(() => location.hash) === '#3d', 'the key 1 opens Detaljerad 3D');
  await page.click('#chooserModeToggle');
  await page.click('.c-mode-btn[data-mode="map"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ hash: location.hash, checked: document.querySelector('.c-mode-btn[aria-checked="true"]')?.dataset.mode,
    mode: document.querySelector('#chooserModeToggle')?.innerText, title: document.title }));
  gate(after.hash === '#karta' && after.checked === 'map' && /Lätt 3D/.test(after.mode) && /Lätt 3D/.test(after.title),
    `switching to Lätt 3D in place: ${after.hash}, "${after.mode}", "${after.title}"`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#home:not([hidden])');
  gate(await page.evaluate(() => !document.getElementById('home').hidden && document.getElementById('chooser').hidden && location.hash === ''),
    'Escape goes back to the start menu (the switch replaced its step, so one back is enough)');
  await page.click('#home .mode-settings');
  await page.waitForSelector('#settings:not([hidden])');
  await page.goBack();
  await page.waitForSelector('#home:not([hidden])');
  gate(await page.evaluate(() => !document.getElementById('home').hidden && document.getElementById('settings').hidden), 'the browser\'s back walks the screens');
  await ctx.close();
});

await section('settings', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const bag = JSON.stringify({ version: 3, clubs: [{ id: 'driver', name: 'Driver', carry: 230 }, { id: 'iron-7', name: 'Järn 7', carry: 150 }, { id: 'putter', name: 'Putter', carry: 0 }] });
  await ctx.addInitScript(b => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('banvy-caddie-bag-v1', b); sessionStorage.setItem('seeded', '1'); } } catch {} }, bag);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await page.goto(BASE + '/#installningar', { waitUntil: 'load' });
  await page.waitForSelector('#settings:not([hidden]) .set-panel');
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const el = document.getElementById('settings');
    const small = [...el.querySelectorAll('button, .seg-opt, .swatch, .set-switch')].filter(e => e.offsetParent)
      .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.height < 40 || x.b.width < 40)
      .map(x => `${String(x.e.className).split(' ')[0]} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
    return { sideways: el.scrollWidth > el.clientWidth + 1, small, ladder: el.querySelectorAll('.bag-ladder li').length };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'settings-390x844.png') });
  gate(!layout.sideways && layout.small.length === 0, `settings at 390 px: nothing sideways, every target 40 px${layout.small.length ? ' -- ' + layout.small.join(', ') : ''}`);
  gate(layout.ladder === 3, `the bag shows as its carry ladder (${layout.ladder} clubs)`);
  await page.click('#settingsNav-visning');
  await page.click('.seg[data-name="quality"] .seg-opt:has(input[value="hi"])');
  await page.locator('summary:has(#lbl-maplight)').click();
  await page.click('.swatches[data-name="maplight"] .swatch:has(input[value="dis"])');
  await page.click('.set-switch:has([data-switch="sun"])');
  await page.locator('.set-advanced summary').click();
  await page.click('.seg[data-name="fps"] .seg-opt:has(input[value="30"])');
  const stored = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('banvy-settings-v1') || '{}'), light: localStorage.getItem('banvy-map-light-v1'),
    display: JSON.parse(localStorage.getItem('banvy-map-display-v1') || '{}'), fps: localStorage.getItem('banvy-fps'),
    saved: document.querySelector('[data-saved]').classList.contains('is-on') }));
  gate(stored.s.quality === 'hi' && stored.light === 'dis' && stored.display.sun === true && stored.fps === '30' && stored.saved,
    `each choice lands in the key its program reads, and says so (q ${stored.s.quality}, map light ${stored.light}, sun ${stored.display.sun}, fps ${stored.fps})`);
  await page.click('#settingsNav-konto');
  await page.click('[data-reset]');
  await page.click('[data-reset-cancel]');
  gate(await page.locator('[data-reset-cancel]').isHidden() && await page.evaluate(() => localStorage.getItem('banvy-fps')) === '30',
    'cancelling the reset keeps the saved preferences');
  await page.click('[data-reset]');
  await page.getByRole('button', { name: 'Bekräfta återställning' }).click();
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => ({ s: localStorage.getItem('banvy-settings-v1'), light: localStorage.getItem('banvy-map-light-v1'), bag: localStorage.getItem('banvy-caddie-bag-v1'),
    checked: document.querySelector('.seg[data-name="quality"] input:checked')?.value }));
  gate(reset.s === null && reset.light === null && reset.bag === bag && reset.checked === 'auto', 'Återställ clears the preferences, shows the defaults, and leaves the bag alone');
  /* the backup: out as a file, everything wiped, and back in after it says what it holds */
  await page.evaluate(() => localStorage.setItem('banvy-map-rounds-v1', JSON.stringify({ version: 1, rounds: [{ id: 1, course: 'x', holes: [], totals: {} }] })));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-backup-save]')]);
  const file = path.join(fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'banvy-backup-')), download.suggestedFilename());
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('banvy')) localStorage.removeItem(key); });
  await page.setInputFiles('[data-backup-file]', file);
  await page.waitForSelector('[data-backup-confirm]:not([hidden])');
  const said = await page.evaluate(() => document.querySelector('[data-backup-text]').textContent);
  await page.click('[data-backup-apply]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ bag: localStorage.getItem('banvy-caddie-bag-v1'), rounds: JSON.parse(localStorage.getItem('banvy-map-rounds-v1') || '{}').rounds?.length ?? 0 }));
  gate(saved.kind === 'banvy-backup' && /^banvy-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()) && /1 runda/.test(said) && back.bag === bag && back.rounds === 1,
    `the backup goes out as ${download.suggestedFilename()} and comes back after saying what it holds ("${said.slice(0, 60)}…")`);
  gate(errs.length === 0, `settings: no page errors${errs.length ? ' -- ' + errs[0] : ''}`);
  await ctx.close();
});

/* ------------------------------------------------------------ statistics
   With no rounds the page says how they are made and offers an example; the
   example is labelled, draws every chart, and every chart has its table. A
   round kept by the map shows at once, without the example's label. */
console.log('statistics');
for (const [w, h, touch] of [[390, 844, true], [1440, 900, false]]) {
  await section(`statistics ${w}x${h}`, async () => {
    const { ctx, page, errs } = await open({ width: w, height: h, touch, url: '/#statistik' });
    await page.waitForSelector('#stats:not([hidden]) [data-example]', { timeout: 60000 });
    const empty = await page.evaluate(() => ({ play: !!document.querySelector('#stats [data-play]'), title: document.querySelector('#stats h2')?.textContent }));
    gate(empty.play, `${w}x${h}: with no rounds the page says how they are made: "${empty.title}"`);
    await page.click('#stats [data-example]');
    await page.waitForSelector('#stats .st-hero-figure');
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const el = document.getElementById('stats');
      const small = [...el.querySelectorAll('button, select, .seg-opt, summary')].filter(e => e.offsetParent)
        .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.height < 40)
        .map(x => `${String(x.e.className).split(' ')[0] || x.e.tagName} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
      return { hero: el.querySelector('.st-hero-figure').textContent, banner: !!el.querySelector('.st-banner'),
        dots: el.querySelectorAll('[data-plot="trend"] .st-dot').length, rounds: Number(el.querySelector('.st-tile dd').textContent),
        clubs: el.querySelectorAll('.gap-row').length, cards: el.querySelectorAll('.st-round').length,
        sideways: el.scrollWidth > el.clientWidth + 1, small };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `stats-${w}x${h}.png`), fullPage: false });
    gate(m.banner && /^[+−±]/.test(m.hero), `${w}x${h}: the example is labelled as one, and leads with one figure (${m.hero})`);
    gate(m.dots === m.rounds && m.cards === m.rounds && m.clubs >= 10, `${w}x${h}: the trend has a dot per round (${m.dots}/${m.rounds}), the history a card per round, and the bag ${m.clubs} rows`);
    gate(!m.sideways && m.small.length === 0, `${w}x${h}: nothing sideways, every control 40 px${m.small.length ? ' -- ' + m.small.join(', ') : ''}`);
    await page.click('#stats [data-view="trend"]');
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => document.querySelectorAll('#stats [data-card="trend"] .st-table tbody tr').length);
    gate(rows === m.rounds, `${w}x${h}: the trend's table has every round (${rows})`);
    const changeFilter = async action => {
      const toggle = page.locator('#stats [data-filter-toggle]');
      const sheet = await toggle.isVisible();
      if (sheet) await toggle.click();
      await action();
      if (sheet) await page.locator('#stats [data-filter-dialog][open] [data-filter-close]').click();
    };
    await changeFilter(() => page.click('#stats .seg-opt:has(input[value="90"])'));
    await page.waitForTimeout(300);
    const narrowed = await page.evaluate(() => Number(document.querySelector('#stats .st-tile dd').textContent));
    gate(narrowed > 0 && narrowed < m.rounds, `${w}x${h}: 90 dagar narrows every figure (${narrowed} of ${m.rounds} rounds)`);
    /* hole by hole: offered course by course, drawn a column a hole, with its table */
    await changeFilter(() => page.click('#stats .seg-opt:has(input[value="all"])'));
    await page.waitForTimeout(300);
    const picks = await page.evaluate(() => document.querySelectorAll('#stats [data-pick-course]').length);
    await page.click('#stats [data-pick-course]');
    await page.waitForTimeout(400);
    const holes = await page.evaluate(() => ({ cols: document.querySelectorAll('#stats .shb-col').length,
      labels: [...document.querySelectorAll('#stats .shb-col em')].map(e => e.textContent),
      sideways: document.getElementById('stats').scrollWidth > document.getElementById('stats').clientWidth + 1 }));
    gate(picks > 0 && holes.cols === 18 && holes.labels.length >= 1 && holes.labels.length <= 2 && !holes.sideways,
      `${w}x${h}: hole by hole offers ${picks} courses and draws a column a hole (${holes.cols}), labelling only the extremes (${holes.labels.join(', ')})`);
    await page.click('#stats [data-view="holes"]');
    await page.waitForTimeout(300);
    const holeRows = await page.evaluate(() => document.querySelectorAll('#stats [data-card="holes"] .st-table tbody tr').length);
    gate(holeRows === 18, `${w}x${h}: and its table has every hole (${holeRows})`);
    /* a row under Banor is a way in to its course too */
    await changeFilter(() => page.selectOption('#stats [data-course]', 'all'));
    await page.waitForTimeout(300);
    const rowName = await page.evaluate(() => document.querySelector('#stats .st-courses .sc-pick')?.getAttribute('aria-label') ?? '');
    await page.click('#stats .st-courses .sc-pick');
    await page.waitForTimeout(400);
    /* the holes card keeps the table view chosen above: a column or a row a hole */
    const viaRow = await page.evaluate(() => ({
      cols: document.querySelectorAll('#stats .shb-col').length || document.querySelectorAll('#stats [data-card="holes"] .st-table tbody tr').length,
      chosen: document.querySelector('#stats [data-course]')?.value,
    }));
    gate(viaRow.cols === 18 && viaRow.chosen && viaRow.chosen !== 'all', `${w}x${h}: a course under Banor opens it hole by hole (${rowName}, ${viaRow.chosen})`);
    gate(errs.length === 0, `${w}x${h}: no page errors${errs.length ? ' -- ' + errs[0] : ''}`);
    await ctx.close();
  });
}
await section('statistics from a kept round', async () => {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5];
  const strokes = [5, 4, 3, 6, 4, 5, 4, 4, 5];
  const record = { id: 1, course: manifest.courses[0].slug, courseName: manifest.courses[0].name, date: '2026-11-01', endedAt: Date.parse('2026-11-01T14:00:00Z'),
    tee: null, handicap: null, holeCount: 9, pars, holes: pars.map((par, i) => ({ n: i + 1, par, strokes: strokes[i], putts: 2, fairway: par >= 4 ? 'hit' : null, picked: false })),
    totals: { played: 9, strokes: 40, par: 36, putts: 18, points: null, fairways: 7, fairwaysTried: 7, greens: 4, greensTried: 9, toPar: 4 } };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(r => { try { localStorage.setItem('banvy-map-rounds-v1', JSON.stringify({ version: 1, rounds: [r] })); } catch {} }, record);
  const page = await ctx.newPage();
  await page.goto(BASE + '/#statistik', { waitUntil: 'load' });
  await page.waitForSelector('#stats .st-hero-figure', { timeout: 60000 });
  const m = await page.evaluate(() => ({ hero: document.querySelector('#stats .st-hero-figure').textContent, banner: !!document.querySelector('#stats .st-banner'),
    sub: document.querySelector('#stats [data-sub]').textContent }));
  gate(!m.banner && m.hero === '+8,0', `a round the map kept is on the page at once, scaled to 18 holes (${m.hero}, "${m.sub}")`);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#home [data-stats-summary]');
  const summary = await page.evaluate(() => document.querySelector('#home [data-stats-summary]').textContent);
  gate(/1 runda/.test(summary), `and the menu's Statistik card counts it: "${summary}"`);
  await ctx.close();
});

/* ------------------------------------------- typing is not steering (--player) */
if (PLAYER) {
  console.log('player');
  const slug = manifest.courses[0].slug;
  /* one round kept on the course, so the drawer offers that course's statistics */
  const kept = { id: 1, course: slug, courseName: manifest.courses[0].name, date: '2026-11-01', endedAt: 1, tee: 1, handicap: 18, holeCount: 9, pars: Array(9).fill(4),
    holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, strokes: 5, putts: 2, fairway: 'hit', picked: false })),
    totals: { played: 9, strokes: 45, par: 36, putts: 18, points: 18, fairways: 9, fairwaysTried: 9, greens: 2, greensTried: 9, toPar: 9 } };
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, url: `/?bana=${slug}&q=lo&hal=3${GPU ? '' : '&gl=1'}`,
    seed: { 'banvy-map-rounds-v1': JSON.stringify({ version: 1, rounds: [kept] }) } });
  try {
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    // This journey checks keyboard and drawer input after a real first frame.
    // Continuous terrain draws on the software GPU delay DOM actionability.
    if (!GPU) await page.evaluate(() => V3D.harness().renderer.setAnimationLoop(null));
    await page.evaluate(() => document.getElementById('bytBtn').click());
    await page.locator('#chooser:visible #chooserResumeBtn').waitFor();
    const opened = await page.evaluate(slug => {
      const current = document.querySelector(`#chooser .card-item[data-slug="${CSS.escape(slug)}"]`);
      const close = document.getElementById('chooserResumeBtn').getBoundingClientRect();
      return { slug: current.dataset.slug, badge: current.querySelector('.club-state')?.textContent.trim(),
        close: Math.min(close.width, close.height), remembered: localStorage.getItem('banvy-last-course') };
    }, slug);
    gate(opened.slug === slug && opened.badge?.includes('Aktiv bana'), `the currently open course remains identified in the sorted grid: ${opened.slug}, "${opened.badge}"`);
    gate(opened.close >= 40, `and the way back is a ${Math.round(opened.close)} px button, not a sentence`);
    gate(opened.remembered === slug, 'the player records the course for recents in the hub');
    await page.locator('#chooserSort').focus();
    await page.selectOption('#chooserSort', 'recent');
    gate(await page.locator('#coursesCardList .card-item').first().getAttribute('data-slug') === slug, 'the in-course recent order puts the open club first');
    const before = await page.evaluate(() => ({ hole: document.getElementById('cno').textContent, clean: document.body.classList.contains('clean'), sky: window.V3D.skyState() }));
    await page.click('#courseSearchInput');
    await page.keyboard.type('npm h', { delay: 30 });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ hole: document.getElementById('cno').textContent, clean: document.body.classList.contains('clean'), sky: window.V3D.skyState() }));
    gate(JSON.stringify(before) === JSON.stringify(after),
      `letters in the search do not steer the course behind it (hole ${before.hole}->${after.hole}, clean ${before.clean}->${after.clean}, markers ${before.sky}->${after.sky})`);
    /* another course, picked over the running one, opens its own page; Escape closes
       the page and leaves the list open behind it */
    {
      const other = manifest.courses.find(c => c.slug !== slug).slug;
      await page.evaluate(() => { const i = document.getElementById('courseSearchInput'); i.value = ''; i.dispatchEvent(new Event('input')); });
      await page.click(`#chooser .card[data-slug="${other}"]`);
      await page.waitForSelector('#courseSheet[open]', { timeout: 20000 });
      const styled = await page.evaluate(() => getComputedStyle(document.querySelector('#courseSheet .seg') || document.body).display);
      await page.keyboard.press('Escape');
      await page.locator('#courseSheet[open]').waitFor({ state: 'hidden' });
      const after = await page.evaluate(() => ({ sheet: document.getElementById('courseSheet').open, list: document.body.classList.contains('choosing') }));
      gate(styled === 'flex' && !after.sheet && after.list, `in the player another course opens its own page, styled (${styled}); Escape closes it and keeps the list`);
      await page.click('#courseSearchInput');
      await page.keyboard.type('npm h', { delay: 30 });
    }
    await page.keyboard.press('Escape');
    const e1 = await page.evaluate(() => ({ q: document.getElementById('courseSearchInput').value, open: document.body.classList.contains('choosing') }));
    await page.keyboard.press('Escape');
    await page.locator('#chooser').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.activeElement?.closest('#chooser'), null, { polling: 50 });
    const open2 = await page.evaluate(() => document.body.classList.contains('choosing'));
    gate(e1.q === '' && e1.open && !open2, 'Escape empties the search first and closes the chooser second');

    /* The menu listed 1-9, 0, C, L and F; until engine/keyboard-shortcuts.mjs
       only the arrows, N/P, H and M did anything. */
    const read = () => page.evaluate(() => ({ hole: document.getElementById('cno').textContent.trim(),
      cam: document.querySelector('#rail [data-cam].on')?.dataset.cam, light: document.querySelector('#rail [data-preset].on')?.dataset.preset }));
    const holes = await page.evaluate(() => document.querySelectorAll('#holes .hb').length);
    const checkHole = async (number, keys, label) => {
      for (const key of keys) await page.keyboard.press(key);
      await page.waitForFunction(n => document.getElementById('cno').textContent.trim() === String(n), number, { polling: 50 });
      gate(true, label);
    };
    await checkHole(7, '7', '"7" goes to hole 7');
    if (holes >= 14) {
      await checkHole(14, '14', '"1", "4" goes to hole 14');
      await checkHole(1, '1', 'a lone "1" goes to hole 1 once the second digit does not come');
      await checkHole(10, '0', '"0" goes to hole 10');
    }
    const s0 = await read();
    await page.keyboard.press('c');
    await page.waitForTimeout(300);
    const s1 = await read();
    gate(s1.cam && s1.cam !== s0.cam, `"C" steps the camera view (${s0.cam} -> ${s1.cam})`);
    await page.keyboard.press('l');
    await page.waitForTimeout(600);
    const s2 = await read();
    gate(s2.light && s2.light !== s0.light, `"L" steps the light (${s0.light} -> ${s2.light})`);
    await page.locator('#menuToggle').click();
    await page.locator('#navDrawer[open] #ndTabMore').click();
    await page.locator('#navDrawer[open] #ndMore:visible').waitFor();
    const listed = await page.evaluate(() => [...document.querySelectorAll('#navDrawer .sc-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    gate(listed.some(t => t.includes('Byt kameravy')) && listed.some(t => t.includes('Hål 10')), `the menu lists the working keys (${listed.length} rows)`);
    const courseStats = await page.evaluate(() => {
      const a = document.getElementById('dCourseStats');
      return a ? { href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim() } : null;
    });
    gate(courseStats?.href?.endsWith(`#statistik/${slug}`) && /Din runda här/.test(courseStats.text),
      `with a round kept here, the menu leads to this course in Statistik (${courseStats?.href}, "${courseStats?.text}")`);
    const inMenu = (await read()).hole;
    await page.keyboard.press('5');
    await page.waitForTimeout(300);
    gate((await read()).hole === inMenu, `keys do not steer the course behind the open menu (hole ${inMenu} -> ${(await read()).hole})`);
    await page.goBack();
    await page.locator('#navDrawer[open]').waitFor({ state: 'hidden' });
    gate(await page.evaluate(() => document.activeElement.id === 'menuToggle'), 'browser Back closes the detailed menu and restores its launcher');
    await page.goForward();
    await page.locator('#navDrawer[open]').waitFor();
    gate(await page.locator('#ndTabMore').getAttribute('aria-selected') === 'true', 'Forward restores the selected detailed menu tab');
    await page.click('#ndTabPlay');
    await page.click('#dNoteBtn');
    await page.locator('#note.mobile-open').waitFor();
    gate(await page.locator('#note').evaluate(panel => panel.classList.contains('mobile-open')), 'Banguide opens the detailed viewer’s own guide');
    await page.keyboard.press('Escape');
  } catch (e) {
    gate(false, `player: ${e.message}`);
  }
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} chooser checks failed` : '\nthe chooser measures as designed');
process.exit(bad ? 1 : 0);
