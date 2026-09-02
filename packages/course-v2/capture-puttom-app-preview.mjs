#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG } from '../../geobuild/png.mjs';
import {
  PUTTOM_PREVIEW_CONFIG,
  PUTTOM_PREVIEW_REQUIRED_SURFACE_CLASSES,
} from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import {
  PUTTOM_APP_CAPTURE_CASES,
  isV2RequestUrl,
  summarizePuttomAppCaptureProof,
} from './capture-proof-policy.mjs';
import { isCourseFrameVisible, rendererImageEvidence } from './visual-evidence.mjs';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.bvch', 'application/vnd.banvy.chunk-v2'], ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
]);

function argumentsFrom(argv) {
  const options = { root: null, out: null, timeoutSeconds: 240, chrome: process.env.CHROME_BIN || null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--root') options.root = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--timeout') options.timeoutSeconds = Number(argv[++index]);
    else if (argv[index] === '--chrome') options.chrome = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!options.root || !options.out) throw new Error('--root and --out are required');
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 30 || options.timeoutSeconds > 600) {
    throw new Error('--timeout must be from 30 to 600 seconds');
  }
  return options;
}

function launchOptions(explicitChrome, backend) {
  const candidates = [
    explicitChrome, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => existsSync(candidate));
  const common = ['--no-sandbox', '--headless=new', '--force-device-scale-factor=1', '--disable-lcd-text'];
  const flags = backend === 'webgl2'
    ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    : [
        '--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
        '--enable-experimental-web-platform-features', '--use-gpu-in-tests',
        '--enable-features=UseSkiaRenderer,Vulkan', '--use-angle=swiftshader',
        '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
      ];
  return {
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    args: [...common, ...flags],
  };
}

