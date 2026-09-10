import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Hardware capture is opt-in, matching the shared browser harness policy.
if (process.argv.includes('--gpu')) process.env.BANVY_GPU = '1';
const { browserArgs } = await import('../../tools/browser-args.mjs');

// Uses the ordinary preview entry point: no v2=require, alternate terrain,
// quality or diagnostic geometry switches. Pass --webgl for the other backend,
// and --gpu to capture with this workstation's real adapter.
const webgl = process.argv.includes('--webgl');
const probesOnly = process.argv.includes('--probes-only');
const backend = webgl ? 'webgl2' : 'webgpu';
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://localhost:5173';
const output = path.resolve('nvgkbuild/cache/facilities-reference/runtime-review', `${backend}${probesOnly ? '-probes' : ''}`);
fs.mkdirSync(output, { recursive: true });
const url = new URL('/', base);
url.search = `bana=norrfallsviken&hal=1&vy=tee&ljus=dag${webgl ? '&gl=1' : ''}`;
const report = { startedAt: new Date().toISOString(), url: url.href, requestedBackend: backend,
  errors: [], consoleErrors: [], failedRequests: [], views: [], checks: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: [...browserArgs(), ...(webgl ? ['--disable-webgpu'] : [])] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 240000 });
  report.boot = await page.evaluate(() => ({ stats: V3D.stats, terrain: V3D.v2Terrain(),
    architecture: V3D.facilityGeometry?.(), badge: document.getElementById('hdsub')?.textContent }));
  console.log(JSON.stringify({ boot: report.boot.stats.facilities, backend: report.boot.stats.backend }));
  save();
  assert.equal(report.boot.stats.backend, backend);
  assert.equal(report.boot.terrain.ready, true, 'Default preview did not install v2 terrain');
  assert.equal(report.boot.terrain.kind, 'graph');
  const facilities = report.boot.stats.facilities;
  assert.equal(facilities?.status, 'loaded');
  assert.deepEqual([...facilities.replacedBuildingIds].sort(), ['lm-range-shelter', 'w1205924894']);
  assert.equal(facilities.facilities.length, 4, 'Four measured roof assemblies must be installed');
  // 14 material batches: the base workspace's seven plus the refined range
  // shelter's own materials; 88 parts = 87 base - 22 base shelter + 23 refined.
  assert.equal(facilities.meshes, 14);
  assert.equal(facilities.sourceParts, 88);
  assert.equal(facilities.refinedRangeShelterParts, 23);
  assert.equal(facilities.solarArrays, 2);
  assert.ok(facilities.triangles >= 4182, 'Architecture triangles and foundation skirts must exist');
  assert.ok(facilities.facilities.every(f => f.mode === 'absolute-rh2000' && Math.abs(f.shift - 20.3432) < 1e-6));
  const ids = report.boot.stats.sourceBuildingBatchIds;
  assert.ok(Array.isArray(ids));
  assert.ok(!ids.includes('w1205924894') && !ids.includes('lm-range-shelter'), 'Old buildings overlap authored facilities');
  assert.ok(ids.includes('lm-practice-shed'), 'Unresolved practice shed was removed');
  const counts = report.boot.stats.courtyardDetails?.counts;
  report.checks.retainedCourtyardCounts = counts ?? null;
  if (counts) {
    assert.equal(counts.range_mat, 12, 'The twelve outdoor range mats must remain');
    assert.equal(counts.range_platform, 4, 'The four reviewed range platforms must be drawn');
    assert.equal(counts.range_target_surface, 3, 'The three target patches must remain');
    assert.equal(counts.sports_court, 1, 'The padel court must remain');
  }
  report.checks.defaultGraph = true;
  report.checks.authoredFacilities = true;
  report.checks.replacementIds = true;
  report.checks.retainedPracticeShed = true;
  const site = JSON.parse(fs.readFileSync('apps/golf/src/engine/scenery/norrfallsviken-facilities-site.json', 'utf8'));
  const { projectFacilityPoint, facilityFootprints } = await import('../../apps/golf/src/engine/scenery/norrfallsviken-facilities.mjs');
  const terraceRing = site.terrace.verticesEpsg3006RH2000.map(point => {
    const [x, , z] = projectFacilityPoint(point); return [x, z];
  });
  report.contactProbes = await page.evaluate(({ terraceRing, facilityFootprints }) => {
    const inside = (x, z, ring) => {
      let result = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
      }
      return result;
    };
    const terraceLevel = V3D.stats.facilities.siteHeights.terrace;
    const samples = [];
    const xs = terraceRing.map(p => p[0]), zs = terraceRing.map(p => p[1]);
    for (let z = Math.floor(Math.min(...zs) * 2) / 2; z <= Math.max(...zs); z += .5) {
      for (let x = Math.floor(Math.min(...xs) * 2) / 2; x <= Math.max(...xs); x += .5) {
        if (!inside(x, z, terraceRing)) continue;
        const ground = V3D.probeGround(x, z);
        samples.push({ x, z, terrainHeight: ground.h, heightAboveFlatTerrace: +(ground.h - terraceLevel).toFixed(4) });
      }
    }
    const trees = V3D.legacyTrees({ instances: true });
    const nearby = trees.instances.filter(([x, , z]) => facilityFootprints.some(({ ring }) => {
      const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
      const cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
      return Math.hypot(x - cx, z - cz) < 30;
    }));
    return { terraceRing, terraceLevel, samples,
      maximumTerrainAboveFlatTerrace: Math.max(...samples.map(p => p.heightAboveFlatTerrace)),
      samplesAboveFlatTerrace: samples.filter(p => p.heightAboveFlatTerrace > 0).length,
      treeColumns: ['x', 'y', 'z', 'heightScale', 'rotation', 'species', 'reason', 'zone', 'radiusScale'],
      nearbyTrees: nearby, footprintRings: facilityFootprints,
      treesWithTrunksInsideFootprints: nearby.filter(([x, , z]) => facilityFootprints.some(({ ring }) => inside(x, z, ring))),
    };
  }, { terraceRing, facilityFootprints });
  console.log(JSON.stringify({ contactProbes: { maximumTerrainAboveFlatTerrace: report.contactProbes.maximumTerrainAboveFlatTerrace,
    samplesAboveFlatTerrace: report.contactProbes.samplesAboveFlatTerrace,
    nearbyTrees: report.contactProbes.nearbyTrees.length } }));
  save();
  const views = [
    ['clubhouse-east', [-351, 63, 139], [-396, 56, 129]],
    ['clubhouse-roof', [-421, 89, 166], [-397, 56, 131]],
    ['north-pavilion', [-365, 64, 91], [-404, 56, 109]],
    ['campus', [-288, 142, 278], [-396, 53, 177]],
    ['range', [-318, 61, 258], [-362, 53, 238]],
  ];
  for (const light of probesOnly ? [] : ['noon', 'golden']) for (const [id, position, look] of views) {
    await page.evaluate(({ position, look, light }) => {
      V3D.setPreset(light); V3D.setView(...position, ...look);
    }, { position, look, light });
    await page.waitForFunction(() => V3D.settled() && (V3D.v2Plan()?.loading.length ?? 0) === 0,
      null, { timeout: 60000 });
    await page.waitForTimeout(1800);
    const screenshot = path.join(output, `${id}-${light}.png`);
    await page.screenshot({ path: screenshot });
    report.views.push({ id, light, screenshot, camera: await page.evaluate(() => V3D.camExact()) });
    save();
    console.log(`Captured ${backend} ${id} ${light}: ${screenshot}`);
  }
  report.final = await page.evaluate(() => ({ facilities: V3D.stats.facilities, terrain: V3D.v2Terrain() }));
  assert.deepEqual(report.errors, [], 'Browser runtime exceptions');
  assert.deepEqual(report.consoleErrors, [], 'Browser console errors');
  report.checks.noBrowserErrors = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  await browser.close();
}
console.log(JSON.stringify({ backend, views: report.views.length, checks: report.checks, failure: report.failure,
  errors: report.errors, consoleErrors: report.consoleErrors, report: path.join(output, 'report.json') }));
