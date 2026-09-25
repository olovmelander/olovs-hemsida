#!/usr/bin/env node
// Compare the original and prepared loaders in the SAME build. Deterministic
// world hashes are exact; image deltas are reported separately from timings.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8628';
const requested = flag('courses', 'veckefjarden,puttom,norrfallsviken');
const catalog = await (await fetch(`${base}/courses/index.json`)).json();
const revision = await (await fetch(`${base}/course-startup-build.json`)).json();
const courses = requested === 'all' ? catalog.courses.map(c => c.slug) : requested.split(',');
const looks = flag('looks', '1').split(',');
assert.ok(looks.every(look => look === '1'), 'only the Ghibli look is supported');
const backend = flag('backend', 'webgpu');
const quality = flag('q', 'lo');
const baseline = flag('baseline', '0');
const candidate = flag('candidate', '1');
assert.ok(['0', '1', 'main-thread', 'terrain-main', 'unindexed', 'live-water', 'unprepared-gpu'].includes(baseline), 'invalid baseline');
assert.ok(['1', 'terrain-worker'].includes(candidate) && baseline !== candidate, 'invalid candidate');
const out = path.resolve(flag('out', 'tools/reference/startup-review'));
await fs.mkdir(out, { recursive: true });
const modes = args.includes('--single-mode') ? ['golden'] : ['golden', 'noon', 'summer', 'dawn', 'midnight', 'bluehour', 'storm', 'mist', 'host'];
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const report = { revision, backend, quality, baseline, candidate, courses, comparisons: [], errors: [], physicalPhone: false };

async function settle(page) {
  await page.evaluate(() => { window.__startupStable = null; });
  await page.waitForFunction(() => {
    const V = window.V3D, a = V.v2Terrain().adapter, p = V.v2WorldPlan();
    if (!V.settled() || a.phase !== 'ready' || a.stream.loadingTiles || a.stream.failedTiles || !p) {
      window.__startupStable = null; return false;
    }
    const signature = JSON.stringify([p.renderTileIds, p.readyTileIds]);
    if (window.__startupStable?.signature !== signature) window.__startupStable = { signature, at: performance.now(), frame: V.frame() };
    return performance.now() - window.__startupStable.at >= 400 && V.frame() >= window.__startupStable.frame + 2;
  }, null, { timeout: 120000, polling: 50 });
}

async function fingerprint(page) {
  return page.evaluate(async () => {
    const V = window.V3D, trees = V.legacyTrees({ instances: true }), tint = V.groundTint();
    const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    return { exactTables: V.startupWorldFingerprint ? await V.startupWorldFingerprint() : null,
      water: V.startupWaterFingerprint ? await V.startupWaterFingerprint() : null,
      instances: await hash(new TextEncoder().encode(JSON.stringify(trees.instances))),
      tintNear: await hash(tint.near), tintFar: await hash(tint.far), trees: V.stats.trees, vista: V.stats.vista,
      reeds: V.stats.reeds, tufts: V.stats.tufts, bushes: V.stats.bushes, stones: V.stats.stones, stumps: V.stats.stumps };
  });
}

function delta(a, b) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height); assert.equal(a.channels, b.channels);
  let sum = 0, changed = 0, max = 0;
  for (let i = 0; i < a.data.length; i += a.channels) {
    let diff = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]); sum += d; diff = Math.max(diff, d); }
    if (diff > 8) changed++; max = Math.max(max, diff);
  }
  return { fractionOver8: changed / (a.width * a.height), meanChannelError: sum / (a.width * a.height * 3), max };
}

