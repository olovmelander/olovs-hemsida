// Mobile GPS and score recovery on an actual rendered hole. Run against a served build.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8620/');
const portrait = { width: 320, height: 568 };
const landscape = { width: 667, height: 375 };
const away = { latitude: 0, longitude: 0, accuracy: 4 };
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });

try {
  const context = await browser.newContext({
    viewport: portrait, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
    permissions: ['geolocation'], geolocation: away,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const wait = predicate => page.waitForFunction(predicate, null, { timeout: 60000, polling: 100 });
  const pending = page.locator('[data-pending-shot]');
  const log = page.locator('[data-wheel-lock]');
  // Sample the real hit target and send a touch directly. Extra animation-frame
  // waits on a software GPU can outlast a live GPS request's ten-second deadline.
  const tapLog = async () => {
    const point = await log.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return button.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    });
    assert.ok(point, 'The shot action is on screen and receives touches');
    await page.touchscreen.tap(point.x, point.y);
  };
  const shots = () => page.evaluate(() => V3DMap.shots());
  const score = () => page.evaluate(() => V3DMap.round().scores[10] ?? null);

  await page.goto(new URL('?bana=upsala&karta=1&runda=1&hal=10&mapquality=3', base).href, { waitUntil: 'domcontentloaded' });
  await wait(() => globalThis.V3DMap?.round().playingHole === 10 && document.querySelector('#boot.done'));
  const { tee, green } = await page.evaluate(() => {
    const { course, state } = V3DMap;
    const hole = course.holes[9];
    const fix = point => {
      const [east, south] = course.frame.toPack(...point);
      return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 4 };
    };
    return { tee: fix((hole.tees[state.tee] ?? hole.tees[0]).point), green: fix(hole.green.c) };
  });
  const moveOffCourse = async () => {
    await context.setGeolocation(away);
    await wait(() => V3DMap.state.player?.onCourse === false);
  };
  const moveToTee = async () => {
    await context.setGeolocation(tee);
    await wait(() => V3DMap.state.player?.onCourse && V3DMap.state.guidance?.source === 'gps');
  };

  await page.setViewportSize(landscape);
  await wait(() => innerWidth > innerHeight && V3DMap.camera.state.width === innerWidth);
  await moveOffCourse();
  await tapLog();
  await pending.waitFor();
  assert.match(await pending.innerText(), /Hål 10/i);
  assert.match(await pending.innerText(), /Väntar på GPS/i);
  const requestedClub = await page.evaluate(() => V3DMap.state.pendingLock.club.name);
  assert.ok((await pending.innerText()).includes(requestedClub), 'Pending feedback identifies the selected club');
  assert.match(await log.innerText(), /Avbryt/);
  await tapLog();
  await pending.waitFor({ state: 'hidden' });
  await page.setViewportSize(portrait);
  await wait(() => innerHeight > innerWidth && V3DMap.camera.state.width === innerWidth);
  await moveToTee();
  assert.equal((await shots()).length, 0, 'A fix after cancellation leaves the log unchanged');

  await moveOffCourse();
  await tapLog();
  await pending.waitFor();
  // The earlier temporary notification vanished at four seconds. The wait remains actionable.
  await page.waitForTimeout(4500);
  assert.match(await pending.innerText(), /Väntar på GPS/i);
  assert.match(await log.innerText(), /Avbryt/);
  await wait(() => /Slaget loggades inte/i.test(document.querySelector('[data-pending-shot]').textContent));
  assert.match(await log.innerText(), /Försök igen/);
  await moveToTee();
  assert.equal((await shots()).length, 0, 'A late fix does not submit an expired request');
  await moveOffCourse();
  await tapLog();
  await wait(() => Boolean(V3DMap.state.pendingLock));
  await moveToTee();
  await wait(() => V3DMap.shots().length === 1);
  await pending.waitFor({ state: 'hidden' });
  await page.evaluate(() => { V3DMap.refix(); V3DMap.refix(); });
  const recorded = await shots();
  assert.equal(recorded.length, 1, 'Repeated fixes submit the requested shot only once');
  console.log('A pending shot stays actionable, can be cancelled and expires. Retrying records one shot across repeated fixes.');

  const before = await score();
  await page.locator('[data-menu]').tap();
  await page.locator('[data-menu-score]').tap();
  await page.locator('[data-stroke-key="5"]').tap();
  const undo = page.locator('[data-score-undo-btn]');
  const undoIsReachable = () => undo.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const sheet = button.closest('[data-score-sheet]').getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= Math.max(0, sheet.top) &&
      rect.bottom <= Math.min(innerHeight, sheet.bottom) && button.contains(hit);
  });
  assert.ok(await undoIsReachable(), 'Score undo is visible and tappable at 320 × 568, without scrolling');
  await page.setViewportSize(landscape);
  await wait(() => innerHeight < innerWidth && V3DMap.camera.state.width === innerWidth);
  assert.ok(await undoIsReachable(), 'The edited score keeps a reachable undo after rotation');
  await undo.tap();
  assert.deepEqual(await score(), before);
  assert.deepEqual(await shots(), recorded, 'Undoing score leaves the GPS shot intact');
  await page.locator('[data-score-sheet] [data-close]').tap();
  console.log('A single visible undo restores the score after rotation and preserves the independent GPS shot.');

  await context.setGeolocation(green);
  await wait(() => V3DMap.state.guidance?.source === 'gps' && document.querySelector('[data-mid-number]').textContent === 'På green');
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  const permission = setting => session.send('Browser.setPermission', {
    permission: { name: 'geolocation' }, setting, origin: base.origin, browserContextId: targetInfo.browserContextId,
  });
  await permission('denied');
  await wait(() => V3DMap.state.guidance?.source === 'last-gps');
  assert.equal(await page.locator('[data-mid-number]').innerText(), 'Senast på green');
  const source = page.locator('[data-from]');
  assert.ok(await source.isVisible());
  assert.match(await source.innerText(), /senaste säkra GPS/i);
  const originalSize = await source.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await page.locator('[data-menu]').tap();
  await page.locator('[data-sun-mode="dag"]').tap();
  await page.locator('[data-menu-tab="visning"]').tap();
  await page.locator('[data-large]').check();
  await page.locator('[data-menu-sheet] [data-close]').tap();
  await page.setViewportSize(portrait);
  await wait(() => V3DMap.camera.state.width === innerWidth);
  assert.ok(await source.evaluate((element, original) =>
    parseFloat(getComputedStyle(element).fontSize) > original &&
    element.scrollWidth <= element.clientWidth + 1, originalSize), 'The stale source scales and fits the sun/large-text HUD');
  await permission('granted');
  await page.locator('[data-menu]').tap();
  await page.locator('[data-menu-tab="runda"]').tap();
  await page.locator('[data-menu-gps]').check();
  await page.locator('[data-menu-sheet] [data-close]').tap();
  await context.setGeolocation(green);
  await wait(() => V3DMap.state.guidance?.source === 'gps' && document.querySelector('[data-mid-number]').textContent === 'På green');
  assert.deepEqual(errors, []);
  console.log('A revoked fix visibly distinguishes the last green position until permission and a fresh fix return.');
} finally {
  await browser.close();
}
