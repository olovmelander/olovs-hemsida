/* The tree LOD's strict pixel gate: the 12 golden views, forced into one tier,
   on two builds, with a settle that waits for the terrain stream.

   usage: node tools/serve.mjs apps/golf/dist 8620 &         (the build under test)
          node tools/serve.mjs <old>/apps/golf/dist 8622 &   (the reference build)
          BANVY_GPU=1 node tools/lod-strict-gate.mjs [--lod 2] [--a http://127.0.0.1:8622] [--b http://127.0.0.1:8620]
              [--course puttom] [--out tools/goldens/lod-strict] [--qa k=v] [--qb k=v] [--perceptual]   (--lod 0: automatic tiers)

   Under ?lod=N every visible tree is in one tier and the fade is 0 under det,
   so the slot machinery must render pixel-identically whatever the decision
   rule does; this is what catches a tree drawn twice, a slot pointing at the
   wrong matrix, a stale upload range. shot.mjs --seq cannot be the gate here:
   it does not wait for the terrain stream, and a tile landing between the two
   builds' shots read as an 18%-of-pixels difference that no shader made.
   Exits non-zero if any view exceeds the strict parity gate (0.10/255 mean,
   0.05% of pixels over 2/255).                                              */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';
import { GOLDEN_VIEWS } from './golden-views.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const LOD = flag('lod', '2'), A = flag('a', 'http://127.0.0.1:8622'), B = flag('b', 'http://127.0.0.1:8620');
const SLUG = flag('course', 'puttom'), OUT = flag('out', 'tools/goldens/lod-strict');
/* extra URL parameters per side (--qa, --qb), so one build can be compared with itself under a switch;
   --perceptual relaxes the gate to 2.5/255 and 5% for a change that is expected to differ where it should */
const QA = flag('qa', ''), QB = flag('qb', ''), PERCEPTUAL = args.includes('--perceptual');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const shoot = async (base, tag, extra) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  await page.goto(`${base}/?bana=${SLUG}&det=1&v2=require${LOD === '0' ? '' : `&lod=${LOD}`}&ren=1${extra ? `&${extra}` : ''}`, { waitUntil: 'load' });
  await page.waitForSelector('#boot.done');
  const settle = async () => {
    const f = await page.evaluate(() => window.V3D.frame());
    await page.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 50 });
    const f1 = await page.evaluate(() => window.V3D.frame());
    await page.waitForFunction(f0 => window.V3D.frame() >= f0 + 2 && window.V3D.settled(), f1, { polling: 20 });
  };
  for (const v of GOLDEN_VIEWS) {
    await page.evaluate(([h, cam, preset]) => { window.V3D.setPreset(preset); window.V3D.goHole(h, true, true); window.V3D.setCam(cam, true); }, [v.hole, v.cam, v.preset]);
    await settle();
    await page.screenshot({ path: `${OUT}/${tag}-lod${LOD}-${v.id}.png`, timeout: 120000 });
  }
  await page.close();
};
await shoot(A, 'a', QA);
await shoot(B, 'b', QB);
await browser.close();
let bad = 0;
for (const v of GOLDEN_VIEWS) {
  const a = decodePNG(fs.readFileSync(`${OUT}/a-lod${LOD}-${v.id}.png`)), b = decodePNG(fs.readFileSync(`${OUT}/b-lod${LOD}-${v.id}.png`));
  const n = a.width * a.height;
  let sum = 0, off = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(a.data[i * a.channels] - b.data[i * b.channels]), Math.abs(a.data[i * a.channels + 1] - b.data[i * b.channels + 1]), Math.abs(a.data[i * a.channels + 2] - b.data[i * b.channels + 2]));
    sum += d; if (d > 2) off++;
  }
  const mean = sum / n, pct = 100 * off / n, ok = PERCEPTUAL ? (mean <= 2.5 && pct <= 5) : (mean <= 0.10 && pct <= 0.05);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} lod${LOD} ${v.id.padEnd(20)} mean ${mean.toFixed(4)}/255  >2: ${pct.toFixed(3)}%`);
}
console.log(bad ? `${bad} of ${GOLDEN_VIEWS.length} views FAIL` : `all ${GOLDEN_VIEWS.length} views identical under lod ${LOD}`);
process.exit(bad ? 1 : 0);
