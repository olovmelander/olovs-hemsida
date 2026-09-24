/* Real course check: near mesh/Impostor routing, model requests, empty retired
 * tiers, slot ownership, and a rendered screenshot. The near mesh is Hero at
 * high quality and the lighter Full model at low quality; --treemesh hero|full
 * passes the page's comparison override. SwiftShader proves correctness,
 * not physical-device FPS. Start tools/serve.mjs apps/golf/dist 8620 first.
 * CHROME=/path/to/chrome node tools/check-hero-impostor.mjs --course visby --q lo
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const course = flag('course', 'visby'), quality = flag('q', 'lo');
const base = flag('url', 'http://127.0.0.1:8620');
const out = path.resolve(flag('out', 'output/hero-impostor-review'));
const catalogue = JSON.parse(fs.readFileSync(`apps/golf/public/models/trees/ghibli-${course === 'visby' ? 'visby' : 'fluffy'}.json`));
const treeMesh = flag('treemesh', null);
const tier = treeMesh ?? (quality === 'lo' ? 'full' : 'hero');
const expectedModels = catalogue.species.flatMap(s => s.variants.map(v => v.tiers[tier].file)).sort();
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }), args: browserArgs() });
const page = await browser.newPage({ viewport: quality === 'lo' ? { width: 390, height: 844 } : { width: 960, height: 600 },
  deviceScaleFactor: 1, serviceWorkers: 'block' });
const report = { course, quality, gpu: GPU ? 'hardware' : 'SwiftShader', errors: [], models: [], views: [] };
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.includes('/models/trees/') && url.pathname.endsWith('.glb')) report.models.push(url.pathname.split('/models/trees/')[1]);
});
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (/ghibli trees unavailable/.test(message.text())) report.errors.push(message.text());
  if (/ghibli trees:|v2 .*ready/.test(message.text())) console.log(message.text().slice(0, 200));
});
const settle = async () => {
  await page.waitForFunction(() => V3D.settled()
    && (V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0, null, { timeout: 240000, polling: 100 });
  const frame = await page.evaluate(() => V3D.frame());
  await page.waitForFunction(f => V3D.frame() >= f + 2 && V3D.settled()
    && (V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0, frame, { timeout: 240000, polling: 500 });
};
const snapshot = () => page.evaluate(() => {
  const inventory = [];
  V3D.harness().scene.traverse(m => {
    if (!m.isMesh || !m.name.startsWith('trees-')) return;
    inventory.push({ name: m.name, count: m.isInstancedMesh ? m.count : m.geometry.instanceCount,
      trianglesEach: (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 });
  });
  return { tier: V3D.treeCatalogue().tier, tiers: V3D.treeTiers(), audit: V3D.treeTierAudit(), allocation: V3D.treeTierAllocation(),
    backend: V3D.v2Terrain().backend, policy: V3D.treeLodPx(), quality: V3D.quality(), inventory, renderer: V3D.rendererInfo() };
});
const verify = record => {
  assert(record.audit.ok, 'Tree slots must retain one owner');
  assert.equal(record.tiers.tier1, 0); assert.equal(record.tiers.tier2, 0);
  assert(!record.inventory.some(m => /-t[12]$/.test(m.name)), 'Full/Lite must not allocate drawable meshes');
};
try {
  // Deliberately include the former downgrade flag: it must change nothing.
  const override = flag('distanthero', null);
  const url = `${base}/?bana=${course}&v2=require&ghibli=1&hero=0&q=${quality}&qualitylock=1&gl=${flag('gl', '1')}&det=1&hal=1&vy=tee&ljus=middag${override === null ? '' : `&distanthero=${encodeURIComponent(override)}`}${treeMesh === null ? '' : `&treemesh=${treeMesh}`}`;
  console.log(`Opening ${course} / ${quality}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 360000, polling: 500 });
  await settle();
  assert.deepEqual([...new Set(report.models)].sort(), expectedModels);
  report.views.push({ view: 'tee', ...await snapshot() });
  verify(report.views[0]);
  assert.equal(report.views[0].tier, tier, `${quality} quality draws the ${tier} mesh`);
  assert.equal(report.views[0].backend, flag('gl', '1') === '1' ? 'webgl2' : 'webgpu');
  if (override === null) assert.equal(report.views[0].policy.distantHero, 24, 'Ordinary visits use the approved 24 px policy');
  assert(report.views[0].tiers.tier0 > 0, `Expected ${tier} trees by the playing line`);
  await page.evaluate(() => V3D.prepareCapture());
  await page.screenshot({ path: path.join(out, `${course}-${quality}-tee.png`), timeout: 120000 });
  console.log(`Tee rendered; ${tier}-only model requests and drawable inventory verified.`);
  const switches = report.views[0].tiers.switches;
  await page.evaluate(() => V3D.setCam('top', true));
  await settle();
  report.views.push({ view: 'top', ...await snapshot() });
  verify(report.views[1]);
  if (!report.views[0].policy.distantHero)
    assert.equal(report.views[1].tiers.switches, switches, 'Camera movement must not switch geographic opt-out detail');
  await page.evaluate(() => V3D.prepareCapture());
  await page.screenshot({ path: path.join(out, `${course}-${quality}-top.png`), timeout: 120000 });
  // An old forced-Lite link must resolve to the near mesh without using retired slots.
  await page.evaluate(() => V3D.setTreeLod(3));
  await settle();
  report.override = await snapshot(); verify(report.override);
  assert.equal(report.override.tiers.tier3, 0);
  assert(report.override.tiers.tier0 > 0);
  assert.deepEqual(report.errors, []);
  report.ok = true;
  console.log(`PASS ${course} / ${quality}: ${report.views.map(v => `${v.view} ${v.tiers.tier0} ${tier}, ${v.tiers.tier3} Impostor`).join('; ')}`);
} catch (error) {
  report.ok = false; report.failure = String(error); throw error;
} finally {
  fs.writeFileSync(path.join(out, `${course}-${quality}.json`), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
