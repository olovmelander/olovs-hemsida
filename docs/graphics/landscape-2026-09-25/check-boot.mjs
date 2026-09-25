// Boots the built app with the landscape batch and with every before switch, on
// WebGL2 (high and low quality) and WebGPU, and records what each change left
// in the running scene and every page or console error -- a shader that fails
// to compile reports one. States, not pictures (full courses render black in
// software rendering), except the relief the course baked, drawn as a map.
// Run from the repository root after a build:
//   node docs/graphics/landscape-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/landscape-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8691;
const BEFORE = 'standtint=0&surfacegloss=0&surfaceedges=0&groundrelief=0';
/* WebGPU on the real adapter only: in software rendering the full app never
   finished loading on WebGPU in this container, with or without these changes
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
      /* the far trees' tints: one plain white before, the stands' washes after */
      const reds = [];
      scene.traverse(o => { if (o.userData?.tag === 'vista' && o.geometry?.getAttribute?.('aTint')) {
        const t = o.geometry.getAttribute('aTint').array;
        for (let i = 0; i < Math.min(o.geometry.instanceCount, 20000); i++) reds.push(t[i * 4]);
      } });
      const mean = reds.reduce((a, v) => a + v, 0) / Math.max(1, reds.length);
      const spread = Math.sqrt(reds.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, reds.length));
      /* the relief the ground tint baked, in its alpha: 128 open, lower sheltered, higher exposed */
      const tint = V3D.groundTint(), relief = {};
      for (const name of ['near', 'far']) {
        const data = tint[name];
        let sheltered = 0, exposed = 0, sum = 0, n = 0;
        for (let k = 3; k < data.length; k += 4) { const s = (data[k] - 128) / 127; sum += s; n++; if (s < -0.1) sheltered++; else if (s > 0.1) exposed++; }
        relief[name] = { mean: Math.round(sum / n * 1000) / 1000, sheltered: Math.round(sheltered / n * 1000) / 1000, exposed: Math.round(exposed / n * 1000) / 1000 };
      }
      return {
        backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2', preset: V3D.atmosphere().preset,
        vistaTint: { trees: reds.length, mean: Math.round(mean * 1000) / 1000, spread: Math.round(spread * 1000) / 1000 }, relief,
        tiersAudit: V3D.treeTierAudit().ok, frame: V3D.frame(),
      };
    });
    if (run.q === 'hi' && !run.variant && run.backend === 'webgl2') {
      /* the near raster's relief as a map: sheltered blue-dark, open grey, exposed straw */
      const png = await page.evaluate(() => {
        const data = V3D.groundTint().near, n = Math.round(Math.sqrt(data.length / 4)), c = document.createElement('canvas');
        c.width = c.height = n;
        const g = c.getContext('2d'), img = g.createImageData(n, n);
        for (let k = 0; k < n * n; k++) {
          const s = (data[k * 4 + 3] - 128) / 127, o = k * 4;
          const base = [data[o], data[o + 1], data[o + 2]].map(v => v * 0.35 + 90);
          const tone = s < 0 ? [40, 60, 120] : [235, 205, 120], w = Math.min(1, Math.abs(s) * 1.4);
          for (let ch = 0; ch < 3; ch++) img.data[o + ch] = base[ch] * (1 - w) + tone[ch] * w;
          img.data[o + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c.toDataURL('image/png').split(',')[1];
      });
      fs.writeFileSync(`${dir}/relief-angso-near.png`, Buffer.from(png, 'base64'));
    }
    await browser.close();
    const row = { ...run, variant: run.variant ? 'before' : 'fixed', ...state, errors };
    rows.push(row);
    if (errors.length || !state.tiersAudit) failed = true;
    /* the stands reach the far trees, and the before keeps them plain */
    if (run.variant ? state.vistaTint.spread !== 0 : !(state.vistaTint.spread > 0.05)) failed = true;
    /* the relief is baked whatever the switch: the switch only stops the material reading it */
    if (!(state.relief.near.sheltered > 0.02 && state.relief.near.exposed > 0.01)) failed = true;
    console.log(JSON.stringify(row));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
