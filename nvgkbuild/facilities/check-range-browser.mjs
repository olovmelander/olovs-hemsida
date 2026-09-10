import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

// This local visual review uses the workstation GPU, one browser at a time.
process.env.BANVY_GPU = '1';
const { browserArgs } = await import('../../tools/browser-args.mjs');
const webgl = process.argv.includes('--webgl');
const after = process.argv.includes('--after');
const backend = webgl ? 'webgl2' : 'webgpu';
// The root checkout is bound to this address; localhost:5173 belongs to the
// separate Tortuna checkout. A URL argument can select a production preview.
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:5174';
const output = path.resolve('nvgkbuild/cache/facilities-reference/runtime-review',
  `range-${after ? 'after' : 'before'}`, backend);
fs.mkdirSync(output, { recursive: true });
const url = new URL('/', base);
url.search = `bana=norrfallsviken&hal=1&vy=tee&ljus=dag${webgl ? '&gl=1' : ''}`;
const report = { startedAt: new Date().toISOString(), url: url.href, backend, after,
  errors: [], consoleErrors: [], failedRequests: [], views: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: [...browserArgs(), ...(webgl ? ['--disable-webgpu'] : [])] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => { report.errors.push(error.message); save(); });
  page.on('console', message => { if (message.type() === 'error') { report.consoleErrors.push(message.text()); save(); } });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 240000 });
  report.boot = await page.evaluate(() => ({ stats: V3D.stats, terrain: V3D.v2Terrain(),
    architecture: V3D.facilityGeometry?.() }));
  assert.equal(report.boot.stats.backend, backend);
  assert.equal(report.boot.terrain.ready, true);
  assert.equal(report.boot.terrain.kind, 'graph');
  assert.equal(report.boot.stats.facilities?.status, 'loaded');
  assert.ok(!report.boot.stats.sourceBuildingBatchIds.includes('lm-range-shelter'));
  report.range = await page.evaluate(() => {
    const { M } = V3D;
    const inside = (x, z, ring) => {
      let result = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
      }
      return result;
    };
    const area = ring => Math.abs(ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
    const features = (M.scenery.mappedFeatures || []).filter(f => /range/.test(f.id ?? '') || /range/.test(f.kind ?? ''));
    const featureGeometry = features.map(f => ({ ...f,
      ringDiagnostics: (f.rings || []).map(ring => {
        const centre = ring.reduce((sum, p) => [sum[0] + p[0] / ring.length, sum[1] + p[1] / ring.length], [0, 0]);
        const vertexGroundHeights = ring.map(([x, z]) => V3D.terrainH(x, z));
        return { vertexCount: ring.length, areaSquareMetres: area(ring), centre,
          vertexGroundHeights, groundRangeMetres: Math.max(...vertexGroundHeights) - Math.min(...vertexGroundHeights),
          centreGround: V3D.probeGround(...centre) };
      }) }));
    const fieldRings = M.scenery.range || [];
    const grid = [];
    for (let z = 145; z <= 270; z += 5) for (let x = -365; x <= -125; x += 5) {
      if (fieldRings.some(r => inside(x, z, r))) grid.push({ x, z, height: V3D.terrainH(x, z),
        classification: V3D.classify(x, z), ...V3D.probeGround(x, z) });
    }
    const trees = V3D.legacyTrees({ instances: true });
    const treesInsideField = trees.instances.filter(([x, , z]) => fieldRings.some(r => inside(x, z, r)));
    const nearbyMeshes = V3D.sceneInventory().filter(mesh => {
      const b = mesh.bbox;
      return b?.every(Number.isFinite) && b[0] < -125 && b[3] > -390 && b[2] < 275 && b[5] > 135
        && b[3] - b[0] < 800 && b[5] - b[2] < 800;
    });
    return { fieldRings, features: featureGeometry, rangeFacilities: M.scenery.rangeFacilities ?? null,
      rangeTee: M.scenery.rangeTee ?? null, buildings: M.infra.buildings.filter(b => /range|practice/.test(b.id ?? '')),
      placementPolicy: { terrain: M.infra.terrainPlacement ?? null, objects: M.infra.objectPlacement ?? null,
        vegetation: M.infra.vegetationPlacement ?? null },
      fieldGrid: grid, treesInsideField, treeColumns: ['x', 'y', 'z', 'heightScale', 'rotation', 'species', 'reason', 'zone', 'radiusScale'],
      nearbyMeshes,
      geometryNote: 'Feature rings are the loaded model inputs with exact visible-ground samples; sceneInventory records actual rendered mesh bounds. Shared triangle batches do not expose per-feature triangles.' };
  });
  console.log(JSON.stringify({ boot: backend, facilities: report.boot.stats.facilities.status,
    rangeFeatures: report.range.features.length, treesInsideField: report.range.treesInsideField.length }));
  save();
  // Camera/target heights are offsets from the actual visible terrain, so the
  // views remain comparable without changing the source height field.
  const views = [
    ['shelter-close', [-337, 6, 251], [-362, 2.4, 238]],
    ['hitting-line', [-363, 4.5, 204], [-353, .5, 243]],
    ['hitting-line-overhead', [-325, 34, 239], [-356, 0, 228]],
    ['downrange', [-357, 1.8, 226], [-170, 1, 213]],
    ['back-from-targets', [-275, 5, 226], [-358, 2, 227]],
    ['range-overview', [-239, 140, 292], [-245, 0, 211]],
  ];
  for (const light of ['noon', 'golden']) for (const [id, position, look] of views) {
    const camera = await page.evaluate(({ position, look, light }) => {
      const p = [position[0], V3D.terrainH(position[0], position[2]) + position[1], position[2]];
      const t = [look[0], V3D.terrainH(look[0], look[2]) + look[1], look[2]];
      V3D.setPreset(light); V3D.setView(...p, ...t); return { requestedPosition: p, requestedTarget: t };
    }, { position, look, light });
    await page.waitForFunction(() => V3D.settled() && (V3D.v2Plan()?.loading.length ?? 0) === 0,
      null, { timeout: 60000 });
    await page.waitForTimeout(1800);
    const screenshot = path.join(output, `${id}-${light}.png`);
    await page.screenshot({ path: screenshot });
    report.views.push({ id, light, screenshot, ...camera, actualCamera: await page.evaluate(() => V3D.camExact()) });
    save(); console.log(`Captured ${backend} ${id} ${light}: ${screenshot}`);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save(); await browser.close();
}
console.log(JSON.stringify({ backend, after, views: report.views.length, passed: report.passed,
  failure: report.failure, output }));
