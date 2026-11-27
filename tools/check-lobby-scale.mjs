/* The unified lobby and its Sverigekarta with a hundred clubs (docs/start-menu.md,
   "A hundred clubs"). Today's catalogue is served with 110 made-up clubs beside it,
   so the lobby has to list the golfer's own and search the rest, and the map has to
   group its pins; then today's catalogue is opened as it is, to show none of that
   touches it.

   usage: node tools/check-lobby-scale.mjs [baseUrl]   (default http://127.0.0.1:8620/) */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { groupCourses } from '../apps/golf/src/shell/course-clubs.mjs';
import { LOBBY_SHORT_LIST, LOBBY_SHORT_LIST_PHONE } from '../apps/golf/src/shell/lobby-model.mjs';
import { PIN_GROUP_PX } from '../apps/golf/src/shell/pin-groups.mjs';
import { storeRounds } from '../apps/golf/src/map/map-rounds.mjs';

const base = (process.argv.slice(2).find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:8620/').replace(/\/?$/, '/');
const MADE_UP = 110;
const VASTERAS = { latitude: 59.6099, longitude: 16.5448 };
const DEVICES = [
  /* the returning golfer last played in this mode, which the lobby's links follow */
  { label: 'phone 390x844', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, limit: LOBBY_SHORT_LIST_PHONE, lastMode: 'map', route: 'karta', mapBtn: '[data-view-quick]' },
  { label: 'desktop 1440x900', options: { viewport: { width: 1440, height: 900 } }, limit: LOBBY_SHORT_LIST, lastMode: 'detailed', route: '3d', mapBtn: '#lobbyViewMap' },
];

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const probe = await browser.newContext();
const today = await (await probe.request.get(new URL('courses/index.json', base).href)).json();
await probe.close();
const template = today.courses.find(course => course.slug === 'tortuna');
/* a copy of Tortuna's record with every word that describes Tortuna replaced, so a
   search finds a made-up club only by its own name */
const big = { ...today, courses: [...today.courses, ...Array.from({ length: MADE_UP }, (_, i) => ({
  ...template, slug: `testklubb-${i + 1}`, name: `Testklubb ${i + 1}`, club: `Testklubb ${i + 1} GK`,
  title: `Testklubb ${i + 1} — Banan i 3D`, tag: 'Testbana', boot: 'Testbana', photos: 0,
}))] };
const clubsIn = catalogue => groupCourses(catalogue.courses.filter(course => course.status !== 'mapping')).length;
const CLUBS = clubsIn(big), TODAY = clubsIn(today);

/* a golfer who has been here before: the last course, the courses launched lately
   (settings-store.mjs rememberLaunch) and a round the map kept */
const now = Date.now(), DAY = 86_400_000;
const returning = lastMode => ({
  'banvy-last-course': 'bro-hof-castle',
  'banvy-last-mode': lastMode,
  'banvy-recent-courses-v1': JSON.stringify([
    { slug: 'bro-hof-castle', at: now - 3_600_000 }, { slug: 'testklubb-42', at: now - DAY }, { slug: 'angso', at: now - 3 * DAY },
    { slug: 'testklubb-7', at: now - 9 * DAY }, { slug: 'testklubb-8', at: now - 10 * DAY }, { slug: 'testklubb-9', at: now - 11 * DAY },
    { slug: 'testklubb-10', at: now - 12 * DAY }, { slug: 'testklubb-11', at: now - 13 * DAY }, { slug: 'testklubb-12', at: now - 14 * DAY },
  ]),
  'banvy-map-rounds-v1': storeRounds([{ id: now - 2 * DAY, course: 'visby', courseName: 'Visby GK', date: now - 2 * DAY - 14_400_000, endedAt: now - 2 * DAY, holes: [] }]),
});

async function open(options, { catalogue = big, storage = null, geolocation = null, path = '' } = {}) {
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block',
    ...(geolocation ? { permissions: ['geolocation'], geolocation } : {}) });
  if (catalogue !== today) await context.route('**/courses/index.json', route => route.fulfill({ json: catalogue }));
  await context.route(/tile\.openstreetmap\.org/, route => route.abort());
  /* seeded once, so what the page writes afterwards stands */
  if (storage) await context.addInitScript(entries => {
    if (sessionStorage.getItem('banvy-check-seeded')) return;
    sessionStorage.setItem('banvy-check-seeded', '1');
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, storage);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + path);
  if (!path) await page.locator('#home .home-clubs:not([hidden])').waitFor();
  return { context, page, errors };
}

