import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = path.resolve(process.argv[3] || 'output/roads');
const courses = (process.argv[4] || 'veckefjarden,upsala,angso').split(',');
const backend = process.argv[5] || 'webgpu';
if (!['webgpu', 'webgl2'].includes(backend)) throw new Error('Backend must be webgpu or webgl2');
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
    await page.goto(`${base}/?bana=${course}&hal=1&vy=fritt&ljus=kvall&det=1&gl=${backend === 'webgl2' ? 1 : 0}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
    await page.waitForTimeout(1200);
    console.log(`${course} ready`);
    const views = await page.evaluate(() => {
      const tee = V3D.HOLES[0].tees.marks[0].c;
      const nearest = roads => roads.flatMap(road => road.line.slice(1).map((b, i) => {
        const a = road.line[i], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((tee[0] - a[0]) * dx + (tee[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        const point = [a[0] + dx * t, a[1] + dz * t];
        return { name: road.name, kind: road.kind, surface: road.surface, point,
          distance: Math.hypot(point[0] - tee[0], point[1] - tee[1]) };
      })).sort((a, b) => a.distance - b.distance)[0];
      return {
        local: nearest(V3D.M.infra.roads.filter(r => !/trunk|secondary|tertiary/.test(r.kind))),
        main: nearest(V3D.M.infra.roads.filter(r => /trunk|secondary|tertiary/.test(r.kind))),
      };
    });
    for (const [kind, preset] of [['local', 'golden'], ['local', 'noon'], ['main', 'golden']]) {
      if (!views[kind]) continue;
      await page.evaluate(({ point, preset }) => {
        V3D.setCam('orbit', true); V3D.setPreset(preset);
        const { camera, controls } = V3D.harness(), y = V3D.terrainH(...point);
        controls.target.set(point[0], y, point[1]);
        camera.position.set(point[0] + 20, y + 170, point[1] + 140);
        camera.lookAt(controls.target); controls.update();
      }, { point: views[kind].point, preset });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(output, `${course}-${kind}-${preset}.jpg`), quality: 88 });
    }
    const diagnostics = await page.evaluate(() => {
      const materials = [];
      V3D.harness().scene.traverse(mesh => {
        if (!mesh.name.startsWith('roads-') || !mesh.material) return;
        materials.push({ name: mesh.name, vertexColors: mesh.material.vertexColors,
          transparent: mesh.material.transparent, depthWrite: mesh.material.depthWrite });
      });
      return { roads: V3D.roadRendering?.(), backend: V3D.stats.backend,
        draping: V3D.roadDraping?.(), materials };
    });
    if (diagnostics.backend !== backend) errors.push(`Expected ${backend}, got ${diagnostics.backend}`);
    for (const material of diagnostics.materials) {
      if (material.vertexColors) errors.push(`${material.name} applies vertex colour twice`);
      if (material.name === 'roads-markings' && (!material.transparent || material.depthWrite)) {
        errors.push('Lane markings must not cover the terrain base');
      }
    }
    if (diagnostics.draping?.some(proof => proof.maximumOffsetErrorMetres > 0.002)) errors.push('Road vertices do not follow terrain');
    reports.push({ course, errors, views, ...diagnostics });
    if (errors.length) process.exitCode = 1;
    console.log(JSON.stringify({ course, errors, backend: diagnostics.backend,
      roads: diagnostics.roads?.length, materials: diagnostics.materials,
      maximumDrapeErrorMetres: Math.max(0, ...diagnostics.draping.map(proof => proof.maximumOffsetErrorMetres)) }));
    await page.close();
  }
  await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
