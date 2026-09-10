/** Multi-building display verification: exact source/asset identities, cluster
 * captures, source inspection and an isolated asset failure. No source pack or
 * renderer changes are made. Software rendering is not performance evidence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { loadAuthoredBuildings } from '../apps/golf/src/engine/authored-buildings.mjs';

const HELP = 'Usage: node tortunabuild/check-facilities.mjs [--base http://localhost:5174/] [--out tortunabuild/facilities/browser] [--chrome PATH] [--width 960] [--height 600] [--timeout 600] [--clusters entry-building,range-shelter]';
const CLUBHOUSE = 'way/1163533127', SHELTER = 'tortuna-range-shelter';
const EXPECTED_IDS = [CLUBHOUSE, 'way/1163533128', SHELTER, 'way/1163533113', 'way/1163533114', 'way/1163533115', 'way/1163533123', 'way/1163607303'];
const FROZEN_PACK = { sha256: '746d8475e7aff2be389963331d5a9cef80cb7b056a7c6b8ca5d775b11b6c9931', bytes: 628463 };
const FROZEN_CLUBHOUSE = '1a78f59daa18e4474c8e0c5856d10a94acae7de36f7ffb9c75556fe1fb6b92b0';
const CLUSTERS = [
  { id: 'entry-building', ids: ['way/1163533128'], direction: [0.95, 0.15] },
  { id: 'range-shelter', ids: [SHELTER], direction: [-0.65, 0.76] },
  { id: 'northern-buildings', ids: ['way/1163533113', 'way/1163533114', 'way/1163533115'], direction: [-0.65, 0.76] },
  { id: 'western-workshop', ids: ['way/1163533123'], direction: [0.65, 0.76] },
  { id: 'eastern-house', ids: ['way/1163607303'], direction: [0.65, 0.76] },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const sorted = values => [...values].sort();
const sourceRows = buildings => buildings.map(({ id, ring, roofSurface }) => ({ id, ring, roofSurface: roofSurface ?? null }));
const meshKey = mesh => JSON.stringify([mesh.name, mesh.vertices, mesh.bbox]);
const multiset = meshes => meshes.reduce((result, mesh) => { const key = meshKey(mesh); result[key] = (result[key] || 0) + 1; return result; }, {});

function options(args) {
  const o = { base: 'http://localhost:5174/', out: 'tortunabuild/facilities/browser', width: 960, height: 600, timeout: 600 };
  const keys = new Set(Object.keys(o).concat('chrome', 'clusters'));
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !keys.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid option ${args[i]}`);
    o[key] = value;
  }
  if (!['http:', 'https:'].includes(new URL(o.base).protocol)) throw new Error('--base requires HTTP(S)');
  for (const key of ['width', 'height', 'timeout']) {
    o[key] = Number(o[key]);
    if (!Number.isSafeInteger(o[key]) || o[key] <= 0) throw new Error(`Invalid --${key}`);
  }
  if (o.width > 4096 || o.height > 4096) throw new Error('Viewport exceeds 4096 pixels');
  if (o.clusters) {
    o.clusters = o.clusters.split(',');
    if (o.clusters.some(id => !CLUSTERS.some(cluster => cluster.id === id))) throw new Error('Unknown cluster');
  }
  o.out = path.resolve(o.out);
  return o;
}

function describeMeshes(object) {
  const meshes = [];
  object.updateMatrixWorld(true);
  object.traverse(node => {
    if (!node.isMesh) return;
    // Match V3D.sceneInventory's Box3.setFromObject behavior, including nested
    // meshes, without importing a second Three entry point into this harness.
    const box = node.geometry.boundingBox.clone().makeEmpty();
    node.traverse(child => {
      if (child.isMesh) box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
    });
    meshes.push({ name: node.name, vertices: node.geometry.attributes.position.count,
      bbox: [...box.min.toArray(), ...box.max.toArray()].map(Math.round) });
  });
  assert.ok(meshes.length && meshes.every(mesh => mesh.name), 'Named authored meshes are required for scene identity checks');
  return meshes;
}

function clusterViews(records) {
  return CLUSTERS.map(cluster => {
    const members = cluster.ids.map(id => records.find(record => record.descriptor.buildingId === id));
    assert.ok(members.every(Boolean), `Missing cluster member: ${cluster.id}`);
    const bounds = { min: [0, 1, 2].map(axis => Math.min(...members.map(record => record.decoded.bounds.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...members.map(record => record.decoded.bounds.max[axis]))) };
    const target = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
    const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
    const distance = Math.max(20, extent * 1.5), rise = Math.max(8, extent * 0.38);
    const norm = Math.hypot(...cluster.direction), [dx, dz] = cluster.direction.map(value => value / norm);
    return { id: cluster.id, buildingIds: cluster.ids, bounds, target,
      position: [target[0] + dx * distance, target[1] + rise, target[2] + dz * distance], fov: 48 };
  });
}

async function reference(request, base) {
  const { authoredBuildings: descriptors } = await import('../apps/golf/src/engine/scenery/tortuna.js');
  assert.deepEqual(sorted(descriptors?.map(row => row.buildingId) || []), sorted(EXPECTED_IDS), 'The seven selected facilities and retained clubhouse are required');
  assert.equal(descriptors.find(row => row.buildingId === CLUBHOUSE).asset.sha256, FROZEN_CLUBHOUSE, 'The already reviewed clubhouse must remain unchanged');
  const indexResponse = await request.get(new URL('courses/index.json', base).href);
  assert.equal(indexResponse.status(), 200);
  const entry = (await indexResponse.json()).courses.find(row => row.slug === 'tortuna');
  assert.ok(entry, 'Server must publish Tortuna');
  assert.equal(entry.sha256, FROZEN_PACK.sha256, 'Display facilities must not rebuild the source pack');
  assert.equal(entry.bytes, FROZEN_PACK.bytes);
  const response = await request.get(new URL(entry.packUrl, base).href);
  assert.equal(response.status(), 200);
  const bytes = await response.body();
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  const pack = readPack(bytes), model = JSON.parse(inflateStream(pack.sv));
  assert.equal(pack.header.slug, 'tortuna');
  const prepared = await loadAuthoredBuildings({ descriptors, buildings: model.infra.buildings, baseUrl: base.href });
  assert.equal(prepared.byBuildingId.size, descriptors.length, JSON.stringify(prepared.diagnostics));
  const records = descriptors.map(descriptor => {
    const building = model.infra.buildings.find(row => row.id === descriptor.buildingId), loaded = prepared.byBuildingId.get(descriptor.buildingId);
    assert.ok(building, `Missing source building ${descriptor.buildingId}`);
    return { descriptor, decoded: loaded.details, meshes: describeMeshes(loaded.object),
      source: { ringSha256: jsonHash(building.ring), roofSha256: jsonHash(building.roofSurface ?? null),
        roofTriangles: (building.roofSurface?.triangleIndices?.length || 0) / 3, hasMeasuredRoof: !!building.roofSurface,
        generic: !building.roofSurface && building.kind !== 'roof' && building.amenity !== 'place_of_worship' } };
  });
  const roofBuildings = model.infra.buildings.filter(building => building.roofSurface);
  return { pack: { url: entry.packUrl, ...FROZEN_PACK }, records, views: clusterViews(records),
    source: { geometrySha256: jsonHash(sourceRows(model.infra.buildings)), buildingCount: model.infra.buildings.length,
      holeNumbers: model.holes.map(hole => hole.n), measuredRoofBuildings: roofBuildings.length,
      measuredRoofTriangles: roofBuildings.reduce((sum, building) => sum + building.roofSurface.triangleIndices.length / 3, 0),
      genericRoofBuildings: model.infra.buildings.filter(building => !building.roofSurface && building.ring.length >= 3
        && building.kind !== 'roof' && building.amenity !== 'place_of_worship').length } };
}

async function settle(page, timeout) {
  const start = await page.evaluate(() => { window.__facilitiesIdle = null; return V3D.frame(); });
  await page.waitForFunction(frame => {
    const V = window.V3D;
    if (!V) { window.__facilitiesIdle = null; return false; }
    const adapter = V.v2Terrain().adapter, plan = V.v2Plan();
    if (adapter?.kind !== 'graph' || adapter.phase !== 'ready' || !adapter.active || adapter.stream?.loadingTiles !== 0
      || adapter.stream.failedTiles !== 0 || !V.settled() || !plan) { window.__facilitiesIdle = null; return false; }
    const signature = JSON.stringify([plan.render.slice().sort(), plan.ready.slice().sort()]);
    let idle = window.__facilitiesIdle;
    if (!idle || idle.signature !== signature) idle = window.__facilitiesIdle = { signature, at: performance.now(), frame: V.frame() };
    return performance.now() - idle.at >= 350 && V.frame() >= Math.max(frame, idle.frame) + 2;
  }, start, { polling: 50, timeout });
}

async function inspect(page, expected) {
  return page.evaluate(async ({ ids, meshNames }) => {
    const V = window.V3D, names = new Set(meshNames);
    const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const rows = V.M.infra.buildings.map(({ id, ring, roofSurface }) => ({ id, ring, roofSurface: roofSurface ?? null }));
    const buildings = await Promise.all(ids.map(async id => {
      const building = V.M.infra.buildings.find(row => row.id === id);
      return { id, ringSha256: await hash(building.ring), roofSha256: await hash(building.roofSurface ?? null) };
    }));
    return { course: V.course().slug, authored: V.authoredBuildings(), buildings,
      source: { geometrySha256: await hash(rows), buildingCount: V.M.infra.buildings.length, holeNumbers: V.HOLES.map(hole => hole.n) },
      stats: Object.fromEntries(['backend', 'authoredBuildingModels', 'authoredBuildingMeshes', 'authoredBuildingTriangles',
        'sourceRoofBuildings', 'sourceRoofTriangles', 'measuredRoofBuildings', 'measuredRoofTriangles', 'genericRoofBuildings'].map(key => [key, V.stats[key]])),
      meshes: V.sceneInventory().filter(mesh => names.has(mesh.name)), camera: V.camExact(), lens: V.cameraInfo(),
      quality: V.quality(), renderer: V.rendererInfo(), terrain: V.v2Terrain().adapter };
  }, { ids: EXPECTED_IDS, meshNames: expected.records.flatMap(record => record.meshes.map(mesh => mesh.name)) });
}

function activeRecords(expected, mode) {
  const failedUrl = expected.records.find(record => record.descriptor.buildingId === SHELTER).descriptor.asset.url;
  return expected.records.filter(record => mode !== 'source' && (mode !== 'failed-load' || record.descriptor.asset.url !== failedUrl));
}

function assertState(state, expected, mode) {
  const active = activeRecords(expected, mode), ids = new Set(active.map(record => record.descriptor.buildingId));
  assert.equal(state.course, 'tortuna'); assert.equal(state.stats.backend, 'webgl2');
  assert.equal(state.terrain.kind, 'graph'); assert.equal(state.terrain.active, true);
  assert.deepEqual(state.source, { geometrySha256: expected.source.geometrySha256, buildingCount: expected.source.buildingCount, holeNumbers: expected.source.holeNumbers });
  assert.deepEqual(sorted(state.authored.map(record => record.buildingId)), sorted(EXPECTED_IDS));
  for (const record of expected.records) {
    const id = record.descriptor.buildingId, actual = state.authored.find(row => row.buildingId === id), source = state.buildings.find(row => row.id === id);
    assert.deepEqual(source, { id, ringSha256: record.source.ringSha256, roofSha256: record.source.roofSha256 });
    assert.deepEqual(actual.asset, record.descriptor.asset);
    assert.equal(actual.status, ids.has(id) ? 'loaded' : mode === 'source' ? 'source-view' : 'fallback');
    assert.equal(actual.sourceFootprintUnchanged, true); assert.equal(actual.sourceRoofUnchanged, true);
    if (ids.has(id)) {
      assert.deepEqual(actual.transform, record.decoded.transform); assert.deepEqual(actual.bounds, record.decoded.bounds);
      assert.deepEqual(actual.anchorEpsg3006RH2000, record.descriptor.anchorEpsg3006RH2000);
      assert.equal(actual.sourceFootprintSha256, record.source.ringSha256);
    } else if (mode === 'failed-load') assert.ok(actual.error, `No fallback diagnostic for ${id}`);
  }
  assert.equal(state.stats.sourceRoofBuildings, expected.source.measuredRoofBuildings);
  assert.equal(state.stats.sourceRoofTriangles, expected.source.measuredRoofTriangles);
  assert.equal(state.stats.authoredBuildingModels, active.length);
  assert.equal(state.stats.authoredBuildingMeshes, active.reduce((sum, record) => sum + record.decoded.meshes, 0));
  assert.equal(state.stats.authoredBuildingTriangles, active.reduce((sum, record) => sum + record.decoded.triangles, 0));
  assert.equal(state.stats.measuredRoofBuildings, expected.source.measuredRoofBuildings - active.filter(record => record.source.hasMeasuredRoof).length);
  assert.equal(state.stats.measuredRoofTriangles, expected.source.measuredRoofTriangles - active.reduce((sum, record) => sum + record.source.roofTriangles, 0));
  assert.equal(state.stats.genericRoofBuildings, expected.source.genericRoofBuildings - active.filter(record => record.source.generic).length);
  assert.deepEqual(multiset(state.meshes), multiset(active.flatMap(record => record.meshes)), 'Each placed authored mesh must occur exactly once, with no stale fallback meshes');
  assert.ok(state.meshes.every(mesh => mesh.visible));
  assert.equal(state.quality.lowq, true); assert.equal(state.quality.qualityLocked, true);
}

async function main(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const base = new URL(o.base); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const report = { schemaVersion: 1, date: new Date().toISOString(), base: base.href, passed: false,
    executionAdapter: 'swiftshader-software-webgl2', performanceEvidence: false,
    request: { width: o.width, height: o.height, dpr: 1, clusters: o.clusters || CLUSTERS.map(c => c.id) }, modes: [], errors: [] };
  let browser;
  try {
    const executablePath = o.chrome || process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
      args: ['--no-sandbox', '--disable-lcd-text', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const contextOptions = { viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' };
    const referenceContext = await browser.newContext(contextOptions);
    console.log('Checking eight descriptors, exact source pack and authored GLB assets');
    report.expected = await reference(referenceContext.request, base); await referenceContext.close();
    const expected = report.expected, assetUrls = expected.records.map(record => new URL(record.descriptor.asset.url, base));
    const failedUrl = new URL(expected.records.find(record => record.descriptor.buildingId === SHELTER).descriptor.asset.url, base);
    const sameAsset = (value, target) => { const url = new URL(value); return url.origin === target.origin && url.pathname === target.pathname; };
    const anyAsset = value => assetUrls.some(target => sameAsset(value, target));
    const timeout = o.timeout * 1000;
    for (const mode of ['authored', 'source', 'failed-load']) {
      const row = { mode, passed: false, views: [], requests: [], deliberatelyAborted: [], expectedFailures: [], warnings: [], errors: [] };
      report.modes.push(row);
      const context = await browser.newContext(contextOptions); context.setDefaultTimeout(timeout);
      try {
        if (mode === 'failed-load') await context.route(url => sameAsset(url.href, failedUrl), async route => {
          row.deliberatelyAborted.push(route.request().url()); await route.abort('failed');
        });
        const page = await context.newPage();
        page.on('request', request => { if (anyAsset(request.url())) row.requests.push(request.url()); });
        page.on('pageerror', error => row.errors.push({ type: 'pageerror', text: String(error).slice(0, 3000) }));
        page.on('console', message => {
          const text = message.text(), location = message.location();
          if (mode === 'failed-load' && message.type() === 'error' && location.url && sameAsset(location.url, failedUrl)
            && /Failed to load resource/.test(text)) row.expectedFailures.push({ type: 'console', text });
          else if (message.type() === 'error' || /(?:shader|pipeline|wgsl|glsl).*(?:error|failed|invalid)|validation error/i.test(text)) row.errors.push({ type: message.type(), text: text.slice(0, 3000) });
          else if (message.type() === 'warning') row.warnings.push(text.slice(0, 1500));
        });
        page.on('requestfailed', request => {
          const failure = { type: 'requestfailed', url: request.url(), text: request.failure()?.errorText };
          if (mode === 'failed-load' && sameAsset(request.url(), failedUrl) && row.deliberatelyAborted.includes(request.url())) row.expectedFailures.push(failure);
          else if (failure.text === 'net::ERR_ABORTED' && /\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(failure.url)) row.warnings.push(failure);
          else row.errors.push(failure);
        });
        const url = new URL(base);
        for (const [key, value] of Object.entries({ bana: 'tortuna', v2: 'require', det: '1', q: 'lo', qualitylock: '1', ren: '1', gl: '1', lodmode: 'zone' })) url.searchParams.set(key, value);
        if (mode === 'source') url.searchParams.set('buildingGeometry', 'source');
        row.url = url.href; console.log(`Booting ${mode} facilities`);
        await page.goto(url.href, { waitUntil: 'load', timeout }); await page.waitForSelector('#boot.done', { timeout });
        const views = mode === 'authored' ? expected.views.filter(view => !o.clusters || o.clusters.includes(view.id)) : expected.views.filter(view => view.id === 'range-shelter');
        for (const view of views) {
          console.log(`Settling ${mode}/${view.id}`);
          await page.evaluate(view => { V3D.setPreset('noon'); V3D.setFov(view.fov); V3D.placeCamera(view.position, view.target); }, view);
          await settle(page, timeout);
          const state = await inspect(page, expected); assertState(state, expected, mode);
          assert.deepEqual(state.renderer.drawingBuffer, [o.width, o.height]);
          const targetProjection = await page.evaluate(target => V3D.project(...target), view.target);
          assert.equal(targetProjection.visible, true, 'Cluster must be inside the viewport');
          const captured = { id: view.id, buildingIds: view.buildingIds, state, targetProjection }; row.views.push(captured);
          if (mode === 'authored') {
            const image = `${view.id}.png`; console.log(`Capturing ${image}`);
            const bytes = await page.screenshot({ path: path.join(o.out, image), timeout });
            Object.assign(captured, { image, imageSha256: hash(bytes), imageBytes: bytes.length });
          }
        }
        if (mode === 'source') assert.equal(row.requests.length, 0, 'Source mode must request no display GLBs');
        else assert.deepEqual(sorted(new Set(row.requests.map(value => new URL(value).pathname))), sorted(new Set(assetUrls.map(url => url.pathname))), 'Every selected GLB must be requested');
        if (mode === 'failed-load') assert.ok(row.deliberatelyAborted.length > 0, 'The range shelter failure was not exercised');
        row.passed = row.errors.length === 0;
      } catch (error) { row.errors.push({ type: 'harness', text: String(error.stack || error) }); }
      finally { await context.close(); }
      if (!row.passed) throw new Error(`${mode} facilities verification failed`);
    }
    report.passed = report.modes.length === 3 && report.modes.every(mode => mode.passed);
  } catch (error) { report.errors.push({ type: 'harness', text: String(error.stack || error) }); }
  finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${path.join(o.out, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv.includes('--help')) console.log(HELP);
else {
  try { await main(options(process.argv.slice(2))); }
  catch (error) { console.error(`${error.message}\n${HELP}`); process.exitCode = 1; }
}
