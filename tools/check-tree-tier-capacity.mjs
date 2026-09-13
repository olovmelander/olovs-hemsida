#!/usr/bin/env node
// GPU growth/reversal gate: identical crossfade pixels and bounded repeated use.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:8635';
const out = path.resolve(flag('out', 'tools/reference/tree-tier-capacity'));
const backend = flag('backend', 'webgpu');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const report = { backend, runs: [], images: [], errors: [] }, originals = [];
const steps = [[4, 20], [2, 21], [4, 21.12], [1, 22], [3, 23], [4, 24]];
try {
  for (const startup of ['0', '1']) {
    const page = await browser.newPage({ viewport: { width: 700, height: 500 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()) && /GL_INVALID|validation error|GPUValidationError|shader.*error|pipeline.*error|buffer.*destroyed/i.test(message.text())) errors.push(message.text());
    });
    try {
      const query = new URLSearchParams({ bana: flag('course', 'veckefjarden'), q: 'lo', ghibli: flag('look', '1'),
        startup, gl: backend === 'webgl2' ? '1' : '0', det: '1', qualitylock: '1', v2: 'require', hal: '1', vy: 'tee', ren: '1' });
      await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('#boot.done', { timeout: 180000 });
      assert.equal(await page.evaluate(() => V3D.v2Terrain().backend), backend);
      await page.waitForFunction(() => V3D.settled() && !V3D.v2Terrain().adapter.stream.loadingTiles);
      const initial = await page.evaluate(() => V3D.treeTierAllocation());
      await page.evaluate(() => { V3D.driveTreeFadeClock(true); V3D.setTreeFade(.3); });
      for (let i = 0; i < steps.length; i++) {
        const frame = await page.evaluate(([tier, clock]) => { V3D.setTreeFadeClock(clock); V3D.setTreeLod(tier); return V3D.frame(); }, steps[i]);
        await page.waitForFunction(frame => V3D.frame() >= frame + 3, frame, { timeout: 120000 });
        assert.equal(await page.evaluate(() => V3D.treeTierAudit().ok), true);
        const png = backend === 'webgpu' ? Buffer.from((await page.evaluate(() => V3D.captureReadback())).base64, 'base64')
          : await page.locator('body > canvas').screenshot();
        await fs.writeFile(path.join(out, `${startup}-${i}.png`), png);
        const decoded = decodePNG(png);
        if (startup === '0') originals.push(decoded);
        else {
          const a = originals[i]; let sum = 0, max = 0, changed = 0;
          assert.equal(a.data.length, decoded.data.length);
          for (let p = 0; p < a.data.length; p += a.channels) {
            let pixel = 0;
            for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[p + c] - decoded.data[p + c]); sum += d; pixel = Math.max(pixel, d); }
            max = Math.max(max, pixel); if (pixel > 8) changed++;
          }
          const delta = { step: steps[i], max, fractionOver8: changed / (a.width * a.height), mean: sum / (a.width * a.height * 3) };
          report.images.push(delta);
          assert.ok(delta.fractionOver8 <= .005 && delta.mean <= .5, JSON.stringify(delta));
        }
      }
      const cycles = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.evaluate(() => V3D.setTreeFade(0));
        for (const tier of [1, 2, 3, 4]) {
          const frame = await page.evaluate(tier => { V3D.setTreeFadeClock(30); V3D.setTreeLod(tier); return V3D.frame(); }, tier);
          await page.waitForFunction(frame => V3D.frame() >= frame + 3, frame, { timeout: 120000 });
          assert.equal(await page.evaluate(() => V3D.treeTierAudit().ok), true);
        }
        cycles.push(await page.evaluate(() => ({ allocation: V3D.treeTierAllocation(), memory: V3D.rendererInfo().memory })));
      }
      assert.deepEqual(cycles[2], cycles[1], 'repeating warmed detail tiers must not allocate more resources');
      if (startup === '1') assert.ok(initial.drawableBytes < report.runs[0].initial.drawableBytes * .8, 'drawable allocation should be materially smaller');
      assert.deepEqual(errors, []);
      report.runs.push({ startup, initial, cycles });
      console.log(`startup=${startup}: crossfade growth, reversal and repeated GPU lifetime checks passed`);
    } finally { await page.close(); }
  }
} catch (error) { report.errors.push(error.stack); }
finally { await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ images: report.images, errors: report.errors }));
if (report.errors.length) process.exitCode = 1;
