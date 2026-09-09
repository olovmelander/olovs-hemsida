#!/usr/bin/env node
/* Exercise production resolution changes with a real Three renderer on each
   backend. The frame intervals below are simulated control inputs, never FPS
   measurements. Synthetic silhouettes isolate sampling from course mapping. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from '../apps/golf/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) =>
  [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
const backend = args.backend || 'webgl2';
if (!args.out || !['webgl2', 'webgpu'].includes(backend)) throw Error('--out DIR --backend webgl2|webgpu [--chrome PATH]');
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-resolution-'));
fs.writeFileSync(path.join(tmp, 'index.html'), '<html><body style="margin:0"><script type="module" src="/proof.mjs"></script></body></html>');
fs.writeFileSync(path.join(tmp, 'proof.mjs'), `
import * as THREE from 'three/webgpu';
import {createRenderResolution} from ${JSON.stringify(path.join(root, 'apps/golf/src/engine/render-resolution.mjs'))};
const renderer = new THREE.WebGPURenderer({forceWebGL:${backend === 'webgl2'}, antialias:true, samples:4,
  outputBufferType:THREE.HalfFloatType, reversedDepthBuffer:true});
await renderer.init();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb7d5d9);
const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 1000);
camera.position.set(70,90,150); camera.lookAt(0,0,0);
const material = color => new THREE.MeshBasicNodeMaterial({color});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(500,500).rotateX(-Math.PI/2),material(0x3e6730)); scene.add(ground);
const sand = new THREE.Mesh(new THREE.CircleGeometry(22,80).rotateX(-Math.PI/2),material(0xe5d2a4));
sand.position.set(30,.1,-10); scene.add(sand);
const pathMat = material(0xafa991), trunkMat = material(0x665143), crownMat = material(0x1e4b31);
for(let i=0;i<32;i++) {
 const line = new THREE.Mesh(new THREE.BoxGeometry(.35, .05, 140),pathMat);
 line.position.set(-45+i*3,.15,-20); line.rotation.y=.32; scene.add(line);
}
for(let i=0;i<14;i++) {
 const x=-90+i*13,z=-55-Math.sin(i*2.1)*12;
 const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35,.5,12,6),trunkMat); trunk.position.set(x,6,z); scene.add(trunk);
 const crown = new THREE.Mesh(new THREE.ConeGeometry(4+i%3,17,9),crownMat); crown.position.set(x,16,z); scene.add(crown);
}
let control, now=0;
const make = options => createRenderResolution({renderer,lowQuality:true,adaptive:true,width:480,height:320,devicePixelRatio:2,...options});
control=make({});
function run(ms, interval) { const end=now+ms; while(now<end){now+=interval;control.sample(interval,now,true);} }
const copy=document.createElement('canvas'); copy.width=960;copy.height=640;
const ctx=copy.getContext('2d',{willReadFrequently:true});
function render() {
 renderer.render(scene,camera);
 ctx.drawImage(renderer.domElement,0,0,960,640);
 return {resolution:control.snapshot(), detailHeight:control.detailHeight(),
   buffer:[renderer.domElement.width,renderer.domElement.height],
   triangles:renderer.info.render.triangles, draws:renderer.info.render.drawCalls,
   pixels:new Uint8Array(ctx.getImageData(0,0,960,640).data)};
}
let reference,baseline;
window.P={backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2',
 capture(mode){
  if(mode==='reference') control=make({lowQuality:false,requested:2});
  if(mode==='baseline') {control=make({});now=0;}
  if(mode==='boosted') run(25_000,1000/60);
  if(mode==='recovered') run(10_000,50);
  const row=render(), pixels=row.pixels;delete row.pixels;
  if(mode==='reference') reference=pixels;
  if(mode==='baseline') baseline=pixels;
  let error=0, restored=true;
  for(let i=0;i<pixels.length;i++) {error+=Math.abs(pixels[i]-reference[i]); if(baseline&&pixels[i]!==baseline[i])restored=false;}
  return {mode,...row,meanAbsoluteErrorToDpr2:error/pixels.length,baselinePixelsRestored:restored};
 },
 resize(){control.resize(320,480,2,now);camera.aspect=320/480;camera.updateProjectionMatrix();return render().buffer;}
};
document.body.dataset.ready='1';
`);
const three = path.join(root, 'apps/golf/node_modules/three/build');
await build({ configFile: false, root: tmp, base: './', logLevel: 'error', resolve: { alias: [
  { find: 'three/webgpu', replacement: path.join(three, 'three.webgpu.js') },
  { find: 'three', replacement: path.join(three, 'three.module.js') },
] }, build: { outDir: path.join(tmp, 'dist'), emptyOutDir: true } });
const dist = path.join(tmp, 'dist');
const server = http.createServer((req, res) => {
  const file = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = { backend, executionAdapter: 'swiftshader-software', performanceEvidence: false,
  frameInputs: 'simulated 60 FPS then 20 FPS; synthetic scene', errors: [], views: [], passed: false };
let browser;
try {
  const flags = ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (backend === 'webgpu') flags.push('--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
    '--enable-experimental-web-platform-features', '--use-gpu-in-tests', '--enable-features=UseSkiaRenderer,Vulkan',
    '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface');
  browser = await chromium.launch({ executablePath: args.chrome, headless: true, args: flags });
  const page = await browser.newPage({ viewport: { width: 480, height: 320 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 120_000 });
  if (await page.evaluate(() => P.backend) !== backend) throw Error('Unexpected backend');
  for (const mode of ['reference', 'baseline', 'boosted', 'recovered']) {
    const row = await page.evaluate(mode => P.capture(mode), mode);
    await page.screenshot({ path: path.join(out, mode + '.png') });
    report.views.push(row);
  }
  const [, baseline, boosted, recovered] = report.views;
  if (JSON.stringify(baseline.buffer) !== '[480,320]' || JSON.stringify(boosted.buffer) !== '[720,480]') throw Error('Resolution did not change as expected');
  if (boosted.detailHeight !== baseline.detailHeight || boosted.triangles !== baseline.triangles || boosted.draws !== baseline.draws) throw Error('Resolution changed scene complexity');
  if (!(boosted.meanAbsoluteErrorToDpr2 < baseline.meanAbsoluteErrorToDpr2 * .85)) throw Error('No measurable sampling improvement against the DPR-2 reference');
  if (!recovered.baselinePixelsRestored) throw Error('Returning to baseline did not restore its pixels');
  report.portraitBuffer = await page.evaluate(() => P.resize());
  if (JSON.stringify(report.portraitBuffer) !== '[320,480]') throw Error('Portrait resize failed');
  report.passed = report.errors.length === 0;
} catch (error) { report.errors.push(String(error.stack || error)); }
finally {
  await browser?.close();
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log((report.passed ? 'PASS ' : 'FAIL ') + path.join(out, 'report.json'));
if (!report.passed) process.exitCode = 1;
