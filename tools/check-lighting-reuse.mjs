#!/usr/bin/env node
/** Exact-revision isolated shader/cache comparison; SwiftShader, not device FPS.
 * node tools/check-lighting-reuse.mjs --baseline REV --out /tmp/lighting-reuse
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), flag = name => args[args.indexOf(`--${name}`) + 1];
if (!args.includes('--baseline') || !args.includes('--out')) throw new Error('Provide --baseline REV --out DIRECTORY');
const baseline = flag('baseline'), out = path.resolve(flag('out'));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
const hash = a => createHash('sha256').update(a).digest('hex');
const helper = 'apps/golf/src/engine/lighting-environment.mjs';
const sources = { before: git('show', `${baseline}:${helper}`), after: fs.readFileSync(path.join(root, helper), 'utf8') };
const main = fs.readFileSync(path.join(root, 'apps/golf/src/main.js'), 'utf8');
const presets = Function(`return (${main.match(/const PRESETS = (\{[\s\S]*?\n\});/)[1]});`)();
const threeRoot = fs.realpathSync(path.join(root, 'apps/golf/node_modules/three'));

async function checkInPage() {
  const width = 160, height = 120;
  const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4,
    outputBufferType: THREE.HalfFloatType, forceWebGL: true, reversedDepthBuffer: false });
  await renderer.init(); renderer.setPixelRatio(1); renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x708080);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(5, 5, 9); camera.lookAt(0, 0.3, 0);
  const hemi = new THREE.HemisphereLight(0xc9e0ff, 0x53623b, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2ac, 3); scene.add(sun);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.MeshStandardNodeMaterial({ color: i % 2 ? 0x718639 : 0x757f85,
      roughness: 0.12 + i * 0.16, metalness: i === 0 ? 0.8 : 0 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 16), m);
    mesh.position.set((i % 3 - 1) * 1.7, 0, Math.floor(i / 3) * 1.8 - 0.9); scene.add(mesh);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardNodeMaterial({ color: 0x36552b, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.7; scene.add(floor);
  let sceneBuilds = 0, allBuilds = 0, programs = 0, pipelines = 0;
  const renderObjects = new Map();
  const updateBindings = renderer._bindings.updateForRender.bind(renderer._bindings);
  renderer._bindings.updateForRender = object => {
    if (scene.getObjectById(object.object.id)) renderObjects.set(object.object.id, object);
    return updateBindings(object);
  };
  const createBuilder = renderer.backend.createNodeBuilder.bind(renderer.backend);
  renderer.backend.createNodeBuilder = (object, ...rest) => {
    allBuilds++; if (scene.getObjectById(object.id)) sceneBuilds++;
    return createBuilder(object, ...rest);
  };
  for (const name of ['createProgram', 'createRenderPipeline']) {
    const original = renderer.backend[name].bind(renderer.backend);
    renderer.backend[name] = (...a) => {
      if (name === 'createProgram') programs++;
      else { pipelines++; if (scene.getObjectById(a[0].object.id)) renderObjects.set(a[0].object.id, a[0]); }
      return original(...a);
    };
  }
  const lighting = createLightingEnvironment(renderer, scene);
  const sequence = QUICK ? ['noon', 'golden'] : ['noon', 'golden', 'noon', 'host', 'mist', 'dawn', 'golden', 'noon', 'host'];
  const rows = [];
  for (const name of sequence) {
    const p = PRESETS[name];
    const counts = { sceneBuilds, allBuilds, programs, pipelines };
    const t = performance.now();
    lighting.setPreset(name, p);
    const handlerMs = performance.now() - t;
    hemi.color.setHex(p.hemiS); hemi.groundColor.setHex(p.hemiG); hemi.intensity = p.hemiI;
    sun.color.setHex(p.sun); sun.intensity = p.int; sun.position.set(...p.dir).multiplyScalar(20);
    renderer.toneMappingExposure = p.exp;
    const renderStarted = performance.now();
    for (let i = 0; i < 2; i++) {
      await new Promise(requestAnimationFrame);
      renderer.render(scene, camera);
      await waitForGpuFrame(renderer);
    }
    // Capture immediately after a render; WebGL's default backbuffer is transient.
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0);
    rows.push({ preset: name, handlerMs, renderAndWaitMs: performance.now() - renderStarted,
      sceneBuilds: sceneBuilds - counts.sceneBuilds, allBuilds: allBuilds - counts.allBuilds,
      programs: programs - counts.programs, pipelines: pipelines - counts.pipelines,
      cache: lighting.snapshot(), memory: { ...renderer.info.memory },
      environment: { id: scene.environment.id, version: scene.environment.version,
        nodeValue: scene.environmentNode?.value?.id, pmrem: scene.environmentNode?._pmrem?.id,
        nodeTexture: scene.environmentNode?._texture?.value?.id },
      sampledBindings: [...renderObjects.values()].flatMap(object => object.getBindings().flatMap(group => group.bindings
        .filter(binding => binding.isSampledTexture && binding.texture).map(binding => ({ texture: binding.texture.id,
          nodeTexture: binding.textureNode?.value?.id, generation: binding.generation,
          actualGeneration: renderer._textures.get(binding.texture).generation })))),
      pixels: Array.from(ctx.getImageData(0, 0, width, height).data), png: canvas.toDataURL() });
  }
  const gl = renderer.backend.gl, extension = gl.getExtension('WEBGL_debug_renderer_info');
  const adapter = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2()).toArray();
  lighting.dispose(); renderer.dispose();
  return { adapter, width, height, drawingBuffer, rows };
}

const server = http.createServer((req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', 'text/javascript');
    if (pathname === '/') {
      const side = new URL(req.url, 'http://localhost').searchParams.get('side');
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
        'three/webgpu': '/three/build/three.webgpu.js', 'three/tsl': '/three/build/three.tsl.js' } })}</script>
        <script type="module">import * as THREE from 'three/webgpu';
        import {createLightingEnvironment} from '/${side}.mjs';
        import {waitForGpuFrame} from '/first-frame-ready.mjs';
        const PRESETS=${JSON.stringify(presets)}, QUICK=${args.includes('--quick')};
        (${checkInPage.toString()})().then(result=>window.result=result,error=>window.result={error:String(error.stack)});</script>`);
    }
    if (pathname === '/before.mjs' || pathname === '/after.mjs') return res.end(sources[pathname.slice(1, -4)]);
    if (pathname === '/first-frame-ready.mjs') return res.end(fs.readFileSync(path.join(root, 'apps/golf/src/engine/first-frame-ready.mjs')));
    const file = fs.realpathSync(path.resolve(threeRoot, pathname.slice('/three/'.length)));
    if (!pathname.startsWith('/three/') || !file.startsWith(threeRoot + path.sep)) throw new Error('Bad path');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end('not found'); }
});
fs.mkdirSync(out, { recursive: true });
let browser;
const report = { baselineRevision: baseline, candidateCheckpoint: git('rev-parse', 'HEAD').trim(),
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, hash(v)])),
  hardwarePerformanceEvidence: false, method: 'Isolated 7-object scene, 160x120 DPR1 MSAA4, Three r185 WebGL2 SwiftShader. Same presets, geometry, material settings and PMREM resolution/filtering. Counts include actual node builds and backend calls; software timings are diagnostic only.', errors: [] };
const persist = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const pixels = {};
  for (const side of ['before', 'after']) {
    console.log(`Checking ${side} lighting lifecycle`);
    const page = await browser.newPage({ viewport: { width: 160, height: 120 } });
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?side=${side}`);
    await page.waitForFunction(() => window.result, null, { timeout: 120000 });
    const result = await page.evaluate(() => window.result);
    if (result.error) throw new Error(result.error);
    pixels[side] = result.rows.map(row => row.pixels);
    for (const [i, row] of result.rows.entries()) {
      const png = Buffer.from(row.png.split(',')[1], 'base64');
      fs.writeFileSync(path.join(out, `${side}-${i}-${row.preset}.png`), png);
      row.pngSha256 = hash(png); delete row.png; delete row.pixels;
    }
    report[side] = result; persist(); await page.close();
  }
  report.comparisons = pixels.before.map((a, i) => {
    const b = pixels.after[i]; let max = 0, sum = 0, different = 0;
    for (let p = 0; p < a.length; p += 4) {
      let changed = false;
      for (let c = 0; c < 4; c++) { const d = Math.abs(a[p + c] - b[p + c]); max = Math.max(max, d); sum += d; changed ||= d > 0; }
      if (changed) different++;
    }
    return { preset: report.before.rows[i].preset, maximumChannelError: max, meanChannelError: sum / a.length,
      differingPixels: different, beforeBuilds: report.before.rows[i].sceneBuilds, afterBuilds: report.after.rows[i].sceneBuilds };
  });
  report.passed = report.errors.length === 0 && report.comparisons.every(r => r.maximumChannelError <= 1)
    && report.after.rows.slice(1).every(r => r.sceneBuilds === 0 && r.cache.allocations <= 2);
  persist(); console.log(JSON.stringify({ passed: report.passed, comparisons: report.comparisons }, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.errors.push(String(error.stack)); report.passed = false; persist(); throw error; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
