#!/usr/bin/env node
/* Real GPU app/asset acceptance. Run after publishing facilities-v1 assets and
 * building the app: node tools/check-johannesberg-facilities.mjs http://127.0.0.1:8689
 * Both course aliases must install all 22 buildings. A blocked GLB must retain
 * all 22 source-building fallbacks. Screenshots still require visual review. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { JOHANNESBERG_FACILITY_SOURCE_IDS } from '../apps/golf/src/engine/scenery/johannesberg-facilities.mjs';

process.env.BANVY_GPU ??= '1';
const { browserArgs, GPU } = await import('./browser-args.mjs');
assert.equal(GPU, true, 'This acceptance check requires BANVY_GPU=1');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8689').replace(/\/$/, '');
const OUT = path.join(ROOT, 'johannesbergbuild/cache/facilities-model/browser');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(ROOT, 'apps/golf/public/models/johannesberg/facilities-v1.json');
assert.ok(fs.existsSync(manifestPath), 'Publish Johannesberg facilities-v1.json before running the browser check');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedIds = [...JOHANNESBERG_FACILITY_SOURCE_IDS].sort();
assert.deepEqual(manifest.facilities.map(f => f.sourceBuildingId).sort(), expectedIds);
const report = { passed: false, capturedAt: new Date().toISOString(), baseUrl: BASE, backend: 'webgpu',
  manifestSha256: createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
  assetSha256: manifest.asset.sha256, cases: [], failures: [] };
const browser = await chromium.launch({ ...(process.env.BANVY_CHROME
  ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }), args: browserArgs() });

async function capture(page, prefix, view, result) {
  const pose = await page.evaluate(view => {
    const V = window.V3D, geometry = V.facilityGeometry();
    const clubhouse = geometry?.facilities.find(f => f.sourceBuildingId === 'w296165896');
    const b = V.M.infra.buildings.find(f => f.id === 'w296165896');
    const x = clubhouse ? (clubhouse.min[0] + clubhouse.max[0]) / 2 : b.ring.reduce((s, p) => s + p[0], 0) / b.ring.length;
    const z = clubhouse ? (clubhouse.min[2] + clubhouse.max[2]) / 2 : b.ring.reduce((s, p) => s + p[1], 0) / b.ring.length;
    const y = clubhouse ? clubhouse.min[1] + Math.min(5, (clubhouse.max[1] - clubhouse.min[1]) * .5) : V.terrainH(x, z) + 4;
    let position, look;
    if (view === 'clubhouse-front') {
      position = [x + 66, Math.max(y + 12, V.terrainH(x + 66, z + 36) + 12), z + 36];
      look = [x, y, z];
    } else if (view === 'clubhouse-rear') {
      position = [x - 56, Math.max(y + 10, V.terrainH(x - 56, z - 30) + 10), z - 30];
      look = [x, y, z];
    } else {
      const ground = V.terrainH(-90, -900);
      position = [210, ground + 245, -580]; look = [-85, ground + 6, -890];
    }
    V.setPreset('dag');
    V.placeCamera(position, look);
    return { requestedPosition: position, requestedLook: look };
  }, view);
  await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 90000 });
  await page.evaluate(() => window.V3D.prepareCapture());
  const name = `${prefix}-${view}.png`, file = path.join(OUT, name);
  await page.screenshot({ path: file, animations: 'disabled', timeout: 60000 });
  result.captures.push({ view, path: path.relative(ROOT, file).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ...pose, actualPose: await page.evaluate(() => window.V3D.camExact()) });
}

async function check({ slug, blockAsset = false }) {
  const name = slug + (blockAsset ? '-blocked-asset' : '');
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const result = { name, slug, blockedAsset: blockAsset, passed: false, errors: [], consoleErrors: [], requests: [], captures: [] };
  report.cases.push(result);
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url;
    // Expected network errors from the injected asset failure are not JS/GPU
    // failures. Preload warnings and favicon noise do not establish app errors.
    if (/favicon|preload/i.test(text) || (blockAsset && /facilities-v1\.glb|Failed to load resource/.test(text))) return;
    if ((url.startsWith(BASE) && !/Failed to load resource/.test(text)) || /WebGPU|GPUValidation|WGSL|shader.*error/i.test(text)) consoleErrors.push({ text, url });
  });
  page.on('requestfinished', request => {
    if (/models\/johannesberg\//.test(request.url())) result.requests.push(request.url());
  });
  if (blockAsset) await page.route('**/models/johannesberg/*.glb', route =>
    route.fulfill({ status: 503, body: 'Intentional facilities fallback acceptance check', contentType: 'text/plain' }));
  try {
    console.log(`checking ${name}`);
    await page.goto(`${BASE}/?bana=${slug}&hal=1&vy=fritt&ljus=dag&det=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    const got = await page.evaluate(anchors => {
      const V = window.V3D;
      return { course: V.course().slug, stats: V.stats, geometry: V.facilityGeometry(), terrain: V.v2Terrain(),
        anchorGround: anchors.map(f => ({ id: f.id, y: V.terrainH(...f.groundAnchorLocal) })), renderer: V.rendererInfo() };
    }, manifest.facilities);
    result.runtime = got;
    assert.equal(got.course, slug, 'Loaded the intended course');
    assert.equal(got.stats.backend, 'webgpu', 'The acceptance frame uses WebGPU');
    assert.equal(got.terrain.ready, true, 'The default Johannesberg metre terrain is available');
    const renderedIds = got.stats.sourceBuildingBatchIds;
    assert.ok(Array.isArray(renderedIds), 'Actual source-building batch ledger is exposed');
    if (blockAsset) {
      assert.equal(got.stats.facilities?.status, 'fallback', 'Blocked GLB keeps the source fallback');
      assert.equal(got.stats.authoredFacilityBuildings, 0);
      assert.equal(got.geometry, null, 'A failed GLB attaches no partial building geometry');
      assert.deepEqual(expectedIds.filter(id => renderedIds.includes(id)), expectedIds, 'All 22 fallback building IDs reach their drawing pass');
      assert.deepEqual(got.stats.facilities.replacedBuildingIds, []);
    } else {
      assert.equal(got.stats.facilities?.status, 'loaded', got.stats.facilities?.reason || 'Authored facilities loaded');
      assert.equal(got.stats.authoredFacilityBuildings, 22);
      assert.equal(got.geometry?.assetSha256, manifest.asset.sha256, 'Rendered asset matches the published receipt');
      assert.deepEqual(got.geometry.facilities.map(f => f.sourceBuildingId).sort(), expectedIds);
      assert.deepEqual(got.stats.facilities.replacedBuildingIds.slice().sort(), expectedIds);
      assert.deepEqual(expectedIds.filter(id => renderedIds.includes(id)), [], 'No replaced ID, including clubhouse, enters the generic/bespoke fallback batch');
      const roots = new Set();
      for (const actual of got.geometry.facilities) {
        assert.ok(!roots.has(actual.nodeName), 'Every facility has one root'); roots.add(actual.nodeName);
        const placement = got.stats.facilities.facilities.find(f => f.sourceBuildingId === actual.sourceBuildingId);
        const source = manifest.facilities.find(f => f.sourceBuildingId === actual.sourceBuildingId);
        assert.equal(actual.meshes, placement.meshes);
        assert.equal(actual.triangles, placement.triangles);
        assert.ok(actual.meshes > 0 && actual.triangles > 0);
        for (const key of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
          assert.ok(Number.isFinite(actual[key][axis]));
          const expected = placement.boundsBeforePlacement[key][axis] + (axis === 1 ? placement.shift : 0);
          assert.ok(Math.abs(actual[key][axis] - expected) < .002, 'Actual mesh bounds retain horizontal position and receive exactly one vertical shift');
        }
        const ground = got.anchorGround.find(p => p.id === source.id).y;
        if (source.placement === 'terrain-anchor') {
          assert.equal(placement.mode, 'terrain-anchor');
          assert.ok(Math.abs(source.groundAnchorRh2000M + placement.shift - ground) < .01, 'Coarse-surroundings model is grounded on the actual visible terrain');
        } else {
          assert.equal(placement.mode, 'absolute-rh2000');
          assert.ok(Math.abs(placement.shift - 5.6676) < 1e-7, 'Measured source heights use the Johannesberg datum bridge once');
        }
      }
    }
    for (const view of blockAsset ? ['clubhouse-front', 'estate-overview'] : ['clubhouse-front', 'clubhouse-rear', 'estate-overview']) {
      await capture(page, name, view, result);
    }
    result.errors = pageErrors;
    result.consoleErrors = consoleErrors;
    assert.deepEqual(pageErrors, [], 'No application JavaScript errors');
    assert.deepEqual(consoleErrors, [], 'No application/GPU console errors');
    result.passed = true;
    console.log(JSON.stringify({ name, status: got.stats.facilities.status, authored: got.stats.authoredFacilityBuildings, captures: result.captures.length }));
  } catch (error) {
    result.errors = pageErrors;
    result.consoleErrors = consoleErrors;
    result.failure = error.stack || String(error);
    report.failures.push({ name, failure: result.failure });
    console.error(`${name}: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, `${name}-failure.png`), timeout: 10000 }).catch(() => {});
  } finally {
    await page.close();
  }
}

try {
  const cases = process.argv.includes('--primary-only') ? [{ slug: 'johannesberg' }]
    : [{ slug: 'johannesberg' }, { slug: 'johannesberg-9' }, { slug: 'johannesberg', blockAsset: true }];
  for (const options of cases) {
    await check(options);
  }
  report.passed = report.failures.length === 0 && report.cases.every(c => c.passed);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (!report.passed) process.exitCode = 1;
