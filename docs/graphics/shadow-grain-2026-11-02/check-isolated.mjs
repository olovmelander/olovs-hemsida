// The grid shadow filter in an isolated low-sun scene (isolated.html): the
// app's own engine/sun-shadow.mjs, drawn with three's noise-turned PCF (the
// before, ?shadowgrid=0) and with the grid at nine and four taps, at the app's
// shadow radius 1 and at 3. Two measurements on the read-back luminance:
//  - grain: a pixel's absolute difference from its 3 x 3 neighbourhood, the
//    per-pixel noise the PCF's rotation leaves without TAA. Read over the whole
//    frame (where geometry's edges dominate both) and over the ground the grid
//    draws smooth (its own difference under half a step), where any grain is
//    the filter's: the share of those pixels over half a step, and their mean;
//  - penumbra: the mean absolute difference between the two filters' images
//    after a 9 x 9 box blur, which stays small when the blur width matches.
// Software rendering by default (shaders are exact there; timings are not),
// BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/shadow-grain-2026-11-02/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/shadow-grain-2026-11-02';
const port = 8761;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
const chrome = process.env.BANVY_CHROME || process.env.BANVY_CHROME_PATH;
const r4 = v => Math.round(v * 10000) / 10000;

/* the target is linear 8-bit; luminance is compared as stored, in 0..1 */
const luma = (px, w, h) => {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  return out;
};
const box = (L, w, h, r) => {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) { s += L[Y * w + X]; n++; }
    }
    out[y * w + x] = s / n;
  }
  return out;
};
const hf = (L, w, h) => { const b = box(L, w, h, 1), out = new Float32Array(L.length); for (let i = 0; i < L.length; i++) out[i] = 255 * Math.abs(L[i] - b[i]); return out; };
const meanOf = a => a.reduce((s, v) => s + v, 0) / a.length;
const lowpassDelta = (A, B, w, h) => { const a = box(A, w, h, 4), b = box(B, w, h, 4); let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return 255 * s / a.length; };
/* over the pixels the reference draws smooth: how many of them a filter leaves grainy, and how grainy */
const grainWhereSmooth = (Hf, smooth) => {
  let n = 0, grainy = 0, sum = 0;
  for (let i = 0; i < Hf.length; i++) if (smooth[i]) { n++; sum += Hf[i]; if (Hf[i] > 0.5) grainy++; }
  return { grainyShare: r4(grainy / n), mean: r4(sum / n) };
};

const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : { channel: 'chrome' }),
  args: [...browserArgs(), '--enable-unsafe-webgpu'] });
const report = { adapter: GPU ? 'gpu' : 'swiftshader', backends: {} };
let failed = false;
try {
  for (const backend of BACKENDS) {
    const page = await browser.newPage({ viewport: { width: 512, height: 288 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}`);
    await page.waitForFunction(() => window.result, null, { timeout: 600000 });
    const result = await page.evaluate(() => window.result);
    await page.close();
    if (result.error) { report.backends[backend] = { error: result.error, errors }; console.log(backend, 'unavailable:', result.error.split('\n')[0]); continue; }
    const by = Object.fromEntries(result.results.map(r => [r.name, r]));
    const L = Object.fromEntries(result.results.map(r => [r.name, luma(r.pixels, r.width, r.height)]));
    const { width: w, height: h } = result.results[0];
    const rows = {};
    for (const radius of ['r1', 'r3']) {
      const H9 = hf(L[`grid9-${radius}`], w, h), smooth = H9.map(v => v < 0.5 ? 1 : 0);
      const Hp = hf(L[`pcf-${radius}`], w, h), H4 = hf(L[`grid4-${radius}`], w, h);
      const g = rows[radius] = {
        wholeFrameGrain: { pcf: r4(meanOf(Hp)), grid9: r4(meanOf(H9)), grid4: r4(meanOf(H4)) },
        smoothGroundShare: r4(meanOf(smooth)),
        grainWhereGridIsSmooth: { pcf: grainWhereSmooth(Hp, smooth), grid4: grainWhereSmooth(H4, smooth) },
        penumbraDelta: { grid9: r4(lowpassDelta(L[`pcf-${radius}`], L[`grid9-${radius}`], w, h)),
          grid4: r4(lowpassDelta(L[`pcf-${radius}`], L[`grid4-${radius}`], w, h)) },
      };
      const gp = g.grainWhereGridIsSmooth;
      /* radius 1 is the app's (three's default; main.js never sets it): there the four-tap grid
         must be at least four times cleaner than the PCF. Radius 3 is a stress row: its taps sit
         1.5 texels apart and step a little, so there it need only be cleaner. */
      const factor = radius === 'r1' ? 4 : 1;
      g.passed = gp.pcf.grainyShare > factor * Math.max(gp.grid4.grainyShare, 0.001)
        && g.penumbraDelta.grid9 <= 1.5 && g.penumbraDelta.grid4 <= 1.5;
      failed ||= !g.passed;
    }
    report.backends[backend] = { errors, rows };
    failed ||= errors.length > 0;
    // pictures: before | grid at nine taps, whole frame and a 4x crop of a penumbra
    const { PNG } = await import('./png.mjs');
    for (const radius of ['r1', 'r3']) {
      const a = by[`pcf-${radius}`].pixels, b = by[`grid9-${radius}`].pixels;
      fs.writeFileSync(`${dir}/${backend}-${radius}.png`, PNG.sideBySide([a, b], w, h,
        { crop: { x: 300, y: 150, w: 96, h: 54, scale: 4 }, flipY: backend === 'webgl2' }));
    }
    console.log(backend, JSON.stringify(rows));
  }
} finally { await browser.close(); server.kill(); }
report.passed = !failed;
fs.writeFileSync(`${dir}/isolated-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'shadow grain: grid filter passes' : 'shadow grain: FAILED');
if (failed) process.exitCode = 1;
