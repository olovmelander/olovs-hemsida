// Visual check of the six corrected ground materials in actual course lighting.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
process.env.BANVY_GPU = '1';
const { browserArgs } = await import('../../tools/browser-args.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'geobuild/cache/facilities-model-2026-09-10/ground-appearance');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
// Keep one loaded app version throughout the comparison. Other workspace
// edits must not make Vite navigate this test page between camera captures.
await page.routeWebSocket(url => url.port === '5173', () => {});
const report = { passed: false, viteHmrPausedForCapture: true, errors: [], captures: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error' && /WebGPU|GPUValidation|WGSL|shader.*error/i.test(message.text())) report.errors.push(message.text());
});
const views = {
  campus: { ids: ['R01', 'R03', 'R05', 'R08', 'S04', 'S05', 'S06'], offset: [-135, 155, 150] },
  parking: { ids: ['S04', 'S05', 'S06'], offset: [-52, 83, 62] },
  terrace: { ids: ['R01', 'R02', 'S01'], offset: [-65, 20, 7] },
  range: { ids: ['R09', 'S08'], offset: [-70, 53, 78] },
};
try {
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&vy=fritt&ljus=kvall', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.V3D, null, { timeout: 240000 });
  report.facilities = await page.evaluate(() => window.V3D.stats.facilities);
  assert.equal(report.facilities.status, 'loaded', report.facilities.reason);
  assert.equal(report.facilities.triangles, 44422);
  assert.deepEqual(report.facilities.groundSurfaceMaterials.map(m => m.featureId).sort(), ['S01', 'S04', 'S05', 'S06', 'S07', 'S08']);
  assert.ok(report.facilities.groundSurfaceMaterials.every(m => m.detail && m.roughness >= .9));
  const parked = report.facilities.parkingCars;
  assert.equal(parked.count, 24);
  assert.deepEqual(parked.lots, { S04: 6, S05: 12, S06: 6 });
  assert.equal(parked.draws, 6);
  assert.ok(parked.placements.every(car => car.matrix.every(Number.isFinite)
    && car.wheelClearances.every(h => h >= .024 && h < .3)));
  for (const light of ['kvall', 'dag']) for (const [name, view] of Object.entries(views)) {
    await page.evaluate(({ light, view }) => {
      const V = window.V3D, selected = V.facilityGeometry().facilities.filter(f => view.ids.includes(f.id));
      const look = [0, 1, 2].map(i => (Math.min(...selected.map(f => f.min[i])) + Math.max(...selected.map(f => f.max[i]))) / 2);
      const position = look.map((v, i) => v + view.offset[i]);
      position[1] = Math.max(position[1], V.terrainH(position[0], position[2]) + 12);
      V.setPreset(light === 'dag' ? 'noon' : 'golden'); V.placeCamera(position, look);
    }, { light, view });
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 90000 });
    assert.equal(await page.locator('[data-preset].on').first().getAttribute('data-preset'), light === 'dag' ? 'noon' : 'golden');
    await page.evaluate(() => window.V3D.prepareCapture());
    const file = path.join(out, `${name}-${light}.png`);
    await page.screenshot({ path: file, animations: 'disabled', timeout: 60000 });
    report.captures.push({ view: name, light, path: path.relative(root, file) });
    console.log(`Captured ${name} ${light}`);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log('Ground material browser check passed. Screenshots require visual review.');
