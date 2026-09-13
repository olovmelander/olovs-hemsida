import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = path.resolve(process.argv[3] || 'output/parking');
const courses = (process.argv[4] || 'upsala,tortuna,veckefjarden').split(',');
const backend = process.argv[5] || 'webgpu';
const look = process.argv[6] || 'ghibli';
if (!['webgpu', 'webgl2'].includes(backend) || !['ghibli', 'real'].includes(look)) throw new Error('Invalid backend or look');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const reports = [];
try {
  for (const course of courses) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|validation|WebGPU|WebGL/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`${base}/?bana=${course}&hal=1&vy=fritt&ljus=kvall&det=1&look=${look}&gl=${backend === 'webgl2' ? 1 : 0}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
    const views = await page.evaluate(() => {
      const tee = V3D.HOLES[0].tees.marks[0].c;
      const centre = ring => ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      const distance = p => Math.hypot(p[0] - tee[0], p[1] - tee[1]);
      const lots = (V3D.M.infra.parking || []).filter(p => p.ring?.length >= 3)
        .map(p => ({ id: p.id, surface: p.surface, point: centre(p.ring) })).filter(p => distance(p.point) < 700);
      const asphalt = lots.filter(p => /\b(asphalt|paved)\b/i.test(p.surface || ''));
      const generic = lots.filter(p => !/\b(asphalt|paved)\b/i.test(p.surface || ''));
      const nearest = list => list.sort((a, b) => distance(a.point) - distance(b.point))[0];
      const areas = (V3D.M.scenery.mappedFeatures || []).filter(p => p.material === 'mixed-hardstanding-and-mats')
        .map(p => ({ id: p.id, point: centre(p.rings[0]) }));
      return { asphalt: nearest(asphalt), generic: nearest(generic), apron: nearest(areas) };
    });
    for (const [kind, view] of Object.entries(views)) {
      if (!view) continue;
      for (const preset of ['golden', 'noon']) {
        await page.evaluate(({ point, preset }) => {
          V3D.setCam('orbit', true); V3D.setPreset(preset);
          const { camera, controls } = V3D.harness(), y = V3D.terrainH(...point);
          controls.target.set(point[0], y, point[1]);
          camera.position.set(point[0] + 15, y + 105, point[1] + 100);
          camera.lookAt(controls.target); controls.update();
        }, { point: view.point, preset });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(output, `${course}-${kind}-${preset}.jpg`), quality: 90 });
      }
    }
    const diagnostics = await page.evaluate(() => {
      const materials = [];
      V3D.harness().scene.traverse(mesh => {
        if (!mesh.isMesh || !/parking-surfaces|mapped-facility-footprint/.test(mesh.userData?.tag || '')) return;
        materials.push({ name: mesh.name, material: mesh.material.name,
          vertexColors: mesh.material.vertexColors, roughness: mesh.material.roughness });
      });
      return { backend: V3D.stats.backend, parking: V3D.parkingRendering?.(), materials };
    });
    if (diagnostics.backend !== backend) errors.push(`Expected ${backend}, got ${diagnostics.backend}`);
    for (const material of diagnostics.materials) {
      if (material.vertexColors) errors.push(`${material.name || material.material} multiplies paving colour twice`);
    }
    reports.push({ course, look, errors, views, ...diagnostics });
    if (errors.length) process.exitCode = 1;
    console.log(JSON.stringify({ course, errors, backend: diagnostics.backend, views: Object.keys(views).filter(k => views[k]) }));
    await page.close();
    await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(reports, null, 2));
  }
} finally { await browser.close(); }
