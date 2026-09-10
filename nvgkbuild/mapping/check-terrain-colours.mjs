import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';

// Run against npm run dev, or pass a production preview URL. Captures are
// review evidence; the probes gate the previously discontinuous forest seam.
const webgl = process.argv.includes('--webgl');
const base = process.argv.find(a => /^https?:/.test(a)) || 'http://localhost:5173';
const out = `nvgkbuild/cache/terrain-colours-${webgl ? 'webgl2' : 'webgpu'}`;
fs.mkdirSync(out, { recursive: true });
const report = { url: base, errors: [], views: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: [...browserArgs(), ...(webgl ? ['--disable-webgpu'] : [])] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`${base}/?bana=norrfallsviken&hal=12&vy=tee&ljus=kvall${webgl ? '&gl=1' : ''}`,
    { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#boot.done', { timeout: 180000 });
  report.terrain = await page.evaluate(() => V3D.v2Terrain());
  report.backend = await page.evaluate(() => V3D.stats.backend);
  assert.equal(report.backend, webgl ? 'webgl2' : 'webgpu');
  assert.equal(report.terrain.ready, true);
  assert.equal(report.terrain.kind, 'graph');
  assert.equal(report.terrain.courseSurfaceOverlayMeshes, 0);
  report.probes = await page.evaluate(() => [-1466, -1490, -1514, -1538, -1562]
    .map(x => ({ x, z: 500, ...V3D.probeGround(x, 500) })));
  const inside = report.probes[2], outside = report.probes[3];
  for (const p of [inside, outside]) {
    assert.equal(p.ocean, false); assert.equal(p.flat, false);
    assert.equal(p.landuse.length, 0);
  }
  report.boundaryColourJump = Math.max(...inside.tintFar.map((v, k) => Math.abs(v - outside.tintFar[k])));
  assert.ok(report.boundaryColourJump <= 3, `Forest tint jumps ${report.boundaryColourJump} sRGB levels at the crop`);
  for (const light of ['golden', 'noon']) for (const [id, position, look] of [
    ['west', [-450, 900, 400], [-1600, 80, 400]],
    ['south', [-250, 900, 300], [-250, 70, 1600]],
    ['southwest', [250, 1100, 200], [-1300, 100, 1300]],
  ]) {
    await page.evaluate(({ position, look, light }) => {
      V3D.setPreset(light); V3D.setView(...position, ...look);
    }, { position, look, light });
    await page.waitForFunction(() => V3D.settled() && V3D.v2Plan()?.loading.length === 0,
      null, { timeout: 30000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(out, `${id}-${light}.png`) });
    report.views.push({ id, light, camera: await page.evaluate(() => V3D.camExact()) });
    console.log(`Captured ${id} ${light}`);
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(error.stack); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ backend: report.backend, views: report.views.length,
  boundaryColourJump: report.boundaryColourJump, errors: report.errors }));
