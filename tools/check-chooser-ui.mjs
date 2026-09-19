/* Is the front door still the shape it was measured to be?

   usage: node tools/check-chooser-ui.mjs [baseUrl] [--player] [--shots dir]
          (default http://127.0.0.1:8620 -- a built dist behind tools/serve.mjs,
           or a Vite dev server; the bare route boots no course and needs no GPU)

   The course chooser is the first thing anyone sees and the one screen nothing
   measured. Every data gate passed while, on a 390x844 phone, it showed ONE
   card under 233 px of header that never scrolled away, its fourth filter chip
   sat off the edge of the screen where no gesture could reach it, a portrait
   tablet got a single card 754 px wide, and a phone on its side gave 61% of the
   screen to the header and showed no whole card at all. None of that is
   findable by reading the stylesheet, so this drives the page and measures it:

     - the phone is a two-up gallery: columns, whole cards on screen, card
       height, and what stays pinned once the list has moved
     - every control is a touch target, every chip is reachable, nothing scrolls
       sideways, and the search field is 16 px (below that iOS zooms the page)
     - a tablet is never one column; a phone on its side still shows cards
     - search keeps the placeholder's promise (bana, ort, par), the count says
       what matched, the empty state has a way out
     - the last-opened course leads the list, and on a phone leads it full width
     - the map fills the screen, and a preview nobody asked for is not over it
     - the hover warm-up asks for the pack by the SAME url the player will, and a
       finger landing on a card to scroll fetches nothing

   --player also boots one course (BANVY_GPU=1 makes that seconds, not minutes)
   and proves that letters typed into the chooser's search do not steer the
   course behind it. Measured key by key on the build before the guard: "n"
   took the hole from 3 to 4, "p" back, "m" cycled the markers from 2 to 0 and
   "h" switched the course into clean view.

   The thresholds are the measured values with room, not targets. At 390x844
   the redesign measures: 6 whole cards at rest, 172 px cards, 56 px pinned.

   It was proved to FAIL before it was believed to pass: pointed at the chooser
   it replaces (the live site, still serving it) 49 checks fail, each naming its
   number; pointed at this one, none do.

   The live site is mounted at /olovs-hemsida/, so run it against a subpath
   build too (baseUrl http://127.0.0.1:<port>/olovs-hemsida). ONE TRAP building
   that on Windows: Git Bash rewrites an environment value that looks like a
   path, so `BANVY_BASE=/olovs-hemsida/ npx vite build` bakes
   "C:/Program Files/Git/olovs-hemsida/" into every url and the page cannot
   fetch its own modules. Set it from PowerShell ($env:BANVY_BASE = ...) or
   prefix MSYS_NO_PATHCONV=1.                                                 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620').replace(/\/$/, '');
const PLAYER = args.includes('--player');
const SHOTS = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const LAST_KEY = 'banvy-last-course';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
/* A section that throws is a FAILED section, not a crashed gate: pointed at a
   build that predates an element it reads, the run still reports the rest. */
const section = async (name, fn) => {
  try { await fn(); } catch (e) { gate(false, `${name}: ${String(e).split('\n')[0].slice(0, 120)}`); }
};

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});

