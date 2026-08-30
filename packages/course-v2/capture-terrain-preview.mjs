#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG } from '../../geobuild/png.mjs';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.bvch', 'application/vnd.banvy.chunk-v2'], ['.png', 'image/png'],
]);

function parseArguments(argv) {
  const result = { root: null, out: null, chrome: process.env.CHROME_BIN || null, timeoutSeconds: 180 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') result.root = argv[++index];
    else if (argument === '--out') result.out = argv[++index];
    else if (argument === '--chrome') result.chrome = argv[++index];
    else if (argument === '--timeout') result.timeoutSeconds = Number(argv[++index]);
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!result.root || !result.out) throw new Error('--root and --out are required');
  if (!Number.isFinite(result.timeoutSeconds) || result.timeoutSeconds < 10 || result.timeoutSeconds > 600) {
    throw new Error('--timeout must be from 10 to 600 seconds');
  }
  return result;
}

function browserOptions(explicitChrome, requestedBackend) {
  const candidates = [
    explicitChrome,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => existsSync(candidate));
  const common = [
    '--no-sandbox', '--headless=new', '--disable-lcd-text',
    '--force-device-scale-factor=1',
  ];
  /* Chromium's own Linux WebGPU pixel tests pair ANGLE and Dawn SwiftShader,
     enable Skia's Vulkan renderer and use surface-less presentation. The
     hosted runner has no physical adapter, so this remains a software
     correctness proof and never device-performance evidence. */
  const backend = requestedBackend === 'webgl2'
    ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    : [
        '--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
        '--enable-experimental-web-platform-features', '--use-gpu-in-tests',
        '--enable-features=UseSkiaRenderer,Vulkan', '--use-angle=swiftshader',
        '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
        '--disable-vulkan-surface',
      ];
  return {
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    args: [...common, ...backend],
  };
}

function safeTarget(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://local').pathname);
  const relativePath = pathname === '/' ? 'v2-terrain-proof.html' : pathname.replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) return null;
  const target = resolve(root, relativePath);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

async function staticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const target = safeTarget(root, request.url || '/');
      if (!target || !(await stat(target)).isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      const data = await readFile(target);
      response.writeHead(200, {
        'content-type': MIME.get(extname(target)) || 'application/octet-stream',
        'content-length': String(data.byteLength),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
      });
      response.end(data);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())),
  };
}

function pixelStats(file) {
  return readFile(file).then(bytes => {
    const image = decodePNG(bytes);
    let luminance = 0, dark = 0, foreground = 0, inspected = 0;
    const count = image.width * image.height;
    const cornerOffset = ((image.height - 1) * image.width + image.width - 1) * image.channels;
    const background = [image.data[cornerOffset], image.data[cornerOffset + 1], image.data[cornerOffset + 2]];
    for (let index = 0; index < count; index++) {
      const offset = index * image.channels;
      const value = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
      luminance += value;
      if (value < 8) dark++;
      const x = index % image.width, y = Math.floor(index / image.width);
      /* Exclude the proof label. A cleared canvas otherwise passed the old
         non-black check because its pastel clear colour is intentionally bright. */
      if (x < image.width * 0.34 && y < image.height * 0.16) continue;
      inspected++;
      const difference = Math.max(
        Math.abs(image.data[offset] - background[0]),
        Math.abs(image.data[offset + 1] - background[1]),
        Math.abs(image.data[offset + 2] - background[2]),
      );
      if (difference >= 8) foreground++;
    }
    return Object.freeze({
      width: image.width,
      height: image.height,
      meanLuminance: Number((luminance / count / 255).toFixed(4)),
      nearBlackPercent: Number((100 * dark / count).toFixed(2)),
      foregroundPercent: Number((100 * foreground / inspected).toFixed(2)),
    });
  });
}

