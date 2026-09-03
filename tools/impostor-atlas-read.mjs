/* boot puttom v2 (lod=4 so the impostors are in frame), shoot two views,
   and read the spruce/pine albedo atlases back: row coverage profile of the
   horizon frame (0,0) and the mean opaque crown colour vs the template's */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { hemiOctahedralDecode } from '../apps/golf/src/engine/tree-impostor.mjs';
import { browserArgs } from './browser-args.mjs';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const S = process.env.BANVY_SHOTS || new URL('../geobuild/shots', import.meta.url).pathname;
const port = process.argv[2] || '8620', label = process.argv[3] || 'fix';
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
page.on('console', m => { if (/error|shader|warn/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/?bana=puttom&det=1&v2=require&lod=4`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done', { timeout: 900000 });
for (const [h, cam, preset] of []) {
  await page.evaluate(([hh, cc, pp]) => { window.V3D.setPreset(pp); window.V3D.goHole(hh, true, true); window.V3D.setCam(cc, true); }, [h, cam, preset]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${S}/${label}-lod3-h${h}.png`, timeout: 600000, animations: 'disabled' });
}
const templates = await page.evaluate(() => window.V3D.treeTemplates());
for (let s = 0; s < 3; s++) {
  for (const [i, j] of [[0, 0], [3, 3], [7, 7], [0, 7], [5, 2]]) {
    const a = await page.evaluate(([ss, ii, jj]) => window.V3D.treeAtlas(ss, 'albedo', ii, jj), [s, i, j]);
    const nrm = await page.evaluate(([ss, ii, jj]) => window.V3D.treeAtlas(ss, 'normal', ii, jj), [s, i, j]);
    if (!a) { console.log('no atlas', s); continue; }
    const fs = a.frameSize, rows = [];
    let r = 0, g = 0, b = 0, n = 0, crown = 0, nx = 0, ny = 0, nz = 0, away = 0, opaqueN = 0;
    const d = hemiOctahedralDecode(i / (a.framesPerSide - 1), j / (a.framesPerSide - 1));
    for (let y = 0; y < fs; y++) {
      let cov = 0;
      for (let x = 0; x < fs; x++) {
        const k = (y * fs + x) * 4;
        if (a.data[k + 3] > 0.5) {
          cov++; opaqueN++;
          { const vx = nrm.data[k] * 2 - 1, vy = nrm.data[k + 1] * 2 - 1, vz = nrm.data[k + 2] * 2 - 1; if (vx * d[0] + vy * d[1] + vz * d[2] < 0) away++; }
          if (nrm.data[k + 3] > 0.5) { r += a.data[k]; g += a.data[k + 1]; b += a.data[k + 2]; n++; crown++;
            nx += nrm.data[k] * 2 - 1; ny += nrm.data[k + 1] * 2 - 1; nz += nrm.data[k + 2] * 2 - 1; }
        }
      }
      rows.push(cov);
    }
    const prof = [];
    for (let y = 0; y < fs; y += 8) prof.push(rows.slice(y, y + 8).reduce((p, q) => p + q, 0) / 8 | 0);
    console.log(`species ${s} frame ${i},${j}: readback row0..row${fs - 1} coverage (8-row bins): ${prof.join(' ')}`);
    console.log(`   opaque ${rows.reduce((p, q) => p + q, 0)} px, crown ${crown} px, mean crown albedo ${[r / n, g / n, b / n].map(v => v.toFixed(3))} vs template vertex colour ${templates[s].vertexColour.map(v => v.toFixed(3))}; mean crown normal ${[nx / n, ny / n, nz / n].map(v => v.toFixed(2))}; bake view ${d.map(v => v.toFixed(2))}; texels facing away from the bake camera ${(100 * away / opaqueN).toFixed(1)}%`);
  }
}
console.log('tiers', JSON.stringify(await page.evaluate(() => window.V3D.treeTiers())));
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
