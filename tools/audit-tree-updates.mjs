#!/usr/bin/env node
// Real-course diagnostic replay, not a frame-rate or opening-time benchmark.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

const args = process.argv.slice(2), arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const baseline = arg('--baseline', 'fb3e6dd8e0378089d5dfa207cdb5376449961621');
const out = path.resolve(arg('--out', 'output/performance-audit/frame-stability-2026-09-22'));
const courses = arg('--courses', 'veckefjarden,puttom,visby').split(','), qualities = arg('--qualities', 'lo').split(',');
const reuse = args.includes('--reuse-fixtures'), calibration = args.includes('--calibration');
const parityOnly = args.includes('--parity-only'), frameCount = Number(arg('--frames', '360'));
assert.ok(Number.isSafeInteger(frameCount) && frameCount >= 2 && frameCount <= 3600, 'invalid replay length');
assert.ok(qualities.every(q => ['hi', 'lo'].includes(q)), 'unknown quality');
const reportName = arg('--report', calibration ? 'tree-calibration.json' : 'tree-replay.json');
const root = process.cwd(), app = path.join(root, 'apps/golf'), mainPath = path.join(app, 'src/main.js');
const requireApp = createRequire(path.join(app, 'package.json')), { createServer } = await import(requireApp.resolve('vite'));
const source = await fs.readFile(mainPath, 'utf8'), original = execFileSync('git', ['show', `${baseline}:apps/golf/src/main.js`], { encoding: 'utf8' });
const sha = data => createHash('sha256').update(data).digest('hex');
const revision = courseSourceRevision(root), catalog = JSON.parse(await fs.readFile(path.join(app, 'public/courses/index.json')));
assert.ok(courses.every(slug => catalog.courses.some(c => c.slug === slug)), 'unknown course');
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root: app, configFile: path.join(app, 'vite.config.js'), server: { host: '127.0.0.1', port: 8666, strictPort: true },
  resolve: { alias: [{ find: /^three\/webgpu$/, replacement: requireApp.resolve('three/webgpu') }] },
  plugins: [{ name: 'tree-cpu-audit', enforce: 'pre', configureServer(server) {
    server.middlewares.use('/__audit_empty', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Tree CPU replay</title>'); });
  }, transform(text, id) {
    if (id !== mainPath) return;
    const anchor = "lap('tree tiers (Hero + Impostor, cells)', { trees: stats.trees | 0, cells: TREE_LOD.cells.length });";
    assert.ok(text.includes(anchor));
    return text.replace(anchor, `${anchor}\nconst { captureTreeInput } = await import('/@fs${root}/tools/tree-update-replay.mjs');
      globalThis.__treeInput = captureTreeInput(TREE_LOD, HOLES, terrainH, renderResolution.detailHeight());
      globalThis.__treeAdapter = renderer.backend.getContext().getParameter(renderer.backend.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
      await new Promise(() => {});`);
  } }] });
await server.listen();
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { baseline, revision, sourceHashes: { baseline: sha(original), candidate: sha(source) }, calibration, parityOnly, frameCount,
  browser: await browser.version(), mode: 'isolated tree CPU replay; synthetic camera paths through real course placements; no rendering; service worker blocked',
  hardwareFpsMeasured: false, physicalPhoneMeasured: false, results: [] };
try {
  for (const course of courses) for (const quality of qualities) {
    const fixturePath = path.join(out, `${course}-${quality}-input.json`);
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      let fixture;
      if (reuse) {
        fixture = JSON.parse(await fs.readFile(fixturePath));
        assert.equal(fixture.packSha256, catalog.courses.find(c => c.slug === course).sha256, 'course input changed');
        await page.goto('http://127.0.0.1:8666/__audit_empty');
      } else {
        await page.goto(`http://127.0.0.1:8666/?bana=${course}&q=${quality}&gl=1&qualitylock=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!globalThis.__treeInput, null, { timeout: 240000 });
        assert.deepEqual(errors, []);
        fixture = { revision, course, quality, packSha256: catalog.courses.find(c => c.slug === course).sha256,
          ...await page.evaluate(() => ({ input: globalThis.__treeInput, adapter: globalThis.__treeAdapter })) };
        await fs.writeFile(fixturePath, JSON.stringify(fixture));
        // Discard the partial course before timing; avoid its allocations/async work.
        await page.goto('http://127.0.0.1:8666/__audit_empty');
      }
      await page.evaluate(async ({ root, threePath, input, original, source, calibration, frameCount }) => {
        const replay = await import(`/@fs${root}/tools/tree-update-replay.mjs`);
        const THREE = await import(`/@fs${threePath}`);
        globalThis.__replay = { ...replay.createTreeReplay(THREE), input, frameCount, baseline: replay.treeFunctions(original), candidate: replay.treeFunctions(calibration ? original : source) };
      }, { root, threePath: requireApp.resolve('three/webgpu'), input: fixture.input, original, source, calibration, frameCount });
      const cdp = await page.context().newCDPSession(page);
      const result = { course, quality, inputRevision: fixture.revision, inputSha256: sha(JSON.stringify(fixture.input)), adapter: fixture.adapter,
        population: fixture.input.tiers.reduce((n, s) => n + (s?.n || 0), 0), cells: fixture.input.cells.length, scenarios: [] };
      for (const scenario of ['rest', 'orbit', 'flight']) {
        const parity = await page.evaluate(scenario => {
          const r = globalThis.__replay, frames = r.replayFrames(r.input, scenario, r.frameCount);
          const a = r.createReplay(r.input, r.baseline, undefined, true), b = r.createReplay(r.input, r.candidate, undefined, true);
          for (const frame of frames) { r.stepReplay(a, frame); r.stepReplay(b, frame); r.assertReplayEqual(a, b); }
          if (!a.audit().ok || !b.audit().ok) throw new Error('slot ownership fails');
          return { frames: frames.length, exact: true, baseline: a.counters, candidate: b.counters };
        }, scenario);
        const samples = [];
        for (let round = parityOnly ? 6 : -2; round < 6; round++) for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          await page.evaluate(({ scenario, variant }) => {
            const r = globalThis.__replay;
            r.frames = r.replayFrames(r.input, scenario, r.frameCount); r.active = r.createReplay(r.input, r[variant]);
          }, { scenario, variant });
          await cdp.send('HeapProfiler.collectGarbage');
          const sample = await page.evaluate(() => {
            const r = globalThis.__replay; let sum = 0; const times = [];
            for (const frame of r.frames) {
              r.active.camera.position.fromArray(frame.position); r.active.camera.lookAt(...frame.target); r.active.camera.updateMatrixWorld(true);
              r.active.lod.fadeClock = frame.time;
              const t = performance.now(); r.active.update(); const dt = performance.now() - t; times.push(dt); sum += dt;
            }
            times.sort((a, b) => a - b);
            return { totalMs: sum, meanMs: sum / times.length, p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1) };
          });
          if (round >= 0) samples.push({ round, variant, ...sample });
        }
        result.scenarios.push({ scenario, ...parity, samples });
        console.log(`${course}/${quality}/${scenario}: exact ${parity.frames} frames; decisions ${parity.baseline.decisions} -> ${parity.candidate.decisions}; requested bytes ${parity.baseline.uploadBytes} -> ${parity.candidate.uploadBytes}`);
      }
      report.results.push(result);
      await fs.writeFile(path.join(out, reportName), JSON.stringify(report, null, 2) + '\n');
    } finally { await page.close(); }
  }
  assert.equal(courseSourceRevision(root), revision, 'runtime changed during audit');
} finally { await browser.close(); await server.close(); }
