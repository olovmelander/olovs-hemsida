import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const out = new URL('./tee-playing-ground/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 960 }, deviceScaleFactor: 1 });
const errors = [], reports = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 800)); });
async function inspect(label) {
  await page.waitForTimeout(550);
  const report = await page.evaluate(() => {
    const { scene, camera, controls } = V3D.harness(), root = document.querySelector('#selectedTee');
    const h = V3D.HOLES[+root.dataset.hole - 1], mark = h.tees.marks[+root.dataset.tee];
    const arc = scene.getObjectByName('kikaren-shot'), p = arc?.geometry.attributes.position;
    const result = V3D.rangefinder(), target = result.shot?.target;
    const backward = [camera.position.x - mark.c[0], camera.position.z - mark.c[1]];
    const forward = [controls.target.x - mark.c[0], controls.target.z - mark.c[1]];
    const projected = V3D.toScreen(mark.c[0], V3D.terrainH(...mark.c) + .18, mark.c[1]);
    const transform = new DOMMatrix(getComputedStyle(root.querySelector('.hole-marker-point')).transform);
    const vector = i => [p.getX(i), p.getY(i), p.getZ(i)];
    const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const cards = [...document.querySelectorAll('.hole-marker-card')].map(box);
    const blockers = [...document.querySelectorAll('#kikOut.show, #kikTag .kt-box')].filter(el => el.getClientRects().length).map(box);
    const overlaps = cards.some(a => blockers.some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
    return { width: innerWidth, tee: +root.dataset.tee, mode: V3D.camInfo().mode,
      playingC: mark.c, referenceC: mark.referenceC, placement: mark.playingPosition,
      rangefinderOrigin: result.origin, target, ground: V3D.terrainH(...mark.c),
      endGround: target && V3D.terrainH(...target), arcStart: p && vector(0), arcEnd: p && vector(p.count - 1),
      setback: Math.hypot(...backward), behind: backward[0] * forward[0] + backward[1] * forward[1] < 0,
      teeAnchorError: root.dataset.docked === 'true' ? null : Math.hypot(transform.m41 - projected.x, transform.m42 - projected.y),
      greenVisible: document.querySelector('#selectedGreen').style.opacity !== '0',
      overlaps, renderer: V3D.harness().terrainV2.active };
  });
  reports.push({ label, ...report });
  assert.deepEqual(report.rangefinderOrigin, report.playingC);
  assert.ok(report.arcStart, 'Missing Kikaren arc');
  for (const [actual, expected] of [[report.arcStart, [report.playingC[0], report.ground, report.playingC[1]]],
    [report.arcEnd, [report.target[0], report.endGround, report.target[1]]]]) {
    assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < .0001), 'Floating or misplaced arc endpoint');
  }
  if (report.mode === 'tee') { assert.ok(Math.abs(report.setback - 6) < .001); assert.ok(report.behind); }
  if (report.teeAnchorError != null) assert.ok(report.teeAnchorError < 1);
  assert.ok(report.greenVisible);
  assert.equal(report.overlaps, false, 'Tee/flag card overlaps Kikaren');
  console.log(JSON.stringify({ label, ...report }));
}
async function measureAhead() {
  await page.evaluate(() => {
    const h = V3D.HOLES[0], target = h.line[Math.min(1, h.line.length - 1)];
    const p = V3D.project(target[0], V3D.terrainH(...target), target[1]);
    if (!p.visible) throw new Error('Shot target not visible');
    V3D.kikMeasure(p.x, p.y);
  });
}
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1', { timeout: 120000 });
  console.log('Loading course');
  await page.waitForFunction(() => !!window.V3D && document.querySelector('#boot.done'), null, { timeout: 240000 });
  console.log('Course ready');
  if (await page.locator('#strategyBtn').getAttribute('aria-pressed') === 'true') await page.locator('#strategyBtn').click();
  await page.locator('#tees .tee').nth(2).click();
  await page.locator('#rangeBtn').click();
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  await measureAhead();
  await inspect('312 overhead');
  await page.screenshot({ path: fileURLToPath(new URL('overhead-312.png', out)) });
  await page.evaluate(() => V3D.setCam('tee', true));
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  await inspect('312 tee view');
  await page.screenshot({ path: fileURLToPath(new URL('tee-312.png', out)) });
  await page.locator('#tees .tee').nth(4).click();
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  await measureAhead();
  await inspect('254 tee view');
  await page.locator('#tees .tee').nth(2).click();
  await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
  await measureAhead();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await inspect('312 mobile tee view');
  await page.screenshot({ path: fileURLToPath(new URL('mobile-312.png', out)) });
  console.log('Passed: playing origin, tee and green markers, ground endpoints, tee switching, camera setback, desktop and mobile.');
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await fs.writeFile(new URL('checks.json', out), JSON.stringify({ errors, reports }, null, 2));
  await browser.close();
}