try {
  for (const course of courses) for (const look of looks) {
    const pair = { course, look, runs: [], images: [] };
    const originals = new Map();
    for (const startup of [baseline, candidate]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const errors = [], offlineRequests = [];
      let offline = false;
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (['error', 'warning'].includes(message.type()) && /GL_INVALID|validation error|GPUValidationError|shader.*error|pipeline.*error|buffer.*destroyed/i.test(message.text())) errors.push(message.text());
      });
      page.on('request', request => { if (offline && /\/(?:grounds|courses)\//.test(request.url())) offlineRequests.push(request.url()); });
      try {
        if (args.includes('--missing-landcover')) await page.route('**/landcover.json*', route => route.abort());
        if (args.includes('--missing-water')) await page.route('**/prepared/water-*.bin', route => route.abort());
        const query = new URLSearchParams({ bana: course, v2: 'require', det: '1', qualitylock: '1', startup,
          q: quality, ghibli: look, gl: backend === 'webgl2' ? '1' : '0', vy: 'tee', hal: '1', ren: '1' });
        await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('#boot.done', { timeout: 180000 });
        assert.equal(await page.evaluate(() => V3D.v2Terrain().backend), backend, 'requested renderer backend');
        const perf = await page.evaluate(() => V3D.perf());
        if (startup === candidate) {
          assert.equal(perf.courseData.complete, true);
          assert.deepEqual(perf.courseData.fallbackReasons, []);
          assert.equal(perf.preparedTint, !args.includes('--missing-landcover'), 'prepared tint eligibility');
          if (baseline === 'live-water') assert.equal(perf.preparedWater, !args.includes('--missing-water'), 'prepared water eligibility');
          if (baseline === 'unprepared-gpu') {
            assert.ok(perf.gpuPreparation?.completed > 0, 'opening GPU preparation ran');
            assert.equal(perf.gpuPreparation.completed, perf.gpuPreparation.branches);
            assert.ok(perf.gpuPreparation.concurrency <= 4, 'bounded compilation');
          }
          // Disable the network immediately after readiness, before any views
          // beyond the opening hole have been requested.
          await page.context().setOffline(true); offline = true;
        }
        const world = await fingerprint(page);
        const holes = await page.evaluate(() => V3D.HOLES.map((_, index) => index + 1));
        if (startup === candidate) assert.deepEqual(world, pair.runs[0].world, 'world changed');
        for (const mode of modes) {
          await page.evaluate(({ mode, hole }) => { V3D.setTreeFade(0); V3D.setPreset(mode); V3D.goHole(hole, true, true); V3D.setCam('tee', true); },
            { mode, hole: holes.includes(13) ? 13 : holes[0] });
          await settle(page);
          const png = backend === 'webgpu'
            ? Buffer.from((await page.evaluate(() => V3D.captureReadback())).base64, 'base64')
            : await page.locator('body > canvas').screenshot();
          const filename = `${course}-${look}-${startup}-${mode}.png`;
          await fs.writeFile(path.join(out, filename), png);
          if (startup === baseline) originals.set(mode, decodePNG(png));
          else {
            const result = delta(originals.get(mode), decodePNG(png)); pair.images.push({ mode, ...result });
            if (result.fractionOver8 > 0.005 || result.meanChannelError > 0.5) report.errors.push(`${course}/${look}/${mode}: image delta ${JSON.stringify(result)}`);
          }
        }
        if (startup === candidate) {
          for (const hole of holes) {
            await page.evaluate(n => { V3D.goHole(n, true, true); V3D.setCam('tee', true); }, hole);
            await settle(page);
            assert.equal(await page.evaluate(() => V3D.treeTierAudit().ok), true, `tree slots at hole ${hole}`);
          }
          await page.evaluate(() => V3D.fly());
          await page.waitForTimeout(2000);
          assert.ok(await page.evaluate(() => V3D.flightState().flying > 0), 'tour did not start');
          assert.deepEqual(offlineRequests, [], 'course requested new data after opening');
        }
        assert.deepEqual(errors, [], 'browser errors');
        pair.runs.push({ startup, world, readyMs: perf.courseReadyAtNavigationMs, courseData: perf.courseData,
          allocation: await page.evaluate(() => V3D.treeTierAllocation?.() ?? null),
          preparedTint: perf.preparedTint, gpuPreparation: perf.gpuPreparation,
          offlineHoles: startup === candidate ? holes.length : 0 });
        console.log(`${course} look=${look} startup=${startup}: world/visual/offline checks completed`);
      } finally { await page.close(); }
    }
    report.comparisons.push(pair);
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert.deepEqual(await (await fetch(`${base}/course-startup-build.json`)).json(), revision, 'served build changed');
} catch (error) { report.errors.push(error.stack); }
finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ comparisons: report.comparisons.length, errors: report.errors }, null, 2));
if (report.errors.length) process.exitCode = 1;
