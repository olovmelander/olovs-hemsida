/* Harness: boot Puttom v2 and print the tree tier counts at three views, frame-settled (docs/tree-lod-plan.md). node tools/tree-tiers-at.mjs */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { browserArgs } from './browser-args.mjs';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(900000);
await page.goto('http://127.0.0.1:8620/?bana=puttom&det=1&v2=require', { waitUntil: 'load' });
await page.waitForSelector('#boot.done', { timeout: 900000 });
const settle = async () => { const f0 = await page.evaluate(() => window.V3D.frame()); await page.waitForFunction(f => window.V3D.frame() >= f + 2 && window.V3D.settled(), f0, { timeout: 900000, polling: 500 }); };
for (const [h, cam, preset] of [[7, 'top', 'noon'], [5, 'tee', 'noon'], [1, 'tee', 'golden']]) {
  await page.evaluate(([hh, cc, pp]) => { window.V3D.setPreset(pp); window.V3D.goHole(hh, true, true); window.V3D.setCam(cc, true); }, [h, cam, preset]);
  await settle();
  console.log(`hole ${h} ${cam} ${preset}:`, JSON.stringify(await page.evaluate(() => { const t = window.V3D.treeTiers(); return { t0: t.tier0, t1: t.tier1, t2: t.tier2, t3: t.tier3, cellsVisible: t.cellsVisible }; })));
}
await browser.close();
