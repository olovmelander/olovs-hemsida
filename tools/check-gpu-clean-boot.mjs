#!/usr/bin/env node
/* Every course boots on the real adapter with a clean console.
 *
 * node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/check-gpu-clean-boot.mjs [--course slug[,slug]] [--backend webgpu|webgl2|both] [--quality hi|lo]
 *                                                  [--query a=b&c=d] [--out report.json]
 *
 * Written on 2 November, when the first boot on an RTX 5080 found what the
 * container's SwiftShader never showed: four concurrent compileAsync calls
 * clobbering r187's one precompilation state (no course booted on WebGPU), and
 * the distant-hero impostor reaching 17 vertex outputs against the device's 16
 * (its pipelines failed and their command buffers were dropped every frame).
 *
 * A course fails on a boot error, any console error, any uncaptured WebGPU
 * validation error, or a vertex shader with more than MAX_OUTPUTS outputs: a
 * hook on GPUDevice.createShaderModule counts each vertex stage's @location
 * outputs, so a material creeping toward the limit fails here, with a margin,
 * before it fails on someone's GPU. The limit is WebGPU's default (16); phones
 * report the same.                                                          */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = flag('base', 'http://127.0.0.1:8620').replace(/\/$/, '');
const QUERY = flag('query', '');
const OUT = flag('out', null);
const MAX_OUTPUTS = +flag('max-outputs', 15);
const QUALITY = flag('quality', 'hi');
const backendFlag = flag('backend', 'both');
const backends = backendFlag === 'both' ? ['webgpu', 'webgl2'] : [backendFlag];
const manifest = JSON.parse(fs.readFileSync(new URL('../apps/golf/public/courses/index.json', import.meta.url)));
const courses = flag('course', null)?.split(',') ?? manifest.courses.map(c => c.slug);
if (!GPU) console.warn('WARN: BANVY_GPU is not 1; this is a SwiftShader run');

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const rows = [];
let failed = 0;
for (const backend of backends) {
  for (const slug of courses) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await page.addInitScript(() => {
      window.__vertexOutputs = { max: 0, label: null };
      if (!('GPUDevice' in window)) return;
      const original = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        const code = descriptor?.code || '';
        if (code.includes('@vertex')) {
          const struct = code.match(/struct VaryingsStruct \{([\s\S]*?)\}/);
          const n = struct ? (struct[1].match(/@location/g) || []).length : 0;
          if (n > window.__vertexOutputs.max) window.__vertexOutputs = { max: n, label: descriptor.label ?? null };
        }
        return original.call(this, descriptor);
      };
    });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0].slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n').slice(0, 2).join(' ').slice(0, 300)); });
    const url = `${BASE}/?bana=${slug}&q=${QUALITY}&qualitylock=1&det=1&gl=${backend === 'webgl2' ? 1 : 0}${QUERY ? '&' + QUERY : ''}`;
    const row = { slug, backend, url, errors };
    const started = Date.now();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 300000 });
      await page.waitForSelector('#boot.done', { timeout: 300000 });
      row.bootSeconds = +((Date.now() - started) / 1000).toFixed(1);
      const f0 = await page.evaluate(() => window.V3D.frame());
      await page.waitForFunction(f => window.V3D.frame() >= f + 30, f0, { timeout: 120000 });
      Object.assign(row, await page.evaluate(() => ({
        active: window.V3D.stats.backend, prep: window.V3D.perf().gpuPreparation ?? null,
        vertexOutputs: window.__vertexOutputs,
      })));
    } catch (error) {
      row.bootError = String(error).split('\n')[0];
    }
    const problems = [];
    if (row.bootError) problems.push(row.bootError);
    if (row.active && row.active !== backend) problems.push(`asked for ${backend}, got ${row.active}`);
    if (errors.length) problems.push(`${errors.length} console error(s): ${errors[0]}`);
    if (row.vertexOutputs?.max > MAX_OUTPUTS) problems.push(`a vertex stage has ${row.vertexOutputs.max} outputs (> ${MAX_OUTPUTS})`);
    row.ok = problems.length === 0;
    if (!row.ok) failed++;
    rows.push(row);
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${backend.padEnd(6)} ${slug.padEnd(28)} boot ${row.bootSeconds ?? '-'} s`
      + `${row.prep ? `, opening compile ${row.prep.milliseconds} ms (${row.prep.mode})` : ''}`
      + `${row.vertexOutputs?.max ? `, max vertex outputs ${row.vertexOutputs.max}` : ''}`
      + `${problems.length ? '\n     ' + problems.join('\n     ') : ''}`);
    await page.close();
  }
}
await browser.close();
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), gpu: GPU, rows }, null, 2));
console.log(failed ? `${failed} of ${rows.length} boots failed` : `all ${rows.length} boots clean`);
process.exit(failed ? 1 : 0);
