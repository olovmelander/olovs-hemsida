/* Browser smoke gate for the three connected caddie features. It deliberately
   uses one already-booted course: the expensive renderer is not the subject of
   this test, the interactions layered on it are. */
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8620';
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.grantPermissions(['geolocation'], { origin: new URL(BASE).origin });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(`${BASE}/?bana=angso&det=1&q=lo&gl=1`, { waitUntil: 'load', timeout: 120_000 });
await page.waitForSelector('#boot.done', { timeout: 420_000 });

let state = await page.evaluate(() => window.V3D.caddie());
gate(state.strategyOn && state.strategy?.zones?.length > 0, 'strategy starts with a rendered landing zone');
gate(state.strategy.arcs.length > 0, 'strategy carries distance arcs for the selected tee');
gate(state.visual.activeWidths.every(width => width < 1) && state.visual.arcCount < state.strategy.arcs.length, 'strategy keeps the active line and distance references visually restrained');

await page.click('#strategyBtn');
const toggled = await page.evaluate(() => ({
  state: window.V3D.caddie(),
  buttonOn: document.getElementById('strategyBtn').classList.contains('on'),
  pressed: document.getElementById('strategyBtn').getAttribute('aria-pressed'),
}));
gate(!toggled.state.strategyOn && !toggled.buttonOn && toggled.pressed === 'false', 'strategy toggle has honest accessible state');
await page.click('#strategyBtn');

await page.click('#bagBtn');
gate(await page.locator('#bagDialog').evaluate(element => element.open), 'bag opens as a modal editor');
const initialClubCount = await page.locator('#bagList .bag-row').count();
gate(initialClubCount > 9, 'bag offers a complete default carry set');
await page.click('#bagAddBtn');
gate(await page.locator('#bagList .bag-row').count() === 14 && await page.locator('#bagAddBtn').isDisabled(), 'bag supports fourteen clubs and communicates its limit');
await page.locator('#bagList .bag-remove').last().click();
gate(await page.locator('#bagList .bag-row').count() === 13, 'a club can be removed without leaving the editor');
await page.locator('#bagList .bag-distance').first().fill('225');
await page.click('.bag-save');
state = await page.evaluate(() => window.V3D.caddie());
gate(state.bag[0].carry === 225, 'edited carry is saved into the caddie state');

await page.click('#rangeBtn');
gate(await page.locator('#kikOut .kik-recommend').count() === 1, 'Kikaren shows one glove-readable club recommendation');

const fix = await page.evaluate(() => {
  const V = window.V3D, p = V.HOLES[0].tees.marks[0].c;
  return {
    latitude: V.GEO.origin.lat - p[1] / 111320,
    longitude: V.GEO.origin.lon + p[0] / V.GEO.mPerLon,
  };
});
await context.setGeolocation({ ...fix, accuracy: 6 });
await page.click('#gpsBtn');
await page.waitForFunction(() => document.getElementById('gpsStatus')?.dataset.state === 'live', null, { timeout: 30_000 });
state = await page.evaluate(() => window.V3D.caddie());
gate(state.gps.active && state.gps.point && state.gps.accuracy === 6, 'GPS fix enters the course frame with accuracy intact');
gate(await page.locator('#kikOut .kik-live').count() === 1, 'GPS drives Kikaren as the live ball position');
if (process.env.BANVY_CADDIE_SHOT) {
  await page.screenshot({ path: process.env.BANVY_CADDIE_SHOT, animations: 'disabled', timeout: 300_000 });
}

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({
  hud: document.getElementById('mobileHudBar').getBoundingClientRect(),
  gps: document.getElementById('gpsStatus').getBoundingClientRect(),
  bodyWidth: document.body.scrollWidth,
}));
gate(mobile.hud.left >= 0 && mobile.hud.right <= 390 && mobile.bodyWidth <= 390, 'mobile caddie controls fit without horizontal overflow');
gate(mobile.gps.left >= 0 && mobile.gps.right <= 390, 'live GPS card stays inside the mobile viewport');
gate(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);

await browser.close();
