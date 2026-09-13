import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const out = new URL('./hole-markers/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 960 }, deviceScaleFactor: 1 });
const errors = [], reports = [];
page.on('pageerror', error => errors.push(String(error)));
const shot = async name => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
async function inspect(label) {
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const markers = [...document.querySelectorAll('.hole-marker')].map(root => {
      const h = V3D.HOLES[+root.dataset.hole - 1];
      const c = root.dataset.kind === 'green' ? h.pin : h.tees.marks[+root.dataset.tee].c;
      const p = V3D.toScreen(c[0], V3D.terrainH(...c) + .18, c[1]);
      const matrix = new DOMMatrix(getComputedStyle(root.querySelector('.hole-marker-point')).transform);
      const card = root.querySelector('button');
      const ring = root.querySelector('.hole-marker-outline').getAttribute('d');
      return { kind: root.dataset.kind, hole: h.n, docked: root.dataset.docked === 'true',
        text: card.innerText, box: rect(card), error: Math.hypot(matrix.m41 - p.x, matrix.m42 - p.y),
        outline: ring, animation: getComputedStyle(root.querySelector('i')).animationName };
    });
    return { width: innerWidth, height: innerHeight, markers };
  });
  const [tee, green] = report.markers;
  assert.equal(tee.hole, green.hole);
  assert.ok(green.text.includes('HÅL ' + green.hole));
  assert.ok(green.text.includes('Flaggan'));
  for (const m of report.markers) {
    if (!m.docked) assert.ok(m.error < 1, label + ' ' + m.kind + ' anchor error ' + m.error);
    assert.ok(m.box.left >= 0 && m.box.right <= report.width && m.box.top >= 0 && m.box.bottom <= report.height, label + ' card outside viewport');
    assert.ok(!m.outline || !/NaN|Infinity/.test(m.outline));
  }
  const a = tee.box, b = green.box;
  assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, label + ': cards overlap');
  reports.push({ label, ...report });
  return report;
}
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1', { timeout: 120000 });
  console.log('Loading Veckefjärden');
  await page.waitForFunction(() => !!window.V3D && document.querySelector('#boot.done'), null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  console.log('Course ready');
  if (await page.locator('#strategyBtn').getAttribute('aria-pressed') === 'true') await page.locator('#strategyBtn').click();
  const initial = await inspect('desktop hole 1');
  assert.ok(initial.markers[1].outline.length > 20, 'Missing green boundary');
  await shot('desktop-hole-1');
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
  console.log('All 18 greens and six tee choices passed');
  await page.evaluate(() => { V3D.goHole(1, true, true); V3D.setCam('tee', true); });
  await inspect('desktop tee view');
  await shot('desktop-tee-view');
  await page.locator('.selected-green-card').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  assert.ok(await page.locator('[data-cam="green"].on').count());
  await inspect('desktop green view');
  await shot('desktop-green-view');
  await page.evaluate(() => V3D.setSky(0));
  assert.ok(await page.locator('.selected-green-card').isVisible());
  await page.evaluate(() => document.body.classList.add('clean'));
  assert.equal(await page.locator('.selected-green-card').isVisible(), false);
  await page.evaluate(() => { document.body.classList.remove('clean'); V3D.setSky(2); V3D.setCam('top', true); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let h = 1; h <= 18; h++) {
    await page.evaluate(n => V3D.goHole(n, true, true), h);
    const report = await inspect('mobile hole ' + h);
    for (const m of report.markers) assert.equal(m.animation, 'none');
    if (h === 1) await shot('mobile-hole-1');
  }
  console.log('All 18 greens on mobile passed');
  await page.evaluate(() => { V3D.goHole(1, true, true); V3D.setCam('tee', true); });
  await inspect('mobile tee view'); await shot('mobile-tee-view');
  await page.locator('.selected-green-card').click();
  await page.waitForTimeout(2000);
  await inspect('mobile green view'); await shot('mobile-green-view');
  await page.evaluate(() => {
    V3D.setCam('tee', true);
    const { camera, controls } = V3D.harness(), pin = V3D.HOLES[0].pin;
    controls.target.set(2 * camera.position.x - pin[0], camera.position.y, 2 * camera.position.z - pin[1]);
    controls.update();
  });
  const offscreen = await inspect('both markers offscreen');
  assert.ok(offscreen.markers.every(m => m.docked));
  await shot('mobile-offscreen');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Passed ' + reports.length + ' view/selection checks; keyboard navigation, signs off, clean view and reduced motion. No page errors.');
} finally {
  await fs.writeFile(new URL('checks.json', out), JSON.stringify({ errors, reports }, null, 2));
  await browser.close();
}
