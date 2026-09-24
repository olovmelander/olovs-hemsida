// Boots the built app with the visual fixes and with every before switch, on
// WebGL2 (high and low quality) and WebGPU, and records what each fix left in
// the running scene and every page or console error -- a shader that fails to
// compile reports one. Counts and states, not pictures: full courses render
// black in software rendering. Run from the repository root after a build:
//   node docs/graphics/visual-fixes-2026-09-24/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/visual-fixes-2026-09-24';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8675;
const BEFORE = 'detailupload=canvas&mowfade=iso&localheight=0&coverglow=always&pondfetch=lake&waternormal=legacy'
  + '&dither=0&bloomknee=hard&skyhaze=raw&skyorder=first&furnitureshadow=0';
/* WebGPU on the real adapter only: in software rendering the full app never
   finished loading on WebGPU in this container, with or without these fixes
   (main's own build too); isolated.html compiles the changed shaders there */
const RUNS = [
  { backend: 'webgl2', q: 'hi', variant: '' },
  { backend: 'webgl2', q: 'lo', variant: '' },
  { backend: 'webgl2', q: 'hi', variant: BEFORE },
  ...(GPU ? [{ backend: 'webgpu', q: 'hi', variant: '' }] : []),
];
const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [];
let failed = false;
try {
  for (const run of RUNS) {
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(run.backend) });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=angso&v2=require&ghibli=1&q=${run.q}&qualitylock=1${run.backend === 'webgl2' ? '&gl=1' : ''}`
      + `&det=1&hal=1&vy=tee&ljus=kvall${run.variant ? '&' + run.variant : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    const state = await page.evaluate(() => {
      const { scene, renderer } = V3D.harness();
      const sky = scene.getObjectByName('atmospheric-sky');
      const furniture = [];
      scene.traverse(o => { if (o.isInstancedMesh && ['pins', 'markers', 'plates'].includes(o.userData.tag)) furniture.push(o.receiveShadow); });
      return {
        backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
        toneMapping: renderer.toneMapping, skyOrder: sky?.renderOrder ?? null,
        bloomKnee: renderer.__bloomNode ? renderer.__bloomNode.smoothWidth.value : null,
        furnitureReceives: furniture,
        /* the sky's band under the horizon against the fog the ground fades into */
        skyHaze: V3D.atmosphere().groundHaze, fogColour: V3D.atmosphere().aerialPerspective.colour,
        tiersAudit: V3D.treeTierAudit().ok, frame: V3D.frame(),
      };
    });
    await browser.close();
    const row = { ...run, variant: run.variant ? 'before' : 'fixed', ...state, errors };
    rows.push(row);
    if (errors.length || !state.tiersAudit) failed = true;
    console.log(JSON.stringify(row));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
