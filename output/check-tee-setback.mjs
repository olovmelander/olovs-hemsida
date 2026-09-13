import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('./tee-setback/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 960 }, deviceScaleFactor: 1 });
const errors = [], reports = [];
page.on('pageerror', error => errors.push(String(error)));
async function check() {
  await page.waitForFunction(() => {
    const root = document.getElementById('selectedTee'), h = V3D.HOLES[+root.dataset.hole - 1];
    const mark = h.tees.marks[+root.dataset.tee], { camera } = V3D.harness();
    return Math.abs(Math.hypot(camera.position.x - mark.c[0], camera.position.z - mark.c[1]) - 6) < .001;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const report = await page.evaluate(() => {
    const root = document.getElementById('selectedTee'), h = V3D.HOLES[+root.dataset.hole - 1];
    const mark = h.tees.marks[+root.dataset.tee], { camera, controls } = V3D.harness();
    const back = [camera.position.x - mark.c[0], camera.position.z - mark.c[1]];
    const forward = [controls.target.x - mark.c[0], controls.target.z - mark.c[1]];
    return { tee: +root.dataset.tee, reference: mark.c, camera: camera.position.toArray(),
      setback: Math.hypot(...back), behind: back[0] * forward[0] + back[1] * forward[1] < 0,
      cross: back[0] * forward[1] - back[1] * forward[0],
      groundClearance: camera.position.y - V3D.terrainH(camera.position.x, camera.position.z),
      teeClearance: camera.position.y - V3D.terrainH(...mark.c), markerDocked: root.dataset.docked,
      width: innerWidth, height: innerHeight };
  });
  reports.push(report);
  console.log(JSON.stringify(report));
  await page.screenshot({ path: fileURLToPath(new URL('tee-' + report.tee + '-' + report.width + '.png', out)) });
  assert.ok(Math.abs(report.setback - 6) < .001);
  assert.ok(report.behind);
  assert.ok(Math.abs(report.cross) < .001);
  // The walking clamp settles against the camera's ground height; the tee
  // six metres ahead can be a few centimetres higher or lower.
  assert.ok(report.groundClearance >= 1.69 && report.teeClearance >= 1.15);
}
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1', { timeout: 120000 });
  console.log('Loading tee view');
  await page.waitForFunction(() => !!window.V3D && document.querySelector('#boot.done'), null, { timeout: 240000 });
  console.log('Course ready');
  await page.evaluate(() => V3D.setCam('tee', true));
  if (await page.locator('#strategyBtn').getAttribute('aria-pressed') === 'true') await page.locator('#strategyBtn').click();
  for (let i = 0; i < 6; i++) {
    await page.locator('#tees .tee').nth(i).click();
    await check();
  }
  await page.locator('#tees .tee').nth(2).click();
  await check();
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', out)) });
  await page.setViewportSize({ width: 390, height: 844 });
  await check();
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', out)) });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => V3D.setCam('green', true));
  await page.locator('[data-cam="tee"]').first().evaluate(button => button.click());
  await check();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Passed: all six tees, camera six metres behind the selected reference, ground clearance, desktop, mobile and returning to tee view. No page errors.');
} finally {
  await fs.writeFile(new URL('checks.json', out), JSON.stringify({ errors, reports }, null, 2));
  await browser.close();
}