const lobby = page => page.evaluate(() => {
  const home = document.getElementById('home');
  /* what is drawn, not what is marked: a rule that sets display overrides hidden */
  const shown = selector => { const node = home.querySelector(selector); return node?.getClientRects().length ? node : null; };
  const navControls = [...document.querySelectorAll('#home a, #home button, #home input, #hubTabBar a')]
    .filter(node => node.offsetParent && !node.closest('[hidden]'));
  return {
    rows: [...home.querySelectorAll('.home-club')].map(row => ({ id: row.dataset.club, note: row.querySelector('.hc-note, .hc-live')?.textContent.trim() ?? '' })),
    heading: home.querySelector('[data-clubs-heading]')?.textContent ?? '',
    count: home.querySelector('[data-clubs-count]')?.textContent ?? '',
    note: shown('[data-clubs-note]')?.textContent ?? '',
    search: Boolean(shown('#homeClubQuery')),
    near: Boolean(shown('[data-clubs-near]')),
    nearLabel: home.querySelector('[data-near-label]')?.textContent ?? '',
    showAll: shown('[data-show-all]') ? home.querySelector('[data-show-all-label]').textContent : '',
    resume: [...home.querySelectorAll('.home-resume-slot [data-club-id]')].map(card => card.dataset.clubId),
    navVisible: Boolean(shown('.lobby-nav-link') || document.querySelector('#hubTabBar')?.getClientRects().length),
    vh: innerHeight,
    sideways: home.scrollWidth > home.clientWidth + 1,
    small: navControls
      .map(node => ({ node, box: node.getBoundingClientRect() })).filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ node, box }) => `${node.className || node.tagName} ${Math.round(box.width)}x${Math.round(box.height)}`),
  };
});
const settle = page => page.waitForTimeout(150);

