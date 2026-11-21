/* Exercise the rendered simulator, including real course terrain, golfer animation
   and the same physics callback that commits regular shots. No GPS permission. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ ...browserExecutable(),
  args: browserArgs() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    hasTouch: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  const url = new URL('/?bana=veckefjarden&karta=0&spela=1&hal=1&q=lo&sim=ny', base);
  page.on('console', message => { if (message.type() === 'error' && message.text().startsWith('Spela:')) console.error(message.text()); });
  const ready = async () => {
    const state = () => page.evaluate(() => ({ boot: document.querySelector('#boot')?.innerText?.trim().split('\n').at(-1),
      game: window.BANVY_PLAY?.state().state, banner: document.querySelector('.pl-banner')?.textContent }));
    const progress = setInterval(() => { void state().then(s => console.log('Waiting for address', s), () => {}); }, 30_000);
    try {
      await page.waitForFunction(() => window.BANVY_PLAY?.state().state === 'address', null, { polling: 350, timeout: 360_000 });
    } catch (error) {
      console.error(await state());
      throw error;
    } finally { clearInterval(progress); }
  };
  const model = () => page.evaluate(() => {
    const p = window.BANVY_PLAY.state();
    return { hole: p.hole, ball: p.ball, lie: p.lie, yaw: p.yaw, club: p.club, setup: p.setup,
      target: p.targetDist, strokes: p.strokes, id: p.round.id, card: p.round.holes[p.hole], practice: p.practice };
  });
  const scored = p => ({ ...p, practice: null });
  const playStroke = async power => {
    await page.evaluate(power => {
      const game = window.BANVY_PLAY;
      game.swing({ power, face: 0, path: 0 });
      // Deterministically run the normal update loop; software GPU speed varies.
      for (let i = 0; i < 3200 && game.state().state !== 'address'; i++) game.update(1 / 45);
    }, power);
    await ready();
  };
  const hit = async selector => page.locator(selector).evaluate(el => {
    const b = el.getBoundingClientRect();
    return b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 &&
      el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
  });

  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await ready();
  console.log('Simulator loaded.');
  const mapKeys = () => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('banvy-map-') || k.startsWith('banvy:round')));
  const gpsBefore = await mapKeys();
  // From the aim/club buttons to the swing, the active controls must receive the contact.
  for (const [width, height] of [[320,568], [390,844], [568,320], [667,375], [844,390], [1366,768], [1440,900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (let size = 0; size < 2; size++) {
      for (const control of ['[data-menu]', '.pl-map-size', '[data-club="1"]', '[data-setup]', '.pl-pad']) {
        assert.ok(await hit(control), control + ' is reachable at ' + width + '×' + height);
      }
      const covered = await page.evaluate(() => {
        const swing = document.querySelector('.pl-swing').getBoundingClientRect();
        return ['.pl-cond','.pl-map','.pl-dock'].filter(selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return Math.min(r.right, swing.right) - Math.max(r.left, swing.left) > 1 &&
            Math.min(r.bottom, swing.bottom) - Math.max(r.top, swing.top) > 1;
        });
      });
      assert.deepEqual(covered, [], 'swing area overlaps a control at ' + width + '×' + height);
      await page.locator('.pl-map-size').evaluate(b => b.click());
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  console.log('Viewport controls passed.');
  await page.locator('[data-menu]').tap();
  assert.ok(await page.getByRole('dialog', { name: /veckefj/i }).isVisible());
  await page.locator('[data-end]').focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('dialog').evaluate(el => el.contains(document.activeElement)));
  await page.keyboard.press('Shift+Tab');
  assert.ok(await page.locator('[data-end]').evaluate(el => el === document.activeElement));
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('[data-menu]').evaluate(el => el === document.activeElement));
  await page.keyboard.press('Space');
  await page.locator('[data-clean]').tap();
  const beforeClean = await model();
  await page.locator('[data-clean-exit]').tap();
  assert.deepEqual(await model(), beforeClean);
  await page.locator('[data-menu]').tap();
  await page.locator('[data-practice]').tap();
  console.log('Practice started.');
  for (let i = 1; i <= 3; i++) {
    await playStroke(.58);
    const after = await model();
    assert.equal(after.practice.attempts, i);
    console.log('Practice attempt', i);
    assert.deepEqual(scored(after), beforeClean);
    assert.match(await page.locator('[data-stats]').innerText(), /Carry|Längd/i);
  }
  await page.locator('[data-practice-exit]').tap();
  assert.deepEqual(await model(), beforeClean);
  await playStroke(.65);
  const settled = await model();
  assert.ok(settled.strokes > beforeClean.strokes);
  assert.notDeepEqual(settled.ball, beforeClean.ball);
  console.log('Scored stroke settled. Reloading.');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.deepEqual(await model(), settled);
  assert.deepEqual(await mapKeys(), gpsBefore);
  assert.deepEqual(errors, []);
  console.log('Simulator controls, touch and keyboard, three practice shots, scored shot and resume passed.');
} finally {
  await browser.close();
}
