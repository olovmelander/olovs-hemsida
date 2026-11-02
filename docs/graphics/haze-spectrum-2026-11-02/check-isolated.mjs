// The spectral haze in isolated scenes (isolated.html): the app's own aerial
// perspective over ridges of the spruce's darkest pigment at 150 m to 8 km,
// under five painted presets, with ?hazespectrum=0 (the before) and with the
// spectrum. Read back in linear float, before tone mapping:
//  - green is the before's at every distance (the haze as tuned);
//  - blue has gone further into the haze, red less far, at every finite range;
//  - where the haze saturates (blue hour's far ridges, mist's) the difference
//    returns to nothing, so the land still meets the sky's band in the same
//    colour; the clear lights' haze is too thin to saturate within 8 km, and
//    the ceiling at infinity is the unit test's (aerial-perspective.test.mjs).
// Pictures go through a plain ACES-free sRGB encode, before over after.
// Software rendering by default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/haze-spectrum-2026-11-02/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from '../../../tools/browser-args.mjs';
import { encode } from '../shadow-grain-2026-11-02/png.mjs';

const dir = 'docs/graphics/haze-spectrum-2026-11-02';
const port = 8762;
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
    const { width: w, height: h } = result.results[0], n = result.distances.length;
    /* the mean colour of each ridge's band, rows read in the backend's own order */
    const bands = (px, flip) => result.distances.map((d, i) => {
      const yBand = Math.floor((i + 0.5) * h / n), y = flip ? yBand : h - 1 - yBand;
      const s = [0, 0, 0]; let count = 0;
      for (let dy = -6; dy <= 6; dy++) for (let x = 64; x < w - 64; x++) {
        const o = 4 * ((y + dy) * w + x); for (let c = 0; c < 3; c++) s[c] += px[o + c]; count++;
      }
      return s.map(v => v / count);
    });
    const flip = backend === 'webgl2';
    const presets = {};
    for (const name of [...new Set(result.results.map(r => r.name))]) {
      const before = bands(result.results.find(r => r.name === name && !r.spectral).pixels, flip);
      const after = bands(result.results.find(r => r.name === name && r.spectral).pixels, flip);
      const rows = result.distances.map((metres, i) => ({ metres, before: before[i].map(r4), after: after[i].map(r4),
        delta: after[i].map((v, c) => r4(v - before[i][c])) }));
      const greenSame = rows.every(r => Math.abs(r.delta[1]) <= 2e-4);
      const blueAhead = rows.slice(1, -1).every(r => r.delta[2] >= -1e-5 && r.delta[0] <= 1e-5);
      const peakBlue = r4(Math.max(...rows.map(r => r.delta[2]))), farBlue = rows[n - 1].delta[2];
      presets[name] = { rows, greenSame, blueAhead, peakBlue, farBlue };
      failed ||= !(greenSame && blueAhead);
      // the picture: before above after, full frame
      const pick = spectral => result.results.find(r => r.name === name && r.spectral === spectral).pixels;
      const out = new Uint8Array(w * (2 * h + 4) * 4);
      [false, true].forEach((spectral, k) => {
        const px = pick(spectral);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const src = 4 * ((flip ? h - 1 - y : y) * w + x), dst = 4 * ((k * (h + 4) + y) * w + x);
          for (let c = 0; c < 3; c++) out[dst + c] = toSrgb(px[src + c]); out[dst + 3] = 255;
        }
      });
      for (let i = 3; i < out.length; i += 4) out[i] = 255;
      fs.writeFileSync(`${dir}/${backend}-${name}.png`, encode(out, w, 2 * h + 4));
    }
    report.backends[backend] = { errors, presets };
    failed ||= errors.length > 0;
    console.log(backend, Object.entries(presets).map(([k, v]) => `${k}: green ${v.greenSame} blue-ahead ${v.blueAhead} peak +${v.peakBlue} far +${v.farBlue}`).join('; '));
  }
} finally { await browser.close(); server.kill(); }
report.passed = !failed;
fs.writeFileSync(`${dir}/isolated-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'haze spectrum: passes' : 'haze spectrum: FAILED');
if (failed) process.exitCode = 1;
