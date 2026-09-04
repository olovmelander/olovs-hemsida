/* What is the frame at rest paying for? At a lake view, live clock, HUD on,
   vsync, the rAF interval for a few seconds under each condition in one boot:
   as is; the shadow map frozen (V3D.setShadowUpdate(false)); the trees hidden;
   the water hidden; the far ring hidden; everything instanced hidden. A second
   boot with ?post=0 gives the bloom's share. The interval is what the eye
   gets; at rest the water is the only thing that moves, so an uneven or slow
   cadence here is water jitter.
     node tools/frame-at-rest.mjs [url] [--view=12:tee:golden] [--seconds=4] */
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
const argv = process.argv.slice(2);
const BASE = argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8623';
const SECONDS = +(argv.find(a => a.startsWith('--seconds='))?.slice(10) || 4);
const UNCAPPED = argv.includes('--uncapped');
const AB = argv.includes('--ab');
const QUERY = argv.find(a => a.startsWith('--query='))?.slice(8) || '';
const [H, CAM, PRESET] = (argv.find(a => a.startsWith('--view='))?.slice(7) || '12:tee:golden').split(':');
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };
const sample = (page, s) => page.evaluate(s => new Promise(resolve => { const ms = [], blocks = []; const ch = new MessageChannel(); let lastTick = performance.now(), maxGap = 0, running = true; ch.port1.onmessage = () => { const now = performance.now(); const gap = now - lastTick; if (gap > maxGap) maxGap = gap; lastTick = now; if (running) ch.port2.postMessage(0); }; ch.port2.postMessage(0); let last = performance.now(); const t0 = last; const tick = now => { ms.push(now - last); blocks.push(maxGap); maxGap = 0; last = now; if (now - t0 < s * 1000) requestAnimationFrame(tick); else { running = false; ms.blocks = blocks.slice(2); resolve({ ms: ms.slice(2), blocks: blocks.slice(2) }); } }; requestAnimationFrame(tick); }), s);
const row = (label, r, extra = '') => { const ms = r.ms || r, b = r.blocks || []; console.log(`   ${label.padEnd(30)} interval p50 ${q(ms, 0.5).toFixed(1).padStart(5)} p95 ${q(ms, 0.95).toFixed(1).padStart(5)} max ${q(ms, 1).toFixed(1).padStart(5)} ms | ${(1000 / q(ms, 0.5)).toFixed(0).padStart(3)} fps | CPU block p50 ${q(b, 0.5).toFixed(1).padStart(5)} p95 ${q(b, 0.95).toFixed(1).padStart(5)} ms ${extra}`); };
async function boot(query) {
  const browser = await chromium.launch({ channel: 'chrome', args: browserArgs({ uncappedFrameRate: UNCAPPED }) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  await page.goto(`${BASE}/?bana=puttom&v2=require${query}${QUERY}`, { waitUntil: 'load' });
  await page.waitForSelector('#boot.done');
  await page.evaluate(([h, cam, preset]) => { const V = window.V3D; V.setPreset(preset); V.goHole(+h, true, true); V.setCam(cam, true); }, [H, CAM, PRESET]);
  await page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0 && window.V3D.settled(), null, { polling: 50 });
  await page.waitForTimeout(2500);
  return { browser, page };
}
const info = page => page.evaluate(() => { const r = window.V3D.rendererInfo(); return `${r.drawCalls} draws, ${(r.triangles / 1e6).toFixed(1)} M tris`; });
{
  const { browser, page } = await boot('');
  console.log(`hole ${H} ${CAM} ${PRESET}, live clock, HUD on, ${UNCAPPED ? 'frame-rate cap OFF' : 'vsync'}, ${await info(page)}`);
  if (await page.evaluate(() => typeof window.V3D.census === 'function')) { const c = await page.evaluate(() => window.V3D.census()); console.log('   scene census (visible objects with geometry; type|tag|material|name: objects, instances, M tris):'); for (const e of c.slice(0, 28)) console.log(`     ${String(e.objects).padStart(5)} obj ${String(e.instances).padStart(7)} inst ${(e.tris / 1e6).toFixed(2).padStart(6)} M  ${e.key}`); console.log(`     ${c.reduce((a, e) => a + e.objects, 0)} objects in ${c.length} kinds`); }
  if (AB) { for (let round = 0; round < 4; round++) { for (const [label, on] of [['shadow every frame (before)', true], ['shadow on demand (policy)', false]]) { await page.evaluate(on => window.V3D.setShadowUpdate(on), on); await page.waitForTimeout(500); row(`round ${round} ${label}`, await sample(page, SECONDS), await info(page)); } } await browser.close(); process.exit(0); }
  const CONDS = [
    ['as is', () => {}],
    ['shadow map frozen', () => window.V3D.setShadowUpdate(false)],
    ['shadow map live again', () => window.V3D.setShadowUpdate(true)],
    ['trees hidden', () => window.V3D.setMeshesVisible({ tag: 'trees' }, false)],
    ['trees + shadow frozen', () => window.V3D.setShadowUpdate(false)],
    ['trees back, shadow live', () => { window.V3D.setMeshesVisible({ tag: 'trees' }, true); window.V3D.setShadowUpdate(true); }],
    ['water hidden', () => window.V3D.setWaterVisible(false)],
    ['water back, far ring hidden', () => { window.V3D.setWaterVisible(true); window.V3D.setMeshesVisible({ tag: 'vista' }, false); }],
    ['far ring back, instanced hidden', () => { window.V3D.setMeshesVisible({ tag: 'vista' }, true); window.V3D.setMeshesVisible({ minInstances: 50 }, false); }],
    ['everything back', () => { window.V3D.setMeshesVisible({}, true); }],
  ];
  for (const [label, setup] of CONDS) {
    await page.evaluate(setup); await page.waitForTimeout(600);
    row(label, await sample(page, SECONDS), await info(page));
  }
  await browser.close();
}
{
  const { browser, page } = await boot('&post=0');
  row('bloom off (post=0), as is', await sample(page, SECONDS), await info(page));
  await page.evaluate(() => window.V3D.setShadowUpdate(false)); await page.waitForTimeout(600);
  row('bloom off + shadow frozen', await sample(page, SECONDS));
  await browser.close();
}
