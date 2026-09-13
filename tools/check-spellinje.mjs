/* Run against a dev server. One renderer boot, all Upsala tees, plus the three
   reported views. Uses the rendered tree population, surfaces and terrain. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://localhost:5173';
const output = path.resolve(process.argv[3] || 'output/spellinje');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/?bana=upsala&hal=1&vy=ovan&ljus=kvall&tee=2&det=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.V3D?.strategyCheck, null, { timeout: 240000 });
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    return !boot || (boot.classList.contains('done') && Number(getComputedStyle(boot).opacity) < 0.01);
  }, null, { timeout: 120000 });
  console.log('Upsala renderer ready');
  const reports = [];
  for (let n = 1; n <= 18; n++) {
    const row = await page.evaluate(number => {
      const h = V3D.HOLES[number - 1];
      return h.tees.marks.map((_, tee) => ({ hole: number, tee: tee + 1, ...V3D.strategyCheck(number, tee) }));
    }, n);
    reports.push(...row);
    console.log(`Hole ${n}: ${row.map(r => `${r.tee}:${r.status}(${Math.round(r.elapsedMs)}ms)`).join(' ')}`);
  }
  for (const n of [1, 7, 11]) {
    await page.evaluate(number => { V3D.goHole(number, true, true); V3D.setCam('top', true); }, n);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(output, `hole-${n}.png`) });
  }
  // Rebuild on a changed tee and on bag edits; the minimap and 3D must agree.
  await page.evaluate(() => { V3D.goHole(1, false, true); document.querySelectorAll('.tee')[4].click(); });
  const changedTee = await page.evaluate(() => ({ strategy: V3D.caddie().strategy, origin: V3D.HOLES[0].tees.marks[4].c }));
  if (JSON.stringify(changedTee.strategy.origin) !== JSON.stringify(changedTee.origin)) errors.push('Selected tee not used');
  await page.click('#bagBtn');
  await page.locator('#bagList .bag-distance').first().fill('225');
  await page.click('.bag-save');
  const bagChanged = await page.evaluate(() => V3D.caddie());
  if (bagChanged.bag[0].carry !== 225) errors.push('Bag update failed');
  await page.click('#strategyBtn');
  await page.click('#strategyBtn');
  if (!await page.evaluate(() => V3D.caddie().strategyOn)) errors.push('Strategy toggle failed');
  const blocked = reports.find(r => r.status !== 'playable' && !r.originClear);
  if (blocked) {
    await page.evaluate(({ hole, tee }) => {
      V3D.goHole(hole, false, true); document.querySelectorAll('.tee')[tee - 1].click();
    }, blocked);
    if (!await page.locator('#strategyStatus').isVisible()) errors.push('Missing blocked-route status');
    if (await page.evaluate(() => V3D.caddie().strategy.primary !== null)) errors.push('Blocked route has a target');
    await page.click('#strategyBtn');
    if (await page.locator('#strategyStatus').isVisible()) errors.push('Status remains visible when strategy is off');
  }
  const invalid = reports.filter(r => r.status === 'playable' && (!r.segmentsClear || !r.landingsAllowed || !r.primary));
  if (invalid.length) errors.push(`${invalid.length} invalid recommendations`);
  for (const n of [1, 7, 11]) {
    if (reports.find(r => r.hole === n && r.tee === 2)?.status !== 'playable') errors.push(`Reported hole ${n} has no playable line`);
  }
  const summary = { total: reports.length, playable: reports.filter(r => r.status === 'playable').length,
    blocked: reports.filter(r => r.status !== 'playable').map(r => [r.hole, r.tee, r.status]),
    maxMs: Math.max(...reports.map(r => r.elapsedMs)), errors };
  await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify({ summary, reports }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
