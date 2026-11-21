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
  const day = new Date(Date.now() - (5 - id) * 86400000);
  return roundRecord({ id, startedAt: day.toISOString().slice(0, 10), scores }, layout, {at: day.getTime()});
};
const rounds = [round(1, 18, 7, []), round(2, 9, 4, [2]), round(3, 1, 0, [0]), round(4, 0, 0, [])];
const shot = (id, slug, metres) => ({ course: slug, round: id, hole: 1, club: 'iron-7',
  from: [0, 0], to: [metres, 0], at: Date.now(), fromAccuracy: 3, toAccuracy: 4, outcome: 'played' });
const shots = [...Array.from({ length: 5 }, () => shot(4, course.slug, 175)), shot(5, guest.slug, 121)];
shots[0].aim = shotAim({ source: 'gps', status: 'measured', mode: 'manual', origin: [0, 0], target: [145, 0],
  reading: { plays: 149 }, recommendedClub: { id: 'iron-8' } }, { id: 'iron-7', carry: 140 });

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: {width, height}, hasTouch: width === 390, reducedMotion: 'reduce' });
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
      await latest.locator('[data-jump-round]').click();
      assert.equal(await detail(4).getAttribute('open'), '');
      assert.match(await detail(4).innerText(), /Eget mål 145 m/);
      assert.match(await detail(4).innerText(), /Återupplev i 3D/);
      await dashboard.locator('[data-view="clubs"]').click();
      const iron = dashboard.locator('#st-clubs tr').filter({hasText: 'Järn 7'});
      assert.match(await iron.innerText(), /175 m/);
      assert.match(await iron.innerText(), /140 m/);
      assert.equal(await page.evaluate(() => localStorage.getItem('banvy-caddie-bag-v1')), bag);
      await dashboard.locator('[data-course]').selectOption(guest.slug);
      assert.match(await dashboard.locator('#st-clubs').innerText(), /1 GPS-uppmätta slag/);
      assert.equal(await dashboard.locator('.st-hero-figure').count(), 0);
      assert.equal(await dashboard.locator('[data-reset]').count(), 0);
      await page.goto(base + '/#statistik/' + course.slug + '/2');
      await detail(2).locator('summary').waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('details')?.dataset.roundKey?.endsWith('|2'));
      assert.match(await detail(2).innerText(), /2 puttar på 1 av 9 hål/);
      assert.match(await detail(2).innerText(), /2\*/);
      const bounds = await detail(2).locator('summary').boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y < height);
      assert.ok(await dashboard.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.goto(base + '/#statistik/' + course.slug + '/missing');
      await dashboard.getByText('Rundan finns inte i din sparade historik.').waitFor();
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
} finally { await browser.close(); }
