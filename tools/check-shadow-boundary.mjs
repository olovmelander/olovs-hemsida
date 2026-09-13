import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';

const output = path.resolve(process.argv[2] || 'output/shadow-boundary');
const course = process.argv[3] || 'veckefjarden';
const backend = process.argv[4] || 'webgpu';
const preset = process.argv[5] || 'golden';
const base = process.env.BANVY_BASE_URL || 'http://127.0.0.1:5173';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const errors = [], reports = [];
function compareShadows(hard, faded, unshadowed) {
  const [a, b, c] = [hard, faded, unshadowed].map(decodePNG);
  let shadowPixels = 0, retained = 0, softened = 0;
  // Use scene pixels, clear of the fixed top/right/bottom controls.
  for (let y = 100; y < a.height - 240; y++) for (let x = 20; x < a.width - 250; x++) {
    const i = y * a.width + x;
    const luma = p => (p.data[i * p.channels] + p.data[i * p.channels + 1] + p.data[i * p.channels + 2]) / 3;
    const h = luma(a), f = luma(b), n = luma(c);
    if (n - h < 4) continue;
    shadowPixels++;
    if (Math.abs(f - h) <= 1.5 && n - f >= 3) retained++;
    if (f - h >= 2 && n - f < (n - h) * 0.4) softened++;
  }
  return { shadowPixels, retained, softened };
}
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?bana=${course}&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&det=1&qualitylock=1&gl=${backend === 'webgl2' ? 1 : 0}`, { timeout: 120000 });
  await page.waitForFunction(() => window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
  for (const [name, target, offset] of [
    ['near', null, null],
    ['course', [0, 45, -500], [0, 600, 1300]],
    ['town', [1200, 50, -650], [-700, 1300, 1700]],
    ['moved', [1900, 50, -900], [-700, 1300, 1700]],
  ]) {
    await page.evaluate(({ target, offset, preset }) => {
      V3D.setCam(target ? 'orbit' : 'tee', true); V3D.setPreset(preset);
      const { camera, controls, sun } = V3D.harness();
      if (target) {
        controls.target.set(...target);
        camera.position.set(...target.map((v, i) => v + offset[i]));
        camera.lookAt(controls.target); controls.update();
      }
      sun.shadow.intensity = 1; V3D.setShadowBoundaryFade(true);
    }, { target, offset, preset });
    await page.waitForTimeout(1800);
    const faded = await page.screenshot({ path: path.join(output, `${name}.png`) });
    const report = await page.evaluate(name => {
      const { sun, camera, controls } = V3D.harness();
      return { name, fit: V3D.shadowFit(), camera: camera.position.toArray(), target: controls.target.toArray(),
        sun: sun.position.toArray(), shadowMatrix: sun.shadow.matrix.toArray(),
        backend: V3D.stats.backend, filter: !!sun.shadow.filterNode };
    }, name);
    await page.evaluate(() => { V3D.setShadowBoundaryFade(false); });
    await page.waitForTimeout(350);
    const hard = await page.screenshot({ path: path.join(output, `${name}-hard-boundary.png`) });
    await page.evaluate(() => { V3D.harness().sun.shadow.intensity = 0; });
    await page.waitForTimeout(350);
    const unshadowed = await page.screenshot({ path: path.join(output, `${name}-no-shadow.png`) });
    report.pixels = compareShadows(hard, faded, unshadowed);
    reports.push(report);
    if (!report.filter || report.backend !== backend || report.shadowMatrix[0] === 1) errors.push(`${name}: expected active filter, rendered shadow map and ${backend}`);
    console.log(JSON.stringify({ name, ...report.pixels }));
  }
  if (reports.reduce((sum, r) => sum + r.pixels.softened, 0) < 100) errors.push('No measurable shadow transition');
  if (reports[0].pixels.retained < 100) errors.push('Nearby shadows were not preserved');
  await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify({ course, backend, preset, reports, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ course, backend, preset, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
