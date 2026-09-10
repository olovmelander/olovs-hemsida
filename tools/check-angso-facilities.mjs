#!/usr/bin/env node
/* Real WebGPU acceptance for the published Ängsö facility asset. Run against
 * Vite or a production preview after exporting the Blender model:
 *   node tools/check-angso-facilities.mjs http://127.0.0.1:5173
 * The second visit injects a GLB failure and verifies the actual fallback
 * building/parking batch ledgers. Captures still require visual inspection. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { ANGSO_FACILITY_SOURCE_IDS } from '../apps/golf/src/engine/scenery/angso-facilities.mjs';

process.env.BANVY_GPU ??= '1';
const { browserArgs, GPU } = await import('./browser-args.mjs');
assert.equal(GPU, true, 'This acceptance check requires BANVY_GPU=1');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.find(argument => /^https?:/.test(argument)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = path.join(ROOT, 'angsobuild/cache/facilities-model-2026-09-10/browser');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(ROOT, 'apps/golf/public/models/angso/facilities-v1.json');
assert.ok(fs.existsSync(manifestPath), 'Publish Ängsö facilities-v1.json before running the browser check');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedIds = [...ANGSO_FACILITY_SOURCE_IDS].sort();
const expectedParking = manifest.facilities.flatMap(facility => facility.sourceParkingIndices ?? []).sort((a, b) => a - b);
assert.deepEqual(manifest.facilities.flatMap(facility => facility.sourceBuildingIds).sort(), expectedIds);
assert.deepEqual(expectedParking, [2, 3], 'Only the two identified hardstanding areas replace source parking');
const report = { passed: false, capturedAt: new Date().toISOString(), baseUrl: BASE, backend: 'webgpu',
  manifestSha256: sha256(fs.readFileSync(manifestPath)), assetSha256: manifest.asset.sha256, cases: [], failures: [] };
const browser = await chromium.launch({ ...(process.env.BANVY_CHROME
  ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }), args: browserArgs() });

async function capture(page, prefix, view, result) {
  const pose = await page.evaluate(({ view, facilities }) => {
    const V = window.V3D, geometry = V.facilityGeometry();
    const targetId = view === 'northern-service' ? 'B13' : view === 'range' ? 'B12' : 'B01';
    const node = geometry?.facilities.find(facility => facility.id === targetId);
    const source = facilities.find(facility => facility.id === targetId);
    const [x, z] = source.groundAnchorLocal;
    const ground = V.terrainH(x, z), y = node ? Math.min(node.max[1] - .2, ground + 3.5) : ground + 3.5;
    let position, look = [x, y, z];
    if (view === 'courtyard') {
      position = [x + 42, ground + 16, z + 63]; look = [x + 8, ground + 3, z + 12];
    } else if (view === 'restaurant-parking') {
      position = [x - 54, ground + 11, z - 35];
    } else if (view === 'campus') {
      position = [x + 145, ground + 165, z + 195]; look = [x - 9, ground + 2, z + 17];
    } else if (view === 'range') {
      position = [x - 43, ground + 20, z + 56]; look = [x - 13, ground + 1.5, z - 2];
    } else if (view === 'northern-service') {
      position = [x + 57, ground + 30, z + 62];
    }
    position[1] = Math.max(position[1], V.terrainH(position[0], position[2]) + 5);
    V.setPreset('dag'); V.placeCamera(position, look);
    return { requestedPosition: position, requestedLook: look };
  }, { view, facilities: manifest.facilities });
  await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 90000 });
  await page.evaluate(() => window.V3D.prepareCapture());
  const file = path.join(OUT, `${prefix}-${view}.png`);
  await page.screenshot({ path: file, animations: 'disabled', timeout: 60000 });
  result.captures.push({ view, path: path.relative(ROOT, file).replaceAll('\\', '/'),
    sha256: sha256(fs.readFileSync(file)), ...pose, actualPose: await page.evaluate(() => window.V3D.camExact()) });
  console.log(`${prefix}: captured ${view}`);
}

async function check({ blockAsset = false }) {
  const name = blockAsset ? 'angso-blocked-asset' : 'angso';
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1,
    serviceWorkers: 'block' });
  const page = await context.newPage();
  const result = { name, slug: 'angso', blockedAsset: blockAsset, passed: false,
    errors: [], consoleErrors: [], requests: [], captures: [] };
  report.cases.push(result);
  page.on('pageerror', error => result.errors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url;
    if (/favicon|preload/i.test(text) || (blockAsset && /models\/angso\/.*\.glb/.test(url))) return;
    if ((url.startsWith(BASE) && !/Failed to load resource/.test(text)) || /WebGPU|GPUValidation|WGSL|shader.*error/i.test(text)) {
      result.consoleErrors.push({ text, url });
    }
  });
  page.on('response', response => {
    if (/models\/angso\//.test(response.url())) result.requests.push({ url: response.url(), status: response.status() });
  });
  if (blockAsset) await page.route('**/models/angso/*.glb', route =>
    route.fulfill({ status: 503, body: 'Intentional facilities fallback acceptance check', contentType: 'text/plain' }));
  try {
    console.log(`checking ${name}`);
    await page.goto(`${BASE}/?bana=angso&hal=1&vy=fritt&ljus=dag&det=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    const runtime = await page.evaluate(anchors => {
      const V = window.V3D;
      return { course: V.course().slug, stats: V.stats, geometry: V.facilityGeometry(), terrain: V.v2Terrain(),
        anchorGround: anchors.map(facility => ({ id: facility.id, y: V.terrainH(...facility.groundAnchorLocal) })),
        sourceParking: V.M.infra.parking.map((parking, index) => ({ index, id: parking.id })),
        sourceRangePresent: !!V.M.scenery.rangeFacilities, renderer: V.rendererInfo() };
    }, manifest.facilities);
    result.runtime = runtime;
    assert.equal(runtime.course, 'angso', 'Loaded the intended course');
    assert.equal(runtime.stats.backend, 'webgpu', 'The acceptance frame uses WebGPU');
    assert.equal(runtime.terrain.ready, true, 'The default Ängsö metre terrain is available');
    const renderedIds = runtime.stats.sourceBuildingBatchIds, parkingIndices = runtime.stats.sourceParkingBatchIndices;
    assert.ok(Array.isArray(renderedIds), 'Actual source-building batch ledger is exposed');
    assert.ok(Array.isArray(parkingIndices), 'Actual source-parking batch ledger is exposed');
    assert.ok(parkingIndices.includes(4), 'The motorhome lot stays in the source parking pass');
    if (blockAsset) {
      assert.equal(runtime.stats.facilities?.status, 'fallback', 'Blocked GLB keeps source geometry');
      assert.equal(runtime.stats.authoredFacilityBuildings, 0);
      assert.equal(runtime.geometry, null, 'A failed GLB attaches no partial geometry');
      assert.deepEqual(expectedIds.filter(id => renderedIds.includes(id)), expectedIds, 'All six source building IDs reach their drawing pass');
      assert.deepEqual(runtime.stats.facilities.replacedBuildingIds, []);
      assert.deepEqual(runtime.stats.facilities.replacedParkingIndices, []);
      assert.ok(expectedParking.every(index => parkingIndices.includes(index)), 'Both source parking surfaces are retained');
      assert.equal(runtime.stats.authoredRangeFacilities, false, 'A failed asset does not suppress generic range facilities');
      assert.equal(runtime.stats.facilityExcludedTrees, 0, 'A failed asset adds no footprint tree exclusions');
      assert.equal(runtime.stats.facilityExcludedClutter, 0, 'A failed asset adds no surface clutter exclusions');
    } else {
      assert.equal(runtime.stats.facilities?.status, 'loaded', runtime.stats.facilities?.reason || 'Authored facilities loaded');
      assert.equal(runtime.stats.authoredFacilityBuildings, expectedIds.length);
      assert.equal(runtime.geometry?.assetSha256, manifest.asset.sha256, 'Rendered asset matches the published receipt');
      assert.deepEqual(runtime.geometry.facilities.flatMap(facility => facility.sourceBuildingIds).sort(), expectedIds);
      assert.deepEqual(runtime.stats.facilities.replacedBuildingIds.slice().sort(), expectedIds);
      assert.deepEqual(expectedIds.filter(id => renderedIds.includes(id)), [], 'No authored replacement enters the source building batch');
      assert.deepEqual(runtime.stats.facilities.replacedParkingIndices.slice().sort((a, b) => a - b), expectedParking);
      assert.deepEqual(expectedParking.filter(index => parkingIndices.includes(index)), [], 'Authored parking has no duplicate source surface');
      assert.equal(runtime.stats.authoredRangeFacilities, true, 'Authored range owns the range facility pass');
      assert.ok(runtime.stats.facilities.groundSurfaceExclusionCount > 0, 'Exact authored surface rings exclude display clutter');
      assert.ok(runtime.stats.facilityExcludedClutter > 0, 'Generated clutter is removed from the authored paving');
      assert.equal(runtime.geometry.facilities.length, manifest.facilities.length, 'Every declared facility is installed');
      const roots = new Set();
      for (const actual of runtime.geometry.facilities) {
        assert.ok(!roots.has(actual.nodeName), 'Every facility has one root'); roots.add(actual.nodeName);
        const placement = runtime.stats.facilities.facilities.find(facility => facility.id === actual.id);
        const source = manifest.facilities.find(facility => facility.id === actual.id);
        assert.ok(source && placement, 'Rendered facility retains its manifest identity');
        assert.equal(actual.meshes, placement.meshes); assert.equal(actual.triangles, placement.triangles);
        assert.ok(actual.meshes > 0 && actual.triangles > 0);
        for (const key of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
          assert.ok(Number.isFinite(actual[key][axis]));
          const expected = placement.boundsBeforePlacement[key][axis] + (axis === 1 ? placement.shift : 0);
          assert.ok(Math.abs(actual[key][axis] - expected) < .002,
            `${actual.id}: bounds retain horizontal position and receive exactly one vertical shift`);
        }
        const ground = runtime.anchorGround.find(point => point.id === source.id).y;
        assert.ok(Number.isFinite(ground), `${actual.id}: actual ground is available`);
        if (source.placement === 'terrain-anchor') {
          assert.equal(placement.mode, 'terrain-anchor');
          assert.ok(Math.abs(source.groundAnchorRh2000M + placement.shift - ground) < .01, 'Anchor sits on visible terrain');
        } else {
          assert.equal(placement.mode, 'absolute-rh2000');
          assert.ok(Math.abs(placement.shift) < .001, 'Ängsö RH2000 heights use their zero datum bridge');
        }
      }
    }
    for (const view of blockAsset ? ['courtyard', 'campus']
      : ['courtyard', 'restaurant-parking', 'campus', 'range', 'northern-service']) await capture(page, name, view, result);
    assert.deepEqual(result.errors, [], 'No application JavaScript errors');
    assert.deepEqual(result.consoleErrors, [], 'No application/GPU console errors');
    result.passed = true;
    console.log(JSON.stringify({ name, status: runtime.stats.facilities.status,
      authored: runtime.stats.authoredFacilityBuildings, captures: result.captures.length }));
  } catch (error) {
    result.failure = error.stack || String(error);
    report.failures.push({ name, failure: result.failure });
    console.error(`${name}: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, `${name}-failure.png`), timeout: 10000 }).catch(() => {});
  } finally {
    await context.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

try {
  const cases = process.argv.includes('--primary-only') ? [{}]
    : process.argv.includes('--blocked-only') ? [{ blockAsset: true }] : [{}, { blockAsset: true }];
  for (const options of cases) await check(options);
  report.passed = report.failures.length === 0 && report.cases.every(result => result.passed);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (!report.passed) process.exitCode = 1;
