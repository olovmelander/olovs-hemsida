// The air's motes in an isolated field (isolated.html): the app's own
// engine/air-motes.mjs at det=1, eye 1.7 m up, under four lights with the sun
// 8 degrees up ahead of the eye and behind it, against the same field without
// them (?airmotes=0). Read back in linear float:
//  - each light with motes adds light (and only adds: additive, no pixel darker);
//  - toward a low sun they glow more than with it behind (the sunbeam);
//  - the storm adds nothing, pixel for pixel;
//  - no mote is drawn big: the largest connected patch of added light stays
//    small (the lens fade keeps quads off the camera).
// Pictures: without, golden ahead, golden behind, summer ahead (sRGB, no tone mapping,
// and the motes' light x4 in the lower row to show where they are).
// Software rendering by default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/air-motes-2026-11-02/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from '../../../tools/browser-args.mjs';
import { encode } from '../shadow-grain-2026-11-02/png.mjs';

const dir = 'docs/graphics/air-motes-2026-11-02';
const port = 8763;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
const chrome = process.env.BANVY_CHROME || process.env.BANVY_CHROME_PATH;
const r4 = v => Math.round(v * 10000) / 10000;
const toSrgb = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));

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
    if (result.error) { report.backends[backend] = { error: result.error, errors }; console.log(backend, 'unavailable:', result.error.split('\n')[0]); failed = true; continue; }
    const { width: w, height: h } = result.results[0];
    const base = result.results.find(r => r.name === 'none').pixels;
    const added = px => { const a = new Float32Array(w * h); let darker = 0;
      for (let i = 0; i < w * h; i++) { const d = (px[4 * i] - base[4 * i]) * 0.2126 + (px[4 * i + 1] - base[4 * i + 1]) * 0.7152 + (px[4 * i + 2] - base[4 * i + 2]) * 0.0722; a[i] = d; if (d < -1e-4) darker++; }
      return { a, darker }; };
    /* the largest 4-connected patch of pixels the motes lit by over 1/255 */
    const largestPatch = a => { const seen = new Uint8Array(w * h); let best = 0;
      for (let s = 0; s < w * h; s++) { if (seen[s] || a[s] <= 1 / 255) continue; let n = 0; const stack = [s]; seen[s] = 1;
        while (stack.length) { const i = stack.pop(); n++; const x = i % w, y = (i / w) | 0;
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && a[j] > 1 / 255) { seen[j] = 1; stack.push(j); } }
        best = Math.max(best, n); }
      return best; };
    const rows = {};
    for (const r of result.results.filter(r => r.motes)) {
      const { a, darker } = added(r.pixels);
      let sum = 0, lit = 0; for (const v of a) { if (v > 1 / 255) lit++; sum += Math.max(0, v); }
      rows[r.name] = { kinds: r.snapshot?.kinds, visible: r.snapshot?.visible, addedLight: r4(sum), litPixels: lit, darkerPixels: darker, largestPatch: largestPatch(a) };
    }
    const checks = {
      add: ['golden', 'summer', 'noon'].every(p => rows[`${p}-ahead`].litPixels > 50 && rows[`${p}-behind`].litPixels > 10),
      onlyAdd: Object.values(rows).every(r => r.darkerPixels === 0),
      sunbeam: ['golden', 'summer', 'noon'].every(p => rows[`${p}-ahead`].addedLight > 1.5 * rows[`${p}-behind`].addedLight),
      stormNothing: rows['storm-ahead'].addedLight === 0 && rows['storm-behind'].addedLight === 0,
      small: Object.values(rows).every(r => r.largestPatch <= 400),
    };
    report.backends[backend] = { errors, rows, checks };
    failed ||= errors.length > 0 || !Object.values(checks).every(Boolean);
    const pick = name => result.results.find(r => r.name === name).pixels;
    const frames = ['none', 'golden-ahead', 'golden-behind', 'summer-ahead'].map(pick);
    const out = new Uint8Array(4 * w * 2 * h * 4);
    const W2 = 4 * w;
    frames.forEach((px, k) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const src = 4 * ((backend === 'webgl2' ? h - 1 - y : y) * w + x);
        for (let c = 0; c < 3; c++) {
          out[4 * (y * W2 + k * w + x) + c] = toSrgb(px[src + c]);
          out[4 * ((h + y) * W2 + k * w + x) + c] = toSrgb(base[src + c] + 4 * Math.max(0, px[src + c] - base[src + c]));
        }
      }
    });
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    fs.writeFileSync(`${dir}/${backend}.png`, encode(out, W2, 2 * h));
    console.log(backend, JSON.stringify(checks), JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [v.addedLight, v.litPixels, v.largestPatch]]))));
  }
} finally { await browser.close(); server.kill(); }
report.passed = !failed;
fs.writeFileSync(`${dir}/isolated-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'air motes: passes' : 'air motes: FAILED');
if (failed) process.exitCode = 1;