async function open({ width, height, touch = false, last = null, url = '/' }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch,
  });
  if (last) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [LAST_KEY, last]);
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
  const plain = cards.filter(c => !c.closest('.is-lead'));
  const vh = innerHeight;
  const controls = [...chooser.querySelectorAll('button, input')].filter(e => e.offsetParent && !e.classList.contains('card'));
  const small = controls.map(e => ({ e, b: r(e) })).filter(x => x.b.width < 40 || x.b.height < 40)
    .map(x => `${x.e.id || String(x.e.className).split(' ')[0]} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
  const filters = chooser.querySelector('.chooser-filters');
  const fr = r(filters);
  const chips = [...filters.querySelectorAll('.c-filter-btn')];
  /* a chip is reachable if it is on screen, or its row can scroll to it */
  const rowScrolls = filters.scrollWidth - filters.clientWidth > 1 && fr.right <= innerWidth + 0.5;
  const lostChips = chips.filter(c => r(c).right > innerWidth + 0.5 && !rowScrolls).length;
  const rest = {
    cols: new Set(plain.map(c => Math.round(r(c).left))).size,
    full: cards.filter(c => r(c).top >= 0 && r(c).bottom <= vh).length,
    cardH: Math.round(r(plain[plain.length - 1]).height),
    cardW: Math.round(r(plain[plain.length - 1]).width),
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
  gate(m.cols === 2, `${tag}: two-up gallery (${m.cols} columns, cards ${m.cardW}x${m.cardH})`);
  /* one card was the complaint; a 568 px screen holds two whole ones, the rest four or more */
  gate(m.full >= (h < 700 ? 2 : 4), `${tag}: ${m.full} whole cards on screen at rest`);
  gate(m.cardH <= 200, `${tag}: a card is ${m.cardH} px tall (was 293-333 in the single column)`);
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

  /* -------------------------------------------------- the hover warm-up */
  console.log('warm-up');
  const asked = [];
  page.on('request', q => { if (/pack\.bin/.test(q.url())) asked.push(q.url()); });
  const slug = await page.evaluate(() => document.querySelector('#chooser .card').dataset.slug);
  const meta = manifest.courses.find(c => c.slug === slug);
  await page.hover(`#chooser .card[data-slug="${slug}"]`);
  await page.waitForTimeout(900);
  /* the whole url, mount point included: on a subpath host a leading slash is
     somebody else's site, and "ends with the right file" would not notice */
  const want = `${BASE}/${String(meta.packUrl).replace(/^\//, '')}?v=${meta.sha256.slice(0, 16)}`;
  gate(asked.length === 1 && asked[0] === want,
    `hovering ${slug} warms ${want.replace(BASE, '')} -- the url the player asks for${asked.length ? '' : ' (nothing was fetched)'}${asked.length && asked[0] !== want ? ' -- got ' + asked[0] : ''}`);

  /* ---------------------------------------------------- search and chips */
  console.log('search');
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#chooser .card-item')].filter(c => c.offsetParent).map(c => c.dataset.slug).sort());
  const count = () => page.evaluate(() => document.getElementById('chooserCount').textContent.trim());
  const total = manifest.courses.length;
  await page.keyboard.press('/');
  gate(await page.evaluate(() => document.activeElement?.id === 'courseSearchInput'), '"/" puts the cursor in the search field');
  await page.keyboard.type('västerås');
  const byPlace = await shown();
  gate(byPlace.includes('angso') && byPlace.includes('tortuna') && byPlace.length < total,
    `"västerås" finds by place: ${byPlace.join(', ')} -- ${await count()}`);
  await page.fill('#courseSearchInput', 'par 27');
  const byPar = await shown();
  const par27 = manifest.courses.filter(c => c.par === 27).map(c => c.slug).sort();
  gate(JSON.stringify(byPar) === JSON.stringify(par27), `"par 27" finds by par: ${byPar.join(', ')} (the manifest has ${par27.join(', ')})`);
  gate((await count()) === `${byPar.length} av ${total} banor`, `the count says what matched: "${await count()}"`);
  await page.fill('#courseSearchInput', 'zzzz');
  gate((await shown()).length === 0 && await page.evaluate(() => !!document.getElementById('noCoursesMsg').offsetParent), 'a search that matches nothing says so');
  await page.click('#resetSearchBtn');
  gate((await shown()).length === total && (await count()) === `${total} banor`, `and its button brings all ${total} back`);
  await page.fill('#courseSearchInput', 'vis');
  await page.focus('#courseSearchInput');
  await page.keyboard.press('Escape');
  gate(await page.evaluate(() => document.getElementById('courseSearchInput').value === '') && (await shown()).length === total, 'Escape empties the search field');
  const wantSlott = await page.evaluate(() => [...document.querySelectorAll('#chooser .card-item[data-category="slott"]')].map(c => c.dataset.slug).sort());
  await page.click('.c-filter-btn[data-filter="slott"]');
  const gotSlott = await shown();
  gate(wantSlott.length > 0 && JSON.stringify(gotSlott) === JSON.stringify(wantSlott)
    && await page.evaluate(() => document.querySelector('.c-filter-btn[data-filter="slott"]').getAttribute('aria-pressed') === 'true'
      && document.querySelector('.c-filter-btn[data-filter="all"]').getAttribute('aria-pressed') === 'false'),
    `the Slott chip shows its ${wantSlott.length} courses and says it is pressed`);
  await ctx.close();
});

/* --------------------------------------------- a finger is not a pointer */
await section('touch warm-up', async () => {
  const { ctx, page } = await open({ width: 390, height: 844, touch: true });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  const asked = [];
  page.on('request', q => { if (/pack\.bin/.test(q.url())) asked.push(q.url()); });
  await page.evaluate(() => {
    const card = document.querySelector('#chooser .card');
    card.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch', bubbles: false }));
  });
  await page.waitForTimeout(700);
  gate(asked.length === 0, 'a finger landing on a card to scroll fetches no course pack');
  await ctx.close();
});

