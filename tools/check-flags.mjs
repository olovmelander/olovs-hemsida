/* Visual smoke test for the production flag geometry/material and motion.
   node tools/check-flags.mjs [--webgpu] [--motion|--calm-motion|--fold-motion|--wind-motion]
     [--fold-review] [--asset=path/to/cloth.bin] [--out=tools/goldens/flags]
   Set BANVY_CHROME to a current Chromium executable for three.js r186 WebGPU.
   Uses software rendering unless BANVY_GPU=1; timings are not GPU benchmarks.
   A virtual Vite entry keeps the study out of the shipped application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { browserArgs } from './browser-args.mjs';
import { FLAG_CLOTH_ASSET } from '../apps/golf/src/engine/flag-cloth-asset.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = path.join(ROOT, 'apps/golf');
const webgpu = process.argv.includes('--webgpu');
const calmMotion = process.argv.includes('--calm-motion');
const foldMotion = process.argv.includes('--fold-motion');
const windMotion = process.argv.includes('--wind-motion');
const foldReview = process.argv.includes('--fold-review');
const motionReview = process.argv.includes('--motion') || calmMotion || foldMotion || windMotion;
const captureFps = windMotion ? 30 : 10;
const reviewAsset = process.argv.find(a => a.startsWith('--asset='))?.slice(8);
const out = path.resolve(ROOT, process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/flags');
const entry = path.join(APP, 'src/__flag-review.mjs').replaceAll('\\', '/');
const fixture = `
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createFlagMotion, stepFlagMotion, flagBandBlend, flagWindYaw, poseDrawnFlag, turnFlagCloth } from './engine/flag-motion.mjs';
import { FLAG_POLE_PROFILE, createFlagAtlas, createFlagMaterial, createFlagGeometry, anchorFlagHoist, clearFlagPole } from './engine/flag-appearance.mjs';
import { decodeFlagCloth, sampleFlagCloth } from './engine/flag-cloth.mjs';
import { createFlagDynamics, stepFlagDynamics } from './engine/flag-dynamics.mjs';
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
  return { group, mesh, state: createFlagMotion(i+1, data.frames/data.fps), dynamics: createFlagDynamics(data.grid), ms };
});
const config = { from: 270, gust: null, baked: true, deterministic: true };
function draw(dt=1/60) {
  for (const p of pins) {
    const s = stepFlagMotion(p.state, dt, { ms: p.ms, gust: config.gust, yaw: flagWindYaw(config.from) }, config.deterministic);
    p.group.rotation.y = s.yaw+s.swing;
    const geo = p.mesh.geometry, pose = geo.attributes.position.array;
    if (config.baked) {
      const b = flagBandBlend(data, s.ms, s.blend);
      sampleFlagCloth(data,b,s.poseTime,pose,false);
      stepFlagDynamics(data.grid,p.dynamics,pose,s,config.deterministic,clearFlagPole);
    } else {
      poseDrawnFlag(data.grid,s,pose);
      turnFlagCloth(data.grid,s,pose);
      clearFlagPole(data.grid,pose);
    }
    anchorFlagHoist(pose,p.mesh.position); geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  }
  renderer.render(scene,camera);
}
draw();
window.flagReview = {
  backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
  atlas() { return atlas.map.image.toDataURL('image/png').split(',')[1]; },
  set(c) { Object.assign(config,c); if(c.speeds) pins.forEach((p,i)=>p.ms=c.speeds[i]); draw(); },
  async run(frames) {
    for(let i=0;i<frames;i++) {
      draw(1/60);
      // Do not flood a software WebGPU device with a synchronous burst of frames.
      if (renderer.backend.isWebGPUBackend) await renderer.backend.device.queue.onSubmittedWorkDone();
      else await new Promise(requestAnimationFrame);
    }
  },
  close() { camera.position.set(5.48,2.34,1.8); camera.lookAt(5.48,2.25,0); draw(); },
  calmClose() { camera.position.set(5.23,2.02,2.4); camera.lookAt(5.23,2.02,0); draw(); },
  foldView(ms, angle) {
    Object.assign(config,{speeds:[ms,ms,ms,ms],from:270,gust:0,deterministic:true});
    pins.forEach((p,i)=>{p.ms=ms;p.group.visible=i===3;});
    camera.position.set(5.23+2.4*Math.sin(angle),2.08,2.4*Math.cos(angle));
    camera.lookAt(5.23,2.02,0); draw();
  },
  overview() { camera.position.set(2.9,2.2,11); camera.lookAt(2.9,1.55,0); draw(); },
  backlit() { sun.value.set(0.1,0.3,-1).normalize(); light.position.copy(sun.value).multiplyScalar(10); draw(); },
  dusk() { through.value.setRGB(0.02,0.025,0.04); light.intensity=0.05; scene.background.set('#202b38'); draw(); },
  async motionFrames(calm=false,orbit=false,wind=false,fps=10) {
    sun.value.set(-0.4,0.7,0.8).normalize(); light.position.copy(sun.value).multiplyScalar(10);
    through.value.setRGB(1,0.91,0.75); light.intensity=2.6; scene.background.set('#e5eadd');
    camera.position.set(2.55,2.2,8.2); camera.lookAt(2.55,2.1,0);
    if(calm) { camera.position.set(5.23,2.02,2.4); camera.lookAt(5.23,2.02,0); }
    if(wind) { camera.position.set(5.48,2.08,2.8); camera.lookAt(5.48,2.08,0); }
    Object.assign(config,{from:270,gust:0,baked:true,deterministic:false});
    pins.forEach((p,i)=> { p.state=createFlagMotion(i+1,data.frames/data.fps); p.dynamics=createFlagDynamics(data.grid); p.group.visible=!(calm||wind) || i===3; });
    const canvas=document.createElement('canvas'); canvas.width=900; canvas.height=525;
    const ctx=canvas.getContext('2d'), frames=[], images=new Set();
    for(let frame=0;frame<(wind ? 1440 : 1080);frame++) {
      const t=frame/60, rising=Math.max(0,Math.min(1,(t-3)/3));
      if(orbit) {
        const angle=2.9+t*Math.PI*2/18;
        camera.position.set(5.23+2.4*Math.sin(angle),2.08,2.4*Math.cos(angle));camera.lookAt(5.23,2.02,0);
      }
      config.from=wind ? (t<12 ? 270 : 90) : calm || t<6 ? 270 : 90;
      pins.forEach((p,i)=>p.ms=wind ? (t<3 ? 2 : t<6 ? 5 : t<9 ? 8 : t<15 ? 24 : 0)
        : calm ? (t<3 ? 2 : t<6 ? 2*(6-t)/3 : t<12 ? 0 : Math.min(2,(t-12)*2/3))
        : t>=10 ? 0 : [0,2,5,10][i]+[0,4,7,14][i]*rising);
      draw(1/60);
      if(frame%(60/fps)===0) {
        // Capture in the render task: WebGL discards its drawing buffer at the
        // next animation frame. Waiting first silently records stale pixels.
        ctx.clearRect(0,0,900,525);
        ctx.drawImage(renderer.domElement,0,0,900,525);
        images.add(canvas.toDataURL('image/webp',0.6));
        ctx.fillStyle='#203e2c'; ctx.fillRect(0,0,900,38);
        ctx.fillStyle='#fff'; ctx.font='16px system-ui';
        const label=wind ? (t<3 ? 'Gentle breeze' : t<6 ? 'Moderate wind' : t<9 ? 'Strong wind' : t<12 ? 'Storm' : t<15 ? 'Wind reversal' : 'Settling to calm')
          : calm ? (t<3 ? 'Gentle breeze' : t<6 ? 'Wind dropping to calm' : t<12 ? 'Calm' : 'Wind picking up')
          : t<3 ? 'Steady wind' : t<6 ? 'Rising gust' : t<10 ? '180-degree wind reversal' : 'Settling to calm';
        ctx.fillText(label+' — '+t.toFixed(1)+' s',18,25);
        ctx.fillStyle='#203e2c';ctx.font='14px system-ui';
        if(calm||wind) ctx.fillText(pins[3].state.ms.toFixed(2)+' m/s',420,508);
        else pins.forEach((p,i)=>ctx.fillText(p.state.ms.toFixed(1)+' m/s',170+i*173,508));
        frames.push(canvas.toDataURL('image/webp',0.8));
      }
      if(renderer.backend.isWebGPUBackend) await renderer.backend.device.queue.onSubmittedWorkDone();
      else await new Promise(requestAnimationFrame);
    }
    if(images.size<30) throw new Error('Motion capture has frozen or empty frames');
    return frames;
  },
  measure() { return pins.map(p=>({ ms:p.state.ms, yaw:p.state.yaw, phase:p.state.poseTime,
    pinned:Math.hypot(p.mesh.geometry.attributes.position.array[0]+p.mesh.position.x,p.mesh.geometry.attributes.position.array[2]+p.mesh.position.z),
    finite:[...p.mesh.geometry.attributes.position.array,...p.mesh.geometry.attributes.normal.array].every(Number.isFinite) })); }
};
`;
const server = await createServer({ configFile: false, root: APP,
  cacheDir: 'node_modules/.vite-flags', optimizeDeps: { noDiscovery: true, include: ['three/webgpu', 'three/tsl'] },
  server: { port: 0, strictPort: false, host: '127.0.0.1' },
  plugins: [{ name: 'flag-review', resolveId(id) { if (id === '/src/__flag-review.mjs') return entry; },
    load(id) { if (id === entry) return fixture; } }] });
let browser;
try {
  await server.listen(); await fs.mkdir(out, { recursive: true });
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BANVY_CHROME || undefined,
    args: [...browserArgs(), ...(webgpu ? ['--enable-unsafe-webgpu'] : [])] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  if(reviewAsset) await page.route('**/'+FLAG_CLOTH_ASSET.path, route => route.fulfill({ path:path.resolve(ROOT,reviewAsset) }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.route('**/__flag-review.html', route => route.fulfill({ contentType: 'text/html', body:
    '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"><script type="module" src="/src/__flag-review.mjs"></script></body></html>' }));
  await page.goto(`http://127.0.0.1:${port}/__flag-review.html`);
  try { await page.waitForFunction(() => window.flagReview, null, { timeout: 60000 }); }
  catch (error) { throw new Error('Flag renderer did not start: ' + (errors.join('\n') || error.message)); }
  const backend = await page.evaluate(() => window.flagReview.backend);
  await fs.writeFile(path.join(out, 'flag-atlas.png'), Buffer.from(await page.evaluate(() => window.flagReview.atlas()), 'base64'));
  if (backend !== (webgpu ? 'webgpu' : 'webgl2')) throw new Error('Wrong backend: ' + backend);
  await page.screenshot({ path: path.join(out, `${backend}-baked.png`) });
  await page.evaluate(() => window.flagReview.set({ speeds: [0, 1, 2, 4] }));
  await page.screenshot({ path: path.join(out, `${backend}-light-winds.png`) });
  await page.evaluate(() => window.flagReview.set({ speeds: [6, 10, 16, 24] }));
  await page.screenshot({ path: path.join(out, `${backend}-strong-winds.png`) });
  await page.evaluate(() => window.flagReview.set({ speeds: [0, 2, 5, 10] }));
  await page.evaluate(() => window.flagReview.set({ baked: false }));
  await page.screenshot({ path: path.join(out, `${backend}-fallback.png`) });
  await page.evaluate(() => { window.flagReview.set({ baked: true }); window.flagReview.close(); });
  await page.screenshot({ path: path.join(out, `${backend}-detail.png`) });
  await page.evaluate(() => { window.flagReview.set({ speeds: [0,0,0,0] }); window.flagReview.calmClose(); });
  await page.screenshot({ path: path.join(out, `${backend}-calm-detail.png`) });
  if(foldReview) for(const ms of [0,0.5,1.2,2,4]) for(const [view,angle] of [['front',0],['side',1.35],['back',2.9]]) {
    await page.evaluate(({ms,angle})=>window.flagReview.foldView(ms,angle),{ms,angle});
    await page.screenshot({path:path.join(out,backend+'-fold-'+ms+'-'+view+'.png')});
  }
  await page.evaluate(() => { window.flagReview.set({ speeds: [0,2,5,10] }); window.flagReview.close(); });
  await page.evaluate(() => window.flagReview.backlit());
  await page.screenshot({ path: path.join(out, `${backend}-backlit.png`) });
  await page.evaluate(() => window.flagReview.dusk());
  await page.screenshot({ path: path.join(out, `${backend}-dusk.png`) });
  await page.evaluate(async () => { window.flagReview.set({ deterministic: false, gust: 12 }); await window.flagReview.run(360); });
  const before = await page.evaluate(() => window.flagReview.measure());
  await page.evaluate(async () => { window.flagReview.set({ from: 1 }); await window.flagReview.run(30); });
  const after = await page.evaluate(() => window.flagReview.measure());
  // A wind reversal followed by a lull, including the strongest authored band.
  await page.evaluate(async () => { window.flagReview.set({ speeds: [0, 8, 16, 24], from: 181, gust: 28 }); await window.flagReview.run(180); });
  const storm = await page.evaluate(() => window.flagReview.measure());
  await page.evaluate(async () => { window.flagReview.set({ speeds: [0, 0, 0, 0], gust: 0 }); await window.flagReview.run(180); });
  const lull = await page.evaluate(() => window.flagReview.measure());
  if (![...after,...storm,...lull].every(p => p.finite && p.pinned < 0.026)) throw new Error('Non-finite/detached flag');
  if (after.every((p,i) => p.phase === before[i].phase)) throw new Error('Animation did not advance');
  let motionFrames=0;
  if(motionReview) {
    const frames=await page.evaluate(({calm,orbit,wind,fps})=>window.flagReview.motionFrames(calm,orbit,wind,fps),{calm:calmMotion||foldMotion,orbit:foldMotion,wind:windMotion,fps:captureFps});
    motionFrames=frames.length;
    const html='<!doctype html><meta charset="utf-8"><title>Flag wind response</title>'+
      '<style>body{margin:24px;background:#edf0e6;color:#203e2c;font:16px system-ui}main{max-width:900px;margin:auto}img{width:100%;display:block}input{width:75%;vertical-align:middle}button{padding:8px 16px;margin:12px}</style>'+
      '<main><h1>Flag wind response</h1><p>Production cloth and material: '+(windMotion ? 'close view through light, moderate and strong wind, storm, reversal, and calm.' : calmMotion||foldMotion ? 'light wind, settling to calm, then picking up again.' : 'steady wind, rising gust, reversal, then calm.')+(foldMotion ? ' Camera turns through 360 degrees.' : '')+' Captured at '+captureFps+' frames/s.</p><img id="frame" alt="Animated flags in changing wind"><button id="play">Pause</button><input id="seek" type="range" min="0" max="'+(frames.length-1)+'" value="0"><span id="time"></span></main>'+
      '<script>const frames='+JSON.stringify(frames)+',fps='+captureFps+';let n=0,playing=true,last=0,elapsed=0;const img=document.getElementById("frame"),seek=document.getElementById("seek"),play=document.getElementById("play");function show(){img.src=frames[n];seek.value=n;document.getElementById("time").textContent=(n/fps).toFixed(1)+" s"}play.onclick=()=>{playing=!playing;play.textContent=playing?"Pause":"Play";elapsed=0};seek.oninput=()=>{playing=false;play.textContent="Play";n=Number(seek.value);elapsed=0;show()};function tick(t){if(playing&&last){elapsed+=Math.min(100,t-last);const steps=Math.floor(elapsed*fps/1000);if(steps){elapsed-=steps*1000/fps;n=(n+steps)%frames.length;show()}}last=t;requestAnimationFrame(tick)}show();requestAnimationFrame(tick);</script>';
    await fs.writeFile(path.join(out,backend+'-motion.html'),html);
    for(const n of (windMotion ? [0,90,150,240,330,420,480,600,710] : [0,50,65,75,95,125,175])) await fs.writeFile(path.join(out,backend+'-motion-'+n+'.webp'),Buffer.from(frames[n].split(',')[1],'base64'));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(out, `${backend}-result.json`), JSON.stringify({ backend, errors, motionFrames, captureFps:motionReview ? captureFps : 0, asset: FLAG_CLOTH_ASSET, before, after, storm, lull }, null, 2));
  console.log(JSON.stringify({ backend, errors, captures: 8+(foldReview ? 15:0), motionFrames, out }));
} finally {
  await browser?.close(); await server.close();
}
