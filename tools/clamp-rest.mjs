/* The eased ground clamp must do nothing at rest: at each of the twelve golden
   views the camera is placed by setCam, and over the next sixty frames its
   height must not move by a nanometre, the clamp's lift account must stay at
   zero, and no pixel may change. That is what makes the goldens comparable
   across the change without a second build to compare against. */
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { GOLDEN_VIEWS } from './golden-views.mjs';
const BASE = process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8623';
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
await page.goto(`${BASE}/?bana=puttom&det=1&v2=require&ren=1`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done');
const ev = (fn, a) => page.evaluate(fn, a);
const settle = async () => { const f = await ev(() => window.V3D.frame()); await page.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 30 }); await page.waitForTimeout(300); };
let bad = 0;
for (const v of GOLDEN_VIEWS) {
  await ev(([h, cam, preset]) => { window.V3D.setPreset(preset); window.V3D.goHole(h, true, true); window.V3D.setCam(cam, true); }, [v.hole, v.cam, v.preset]);
  await settle();
  const a = await ev(() => ({ y: window.V3D.camExact().pos[1], lift: window.V3D.groundClamp().lift, g: window.V3D.camExact().ground }));
  await ev(() => window.V3D.pixelDelta(2));
  const f0 = await ev(() => window.V3D.frame());
  await page.waitForFunction(f => window.V3D.frame() >= f + 60, f0, { polling: 20 });
  const b = await ev(() => ({ y: window.V3D.camExact().pos[1], lift: window.V3D.groundClamp().lift }));
  const d = await ev(() => window.V3D.pixelDelta(2));
  const ok = a.y === b.y && a.lift === 0 && b.lift === 0 && d.changed === 0 && d.max <= 2;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.id.padEnd(20)} y ${a.y.toFixed(4)} -> ${b.y.toFixed(4)} (${(a.y - a.g).toFixed(2)} m over ground) lift ${a.lift} -> ${b.lift} pixels off by >2/255: ${d.changed}, max ${d.max}`);
}
await browser.close();
console.log(bad ? `${bad} views moved at rest` : 'all twelve views still at rest');
process.exit(bad ? 1 : 0);
