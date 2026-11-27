/* Two independent devices, one real Better Auth golfer and local D1. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserExecutable, browserArgs } from './browser-args.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8787/');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const health = await (await fetch(new URL('/api/health', base))).json();
assert.equal(health.devAuth, true, 'The test requires a local Worker with development sign-in.');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const email = 'handoff-' + crypto.randomUUID() + '@example.test';
const errors = [];
const wait = (page, fn) => page.waitForFunction(fn, null, { timeout: 65000 });
const home = new URL('#overlamna', base).href;
const cardKey = 'banvy-map-round-v1:upsala';

async function device(phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone, isMobile: phone, reducedMotion: 'reduce', permissions: ['geolocation'],
    geolocation: { latitude: 0, longitude: 0, accuracy: 4 },
    serviceWorkers: 'block',
  });
  const login = await context.request.post(new URL('/api/dev-login', base).href, { data: { email } });
  assert.equal(login.status(), 200, await login.text());
  await context.addInitScript(() => {
    localStorage.setItem('banvy-map-quality-v1', '3');
    localStorage.setItem('banvy-map-hint-v1', '1');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(55000);
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}

try {
  const source = await device(true);
  const target = await device(false);
  await source.page.goto(new URL('?bana=upsala&karta=1&runda=1&hal=10', base).href);
  await wait(source.page, () => globalThis.V3DMap?.round().playingHole === 10);
  const tee = await source.page.evaluate(() => {
    const { course, state } = V3DMap;
    const tees = course.holes[9].tees;
    const [east, south] = course.frame.toPack(...(tees[state.tee] || tees[0]).point);
    return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 4 };
  });
  await source.context.setGeolocation(tee);
  await wait(source.page, () => V3DMap.state.guidance.source === 'gps' && V3DMap.state.player?.onCourse);
  await source.page.getByRole('button', { name: /^Logga slag/ }).click();
  await wait(source.page, () => V3DMap.shots().length === 1);
  await source.context.setOffline(true);
  await source.page.locator('[data-menu]').click();
  await source.page.locator('[data-menu-score]').click();
  await source.page.locator('[data-stroke-key="5"]').click();
  await source.page.locator('[data-score-sheet] [data-close]').click();
  assert.equal(await source.page.evaluate(() => V3DMap.round().scores[10].strokes), 5);
  await source.context.setOffline(false);
  const id = await source.page.evaluate(() => V3DMap.round().id);
  const playingTee = await source.page.evaluate(() => V3DMap.state.tee);
  await source.page.goto(home);
  const offer = source.page.getByRole('button', { name: 'Lämna över rundan' });
  await offer.waitFor();
  await target.page.goto(home);
  const preview = target.page.locator('[data-live-rounds]');
  await preview.getByText('Hål 10 · 5 slag', { exact: true }).waitFor();
  assert.match(await preview.innerText(), /Följ pågående runda/);
  // Nothing to take over here: only the round's own ⋯ (round-actions.mjs).
  assert.equal(await preview.locator('button:not(.lr-more)').count(), 0);
  assert.equal(await target.page.evaluate(key => localStorage.getItem(key), cardKey), null);
  console.log('A second signed-in device can review the live card while recording stays on the phone.');

  await source.context.setOffline(true);
  await offer.click();
  await source.page.locator('[data-live-rounds] [role=status]').filter({ hasText: /nät/ }).waitFor();
  assert.ok(await source.page.evaluate(key => JSON.parse(localStorage.getItem(key))?.begunAt, cardKey));
  await source.context.setOffline(false);
  // Simulate the server committing the transfer while the reply is lost.
  let dropped = false;
  await source.page.route('**/api/active-rounds', async route => {
    const request = route.request();
    if (!dropped && request.method() === 'POST' && request.postDataJSON().action === 'offer') {
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      dropped = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await offer.click();
  await source.page.getByText(/Redo att tas över/).waitFor();
  assert.equal(dropped, true);
  assert.equal(await source.page.evaluate(key => localStorage.getItem(key), cardKey), null);
  await target.page.reload();
  await target.page.getByRole('button', { name: 'Fortsätt på denna enhet' }).click();
  await wait(target.page, () => globalThis.V3DMap?.round().scores[10]?.strokes === 5);
  assert.equal(await target.page.evaluate(() => V3DMap.round().id), id);
  assert.equal(await target.page.evaluate(() => V3DMap.state.tee), playingTee);
  assert.equal(await target.page.evaluate(() => V3DMap.shots().length), 1);
  await target.page.reload();
  await wait(target.page, () => globalThis.V3DMap?.round().playingHole === 10);
  assert.equal(await target.page.evaluate(() => V3DMap.shots().length), 1);
  await target.page.locator('[data-desk-tab="score"]:visible, [data-score]:visible').first().click();
  await target.page.locator('[data-stroke-key="6"]').click();
  await source.page.reload();
  await source.page.getByText('Hål 10 · 6 slag', { exact: true }).waitFor();
  assert.equal(await source.page.locator('[data-live-rounds] button:not(.lr-more)').count(), 0);

  // Any device of the golfer can take a round off the account's list: its ⋯, Ta bort rundan, and an
  // undo that brings it back until it has gone by. The device that records it keeps its own card.
  const removeRound = async () => {
    await source.page.locator('[data-live-rounds] .lr-more').first().click();
    await source.page.getByRole('button', { name: /^Ta bort rundan/ }).click();
  };
  await removeRound();
  await wait(source.page, () => !document.querySelector('[data-live-rounds] details'));
  await source.page.getByRole('button', { name: 'Ångra' }).click();
  await source.page.getByText('Hål 10 · 6 slag', { exact: true }).waitFor();
  await removeRound();
  await source.page.locator('.round-toast').waitFor({ state: 'hidden', timeout: 15000 });
  await source.page.reload();
  await source.page.locator('[data-live-rounds] [role=status]').filter({ hasText: /Ingen synkad runda/ }).waitFor();
  assert.equal(await source.page.locator('[data-live-rounds] details').count(), 0);
  await target.page.goto(home);
  await target.page.locator('[data-live-rounds] [role=status]').filter({ hasText: /Ingen synkad runda/ }).waitFor();
  assert.equal(await target.page.evaluate(key => JSON.parse(localStorage.getItem(key))?.scores[10]?.strokes, cardKey), 6);
  console.log('A round is taken off the account from another device, with an undo; the recording device keeps its card.');
  assert.deepEqual(errors, []);
  console.log('A confirmed handoff survives a dropped response. The receiving device resumes the same hole, card and GPS shot once, then becomes the sole writer.');
} finally {
  await browser.close();
}
