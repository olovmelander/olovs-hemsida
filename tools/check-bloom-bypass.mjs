#!/usr/bin/env node
/* Isolated-scene correctness check, NOT an app or hardware FPS benchmark.
 * Uses Three r185 and explicitly forces SwiftShader WebGL2. Requires the
 * repository dependencies and Playwright's Chromium headless shell.
 *
 * node tools/check-bloom-bypass.mjs [--out /tmp/bloom-bypass]
 * With --out, writes report.json and three reference PNGs. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = path.join(root, 'apps/golf/src/engine/active-render-pipeline.mjs');
const threeRoot = fs.realpathSync(path.join(root, 'apps/golf/node_modules/three'));
const sourceMainBaseline = 'a40681dac130275f136f9dae9eb26dbeb279f66b';

// Serialized into the page below, where the Three and helper imports resolve.
async function checkInPage() {
  const width = 256, height = 192;
  const renderer = new THREE.WebGPURenderer({
    antialias: true, samples: 4, outputBufferType: THREE.HalfFloatType,
    forceWebGL: true, reversedDepthBuffer: false,
  });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x718098);
  const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 100);
  camera.position.set(5, 4, 7);
  camera.lookAt(0, 0.4, 0);
  scene.add(new THREE.HemisphereLight(0xc9e0ff, 0x53623b, 1));
  const sun = new THREE.DirectionalLight(0xffe2ac, 3);
  sun.position.set(3, 6, 2);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardNodeMaterial({ color: 0x335b28, roughness: 0.72 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2, 1.7),
    new THREE.MeshStandardNodeMaterial({ color: 0x946b3b, roughness: 0.5 }));
  box.position.set(-1, 1, 0);
  box.rotation.y = 0.24;
  scene.add(box);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5, 3),
    new THREE.MeshStandardNodeMaterial({ color: 0x438cad, roughness: 0.25, metalness: 0.05,
      transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(1, 0.13, 1);
  scene.add(water);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: 0xffcc77, emissiveIntensity: 4 }));
  glow.position.set(1, 1, -1);
  scene.add(glow);

  const post = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const bloomNode = bloom(sceneColor, 0, 0.3, 0.86);
  post.outputNode = sceneColor.add(bloomNode);
  renderer.__post = post;
  const pixels = [], rows = [];
  async function capture(lowfx, name) {
    // Each measurement needs its own animation frame: PassNode and BloomNode
    // otherwise reuse the previous frame's result and undercount their work.
    for (let i = 0; i < 3; i++) {
      await new Promise(requestAnimationFrame);
      renderActivePipeline(renderer, scene, camera, lowfx);
    }
    await new Promise(requestAnimationFrame);
    renderer.info.reset();
    const previousCalls = renderer.info.render.calls;
    renderActivePipeline(renderer, scene, camera, lowfx);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    pixels.push(data);
    const colours = new Set();
    for (let i = 0; i < data.length; i += 4) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    rows.push({ name, drawingBuffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      pixelRatio: renderer.getPixelRatio(), uniqueColours: colours.size,
      drawCalls: renderer.info.render.drawCalls,
      renderCalls: renderer.info.render.calls - previousCalls,
      bloomStrength: bloomNode.strength.value, toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure, outputColorSpace: renderer.outputColorSpace,
      png: canvas.toDataURL(),
    });
  }
  await capture(false, 'zero-bloom-post');
  await capture(true, 'direct-fallback');
  await capture(false, 'zero-bloom-post-repeat');
  function compare(a, b) {
    let maximum = 0, sum = 0, differingPixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(a[i + channel] - b[i + channel]);
        sum += difference;
        maximum = Math.max(maximum, difference);
        changed ||= difference > 0;
      }
      if (changed) differingPixels++;
    }
    return { maximumChannelError: maximum, meanChannelError: sum / a.length,
      differingPixels, totalPixels: width * height };
  }
  const gl = renderer.backend.gl;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { threeRevision: THREE.REVISION,
    renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    samples: renderer.samples, outputBufferType: renderer.getOutputBufferType(), rows,
    comparison: compare(pixels[0], pixels[1]), repeat: compare(pixels[0], pixels[2]),
  };
}

const html = `<!doctype html><style>body{margin:0}</style>
<script type="importmap">${JSON.stringify({ imports: {
  'three/webgpu': '/three/build/three.webgpu.js', 'three/tsl': '/three/build/three.tsl.js',
  'three/addons/': '/three/examples/jsm/',
} })}</script>
<script type="module">
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { renderActivePipeline } from '/helper.mjs';
(${checkInPage.toString()})().then(result => { window.result = result; },
  error => { window.result = { error: String(error.stack || error) }; });
</script>`;

function makeServer() {
  return http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      let file;
      if (pathname === '/helper.mjs') file = helper;
      else {
        if (!pathname.startsWith('/three/')) throw new Error('Unknown resource');
        file = fs.realpathSync(path.resolve(threeRoot, pathname.slice('/three/'.length)));
        if (!file.startsWith(threeRoot + path.sep)) throw new Error('Outside dependency');
      }
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) {
    throw new Error('Usage: node tools/check-bloom-bypass.mjs [--out DIRECTORY]');
  }
  const out = args.length ? path.resolve(args[1]) : null;
  const server = makeServer();
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 256, height: 192 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.result, null, { timeout: 120_000 });
    const result = await page.evaluate(() => window.result);
    if (result.error) throw new Error(result.error);
    const [before, after, repeat] = result.rows;
    const checks = {
      threeR185: result.threeRevision === '185',
      softwareRenderer: /SwiftShader/i.test(result.renderer),
      identicalPixels: result.comparison.differingPixels === 0,
      identicalRepeat: result.repeat.differingPixels === 0,
      twelveFewerDraws: before.drawCalls - after.drawCalls === 12,
      repeatDrawCount: before.drawCalls === repeat.drawCalls,
      fixedResolution: result.rows.every(row => row.drawingBuffer[0] === 256
        && row.drawingBuffer[1] === 192 && row.pixelRatio === 1),
      fixedOutput: result.rows.every(row => row.bloomStrength === 0
        && row.toneMapping === before.toneMapping && row.exposure === before.exposure
        && row.outputColorSpace === before.outputColorSpace),
      nonblankImage: result.rows.every(row => row.uniqueColours > 32),
      noBrowserErrors: errors.length === 0,
    };
    if (out) fs.mkdirSync(out, { recursive: true });
    for (const row of result.rows) {
      if (out) fs.writeFileSync(path.join(out, `${row.name}.png`), Buffer.from(row.png.split(',')[1], 'base64'));
      delete row.png;
    }
    const report = {
      evidence: 'Isolated-scene SwiftShader WebGL2 correctness; not an app before/after or real-device FPS benchmark.',
      sourceMainBaseline,
      helperSha256: createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),
      ...result, errors, checks, passed: Object.values(checks).every(Boolean),
    };
    if (out) fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) throw new Error(`Bloom bypass check failed: ${Object.keys(checks).filter(key => !checks[key]).join(', ')}`);
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
