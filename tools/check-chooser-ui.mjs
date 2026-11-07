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

   THE START MENU (7 November). The bare route is now a menu -- the two ways
   to play and the settings -- and the list is one step in, at #3d or #karta,
   so the measurements above are taken there. The menu has gates of its own:
   all three cards whole on screen on a phone and a laptop, the mode each
   device is best at marked, every launch URL saying the mode it was picked in
   (karta=0 on a phone for the detailed course, karta=1 for the map) with the
   settings' launch values, settings that land in the keys the programs read,
   a reset that leaves the bag alone, and back and Escape that walk the screens.

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
/* the course list, one step in from the start menu */
const LIST = '/#3d';
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

async function open({ width, height, touch = false, last = null, url = LIST, blockWorker = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch,
    /* a navigation the service worker answers never reaches page.route */
    ...(blockWorker ? { serviceWorkers: 'block' } : {}),
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
  await page.goto(BASE + LIST, { waitUntil: 'load', timeout: 120000 });
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
  await page.goto(BASE + LIST, { waitUntil: 'load', timeout: 120000 });
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
    const { ctx, page, errs } = await open({ width: w, height: h, touch, last: manifest.courses[3].slug, url: '/' });
    await page.waitForSelector('#home .mode-card', { timeout: 60000 });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#home .mode-card')].map(c => ({ mode: c.dataset.mode, r: c.getBoundingClientRect(),
        badge: !!c.querySelector('.mc-badge') }));
      const home = document.getElementById('home');
      const small = [...home.querySelectorAll('a, button')].filter(e => e.offsetParent)
        .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.width < 44 || x.b.height < 44)
        .map(x => `${x.e.className || x.e.tagName} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
      return { cards: cards.map(c => ({ mode: c.mode, top: Math.round(c.r.top), bottom: Math.round(c.r.bottom), badge: c.badge })),
        resume: document.querySelector('#home [data-resume]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        chooser: !!document.getElementById('chooser') && !document.getElementById('chooser').hidden,
        sideways: home.scrollWidth > home.clientWidth + 1, small, vh: innerHeight };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `home-${w}x${h}.png`) });
    const tag = `${name} ${w}x${h}`;
    gate(m.cards.map(c => c.mode).join(',') === 'detailed,map,stats,settings', `${tag}: four cards, Detaljerad 3D, Lätt 3D, Statistik, Inställningar (${m.cards.map(c => c.mode).join(', ')})`);
    gate(m.cards.every(c => c.top >= 0 && c.bottom <= m.vh), `${tag}: all four whole on screen without scrolling (${m.cards.map(c => `${c.top}-${c.bottom}`).join(', ')} of ${m.vh})`);
    const marked = m.cards.filter(c => c.badge).map(c => c.mode);
    gate(marked.length === 1 && marked[0] === (touch ? 'map' : 'detailed'), `${tag}: the mode this device is best at is marked (${marked.join(', ') || 'none'})`);
    gate(!!m.resume && m.resume.includes(manifest.courses[3].name), `${tag}: Fortsätt offers the last course: "${m.resume}"`);
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
    const sheet = await page.evaluate(() => {
      const d = document.getElementById('courseSheet');
      const small = [...d.querySelectorAll('button, .cs-tee span, .cs-mode, .seg-opt')].filter(e => e.offsetParent)
        .map(e => ({ e, b: e.getBoundingClientRect() })).filter(x => x.b.height < 40)
        .map(x => `${String(x.e.className).split(' ')[0] || x.e.tagName} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
      const go = d.querySelector('[data-go]').getBoundingClientRect();
      return { title: d.querySelector('#csTitle').textContent, tees: d.querySelectorAll('.cs-tee').length, go: go.bottom <= innerHeight && go.top >= 0,
        mode: d.querySelector('input[name="cs-mode"]:checked')?.value, small };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'course-sheet-390x844.png') });
    gate(sheet.title === course.name && sheet.tees === course.tees.names.length && sheet.mode === 'detailed',
      `phone: a card opens its course's page first (${sheet.title}, ${sheet.tees} tees, mode ${sheet.mode})`);
    gate(sheet.go && sheet.small.length === 0, `phone: its start button is on screen and every choice is a 40 px target${sheet.small.length ? ' -- ' + sheet.small.join(', ') : ''}`);
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
    const cta = await page.evaluate(s => document.querySelector(`#chooser .card-item[data-slug="${s}"] .sha-text`)?.textContent, slug);
    gate(/kartan|Fortsätt/.test(cta || ''), `phone: in Lätt 3D the card says what it opens: "${cta}"`);
    await startFromSheet(page, slug, { tee: 1 });
    const m = seen[0] ? paramsOf(seen[0]) : {};
    gate(seen.length === 1 && m.karta === '1' && m.runda === '1', `phone: Starta rundan opens ${seen[0]?.replace(BASE, '')} -- karta=1 and the round begun`);
    seen.length = 0;
    await page.goto(BASE + '/#karta', { waitUntil: 'load' });
    await page.waitForSelector('#chooser:not([hidden]) .card');
    await startFromSheet(page, slug, { look: true });
    gate(seen.length === 1 && paramsOf(seen[0]).karta === '1' && !('runda' in paramsOf(seen[0])), `phone: Bara titta opens the map without a round: ${seen[0]?.replace(BASE, '')}`);
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

