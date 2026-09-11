/* Before/after pairs of the painted look at distance. Boots a course twice
   (realistic, ?ghibli=1&hero=1), shoots the same views from each -- the
   hole's orbit, the overhead, and a raised landscape shot from behind the tee
   looking down the hole -- and writes side-by-side comparison sheets.
     BANVY_GPU=1 node tools/goldens/ghibli-compare.mjs [url] [--bana=puttom] [--hole=5] [--preset=golden] [--out=tools/goldens/flicker/compare] */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserArgs } from '../browser-args.mjs';
import { decodePNG, encodePNG } from '../../geobuild/png.mjs';
const argv = process.argv.slice(2);
const BASE = argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8623';
const HOLE = +(argv.find(a => a.startsWith('--hole='))?.slice(7) || 5);
const BANA = argv.find(a => a.startsWith('--bana='))?.slice(7) || 'puttom';
const PRESET = argv.find(a => a.startsWith('--preset='))?.slice(9) || 'golden';
const OUT = argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/flicker/compare';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const W = 1600, H = 900;
const views = ['orbit', 'top', 'landscape'];
for (const [name, flag] of [['real', ''], ['ghibli', '&ghibli=1&hero=1']]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  await page.goto(`${BASE}/?bana=${BANA}&det=1&v2=require&ren=1&hal=${HOLE}${flag}`, { waitUntil: 'load' });
  await page.waitForSelector('#boot.done');
  const ev = (fn, a) => page.evaluate(fn, a);
  const settle = async () => { await page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0 && window.V3D.settled(), null, { polling: 50 }); await page.waitForTimeout(700); };
  await ev(([h, preset]) => { const V = window.V3D; V.setPreset(preset); V.goHole(h, true, true); }, [HOLE, PRESET]);
  for (const view of views) {
    if (view === 'landscape') {
      /* 60 m up, 140 m behind the tee, looking down the hole at its green: the whole hole and the forest beyond */
      await ev(h => {
        const V = window.V3D, hole = V.holeLines().find(x => x.n === h) || V.holeLines()[h - 1];
        const line = hole?.line; if (!line) return;
        const [tx, tz] = line[0], [gx, gz] = line[line.length - 1];
        const dx = gx - tx, dz = gz - tz, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
        const ty = V.probeGround(tx, tz).h, gy = V.probeGround(gx, gz).h;
        V.setFov(52);
        V.placeCamera([tx - ux * 140, Math.max(ty, gy) + 60, tz - uz * 140], [tx + dx * 0.55, gy + 4, tz + dz * 0.55]);
      }, HOLE);
    } else {
      await ev(v => window.V3D.setCam(v, true), view);
    }
    await settle();
    await page.screenshot({ path: `${OUT}/${BANA}-${HOLE}-${view}-${name}.png`, timeout: 300000 });
  }
  await page.close();
}
await browser.close();
for (const view of views) {
  const a = decodePNG(readFileSync(`${OUT}/${BANA}-${HOLE}-${view}-real.png`)), b = decodePNG(readFileSync(`${OUT}/${BANA}-${HOLE}-${view}-ghibli.png`));
  const ch = a.data.length / (a.width * a.height), out = new Uint8Array(a.width * 2 * a.height * 3);
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * ch, o = (y * a.width * 2 + x) * 3, o2 = (y * a.width * 2 + a.width + x) * 3;
    out[o] = a.data[i]; out[o + 1] = a.data[i + 1]; out[o + 2] = a.data[i + 2];
    out[o2] = b.data[i]; out[o2 + 1] = b.data[i + 1]; out[o2 + 2] = b.data[i + 2];
  }
  writeFileSync(`${OUT}/${BANA}-${HOLE}-${view}-pair.png`, encodePNG(a.width * 2, a.height, out));
  console.log(`${OUT}/${BANA}-${HOLE}-${view}-pair.png  (left: realistic, right: ghibli)`);
}