async function capture({ origin, output, requestedBackend, chrome, timeoutMilliseconds }) {
  const browser = await chromium.launch(browserOptions(chrome, requestedBackend));
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', error => problems.push(String(error).split('\n')[0].slice(0, 240)));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`.slice(0, 240));
    }
  });
  try {
    const query = new URLSearchParams({ preview: '/preview.json' });
    if (requestedBackend === 'webgl2') query.set('gl', '1');
    await page.goto(`${origin}/v2-terrain-proof.html?${query}`, {
      waitUntil: 'load', timeout: timeoutMilliseconds,
    });
    await page.waitForFunction(() => {
      const boot = document.getElementById('boot');
      return boot?.classList.contains('done') || boot?.classList.contains('error');
    }, null, { timeout: timeoutMilliseconds });
    const state = await page.evaluate(() => ({
      failed: document.getElementById('boot')?.classList.contains('error'),
      error: window.V3D?.error || null,
      stats: window.V3D?.stats || null,
      shader: window.V3D?.shader || null,
    }));
    if (state.failed || !state.stats) throw new Error(state.error || 'terrain preview did not publish renderer stats');
    if (state.stats.synthetic || !state.stats.provisional) {
      throw new Error('capture did not render a retained provisional pilot');
    }
    if (requestedBackend === 'webgl2' && state.stats.backend !== 'webgl2') {
      throw new Error(`forced WebGL2 capture initialized ${state.stats.backend}`);
    }
    if (!Number.isSafeInteger(state.stats.renderedTiles) || state.stats.renderedTiles < 1 ||
        !Number.isFinite(state.stats.triangles) || state.stats.triangles <= 0 ||
        state.stats.drawCalls !== 1) {
      throw new Error('terrain preview did not retain a positive one-draw topology');
    }
    const actualBackend = state.stats.backend;
    const fileName = requestedBackend === actualBackend
      ? `puttom-${actualBackend}.png`
      : `puttom-${requestedBackend}-requested-${actualBackend}.png`;
    const file = join(output, fileName);
    /* A WebGPU canvas presents a fresh swap texture. Submit and flush one draw
       immediately before capture so a later compositor frame cannot replace
       the verified terrain image with a cleared presentation texture. */
    await page.evaluate(async () => {
      if (typeof window.V3D?.prepareCapture !== 'function') {
        throw new Error('terrain preview does not expose a capture barrier');
      }
      await window.V3D.prepareCapture();
    });
    await page.screenshot({ path: file, animations: 'disabled', timeout: timeoutMilliseconds });
    const canvasPixels = await pixelStats(file);
    const visible = value => value.meanLuminance >= 0.03 && value.nearBlackPercent <= 88 &&
      value.foregroundPercent >= 2;
    let pixels = canvasPixels;
    let acceptedImage = fileName;
    let captureMethod = 'canvas-screenshot';
    let canvasPresentationVisible = visible(canvasPixels);
    let readbackFailure = null;
    if (!canvasPresentationVisible && actualBackend === 'webgpu') {
      try {
        const readback = await page.evaluate(async () => {
          if (typeof window.V3D?.captureReadback !== 'function') {
            throw new Error('terrain preview does not expose WebGPU render-target readback');
          }
          return window.V3D.captureReadback();
        });
        if (readback?.mimeType !== 'image/png' || readback.width !== 1600 ||
            readback.height !== 900 || !Number.isSafeInteger(readback.encodedBytes) ||
            readback.encodedBytes < 100 || readback.encodedBytes > 20 * 1024 * 1024 ||
            typeof readback.base64 !== 'string') {
          throw new Error('WebGPU render-target readback returned an invalid bounded PNG');
        }
        const bytes = Buffer.from(readback.base64, 'base64');
        if (bytes.byteLength !== readback.encodedBytes ||
            bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
          throw new Error('WebGPU render-target readback PNG failed byte validation');
        }
        acceptedImage = 'puttom-webgpu-render-target.png';
        await writeFile(join(output, acceptedImage), bytes);
        pixels = await pixelStats(join(output, acceptedImage));
        captureMethod = 'render-target-readback';
      } catch (error) {
        readbackFailure = String(error?.message || error).slice(0, 300);
      }
    }
    if (!visible(pixels)) {
      const diagnosticVariants = {};
      if (actualBackend === 'webgpu') {
        for (const mode of ['flat-terrain', 'flat-single-tile', 'canary']) {
          await page.evaluate(async diagnosticMode => {
            if (typeof window.V3D?.diagnose !== 'function') {
              throw new Error('terrain preview does not expose WebGPU diagnostics');
            }
            await window.V3D.diagnose(diagnosticMode);
          }, mode);
          const diagnosticImage = `puttom-webgpu-${mode}.png`;
          const diagnosticFile = join(output, diagnosticImage);
          await page.screenshot({
            path: diagnosticFile,
            animations: 'disabled',
            timeout: timeoutMilliseconds,
          });
          diagnosticVariants[mode] = {
            image: diagnosticImage,
            ...(await pixelStats(diagnosticFile)),
          };
        }
      }
      const error = new Error('terrain preview screenshot has no visible terrain foreground');
      error.captureDiagnostics = {
        stats: state.stats,
        pixels: canvasPixels,
        ...(readbackFailure ? { readbackFailure } : {}),
        problems: [...new Set(problems)].slice(0, 12),
        diagnosticVariants,
        shader: state.shader,
      };
      throw error;
    }
    return Object.freeze({
      requestedBackend,
      actualBackend,
      backendMatched: requestedBackend === actualBackend,
      executionAdapter: 'swiftshader-software',
      performanceEvidence: false,
      image: acceptedImage,
      captureMethod,
      canvasPresentationVisible,
      ...(captureMethod === 'render-target-readback' ? { canvasPixels } : {}),
      ...pixels,
      renderedTiles: state.stats.renderedTiles,
      drawCalls: state.stats.drawCalls,
      actualDrawCalls: state.stats.actualDrawCalls,
      actualTriangles: state.stats.actualTriangles,
      rendererCountersReliable: Number.isFinite(state.stats.actualDrawCalls) &&
        state.stats.actualDrawCalls > 0 && Number.isFinite(state.stats.actualTriangles) &&
        state.stats.actualTriangles > 0,
      problems: Object.freeze([...new Set(problems)].slice(0, 8)),
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = resolve(options.root), output = resolve(options.out);
  if (!(await stat(join(root, 'preview.json'))).isFile() ||
      !(await stat(join(root, 'v2-terrain-proof.html'))).isFile()) {
    throw new Error('capture root must contain preview.json and v2-terrain-proof.html');
  }
  await mkdir(output, { recursive: true });
  const server = await staticServer(root);
  const captures = [];
  const failures = [];
  try {
    try {
      captures.push(await capture({
        origin: server.origin, output, requestedBackend: 'webgl2', chrome: options.chrome,
        timeoutMilliseconds: options.timeoutSeconds * 1000,
      }));
    } catch (error) {
      failures.push({
        requestedBackend: 'webgl2', error: String(error.message || error).slice(0, 300),
        ...(error.captureDiagnostics ? { diagnostics: error.captureDiagnostics } : {}),
      });
    }
    try {
      captures.push(await capture({
        origin: server.origin, output, requestedBackend: 'webgpu', chrome: options.chrome,
        timeoutMilliseconds: options.timeoutSeconds * 1000,
      }));
    } catch (error) {
      failures.push({
        requestedBackend: 'webgpu', error: String(error.message || error).slice(0, 300),
        ...(error.captureDiagnostics ? { diagnostics: error.captureDiagnostics } : {}),
      });
    }
  } finally {
    await server.close();
  }
  const report = {
    schemaVersion: 1,
    provisional: true,
    productionEnabled: false,
    captures,
    failures,
    webgl2Passed: captures.some(item => item.requestedBackend === 'webgl2' && item.backendMatched),
    webgpuPassed: captures.some(item => item.requestedBackend === 'webgpu' && item.backendMatched),
    webgpuCanvasPassed: captures.some(item => item.requestedBackend === 'webgpu' &&
      item.backendMatched && item.canvasPresentationVisible),
  };
  await writeFile(join(output, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.webgl2Passed) throw new Error('forced WebGL2 retained-pilot capture failed');
}

main().catch(error => {
  console.error(`terrain preview capture failed: ${error.message}`);
  process.exitCode = 1;
});
