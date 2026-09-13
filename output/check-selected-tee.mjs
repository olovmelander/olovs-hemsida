import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = new URL('./selected-tee/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const shot = async name => page.screenshot({ path: new URL(name + '.png', output).pathname.replace(/^\/(\w:)/, '$1') });
async function settle() {
  await page.waitForFunction(() => !!window.V3D && document.querySelector('#boot.done'), null, { timeout: 240000 });
  await page.waitForTimeout(1800);
}
async function anchorCheck(index) {
  await page.locator('#tees .tee').nth(index).click();
  await page.waitForTimeout(500);
  const state = await page.evaluate(index => {
    const root = document.querySelector('#selectedTee');
    const h = V3D.HOLES[+root.dataset.hole - 1];
    const mark = h.tees.marks[index];
    const projected = V3D.toScreen(mark.c[0], V3D.terrainH(...mark.c) + .18, mark.c[1]);
    const transform = new DOMMatrix(getComputedStyle(root.querySelector('.selected-tee-point')).transform);
    return { docked: root.dataset.docked, tee: +root.dataset.tee,
      text: root.querySelector('button').innerText, expected: h.t[index],
      error: Math.hypot(transform.m41 - projected.x, transform.m42 - projected.y),
      selected: document.querySelectorAll('#tees .tee[aria-pressed="true"]').length,
      url: location.search };
  }, index);
  assert.equal(state.tee, index);
  assert.equal(state.selected, 1);
  assert.ok(state.text.includes(String(state.expected)));
  if (state.docked === 'false') assert.ok(state.error < 1, `anchor ${state.error}px off`);
  return state;
}
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1', { timeout: 120000 });
  console.log('Page loaded; waiting for the course');
  await settle();
  console.log('Course ready');
  const tees = [];
  for (let i = 0; i < 6; i++) tees.push(await anchorCheck(i));
  await anchorCheck(2);
  await shot('desktop-312m');
  console.log('Desktop tee selection and anchor alignment passed');
  await page.locator('.selected-tee-card').click();
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('#selectedTee').getAttribute('data-docked'), 'true');
  await shot('tee-view');
  await page.locator('.selected-tee-card').click();
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('#selectedTee').getAttribute('data-docked'), 'false');
  await page.evaluate(() => V3D.setSky(0));
  assert.ok(await page.locator('.selected-tee-card').isVisible());
  await page.evaluate(() => document.body.classList.add('clean'));
  assert.equal(await page.locator('.selected-tee-card').isVisible(), false);
  await page.evaluate(() => { document.body.classList.remove('clean'); V3D.setSky(2); V3D.goHole(2, true, true); });
  await page.waitForTimeout(500);
  await anchorCheck(2);
  assert.equal(await page.locator('#selectedTee').getAttribute('data-hole'), '2');
  await shot('hole-2');
  await page.evaluate(() => { V3D.goHole(1, true, true); V3D.setCam('green', true); });
  await page.waitForTimeout(600);
  await shot('green-view');
  await page.evaluate(() => V3D.setCam('top', true));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(900);
  const mobile = await anchorCheck(2);
  const box = await page.locator('.selected-tee-card').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
  assert.equal(await page.locator('.selected-tee-point i').evaluate(el => getComputedStyle(el).animationName), 'none');
  await shot('mobile-312m');
  await page.locator('.selected-tee-card').click();
  await page.waitForTimeout(2100);
  await shot('mobile-tee-view');
  assert.equal(errors.length, 0, errors.join('\n'));
  await fs.writeFile(new URL('checks.json', output), JSON.stringify({ tees, mobile, errors }, null, 2));
  console.log('Passed: all six tees, exact anchors, tee/map navigation, hole change, signs off, clean view, mobile, reduced motion; no page errors.');
} finally { await browser.close(); }
