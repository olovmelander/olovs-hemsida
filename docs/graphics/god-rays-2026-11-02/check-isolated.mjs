// God rays in an isolated scene (isolated.html): the app's own engine/god-rays.mjs
// and sun-shadow filter, a band of wood between the eye and a sun 7 degrees up,
// through a 4x MSAA scene pass and the shafts' composite, on WebGL2, WebGPU and
// WebGPU with reversed depth (the app's WebGPU default). The shafts' light is
// each shot less the same shot with them off (?godrays=0), in linear float:
//  - toward the sun they add light, and only add;
//  - with the sun behind the eye they add far less (forward scatter);
//  - the storm adds nothing, and its march is not run;
//  - through the wood the light comes in beams and gaps: its variation along a
//    row of air over the ground is several times the open field's, whose lit
//    air is the same everywhere;
//  - the three backends draw the same shafts.
// Pictures: without, with, and the shafts' light x4, through a plain sRGB
// encode (no tone mapping): wood toward the sun, wood away, the open field.
// Software rendering by default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/god-rays-2026-11-02/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from '../../../tools/browser-args.mjs';
import { encode } from '../shadow-grain-2026-11-02/png.mjs';

const dir = 'docs/graphics/god-rays-2026-11-02';
const port = 8765;
const CONFIGS = (process.env.BANVY_CONFIGS || 'webgl2,webgpu,webgpu-rdepth').split(',');
const chrome = process.env.BANVY_CHROME || process.env.BANVY_CHROME_PATH;
const r4 = v => Math.round(v * 10000) / 10000;
const toSrgb = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));

const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : { channel: 'chrome' }),
  args: [...browserArgs(), '--enable-unsafe-webgpu'] });
const report = { adapter: GPU ? 'gpu' : 'swiftshader', configs: {} };
const rayMaps = {};
let failed = false;
try {
  for (const config of CONFIGS) {
    const [backend, rdepth] = config.split('-');
    const page = await browser.newPage({ viewport: { width: 512, height: 288 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}&rdepth=${rdepth ? 1 : 0}`);
    await page.waitForFunction(() => window.result, null, { timeout: 900000 });
    const result = await page.evaluate(() => window.result);
    await page.close();
    if (result.error) { report.configs[config] = { error: result.error, errors }; console.log(config, 'error:', result.error.split('\n')[0]); failed = true; continue; }
    const { width: w, height: h } = result;
    const flip = backend === 'webgl2';
    /* luminance in top-down rows */
    const luma = px => { const L = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = 4 * ((flip ? h - 1 - y : y) * w + x); L[y * w + x] = 0.2126 * px[s] + 0.7152 * px[s + 1] + 0.0722 * px[s + 2]; }
      return L; };
    const raysOf = (set, name) => { const a = luma(set[name].pixels), b = luma(set[name + '-without'].pixels); return a.map((v, i) => v - b[i]); };
    const sum = R => R.reduce((s, v) => s + Math.max(0, v), 0);
    const negative = R => R.filter(v => v < -1e-4).length;
    /* beams and gaps: the mean step between pixels 4 apart along rows of the air just above the
       ground in front of the wood, against the mean light there */
    const variation = R => { let d = 0, m = 0, n = 0;
      for (let y = Math.round(h * 0.42); y < Math.round(h * 0.62); y++) for (let x = 0; x + 4 < w; x++) { d += Math.abs(R[y * w + x + 4] - R[y * w + x]); m += Math.max(0, R[y * w + x]); n++; }
      return d / Math.max(m, 1e-9); };
    const wood = { ahead: raysOf(result.wood, 'golden-ahead'), behind: raysOf(result.wood, 'golden-behind'), storm: raysOf(result.wood, 'storm-ahead') };
    const open = raysOf(result.open, 'golden-ahead');
    rayMaps[config] = wood.ahead;
    const rows = {
      added: { woodAhead: r4(sum(wood.ahead)), woodBehind: r4(sum(wood.behind)), storm: r4(sum(wood.storm)), openAhead: r4(sum(open)) },
      negativePixels: negative(wood.ahead) + negative(wood.behind) + negative(open),
      stormMarchRun: result.wood['storm-ahead'].active,
      variation: { wood: r4(variation(wood.ahead)), open: r4(variation(open)) },
    };
    const checks = {
      adds: rows.added.woodAhead > 50 && rows.negativePixels === 0,
      forwardScatter: rows.added.woodAhead > 3 * rows.added.woodBehind,
      stormNothing: rows.added.storm === 0 && rows.stormMarchRun === false,
      beams: rows.variation.wood > 2 * rows.variation.open,
      noErrors: errors.length === 0,
    };
    report.configs[config] = { rows, checks, errors };
    failed ||= !Object.values(checks).every(Boolean);
    console.log(config, JSON.stringify(checks), JSON.stringify(rows));
    /* the picture */
    const frames = [['wood', 'golden-ahead'], ['wood', 'golden-behind'], ['open', 'golden-ahead']];
    const out = new Uint8Array(3 * w * frames.length * h * 4), W3 = 3 * w;
    frames.forEach(([set, name], row) => {
      const withPx = result[set][name].pixels, withoutPx = result[set][name + '-without'].pixels;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = 4 * ((flip ? h - 1 - y : y) * w + x);
        for (let c = 0; c < 3; c++) {
          const o = (k, v) => { out[4 * ((row * h + y) * W3 + k * w + x) + c] = toSrgb(v); };
          o(0, withoutPx[s + c]); o(1, withPx[s + c]); o(2, 4 * Math.max(0, withPx[s + c] - withoutPx[s + c]));
        }
      }
    });
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    fs.writeFileSync(`${dir}/${config}.png`, encode(out, W3, frames.length * h));
  }
  /* the backends agree */
  const names = Object.keys(rayMaps);
  report.agreement = {};
  for (let i = 1; i < names.length; i++) {
    const a = rayMaps[names[0]], b = rayMaps[names[i]];
    let d = 0, m = 0; for (let k = 0; k < a.length; k++) { d += Math.abs(a[k] - b[k]); m += Math.abs(a[k]); }
    const relative = r4(d / Math.max(m, 1e-9));
    report.agreement[`${names[0]} vs ${names[i]}`] = relative;
    failed ||= relative > 0.15;
  }
  console.log('agreement', JSON.stringify(report.agreement));
} finally { await browser.close(); server.kill(); }
report.passed = !failed;
fs.writeFileSync(`${dir}/isolated-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'god rays: passes' : 'god rays: FAILED');
if (failed) process.exitCode = 1;
