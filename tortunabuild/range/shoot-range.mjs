/* Capture the range from the tee line and from above, for review. */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(resolve('package.json'));
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(resolve(HERE, '../../apps/golf/src/engine/scenery/tortuna-range-site.json'), 'utf8'));
const OUT = resolve(HERE, '../cache/range/shots');
mkdirSync(OUT, { recursive: true });

const mats = site.mats.items.map(m => m.ringLocal[0]);
const matMid = mats.reduce((a, p) => [a[0] + p[0] / mats.length, a[1] + p[1] / mats.length], [0, 0]);
const netMid = site.net.lineLocal.reduce((a, p, _, all) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]);
let dx = netMid[0] - matMid[0], dz = netMid[1] - matMid[1];
const d = Math.hypot(dx, dz); dx /= d; dz /= d;
const base = process.argv[2] || 'http://127.0.0.1:8099/';
const gpu = process.argv.includes('--gpu');

const VIEWS = [
  { name: 'tee', from: [matMid[0] - dx * 26, 9, matMid[1] - dz * 26], to: [matMid[0] + dx * 60, 2, matMid[1] + dz * 60] },
  { name: 'downrange', from: [matMid[0] - dx * 8, 4, matMid[1] - dz * 8], to: [netMid[0], 6, netMid[1]] },
  { name: 'net', from: [netMid[0] - dx * 55, 16, netMid[1] - dz * 55], to: [netMid[0], 5, netMid[1]] },
  { name: 'above', from: [(matMid[0] + netMid[0]) / 2, 150, (matMid[1] + netMid[1]) / 2 + 40], to: [(matMid[0] + netMid[0]) / 2, 0, (matMid[1] + netMid[1]) / 2] },
];
const browser = await chromium.launch({ channel: 'chrome',
  args: gpu ? ['--use-angle=default', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] : [] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(base + '?bana=tortuna&det=1&ren=1&v2=0', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.V3D && document.querySelector('#boot')?.classList.contains('done'), null, { timeout: 300000 });
const info = await page.evaluate(() => {
  const st = typeof window.V3D.stats === 'function' ? window.V3D.stats() : window.V3D.stats;
  const pick = ['draws', 'rangeNets', 'rangeFacilities', 'authoredRangeFacilities', 'inferredRangeTargets'];
  return { keys: Object.keys(window.V3D).slice(0, 40),
    stats: Object.fromEntries(pick.map(k => [k, st?.[k]])) };
});
console.log(JSON.stringify(info, null, 1));
for (const v of VIEWS) {
  await page.evaluate(({ from, to }) => window.V3D.placeCamera(from, to), v);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, v.name + '.png'), timeout: 300000 });
  console.log('shot', v.name, JSON.stringify(v.from.map(n => Math.round(n))));
}
await browser.close();
