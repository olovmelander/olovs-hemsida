/* one boot in ?impdbg=lit&lod=4: hole 14 golden, the lit impostors with one
   term ablated at a time, mean colour of the hill band and the near box */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const S = process.env.BANVY_SHOTS || new URL('../geobuild/shots', import.meta.url).pathname;
const port = process.argv[2] || '8620';
const boxes = { hill: [0, 300, 700, 45], near: [1100, 300, 280, 130] };
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
await page.evaluate(() => { window.V3D.setPreset('golden'); window.V3D.goHole(14, true, true); window.V3D.setCam('green', true); });
for (const mode of (process.argv[3] || '0,10,11,12,13').split(',').map(Number)) {
  await page.evaluate(m => window.V3D.setImpostorDebug(m), mode);
  await settle();
  const file = `${S}/abl${mode}-h14.png`;
  await page.screenshot({ path: file, timeout: 600000, animations: 'disabled' });
  console.log(`ablation ${mode}: ` + Object.entries(boxes).map(([k, b]) => `${k} ${mean(file, b)}`).join('  ') + '   (mesh tier: hill 72.8,99.9,55.6  near 91.9,112.6,66.4)');
}
const tpl = await page.evaluate(() => window.V3D.treeTemplates(0, 0, -1));
console.log('CPU mean face normal from (0,0,-1):', JSON.stringify(tpl.map(x => x.meanFaceNormal.map(v => +v.toFixed(3)))));
for (const [lod, mode] of [[2, 0], [3, 17], [3, 18]]) {
  await page.evaluate(([l, mm]) => { window.V3D.setTreeLod(l); window.V3D.setImpostorDebug(mm); window.V3D.setPreset('noon'); window.V3D.goHole(5, true, true); window.V3D.setCam('tee', true); }, [lod, mode]);
  await settle();
  const file = `${S}/abl-noon-lod${lod}-m${mode}.png`;
  await page.screenshot({ path: file, timeout: 600000, animations: 'disabled' });
  console.log(`noon hole 5 lod ${lod} mode ${mode}: line ${mean(file, [0, 330, 1000, 110])}  near ${mean(file, [1100, 200, 300, 300])}`);
}
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
