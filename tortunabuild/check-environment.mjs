/** Expanded Tortuna surroundings: served-byte identities, active graph, measured
 * tree coverage and elevated captures. Software rendering is not FPS evidence.
 *
 * node tortunabuild/check-environment.mjs --base http://localhost:5173/ --out tortunabuild/cache/environment-review
 * node tortunabuild/check-environment.mjs --root apps/golf/dist --out tortunabuild/cache/environment-review
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';

const HELP = 'Usage: node tortunabuild/check-environment.mjs [--base URL | --root BUILD_DIR] [--out DIR] [--chrome PATH] [--width 960] [--height 600] [--timeout 600]';
const OLD = { minX: -768, maxX: 768, minZ: -1280, maxZ: 1280 };
const EXPANDED = { minX: -1280, maxX: 1280, minZ: -1536, maxZ: 1536 };
const FRAME = '37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const outside = ([x, z], b = OLD) => x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
const VIEWS = [
  { id: 'northwest-surroundings', position: [-1580, 950, -1720], target: [-200, 25, -250], fov: 56 },
  { id: 'southeast-surroundings', position: [1650, 1000, 1760], target: [150, 25, 250], fov: 56 },
];

function options(args) {
  const o = { out: 'tortunabuild/cache/environment-review', width: 960, height: 600, timeout: 600 };
  const allowed = new Set(['base', 'root', 'out', 'chrome', 'width', 'height', 'timeout']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid option ${args[i]}`);
    o[key] = value;
  }
  if (o.base && o.root) throw new Error('Choose --base or --root');
  if (!o.root) o.base ||= 'http://localhost:5173/';
  if (o.base && !['http:', 'https:'].includes(new URL(o.base).protocol)) throw new Error('--base requires HTTP(S)');
  for (const key of ['width', 'height', 'timeout']) {
    o[key] = Number(o[key]);
    if (!Number.isSafeInteger(o[key]) || o[key] <= 0) throw new Error(`Invalid --${key}`);
  }
  if (o.width > 4096 || o.height > 4096) throw new Error('Viewport exceeds 4096 pixels');
  o.out = path.resolve(o.out);
  return o;
}

async function serveBuild(directory) {
  const root = fs.realpathSync(directory);
  assert.ok(fs.statSync(path.join(root, 'index.html')).isFile(), '--root must contain index.html');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
      let filename = path.resolve(root, relative || 'index.html');
      if (!filename.startsWith(root + path.sep)) throw new Error('Outside build root');
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      filename = fs.realpathSync(filename);
      if (!filename.startsWith(root + path.sep)) throw new Error('Outside real build root');
      const body = fs.readFileSync(filename);
      res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream',
        'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

function modelInventory(model) {
  const infra = model.infra || {}, arrays = Object.fromEntries(Object.entries(infra).filter(([, value]) => Array.isArray(value)));
  const ids = Object.fromEntries(Object.entries(arrays).map(([key, rows]) => [key, sorted(rows.map(row => row.id ?? null))]));
  const routeFields = ['paths', 'tracks', 'roads'];
  return {
    sha256: hash(JSON.stringify(model)), holes: model.holes.map(h => h.n),
    vegetationPlacement: infra.vegetationPlacement,
    counts: Object.fromEntries(Object.entries(arrays).map(([key, rows]) => [key, rows.length])),
    idsSha256: hash(JSON.stringify(ids)),
    paths: Object.fromEntries(routeFields.map(key => [key, { count: (infra[key] || []).length,
      outsideOriginalCanopy: (infra[key] || []).filter(row => (row.line || []).some(p => outside(p))).length }])),
    buildings: { count: (infra.buildings || []).length,
      outsideOriginalCanopy: (infra.buildings || []).filter(row => (row.ring || []).some(p => outside(p))).length,
      measuredRoofs: (infra.buildings || []).filter(row => row.roofSurface).length },
    streams: model.streams?.length || 0,
  };
}

async function artifacts(request, base, report) {
  async function get(relative, expected) {
    const response = await request.get(new URL(relative, base).href);
    assert.equal(response.status(), 200, `Cannot fetch ${relative}`);
    const bytes = await response.body();
    if (expected) {
      assert.equal(bytes.length, expected.bytes, `Byte count differs: ${relative}`);
      assert.equal(hash(bytes), expected.sha256, `SHA-256 differs: ${relative}`);
    }
    return bytes;
  }
  const indexBytes = await get('courses/v2-index.json');
  const entries = JSON.parse(indexBytes).courses.filter(c => c.slug === 'tortuna');
  assert.equal(entries.length, 1, 'Server must publish Tortuna exactly once');
  const entry = entries[0];
  const course = JSON.parse(await get(entry.manifest.url, entry.manifest));
  const ground = JSON.parse(await get(course.groundManifest.url, course.groundManifest));
  assert.deepEqual(course.fallbackV1, entry.fallbackV1);
  const pack = readPack(await get(course.fallbackV1.packUrl, course.fallbackV1));
  const model = modelInventory(JSON.parse(inflateStream(pack.sv)));
  const tiles = ground.tiles, byId = new Map(tiles.map(tile => [tile.id, tile]));
  const standTiles = tiles.filter(tile => tile.layers.stands);
  const terrainRows = tiles.map(tile => ({ id: tile.id, lod: tile.lod, parentId: tile.parentId,
    bounds: tile.bounds, sha256: tile.layers.terrain.sha256, bytes: tile.layers.terrain.bytes })).sort((a, b) => a.id.localeCompare(b.id));
  const expectedStandIds = [];
  for (let col = 3; col <= 12; col++) for (let row = 2; row <= 13; row++) expectedStandIds.push(`l0/${col}/${row}`);
  const bounds = ground.bounds;
  report.artifacts = { indexSha256: hash(indexBytes), courseManifest: entry.manifest,
    groundManifest: course.groundManifest, fallback: course.fallbackV1,
    frame: ground.frame, bounds, sourceManifestSha256: ground.sourceManifestSha256,
    tileCount: tiles.length, levels: Array.from({ length: 5 }, (_, lod) => tiles.filter(t => t.lod === lod).length),
    parentLinks: tiles.filter(t => t.parentId !== null).length,
    terrainIdentitySha256: hash(JSON.stringify({ frame: ground.frame, bounds, shell: ground.shell, tiles: terrainRows })),
    terrainTiles: terrainRows, shell: ground.shell,
    standOwnerCount: standTiles.length,
    standOwners: standTiles.map(t => ({ id: t.id, bounds: t.bounds, sha256: t.layers.stands.sha256, bytes: t.layers.stands.bytes })),
    packModel: model };
  assert.equal(ground.groundId, 'tortuna');
  assert.equal(ground.frame.fingerprint, FRAME);
  assert.equal(tiles.length, 341);
  assert.equal(byId.size, 341);
  assert.deepEqual(report.artifacts.levels, [256, 64, 16, 4, 1]);
  assert.equal(report.artifacts.parentLinks, 340);
  assert.deepEqual([bounds.minEasting, bounds.minNorthing, bounds.maxEasting, bounds.maxNorthing], [595352.5, 6612851.5, 599448.5, 6616947.5]);
  for (const tile of tiles) {
    assert.ok(tile.courses.includes('tortuna'), `${tile.id} must belong to Tortuna`);
    if (tile.lod === 4) { assert.equal(tile.parentId, null); continue; }
    const parent = byId.get(tile.parentId);
    assert.equal(parent?.lod, tile.lod + 1, `${tile.id}: immediate parent required`);
    for (const axis of ['Easting', 'Northing']) {
      assert.ok(parent.bounds[`min${axis}`] <= tile.bounds[`min${axis}`] && parent.bounds[`max${axis}`] >= tile.bounds[`max${axis}`], `${tile.id}: parent containment`);
    }
  }
  assert.deepEqual(sorted(standTiles.map(t => t.id)), sorted(expectedStandIds), 'Measured stands must cover the expanded 10 by 12 owner grid');
  assert.equal(model.vegetationPlacement, 'measured-only');
  assert.deepEqual(model.holes, Array.from({ length: 18 }, (_, i) => i + 1));
  // Verify all served terrain and stand bytes, including terrain outside the
  // camera's current resident set. The browser independently verifies its loads.
  const resources = [ground.shell, ...tiles.map(t => t.layers.terrain), ...standTiles.map(t => t.layers.stands)];
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < resources.length) { const ref = resources[cursor++]; await get(ref.url, ref); }
  }));
  report.artifacts.verifiedChunkCount = resources.length;
  return { ground, model };
}

async function settle(page, timeout) {
  const start = await page.evaluate(() => { window.__environmentIdle = null; return V3D.frame(); });
  await page.waitForFunction(frame => {
    const V = window.V3D, adapter = V.v2Terrain().adapter, plan = V.v2Plan();
    if (adapter?.kind !== 'graph' || adapter.phase !== 'ready' || !adapter.active || adapter.stream?.loadingTiles !== 0
      || adapter.stream.failedTiles !== 0 || !V.settled() || !plan) { window.__environmentIdle = null; return false; }
    const signature = JSON.stringify([plan.render.slice().sort(), plan.ready.slice().sort()]);
    let idle = window.__environmentIdle;
    if (!idle || idle.signature !== signature) idle = window.__environmentIdle = { signature, at: performance.now(), frame: V.frame() };
    return performance.now() - idle.at >= 350 && V.frame() >= Math.max(frame, idle.frame) + 2;
  }, start, { polling: 50, timeout });
}

async function main(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const local = o.root ? await serveBuild(o.root) : null;
  const base = new URL(local?.base || o.base);
  base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(base);
  for (const [key, value] of Object.entries({ bana: 'tortuna', v2: 'require', det: '1', q: 'lo', qualitylock: '1', ren: '1', gl: '1', lodmode: 'zone' })) url.searchParams.set(key, value);
  const report = { schemaVersion: 1, date: new Date().toISOString(), url: url.href, passed: false,
    executionAdapter: 'swiftshader-software-webgl2', performanceEvidence: false,
    note: '341 is the retained world graph size, not simultaneously resident tiles. Tree bounds describe measured stand instances; source coverage includes cells without trees.',
    originalCanopyLocalBounds: OLD, expandedCanopyLocalBounds: EXPANDED,
    request: { width: o.width, height: o.height, dpr: 1, views: VIEWS }, errors: [], warnings: [], views: [] };
  let browser;
  try {
    const executablePath = o.chrome || process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true,
      args: ['--no-sandbox', '--disable-lcd-text', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const timeout = o.timeout * 1000;
    context.setDefaultTimeout(timeout);
    console.log('Checking served Tortuna world, pack and 120 measured stand owners');
    const { ground, model } = await artifacts(context.request, base, report);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', text: String(error).slice(0, 3000) }));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' || /(?:shader|pipeline|wgsl|glsl).*(?:error|failed|invalid)|validation error/i.test(text)) report.errors.push({ type: message.type(), text: text.slice(0, 3000) });
      else if (message.type() === 'warning') report.warnings.push(text.slice(0, 1500));
    });
    page.on('requestfailed', request => {
      const text = request.failure()?.errorText, failure = { type: 'requestfailed', url: request.url(), text };
      if (text === 'net::ERR_ABORTED' && /\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(request.url())) report.warnings.push(failure);
      else report.errors.push(failure);
    });
    console.log('Booting software WebGL2 scene');
    await page.goto(url.href, { waitUntil: 'load', timeout });
    await page.waitForSelector('#boot.done', { timeout });
    await settle(page, timeout);
    const snapshot = await page.evaluate(async ({ oldBounds, expandedBounds }) => {
      const V = window.V3D, exported = V.legacyTrees({ instances: true }), trees = exported.instances;
      const outside = t => t[0] < oldBounds.minX || t[0] > oldBounds.maxX || t[2] < oldBounds.minZ || t[2] > oldBounds.maxZ;
      const measured = trees.filter(t => t[6] === 6), outer = measured.filter(outside);
      window.__environmentOuterTrees = outer;
      const bounds = list => list.length ? list.reduce((b, t) => ({ minX: Math.min(b.minX, t[0]), maxX: Math.max(b.maxX, t[0]),
        minZ: Math.min(b.minZ, t[2]), maxZ: Math.max(b.maxZ, t[2]) }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }) : null;
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(trees))))].map(n => n.toString(16).padStart(2, '0')).join('');
      const escaped = measured.filter(t => t[0] < expandedBounds.minX - 0.02 || t[0] > expandedBounds.maxX + 0.02 || t[2] < expandedBounds.minZ - 0.02 || t[2] > expandedBounds.maxZ + 0.02);
      delete exported.instances;
      return { model: V.M, course: V.course(), holeNumbers: V.HOLES.map(h => h.n), terrain: V.v2Terrain(), vegetation: V.v2Objects(),
        quality: V.quality(), renderer: V.rendererInfo(), stats: { ...V.stats }, vistaPointCount: V.vistaPoints().length,
        trees: { ...exported, measuredStandCount: measured.length, bounds: bounds(measured), outsideOriginalCanopy: outer.length,
          outerBounds: bounds(outer), outsideExpandedCanopy: escaped.length,
          sides: { west: outer.filter(t => t[0] < oldBounds.minX).length, east: outer.filter(t => t[0] > oldBounds.maxX).length,
            north: outer.filter(t => t[2] < oldBounds.minZ).length, south: outer.filter(t => t[2] > oldBounds.maxZ).length },
          instancesSha256: digest, exportPrecision: 'positions 0.01 m; scales/yaw 0.001', examples: outer.slice(0, 20) } };
    }, { oldBounds: OLD, expandedBounds: EXPANDED });
    report.runtime = { ...snapshot, model: modelInventory(snapshot.model) };
    assert.equal(snapshot.course.slug, 'tortuna');
    assert.equal(snapshot.stats.backend, 'webgl2');
    assert.equal(snapshot.terrain.kind, 'graph');
    assert.equal(snapshot.terrain.adapter.active, true);
    assert.equal(snapshot.terrain.selection.graph?.tiles, 341, 'The active renderer must select the full world graph');
    assert.equal(snapshot.terrain.selection.graph?.frameFingerprint, FRAME);
    assert.equal(snapshot.terrain.selection.graph?.encodedTerrainBytes,
      ground.shell.bytes + ground.tiles.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0));
    assert.equal(snapshot.vegetation.loaded?.frameFingerprint, FRAME);
    assert.equal(snapshot.vegetation.loaded?.referencedStandTiles, 120);
    assert.equal(snapshot.vegetation.graphStandTiles, 120);
    assert.equal(snapshot.vegetation.coverageTiles, 120);
    assert.equal(snapshot.vegetation.error, null);
    assert.deepEqual(report.runtime.model.counts, model.counts, 'Runtime infrastructure counts must match the exact served pack');
    assert.equal(report.runtime.model.idsSha256, model.idsSha256, 'Runtime infrastructure identities differ');
    assert.equal(report.runtime.model.vegetationPlacement, 'measured-only');
    assert.deepEqual(snapshot.holeNumbers, Array.from({ length: 18 }, (_, i) => i + 1));
    assert.equal(snapshot.vistaPointCount, 0);
    assert.equal(snapshot.stats.vista, 0);
    assert.ok(snapshot.trees.outsideOriginalCanopy > 0, 'No measured tree instances extend beyond the old canopy window');
    assert.equal(snapshot.trees.outsideExpandedCanopy, 0);
    assert.equal(snapshot.trees.total, snapshot.trees.measuredStandCount, 'Unexpected non-stand tree population');
    assert.equal(snapshot.trees.legacyInsideCoverage, 0);
    for (const view of VIEWS) {
      console.log(`Settling and capturing ${view.id}`);
      await page.evaluate(view => { V3D.setPreset('noon'); V3D.setFov(view.fov); V3D.placeCamera(view.position, view.target); }, view);
      await settle(page, timeout);
      const state = await page.evaluate(() => {
        const V = window.V3D, outer = window.__environmentOuterTrees;
        // Probe at canopy height. Projection proves viewport inclusion only,
        // not occlusion or successful pixel shading; screenshots supply that evidence.
        const stride = Math.max(1, Math.floor(outer.length / 1200));
        let tested = 0, insideViewport = 0;
        for (let i = 0; i < outer.length; i += stride) { const t = outer[i]; tested++; if (V.project(t[0], t[1] + 6, t[2]).visible) insideViewport++; }
        return { camera: V.camExact(), lens: V.cameraInfo(), quality: V.quality(), renderer: V.rendererInfo(),
          terrain: V.v2Terrain().adapter, plan: V.v2Plan(), visibleTerrainTileIds: V.v2WorldVisible(),
          residentTerrain: V.v2WorldInventory(), treeTiers: V.treeTiers(), outerTreeViewportProbes: { tested, insideViewport } };
      });
      assert.ok(state.visibleTerrainTileIds.length > 0, 'No visible terrain in elevated view');
      assert.ok(state.outerTreeViewportProbes.insideViewport > 0, 'View misses expanded tree coverage');
      assert.equal(state.quality.lowq, true);
      assert.equal(state.quality.qualityLocked, true);
      assert.deepEqual(state.renderer.drawingBuffer, [o.width, o.height]);
      for (const tile of state.residentTerrain) {
        const source = tile.tileId === 'shell' ? ground.shell : ground.tiles.find(t => t.id === tile.tileId)?.layers.terrain;
        assert.ok(source, `Unknown resident terrain ${tile.tileId}`);
        assert.ok(tile.identity?.startsWith(`${source.decodedSha256}:`), `Resident terrain identity differs: ${tile.tileId}`);
      }
      const filename = `${view.id}.png`;
      const bytes = await page.screenshot({ path: path.join(o.out, filename), timeout });
      report.views.push({ id: view.id, ...state, image: filename, imageSha256: hash(bytes), imageBytes: bytes.length });
    }
    report.passed = report.errors.length === 0 && report.views.length === VIEWS.length;
  } catch (error) { report.errors.push({ type: 'harness', text: String(error.stack || error) }); }
  finally {
    if (browser) await browser.close();
    if (local) await new Promise(resolve => { local.server.closeAllConnections(); local.server.close(resolve); });
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
