import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const out = new URL('./compact-hole-markers/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 960 }, deviceScaleFactor: 1, hasTouch: true });
const errors = [], reports = [];
page.on('pageerror', error => errors.push(String(error)));
const shot = async name => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
async function inspect(label) {
  await page.waitForTimeout(550);
  const report = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const blockers = [...document.querySelectorAll('#kikOut.show, #kikTag .kt-box')].filter(el => el.getClientRects().length).map(rect);
    const markers = [...document.querySelectorAll('.hole-marker')].map(root => {
      const h = V3D.HOLES[+root.dataset.hole - 1], tee = h.tees.marks[+root.dataset.tee];
      const c = root.dataset.kind === 'green' ? h.pin : tee.c;
      const p = V3D.toScreen(c[0], V3D.terrainH(...c) + .18, c[1]);
      const matrix = new DOMMatrix(getComputedStyle(root.querySelector('.hole-marker-point')).transform);
      const card = root.querySelector('button'), box = rect(card);
      const hit = getComputedStyle(card, '::after');
      return { kind: root.dataset.kind, hole: h.n, docked: root.dataset.docked === 'true',
        text: card.innerText, accessible: card.getAttribute('aria-label'), title: card.title, box,
        tapHeight: box.height - parseFloat(hit.top) - parseFloat(hit.bottom),
        error: Math.hypot(matrix.m41 - p.x, matrix.m42 - p.y),
        overlapsKikaren: blockers.some(b => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top),
        outline: root.querySelector('.hole-marker-outline').getAttribute('d'),
        animation: getComputedStyle(root.querySelector('i')).animationName };
    });
    return { width: innerWidth, height: innerHeight, markers };
  });
  const [tee, green] = report.markers;
  reports.push({ label, ...report });
  assert.equal(tee.hole, green.hole);
  assert.equal(green.text.trim(), 'Green ' + green.hole);
  assert.ok(tee.text.startsWith('Tee '));
  assert.ok(tee.text.includes(' m'));
  assert.ok(tee.accessible.startsWith('Vald tee '));
  assert.ok(green.accessible.startsWith('Flaggan'));
  for (const m of report.markers) {
    if (!m.docked) assert.ok(m.error < 1, label + ' anchor drift ' + m.error);
    assert.ok(Math.abs(m.box.height - 30) < .01, label + ': badge height ' + m.box.height);
    assert.ok(m.box.width <= (m.kind === 'tee' ? 170 : 110), 'Badge too wide');
    assert.ok(m.tapHeight >= 43.99, 'Touch area too small');
    assert.ok(m.box.left >= 0 && m.box.right <= report.width && m.box.top >= 0 && m.box.bottom <= report.height, label + ' badge outside viewport');
    assert.equal(m.overlapsKikaren, false, label + ' overlaps Kikaren');
    assert.ok(!m.outline || !/NaN|Infinity/.test(m.outline));
  }
  const a = tee.box, b = green.box;
  assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, label + ': badges overlap');
  return report;
}
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1', { timeout: 120000 });
  console.log('Loading compact marker preview');
  await page.waitForFunction(() => !!window.V3D && document.querySelector('#boot.done'), null, { timeout: 240000 });
  console.log('Course ready');
  if (await page.locator('#strategyBtn').getAttribute('aria-pressed') === 'true') await page.locator('#strategyBtn').click();
  await page.locator('#tees .tee').nth(2).click();
  const initial = await inspect('desktop hole 1');
  console.log(JSON.stringify(initial.markers.map(m => ({ kind: m.kind, text: m.text, width: m.box.width, height: m.box.height, tapHeight: m.tapHeight }))));
  assert.ok(initial.markers[1].outline.length > 20);
  await shot('desktop-overhead');
  for (let i = 0; i < 6; i++) {
    await page.locator('#tees .tee').nth(i).click();
    await inspect('tee ' + (i + 1));
  }
  await page.locator('#tees .tee').nth(2).click();
  for (let h = 2; h <= 18; h++) {
    await page.evaluate(n => V3D.goHole(n, true, true), h);
    await inspect('desktop hole ' + h);
    if (h === 13) await shot('island-green-13');
  }
  console.log('Desktop: all 18 holes and six tee choices passed');
  await page.evaluate(() => { V3D.goHole(1, true, true); V3D.setCam('tee', true); });
  await inspect('desktop tee view'); await shot('desktop-tee');
  await page.locator('.selected-green-card').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => V3D.camInfo().mode), 'green');
  await inspect('desktop green view'); await shot('desktop-green');
  await page.evaluate(() => document.body.classList.add('clean'));
  assert.equal(await page.locator('.selected-green-card').isVisible(), false);
  assert.equal(await page.locator('.selected-tee-card').isVisible(), false);
  await page.evaluate(() => { document.body.classList.remove('clean'); V3D.setCam('top', true); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let h = 1; h <= 18; h++) {
    await page.evaluate(n => V3D.goHole(n, true, true), h);
    const report = await inspect('mobile hole ' + h);
    for (const m of report.markers) assert.equal(m.animation, 'none');
    if (h === 1) await shot('mobile-overhead');
  }
  console.log('Mobile: all 18 holes and reduced motion passed');
  await page.evaluate(() => { V3D.goHole(1, true, true); V3D.setCam('tee', true); });
  const mobile = await inspect('mobile tee view'); await shot('mobile-tee');
  // Touch the invisible padding four pixels above the painted flag badge.
  const flag = mobile.markers[1].box;
  await page.touchscreen.tap((flag.left + flag.right) / 2, flag.top - 4);
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => V3D.camInfo().mode), 'green');
  await inspect('mobile green view'); await shot('mobile-green');
  await page.evaluate(() => {
    V3D.setCam('tee', true);
    const { camera, controls } = V3D.harness(), pin = V3D.HOLES[0].pin;
    controls.target.set(2 * camera.position.x - pin[0], camera.position.y, 2 * camera.position.z - pin[1]);
    controls.update();
  });
  assert.ok((await inspect('both markers offscreen')).markers.every(m => m.docked));
  await shot('mobile-offscreen');
  await page.evaluate(() => V3D.setCam('top', true));
  await page.locator('#rangeBtn').evaluate(button => button.click());
  await page.evaluate(() => {
    const target = V3D.HOLES[0].line[1], p = V3D.project(target[0], V3D.terrainH(...target), target[1]);
    V3D.kikMeasure(p.x, p.y);
    V3D.setCam('tee', true);
  });
  await inspect('mobile Kikaren'); await shot('mobile-kikaren');
  await page.setViewportSize({ width: 1920, height: 960 });
  await inspect('desktop Kikaren'); await shot('desktop-kikaren');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Passed ' + reports.length + ' view/selection checks; keyboard, actual 44 px touch target, offscreen badges, Kikaren, clean view and reduced motion. No page errors.');
} finally {
  await fs.writeFile(new URL('checks.json', out), JSON.stringify({ errors, reports }, null, 2));
  await browser.close();
}
