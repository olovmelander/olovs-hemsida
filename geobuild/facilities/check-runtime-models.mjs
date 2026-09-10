#!/usr/bin/env node
/* Actual GPU acceptance for the published Veckefjarden facilities.
 * Run after the loader and optimized assets are ready:
 *   node geobuild/facilities/check-runtime-models.mjs http://127.0.0.1:5173
 * Optional --legacy adds a WebGL2, ?v2=0 placement check. Images are private
 * review artifacts, not publication assets; successful assertions still need
 * visual inspection of the captured views. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

process.env.BANVY_GPU ??= '1';
const { browserArgs, GPU } = await import('../../tools/browser-args.mjs');
assert.equal(GPU, true, 'Facility browser acceptance requires BANVY_GPU=1');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = (process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = path.join(ROOT, 'geobuild/cache/facilities-model-2026-09-10/browser');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const MANIFEST_PATH = path.join(ROOT, 'apps/golf/public/models/veckefjarden/facilities-v1.json');
const EXPECTED_IDS = [
  ...Array.from({ length: 12 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
];
const EXPECTED_TRIANGLES = 44422;
const GROUND_CONTACT_IDS = ['S01', 'S04', 'S05', 'S06', 'S07', 'S08'];
const DATUM_SHIFT = 20.9924;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const uniqueSorted = values => [...new Set(values)].sort((a, b) => typeof a === 'number' ? a - b : a.localeCompare(b));
const assertNear = (actual, expected, tolerance, message) =>
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`);

assert.ok(fs.existsSync(MANIFEST_PATH), 'Publish the optimized facilities manifest before running this browser check');
const manifestBytes = fs.readFileSync(MANIFEST_PATH);
const manifest = JSON.parse(manifestBytes);
assert.deepEqual(manifest.facilities.map(f => f.id).sort(), EXPECTED_IDS, 'Published inventory has all 20 reviewed groups');
const expectedSourceIds = uniqueSorted(manifest.facilities.flatMap(f => f.sourceBuildingIds || []));
const expectedSourceIndices = uniqueSorted(manifest.facilities.flatMap(f => f.sourceBuildingIndices || []));
assert.ok(expectedSourceIds.length + expectedSourceIndices.length > 0, 'Manifest declares the source-building replacements');
for (const facility of manifest.facilities) {
  assert.equal(facility.groundAnchorLocal?.length, 2, `${facility.id} has a local ground anchor`);
  assert.ok(facility.groundAnchorLocal.every(Number.isFinite));
  assert.ok(Number.isFinite(facility.groundAnchorRh2000M));
  assert.ok(facility.boundsLocalRh2000?.min?.every(Number.isFinite));
  assert.ok(facility.boundsLocalRh2000?.max?.every(Number.isFinite));
}
fs.mkdirSync(OUT, { recursive: true });
const report = {
  passed: false, capturedAt: new Date().toISOString(), baseUrl: BASE,
  manifestSha256: sha256(manifestBytes), assetSha256: manifest.asset.sha256,
  expected: { facilityIds: EXPECTED_IDS, triangles: EXPECTED_TRIANGLES, sourceBuildingIds: expectedSourceIds,
    sourceBuildingIndices: expectedSourceIndices, v2VerticalDatumShiftMetres: DATUM_SHIFT,
    fittedGroundSurfaceIds: GROUND_CONTACT_IDS, fittedGroundClearanceMetres: .10 },
  groundResidualPolicy: 'Reported, not zero-gated: the modeled ground was sampled on a 2 m grid from native 1 m terrain.',
  cases: [], failures: [],
};
const browser = await chromium.launch({ ...(process.env.BANVY_CHROME
  ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }), args: browserArgs() });

const VIEWS = {
  'clubhouse-west': { ids: ['R01', 'R02', 'S01'], offset: [-65, 20, 7] },
  'clubhouse-east': { ids: ['R01'], offset: [66, 22, -5] },
  campus: { ids: ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'], offset: [-135, 155, 150] },
  'hotel-pool': { ids: ['R03', 'R04', 'R05', 'R06', 'R07', 'S02'], offset: [65, 57, 65] },
  range: { ids: ['R09', 'S08'], offset: [-70, 53, 78] },
  western: { ids: ['R10', 'R11', 'R12'], offset: [-78, 58, 70] },
};

async function capture(page, result, viewName) {
  const definition = VIEWS[viewName];
  const pose = await page.evaluate(({ definition, facilities }) => {
    const V = window.V3D;
    const rendered = V.facilityGeometry()?.facilities || [];
    const selected = definition.ids.map(id => {
      const actual = rendered.find(f => f.id === id);
      if (actual) return actual;
      // Failed-asset screenshots use the same horizontal target as the real
      // asset, with a ground anchor on the currently visible fallback terrain.
      const f = facilities.find(item => item.id === id), bounds = f.boundsLocalRh2000;
      const shift = V.terrainH(...f.groundAnchorLocal) - f.groundAnchorRh2000M;
      return { min: bounds.min.map((v, i) => v + (i === 1 ? shift : 0)),
        max: bounds.max.map((v, i) => v + (i === 1 ? shift : 0)) };
    });
    const min = [0, 1, 2].map(i => Math.min(...selected.map(f => f.min[i])));
    const max = [0, 1, 2].map(i => Math.max(...selected.map(f => f.max[i])));
    const look = min.map((v, i) => (v + max[i]) / 2);
    const position = look.map((v, i) => v + definition.offset[i]);
    position[1] = Math.max(position[1], V.terrainH(position[0], position[2]) + 12);
    V.setPreset('noon');
    V.placeCamera(position, look);
    return { requestedPosition: position, requestedLook: look, targetBounds: { min, max } };
  }, { definition, facilities: manifest.facilities });
  await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 90000 });
  await page.evaluate(() => window.V3D.prepareCapture());
  const file = path.join(OUT, `${result.name}-${viewName}.png`);
  await page.screenshot({ path: file, animations: 'disabled', timeout: 60000 });
  result.captures.push({ view: viewName, path: path.relative(ROOT, file).replaceAll('\\', '/'),
    sha256: sha256(fs.readFileSync(file)), ...pose,
    actualPose: await page.evaluate(() => window.V3D.camExact()) });
}

function checkFallback(runtime) {
  const stats = runtime.stats;
  assert.equal(stats.facilities?.status, 'fallback', 'Blocked GLB keeps the source fallback');
  assert.equal(stats.authoredFacilityBuildings, 0, 'No source building is marked replaced');
  assert.equal(runtime.geometry, null, 'A failed GLB attaches no partial geometry');
  assert.deepEqual(stats.facilities.replacedBuildingIds, []);
  assert.deepEqual(stats.facilities.replacedBuildingIndices, []);
  assert.deepEqual(expectedSourceIds.filter(id => stats.sourceBuildingBatchIds.includes(id)), expectedSourceIds,
    'Every replaced source ID returns to the actual fallback drawing pass');
  assert.deepEqual(expectedSourceIndices.filter(index => stats.sourceBuildingBatchIndices.includes(index)), expectedSourceIndices,
    'Every replaced source index returns to the actual fallback drawing pass');
}

function checkLoaded(runtime, result, legacy) {
  const stats = runtime.stats, loaded = stats.facilities;
  assert.equal(loaded?.status, 'loaded', loaded?.reason || 'Authored facilities loaded');
  assert.equal(runtime.geometry?.assetSha256, manifest.asset.sha256, 'Actual geometry uses the published GLB receipt');
  assert.deepEqual(runtime.geometry.facilities.map(f => f.id).sort(), EXPECTED_IDS);
  assert.deepEqual(loaded.facilities.map(f => f.id).sort(), EXPECTED_IDS);
  assert.deepEqual(uniqueSorted(loaded.replacedBuildingIds), expectedSourceIds);
  assert.deepEqual(uniqueSorted(loaded.replacedBuildingIndices), expectedSourceIndices);
  assert.deepEqual(expectedSourceIds.filter(id => stats.sourceBuildingBatchIds.includes(id)), [],
    'No replaced source ID reaches the generic/bespoke fallback batch');
  assert.deepEqual(expectedSourceIndices.filter(index => stats.sourceBuildingBatchIndices.includes(index)), [],
    'No replaced source index reaches the generic/bespoke fallback batch');
  assert.equal(runtime.geometry.facilities.reduce((sum, f) => sum + f.triangles, 0), EXPECTED_TRIANGLES);
  assert.equal(loaded.triangles, EXPECTED_TRIANGLES);
  const roots = new Set();
  result.groundAnchorResiduals = [];
  result.groundContact = [];
  for (const actual of runtime.geometry.facilities) {
    assert.ok(!roots.has(actual.nodeName), `${actual.id} has one distinct top-level node`);
    roots.add(actual.nodeName);
    const placement = loaded.facilities.find(f => f.id === actual.id);
    const source = manifest.facilities.find(f => f.id === actual.id);
    assert.equal(actual.nodeName, source.nodeName, `${actual.id} retains the declared node`);
    assert.equal(actual.meshes, placement.meshes);
    assert.equal(actual.triangles, placement.triangles);
    assert.equal(actual.meshes, source.materialMeshes, `${actual.id} retains its published material batches`);
    assert.equal(actual.triangles, source.triangles, `${actual.id} retains its published triangle count`);
    assert.ok(actual.meshes > 0 && actual.triangles > 0);
    const contact = placement.groundContact;
    assert.ok(contact, `${actual.id} declares whether ground fitting was applied`);
    if (GROUND_CONTACT_IDS.includes(actual.id)) {
      assert.ok(Number.isInteger(contact.meshes) && contact.meshes > 0, `${actual.id} has a tagged ground surface`);
      assert.ok(Number.isInteger(contact.samples) && contact.samples > 0, `${actual.id} samples the visible terrain`);
      assert.ok(Number.isFinite(contact.maximumLiftMetres) && contact.maximumLiftMetres >= 0,
        `${actual.id} records a nonnegative surface lift`);
      assertNear(contact.clearanceMetres, .10, 1e-9, `${actual.id} ground clearance`);
      result.groundContact.push({ id: actual.id, ...contact });
    } else {
      assert.equal(contact.meshes, 0, `${actual.id} architecture is not terrain-fitted`);
      assert.equal(contact.samples, 0);
      assert.equal(contact.maximumLiftMetres, 0);
    }
    for (const key of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
      assertNear(placement.boundsBeforePlacement[key][axis], source.boundsLocalRh2000[key][axis], .002,
        `${actual.id} ${key}[${axis}] source bounds`);
      const before = placement.boundsBeforePlacement[key][axis];
      const fitted = placement.boundsAfterGroundContact[key][axis];
      if (axis !== 1 || !GROUND_CONTACT_IDS.includes(actual.id)) {
        assertNear(fitted, before, .002, `${actual.id} ${key}[${axis}] preserves authored architecture and horizontal position`);
      } else {
        assert.ok(Number.isFinite(fitted) && fitted >= before - .002
          && fitted <= before + contact.maximumLiftMetres + .002,
        `${actual.id} fitted height can only rise by its declared maximum lift`);
      }
      const expected = fitted + (axis === 1 ? placement.shift : 0);
      assertNear(actual[key][axis], expected, .002, `${actual.id} ${key}[${axis}] rendered bounds`);
    }
    const terrainHeight = runtime.anchorGround.find(f => f.id === actual.id).y;
    const residual = source.groundAnchorRh2000M + placement.shift - terrainHeight;
    assert.ok(Number.isFinite(residual), `${actual.id} ground anchor can be evaluated`);
    if (legacy) {
      assert.equal(placement.mode, 'terrain-anchor');
      assertNear(residual, 0, .01, `${actual.id} legacy terrain anchoring`);
    } else {
      assert.equal(placement.mode, 'absolute-rh2000');
      assertNear(placement.shift, DATUM_SHIFT, 1e-7, `${actual.id} applies the measured datum bridge once`);
    }
    result.groundAnchorResiduals.push({ id: actual.id, anchorLocal: source.groundAnchorLocal,
      modelGroundRH2000: source.groundAnchorRh2000M, shift: placement.shift,
      visibleTerrainHeight: terrainHeight, residualMetres: residual });
  }
  assert.deepEqual(result.groundContact.map(f => f.id).sort(), GROUND_CONTACT_IDS,
    'Only the six tagged ground groups receive surface fitting');
  result.maximumGroundContactLiftMetres = Math.max(...result.groundContact.map(f => f.maximumLiftMetres));
  result.groundContactSamples = result.groundContact.reduce((sum, f) => sum + f.samples, 0);
  result.maximumAbsoluteGroundAnchorResidualMetres = Math.max(...result.groundAnchorResiduals.map(f => Math.abs(f.residualMetres)));
}

async function check({ slug, blockAsset = false, legacy = false }) {
  const name = slug + (blockAsset ? '-blocked-asset' : legacy ? '-legacy-webgl2' : '-default-webgpu');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const result = { name, slug, blockedAsset: blockAsset, legacy, passed: false, pageErrors: [], consoleErrors: [],
    facilityRequests: [], failedRequests: [], captures: [] };
  report.cases.push(result);
  page.on('pageerror', error => result.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url;
    if (/favicon|preload/i.test(text)) return;
    if (blockAsset && /\/models\/veckefjarden\/.*\.glb(?:\?|$)/.test(url) && /Failed to load resource/.test(text)) return;
    if ((url.startsWith(BASE) && !/Failed to load resource/.test(text)) || /WebGPU|GPUValidation|WGSL|shader.*error/i.test(text)) {
      result.consoleErrors.push({ text, url });
    }
  });
  page.on('requestfinished', request => {
    if (/\/models\/veckefjarden\//.test(request.url())) result.facilityRequests.push(request.url());
  });
  page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  if (blockAsset) await page.route('**/models/veckefjarden/*.glb', route => route.fulfill({
    status: 503, body: 'Intentional facilities fallback acceptance check', contentType: 'text/plain',
  }));
  try {
    console.log(`Checking ${name}`);
    const query = new URLSearchParams({ bana: slug, hal: '1', vy: 'fritt', ljus: 'dag', det: '1' });
    if (legacy) { query.set('v2', '0'); query.set('gl', '1'); }
    result.url = `${BASE}/?${query}`;
    await page.goto(result.url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    const runtime = await page.evaluate(facilities => {
      const V = window.V3D;
      return { course: V.course().slug, stats: V.stats, geometry: V.facilityGeometry(), terrain: V.v2Terrain(),
        anchorGround: facilities.map(f => ({ id: f.id, y: V.terrainH(...f.groundAnchorLocal) })), renderer: V.rendererInfo() };
    }, manifest.facilities);
    result.runtime = runtime;
    assert.equal(runtime.course, slug);
    assert.equal(runtime.stats.backend, legacy ? 'webgl2' : 'webgpu');
    if (legacy) {
      assert.equal(runtime.terrain.requested, false);
      assert.equal(runtime.terrain.selection.mode, 'off');
    } else {
      assert.equal(runtime.terrain.ready, true, 'Default 1 m terrain is available');
      assert.equal(runtime.terrain.kind, 'graph', 'Default visit uses the reviewed terrain graph');
    }
    assert.ok(Array.isArray(runtime.stats.sourceBuildingBatchIds), 'Actual source-ID drawing ledger is exposed');
    assert.ok(Array.isArray(runtime.stats.sourceBuildingBatchIndices), 'Actual source-index drawing ledger is exposed');
    if (blockAsset) checkFallback(runtime);
    else checkLoaded(runtime, result, legacy);
    const views = blockAsset || legacy ? ['clubhouse-west', 'campus']
      : slug === 'veckefjarden' ? Object.keys(VIEWS) : ['clubhouse-west', 'campus'];
    for (const view of views) await capture(page, result, view);
    assert.deepEqual(result.pageErrors, [], 'No application JavaScript errors');
    assert.deepEqual(result.consoleErrors, [], 'No application/GPU console errors');
    result.passed = true;
    console.log(JSON.stringify({ name, status: runtime.stats.facilities.status, captures: result.captures.length,
      maximumGroundContactLiftMetres: result.maximumGroundContactLiftMetres,
      groundContactSamples: result.groundContactSamples,
      maximumAbsoluteGroundAnchorResidualMetres: result.maximumAbsoluteGroundAnchorResidualMetres }));
  } catch (error) {
    result.failure = error.stack || String(error);
    report.failures.push({ name, failure: result.failure });
    console.error(`${name}: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, `${name}-failure.png`), timeout: 10000 }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await page.close();
  }
}

try {
  const cases = [{ slug: 'veckefjarden' }, { slug: 'veckefjarden-korthalsbanan' }, { slug: 'veckefjarden', blockAsset: true }];
  if (process.argv.includes('--legacy')) cases.push({ slug: 'veckefjarden', legacy: true });
  for (const options of cases) await check(options);
  report.passed = report.failures.length === 0 && report.cases.every(c => c.passed);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (!report.passed) process.exitCode = 1;