await section('mode switch and the way back', async () => {
  const { ctx, page } = await open({ width: 1440, height: 900, url: '/' });
  await page.waitForSelector('#home .mode-card');
  await page.keyboard.press('1');
  await page.waitForSelector('#chooser:not([hidden]) .card');
  gate(await page.evaluate(() => location.hash) === '#3d', 'the key 1 opens Detaljerad 3D');
  await page.click('.c-mode-btn[data-mode="map"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ hash: location.hash, checked: document.querySelector('.c-mode-btn[aria-checked="true"]')?.dataset.mode,
    cta: document.querySelector('#chooser .card-item .sha-text')?.textContent, title: document.title }));
  gate(after.hash === '#karta' && after.checked === 'map' && /kartan|Fortsätt/.test(after.cta) && /Lätt 3D/.test(after.title),
    `switching to Lätt 3D in place: ${after.hash}, "${after.cta}", "${after.title}"`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  gate(await page.evaluate(() => !document.getElementById('home').hidden && document.getElementById('chooser').hidden && location.hash === ''),
    'Escape goes back to the start menu (the switch replaced its step, so one back is enough)');
  await page.click('#home [data-settings]');
  await page.waitForSelector('#settings:not([hidden])');
  await page.goBack();
  await page.waitForTimeout(500);
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
  await page.click('.seg[data-name="quality"] .seg-opt:has(input[value="hi"])');
  await page.click('.swatches[data-name="maplight"] .swatch:has(input[value="dis"])');
  await page.click('.set-switch:has([data-switch="sun"])');
  await page.click('.seg[data-name="fps"] .seg-opt:has(input[value="30"])');
  const stored = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('banvy-settings-v1') || '{}'), light: localStorage.getItem('banvy-map-light-v1'),
    display: JSON.parse(localStorage.getItem('banvy-map-display-v1') || '{}'), fps: localStorage.getItem('banvy-fps'),
    saved: document.querySelector('[data-saved]').classList.contains('is-on') }));
  gate(stored.s.quality === 'hi' && stored.light === 'dis' && stored.display.sun === true && stored.fps === '30' && stored.saved,
    `each choice lands in the key its program reads, and says so (q ${stored.s.quality}, map light ${stored.light}, sun ${stored.display.sun}, fps ${stored.fps})`);
  await page.click('[data-reset]');
  await page.click('[data-reset]');
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => ({ s: localStorage.getItem('banvy-settings-v1'), light: localStorage.getItem('banvy-map-light-v1'), bag: localStorage.getItem('banvy-caddie-bag-v1'),
    checked: document.querySelector('.seg[data-name="quality"] input:checked')?.value }));
  gate(reset.s === null && reset.light === null && reset.bag === bag && reset.checked === 'auto', 'Återställ clears the preferences, shows the defaults, and leaves the bag alone');
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
    await page.click('#stats .seg-opt:has(input[value="90"])');
    await page.waitForTimeout(300);
    const narrowed = await page.evaluate(() => Number(document.querySelector('#stats .st-tile dd').textContent));
    gate(narrowed > 0 && narrowed < m.rounds, `${w}x${h}: 90 dagar narrows every figure (${narrowed} of ${m.rounds} rounds)`);
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
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, url: `/?bana=${slug}&q=lo&hal=3` });
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

    /* The menu listed 1-9, 0, C, L and F; until engine/keyboard-shortcuts.mjs
       only the arrows, N/P, H and M did anything. */
    const read = () => page.evaluate(() => ({ hole: document.getElementById('cno').textContent.trim(),
      cam: document.querySelector('#rail [data-cam].on')?.dataset.cam, light: document.querySelector('#rail [data-preset].on')?.dataset.preset }));
    const holes = await page.evaluate(() => document.querySelectorAll('#holes .hb').length);
    await page.keyboard.press('7');
    await page.waitForTimeout(300);
    gate((await read()).hole === '7', `"7" goes to hole 7 (${(await read()).hole})`);
    if (holes >= 14) {
      await page.keyboard.press('1'); await page.keyboard.press('4');
      await page.waitForTimeout(300);
      gate((await read()).hole === '14', `"1", "4" goes to hole 14 (${(await read()).hole})`);
      await page.keyboard.press('1');
      await page.waitForTimeout(1200);
      gate((await read()).hole === '1', `a lone "1" goes to hole 1 once the second digit does not come (${(await read()).hole})`);
      await page.keyboard.press('0');
      await page.waitForTimeout(300);
      gate((await read()).hole === '10', `"0" goes to hole 10 (${(await read()).hole})`);
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
    await page.evaluate(() => document.getElementById('menuToggle').click());
    await page.waitForTimeout(500);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#navDrawer .sc-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    gate(listed.some(t => t.includes('Byt kameravy')) && listed.some(t => t.includes('Hål 10')), `the menu lists the working keys (${listed.length} rows)`);
    const inMenu = (await read()).hole;
    await page.keyboard.press('5');
    await page.waitForTimeout(300);
    gate((await read()).hole === inMenu, `keys do not steer the course behind the open menu (hole ${inMenu} -> ${(await read()).hole})`);
    await page.keyboard.press('Escape');
  } catch (e) {
    gate(false, `player: ${String(e).split('\n')[0].slice(0, 110)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} chooser checks failed` : '\nthe chooser measures as designed');
process.exit(bad ? 1 : 0);
