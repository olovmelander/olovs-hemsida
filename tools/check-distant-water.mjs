import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const output = path.resolve(process.argv[2] || 'output/distant-water');
const courses = (process.argv[3] || 'veckefjarden').split(',');
const backend = process.argv[4] || 'webgpu';
const base = process.env.BANVY_BASE_URL || 'http://127.0.0.1:5173';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const reports = [];
try {
  for (const course of courses) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/?bana=${course}&hal=1&vy=ovan&ljus=kvall&ghibli=1&hero=1&gl=${backend === 'webgl2' ? 1 : 0}`, { timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
    const water = await page.evaluate(() => ({ flat: V3D.flatWater(), sheets: V3D.waterSheets(), backend: V3D.stats.backend }));
    await page.screenshot({ path: path.join(output, `${course}-course.jpg`), quality: 90 });
    const target = course.startsWith('veckefjarden') ? [-4700, 23, -600]
      : course === 'angso' ? [-4500, 0, 2600]
        : course === 'lidingo' ? [4500, 0, 1200]
          : course === 'norrfallsviken' ? [4200, 0, -1500] : null;
    if (target) {
      await page.evaluate(target => {
        V3D.setCam('orbit', true); V3D.setPreset('golden');
        const { camera, controls } = V3D.harness();
        controls.target.set(...target);
        camera.position.set(target[0] + 400, target[1] + 1877, target[2] + 1900);
        camera.lookAt(controls.target); controls.update();
      }, target);
    }
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, `${course}.jpg`), quality: 93 });
    if (water.backend !== backend) errors.push(`Expected ${backend}, got ${water.backend}`);
    const sourceWater = water.sheets.filter(s => s.name.startsWith('lidingo-source-water-'));
    const sourceBounds = sourceWater.length ? {
      x0: Math.min(...sourceWater.map(s => s.bounds[0])), x1: Math.max(...sourceWater.map(s => s.bounds[2])),
      z0: Math.min(...sourceWater.map(s => s.bounds[1])), z1: Math.max(...sourceWater.map(s => s.bounds[3])),
    } : null;
    const bounds = water.flat?.bounds ?? sourceBounds;
    if (!bounds || bounds.x1 - bounds.x0 < 16000 || bounds.z1 - bounds.z0 < 16000) errors.push('Water does not reach the current 16 km terrain extent');
    reports.push({ course, ...water, coverage: { source: water.flat ? 'terrain' : 'mapped', bounds }, errors });
    console.log(JSON.stringify({ course, spacing: water.flat?.spacing, components: water.flat?.components?.length, errors }));
    await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(reports, null, 2) + '\n');
    if (errors.length) process.exitCode = 1;
    await page.close();
  }
} finally { await browser.close(); }
