#!/usr/bin/env node
/* Actual Banvy water shader in isolated scenes, explicitly using SwiftShader.
 * Pixel/draw correctness only; NOT app before/after or real-device FPS evidence.
 * node tools/check-water-single-pass.mjs [--out /tmp/water-single-pass]
 * --out writes report.json and before/after PNGs. Requires repository deps and
 * Playwright's bundled Chromium headless shell. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = path.join(root, 'apps/golf/src/engine/water-render-policy.mjs');
const threeRoot = fs.realpathSync(path.join(root, 'apps/golf/node_modules/three'));
const sourceMainBaseline = '241a3eeb4999442604d6e5ec41bfa020db822b30';
const mainSource = fs.readFileSync(path.join(root, 'apps/golf/src/main.js'), 'utf8');
const waterSource = mainSource.match(/function makeWater\(\{ mask = null \} = \{\}\) \{[\s\S]*?\n\}/)?.[0];
if (!waterSource) throw new Error('Could not locate the live makeWater function; update this fixture explicitly.');
const presetSource = mainSource.match(/const PRESETS = (\{[\s\S]*?\n\});/)?.[1];
if (!presetSource) throw new Error('Could not locate the live lighting presets.');
const sha256 = value => createHash('sha256').update(value).digest('hex');

// The production shader is unchanged. Only its inputs are replaced by small,
// deterministic textures and a frozen clock so before/after pixels can match.
const fixtureModule = `
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, uniform, attribute, texture, positionWorld, cameraPosition,
  oneMinus, smoothstep, normalize, pow, saturate, reflect, color, mix, exp, step } from 'three/tsl';
import { configureWaterRenderPasses } from '/helper.mjs';
import { createWaterReflectionLighting } from '/water-lighting.mjs';
function fixedTexture() {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 4;
    data.set([128 + Math.round(Math.sin(x * 0.7 + y) * 70),
      128 + Math.round(Math.cos(y * 0.6 + x) * 70), 220, 255], offset);
  }
  const result = new THREE.DataTexture(data, 16, 16);
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.minFilter = result.magFilter = THREE.LinearFilter;
  result.needsUpdate = true;
  return result;
}
const WATERN = fixedTexture(), DETAIL = fixedTexture(), time = uniform(3.25);
const uWaterGlint = uniform(1), uWaterChop = uniform(1);
const uSun = uniform(new THREE.Vector3(0.3, 0.7, 0.4).normalize());
const uFogD = uniform(0.0001), uFogC = uniform(new THREE.Color(0x718098));
const waterLighting = createWaterReflectionLighting({ enabled: true });
waterLighting.setPreset((${presetSource}).golden);
let DEPTH_SIGN = -1;
export function setFixtureDepth(reversed) { DEPTH_SIGN = reversed ? 1 : -1; }
export ${waterSource}
`;

async function checkInPage() {
  const width = 256, height = 192;
  const rows = [], images = [];
  let rendererName = '', clipControl = false;
  function waterGeometry(kind) {
    const positions = [], shore = [], foam = [], depth = [], indices = [];
    const sheets = kind === 'masked' ? [{ x: -3, y: 0 }, { x: 3, y: 1.4 }] : [{ x: 0, y: 0 }];
    for (const sheet of sheets) {
      const base = positions.length / 3;
      const size = kind === 'sea' ? 14 : kind === 'masked' ? 3 : 8;
      for (let z = 0; z <= 8; z++) for (let x = 0; x <= 8; x++) {
        positions.push(sheet.x + (x / 8 - 0.5) * size, sheet.y, (z / 8 - 0.5) * size);
        shore.push(kind === 'sea' ? 60 : Math.min(x, z, 8 - x, 8 - z) * 2.5);
        foam.push(kind === 'pond' ? 0 : 1);
        depth.push(0.3 + Math.min(x, z, 8 - x, 8 - z) * 0.8);
      }
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
        const a = base + z * 9 + x, b = a + 1, c = a + 9, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    geometry.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  function pixelDifference(a, b) {
    let maximum = 0, different = 0;
    for (let i = 0; i < a.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(a[i + channel] - b[i + channel]);
        maximum = Math.max(maximum, delta);
        changed ||= delta !== 0;
      }
      if (changed) different++;
    }
    return { maximumChannelError: maximum, differingPixels: different, totalPixels: width * height };
  }
  for (const reversed of [false, true]) {
    if (reversed && !clipControl) continue;
    const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4,
      outputBufferType: THREE.HalfFloatType, forceWebGL: true, reversedDepthBuffer: reversed });
    await renderer.init();
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.info.autoReset = false;
    document.body.appendChild(renderer.domElement);
    const gl = renderer.backend.gl;
    clipControl = !!gl.getExtension('EXT_clip_control');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    setFixtureDepth(reversed);
    const shaders = [];
    const createProgram = renderer.backend.createProgram;
    renderer.backend.createProgram = function (program) {
      if (program.stage === 'fragment') shaders.push(program.code);
      return createProgram.call(this, program);
    };
    try {
      for (const kind of ['pond', 'lake', 'sea', 'masked']) {
        const maskTexture = new THREE.DataTexture(new Uint8Array(16 * 4).fill(255), 4, 4);
        maskTexture.needsUpdate = true;
        const mask = kind === 'masked' ? { texture: maskTexture, toGrid: [1, 0, 0, 1],
          x0: -10, z0: -10, width: 4, height: 4, spacing: 5 } : null;
        const material = makeWater({ mask });
        const water = new THREE.Mesh(waterGeometry(kind), material);
        water.renderOrder = 6;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x718098);
        scene.add(water);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
          new THREE.MeshBasicNodeMaterial({ color: 0x604c26, side: THREE.DoubleSide }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -5;
        scene.add(ground);
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2),
          new THREE.MeshBasicNodeMaterial({ color: 0xc4873a }));
        box.position.set(-1, -0.5, 0);
        scene.add(box);
        const overlay = new THREE.Mesh(new THREE.PlaneGeometry(6, 4),
          new THREE.MeshBasicNodeMaterial({ color: 0xcd9563, transparent: true,
            opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
        overlay.position.set(0, 0, -1);
        overlay.renderOrder = 7;
        scene.add(overlay);
        const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 200);
        const views = { above: [7, 6, 8], below: [7, -3, 8], grazing: [7, 0.08, 8] };
        async function capture(singlePass) {
          material.forceSinglePass = false;
          if (singlePass) configureWaterRenderPasses(material, { mask });
          material.needsUpdate = true;
          const firstShader = shaders.length;
          for (let i = 0; i < 2; i++) {
            await new Promise(requestAnimationFrame);
            renderer.render(scene, camera);
          }
          await new Promise(requestAnimationFrame);
          renderer.info.reset();
          renderer.render(scene, camera);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(renderer.domElement, 0, 0);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          // Water is the only shader here with four or more texture samples.
          const waterShaders = shaders.slice(firstShader).map(code => ({
            textureSamples: (code.match(/\btexture(?:Lod|Grad)?\s*\(/g) || []).length,
            samplerUniforms: (code.match(/uniform\s+(?:highp\s+)?sampler2D\b/g) || []).length,
          })).filter(counts => counts.textureSamples >= 4);
          return { pixels, png: canvas.toDataURL(), drawCalls: renderer.info.render.drawCalls,
            forceSinglePass: material.forceSinglePass, waterShaders,
            drawingBuffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
            pixelRatio: renderer.getPixelRatio(), reversedDepth: renderer.reversedDepthBuffer,
            samples: renderer.samples, outputBufferType: renderer.getOutputBufferType() };
        }
        for (const [view, position] of Object.entries(views)) {
          camera.position.fromArray(position);
          camera.lookAt(0, 0, 0);
          const before = await capture(false), after = await capture(true);
          const difference = pixelDifference(before.pixels, after.pixels);
          water.visible = false;
          const withoutWater = await capture(true);
          water.visible = true;
          const waterContributionPixels = pixelDifference(after.pixels, withoutWater.pixels).differingPixels;
          const id = `${reversed ? 'reversed' : 'normal'}-${kind}-${view}`;
          images.push({ name: `${id}-before`, png: before.png }, { name: `${id}-after`, png: after.png });
          delete before.pixels; delete before.png; delete after.pixels; delete after.png;
          rows.push({ id, kind, view, before, after, difference, waterContributionPixels });
        }
        scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
        maskTexture.dispose();
      }
    } finally {
      renderer.dispose();
      renderer.domElement.remove();
    }
  }
  return { threeRevision: THREE.REVISION, renderer: rendererName, clipControl,
    reversedDepthCheck: clipControl ? 'measured' : 'skipped: EXT_clip_control unavailable', rows, images };
}

const html = `<!doctype html><style>body{margin:0}</style>
<script type="importmap">${JSON.stringify({ imports: {
  'three/webgpu': '/three/build/three.webgpu.js', 'three/tsl': '/three/build/three.tsl.js',
} })}</script>
<script type="module">
import * as THREE from 'three/webgpu';
import { configureWaterRenderPasses } from '/helper.mjs';
import { makeWater, setFixtureDepth } from '/water-fixture.mjs';
(${checkInPage.toString()})().then(result => { window.result = result; },
  error => { window.result = { error: String(error.stack || error) }; });
</script>`;

function makeServer() {
  return http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/' || pathname === '/water-fixture.mjs') {
        res.setHeader('Content-Type', pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
        res.end(pathname === '/' ? html : fixtureModule);
        return;
      }
      let file;
      if (pathname === '/helper.mjs') file = helper;
      else if (pathname === '/water-lighting.mjs' || pathname === '/lighting-environment.mjs') {
        file = path.join(root, 'apps/golf/src/engine', pathname.slice(1));
      }
      else {
        if (!pathname.startsWith('/three/')) throw new Error('Unknown resource');
        file = fs.realpathSync(path.resolve(threeRoot, pathname.slice('/three/'.length)));
        if (!file.startsWith(threeRoot + path.sep)) throw new Error('Outside dependency');
      }
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) {
    throw new Error('Usage: node tools/check-water-single-pass.mjs [--out DIRECTORY]');
  }
  const out = args.length ? path.resolve(args[1]) : null;
  const server = makeServer();
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
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
    const checks = {
      threeR185: result.threeRevision === '185',
      softwareRenderer: /SwiftShader/i.test(result.renderer),
      completeMatrix: result.rows.length === (result.clipControl ? 24 : 12),
      identicalPixels: result.rows.every(row => row.difference.differingPixels === 0),
      waterActuallyVisible: result.rows.every(row => row.waterContributionPixels > 0),
      expectedDrawReduction: result.rows.every(row => row.before.drawCalls - row.after.drawCalls === (row.kind === 'masked' ? 0 : 1)),
      maskedStaysTwoPass: result.rows.filter(row => row.kind === 'masked').every(row => row.after.forceSinglePass === false),
      fixedSettings: result.rows.every(row => [row.before, row.after].every(capture =>
        capture.drawingBuffer[0] === 256 && capture.drawingBuffer[1] === 192 && capture.pixelRatio === 1
        && capture.samples === 4 && capture.outputBufferType === 1016
        && capture.reversedDepth === row.id.startsWith('reversed-'))),
      noBrowserErrors: errors.length === 0,
    };
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      for (const image of result.images) fs.writeFileSync(path.join(out, `${image.name}.png`), Buffer.from(image.png.split(',')[1], 'base64'));
    }
    delete result.images;
    const report = {
      evidence: 'Isolated actual-water-shader SwiftShader WebGL2 correctness; synthetic fixed textures and time. Not full-course, WebGPU, or real-device FPS evidence.',
      shaderCountsMeaning: 'waterShaders lists new water fragment compilations during that capture; an empty list means the existing shader was reused.',
      sourceMainBaseline, waterShaderSourceSha256: sha256(waterSource), helperSha256: sha256(fs.readFileSync(helper)),
      lightingPreview: { enabled: true, preset: 'golden',
        sourceSha256: sha256(fs.readFileSync(path.join(root, 'apps/golf/src/engine/water-lighting.mjs'))),
        presetsSourceSha256: sha256(presetSource) },
      ...result, errors, checks, passed: Object.values(checks).every(Boolean),
    };
    if (out) fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, rows: report.rows.map(row => ({ id: row.id,
      draws: [row.before.drawCalls, row.after.drawCalls], ...row.difference, waterContributionPixels: row.waterContributionPixels,
      shaderCounts: [row.before.waterShaders, row.after.waterShaders] })) }, null, 2));
    if (!report.passed) throw new Error(`Water single-pass check failed: ${Object.keys(checks).filter(key => !checks[key]).join(', ')}`);
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
