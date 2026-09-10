/** Verify the authored clubhouse, retained measurements and recoverable source
 * renderer in a real browser. Software screenshots are correctness evidence.
 * node tortunabuild/check-clubhouse.mjs --base http://localhost:5174/ --out tortunabuild/clubhouse/browser
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { loadAuthoredBuildings } from '../apps/golf/src/engine/authored-buildings.mjs';

const HELP = 'Usage: node tortunabuild/check-clubhouse.mjs [--base http://localhost:5174/] [--out tortunabuild/clubhouse/browser] [--chrome PATH] [--width 960] [--height 600] [--timeout 600]';
const BUILDING_ID = 'way/1163533127';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => sha256(JSON.stringify(value));
const counter = rows => rows.reduce((counts, name) => { counts[name] = (counts[name] || 0) + 1; return counts; }, {});
const meshKey = mesh => JSON.stringify([mesh.name, mesh.vertices, mesh.bbox]);
const anchor = [597463.699 - 597400.5, 6614899.5 - 6615075.173];
const point = (u, v, height) => [anchor[0] + u * 0.73044 + v * 0.68298, height, anchor[1] + u * 0.68298 - v * 0.73044];
const VIEWS = [
  { id: 'northeast-facade', position: point(-8, 46, 42), target: point(2, 2, 31), fov: 48 },
  { id: 'pondside-extension', position: point(46, 20, 42), target: point(2, 2, 31), fov: 48 },
];

function options(args) {
  const out = { base: 'http://localhost:5174/', out: 'tortunabuild/clubhouse/browser', width: 960, height: 600, timeout: 600 };
  const keys = new Set(['base', 'out', 'chrome', 'width', 'height', 'timeout']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !keys.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid option ${args[i]}`);
    out[key] = value;
  }
  if (!['http:', 'https:'].includes(new URL(out.base).protocol)) throw new Error('--base requires HTTP(S)');
  for (const key of ['width', 'height', 'timeout']) {
    out[key] = Number(out[key]);
    if (!Number.isSafeInteger(out[key]) || out[key] <= 0) throw new Error(`Invalid --${key}`);
  }
  if (out.width > 4096 || out.height > 4096) throw new Error('Viewport exceeds 4096 pixels');
  out.out = path.resolve(out.out);
  return out;
}

async function reference(request, base) {
  const scenery = await import('../apps/golf/src/engine/scenery/tortuna.js');
  const descriptors = scenery.authoredBuildings;
  const targets = descriptors?.filter(row => row.buildingId === BUILDING_ID) || [];
  assert.equal(targets.length, 1, 'Exactly one reviewed clubhouse descriptor is required');
  const descriptor = targets[0];
  const indexResponse = await request.get(new URL('courses/index.json', base).href);
  assert.equal(indexResponse.status(), 200);
  const entry = (await indexResponse.json()).courses.find(row => row.slug === 'tortuna');
  assert.ok(entry, 'Server must publish Tortuna');
  const response = await request.get(new URL(entry.packUrl, base).href);
  assert.equal(response.status(), 200);
  const bytes = await response.body();
  assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256);
  const pack = readPack(bytes), model = JSON.parse(inflateStream(pack.sv));
  assert.equal(pack.header.slug, 'tortuna');
  const building = model.infra.buildings.find(row => row.id === BUILDING_ID);
  assert.ok(building?.roofSurface, 'Original clubhouse roof evidence is required');
  const prepared = await loadAuthoredBuildings({ descriptors, buildings: model.infra.buildings, baseUrl: base.href });
  assert.equal(prepared.byBuildingId.size, descriptors.length, JSON.stringify(prepared.diagnostics));
  const loaded = prepared.byBuildingId.get(BUILDING_ID);
  const models = descriptors.map(item => {
    const source = model.infra.buildings.find(row => row.id === item.buildingId), entry = prepared.byBuildingId.get(item.buildingId);
    const meshes = [];
    entry.object.traverse(object => {
      if (!object.isMesh) return;
      const box = object.geometry.boundingBox.clone().makeEmpty();
      object.traverse(child => { if (child.isMesh) box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld)); });
      meshes.push({ name: object.name, vertices: object.geometry.attributes.position.count,
        bbox: [...box.min.toArray(), ...box.max.toArray()].map(Math.round) });
    });
    assert.ok(meshes.length && meshes.every(mesh => mesh.name), 'Named authored meshes are required for scene identity checks');
    return { descriptor: item, decoded: entry.details, meshes, hasMeasuredRoof: !!source.roofSurface,
      roofTriangles: (source.roofSurface?.triangleIndices?.length || 0) / 3,
      generic: !source.roofSurface && source.kind !== 'roof' && source.amenity !== 'place_of_worship' };
  });
  const meshes = models.find(item => item.descriptor.buildingId === BUILDING_ID).meshes;
  return {
    descriptor, pack: { sha256: entry.sha256, bytes: entry.bytes, url: entry.packUrl },
    source: { buildingId: building.id, ringSha256: jsonHash(building.ring), roofSha256: jsonHash(building.roofSurface),
      roofTriangles: building.roofSurface.triangleIndices.length / 3, buildingCount: model.infra.buildings.length,
      measuredRoofBuildings: model.infra.buildings.filter(row => row.roofSurface).length,
      measuredRoofTriangles: model.infra.buildings.reduce((sum, row) => sum + (row.roofSurface?.triangleIndices?.length / 3 || 0), 0),
      genericRoofBuildings: model.infra.buildings.filter(row => !row.roofSurface && row.ring.length >= 3
        && row.kind !== 'roof' && row.amenity !== 'place_of_worship').length },
    decoded: loaded.details, meshes, models,
  };
}

async function settle(page, timeout) {
  const start = await page.evaluate(() => { window.__clubhouseIdle = null; return V3D.frame(); });
  await page.waitForFunction(frame => {
    const V = window.V3D;
    if (!V) { window.__clubhouseIdle = null; return false; }
    const adapter = V.v2Terrain().adapter, plan = V.v2Plan();
    if (adapter?.kind !== 'graph' || adapter.phase !== 'ready' || !adapter.active || adapter.stream?.loadingTiles !== 0
      || adapter.stream.failedTiles !== 0 || !V.settled() || !plan) { window.__clubhouseIdle = null; return false; }
    const signature = JSON.stringify([plan.render.slice().sort(), plan.ready.slice().sort()]);
    let idle = window.__clubhouseIdle;
    if (!idle || idle.signature !== signature) idle = window.__clubhouseIdle = { signature, at: performance.now(), frame: V.frame() };
    return performance.now() - idle.at >= 350 && V.frame() >= Math.max(frame, idle.frame) + 2;
  }, start, { polling: 50, timeout });
}

async function inspect(page, expected) {
  return page.evaluate(async ({ id, meshNames }) => {
    const V = window.V3D, building = V.M.infra.buildings.find(row => row.id === id);
    const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const names = new Set(meshNames);
    const meshes = V.sceneInventory().filter(mesh => names.has(mesh.name));
    const stats = Object.fromEntries(['backend', 'authoredBuildingModels', 'authoredBuildingMeshes', 'authoredBuildingTriangles',
      'sourceRoofBuildings', 'sourceRoofTriangles', 'measuredRoofBuildings', 'measuredRoofTriangles', 'genericRoofBuildings',
      'architecturalBuildings', 'architecturalTriangles'].map(key => [key, V.stats[key]]));
    return { course: V.course().slug, authored: V.authoredBuildings(), stats,
      source: { ringSha256: await hash(building.ring), roofSha256: await hash(building.roofSurface), buildingCount: V.M.infra.buildings.length },
      meshes, camera: V.camExact(), lens: V.cameraInfo(), quality: V.quality(), renderer: V.rendererInfo(),
      terrain: V.v2Terrain().adapter };
  }, { id: BUILDING_ID, meshNames: expected.models.flatMap(model => model.meshes.map(mesh => mesh.name)) });
}

function assertState(state, expected, mode) {
  const display = mode === 'authored';
  const active = expected.models.filter(model => mode !== 'source'
    && (mode !== 'failed-load' || model.descriptor.asset.url !== expected.descriptor.asset.url));
  assert.equal(state.course, 'tortuna'); assert.equal(state.stats.backend, 'webgl2');
  assert.equal(state.terrain.kind, 'graph'); assert.equal(state.terrain.active, true);
  assert.deepEqual(state.source, { ringSha256: expected.source.ringSha256, roofSha256: expected.source.roofSha256, buildingCount: expected.source.buildingCount });
  assert.deepEqual(state.authored.map(row => row.buildingId).sort(), expected.models.map(row => row.descriptor.buildingId).sort());
  const record = state.authored.find(row => row.buildingId === BUILDING_ID);
  assert.equal(record.buildingId, BUILDING_ID);
  assert.deepEqual(record.asset, expected.descriptor.asset);
  assert.equal(record.status, display ? 'loaded' : mode === 'source' ? 'source-view' : 'fallback');
  assert.equal(record.sourceFootprintUnchanged, true); assert.equal(record.sourceRoofUnchanged, true);
  assert.equal(state.stats.sourceRoofBuildings, expected.source.measuredRoofBuildings);
  assert.equal(state.stats.sourceRoofTriangles, expected.source.measuredRoofTriangles);
  for (const model of expected.models) {
    const actual = state.authored.find(row => row.buildingId === model.descriptor.buildingId);
    const included = active.includes(model);
    assert.deepEqual(actual.asset, model.descriptor.asset);
    assert.equal(actual.status, included ? 'loaded' : mode === 'source' ? 'source-view' : 'fallback');
    if (included) { assert.deepEqual(actual.transform, model.decoded.transform); assert.deepEqual(actual.bounds, model.decoded.bounds); }
  }
  assert.equal(state.stats.authoredBuildingModels, active.length);
  assert.equal(state.stats.authoredBuildingMeshes, active.reduce((sum, model) => sum + model.decoded.meshes, 0));
  assert.equal(state.stats.authoredBuildingTriangles, active.reduce((sum, model) => sum + model.decoded.triangles, 0));
  assert.equal(state.stats.measuredRoofBuildings, expected.source.measuredRoofBuildings - active.filter(model => model.hasMeasuredRoof).length);
  assert.equal(state.stats.measuredRoofTriangles, expected.source.measuredRoofTriangles - active.reduce((sum, model) => sum + model.roofTriangles, 0));
  assert.equal(state.stats.genericRoofBuildings, expected.source.genericRoofBuildings - active.filter(model => model.generic).length);
  assert.deepEqual(counter(state.meshes.map(meshKey)), counter(active.flatMap(model => model.meshes).map(meshKey)), 'Every active authored mesh must appear exactly once');
  assert.ok(state.meshes.every(mesh => mesh.visible), 'An authored mesh is hidden');
  assert.equal(state.quality.lowq, true); assert.equal(state.quality.qualityLocked, true);
  if (display) {
    assert.deepEqual(record.transform, expected.decoded.transform);
    assert.deepEqual(record.anchorEpsg3006RH2000, expected.descriptor.anchorEpsg3006RH2000);
    assert.equal(record.sourceFootprintSha256, expected.source.ringSha256);
    assert.deepEqual(record.bounds, expected.decoded.bounds);
  } else {
    if (mode === 'failed-load') assert.ok(record.error, 'Failed load needs an explicit diagnostic');
  }
}

async function main(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const base = new URL(o.base); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const report = { schemaVersion: 1, date: new Date().toISOString(), base: base.href, passed: false,
    executionAdapter: 'swiftshader-software-webgl2', performanceEvidence: false,
    request: { width: o.width, height: o.height, dpr: 1, views: VIEWS }, modes: [], errors: [] };
  let browser;
  try {
    const executablePath = o.chrome || process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
      args: ['--no-sandbox', '--disable-lcd-text', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const contextOptions = { viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' };
    const referenceContext = await browser.newContext(contextOptions);
    console.log('Checking exact descriptor, served pack, source roof/footprint and GLB');
    report.expected = await reference(referenceContext.request, base);
    await referenceContext.close();
    const expected = report.expected, assetUrl = new URL(expected.descriptor.asset.url, base);
    const matchesAsset = value => { const url = new URL(value); return url.origin === assetUrl.origin && url.pathname === assetUrl.pathname; };
    const allAssetUrls = expected.models.map(model => new URL(model.descriptor.asset.url, base));
    const matchesAnyAsset = value => { const url = new URL(value); return allAssetUrls.some(asset => url.origin === asset.origin && url.pathname === asset.pathname); };
    const timeout = o.timeout * 1000;
    for (const mode of ['authored', 'source', 'failed-load']) {
      const row = { mode, passed: false, views: [], requests: [], deliberatelyAborted: [], expectedFailures: [], warnings: [], errors: [] };
      report.modes.push(row);
      const context = await browser.newContext(contextOptions); context.setDefaultTimeout(timeout);
      try {
        if (mode === 'failed-load') await context.route(url => matchesAsset(url.href), async route => {
          row.deliberatelyAborted.push(route.request().url()); await route.abort('failed');
        });
        const page = await context.newPage();
        page.on('request', request => { if (matchesAnyAsset(request.url())) row.requests.push(request.url()); });
        page.on('pageerror', error => row.errors.push({ type: 'pageerror', text: String(error).slice(0, 3000) }));
        page.on('console', message => {
          const text = message.text(), location = message.location();
          if (mode === 'failed-load' && message.type() === 'error' && location.url && matchesAsset(location.url)
            && /Failed to load resource/.test(text)) row.expectedFailures.push({ type: 'console', text });
          else if (message.type() === 'error' || /(?:shader|pipeline|wgsl|glsl).*(?:error|failed|invalid)|validation error/i.test(text)) row.errors.push({ type: message.type(), text: text.slice(0, 3000) });
          else if (message.type() === 'warning') row.warnings.push(text.slice(0, 1500));
        });
        page.on('requestfailed', request => {
          const failure = { type: 'requestfailed', url: request.url(), text: request.failure()?.errorText };
          if (mode === 'failed-load' && matchesAsset(request.url()) && row.deliberatelyAborted.includes(request.url())) row.expectedFailures.push(failure);
          else if (failure.text === 'net::ERR_ABORTED' && /\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(failure.url)) row.warnings.push(failure);
          else row.errors.push(failure);
        });
        const url = new URL(base);
        for (const [key, value] of Object.entries({ bana: 'tortuna', v2: 'require', det: '1', q: 'lo', qualitylock: '1', ren: '1', gl: '1', lodmode: 'zone' })) url.searchParams.set(key, value);
        if (mode === 'source') url.searchParams.set('buildingGeometry', 'source');
        row.url = url.href;
        console.log(`Booting ${mode} clubhouse view`);
        await page.goto(url.href, { waitUntil: 'load', timeout });
        await page.waitForSelector('#boot.done', { timeout });
        const views = mode === 'authored' ? VIEWS : VIEWS.slice(0, 1);
        for (const view of views) {
          console.log(`Settling ${mode}/${view.id}`);
          await page.evaluate(view => { V3D.setPreset('noon'); V3D.setFov(view.fov); V3D.placeCamera(view.position, view.target); }, view);
          await settle(page, timeout);
          const state = await inspect(page, expected);
          assertState(state, expected, mode);
          assert.deepEqual(state.renderer.drawingBuffer, [o.width, o.height]);
          const targetProjection = await page.evaluate(target => V3D.project(...target), view.target);
          assert.equal(targetProjection.visible, true, 'View must contain the clubhouse');
          const captured = { id: view.id, state, targetProjection };
          row.views.push(captured);
          if (mode !== 'failed-load') {
            const image = `${mode}-${view.id}.png`;
            console.log(`Capturing ${image}`);
            const bytes = await page.screenshot({ path: path.join(o.out, image), timeout });
            Object.assign(captured, { image, imageSha256: sha256(bytes), imageBytes: bytes.length });
          }
        }
        if (mode === 'source') assert.equal(row.requests.length, 0, 'Source mode must not request any authored GLB');
        else assert.ok(row.requests.some(matchesAsset), 'Clubhouse descriptor was not requested');
        if (mode === 'failed-load') assert.ok(row.deliberatelyAborted.length > 0, 'Failure case did not intercept the GLB');
        row.passed = row.errors.length === 0;
      } catch (error) { row.errors.push({ type: 'harness', text: String(error.stack || error) }); }
      finally { await context.close(); }
      if (!row.passed) throw new Error(`${mode} clubhouse verification failed`);
    }
    assert.equal(report.modes[0].views[0].state.stats.genericRoofBuildings, report.modes[2].views[0].state.stats.genericRoofBuildings,
      'Failing the measured-roof clubhouse must not change unrelated generic buildings');
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
