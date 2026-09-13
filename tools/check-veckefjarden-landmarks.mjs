import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = path.resolve(process.argv[3] || 'output/veckefjarden-landmarks');
const courses = (process.argv[4] || 'veckefjarden,veckefjarden-korthalsbanan').split(',');
const backend = process.argv[5] || 'webgpu';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const reports = [];
try {
  for (const course of courses) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/?bana=${course}&hal=1&vy=fritt&ljus=dag&det=1&gl=${backend === 'webgl2' ? 1 : 0}`, { timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
    const models = await page.evaluate(() => V3D.landmarkModels());
    console.log(JSON.stringify({ course, models }));
    if (models?.status !== 'loaded') errors.push('Landmarks did not load: ' + JSON.stringify(models));
    for (const [name, point, offset, look, preset] of [
      ['church-east', [-3278.4, -905.3], [63, 35, 65], 18, 'noon'],
      ['church-west', [-3278.4, -905.3], [-65, 37, -70], 17, 'noon'],
      ['church-evening', [-3278.4, -905.3], [80, 28, 75], 18, 'golden'],
      ['jump-inrun', [1340, -505], [85, 50, 115], 10, 'noon'],
      ['jump-front', [1465, -544], [190, 25, -55], 18, 'noon'],
      ['jump-overview', [1450, -544], [80, 155, 200], 0, 'noon'],
    ]) {
      await page.evaluate(({ point, offset, look, preset }) => {
        V3D.setCam('orbit', true); V3D.setPreset(preset);
        const { camera, controls } = V3D.harness();
        const y = V3D.demH(...point);
        controls.target.set(point[0], y + look, point[1]);
        camera.position.set(point[0] + offset[0], y + offset[1], point[1] + offset[2]);
        camera.lookAt(controls.target); controls.update();
      }, { point, offset, look, preset });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(output, `${course}-${name}.jpg`), quality: 92 });
    }
    const geometry = await page.evaluate(() => {
      const found = [];
      V3D.harness().scene.traverse(o => {
        if (o.name?.startsWith('landmark-')) found.push({ name: o.name, id: o.userData.landmarkId, position: o.position.toArray() });
      });
      return { found, backend: V3D.stats.backend };
    });
    if (geometry.found.length !== 2) errors.push('Expected exactly two model roots');
    if (geometry.backend !== backend) errors.push('Unexpected rendering backend');
    reports.push({ course, models, ...geometry, errors });
    await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(reports, null, 2) + '\n');
    console.log(JSON.stringify({ course, errors }));
    if (errors.length) process.exitCode = 1;
    await page.close();
  }
} finally { await browser.close(); }