function safeFile(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://local').pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) return null;
  const target = resolve(root, relativePath);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

async function serve(root) {
  const server = createServer(async (request, response) => {
    try {
      const target = safeFile(root, request.url || '/');
      if (!target || !(await stat(target)).isFile()) return response.writeHead(404).end('not found');
      const bytes = await readFile(target);
      response.writeHead(200, {
        'content-type': MIME.get(extname(target)) || 'application/octet-stream',
        'content-length': String(bytes.byteLength), 'cache-control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())),
  };
}

async function imageEvidence(file) {
  return rendererImageEvidence(decodePNG(await readFile(file)));
}

function assertPngReadback(readback, viewport) {
  const sourceBytes = viewport.width * viewport.height * 4;
  const rowBytes = viewport.width * 4;
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const paddedBytes = (viewport.height - 1) * paddedRowBytes + rowBytes;
  if (readback?.mimeType !== 'image/png' || readback.width !== viewport.width ||
      readback.height !== viewport.height || readback.provisional !== true ||
      readback.performanceEvidence !== false || !Number.isSafeInteger(readback.encodedBytes) ||
      readback.sourceBytes !== sourceBytes ||
      ![sourceBytes, paddedBytes].includes(readback.readbackBytes) ||
      readback.rowPaddingStripped !== (readback.readbackBytes !== readback.sourceBytes) ||
      readback.encodedBytes < 100 || readback.encodedBytes > 20 * 1024 * 1024 ||
      typeof readback.base64 !== 'string') {
    throw new Error('real app WebGPU readback returned invalid or overstated evidence');
  }
  const bytes = Buffer.from(readback.base64, 'base64');
  if (bytes.byteLength !== readback.encodedBytes || bytes[0] !== 0x89 || bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('real app WebGPU readback PNG failed bounded byte validation');
  }
  return bytes;
}

async function capture({ origin, output, captureCase, chrome, timeoutMilliseconds }) {
  const { id: caseId, backend, mobile, quality } = captureCase;
  const browser = await chromium.launch(launchOptions(chrome, backend));
  const viewport = mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 };
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const problems = [];
  page.on('pageerror', error => problems.push(`page: ${String(error.message || error)}`.slice(0, 240)));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      const problem = `${message.type()}: ${message.text()}`.slice(0, 240);
      problems.push(problem);
      console.warn(`[${caseId}] ${problem}`);
    }
  });
  try {
    const query = new URLSearchParams({
      bana: 'puttom', v2: 'require', det: '1', q: quality,
      hal: '1', vy: 'ovan', ljus: 'dag', skylt: '0',
    });
    if (backend === 'webgl2') query.set('gl', '1');
    await page.goto(`${origin}/?${query}`, { waitUntil: 'load', timeout: timeoutMilliseconds });
    await page.waitForFunction(() => {
      const status = window.V3D?.v2Terrain?.().status;
      const badge = document.getElementById('v2TerrainBadge');
      return status === 'ready' || status === 'failed' || status === 'fallback' ||
        badge?.dataset.state === 'fallback';
    }, null, {
      timeout: timeoutMilliseconds,
    });
    const terminalPreview = await page.evaluate(() => {
      const badge = document.getElementById('v2TerrainBadge');
      return {
        status: window.V3D?.v2Terrain?.().status || badge?.dataset.state || null,
        error: window.V3D?.v2Terrain?.().renderer?.error || badge?.dataset.error || null,
      };
    });
    if (terminalPreview.status !== 'ready') {
      const browserProblem = problems.at(-1);
      throw new Error(`${caseId} v2 preview reached ${terminalPreview.status || 'unknown'}: ${
        terminalPreview.error || browserProblem || 'no browser diagnostic'}`);
    }
    await page.waitForFunction(() => window.V3D?.settled?.() === true, null, {
      timeout: timeoutMilliseconds,
    });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      v2: window.V3D.v2Terrain(), stats: window.V3D.stats,
      perf: window.V3D.perf(), fps: window.V3D.fps(),
      camera: window.V3D.camInfo(),
      badge: document.getElementById('v2TerrainBadge')?.textContent?.trim() || null,
    }));
    /* Counts come from the reviewed config, never restated here. The pilot has
       gone 16 -> 64 terrain tiles and its surface is now a 30-tile subset of
       them, and a second copy of either number in this file would have failed
       CI for the wrong reason -- or worse, kept passing against the old one. */
    const expectedTiles = PUTTOM_PREVIEW_CONFIG.expectedTileCount;
    const expectedSurfaceTiles = PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount;
    if (!state.v2.ready || state.v2.status !== 'ready' ||
        state.v2.source.renderedTiles !== expectedTiles ||
        state.v2.renderer.drawCalls !== 1) {
      throw new Error(`real app did not retain the verified ${expectedTiles}-tile one-draw preview`);
    }
    const singleTerrainSurfacePassed = state.v2.courseSurfaceOverlayMeshes === 0 &&
      state.stats.surfaceOverlays === 0;
    if (!singleTerrainSurfacePassed) {
      throw new Error(
        `${caseId} created ${state.v2.courseSurfaceOverlayMeshes ?? state.stats.surfaceOverlays ?? 'unknown'} ` +
        'course-surface overlay meshes on ready v2 terrain',
      );
    }
    const liveAdapterPassed = state.v2.adapter?.kind === 'fixed-frontier' &&
      state.v2.adapter.phase === 'ready' && state.v2.adapter.requested === true &&
      state.v2.adapter.sourceReady === true && state.v2.adapter.preflightReady === true &&
      state.v2.adapter.active === true && state.v2.adapter.renderer?.status === 'ready';
    if (!liveAdapterPassed) {
      throw new Error('real app did not activate the fail-closed v2 live adapter');
    }
    /* Puttom's graph is published and registered, so selection must resolve it
       through the real manifest loader — root, course manifest, ground
       manifest and the exact live GPK1 fallback identity — and still render
       from the frontier that passed the adapter contract. */
    const selectionPassed = state.v2.selection?.mode === 'fixed-frontier' &&
      state.v2.selection.requestMode === 'require' &&
      state.v2.selection.graphError === null &&
      state.v2.selection.publishedGraphSlugs?.includes('puttom') === true &&
      state.v2.selection.graph?.slug === 'puttom' &&
      state.v2.selection.graph.groundId === 'puttom' &&
      state.v2.selection.graph.tiles === 85 &&
      state.v2.selection.graph.holes === 18;
    if (!selectionPassed) {
      throw new Error(`real app did not route the pilot through the generic v2 selection boundary: ${
        JSON.stringify(state.v2.selection || null)}`);
    }
    if (state.v2.surface?.tileCount !== expectedSurfaceTiles || state.v2.surface.provisional !== true ||
        state.v2.surface.reason !== 'migration-vectors-not-survey-approved') {
      throw new Error(
        `real app did not retain the bound ${expectedSurfaceTiles}-tile provisional surface frontier`);
    }
    /* the per-class representation is what the remediation plan ships; a
       pair atlas here means the loader silently took the old format */
    if (state.v2.surfaceRepresentation !== 'class-sdf-v1') {
      throw new Error(`real app is drawing surfaces as ${state.v2.surfaceRepresentation}, not class-sdf-v1`);
    }
    const presentClasses = new Set((state.v2.surface.classes || [])
      .filter(item => Number.isSafeInteger(item?.count) && item.count > 0).map(item => item.id));
    const missingClasses = PUTTOM_PREVIEW_REQUIRED_SURFACE_CLASSES
      .filter(({ id }) => !presentClasses.has(id)).map(({ label }) => label);
    if (missingClasses.length) throw new Error(`surface frontier is missing ${missingClasses.join(', ')}`);
    const surfaceEvidencePassed = missingClasses.length === 0;
    const expectedCutout = PUTTOM_PREVIEW_CONFIG.legacyCoreCutout;
    const expectedCore = expectedCutout.expectedCoreGrid;
    const actualCore = state.v2.renderer?.coreGrid;
    const legacyCoreCutoutPassed = state.v2.renderer?.status === 'ready' &&
      actualCore?.dx === expectedCore.dx &&
      actualCore?.x0 === expectedCore.x0 && actualCore?.x1 === expectedCore.x1 &&
      actualCore?.z0 === expectedCore.z0 && actualCore?.z1 === expectedCore.z1 &&
      actualCore?.nx === expectedCore.nx && actualCore?.nz === expectedCore.nz &&
      state.v2.renderer.skippedBasePoints === expectedCutout.expectedSkippedBasePoints &&
      state.v2.renderer.totalBasePoints === expectedCutout.expectedTotalBasePoints &&
      state.v2.renderer.emittedBasePoints ===
        expectedCutout.expectedTotalBasePoints - expectedCutout.expectedSkippedBasePoints &&
      Number.isSafeInteger(state.v2.renderer.removedTriangles) &&
      state.v2.renderer.removedTriangles > 0 &&
      state.v2.renderer.guardMetres === expectedCutout.guardMetres &&
      state.v2.renderer.fallbackRebuilt === false;
    if (!legacyCoreCutoutPassed) {
      throw new Error(`${caseId} did not retain the verified construction-time legacy CORE cutout`);
    }
    if (state.stats.backend !== backend || state.v2.backend !== backend) {
      throw new Error(`${caseId} initialized ${state.stats.backend}/${state.v2.backend}`);
    }
    if (state.camera.mode !== 'top') throw new Error(`${caseId} did not retain the canonical overhead camera`);
    await page.evaluate(async () => {
      if (typeof window.V3D?.prepareCapture !== 'function') {
        throw new Error('real app does not expose a capture barrier');
      }
      await window.V3D.prepareCapture();
    });
    const actualBackend = state.stats.backend;
    const appImage = `puttom-app-${caseId}-requested-${actualBackend}.png`;
    const appFile = join(output, appImage);
    await page.screenshot({ path: appFile, animations: 'disabled', timeout: timeoutMilliseconds });
    const appPixels = await imageEvidence(appFile);

    /* Element screenshots include composited siblings above a full-viewport
       canvas. Hide the HUD before collecting presentation evidence so a menu or
       minimap can never turn a transparent swap texture into a passing frame. */
    const presentationImage = `puttom-renderer-${caseId}-requested-${actualBackend}.png`;
    const presentationFile = join(output, presentationImage);
    const canvasOnlyStyle = await page.addStyleTag({
      content: 'body > :not(canvas) { visibility: hidden !important; }',
    });
    try {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
      await page.screenshot({ path: presentationFile, animations: 'disabled', timeout: timeoutMilliseconds });
    } finally {
      await canvasOnlyStyle.evaluate(node => node.remove());
    }
    const presentationPixels = await imageEvidence(presentationFile);
    const canvasPresentationVisible = isCourseFrameVisible(presentationPixels);

    let acceptedImage = presentationImage;
    let acceptedPixels = presentationPixels;
    let captureMethod = 'clean-canvas-presentation';
    let sceneReadbackPassed = null;
    let readbackEvidence = null;
    if (actualBackend === 'webgpu') {
      const readback = await page.evaluate(async () => {
        if (typeof window.V3D?.captureReadback !== 'function') {
          throw new Error('real app does not expose WebGPU render-target readback');
        }
        return window.V3D.captureReadback();
      });
      const bytes = assertPngReadback(readback, viewport);
      readbackEvidence = Object.freeze({
        sourceBytes: readback.sourceBytes,
        readbackBytes: readback.readbackBytes,
        rowPaddingStripped: readback.rowPaddingStripped,
        encodedBytes: readback.encodedBytes,
      });
      acceptedImage = `puttom-render-target-${caseId}.png`;
      await writeFile(join(output, acceptedImage), bytes);
      acceptedPixels = await imageEvidence(join(output, acceptedImage));
      captureMethod = 'active-pipeline-render-target-readback';
      sceneReadbackPassed = isCourseFrameVisible(acceptedPixels);
    }
    const acceptedFrameVisible = isCourseFrameVisible(acceptedPixels);
    if (!acceptedFrameVisible) throw new Error(`${caseId} has no distributed course pixels`);
    const fatalProblems = problems.filter(problem => /^(page|error):/.test(problem));
    if (fatalProblems.length) throw new Error(`${caseId} emitted ${fatalProblems[0]}`);
    return Object.freeze({
      caseId, requestedBackend: backend, actualBackend, mobileEmulation: mobile, quality,
      backendMatched: backend === actualBackend, executionAdapter: 'swiftshader-software',
      performanceEvidence: false, lighting: 'noon', cameraMode: state.camera.mode,
      appImage, appPixels, presentationImage, presentationPixels, canvasPresentationVisible,
      image: acceptedImage, pixels: acceptedPixels, captureMethod, acceptedFrameVisible,
      sceneReadbackPassed, readbackEvidence, surfaceEvidencePassed,
      singleTerrainSurfacePassed,
      legacyCoreCutoutPassed, liveAdapterPassed, selectionPassed,
      v2: state.v2, app: state.stats,
      boot: state.perf, sampledFps: state.fps, badge: state.badge,
      problems: Object.freeze([...new Set(problems)].slice(0, 10)),
    });
  } finally {
    await browser.close();
  }
}

