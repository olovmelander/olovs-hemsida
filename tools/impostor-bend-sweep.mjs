/* one boot in ?impdbg=lit&lod=4: sweep the bend of the lighting normal
   toward the viewer, golden hill then noon treeline, frame-settled */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const S = process.env.BANVY_SHOTS || new URL('../geobuild/shots', import.meta.url).pathname;
const port = process.argv[2] || '8620';
const mean = (file, [x, y, w, h]) => {
  const img = decodePNG(fs.readFileSync(file));
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const o = (j * img.width + i) * img.channels; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++; }
  return [r / n, g / n, b / n].map(v => v.toFixed(1)).join(',');
};
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
page.on('console', m => { if (/error|shader/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/?bana=puttom&det=1&v2=require&lod=4&impdbg=lit`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done', { timeout: 900000 });
const settle = async () => { const f0 = await page.evaluate(() => window.V3D.frame()); await page.waitForFunction(f => window.V3D.frame() >= f + 2, f0, { timeout: 900000, polling: 500 }); };
const views = { golden: { h: 14, cam: 'green', boxes: { hill: [0, 300, 700, 45], near: [1100, 300, 280, 130] }, mesh: 'hill 72.8,99.9,55.6  near 91.9,112.6,66.4' },
                noon: { h: 5, cam: 'tee', boxes: { line: [0, 330, 1000, 110], near: [1100, 200, 300, 300] }, mesh: 'line 86.9,125.0,92.7  near 95.6,128.3,106.8' } };
for (const [preset, ks] of [['golden', (process.argv[3] || '0,0.3,0.5,0.7,1').split(',')], ['noon', (process.argv[4] || '0.5,0.7').split(',')]]) {
  const v = views[preset];
  await page.evaluate(([hh, cc, pp]) => { window.V3D.setPreset(pp); window.V3D.goHole(hh, true, true); window.V3D.setCam(cc, true); }, [v.h, v.cam, preset]);
  for (const k of ks) {
    await page.evaluate(kk => window.V3D.setImpostorBend(kk), +k);
    await settle();
    const file = `${S}/bend-${preset}-${k}.png`;
    await page.screenshot({ path: file, timeout: 600000, animations: 'disabled' });
    console.log(`${preset} bend ${k}: ` + Object.entries(v.boxes).map(([n, b]) => `${n} ${mean(file, b)}`).join('  ') + `   (mesh: ${v.mesh})`);
  }
}
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
