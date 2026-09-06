#!/usr/bin/env node
/**
 * Bounded camera integration check in the real built app. No source injection,
 * controls mocking, frame pausing, resolution fallback or hardware-FPS claim.
 * Browser-dispatched mouse/wheel and CDP touch exercise actual OrbitControls.
 *
 * node tools/check-camera-stability.mjs --root /tmp/baseline-dist --out /tmp/camera-before
 * node tools/check-camera-stability.mjs --root apps/golf/dist --out /tmp/camera-after \
 *   --interactions --compare /tmp/camera-before/report.json
 * Add --fresh-shadow to both runs for a separate diagnostic that refreshes
 * the existing shadow map after terrain settling, without changing its quality.
 * --check-shadow-cache instead captures the ordinary cached view, then a fresh
 * shadow reference in the same visit and checks image/buffer consistency.
 *
 * Fixed Uppsala H1 top/noon, graphics=1, q=lo, 384x288, DPR1, qualitylock,
 * geographic tree zones, deterministic shader clock, real camera tween clock.
 * Uses automatic WebGPU->WebGL2 fallback under SwiftShader. Each whole-scene
 * attempt is limited to 180 seconds. A timeout remains a failed raw report.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function serveBuild(directory, basePath = '/') {
  const root = fs.realpathSync(directory);
  if (!fs.statSync(path.join(root, 'index.html')).isFile()) throw new Error('--root must contain a built index.html');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith(basePath)) throw new Error('Outside base path');
      const relativePath = pathname.slice(basePath.length);
      let file = path.resolve(root, relativePath || 'index.html');
      if (file !== root && !file.startsWith(root + path.sep)) throw new Error('Invalid path');
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      file = fs.realpathSync(file);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid real path');
      let body = fs.readFileSync(file);
      const headers = { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        body = gzipSync(body); headers['content-encoding'] = 'gzip';
      }
      headers['content-length'] = String(body.length);
      res.writeHead(200, headers); res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, base: `http://127.0.0.1:${server.address().port}${basePath}` };
}
function captureContract(row) {
  return { backend: row.backend, buffer: row.renderer.drawingBuffer, pixelRatio: row.renderer.pixelRatio,
    lowq: row.quality.lowq, lowfx: row.quality.lowfx, lod: row.treeLod };
}

async function settle(page, timeout) {
  const startFrame = await page.evaluate(() => window.V3D.frame());
  await page.evaluate(() => { window.__v2GraphicsIdle = null; });
  await page.waitForFunction(f0 => {
    const V = window.V3D, a = V.v2Terrain().adapter, p = V.v2Plan();
    const ready = a?.kind === 'graph' && a.phase === 'ready' && a.active === true
      && a.stream?.loadingTiles === 0 && a.stream.failedTiles === 0 && V.settled() && p
      && V.v2TerrainBuffers?.()?.morphing !== true && V.shadowRest().settlePending !== true;
    if (!ready) { window.__v2GraphicsIdle = null; return false; }
    const signature = JSON.stringify([p.render.slice().sort(), p.ready.slice().sort()]);
    let state = window.__v2GraphicsIdle;
    if (!state || state.signature !== signature) {
      state = window.__v2GraphicsIdle = { signature, at: performance.now(), frame: V.frame() };
    }
    // The runtime morph is 240 ms. Stable residency for 350 ms and two complete
    // frames avoids capturing the freshly loaded tile's coarse parent shape.
    return performance.now() - state.at >= 350 && V.frame() >= Math.max(f0, state.frame) + 2;
  }, startFrame, { polling: 50, timeout });
}

async function fingerprint(page) {
  return page.evaluate(async () => {
    const V = window.V3D, encoder = new TextEncoder();
    const hash = async value => {
      const bytes = value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value));
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const trees = V.legacyTrees({ instances: true }), tint = V.groundTint?.();
    const source = V.v2Terrain();
    window.__v2GraphicsTrees = trees.instances;
    return {
      model: await hash(V.M), routing: await hash(V.HOLES), georeferencing: await hash(V.GEO),
      treeInstances: await hash(trees.instances),
      treePositions: await hash(trees.instances.map(t => t.slice(0, 3))),
      vistaPoints: await hash(V.vistaPoints()),
      tintNear: tint ? await hash(tint.near) : null, tintFar: tint ? await hash(tint.far) : null,
      surfaceSource: source.surface?.sourcePackSha256 ?? null,
      vegetationSource: V.v2Objects?.().loaded?.frameFingerprint ?? null,
      counts: Object.fromEntries(['trees', 'vista', 'tufts', 'bushes', 'stones', 'reeds', 'cars', 'pylons', 'stumps', 'surfaceOverlays']
        .map(k => [k, V.stats[k] ?? null])),
      treeExportPrecision: 'positions rounded to 0.01 m; scales/yaw to 0.001 by V3D.legacyTrees',
    };
  });
}

async function stateAt(page) {
  return page.evaluate(() => {
    const V = window.V3D;
    const inventory = V.v2WorldInventory();
    return { backend: V.stats.backend, quality: V.quality(), renderer: V.rendererInfo(),
      camera: V.camInfo(), lens: V.cameraInfo(), treeLod: V.treeLodPx(), tiers: V.treeTiers(),
      terrain: V.v2Terrain().adapter, plan: V.v2Plan(),
      shadow: V.shadowRest(), terrainBuffers: V.v2TerrainBuffers?.() ?? null,
      terrainMorphs: inventory.map(t => ({ tileId: t.tileId, morph: t.morph ?? null })).sort((a, b) => a.tileId.localeCompare(b.tileId)),
      // Identity/byte sums describe source terrain data, not shader output.
      terrainInventory: inventory.map(t => ({ tileId: t.tileId, identity: t.identity,
        worldOriginX: t.worldOriginX, worldOriginZ: t.worldOriginZ, sampleSpacingMetres: t.sampleSpacingMetres,
        heightOffsetWorld: t.heightOffsetWorld, layerByteSum: t.layerByteSum })).sort((a, b) => a.tileId.localeCompare(b.tileId)),
    };
  });
}

function compareReports(previous, report) {
  const fields = ['model', 'routing', 'georeferencing', 'treeInstances', 'treePositions', 'vistaPoints', 'tintNear', 'tintFar', 'surfaceSource', 'vegetationSource', 'counts'];
  const invariants = Object.fromEntries(fields.map(key => [key, same(previous.fingerprint?.[key], report.fingerprint?.[key])]));
  invariants.request = same(previous.request, report.request);
  const views = report.views.map(row => {
    const before = previous.views.find(v => v.id === row.id);
    return { id: row.id, matched: !!before,
      captureContractUnchanged: !!before && same(captureContract(before.before), captureContract(row.before)),
      cameraUnchanged: !!before && same(before.before.camera, row.before.camera) && same(before.before.lens, row.before.lens),
      terrainUnchanged: !!before && same(before.before.terrainInventory, row.before.terrainInventory),
      imageChanged: before ? before.imageSha256 !== row.imageSha256 : null,
      trianglesDelta: before ? row.before.renderer.triangles - before.before.renderer.triangles : null,
      drawCallsDelta: before ? row.before.renderer.drawCalls - before.before.renderer.drawCalls : null };
  });
  return { invariants, views, passed: previous.passed === true && Object.values(invariants).every(Boolean)
    && previous.views.length === report.views.length
    && views.every(v => v.matched && v.captureContractUnchanged && v.cameraUnchanged && v.terrainUnchanged),
  note: 'Settled pixel parity is required for this motion-only pass. Draw/triangle deltas are observations, not FPS evidence; shadow refresh can alter per-frame counters.' };
}


function parseArgs(argv) {
  const o = { interactions: false, freshShadow: false, checkShadowCache: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--interactions') { o.interactions = true; continue; }
    if (key === '--fresh-shadow') { o.freshShadow = true; continue; }
    if (key === '--check-shadow-cache') { o.checkShadowCache = true; continue; }
    if (!['--root', '--out', '--compare'].includes(key) || !argv[i + 1]) throw new Error(`Invalid argument ${key}`);
    o[key.slice(2)] = path.resolve(argv[++i]);
  }
  if (!o.root || !o.out) throw new Error('Expected --root BUILT_DIR --out OUTPUT_DIR [--interactions] [--fresh-shadow] [--compare REPORT]');
  if (o.freshShadow && o.checkShadowCache) throw new Error('--check-shadow-cache requires an ordinary cached first capture');
  return o;
}

function buildIdentity(root) {
  const index = fs.readFileSync(path.join(root, 'index.html'));
  const inventory = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const data = fs.readFileSync(full);
        inventory.push({ file: path.relative(root, full), bytes: data.length, sha256: sha256(data) });
      }
    }
  }
  walk(path.join(root, 'assets'));
  return { indexSha256: sha256(index), assetsInventorySha256: sha256(JSON.stringify(inventory)),
    entryBundles: inventory.filter(r => /^assets\/(index|main)-.*\.js$/.test(r.file)) };
}

async function interactionChecks(page, persist) {
  const checks = [];
  // This observes the real canvas event path. It does not change camera,
  // controls, pointer capture, projection matrices or event dispatch.
  await page.evaluate(() => {
    const canvas = document.querySelector('body > canvas');
    if (!canvas) throw new Error('Renderer canvas missing');
    const snapshot = () => ({ frame: V3D.frame(), camera: V3D.camExact(), flight: V3D.flightState(), settled: V3D.settled() });
    window.__cameraGestureEvents = [];
    for (const type of ['pointerdown', 'wheel']) {
      canvas.addEventListener(type, event => {
        window.__cameraGestureEvents.push({ type, pointerType: event.pointerType || null, pointerId: event.pointerId ?? null,
          trusted: event.isTrusted, before: snapshot() });
      }, { capture: true, passive: true });
      canvas.addEventListener(type, () => {
        const row = window.__cameraGestureEvents.at(-1);
        if (row && row.type === type) row.after = snapshot();
      }, { passive: true });
    }
  });
  const cdp = await page.context().newCDPSession(page);
  const observe = () => page.evaluate(() => ({ camera: V3D.camExact(), flight: V3D.flightState(),
    settled: V3D.settled(), frame: V3D.frame(), quality: V3D.quality(), renderer: V3D.rendererInfo() }));
  async function frames(n = 2) {
    const frame = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(({ f, n }) => V3D.frame() >= f + n, { f: frame, n }, { polling: 50 });
  }
  async function start(mode) {
    await page.evaluate(mode => {
      V3D.setCam('top', true);
      window.__cameraGestureEvents.length = 0;
      if (mode === 'tween') {
        V3D.setCam('green', true); window.__cameraAutomaticDestination = V3D.camExact();
        V3D.setCam('top', true); V3D.setCam('green', false);
      }
      else if (mode === 'flight') { V3D.fly(); V3D.setFov(37); }
      else if (mode === 'tour') { V3D.startTour(); V3D.setFov(37); }
    }, mode);
    const state = await observe();
    if (mode === 'tween') state.automaticDestination = await page.evaluate(() => window.__cameraAutomaticDestination);
    return state;
  }
  async function complete(id, before, { lensPreserved = false, requireMotion = true } = {}) {
    const eventRows = await page.evaluate(() => window.__cameraGestureEvents);
    const after = await observe();
    await frames();
    const afterTwoFrames = await observe();
    if (!afterTwoFrames.settled) await page.waitForFunction(() => V3D.settled(), null, { polling: 50, timeout: 30000 });
    const later = await observe();
    const row = { id, before, events: eventRows, after, afterTwoFrames, later, assertions: {
      browserTrustedEvents: eventRows.length > 0 && eventRows.every(e => e.trusted && e.after),
      automaticMotionStopped: after.flight.flying === 0 && after.flight.tour === 0 && later.flight.flying === 0 && later.flight.tour === 0,
      eventuallySettled: later.settled,
      bufferPreserved: same(after.renderer.drawingBuffer, [384, 288]) && same(later.renderer.drawingBuffer, [384, 288]),
      qualityPreserved: after.quality.lowq && !after.quality.lowfx && after.quality.qualityLocked
        && later.quality.lowq && !later.quality.lowfx && later.quality.qualityLocked,
    } };
    if (lensPreserved) {
      const event = eventRows.find(e => e.before.flight.flying > 0 || e.before.flight.tour > 0);
      row.assertions.activeFlightObservedAtGesture = !!event;
      row.assertions.gesturePreservedLens = !!event && event.before.flight.fov === event.after.flight.fov;
      row.assertions.gesturePreservedPose = !!event && same(event.before.camera, event.after.camera);
    } else {
      row.assertions.tweenObservedBeforeGesture = before.settled === false;
      row.distanceFromInterruptedDestinationMetres = Math.hypot(...later.camera.pos.map((v, i) => v - before.automaticDestination.pos[i]));
      row.assertions.didNotCompleteInterruptedTween = row.distanceFromInterruptedDestinationMetres > 20;
    }
    if (requireMotion) row.assertions.inputMovedCamera = !same(eventRows[0]?.before.camera, after.camera);
    if (id === 'tour_touch_pinch') {
      row.assertions.twoTouchPointersObserved = new Set(eventRows.filter(e => e.pointerType === 'touch').map(e => e.pointerId)).size >= 2;
      const distance = camera => Math.hypot(...camera.pos.map((v, i) => v - camera.look[i]));
      row.assertions.pinchChangedOrbitDistance = Math.abs(distance(after.camera) - distance(eventRows[0].before.camera)) > 1;
    }
    row.passed = Object.values(row.assertions).every(Boolean);
    checks.push(row); persist(checks);
    console.log(`  ${row.passed ? 'PASS' : 'FAIL'} ${id}`);
    if (!row.passed) throw new Error(`Interaction check failed: ${id}`);
  }
  await page.mouse.move(170, 145);
  let before = await start('tween');
  await page.mouse.down();
  await page.mouse.move(204, 151);
  await page.mouse.up();
  await complete('tween_mouse_drag', before);

  before = await start('tween');
  await page.mouse.wheel(0, -120);
  await complete('tween_wheel_zoom', before);

  before = await start('flight');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 145, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 201, y: 151, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await complete('flight_touch_drag', before, { lensPreserved: true });

  before = await start('tour');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 145, id: 1 }, { x: 230, y: 145, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 135, y: 145, id: 1 }, { x: 245, y: 145, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await complete('tour_touch_pinch', before, { lensPreserved: true });

  await page.evaluate(() => V3D.setCam('top', true));
  await frames();
  const instant = await observe();
  const row = { id: 'explicit_instant_view', after: instant, assertions: {
    settled: instant.settled, stopped: instant.flight.flying === 0 && instant.flight.tour === 0,
    playerLensRestored: instant.flight.fov === 48,
    qualityPreserved: instant.quality.lowq && !instant.quality.lowfx && instant.quality.qualityLocked,
    bufferPreserved: same(instant.renderer.drawingBuffer, [384, 288]),
  } };
  row.passed = Object.values(row.assertions).every(Boolean); checks.push(row); persist(checks);
  if (!row.passed) throw new Error('Explicit instant view did not settle at player lens');
  await cdp.detach();
  return checks;
}

async function main(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const local = await serveBuild(o.root, '/olovs-hemsida/');
  const url = new URL(local.base);
  Object.entries({ bana: 'upsala', v2: 'require', det: '1', graphics: '1', q: 'lo', qualitylock: '1',
    ren: '1', gl: '0', lodmode: 'zone', hal: '1', vy: 'top', ljus: 'dag' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const report = { schemaVersion: 1, date: new Date().toISOString(), url: url.href,
    executionAdapter: 'swiftshader-software', performanceEvidence: false,
    note: 'Correctness only. Browser-dispatched input is trusted Chromium input, not a physical phone gesture.',
    overallDeadlineSeconds: 180, build: buildIdentity(o.root),
    request: { course: 'upsala', backend: 'webgl2', autoFallback: true, q: 'lo', graphics: '1',
      viewport: [384, 288], dpr: 1, reducedMotion: 'no-preference', hasTouch: true, freshShadowDiagnostic: o.freshShadow,
      views: [{ id: 'h1_top_noon', hole: 1, cam: 'top', preset: 'noon' }] },
    errors: [], warnings: [], views: [], interactions: [], passed: false, stage: 'launch' };
  const persist = () => fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  let browser;
  const deadline = setTimeout(() => {
    report.errors.push({ type: 'harness-deadline', text: '180 second whole-scene deadline reached' });
    report.passed = false; persist();
    browser?.close().catch(() => {});
  }, 180000);
  try {
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--disable-lcd-text', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 384, height: 288 }, deviceScaleFactor: 1,
      reducedMotion: 'no-preference', hasTouch: true, serviceWorkers: 'block' });
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }));
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', text: String(error) }));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' || /(?:shader|pipeline|wgsl|glsl).*(?:error|failed|invalid)|validation error/i.test(text)) report.errors.push({ type: message.type(), text });
      else if (message.type() === 'warning') report.warnings.push(text);
    });
    page.on('requestfailed', request => {
      const error = { type: 'requestfailed', url: request.url(), text: request.failure()?.errorText };
      if (error.text === 'net::ERR_ABORTED' && /\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(error.url)) report.warnings.push(`Cancelled terrain request: ${error.url}`);
      else report.errors.push(error);
    });
    report.stage = 'boot'; persist();
    console.log('Loading fixed Uppsala scene');
    await page.goto(url.href, { waitUntil: 'load' });
    await page.waitForSelector('#boot.done');
    report.boot = await page.evaluate(() => ({ backend: V3D.stats.backend, quality: V3D.quality(), course: V3D.course() }));
    if (report.boot.backend !== 'webgl2' || !report.boot.quality.graphicsPolish || !report.boot.quality.qualityLocked) throw new Error('Backend/preview/quality contract mismatch');
    report.fingerprint = await fingerprint(page);
    await page.evaluate(() => { V3D.setPreset('noon'); V3D.goHole(1, true, true); V3D.setCam('top', true); });
    report.stage = 'settle'; persist();
    await settle(page, 60000);
    if (o.freshShadow) {
      report.stage = 'refresh-settled-shadows';
      report.freshShadow = await page.evaluate(() => {
        const before = V3D.shadowRest();
        const frame = V3D.frame();
        V3D.setShadowUpdate(true);
        return { before, startFrame: frame, requestedAutoUpdate: true };
      });
      persist();
      await page.waitForFunction(frame => V3D.frame() >= frame + 2, report.freshShadow.startFrame, { polling: 50 });
      report.freshShadow.afterTwoFrames = await page.evaluate(() => ({ frame: V3D.frame(), shadow: V3D.shadowRest() }));
    }
    const before = await stateAt(page), contract = captureContract(before);
    const visibleTerrainTileIds = await page.evaluate(() => V3D.v2WorldVisible());
    if (!contract.lowq || contract.lowfx || contract.pixelRatio !== 1 || !same(contract.buffer, [384, 288])
      || contract.lod.mode !== 'zone' || visibleTerrainTileIds.length === 0) throw new Error('Capture contract mismatch');
    report.preCapture = { before, visibleTerrainTileIds };
    report.stage = 'screenshot'; persist();
    const bytes = await page.screenshot({ path: path.join(o.out, 'h1_top_noon.png'), animations: 'disabled' });
    const after = await stateAt(page);
    if (o.freshShadow) {
      report.freshShadow.afterCapture = await page.evaluate(() => ({ frame: V3D.frame(), shadow: V3D.shadowRest() }));
      report.freshShadow.restoredAutoUpdate = await page.evaluate(() => V3D.setShadowUpdate(false));
    }
    if (!same(contract, captureContract(after)) || after.terrain.stream.loadingTiles || after.terrain.stream.failedTiles
      || !same(before.terrainInventory, after.terrainInventory)) throw new Error('Capture state changed');
    report.views.push({ ...report.request.views[0], file: 'h1_top_noon.png', imageSha256: sha256(bytes), visibleTerrainTileIds, before, after });
    report.settledCapturePassed = report.errors.length === 0;
    console.log(`Captured ${before.renderer.drawCalls} draws, ${before.renderer.triangles} triangles`);
    if (o.checkShadowCache) {
      report.stage = 'check-shadow-cache'; persist();
      const startFrame = await page.evaluate(() => { V3D.setShadowUpdate(true); return V3D.frame(); });
      await page.waitForFunction(frame => V3D.frame() >= frame + 2, startFrame, { polling: 50 });
      const freshBefore = await stateAt(page);
      const freshBytes = await page.screenshot({ path: path.join(o.out, 'fresh_shadow_reference.png'), animations: 'disabled' });
      const freshAfter = await stateAt(page);
      const restoredAutoUpdate = await page.evaluate(() => V3D.setShadowUpdate(false));
      const assertions = {
        exactImageParity: sha256(bytes) === sha256(freshBytes),
        captureContractPreserved: same(captureContract(after), captureContract(freshBefore)) && same(captureContract(after), captureContract(freshAfter)),
        cameraPreserved: same(after.camera, freshAfter.camera) && same(after.lens, freshAfter.lens),
        terrainPreserved: same(after.terrainInventory, freshAfter.terrainInventory),
        rendererMemoryPreserved: same(after.renderer.memory, freshAfter.renderer.memory),
        cachedModeRestored: restoredAutoUpdate === false,
      };
      if (after.terrainBuffers) {
        assertions.finalMorphReached = !after.terrainBuffers.morphing && after.terrainMorphs.every(t => t.morph === 0);
        assertions.cachedRevisionCurrent = after.shadow.terrainRevision === after.terrainBuffers.renderRevision;
        assertions.settledRefreshFinished = after.shadow.settlePending === false;
        assertions.settledBuffersUnchanged = same(after.terrainBuffers, freshBefore.terrainBuffers) && same(after.terrainBuffers, freshAfter.terrainBuffers);
      }
      report.shadowCacheCheck = { passed: Object.values(assertions).every(Boolean), assertions,
        file: 'fresh_shadow_reference.png', imageSha256: sha256(freshBytes), startFrame,
        cached: after, freshBefore, freshAfter, restoredAutoUpdate,
        note: 'Correctness diagnostic: same visit and settings, existing shadow auto-update temporarily enabled after the ordinary cached capture. No physical FPS claim.' };
      persist(); console.log(`Shadow cache ${report.shadowCacheCheck.passed ? 'PASS' : 'FAIL'}`);
    }
    if (o.compare) {
      const previous = JSON.parse(fs.readFileSync(o.compare, 'utf8'));
      report.comparison = compareReports(previous, report);
      const a = previous.views[0], b = report.views[0];
      report.comparison.exactPngParity = a?.imageSha256 === b?.imageSha256;
      report.comparison.rendererMemoryCountersUnchanged = same(a?.before.renderer.memory, b?.before.renderer.memory);
      report.comparison.note = 'Settled pixel parity is required for this motion-only pass. Draw/triangle and renderer memory counters are observations, not physical FPS or total app memory.';
      report.comparison.passed &&= report.comparison.exactPngParity && report.comparison.rendererMemoryCountersUnchanged;
    }
    if (o.interactions) {
      report.stage = 'interactions'; persist();
      await interactionChecks(page, rows => { report.interactions = rows; persist(); });
    }
    report.passed = report.errors.length === 0 && report.settledCapturePassed
      && (!report.comparison || report.comparison.passed)
      && (!report.shadowCacheCheck || report.shadowCacheCheck.passed)
      && (!o.interactions || (report.interactions.length === 5 && report.interactions.every(r => r.passed)));
    report.stage = 'complete';
  } catch (error) {
    report.passed = false; report.errors.push({ type: 'harness', text: String(error.stack || error) });
  } finally {
    clearTimeout(deadline);
    persist();
    await browser?.close().catch(() => {});
    await new Promise(resolve => { local.server.closeAllConnections(); local.server.close(resolve); });
  }
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${path.join(o.out, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}
await main(parseArgs(process.argv.slice(2)));