/* The no-request contract, proven at runtime rather than only by static chunk
   exclusion: a normal visit without the v2 flag must neither request any /v2/
   data or v2 root manifest nor load a single v2-* code chunk. */
async function verifyNormalVisitMakesNoV2Request({ origin, chrome, timeoutMilliseconds }) {
  const browser = await chromium.launch(launchOptions(chrome, 'webgl2'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const v2Requests = [];
  page.on('request', request => {
    const url = request.url();
    if (isV2RequestUrl(url)) v2Requests.push(url.slice(0, 200));
  });
  try {
    const query = new URLSearchParams({ bana: 'puttom', det: '1', q: 'lo', hal: '1', vy: 'ovan' });
    await page.goto(`${origin}/?${query}`, { waitUntil: 'load', timeout: timeoutMilliseconds });
    const selection = await page.waitForFunction(() => {
      const v2 = window.V3D?.v2Terrain?.();
      return v2?.selection ? JSON.stringify(v2.selection) : false;
    }, null, { timeout: timeoutMilliseconds }).then(handle => handle.jsonValue()).then(JSON.parse);
    if (selection.mode !== 'off' || selection.requestMode !== 'off') {
      throw new Error(`normal visit selected v2 mode ${selection.mode}/${selection.requestMode}`);
    }
    if (v2Requests.length) {
      throw new Error(`normal visit made ${v2Requests.length} v2 request(s): ${v2Requests[0]}`);
    }
    return Object.freeze({ passed: true, selectionMode: selection.mode, v2Requests: 0 });
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const root = resolve(options.root), output = resolve(options.out);
  /* The pilot moved out of /v2/ and into the published graph's own directory,
     so requiring the old path here would only ever have been satisfied by CI
     copying an abandoned 1024 m staging tree into the build. Ask the reviewed
     config where the descriptor is instead of restating a path. */
  for (const required of ['index.html', PUTTOM_PREVIEW_CONFIG.descriptorPath]) {
    if (!(await stat(join(root, required))).isFile()) throw new Error(`app capture root is missing ${required}`);
  }
  await mkdir(output, { recursive: true });
  const server = await serve(root), captures = [], failures = [];
  let normalVisit = null;
  try {
    /* A no-flag proof failure must not abort the run before the report exists:
       every outcome, this one included, lands in capture-report.json and the
       final fail-closed gate below decides. */
    try {
      normalVisit = await verifyNormalVisitMakesNoV2Request({
        origin: server.origin, chrome: options.chrome,
        timeoutMilliseconds: options.timeoutSeconds * 1000,
      });
    } catch (error) {
      normalVisit = Object.freeze({
        passed: false,
        error: String(error?.message || error).slice(0, 400),
      });
    }
    for (const captureCase of PUTTOM_APP_CAPTURE_CASES) {
      try {
        captures.push(await capture({
          origin: server.origin, output, captureCase, chrome: options.chrome,
          timeoutMilliseconds: options.timeoutSeconds * 1000,
        }));
      } catch (error) {
        failures.push({
          caseId: captureCase.id,
          backend: captureCase.backend,
          error: String(error?.message || error).slice(0, 400),
        });
      }
    }
  } finally {
    await server.close();
  }
  const proof = summarizePuttomAppCaptureProof(captures, failures);
  const report = {
    schemaVersion: 2, provisional: true, productionDefault: false,
    hardwarePerformanceEvidence: false,
    normalVisit,
    captures, failures,
    ...proof,
  };
  await writeFile(join(output, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.requiredCasesPassed || report.normalVisit?.passed !== true) {
    throw new Error('interactive Puttom visual/semantic proof failed closed');
  }
}

main().catch(error => {
  console.error(`interactive Puttom preview capture failed: ${error.message}`);
  process.exitCode = 1;
});