/* ----------------------------------------------- the posters, and their cost
   Two things at once, because each alone is easy. The first cut of the two-up
   gallery let the posters become most of the page -- 54 of them, 3.5 MB, inside
   two seconds on a phone -- and the fix for that made a phone's small tiles stay
   still, which the owner looked at and did not want: "the hero photos on the
   mobile version does not seem to roll between the 5 photos". So a phone card
   must ROLL through every one of its stills, and the fetching behind it must
   TRICKLE. The rolling is read off what each card DISPLAYS over time, never off
   what it has loaded: a frame fetched and never shown proves nothing. */
console.log('weight');
const posterLog = page => {
  const seen = [];
  page.on('request', q => { const m = /hero-(\d)\.webp/.exec(q.url()); if (m) seen.push(+m[1]); });
  return seen;
};
await section('phone posters', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const seen = posterLog(page);
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  /* which still each on-screen card SHOWS, once a second: 1 is the resting
     poster, 2-5 the crossfaded extras */
  const shown = new Map();
  const sample = async () => {
    const now = await page.evaluate(() =>
      [...document.querySelectorAll('#chooser .card-item')]
        .filter(i => { const b = i.getBoundingClientRect(); return i.offsetParent && b.bottom > 0 && b.top < innerHeight; })
        .map(i => {
          const on = [...i.querySelectorAll('.shot-frames i')].findIndex(l => l.classList.contains('is-on'));
          return [i.dataset.slug, on < 0 ? 1 : on + 2, i.querySelectorAll('.shot-frames i').length + 1];
        }));
    for (const [slug, frame, held] of now) {
      const r = shown.get(slug) || { frames: new Set(), held: 0 };
      r.frames.add(frame); r.held = held; shown.set(slug, r);
    }
  };
  let extrasAt4 = null;
  for (let t = 1; t <= 32; t++) {
    await page.waitForTimeout(1000);
    await sample();
    if (t === 4) extrasAt4 = seen.filter(n => n > 1).length;
  }
  const cards = [...shown.entries()];
  const want = slug => manifest.courses.find(c => c.slug === slug)?.photos || 1;
  const rolling = cards.filter(([, r]) => r.frames.size >= 3);
  const fullSet = cards.filter(([slug, r]) => r.held >= want(slug));
  gate(cards.length >= 4 && rolling.length === cards.length,
    `phone: all ${cards.length} on-screen cards roll -- each has SHOWN at least 3 different stills in 32 s (${cards.map(([, r]) => r.frames.size).join(' ')})`);
  gate(fullSet.length === cards.length,
    `phone: every on-screen card holds its whole set in rotation (${cards.map(([slug, r]) => `${r.held}/${want(slug)}`).join(' ')})`);
  gate(extrasAt4 !== null && extrasAt4 <= 8,
    `phone, four seconds in: ${extrasAt4} slideshow extras -- a trickle, one at a time (the first cut fetched 41 in two seconds)`);
  await ctx.close();
});
await section('desktop weight', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const seen = posterLog(page);
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(4000);
  const first = seen.filter(n => n === 1).length, extras = seen.length - first;
  gate(first < manifest.courses.length, `desktop: ${first} of ${manifest.courses.length} resting posters fetched -- the ones never scrolled to are not`);
  gate(extras <= 8, `desktop, four seconds in: ${extras} slideshow extras -- a trickle, one at a time (it used to be 24 at once)`);
  await page.waitForTimeout(6000);
  const frames = await page.evaluate(() => [...document.querySelectorAll('#chooser .shot-frames')].filter(f => f.children.length).length);
  gate(frames >= 3, `and the slideshow does run: ${frames} cards hold extra frames ten seconds in`);
  await ctx.close();
});

