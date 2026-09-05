/* Browser smoke gate for the three connected caddie features. It deliberately
   uses one already-booted course: the expensive renderer is not the subject of
   this test, the interactions layered on it are. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8620';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.grantPermissions(['geolocation'], { origin: new URL(BASE).origin });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
/* the live weather is a third-party fetch the UI already treats as optional
   ("Ingen vinddata" on the sheet); a proxy that resets it is the offline case,
   not a caddie failure, so it is reported and not counted */
const weatherFailures = [];
page.on('requestfailed', request => { if (/open-meteo/.test(request.url())) weatherFailures.push(request.failure()?.errorText); });
page.on('console', message => {
  if (message.type() === 'error' && !(/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(message.text()) && weatherFailures.length)) errors.push(message.text());
});

const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(`${BASE}/?bana=angso&det=1&q=lo&gl=1&v2=0`, { waitUntil: 'load', timeout: 120_000 });
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

/* On a phone the course is the product and the readout must not cover it: the
   green distances stand in a narrow stack at the right edge, the tapped number
   floats at the point, and the sheet rests as one row above the quick actions.
   Every rectangle here is measured, because the layout that shipped before this
   was a 640 px card over the fairway and every data gate passed. */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.V3D.setCam('orbit', true));
const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const mobile = await page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect().toJSON();
  const q = sel => document.querySelector(sel).getBoundingClientRect().toJSON();
  return { hud: r('mobileHudBar'), gps: r('gpsStatus'), pill: q('#gpsStatus .gps-pill'), locate: r('gpsFollowBtn'),
           green: r('kikGreen'), sheet: r('kikOut'), card: r('card'), holes: r('holesContainer'),
           bodyWidth: document.body.scrollWidth, sheetOpen: window.V3D.caddie().kik.sheetOpen };
});
gate(mobile.hud.left >= 0 && mobile.hud.right <= 390 && mobile.bodyWidth <= 390, 'mobile caddie controls fit without horizontal overflow');
gate(mobile.gps.left >= 0 && mobile.gps.right <= 390 && mobile.pill.right <= 390 && mobile.pill.height <= 44,
     `live GPS state is a pill inside the viewport (${Math.round(mobile.pill.width)}x${Math.round(mobile.pill.height)} px)`);
gate(mobile.locate.width >= 36 && mobile.locate.right <= 390 && !overlaps(mobile.locate, mobile.pill), 'the locate button stands clear of the pill');
gate(mobile.green.width > 0 && mobile.green.width <= 120 && mobile.green.right <= 390 && mobile.green.left > 195
     && mobile.green.top >= mobile.card.bottom && mobile.green.top >= mobile.locate.bottom,
     `green distances are a narrow stack at the right edge (${Math.round(mobile.green.width)} px wide, top ${Math.round(mobile.green.top)})`);
gate(!mobile.sheetOpen && mobile.sheet.top >= 844 * 0.6 && mobile.sheet.bottom <= mobile.hud.top && mobile.sheet.left >= 0 && mobile.sheet.right <= 390,
     `the kikaren sheet rests as a row in the bottom ${Math.round(100 - mobile.sheet.top / 8.44)}% of the screen, above the quick actions`);
gate(!overlaps(mobile.green, mobile.sheet) && !overlaps(mobile.green, mobile.gps) && !overlaps(mobile.pill, mobile.green),
     'no two readout surfaces overlap');

/* a tap puts the number at the point, not in a panel */
await page.evaluate(() => window.V3D.kikMeasure(195, 430));
await page.waitForFunction(() => getComputedStyle(document.getElementById('kikTag')).opacity === '1', null, { timeout: 10_000 }).catch(() => {});
const tapped = await page.evaluate(() => {
  const c = window.V3D.caddie().kik;
  const tag = document.getElementById('kikTag');
  const box = tag.querySelector('.kt-box').getBoundingClientRect().toJSON();
  return { point: c.point, tag: c.tag, hidden: tag.hidden, opacity: getComputedStyle(tag).opacity, box, text: tag.textContent };
});
gate(tapped.point && tapped.tag && !tapped.hidden && tapped.opacity === '1', 'a tapped point gets a floating distance tag');
gate(tapped.tag && Math.abs(tapped.tag.x - 195) < 3 && tapped.tag.y < 430 && tapped.tag.y > 330,
     `the tag anchors to the tapped pixel (${tapped.tag ? `${tapped.tag.x.toFixed(1)}, ${tapped.tag.y.toFixed(1)}` : 'none'} for 195, 430)`);
gate(tapped.box.bottom <= 430 && tapped.box.left >= 0 && tapped.box.right <= 390 && /^\d+m/.test(tapped.text.trim()),
     `the tag reads its metres above the point ("${tapped.text.trim().slice(0, 24)}")`);

/* the sheet opens on its head and closes again, and never climbs past the middle of the screen */
await page.click('#kikOut .kik-head');
const opened = await page.evaluate(() => ({
  open: window.V3D.caddie().kik.sheetOpen,
  sheet: document.getElementById('kikOut').getBoundingClientRect().toJSON(),
  body: getComputedStyle(document.querySelector('#kikOut .kik-body')).display,
  expanded: document.querySelector('#kikOut .kik-head').getAttribute('aria-expanded'),
}));
gate(opened.open && opened.body !== 'none' && opened.expanded === 'true' && opened.sheet.top >= 844 * 0.4,
     `the sheet opens to its details and keeps the top ${Math.round(opened.sheet.top / 8.44)}% of the screen clear`);
await page.click('#kikOut .kik-head');
gate(!(await page.evaluate(() => window.V3D.caddie().kik.sheetOpen)), 'and folds back to its row');
if (process.env.BANVY_CADDIE_SHOT) {
  await page.screenshot({ path: process.env.BANVY_CADDIE_SHOT.replace(/\.png$/, '-phone.png'), animations: 'disabled', timeout: 300_000 });
}
gate(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
if (weatherFailures.length) console.log(`note weather fetch failed here (${weatherFailures[0]}) — the sheet shows the offline line instead`);

await browser.close();
