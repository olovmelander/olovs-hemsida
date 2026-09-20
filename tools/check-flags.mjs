/* Visual smoke test for the production flag geometry/material and motion.
   node tools/check-flags.mjs [--webgpu] [--out=tools/goldens/flags]
   Set BANVY_CHROME to a current Chromium executable for three.js r186 WebGPU.
   Uses software rendering unless BANVY_GPU=1; timings are not GPU benchmarks.
   A virtual Vite entry keeps the study out of the shipped application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { browserArgs } from './browser-args.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = path.join(ROOT, 'apps/golf');
const webgpu = process.argv.includes('--webgpu');
const out = path.resolve(ROOT, process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/flags');
const entry = path.join(APP, 'src/__flag-review.mjs');
const fixture = `
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createFlagMotion, stepFlagMotion, flagBandBlend, flagWindYaw, poseDrawnFlag } from './engine/flag-motion.mjs';
import { FLAG_GRID, FLAG_POLE_PROFILE, createFlagAtlas, createFlagMaterial, createFlagGeometry, anchorFlagHoist } from './engine/flag-appearance.mjs';
import { decodeFlagCloth, accumulateFlagClothPose } from './engine/flag-cloth.mjs';
import { FLAG_CLOTH_ASSET } from './engine/flag-cloth-asset.mjs';
import { inflate } from './engine/codec.js';
const data = await decodeFlagCloth(await (await fetch('/'+FLAG_CLOTH_ASSET.path)).arrayBuffer(), inflate);
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: ${!webgpu} });
renderer.setSize(1200, 700); renderer.setPixelRatio(1);
await renderer.init(); document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#e5eadd');
const camera = new THREE.PerspectiveCamera(35, 1200/700, 0.05, 50);
camera.position.set(2.9, 2.2, 11); camera.lookAt(2.9, 1.55, 0);
const sun = uniform(new THREE.Vector3(-0.4, 0.7, 0.8).normalize());
const through = uniform(new THREE.Color(1, 0.91, 0.75));
scene.add(new THREE.HemisphereLight('#eaf3ff', '#586248', 2));
const light = new THREE.DirectionalLight('#fff1d0', 2.6); light.position.copy(sun.value).multiplyScalar(10); scene.add(light);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardNodeMaterial({ color: '#66835c', roughness: 1 }));
floor.rotation.x = -Math.PI/2; floor.position.y = -0.02; scene.add(floor);
const atlas = createFlagAtlas([1, 2, 3, 18]), mat = createFlagMaterial(atlas, sun, through);
const poleGeo = new THREE.LatheGeometry(FLAG_POLE_PROFILE.map(([r,y]) => new THREE.Vector2(r,y)), 10);
const poleMat = new THREE.MeshStandardNodeMaterial({ color: '#f2f4f2', metalness: 0.5, roughness: 0.35 });
const pins = [0, 2, 5, 10].map((ms, i) => {
  const group = new THREE.Group(); group.position.x = i*1.7; scene.add(group);
  const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 1.3; group.add(pole);
  const mesh = new THREE.Mesh(createFlagGeometry(data.grid, atlas, i), mat); group.add(mesh);
  return { group, mesh, state: createFlagMotion(i+1), ms };
});
const config = { from: 270, gust: null, baked: true, deterministic: true };
function draw(dt=1/60) {
  for (const p of pins) {
    const s = stepFlagMotion(p.state, dt, { ms: p.ms, gust: config.gust, yaw: flagWindYaw(config.from) }, config.deterministic);
    p.group.rotation.y = s.yaw+s.swing;
    const geo = p.mesh.geometry, pose = geo.attributes.position.array;
    if (config.baked) {
      const b = flagBandBlend(data, s.ms, s.blend); pose.fill(0);
      accumulateFlagClothPose(data,b.lo,s.poseTime,1-b.weight,pose);
      accumulateFlagClothPose(data,b.hi,s.poseTime,b.weight,pose);
    } else poseDrawnFlag(FLAG_GRID,s,pose);
    anchorFlagHoist(pose,p.mesh.position); geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  }
  renderer.render(scene,camera);
}
draw();
window.flagReview = {
  backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
  set(c) { Object.assign(config,c); draw(); },
  async run(frames) {
    for(let i=0;i<frames;i++) {
      draw(1/60);
      // Do not flood a software WebGPU device with a synchronous burst of frames.
      if (renderer.backend.isWebGPUBackend) await renderer.backend.device.queue.onSubmittedWorkDone();
      else await new Promise(requestAnimationFrame);
    }
  },
  close() { camera.position.set(5.48,2.34,1.8); camera.lookAt(5.48,2.25,0); draw(); },
  backlit() { sun.value.set(0.1,0.3,-1).normalize(); light.position.copy(sun.value).multiplyScalar(10); draw(); },
  dusk() { through.value.setRGB(0.02,0.025,0.04); light.intensity=0.05; scene.background.set('#202b38'); draw(); },
  measure() { return pins.map(p=>({ ms:p.state.ms, yaw:p.state.yaw, phase:p.state.poseTime,
    pinned:Math.hypot(p.mesh.geometry.attributes.position.array[0]+p.mesh.position.x,p.mesh.geometry.attributes.position.array[2]+p.mesh.position.z),
    finite:[...p.mesh.geometry.attributes.position.array,...p.mesh.geometry.attributes.normal.array].every(Number.isFinite) })); }
};
`;
const server = await createServer({ root: APP, server: { port: 0, strictPort: false, host: '127.0.0.1' },
  plugins: [{ name: 'flag-review', resolveId(id) { if (id === '/src/__flag-review.mjs') return entry; },
    load(id) { if (id === entry) return fixture; } }] });
let browser;
try {
  await server.listen(); await fs.mkdir(out, { recursive: true });
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BANVY_CHROME || undefined,
    args: [...browserArgs(), ...(webgpu ? ['--enable-unsafe-webgpu'] : [])] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__flag-review.html', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body style="margin:0"><script type="module" src="/src/__flag-review.mjs"></script></body></html>' }));
  await page.goto(`http://127.0.0.1:${port}/__flag-review.html`);
  try { await page.waitForFunction(() => window.flagReview, null, { timeout: 60000 }); }
  catch (error) { throw new Error('Flag renderer did not start: ' + (errors.join('\n') || error.message)); }
  const backend = await page.evaluate(() => window.flagReview.backend);
  if (backend !== (webgpu ? 'webgpu' : 'webgl2')) throw new Error('Wrong backend: ' + backend);
  await page.screenshot({ path: path.join(out, `${backend}-baked.png`) });
  await page.evaluate(() => window.flagReview.set({ baked: false }));
  await page.screenshot({ path: path.join(out, `${backend}-fallback.png`) });
  await page.evaluate(() => { window.flagReview.set({ baked: true }); window.flagReview.close(); });
  await page.screenshot({ path: path.join(out, `${backend}-detail.png`) });
  await page.evaluate(() => window.flagReview.backlit());
  await page.screenshot({ path: path.join(out, `${backend}-backlit.png`) });
  await page.evaluate(() => window.flagReview.dusk());
  await page.screenshot({ path: path.join(out, `${backend}-dusk.png`) });
  await page.evaluate(async () => { window.flagReview.set({ deterministic: false, gust: 12 }); await window.flagReview.run(90); });
  const before = await page.evaluate(() => window.flagReview.measure());
  await page.evaluate(async () => { window.flagReview.set({ from: 1 }); await window.flagReview.run(30); });
  const after = await page.evaluate(() => window.flagReview.measure());
  if (!after.every(p => p.finite && p.pinned < 0.026)) throw new Error('Non-finite/detached flag');
  if (after.every((p,i) => p.phase === before[i].phase)) throw new Error('Animation did not advance');
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(out, `${backend}-result.json`), JSON.stringify({ backend, errors, before, after }, null, 2));
  console.log(JSON.stringify({ backend, errors, captures: 5, out }));
} finally {
  await browser?.close(); await server.close();
}
