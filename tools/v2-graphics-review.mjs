#!/usr/bin/env node
/* Small, repeatable graphics A/B review, always using software rasterisation.
 * Screenshots prove rendering correctness only: this tool is NOT an FPS benchmark.
 *
 * node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --course puttom \
 *   --out /tmp/graphics-before --backend webgl2 --q lo --graphics 0
 * node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --course puttom \
 *   --out /tmp/graphics-after --backend webgl2 --q lo --graphics 1 \
 *   --compare /tmp/graphics-before/report.json
 *
 * --views short (default: h1 tee/green/top noon, tee golden), or a comma-separated
 * list such as --views 1:tee:noon,14:green:golden. --bark appends a near-pine view.
 * --width 960 --height 600 --dpr 1 --timeout 600 --chrome /path/to/chromium
 * --root /path/to/built/dist starts an internal static server instead of --base.
 * Use separate output directories and the same viewport, quality and view order.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const HELP = `Usage: node tools/v2-graphics-review.mjs (--base URL | --root BUILT_DIR) --out DIR [options]
  --course puttom        --backend webgl2|webgpu  --q lo|hi  --graphics default|0|1
  --views short|1:tee:noon,14:green:golden       --bark
  --width 960 --height 600 --dpr 1 --timeout 600 --chrome PATH
  --compare /path/to/previous/report.json
  --base-path /olovs-hemsida/  (path prefix for --root's internal server)
Software screenshots and mapping/count checks only; no hardware FPS claim.`;

function optionsFrom(argv) {
  const o = { course: 'puttom', backend: 'webgl2', q: 'lo', graphics: '1', views: 'short',
    width: 960, height: 600, dpr: 1, timeout: 600, bark: false };
  const allowed = new Set(['base', 'root', 'base-path', 'out', 'course', 'backend', 'q', 'graphics', 'views',
    'width', 'height', 'dpr', 'timeout', 'chrome', 'compare']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bark') { o.bark = true; continue; }
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    }
    o[key] = argv[++i];
  }
  if ((!o.base && !o.root) || (o.base && o.root) || !o.out) throw new Error('Specify exactly one of --base / --root, plus --out');
  if (o.base && !['http:', 'https:'].includes(new URL(o.base).protocol)) throw new Error('--base must use http(s)');
  if (!/^[a-z0-9-]+$/.test(o.course)) throw new Error('Invalid --course');
  for (const [key, values] of [['backend', ['webgl2', 'webgpu']], ['q', ['lo', 'hi']], ['graphics', ['default', '0', '1']]]) {
    if (!values.includes(o[key])) throw new Error(`Invalid --${key}`);
  }
  for (const key of ['width', 'height', 'dpr', 'timeout']) {
    o[key] = Number(o[key]);
    if (!Number.isFinite(o[key]) || o[key] <= 0) throw new Error(`Invalid --${key}`);
  }
  if (![o.width, o.height].every(Number.isInteger) || o.width > 4096 || o.height > 4096 || o.dpr > 3) {
    throw new Error('Viewport dimensions must be integers <=4096; DPR must be <=3');
  }
  o.out = path.resolve(o.out);
  o.basePath = o['base-path'] || '/';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(o.basePath)) throw new Error('--base-path must be an absolute directory path ending in /');
  if (o['base-path'] && !o.root) throw new Error('--base-path requires --root');
  const specs = o.views === 'short' ? ['1:tee:noon', '1:green:noon', '1:top:noon', '1:tee:golden'] : o.views.split(',');
  o.views = specs.map(spec => {
    const [h, cam, preset, extra] = spec.split(':');
    if (extra || !/^\d+$/.test(h) || +h < 1 || !['tee', 'green', 'top', 'orbit'].includes(cam)
      || !['noon', 'golden', 'mist', 'dawn', 'host'].includes(preset)) throw new Error(`Invalid view: ${spec}`);
    return { id: `h${h}_${cam}_${preset}`, hole: +h, cam, preset };
  });
  if (new Set(o.views.map(v => v.id)).size !== o.views.length) throw new Error('Duplicate views');
  if (o.bark) o.views.push({ id: 'h1_pine_bark_noon', hole: 1, cam: 'bark', preset: 'noon' });
  return o;
}

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
      && a.stream?.loadingTiles === 0 && a.stream.failedTiles === 0 && V.settled() && p;
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
    return { backend: V.stats.backend, quality: V.quality(), renderer: V.rendererInfo(),
      camera: V.camInfo(), lens: V.cameraInfo(), treeLod: V.treeLodPx(), tiers: V.treeTiers(),
      terrain: V.v2Terrain().adapter, plan: V.v2Plan(),
      // Identity/byte sums describe source terrain data, not shader output.
      terrainInventory: V.v2WorldInventory().map(t => ({ tileId: t.tileId, identity: t.identity,
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
  note: 'Image changes are expected. Draw/triangle deltas are observations, not FPS evidence; shadow refresh can alter per-frame counters.' };
}

async function main(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const local = o.root ? await serveBuild(o.root, o.basePath) : null;
  const url = new URL(local?.base || o.base);
  for (const [key, value] of Object.entries({ bana: o.course, v2: 'require', det: '1', q: o.q,
    qualitylock: '1', ren: '1', gl: o.backend === 'webgl2' ? '1' : '0', lodmode: 'zone' })) url.searchParams.set(key, value);
  if (o.graphics === 'default') url.searchParams.delete('graphics');
  else url.searchParams.set('graphics', o.graphics);
  const args = ['--no-sandbox', '--disable-lcd-text', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (o.backend === 'webgpu') args.push('--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
    '--enable-experimental-web-platform-features', '--use-gpu-in-tests', '--enable-features=UseSkiaRenderer,Vulkan',
    '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface');
  const report = { schemaVersion: 1, date: new Date().toISOString(), url: url.href, graphics: o.graphics,
    executionAdapter: 'swiftshader-software', performanceEvidence: false,
    note: 'Software captures verify correctness only. Compare real-hardware median/p95/p99 frame times separately.',
    request: { course: o.course, backend: o.backend, q: o.q, viewport: [o.width, o.height], dpr: o.dpr, views: o.views },
    errors: [], warnings: [], views: [], passed: false };
  let browser;
  try {
    // Let Playwright select its bundled headless shell unless explicitly
    // overridden. Forcing chromium.executablePath() selects full Chromium,
    // whose process-singleton sockets may be unavailable in capture runners.
    const executablePath = o.chrome || process.env.CHROME_BIN;
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args });
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: o.dpr,
      reducedMotion: 'reduce', serviceWorkers: 'block' });
    const timeout = o.timeout * 1000;
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', text: String(error).slice(0, 3000) }));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' || /(?:shader|pipeline|wgsl|glsl).*(?:error|failed|invalid)|validation error/i.test(text)) {
        report.errors.push({ type: message.type(), text: text.slice(0, 3000) });
      } else if (message.type() === 'warning') report.warnings.push(text.slice(0, 1500));
    });
    page.on('requestfailed', request => {
      const failure = { type: 'requestfailed', url: request.url(), text: request.failure()?.errorText };
      // Moving the camera cancels terrain requests no longer in the plan.
      // Final settled residency and zero failed tiles remain mandatory.
      if (failure.text === 'net::ERR_ABORTED' && /\/grounds\/[^/]+\/terrain\/[a-f0-9]{64}\.bvch$/.test(failure.url)) {
        report.warnings.push(`Cancelled terrain request: ${failure.url}`);
      } else report.errors.push(failure);
    });
    console.log(`Capture ${o.course} ${o.backend} q=${o.q} graphics=${o.graphics}; software correctness only`);
    await page.goto(url.href, { waitUntil: 'load', timeout });
    console.log('  Application shell loaded; waiting for scene boot');
    await page.waitForSelector('#boot.done', { timeout });
    report.boot = await page.evaluate(() => ({ backend: window.V3D.stats.backend, quality: window.V3D.quality(),
      course: window.V3D.course(), terrain: window.V3D.v2Terrain(), stats: window.V3D.stats }));
    if (report.boot.backend !== o.backend) throw new Error(`Requested ${o.backend}, got ${report.boot.backend}`);
    const selectedPolish = report.boot.quality.graphicsPolish;
    if (selectedPolish !== undefined ? selectedPolish !== (o.graphics === '1') : o.graphics !== '0') {
      throw new Error(`Graphics switch not confirmed: requested ${o.graphics}, reported ${selectedPolish}`);
    }
    if (report.boot.quality.qualityLocked === false) throw new Error('Requested quality lock is not active');
    report.fingerprint = await fingerprint(page);
    console.log('  Scene booted; data fingerprints recorded');
    const expectedDpr = o.q === 'lo' ? 1 : Math.min(o.dpr, 2);
    const expectedBuffer = [Math.floor(o.width * expectedDpr), Math.floor(o.height * expectedDpr)];
    let firstContract;
    for (const view of o.views) {
      console.log(`  Settling ${view.id}`);
      await page.evaluate(v => {
        const V = window.V3D;
        if (!V.HOLES.some(h => h.n === v.hole)) throw new Error(`Hole ${v.hole} unavailable`);
        V.setPreset(v.preset); V.goHole(v.hole, true, true); V.setCam(v.cam === 'bark' ? 'tee' : v.cam, true);
        if (v.cam === 'bark') {
          const tee = V.HOLES[0].line[0];
          const tree = window.__v2GraphicsTrees.filter(t => t[5] === 1 && t[7] === 'A')
            .sort((a, b) => Math.hypot(a[0] - tee[0], a[2] - tee[1]) - Math.hypot(b[0] - tee[0], b[2] - tee[1]))[0];
          if (!tree) throw new Error('No zone-A pine available for bark view');
          const [x, y, z] = tree;
          V.placeCamera([x + 5, Math.max(y + 2.2, V.probeH(x + 5, z - 6) + 2.2), z - 6], [x, y + 2.2, z]);
        }
      }, view);
      await settle(page, timeout);
      const before = await stateAt(page), contract = captureContract(before);
      if (contract.lowq !== (o.q === 'lo') || contract.lowfx !== false || contract.pixelRatio !== expectedDpr
        || !same(contract.buffer, expectedBuffer) || contract.lod.mode !== 'zone') throw new Error(`Unexpected quality/buffer/LOD: ${JSON.stringify(contract)}`);
      if (firstContract && !same(firstContract, contract)) throw new Error(`Quality changed before ${view.id}`);
      firstContract ??= contract;
      const filename = `${view.id}.png`;
      const bytes = await page.screenshot({ path: path.join(o.out, filename), animations: 'disabled', timeout });
      const after = await stateAt(page);
      if (!same(contract, captureContract(after)) || after.terrain.stream.loadingTiles !== 0
        || after.terrain.stream.failedTiles !== 0 || !same(before.terrainInventory, after.terrainInventory)) throw new Error(`Scene/quality changed while capturing ${view.id}`);
      report.views.push({ ...view, file: filename, imageSha256: sha256(bytes), before, after });
      console.log(`  ${filename}: ${before.renderer.drawCalls} draws, ${before.renderer.triangles} triangles, buffer ${contract.buffer.join('x')}`);
    }
    report.passed = report.errors.length === 0 && report.views.length === o.views.length;
    if (o.compare) {
      report.comparison = compareReports(JSON.parse(fs.readFileSync(o.compare, 'utf8')), report);
      report.passed &&= report.comparison.passed;
    }
  } catch (error) {
    report.passed = false;
    report.errors.push({ type: 'harness', text: String(error.stack || error) });
  } finally {
    if (browser) await browser.close();
    if (local) await new Promise(resolve => { local.server.closeAllConnections(); local.server.close(resolve); });
    fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${path.join(o.out, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv.includes('--help')) console.log(HELP);
else {
  try { await main(optionsFrom(process.argv.slice(2))); }
  catch (error) { console.error(`${error.message}\n${HELP}`); process.exitCode = 1; }
}