for (const { label, options, limit, lastMode, route, mapBtn } of DEVICES) {
  /* ---- a first visit: nothing of the golfer's own, the search and the near clubs on offer */
  {
    const { context, page, errors } = await open(options);
    const m = await lobby(page);
    assert.equal(m.rows.length, 0, `${label}: a first visit lists no club of its own`);
    assert.ok(m.search && m.near, `${label}: it offers the search and Klubbar nära mig`);
    assert.match(m.note, new RegExp(`Sök bland ${CLUBS} klubbar`), `${label}: and says how many clubs the search covers`);
    assert.equal(m.showAll, `Visa alla ${CLUBS} klubbar`);
    assert.ok(m.navVisible, `${label}: primary navigation (Statistik / Inställningar) is immediately reachable`);
    assert.ok(!m.sideways && m.small.length === 0, `${label}: nothing sideways, every target 44 px ${m.small.join(', ')}`);
    /* asking for the position belongs to this tap; refused, it says so and offers a retry */
    await page.locator('[data-clubs-near]').click();
    await page.locator('[data-near-label]', { hasText: 'Försök igen' }).waitFor();
    assert.match((await lobby(page)).note, /Banvy fick ingen position/, `${label}: a refused position is said, not silent`);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(VASTERAS);
    await page.locator('[data-clubs-near]').click();
    await page.waitForFunction(() => document.querySelector('#home .home-club'));
    const near = await lobby(page);
    assert.ok(!near.near && near.heading === 'Närmast dig', `${label}: with the position given, the nearest clubs stand in its place`);
    assert.deepEqual(near.rows.slice(0, 2).map(row => row.id).sort(), ['angso', 'tortuna'], `${label}: Västerås's own clubs first`);
    assert.ok(near.rows.length <= limit && near.rows.every(row => / km bort$/.test(row.note)), `${label}: each with its distance`);
    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
  }

  /* ---- a returning golfer: the clubs of their own, newest first, never the one on the card above */
  {
    const { context, page, errors } = await open(options, { storage: returning(lastMode) });
    const m = await lobby(page);
    assert.deepEqual(m.resume, ['bro-hof'], `${label}: Senast öppnad shows Bro Hof's Castle Course`);
    assert.equal(m.heading, 'Dina klubbar');
    assert.equal(m.rows.length, limit, `${label}: ${limit} clubs of the golfer's own, however many are kept`);
    assert.ok(!m.rows.some(row => row.id === 'bro-hof'), `${label}: Bro Hof is not repeated under its own card`);
    assert.deepEqual(m.rows.slice(0, 3).map(row => [row.id, row.note]),
      [['testklubb-42', 'Öppnad i går'], ['visby', 'Spelad ' + (await page.evaluate(at => new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(at).replace(/\.(?=\s|$)/g, ''), now - 2 * DAY))], ['angso', m.rows[2].note]],
      `${label}: launches and kept rounds by time, each saying when`);
    assert.ok(!m.sideways && m.small.length === 0, `${label}: nothing sideways, every target 44 px ${m.small.join(', ')}`);

    /* ---- the search: by name, layout and town, every hit counted, the rest a tap away */
    const query = page.locator('#homeClubQuery');
    if (!options.hasTouch) {
      await page.locator('body').press('/');
      assert.ok(await query.evaluate(node => node === document.activeElement), `${label}: / reaches the search`);
    }
    await query.fill('castle');
    await settle(page);
    let s = await lobby(page);
    assert.deepEqual([s.count, s.rows.map(row => row.id)], ['1 klubb', ['bro-hof']], `${label}: a layout's name finds its club, even the one on the card above`);
    await query.fill('Västerås');
    await settle(page);
    assert.deepEqual((await lobby(page)).rows.map(row => row.id).sort(), ['angso', 'tortuna'], `${label}: a town finds its clubs`);
    await query.fill('ingenstans alls');
    await settle(page);
    s = await lobby(page);
    assert.ok(s.rows.length === 0 && /Ingen klubb matchar/.test(s.note), `${label}: no hit says so`);
    await query.fill('testklubb');
    await settle(page);
    s = await lobby(page);
    assert.deepEqual([s.count, s.rows.length, s.showAll], [`${MADE_UP} klubbar`, limit, `Visa alla ${MADE_UP} träffar`], `${label}: every hit counted, ${limit} shown`);
    assert.deepEqual(s.rows.slice(0, 3).map(row => row.id), ['testklubb-1', 'testklubb-2', 'testklubb-3'], `${label}: numbers in their order`);
    await page.locator('[data-show-all]').click();
    await settle(page);
    assert.equal((await lobby(page)).rows.length, MADE_UP, `${label}: expanding shows all ${MADE_UP} hits in place`);
    await query.focus();
    await query.press('Escape');
    await settle(page);
    s = await lobby(page);
    assert.ok(s.heading === 'Dina klubbar' && s.rows.length === limit, `${label}: Escape empties the search and the golfer's own clubs return`);
    /* a hit opens its club's page over the lobby, and Back returns to the row */
    await query.fill('castle');
    await settle(page);
    await page.locator('#homeClub-bro-hof').click();
    await page.locator('#courseSheet[open]').waitFor();
    assert.match(page.url(), new RegExp(`#klubb/bro-hof\\?bana=bro-hof-castle&lage=${route}`), `${label}: on the layout matched by search`);
    await page.goBack();
    await page.locator('#courseSheet[open]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.id === 'homeClub-bro-hof');
    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
  }

  /* ---- the Sverigekarta: pins that would stand on each other are one group with a count */
  {
    const { context, page, errors } = await open(options);
    await page.locator(mapBtn).click();
    await page.locator('.golf-map-group').first().waitFor();
    await page.waitForTimeout(400);
    const marks = () => page.evaluate(() => {
      const centre = node => { const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; };
      return {
        pins: [...document.querySelectorAll('.golf-map-pin')].map(pin => ({ id: pin.dataset.clubId, ...centre(pin.querySelector('.pin-head')) })),
        groups: [...document.querySelectorAll('.golf-map-group')].map(group => ({ ids: group.dataset.groupIds.split(' '), count: Number(group.textContent), ...centre(group) })),
      };
    });
    const m = await marks();
    const drawn = [...m.pins, ...m.groups];
    const located = m.pins.length + m.groups.reduce((sum, group) => sum + group.count, 0);
    assert.equal(located, TODAY, `${label}: every located club is a pin or in a group's count`);
    assert.ok(m.groups.every(group => group.count === group.ids.length && group.count > 1), `${label}: a group's count is its clubs`);
    const touching = drawn.flatMap((a, i) => drawn.slice(i + 1).filter(b => Math.hypot(a.x - b.x, a.y - b.y) <= PIN_GROUP_PX - 6).map(b => `${a.id ?? a.ids} / ${b.id ?? b.ids}`));
    assert.deepEqual(touching, [], `${label}: nothing drawn stands on anything else`);
    /* Enter on the largest group zooms in on its clubs. The keyboard lands on the first
       club's own pin, or on the smaller group that still holds it, where Enter goes on:
       how many steps that takes depends on the map's size, so it is counted, not fixed. */
    const largest = m.groups.reduce((a, b) => (b.count > a.count ? b : a));
    const first = largest.ids[0];
    const map = await page.locator('.map-canvas-wrap').boundingBox();
    const groupBox = () => page.locator(`.golf-map-group[data-group-ids="${largest.ids.join(' ')}"]`).boundingBox();
    const outside = box => Boolean(box) && box.x + box.width > map.x + map.width;
    await page.locator('.map-canvas-wrap').focus();
    let atEdge = await groupBox();
    for (let press = 0; press < 40 && !outside(atEdge); press++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(350);
      atEdge = await groupBox();
    }
    assert.ok(outside(atEdge), `${label}: the group stands at the map's edge, half out of view (group ${JSON.stringify(atEdge)}, map ${JSON.stringify(map)})`);
    await page.locator(`.golf-map-group[data-group-ids="${largest.ids.join(' ')}"]`).locator('..').focus();
    const holding = () => page.evaluate(id => {
      const active = document.activeElement;
      if (!active?.classList?.contains('leaflet-marker-icon')) return 0;
      if (active.querySelector(`.golf-map-pin[data-club-id="${id}"]`)) return 1;
      const group = active.querySelector('.golf-map-group');
      return group?.dataset.groupIds.split(' ').includes(id) ? group.dataset.groupIds.split(' ').length : 0;
    }, first);
    const steps = [largest.count];
    while (steps.at(-1) > 1 && steps.length <= 5) {
      await page.keyboard.press('Enter');
      await page.waitForFunction(([id, before]) => {
        const active = document.activeElement;
        if (!active?.classList?.contains('leaflet-marker-icon')) return false;
        if (active.querySelector(`.golf-map-pin[data-club-id="${id}"]`)) return true;
        const group = active.querySelector('.golf-map-group');
        return Boolean(group?.dataset.groupIds.split(' ').includes(id)) && group.dataset.groupIds !== before;
      }, [first, steps.length === 1 ? largest.ids.join(' ') : null], { timeout: 15000 }).catch(async error => {
        const where = await page.evaluate(() => ({
          active: `${document.activeElement?.tagName}.${String(document.activeElement?.className).slice(0, 60)}`,
          sheet: Boolean(document.querySelector('#courseSheet[open]')),
          groups: [...document.querySelectorAll('.golf-map-group')].map(group => group.dataset.groupIds),
        }));
        throw new Error(`${label}: after Enter ${steps.length} on a group holding ${first} (${steps.join(' -> ')}), the keyboard is not on it: ${JSON.stringify(where)}. ${error.message.split('\n')[0]}`);
      });
      steps.push(await holding());
    }
    assert.equal(steps.at(-1), 1, `${label}: Enter zooms in until the group's first club has its own pin, the keyboard with it (${steps.join(' -> ')})`);
    assert.ok(steps.every((size, i) => i === 0 || size <= steps[i - 1]), `${label}: no Enter leaves the club in a larger group (${steps.join(' -> ')})`);
    const after = await marks();
    assert.ok(after.pins.length > m.pins.length, `${label}: the group's clubs get their own pins (${m.pins.length} -> ${after.pins.length})`);
    /* a pin that came back out of a group keeps its name and opens its club from the keyboard */
    const freed = page.locator(`.golf-map-pin[data-club-id="${first}"]`).locator('..');
    assert.ok(await freed.getAttribute('aria-label'), `${label}: the freed pin keeps its name`);
    await page.keyboard.press('Enter');
    await page.locator('#courseSheet[open]').waitFor({ timeout: 15000 });
    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
  }
  console.log(`PASS · ${label}: ${CLUBS} clubs -- a first visit, a returning golfer's ${limit}, the search, the nearest and the map's groups`);
}

/* ---- today's catalogue: every club listed by name, every pin its own */
for (const { label, options, mapBtn } of DEVICES) {
  const { context, page, errors } = await open(options, { catalogue: today });
  const m = await lobby(page);
  assert.ok(m.rows.length === TODAY && m.search && !m.near && !m.showAll,
    `${label}: today's ${TODAY} clubs are all listed in the unified lobby with inline search`);
  await page.locator(mapBtn).click();
  await page.locator('.golf-map-pin').first().waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual([await page.locator('.golf-map-pin').count(), await page.locator('.golf-map-group').count()], [TODAY, 0],
    `${label}: and the map keeps one pin per club, no groups`);
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await context.close();
}
console.log(`PASS · today's ${TODAY} clubs: the lobby lists them all and the map draws every pin`);
await browser.close();