/* ------------------------------------------------- the last-opened course */
console.log('last opened');
await section('last opened', async () => {
  /* the LAST manifest entry, so leading the list is something it had to be moved to do */
  const last = manifest.courses[manifest.courses.length - 1].slug;
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, last });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  await page.waitForTimeout(500);
  const lead = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#chooser .card-item')];
    const first = items[0], second = items[1];
    const cta = first.querySelector('.shot-hover-action');
    return { slug: first.dataset.slug, lead: first.classList.contains('is-lead'),
      badge: first.querySelector('.current-badge')?.textContent.trim(),
      span: first.getBoundingClientRect().width / second.getBoundingClientRect().width,
      cta: cta && getComputedStyle(cta).opacity === '1' && getComputedStyle(cta).display !== 'none' ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
      leads: items.filter(i => i.classList.contains('is-lead')).length };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-last.png') });
  gate(lead.slug === last && lead.lead && lead.leads === 1, `${last} leads the list (first card is ${lead.slug})`);
  gate(lead.badge === 'Senast spelad', `and says why: "${lead.badge}"`);
  gate(lead.span > 1.8, `on a phone it takes the full width (${lead.span.toFixed(2)}x a card)`);
  gate(!!lead.cta && /Fortsätt/.test(lead.cta), `with a call to action that needs no hover: "${lead.cta}"`);
  await ctx.close();
});
await section('stale memory', async () => {
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, last: 'no-such-course' });
  await page.waitForSelector('#chooser .card', { timeout: 60000 });
  const first = await page.evaluate(() => ({ slug: document.querySelector('#chooser .card-item').dataset.slug, leads: document.querySelectorAll('#chooser .is-lead').length }));
  gate(first.slug === manifest.courses[0].slug && first.leads === 0, 'a remembered course that no longer exists changes nothing');
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
      preview: !!document.querySelector('.map-preview-panel.visible'),
      sideways: chooser.scrollWidth > chooser.clientWidth + 1,
      plates: [...document.querySelectorAll('.golf-map-pin')].filter(p => !p.classList.contains('label-off')).map(p => p.querySelector('.pin-label').getBoundingClientRect()) };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-map.png') });
  gate(m.share >= 0.8 && m.bottomGap <= 40, `phone map fills the screen: ${(100 * m.share).toFixed(0)}% of it, ${m.bottomGap} px under it (was 60% with 199 px of nothing beneath)`);
  gate(!m.preview, 'and opens on the map, not on a preview nobody asked for');
  const clash = m.plates.some((a, i) => m.plates.some((b, j) => j > i && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)));
  gate(!clash && m.plates.length > 0, `no two of the ${m.plates.length} name plates drawn overlap`);
  await page.locator('.golf-map-pin').first().click({ force: true });
  await page.waitForSelector('.map-preview-panel.visible', { timeout: 10000 });
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => {
    const map = document.querySelector('.sweden-map-container').getBoundingClientRect();
    const pv = document.querySelector('.map-preview-panel.visible').getBoundingClientRect();
    const play = document.getElementById('mppPlayBtn').getBoundingClientRect();
    return { share: pv.height / map.height, play: Math.round(play.height) };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-390x844-map-pin.png') });
  gate(p.share <= 0.25 && p.play >= 40, `a tapped pin opens a row, not a poster: ${(100 * p.share).toFixed(0)}% of the map (was 60%), play button ${p.play} px`);
  await page.click('#viewGridBtn');
  await page.waitForTimeout(300);
  gate(await page.evaluate(() => [...document.querySelectorAll('#chooser .card')].filter(c => c.offsetParent).length > 0
    && !!document.getElementById('chooserControls').offsetParent), 'and the cards come back');
  await ctx.close();
});

/* ------------------------------------------- typing is not steering (--player) */
if (PLAYER) {
  console.log('player');
  const slug = manifest.courses[0].slug;
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, url: `/?bana=${slug}&v2=0&q=lo&hal=3` });
  try {
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    await page.evaluate(() => document.getElementById('bytBtn').click());
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
      const first = document.querySelector('#chooser .card-item');
      const close = document.getElementById('chooserResumeBtn').getBoundingClientRect();
      return { slug: first.dataset.slug, badge: first.querySelector('.current-badge')?.textContent.trim(),
        close: Math.min(close.width, close.height), remembered: localStorage.getItem('banvy-last-course') };
    });
    gate(opened.slug === slug && opened.badge === 'Aktiv bana', `in the player the running course leads: ${opened.slug}, "${opened.badge}"`);
    gate(opened.close >= 40, `and the way back is a ${Math.round(opened.close)} px button, not a sentence`);
    gate(opened.remembered === slug, 'the player records the course for the hub to lead with');
    const before = await page.evaluate(() => ({ hole: document.getElementById('cno').textContent, clean: document.body.classList.contains('clean'), sky: window.V3D.skyState() }));
    await page.click('#courseSearchInput');
    await page.keyboard.type('npm h', { delay: 30 });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ hole: document.getElementById('cno').textContent, clean: document.body.classList.contains('clean'), sky: window.V3D.skyState() }));
    gate(JSON.stringify(before) === JSON.stringify(after),
      `letters in the search do not steer the course behind it (hole ${before.hole}->${after.hole}, clean ${before.clean}->${after.clean}, markers ${before.sky}->${after.sky})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const e1 = await page.evaluate(() => ({ q: document.getElementById('courseSearchInput').value, open: document.body.classList.contains('choosing') }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const open2 = await page.evaluate(() => document.body.classList.contains('choosing'));
    gate(e1.q === '' && e1.open && !open2, 'Escape empties the search first and closes the chooser second');
  } catch (e) {
    gate(false, `player: ${String(e).split('\n')[0].slice(0, 110)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} chooser checks failed` : '\nthe chooser measures as designed');
process.exit(bad ? 1 : 0);
