#!/usr/bin/env node
/* Bounded DETAIL texture and material correctness check. The before generator
 * is read from its immutable Git revision, never copied from the candidate.
 * node tools/check-detail-texture.mjs --out /tmp/banvy-detail-texture
 * SwiftShader pixels and resource counts are NOT real-device FPS evidence. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = path.join(root, 'apps/golf/src/engine');
const threeRoot = fs.realpathSync(path.join(root, 'apps/golf/node_modules/three'));
const sourceMainBaseline = 'ce3597883a6c7495fc8204c23acac82413f197b7';
const baselineSource = execFileSync('git', ['show', `${sourceMainBaseline}:apps/golf/src/main.js`], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const required = (pattern, name) => {
  const found = baselineSource.match(pattern)?.[0];
  if (!found) throw new Error(`Could not extract baseline ${name}`);
  return found;
};
const detailSource = required(/const DETAIL = canvasTex\(512,[\s\S]*?\n\}, \{ srgb: false \}\);/, 'DETAIL');
const canvasSource = required(/function canvasTex\([\s\S]*?\n\}/, 'canvasTex');
const paletteSource = required(/const C = \{[\s\S]*?\n\};/, 'palette');
const shadeSource = required(/const SHADE = \{[\s\S]*?\n\};/, 'shade');
const aliasesSource = required(/const S_ROUGH = SURFACE.ROUGH[\s\S]*?S_SHORE = SURFACE.SHORE;/, 'surface aliases');
const conversionSource = required(/const s2l = [\s\S]*?const L = [^\n]+/, 'colour conversion');
const presetsSource = required(/const PRESETS = \{[\s\S]*?\n\};/, 'presets');
const fixture = `
import * as THREE from 'three/webgpu';
import { hash2, fbm } from '/engine/geom.js';
import { SURFACE } from '/engine/surface.js';
${canvasSource}
let baselineAuthored;
${detailSource.replace('g.putImageData(im, 0, 0);', 'baselineAuthored = d.slice(); g.putImageData(im, 0, 0);')}
${aliasesSource}
${conversionSource}
${paletteSource}
${shadeSource}
${presetsSource}
export { DETAIL, baselineAuthored, C, SHADE, PRESETS };
`;

async function checkInPage() {
  const size = 512, width = 256, height = 192;
  const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
  const candidate = new Uint8ClampedArray(size * size * 4);
  const disabled = new Uint8ClampedArray(size * size * 4);
  fillGroundDetailPixels(candidate, size, { seamless: true });
  fillGroundDetailPixels(disabled, size, { seamless: false });
  function summaries(data, n) {
    return Object.fromEntries(['R', 'G', 'B', 'A'].map((name, c) => {
      let sum = 0, square = 0, low = 0, high = 0, min = 255, max = 0;
      for (let i = c; i < data.length; i += 4) {
        const v = data[i]; sum += v; square += v * v;
        low += v === 0; high += v === 255; min = Math.min(min, v); max = Math.max(max, v);
      }
      const count = n * n, mean = sum / count;
      return [name, { mean, std: Math.sqrt(Math.max(0, square / count - mean * mean)), min, max, clippedLow: low, clippedHigh: high }];
    }));
  }
  function gradients(data, n, channel) {
    const border = [], interior = [];
    const at = (x, y) => data[(y * n + x) * 4 + channel];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      (x === n - 1 ? border : interior).push(Math.abs(at((x + 1) % n, y) - at(x, y)));
      (y === n - 1 ? border : interior).push(Math.abs(at(x, (y + 1) % n) - at(x, y)));
    }
    const stats = values => {
      values.sort((a, b) => a - b);
      return { mean: values.reduce((a, b) => a + b, 0) / values.length,
        p95: values[Math.floor((values.length - 1) * .95)], max: values.at(-1), count: values.length };
    };
    return { border: stats(border), interior: stats(interior) };
  }
  function mipEvidence(rgba) {
    let pixels = rgba, n = size;
    const rows = [];
    for (let level = 0; n >= 2; level++) {
      rows.push({ level, size: n, G: gradients(pixels, n, 1), B: gradients(pixels, n, 2) });
      const half = n / 2, next = new Uint8ClampedArray(half * half * 4);
      for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) for (let c = 0; c < 4; c++) {
        const at = (dx, dy) => pixels[((y * 2 + dy) * n + x * 2 + dx) * 4 + c];
        next[(y * half + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
      }
      pixels = next; n = half;
    }
    return rows;
  }
  const authored = {};
  for (const [name, pixels] of Object.entries({ legacy: baselineAuthored, candidate, disabled })) {
    authored[name] = { rgbaSha256: await hash(pixels), channels: summaries(pixels, size) };
    if (name !== 'disabled') authored[name].mips = mipEvidence(pixels);
  }
  const channelDifferenceCounts = Object.fromEntries(['R', 'G', 'B', 'A'].map((name, c) => {
    let count = 0;
    for (let i = c; i < candidate.length; i += 4) count += candidate[i] !== baselineAuthored[i];
    return [name, count];
  }));
  const context = DETAIL.image.getContext('2d');
  const canvasSources = {};
  const images = [];
  for (const [name, pixels] of Object.entries({ legacy: baselineAuthored, candidate })) {
    context.putImageData(new ImageData(pixels, size, size), 0, 0);
    const readback = context.getImageData(0, 0, size, size).data;
    canvasSources[name] = { rgbaSha256: await hash(readback), channels: summaries(readback, size), mips: mipEvidence(readback) };
    images.push({ name: `detail-${name}`, png: DETAIL.image.toDataURL() });
    for (const [channel, c] of [['G', 1], ['B', 2]]) {
      const preview = document.createElement('canvas'); preview.width = preview.height = size;
      const display = new Uint8ClampedArray(pixels.length);
      for (let i = 0; i < display.length; i += 4) { display[i] = display[i + 1] = display[i + 2] = pixels[i + c]; display[i + 3] = 255; }
      preview.getContext('2d').putImageData(new ImageData(display, size, size), 0, 0);
      images.push({ name: `authored-${channel}-${name}`, png: preview.toDataURL() });
    }
  }
  console.info('detail-check: texture statistics complete');
  const renderer = new THREE.WebGPURenderer({ forceWebGL: true, antialias: true, samples: 4, outputBufferType: THREE.HalfFloatType });
  await renderer.init();
  renderer.setPixelRatio(1); renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  const gl = renderer.backend.gl, debug = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  const compiled = [], createProgram = renderer.backend.createProgram;
  renderer.backend.createProgram = function (program) {
    if (program.stage === 'fragment') compiled.push(program.code);
    return createProgram.call(this, program);
  };
  const dataTexture = rgba => {
    const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
    return texture;
  };
  const atlas = { bounds: { x0: -1000, z0: -1000, x1: 1000, z1: 1000, w: 1, h: 1, res: 2000 },
    texF: dataTexture([255, 255, 0, 255]), texSdf: [dataTexture([0, 0, 0, 0])],
    data: { representation: 'class-sdf-v1', channels: [SURFACE.FAIRWAY], routeStepMetres: .25, ringStepMetres: .16 } };
  // A flat, uniform rough patch keeps the live ground shader and palette while
  // isolating its DETAIL input from course-specific masks, normals and shadows.
  const groundMaterial = createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, graphicsPolish: true })(new THREE.MeshStandardNodeMaterial());
  const diagnostic = channel => {
    const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    material.colorNode = vec3(texture(DETAIL, positionWorld.xz.mul(.025))[channel]);
    return material;
  };
  const materials = { ground: groundMaterial, diagnosticG: diagnostic('g'), diagnosticB: diagnostic('b') };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), groundMaterial);
  plane.rotation.x = -Math.PI / 2;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8c9eab); scene.add(plane);
  const p = PRESETS.noon;
  const hemi = new THREE.HemisphereLight(p.hemiS, p.hemiG, p.hemiI);
  const sun = new THREE.DirectionalLight(p.sun, p.int); sun.position.fromArray(p.dir).multiplyScalar(100);
  scene.add(hemi, sun); renderer.toneMappingExposure = p.exp;
  const camera = new THREE.PerspectiveCamera(48, width / height, .1, 1500);
  const rows = [];
  const difference = (a, b) => {
    let maximum = 0, sum = 0, pixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      let changed = false;
      for (let c = 0; c < 3; c++) { const delta = Math.abs(a[i + c] - b[i + c]); sum += delta; maximum = Math.max(maximum, delta); changed ||= delta > 0; }
      pixels += changed;
    }
    return { maximumChannelDifference: maximum, meanRgbDifference: sum / (width * height * 3), differingPixels: pixels };
  };
  async function capture(mode) {
    context.putImageData(new ImageData(mode === 'legacy' ? baselineAuthored : candidate, size, size), 0, 0);
    DETAIL.needsUpdate = true;
    await new Promise(requestAnimationFrame); renderer.render(scene, camera);
    await new Promise(requestAnimationFrame); renderer.info.reset(); renderer.render(scene, camera);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const memory = renderer.info.memory;
    return { pixels, png: canvas.toDataURL(), drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles,
      drawingBuffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), pixelRatio: renderer.getPixelRatio(),
      textures: memory.textures, textureBytes: memory.texturesSize, attributesBytes: memory.attributesSize,
      indicesBytes: memory.indexAttributesSize, fragmentPrograms: compiled.length };
  }
  try {
    for (const [materialName, material] of Object.entries(materials)) {
      plane.material = material;
      for (const view of ['close', 'grazing']) for (const pan of (materialName === 'ground' ? [-.35, 0, .35] : [0])) {
        const diagnosticView = materialName !== 'ground';
        const position = diagnosticView ? (view === 'close' ? [pan, 55, 46] : [pan, 10, 36])
          : (view === 'close' ? [pan + 4, 8, 9] : [pan + 18, 4, 24]);
        const look = diagnosticView ? [pan, 0, view === 'close' ? 0 : -25] : [pan, 0, view === 'close' ? 0 : -30];
        camera.position.fromArray(position); camera.lookAt(...look); camera.updateMatrixWorld();
        const id = `${materialName}-${view}-pan${pan}`;
        console.info(`detail-check: ${id}`);
        const before = await capture('legacy'), after = await capture('candidate');
        const comparison = difference(before.pixels, after.pixels);
        for (const [mode, capture] of [['legacy', before], ['candidate', after]]) {
          images.push({ name: `${id}-${mode}`, png: capture.png }); delete capture.png; delete capture.pixels;
        }
        rows.push({ id, material: materialName, view, pan, camera: { position, look, fov: camera.fov }, before, after, comparison });
      }
    }
    return { threeRevision: THREE.REVISION, renderer: rendererName, authored, canvasSources, channelDifferenceCounts,
      texture: { size, baseRgbaBytes: size * size * 4, fullMipRgbaBytes: (size * size * 4 - 1) / 3 * 4,
        anisotropy: DETAIL.anisotropy, wrapS: DETAIL.wrapS, wrapT: DETAIL.wrapT, minFilter: DETAIL.minFilter,
        magFilter: DETAIL.magFilter, colourSpace: DETAIL.colorSpace, generateMipmaps: DETAIL.generateMipmaps, repeat: DETAIL.repeat.toArray() },
      rows, images, compiled };
  } finally {
    renderer.dispose(); renderer.domElement.remove();
  }
}

const html = `<!doctype html><style>body{margin:0}</style><script type="importmap">${JSON.stringify({ imports: {
  three: '/three/build/three.webgpu.js', 'three/webgpu': '/three/build/three.webgpu.js',
  'three/tsl': '/three/build/three.tsl.js', 'three/addons/': '/three/examples/jsm/',
} })}</script><script type="module">
import * as THREE from 'three/webgpu';
import { texture, positionWorld, vec3 } from 'three/tsl';
import { fillGroundDetailPixels } from '/engine/ground-detail-texture.mjs';
import { createV2GroundMaterialDecorator } from '/engine/material.js';
import { SURFACE } from '/engine/surface.js';
import { DETAIL, baselineAuthored, C, SHADE, PRESETS } from '/fixture.mjs';
(${checkInPage.toString()})().then(result => window.result = result, error => window.result = { error: String(error.stack || error) });
</script>`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node tools/check-detail-texture.mjs --out DIRECTORY');
  const out = path.resolve(args[1]); fs.mkdirSync(out, { recursive: true });
  const allowed = new Set(['geom.js', 'surface.js', 'material.js', 'ground-detail-texture.mjs']);
  const server = http.createServer((req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (name === '/' || name === '/fixture.mjs') {
        res.setHeader('Content-Type', name === '/' ? 'text/html' : 'text/javascript'); res.end(name === '/' ? html : fixture); return;
      }
      let file;
      if (name.startsWith('/engine/') && allowed.has(name.slice(8))) file = path.join(engine, name.slice(8));
      else {
        if (!name.startsWith('/three/')) throw new Error('Unknown file');
        file = fs.realpathSync(path.resolve(threeRoot, name.slice(7)));
        if (!file.startsWith(threeRoot + path.sep)) throw new Error('Outside dependency');
      }
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  let browser; const errors = [];
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 256, height: 192 } });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.text().startsWith('detail-check:')) console.log(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.result, null, { timeout: 150_000 });
    const result = await page.evaluate(() => window.result);
    if (result.error) throw new Error(result.error);
    for (const image of result.images) fs.writeFileSync(path.join(out, `${image.name}.png`), Buffer.from(image.png.split(',')[1], 'base64'));
    delete result.images;
    result.shaders = result.compiled.map((source, i) => {
      fs.writeFileSync(path.join(out, `fragment-${i}.glsl`), source);
      const body = source.slice(source.indexOf('void main()'));
      return { sha256: sha256(source), textureCallSites: [...body.matchAll(/\btexture(?:Lod|Grad)?\s*\(/g)].length };
    });
    delete result.compiled;
    const stats = result.authored;
    const checks = {
      threeR185: result.threeRevision === '185', softwareRenderer: /SwiftShader/i.test(result.renderer),
      disabledExactAuthoredBytes: stats.disabled.rgbaSha256 === stats.legacy.rgbaSha256,
      unchangedBladeAndGlintBytes: result.channelDifferenceCounts.R === 0 && result.channelDifferenceCounts.A === 0,
      calibratedMoments: ['G', 'B'].every(c => Math.abs(stats.candidate.channels[c].mean - stats.legacy.channels[c].mean) < .35
        && Math.abs(stats.candidate.channels[c].std - stats.legacy.channels[c].std) < .1),
      noNewClipping: ['G', 'B'].every(c => stats.candidate.channels[c].clippedLow <= stats.legacy.channels[c].clippedLow
        && stats.candidate.channels[c].clippedHigh <= stats.legacy.channels[c].clippedHigh),
      improvedAuthoredBorderDerivatives: ['G', 'B'].every(c => stats.candidate.mips[0][c].border.mean < stats.legacy.mips[0][c].border.mean * .2),
      normalAuthoredBorderDerivatives: ['G', 'B'].every(c => stats.candidate.mips[0][c].border.mean < stats.candidate.mips[0][c].interior.mean * 2),
      normalMipBorderDerivatives: ['authored', 'canvasSources'].every(source => result[source].candidate.mips.every(mip =>
        ['G', 'B'].every(c => mip[c].border.mean <= mip[c].interior.mean * 2))),
      completeMatrix: result.rows.length === 10,
      unchangedDrawsAndResources: result.rows.every(row => ['drawCalls', 'triangles', 'textures', 'textureBytes', 'attributesBytes', 'indicesBytes'].every(k => row.before[k] === row.after[k])),
      identicalShaderPrograms: result.rows.every(row => row.before.fragmentPrograms === row.after.fragmentPrograms),
      fixedActualBuffer: result.rows.every(row => [row.before, row.after].every(c => c.drawingBuffer[0] === 256 && c.drawingBuffer[1] === 192 && c.pixelRatio === 1)),
      materialChangesPixels: result.rows.every(row => row.comparison.differingPixels > 0), noBrowserErrors: errors.length === 0,
    };
    const report = { evidence: 'Actual baseline and candidate 512² DETAIL CanvasTexture; authored and Canvas readback diagnostics; live v2 class-SDF ground material on a uniform synthetic rough plane, plus explicit G/B diagnostic planes. Fixed SwiftShader WebGL2, noon lights, 256x192, DPR 1. Not full-course, WebGPU, phone hardware, FPS or total application memory evidence.',
      sourceMainBaseline, helperSha256: sha256(fs.readFileSync(path.join(engine, 'ground-detail-texture.mjs'))),
      materialSourceSha256: sha256(fs.readFileSync(path.join(engine, 'material.js'))), baselineGeneratorSha256: sha256(detailSource),
      fixturePaletteSha256: sha256(paletteSource + shadeSource + presetsSource),
      mipMethod: 'CPU 2x2 box averages of quantized authored bytes and separately of Canvas2D readback, with Uint8ClampedArray quantization at every level. Diagnostic approximation, not a GPU mip readback.',
      ...result, errors, checks, passed: Object.values(checks).every(Boolean) };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, checks, rows: result.rows.map(row => ({ id: row.id, comparison: row.comparison })) }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failed-attempt.json'), JSON.stringify({ passed: false, sourceMainBaseline, error: String(error.stack || error), errors }, null, 2) + '\n');
    throw error;
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
