/* What is in the scene at a view: every visible object with geometry, grouped
   by type, tag, material, name, parent, instancing, triangle count and shadow
   casting -- the draw list the CPU pays for twice a frame.
     node tools/scene-census.mjs [url] [--view=12:tee:golden] [--top=60] */
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
const argv = process.argv.slice(2);
const BASE = argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8623';
const TOP = +(argv.find(a => a.startsWith('--top='))?.slice(6) || 60);
const [H, CAM, PRESET] = (argv.find(a => a.startsWith('--view='))?.slice(7) || '12:tee:golden').split(':');
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
await page.goto(`${BASE}/?bana=puttom&v2=require`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done');
await page.evaluate(([h, cam, preset]) => { const V = window.V3D; V.setPreset(preset); V.goHole(+h, true, true); V.setCam(cam, true); }, [H, CAM, PRESET]);
await page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0 && window.V3D.settled(), null, { polling: 50 });
await page.waitForTimeout(1500);
const c = await page.evaluate(() => window.V3D.census());
const r = await page.evaluate(() => { const r = window.V3D.rendererInfo(); return `${r.drawCalls} draws, ${(r.triangles / 1e6).toFixed(1)} M tris`; });
console.log(`hole ${H} ${CAM} ${PRESET}: ${c.reduce((a, e) => a + e.objects, 0)} visible objects in ${c.length} kinds; renderer ${r}`);
console.log('  objects  instances   tris  type|tag|material|name|parent|inst|tris-each|cast|matrixAuto');
for (const e of c.slice(0, TOP)) console.log(`  ${String(e.objects).padStart(6)} ${String(e.instances).padStart(9)} ${String(Math.round(e.tris)).padStart(8)}  ${e.key}`);
await browser.close();
