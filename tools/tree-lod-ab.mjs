/* Harness: boot Puttom v2 and shoot tier 2 against tier 3 on two views (see docs/tree-lod-plan.md); node tools/tree-lod-ab.mjs <port> <label> [extra query] */
/* one boot: hole 14 golden and hole 5 noon, each in tier 2 and tier 3, and
   the mean colour of two boxes (the far hill band, the near spruces) */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const S = process.env.BANVY_SHOTS || new URL('../geobuild/shots', import.meta.url).pathname;
const port = process.argv[2] || '8620', label = process.argv[3] || 'ab', extra = process.argv[4] || '';
const boxes = { 14: { hill: [0, 300, 700, 45], near: [1100, 300, 280, 130] }, 5: { line: [0, 330, 1000, 110], near: [1100, 200, 300, 300] } };
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
await page.goto(`http://127.0.0.1:${port}/?bana=puttom&det=1&v2=require&lod=2${extra}`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done', { timeout: 900000 });
for (const [h, cam, preset] of [[14, 'green', 'golden'], [5, 'tee', 'noon']]) {
  for (const lod of [2, 3]) {
    await page.evaluate(([hh, cc, pp, l]) => { window.V3D.setTreeLod(l); window.V3D.setPreset(pp); window.V3D.goHole(hh, true, true); window.V3D.setCam(cc, true); }, [h, cam, preset, lod]);
    await page.waitForTimeout(2500);
    const file = `${S}/${label}-lod${lod}-h${h}.png`;
    await page.screenshot({ path: file, timeout: 600000, animations: 'disabled' });
    const t = await page.evaluate(() => window.V3D.treeTiers());
    console.log(`${label} hole ${h} lod ${lod}: tiers ${t.tier1}/${t.tier2}/${t.tier3}  ` + Object.entries(boxes[h]).map(([k, b]) => `${k} ${mean(file, b)}`).join('  '));
  }
}
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
