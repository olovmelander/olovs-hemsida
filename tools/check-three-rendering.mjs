#!/usr/bin/env node
/* Rendered acceptance for three upgrades, beyond population fingerprints.
 *
 * node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/check-three-rendering.mjs --backend webgpu --look real
 * BANVY_GPU=1 node tools/check-three-rendering.mjs --backend webgpu --rdepth 0
 * node tools/check-three-rendering.mjs --backend webgl2
 *
 * --course slug[,slug] (default puttom), --all, --tiers (all four tree tiers),
 * --reference http://127.0.0.1:8621 (same app built against the old library),
 * --quality hi|lo, --mobile (390 x 844, touch, DPR 2), --out directory,
 * --capture canvas (WebGL2 drawing-buffer readback for slow SwiftShader),
 * --presets (exercise all eight lighting presets on the shared atmospheric sky).
 * Use the SAME browser/adapter/quality for both versions.
 * A positive triangle count cannot prove visible trees. Hide trees and terrain
 * separately and require each to change actual pixels in the settled frame.
 * Freezing the tiers prevents their update from undoing the visibility probe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG } from '../geobuild/png.mjs';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const base = flag('base', 'http://127.0.0.1:8620').replace(/\/$/, '');
const reference = flag('reference', null)?.replace(/\/$/, '');
const backend = flag('backend', 'webgl2');
const look = flag('look', 'ghibli');
const rdepth = flag('rdepth', '1');
const quality = flag('quality', 'hi');
const captureMode = flag('capture', 'screenshot');
const mobile = args.includes('--mobile');
if (!['webgpu', 'webgl2'].includes(backend) || !['real', 'ghibli'].includes(look) || !['0', '1'].includes(rdepth) || !['hi', 'lo'].includes(quality)) {
  throw new Error('Use --backend webgpu|webgl2, --look real|ghibli, --rdepth 0|1, --quality hi|lo');
}
if (!['screenshot', 'canvas'].includes(captureMode) || (captureMode === 'canvas' && backend !== 'webgl2')) {
  throw new Error('--capture canvas requires --backend webgl2');
}
const manifest = JSON.parse(fs.readFileSync(new URL('../apps/golf/public/courses/index.json', import.meta.url)));
const courses = args.includes('--all') ? manifest.courses.map(c => c.slug) : flag('course', 'puttom').split(',');
if (courses.some(slug => !manifest.courses.some(c => c.slug === slug))) throw new Error('Unknown course');
const out = path.resolve(flag('out', `tools/goldens/three-${backend}-${look}-${rdepth}`));
fs.mkdirSync(out, { recursive: true });
const timeout = +(process.env.BANVY_BOOT_TIMEOUT || 600) * 1000;
const browser = await chromium.launch({
  ...(process.env.BANVY_CHROME ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const checks = [], runs = [];
function gate(ok, label) {
  checks.push({ ok, label });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}
function difference(a, b) {
  const A = decodePNG(a), B = decodePNG(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error('Capture dimensions changed');
  const pixels = A.width * A.height;
  let changed = 0, sum = 0, worst = 0;
  for (let i = 0; i < pixels; i++) {
    let delta = 0;
    for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(A.data[i * A.channels + c] - B.data[i * B.channels + c]));
    sum += delta;
    if (delta > 8) changed++;
    worst = Math.max(worst, delta);
  }
  return { mean: sum / pixels, percentOver8: changed / pixels * 100, worst };
}
function skyRange(png) {
  const { width, height, channels, data } = decodePNG(png);
  let min = 255, max = 0, sum = 0, count = 0;
  // Exclude canvas edges. A sky-only view must contain lit atmospheric shading,
  // not just the renderer's flat clear colour or a black background.
  for (let y = height * 0.1 | 0; y < height * 0.9; y++) for (let x = width * 0.1 | 0; x < width * 0.9; x++) {
    const i = (y * width + x) * channels;
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
    min = Math.min(min, value); max = Math.max(max, value); sum += value; count++;
  }
  return { mean: sum / count, range: max - min };
}
async function capture(page, file) {
  if (captureMode === 'canvas') {
    // Keep the draw and readback in one browser task: WebGL need not preserve
    // its drawing buffer after presentation. This bypasses the compositor.
    let timer;
    try {
      const data = await Promise.race([
        page.evaluate(async () => {
          await V3D.prepareCapture();
          return document.querySelector('body > canvas').toDataURL('image/png');
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Canvas readback timed out')), timeout); }),
      ]);
      const png = Buffer.from(data.split(',')[1], 'base64');
      fs.writeFileSync(path.join(out, file), png);
      return png;
    } finally { clearTimeout(timer); }
  }
  await page.evaluate(() => V3D.prepareCapture());
  const png = await page.locator('body > canvas').screenshot({ path: path.join(out, file), timeout });
  return png;
}
async function settle(page) {
  const frame = await page.evaluate(() => V3D.frameTimes().frame);
  await page.waitForFunction(frame => V3D.frameTimes().frame >= frame + 3 && V3D.settled(), frame, { timeout });
}
async function run(origin, slug, label, probe) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 960, height: 540 },
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block',
  });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url || 'page'})`);
    else if (message.type() === 'warning' && !message.text().includes('Service Worker registration blocked')) warnings.push(message.text());
  });
  const query = new URLSearchParams({ bana: slug, det: '1', hal: '1', vy: 'tee', ljus: 'dag', q: quality, qualitylock: '1', ren: '1', look, gl: backend === 'webgl2' ? '1' : '0', rdepth });
  const report = { slug, label, url: `${origin}/?${query}`, errors, warnings, views: [] };
  runs.push(report);
  console.log(`booting ${label}/${slug}: ${report.url}`);
  try {
    const started = Date.now();
    await page.goto(report.url, { waitUntil: 'load', timeout });
    await page.waitForSelector('#boot.done', { timeout });
    await settle(page);
    report.bootSeconds = (Date.now() - started) / 1000;
    report.state = await page.evaluate(() => ({
      backend: V3D.stats.backend, camera: V3D.cameraInfo(), quality: V3D.quality(),
      tiers: V3D.treeTiers(), audit: V3D.treeTierAudit(), renderer: V3D.rendererInfo(),
      terrain: { kind: V3D.v2Terrain().kind, status: V3D.v2Terrain().status },
      trees: V3D.stats.trees,
    }));
    gate(report.state.backend === backend, `${label}/${slug}: requested ${backend} is active`);
    gate(report.state.camera.reversedDepth === (backend === 'webgpu' && rdepth === '1'), `${label}/${slug}: requested depth convention is active`);
    gate(report.state.audit.ok, `${label}/${slug}: tree slots are consistent`);
    const normal = await capture(page, `${label}-${slug}-tee.png`);
    if (probe) {
      // Check default tiers first; a forced-tier success must not mask broken automatic LOD.
      const tiers = [0, ...(args.includes('--tiers') ? [1, 2, 3, 4] : [])];
      for (const tier of tiers) {
        if (tier) {
          await page.evaluate(tier => { V3D.setTreeFade(0); V3D.setTreeLod(tier); }, tier);
          await settle(page);
        }
        await page.evaluate(() => V3D.freezeTreeTiers(true));
        const visible = tier ? await capture(page, `${label}-${slug}-tier${tier}.png`) : normal;
        const before = await page.evaluate(() => ({ tiers: V3D.treeTiers(), renderer: V3D.rendererInfo(), audit: V3D.treeTierAudit() }));
        let hidden;
        try {
          const meshes = await page.evaluate(() => V3D.setMeshesVisible({ tag: 'trees' }, false));
          gate(meshes > 0, `${label}/${slug}/tier${tier}: tree meshes found`);
          hidden = await capture(page, `${label}-${slug}-tier${tier}-no-trees.png`);
        } finally {
          await page.evaluate(() => { V3D.setMeshesVisible({ tag: 'trees' }, true); V3D.freezeTreeTiers(false); });
        }
        const delta = difference(visible, hidden);
        report.views.push({ tier, ...before, treePixels: delta });
        gate(before.audit.ok && delta.percentOver8 > 0.1, `${label}/${slug}/tier${tier}: visible forest (${delta.percentOver8.toFixed(2)}% pixels)`);
      }
      await page.evaluate(() => V3D.setTreeLod(0));
      await settle(page);
      if (report.state.terrain.kind === 'graph') {
        const visible = await capture(page, `${label}-${slug}-terrain.png`);
        let hidden;
        try {
          await page.evaluate(() => V3D.setMeshesVisible({ world: true }, false));
          hidden = await capture(page, `${label}-${slug}-no-terrain.png`);
        } finally {
          await page.evaluate(() => V3D.setMeshesVisible({ world: true }, true));
        }
        report.terrainPixels = difference(visible, hidden);
        gate(report.terrainPixels.percentOver8 > 1, `${label}/${slug}: terrain visible beneath sky (${report.terrainPixels.percentOver8.toFixed(2)}% pixels)`);
      }
      // A different camera forces the cell culler and instance slot uploads to update.
      await page.evaluate(() => V3D.setCam('top', true));
      await settle(page);
      report.top = await page.evaluate(() => ({ camera: V3D.cameraInfo(), tiers: V3D.treeTiers(), audit: V3D.treeTierAudit(), renderer: V3D.rendererInfo() }));
      const top = await capture(page, `${label}-${slug}-top.png`);
      gate(report.top.audit.ok && report.top.tiers.cellsVisible > 0 && report.top.renderer.triangles > 0, `${label}/${slug}: overhead view renders after camera change`);
      try {
        await page.evaluate(() => { V3D.freezeTreeTiers(true); V3D.setMeshesVisible({ tag: 'trees' }, false); });
        report.top.treePixels = difference(top, await capture(page, `${label}-${slug}-top-no-trees.png`));
        gate(report.top.treePixels.percentOver8 > 0.1, `${label}/${slug}: forest remains visible after camera change (${report.top.treePixels.percentOver8.toFixed(2)}% pixels)`);
      } finally {
        await page.evaluate(() => { V3D.setMeshesVisible({ tag: 'trees' }, true); V3D.freezeTreeTiers(false); });
      }
      if (await page.evaluate(() => V3D.atmosphere?.().kind === 'SkyMesh') || (backend === 'webgpu' && look === 'real')) {
        await page.evaluate(() => {
          const [x, y, z] = V3D.cameraInfo().position;
          V3D.placeCamera([x, y + 200, z], [x, y + 600, z + 400]);
        });
        await settle(page);
        report.sky = skyRange(await capture(page, `${label}-${slug}-sky.png`));
        gate(report.sky.mean > 20 && report.sky.range > 3, `${label}/${slug}: SkyMesh shades the sky (${report.sky.mean.toFixed(1)}/255, range ${report.sky.range.toFixed(1)})`);
        if (args.includes('--presets')) {
          report.presets = [];
          for (const preset of ['golden', 'noon', 'mist', 'dawn', 'host', 'midnight', 'bluehour', 'storm']) {
            await page.evaluate(preset => { V3D.setCam('tee', true); V3D.setPreset(preset); }, preset);
            await settle(page);
            const world = skyRange(await capture(page, `${label}-${slug}-${preset}-tee.png`));
            await page.evaluate(() => {
              const [x, y, z] = V3D.cameraInfo().position;
              V3D.placeCamera([x, y + 200, z], [x, y + 600, z + 400]);
            });
            await settle(page);
            const sky = skyRange(await capture(page, `${label}-${slug}-${preset}-sky.png`));
            report.presets.push({ preset, world, sky });
            gate(world.range > 3 && sky.mean > 2 && sky.range > 1, `${label}/${slug}/${preset}: world and sky shade after lighting change (sky ${sky.mean.toFixed(1)}/255, range ${sky.range.toFixed(1)})`);
          }
        }
      }
    }
    gate(errors.length === 0, `${label}/${slug}: no browser or renderer errors${errors.length ? `: ${errors[0].slice(0, 180)}` : ''}`);
    return normal;
  } catch (error) {
    report.failure = String(error);
    gate(false, `${label}/${slug}: ${String(error).slice(0, 250)}`);
    return null;
  } finally { await page.close(); }
}
try {
  for (const slug of courses) {
    const current = await run(base, slug, 'current', true);
    if (reference) {
      const old = await run(reference, slug, 'reference', false);
      if (current && old) {
        const delta = difference(current, old);
        runs.at(-1).comparison = delta;
        gate(delta.mean <= 2.5 && delta.percentOver8 <= 5, `${slug}: r185/r186 perceptual parity (${delta.mean.toFixed(4)}/255; ${delta.percentOver8.toFixed(3)}% over 8)`);
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ browser: browser.version(), hardwareRequested: GPU, backend, look, rdepth, quality, mobile, captureMode, checks, runs }, null, 2) + '\n');
  await browser.close();
}
if (checks.some(check => !check.ok)) process.exitCode = 1;
