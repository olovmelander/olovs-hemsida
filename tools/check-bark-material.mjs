#!/usr/bin/env node
/* Material-only Banvy bark review using the actual 256px BARK generator and
 * UV-bearing hero trunk geometry. Explicit SwiftShader WebGL2: pixel/shader
 * correctness, NOT full-course or real-device performance evidence.
 * node tools/check-bark-material.mjs [--out /tmp/bark-material]
 * --out writes report.json, actual bark texture and before/after PNGs. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = path.join(root, 'apps/golf/src/engine');
const threeRoot = fs.realpathSync(path.join(root, 'apps/golf/node_modules/three'));
const mainSource = fs.readFileSync(path.join(root, 'apps/golf/src/main.js'), 'utf8');
const barkSource = mainSource.match(/const BARK = canvasTex\(256,[\s\S]*?\n  \}, \{ srgb: false, rep: 1 \}\);/)?.[0];
const canvasSource = mainSource.match(/function canvasTex\([\s\S]*?\n\}/)?.[0];
const presetSource = mainSource.match(/const PRESETS = (\{[\s\S]*?\n\});/)?.[1];
if (!barkSource || !canvasSource || !presetSource) throw new Error('Could not locate the live BARK generator, canvasTex or presets.');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sourceMainBaseline = '5d9c4f27514d97fa608f8fef6713717de2c46ea7';
const fixtureModule = `
import * as THREE from 'three/webgpu';
import { fbm } from '/engine/geom.js';
import { averageBarkSample } from '/engine/bark-material.mjs';
const GRAPHICS_POLISH = true;
let barkMean;
${canvasSource}
export ${barkSource}
export const PRESETS = ${presetSource};
`;

async function checkInPage() {
  console.info('bark-check: starting fixture');
  const width = 256, height = 192;
  const rows = [], images = [], geometryFingerprints = [];
  let clipControl = false, rendererName = '';
  const barkPixels = BARK.image.getContext('2d').getImageData(0, 0, 256, 256).data;
  const meanSample = averageBarkSample(barkPixels);
  const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const barkHash = await hash(barkPixels);
  console.info('bark-check: actual texture ready');
  const modes = ['legacy', 'disabled', 'aligned', 'calibrated', 'flat'];
  const species = [
    { name: 'pine', dimensions: [0.22, 0.46, 9], hex: 0x6b4326 },
    { name: 'birch', dimensions: [0.16, 0.30, 7.4], hex: 0xc9c6b2 },
  ];
  function difference(a, b) {
    let maximum = 0, sum = 0, different = 0;
    for (let offset = 0; offset < a.length; offset += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(a[offset + channel] - b[offset + channel]);
        maximum = Math.max(maximum, delta); sum += delta; changed ||= delta > 0;
      }
      if (changed) different++;
    }
    return { maximumChannelError: maximum, meanChannelError: sum / a.length,
      differingPixels: different, totalPixels: width * height };
  }
  for (const reversed of [false, true]) {
    if (reversed && !clipControl) continue;
    const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4,
      outputBufferType: THREE.HalfFloatType, forceWebGL: true, reversedDepthBuffer: reversed });
    await renderer.init();
    console.info(`bark-check: ${reversed ? 'reversed' : 'normal'} WebGL2 ready`);
    renderer.setPixelRatio(1); renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.info.autoReset = false;
    document.body.appendChild(renderer.domElement);
    const gl = renderer.backend.gl;
    clipControl = !!gl.getExtension('EXT_clip_control');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const compiled = [];
    const createProgram = renderer.backend.createProgram;
    renderer.backend.createProgram = function (program) {
      if (program.stage === 'fragment') compiled.push(program.code);
      return createProgram.call(this, program);
    };
    try {
      for (const entry of species) {
        if (reversed && entry.name !== 'pine') continue;
        const geometry = createHeroTrunkGeometry(...entry.dimensions);
        geometry.computeBoundingBox();
        const buffers = Object.entries(geometry.attributes).map(([name, attribute]) => ({ name, array: attribute.array }));
        buffers.push({ name: 'index', array: geometry.index.array });
        const fingerprint = {
          species: entry.name, vertices: geometry.attributes.position.count,
          triangles: geometry.index.count / 3,
          bounds: [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray()],
          buffers: await Promise.all(buffers.map(async ({ name, array }) => ({ name,
            bytes: array.byteLength, sha256: await hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) }))),
        };
        geometryFingerprints.push({ reversed, ...fingerprint });
        const legacy = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(entry.hex),
          roughness: 0.95, metalness: 0, bumpMap: BARK, bumpScale: 0.05 });
        const bark = texture(BARK, uv().mul(vec2(3, 1.5))).r;
        legacy.colorNode = color(entry.hex).mul(bark.mul(0.6).add(0.62));
        const materials = {
          legacy,
          disabled: createBarkMaterial({ barkTexture: BARK, hex: entry.hex, graphicsPolish: false, meanSample }),
          aligned: createBarkMaterial({ barkTexture: BARK, hex: entry.hex, graphicsPolish: true }),
          calibrated: createBarkMaterial({ barkTexture: BARK, hex: entry.hex, graphicsPolish: true, meanSample }),
          flat: createBarkMaterial({ barkTexture: BARK, hex: entry.hex, graphicsPolish: true, meanSample }),
        };
        materials.flat.normalNode = null;
        materials.flat.bumpMap = null;
        const trunk = new THREE.Mesh(geometry, legacy);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x8295a9);
        scene.add(trunk);
        const hemi = new THREE.HemisphereLight();
        const sun = new THREE.DirectionalLight();
        scene.add(hemi, sun);
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.03, 100);
        const h = entry.dimensions[2], centreY = Math.min(2, h * 0.45);
        const views = { close: { position: [1.3, centreY, 2], look: [0, centreY, 0] } };
        if (entry.name === 'pine' && !reversed) {
          views.above = { position: [1.25, h + 1.1, 1.25], look: [0, h - 0.3, 0] };
          views.grazing = { position: [2.1, centreY + 0.35, 0.3], look: [-0.1, centreY, 0] };
        }
        async function capture(mode) {
          trunk.material = materials[mode];
          const start = compiled.length;
          for (let i = 0; i < 1; i++) {
            await new Promise(requestAnimationFrame); renderer.render(scene, camera);
          }
          await new Promise(requestAnimationFrame);
          renderer.info.reset(); renderer.render(scene, camera);
          const shaders = compiled.slice(start).map(code => {
            const body = code.slice(code.indexOf('void main()'));
            const textureSites = [...body.matchAll(/\btexture(?:Lod|Grad)?\s*\(\s*(\w+)/g)];
            const barkSampler = textureSites[0]?.[1];
            return { source: code, textureSamples: textureSites.length,
              barkTextureSamples: textureSites.filter(site => site[1] === barkSampler).length,
              selfSubtractingGradient: /\b(nodeVar\d+)\.x\s*-\s*\1\.x\b/.test(body),
              samplerUniforms: (code.match(/uniform\s+(?:highp\s+)?sampler2D\b/g) || []).length };
          }).filter(counts => counts.textureSamples >= 3);
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          const memory = renderer.info.memory;
          return { pixels, png: canvas.toDataURL(), drawCalls: renderer.info.render.drawCalls,
            triangles: renderer.info.render.triangles,
            drawingBuffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), pixelRatio: renderer.getPixelRatio(),
            reversedDepth: renderer.reversedDepthBuffer, samples: renderer.samples,
            textures: memory.textures, texturesBytes: memory.texturesSize,
            attributesBytes: memory.attributesSize, indicesBytes: memory.indexAttributesSize,
            newFragmentShaders: shaders,
          };
        }
        for (const presetName of (reversed || entry.name === 'birch' ? ['golden'] : ['noon', 'golden'])) {
          const preset = PRESETS[presetName];
          hemi.color.set(preset.hemiS); hemi.groundColor.set(preset.hemiG); hemi.intensity = preset.hemiI;
          sun.color.set(preset.sun); sun.intensity = preset.int;
          sun.position.fromArray(preset.dir).multiplyScalar(100);
          renderer.toneMappingExposure = preset.exp;
          for (const [view, pose] of Object.entries(views)) {
            console.info(`bark-check: ${reversed ? 'reversed' : 'normal'} ${entry.name} ${presetName} ${view}`);
            camera.position.fromArray(pose.position); camera.lookAt(...pose.look);
            const captures = {};
            for (const mode of modes) captures[mode] = await capture(mode);
            const id = `${reversed ? 'reversed' : 'normal'}-${entry.name}-${presetName}-${view}`;
            const comparisons = {
              disabled: difference(captures.legacy.pixels, captures.disabled.pixels),
              aligned: difference(captures.legacy.pixels, captures.aligned.pixels),
              calibrated: difference(captures.legacy.pixels, captures.calibrated.pixels),
              reliefAgainstFlat: difference(captures.flat.pixels, captures.calibrated.pixels),
            };
            for (const mode of modes) {
              images.push({ name: `${id}-${mode}`, png: captures[mode].png });
              delete captures[mode].pixels; delete captures[mode].png;
            }
            rows.push({ id, species: entry.name, preset: presetName, view, captures, comparisons });
          }
        }
        Object.values(materials).forEach(material => material.dispose());
        geometry.dispose();
      }
    } finally { renderer.dispose(); renderer.domElement.remove(); }
  }
  return { threeRevision: THREE.REVISION, renderer: rendererName, clipControl,
    reversedDepthCheck: clipControl ? 'measured' : 'skipped: EXT_clip_control unavailable',
    bark: { width: 256, height: 256, rgbaSha256: barkHash, meanSample,
      rgbaBaseBytes: barkPixels.length, mipmappedRgbaBytes: (256 * 256 * 4 - 1) / 3 * 4,
      anisotropy: BARK.anisotropy, repeat: BARK.repeat.toArray(), generateMipmaps: BARK.generateMipmaps,
      colourSpace: BARK.colorSpace, baselineMeanMultiplier: 0.62 + 0.6 * meanSample,
      calibratedMeanMultiplier: 1, png: BARK.image.toDataURL() },
    geometryFingerprints, rows, images };
}

const html = `<!doctype html><style>body{margin:0}</style>
<script type="importmap">${JSON.stringify({ imports: {
  'three': '/three/build/three.webgpu.js', 'three/webgpu': '/three/build/three.webgpu.js',
  'three/tsl': '/three/build/three.tsl.js', 'three/addons/': '/three/examples/jsm/',
} })}</script>
<script type="module">
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, color } from 'three/tsl';
import { createBarkMaterial, averageBarkSample } from '/engine/bark-material.mjs';
import { createHeroTrunkGeometry } from '/engine/tree-trunk-geometry.mjs';
import { BARK, PRESETS } from '/fixture.mjs';
(${checkInPage.toString()})().then(result => { window.result = result; },
  error => { window.result = { error: String(error.stack || error) }; });
</script>`;

function makeServer() {
  const allowedEngineFiles = new Set(['bark-material.mjs', 'tree-trunk-geometry.mjs', 'geom.js']);
  return http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/' || pathname === '/fixture.mjs') {
        res.setHeader('Content-Type', pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
        res.end(pathname === '/' ? html : fixtureModule); return;
      }
      let file;
      if (pathname.startsWith('/engine/') && allowedEngineFiles.has(pathname.slice(8))) file = path.join(engine, pathname.slice(8));
      else {
        if (!pathname.startsWith('/three/')) throw new Error('Unknown resource');
        file = fs.realpathSync(path.resolve(threeRoot, pathname.slice('/three/'.length)));
        if (!file.startsWith(threeRoot + path.sep)) throw new Error('Outside dependency');
      }
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node tools/check-bark-material.mjs [--out DIRECTORY]');
  const out = args.length ? path.resolve(args[1]) : null;
  const server = makeServer(); let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 256, height: 192 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.text().startsWith('bark-check:')) console.log(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.result, null, { timeout: 90_000 });
    const result = await page.evaluate(() => window.result);
    if (result.error) throw new Error(result.error);
    const captures = result.rows.flatMap(row => Object.values(row.captures));
    const checks = {
      threeR185: result.threeRevision === '185', softwareRenderer: /SwiftShader/i.test(result.renderer),
      completeMatrix: result.rows.length === (result.clipControl ? 8 : 7),
      disabledExactPixels: result.rows.every(row => row.comparisons.disabled.differingPixels === 0),
      reliefChangesPixels: result.rows.every(row => row.comparisons.aligned.differingPixels > 0),
      reliefAgainstSameAlbedoFlat: result.rows.every(row => row.comparisons.reliefAgainstFlat.differingPixels > 0),
      unchangedDrawsAndTriangles: result.rows.every(row => Object.values(row.captures).every(capture =>
        capture.drawCalls === row.captures.legacy.drawCalls && capture.triangles === row.captures.legacy.triangles)),
      unchangedBufferAndTextureMemory: result.rows.every(row => Object.values(row.captures).every(capture =>
        ['textures', 'texturesBytes', 'attributesBytes', 'indicesBytes'].every(key => capture[key] === row.captures.legacy[key]))),
      fixedBuffer: captures.every(capture => capture.drawingBuffer[0] === 256 && capture.drawingBuffer[1] === 192
        && capture.pixelRatio === 1 && capture.samples === 4),
      noAdditionalTextureSamples: result.rows.every(row => {
        const baseline = row.captures.legacy.newFragmentShaders;
        if (!baseline.length) return true;
        const maximum = Math.max(...baseline.map(shader => shader.textureSamples));
        return Object.values(row.captures).every(capture => capture.newFragmentShaders.every(shader => shader.textureSamples <= maximum));
      }),
      distinctFiniteDifferenceSamples: result.rows.every(row => ['aligned', 'calibrated'].every(mode =>
        row.captures[mode].newFragmentShaders.every(shader => shader.barkTextureSamples >= 3 && !shader.selfSubtractingGradient))),
      noBrowserErrors: errors.length === 0,
    };
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'bark-texture.png'), Buffer.from(result.bark.png.split(',')[1], 'base64'));
      for (const image of result.images) fs.writeFileSync(path.join(out, `${image.name}.png`), Buffer.from(image.png.split(',')[1], 'base64'));
    }
    for (const row of result.rows) for (const [mode, capture] of Object.entries(row.captures)) {
      capture.newFragmentShaders.forEach((shader, index) => {
        if (out) fs.writeFileSync(path.join(out, `${row.id}-${mode}-${index}.frag.glsl`), shader.source);
        shader.sourceSha256 = sha256(shader.source);
        delete shader.source;
      });
    }
    delete result.images; delete result.bark.png;
    const report = { evidence: 'Material-only actual BARK generator and hero trunk geometry, SwiftShader WebGL2. Fixed live noon/golden lights, no wind/fade/environment map. Not full-course, WebGPU or real-device FPS evidence.',
      sourceMainBaseline, barkGeneratorSha256: sha256(barkSource), canvasGeneratorSha256: sha256(canvasSource),
      helperSha256: sha256(fs.readFileSync(path.join(engine, 'bark-material.mjs'))),
      trunkGeometrySourceSha256: sha256(fs.readFileSync(path.join(engine, 'tree-trunk-geometry.mjs'))),
      shaderCountsMeaning: 'newFragmentShaders lists compilations in this capture; an empty list means cached program reuse.',
      ...result, errors, checks, passed: Object.values(checks).every(Boolean) };
    if (out) fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, checks, bark: report.bark,
      rows: report.rows.map(row => ({ id: row.id, comparisons: row.comparisons,
        shaders: Object.fromEntries(Object.entries(row.captures).map(([mode, capture]) => [mode, capture.newFragmentShaders])) })) }, null, 2));
    if (!report.passed) throw new Error(`Bark check failed: ${Object.keys(checks).filter(key => !checks[key]).join(', ')}`);
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
