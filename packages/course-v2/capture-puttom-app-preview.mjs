#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG } from '../../geobuild/png.mjs';

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
  const image = decodePNG(await readFile(file));
  let dark = 0, luminance = 0, varied = 0;
  const count = image.width * image.height;
  const referenceOffset = ((image.height - 2) * image.width + image.width - 2) * image.channels;
  const reference = [image.data[referenceOffset], image.data[referenceOffset + 1], image.data[referenceOffset + 2]];
  for (let index = 0; index < count; index++) {
    const offset = index * image.channels;
    const value = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
    luminance += value;
    if (value < 8) dark++;
    if (Math.max(
      Math.abs(image.data[offset] - reference[0]),
      Math.abs(image.data[offset + 1] - reference[1]),
      Math.abs(image.data[offset + 2] - reference[2]),
    ) >= 10) varied++;
  }
  return Object.freeze({
    width: image.width, height: image.height,
    meanLuminance: +(luminance / count / 255).toFixed(4),
    nearBlackPercent: +(dark / count * 100).toFixed(2),
    variedPercent: +(varied / count * 100).toFixed(2),
  });
}

async function capture({ origin, output, backend, chrome, timeoutMilliseconds }) {
  const browser = await chromium.launch(launchOptions(chrome, backend));
  const mobile = backend === 'webgl2';
  const page = await browser.newPage({
    viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const problems = [];
  page.on('pageerror', error => problems.push(`page: ${String(error.message || error)}`.slice(0, 240)));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`.slice(0, 240));
  });
  try {
    const query = new URLSearchParams({
      bana: 'puttom', v2: '1', det: '1', q: mobile ? 'lo' : 'hi',
      hal: '1', vy: 'top', skylt: '0',
    });
    if (backend === 'webgl2') query.set('gl', '1');
    await page.goto(`${origin}/?${query}`, { waitUntil: 'load', timeout: timeoutMilliseconds });
    await page.waitForFunction(() => window.V3D?.v2Terrain?.().status === 'ready', null, {
      timeout: timeoutMilliseconds,
    });
    await page.waitForFunction(() => window.V3D?.settled?.() === true, null, {
      timeout: timeoutMilliseconds,
    });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      v2: window.V3D.v2Terrain(), stats: window.V3D.stats,
      perf: window.V3D.perf(), fps: window.V3D.fps(),
      badge: document.getElementById('v2TerrainBadge')?.textContent?.trim() || null,
    }));
    if (!state.v2.ready || state.v2.status !== 'ready' || state.v2.source.renderedTiles !== 16 ||
        state.v2.renderer.drawCalls !== 1) throw new Error('real app did not retain the verified 16-tile one-draw preview');
    if (backend === 'webgl2' && state.stats.backend !== 'webgl2') {
      throw new Error(`forced WebGL2 app capture initialized ${state.stats.backend}`);
    }
    const actualBackend = state.stats.backend;
    const image = `puttom-app-${mobile ? 'mobile-' : ''}${backend}-requested-${actualBackend}.png`;
    const file = join(output, image);
    await page.screenshot({ path: file, animations: 'disabled', timeout: timeoutMilliseconds });
    const pixels = await imageEvidence(file);
    const canvasImage = `puttom-canvas-${mobile ? 'mobile-' : ''}${backend}-requested-${actualBackend}.png`;
    const canvasFile = join(output, canvasImage);
    const rendererCanvas = page.locator('body > canvas').first();
    await rendererCanvas.screenshot({ path: canvasFile, animations: 'disabled', timeout: timeoutMilliseconds });
    const canvasPixels = await imageEvidence(canvasFile);
    const canvasVisible = canvasPixels.meanLuminance >= 0.025 &&
      canvasPixels.nearBlackPercent <= 92 && canvasPixels.variedPercent >= 3;
    if (backend === 'webgl2' && !canvasVisible) {
      throw new Error('real app WebGL2 canvas has no visible course foreground');
    }
    return Object.freeze({
      requestedBackend: backend, actualBackend, mobileEmulation: mobile,
      backendMatched: backend === actualBackend, executionAdapter: 'swiftshader-software',
      performanceEvidence: false, image, pixels, canvasImage, canvasPixels, canvasVisible,
      v2: state.v2, app: state.stats,
      boot: state.perf, sampledFps: state.fps, badge: state.badge,
      problems: Object.freeze([...new Set(problems)].slice(0, 10)),
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const root = resolve(options.root), output = resolve(options.out);
  for (const required of ['index.html', 'v2/puttom/preview.json']) {
    if (!(await stat(join(root, required))).isFile()) throw new Error(`app capture root is missing ${required}`);
  }
  await mkdir(output, { recursive: true });
  const server = await serve(root), captures = [], failures = [];
  try {
    for (const backend of ['webgl2', 'webgpu']) {
      try {
        captures.push(await capture({
          origin: server.origin, output, backend, chrome: options.chrome,
          timeoutMilliseconds: options.timeoutSeconds * 1000,
        }));
      } catch (error) {
        failures.push({ backend, error: String(error?.message || error).slice(0, 400) });
      }
    }
  } finally {
    await server.close();
  }
  const report = {
    schemaVersion: 1, provisional: true, productionDefault: false,
    captures, failures,
    webgl2Passed: captures.some(capture => capture.requestedBackend === 'webgl2' &&
      capture.backendMatched && capture.canvasVisible),
    webgpuBackendPassed: captures.some(capture => capture.requestedBackend === 'webgpu' && capture.backendMatched),
    webgpuCanvasPassed: captures.some(capture => capture.requestedBackend === 'webgpu' &&
      capture.backendMatched && capture.canvasVisible),
  };
  await writeFile(join(output, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.webgl2Passed) throw new Error('interactive Puttom mobile WebGL2 capture failed');
}

main().catch(error => {
  console.error(`interactive Puttom preview capture failed: ${error.message}`);
  process.exitCode = 1;
});
