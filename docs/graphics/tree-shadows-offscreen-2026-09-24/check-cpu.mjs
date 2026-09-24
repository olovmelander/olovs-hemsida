// The CPU cost of keeping out-of-view shadow casters, on real course placements
// (after tools/audit-tree-updates.mjs): this checkout's tier update with the
// sun's record as placeSun sets it under the golden-hour sun, against the same
// update without it, interleaved; and a parity check that without the record
// the update is main's before the change (aa8fea3d), exactly, frame by frame.
// No rendering: not a frame-rate measurement. Run from the repository root:
//   node docs/graphics/tree-shadows-offscreen-2026-09-24/check-cpu.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from '../../../tools/browser-args.mjs';
import { courseSourceRevision } from '../../../tools/course-source-revision.mjs';

const out = process.argv[2] || 'docs/graphics/tree-shadows-offscreen-2026-09-24/cpu-replay.json';
const runs = [['puttom', 'hi'], ['puttom', 'lo'], ['angso', 'lo']];
const frameCount = 360;
const root = process.cwd(), app = path.join(root, 'apps/golf'), mainPath = path.join(app, 'src/main.js');
const requireApp = createRequire(path.join(app, 'package.json')), { createServer } = await import(requireApp.resolve('vite'));
const baseline = 'aa8fea3d', revision = courseSourceRevision(root);
const source = await fs.readFile(mainPath, 'utf8'), original = execFileSync('git', ['show', `${baseline}:apps/golf/src/main.js`], { encoding: 'utf8', maxBuffer: 64 << 20 });
const server = await createServer({ root: app, configFile: path.join(app, 'vite.config.js'), server: { host: '127.0.0.1', port: 8667, strictPort: true },
  resolve: { alias: [{ find: /^three\/webgpu$/, replacement: requireApp.resolve('three/webgpu') }] },
  plugins: [{ name: 'tree-cpu-audit', enforce: 'pre', configureServer(server) {
    server.middlewares.use('/__audit_empty', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Tree CPU replay</title>'); });
  }, transform(text, id) {
    if (id !== mainPath) return;
    const anchor = "lap('tree tiers (Hero + Impostor, cells)', { trees: stats.trees | 0, cells: TREE_LOD.cells.length });";
    assert.ok(text.includes(anchor));
    return text.replace(anchor, `${anchor}\nconst { captureTreeInput } = await import('/@fs${root}/tools/tree-update-replay.mjs');
      globalThis.__treeInput = captureTreeInput(TREE_LOD, HOLES, terrainH, renderResolution.detailHeight());
      await new Promise(() => {});`);
  } }] });
await server.listen();
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { mode: 'isolated tree CPU replay, real placements, synthetic camera paths, golden-hour sun; no rendering',
  baseline, revision, frameCount, browser: await browser.version(), hardwareFpsMeasured: false, physicalPhoneMeasured: false, results: [] };
try {
  for (const [course, quality] of runs) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:8667/?bana=${course}&q=${quality}&gl=1&qualitylock=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__treeInput, null, { timeout: 400000 });
    assert.deepEqual(errors, []);
    const input = await page.evaluate(() => globalThis.__treeInput);
    await page.goto('http://127.0.0.1:8667/__audit_empty');
    await page.evaluate(async ({ root, threePath, input, original, source, frameCount }) => {
      const replay = await import(`/@fs${root}/tools/tree-update-replay.mjs`);
      const fit = await import(`/@fs${root}/apps/golf/src/engine/shadow-fit.mjs`);
      const THREE = await import(`/@fs${threePath}`);
      const { ATMOSPHERE_PRESETS } = await import(`/@fs${root}/apps/golf/src/engine/atmosphere-presets.mjs`);
      const d = new THREE.Vector3(...ATMOSPHERE_PRESETS.golden.dir).normalize();
      const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP);
      const r = new THREE.Vector3().setFromMatrixColumn(m, 0), u = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const MAX = fit.SHADOW_FITS[fit.SHADOW_FITS.length - 1];
      /* placeSun's record for this frame: the fit from the camera's distance, centred on the target */
      const sweepFor = (frame, prevR) => {
        const [px, py, pz] = frame.position, [tx, ty, tz] = frame.target;
        const want = Math.min(MAX, Math.max(260, Math.hypot(px - tx, py - ty, pz - tz) * 1.15 + 90));
        const R = fit.chooseShadowFit(want, prevR);
        return { R, cx: tx, cy: ty, cz: tz, dx: d.x, dy: d.y, dz: d.z, rx: r.x, ry: r.y, rz: r.z, ux: u.x, uy: u.y, uz: u.z };
      };
      globalThis.__replay = { ...replay.createTreeReplay(THREE), input, frameCount, sweepFor, baseline: replay.treeFunctions(original), candidate: replay.treeFunctions(source) };
    }, { root, threePath: requireApp.resolve('three/webgpu'), input, original, source, frameCount });
    const cdp = await page.context().newCDPSession(page);
    const result = { course, quality, population: input.tiers.reduce((n, s) => n + (s?.n || 0), 0), cells: input.cells.length, scenarios: [] };
    for (const scenario of ['rest', 'orbit', 'flight']) {
      /* without the record the candidate is main's update, exactly, frame by frame */
      const parity = await page.evaluate(scenario => {
        const r = globalThis.__replay, frames = r.replayFrames(r.input, scenario, r.frameCount);
        const a = r.createReplay(r.input, r.baseline), b = r.createReplay(r.input, r.candidate);
        for (const frame of frames) { r.stepReplay(a, frame); r.stepReplay(b, frame); r.assertReplayEqual(a, b); }
        return a.audit().ok && b.audit().ok;
      }, scenario);
      const samples = [];
      for (let round = -2; round < 6; round++) for (const variant of round % 2 ? ['sweep', 'plain'] : ['plain', 'sweep']) {
        await page.evaluate(({ scenario, variant }) => {
          const r = globalThis.__replay;
          r.frames = r.replayFrames(r.input, scenario, r.frameCount); r.active = r.createReplay(r.input, r.candidate); r.variant = variant;
        }, { scenario, variant });
        await cdp.send('HeapProfiler.collectGarbage');
        const sample = await page.evaluate(() => {
          const r = globalThis.__replay; let sum = 0, R = 0, kept = 0, moves0 = r.active.lod.stats.moves; const times = [];
          for (const frame of r.frames) {
            r.active.camera.position.fromArray(frame.position); r.active.camera.lookAt(...frame.target); r.active.camera.updateMatrixWorld(true);
            r.active.lod.fadeClock = frame.time;
            if (r.variant === 'sweep') { const w = r.sweepFor(frame, R); R = w.R; r.active.lod.shadowSweep = w; }
            const t = performance.now(); r.active.update(); const dt = performance.now() - t; times.push(dt); sum += dt;
            kept += r.active.lod.stats.shadowCells || 0;
          }
          times.sort((a, b) => a - b);
          return { totalMs: sum, meanMs: sum / times.length, p50Ms: times[times.length >> 1], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1),
            meanKeptCells: kept / r.frames.length, moves: r.active.lod.stats.moves - moves0, audit: r.active.audit().ok };
        });
        if (round >= 0) samples.push({ round, variant, ...sample });
      }
      const mean = (v, k) => samples.filter(s => s.variant === v).reduce((n, s) => n + s[k], 0) / 6;
      /* each figure is the average over six interleaved rounds */
      const row = { scenario, parity, plain: { p50Ms: mean('plain', 'p50Ms'), meanMs: mean('plain', 'meanMs'), p95Ms: mean('plain', 'p95Ms'), moves: mean('plain', 'moves') },
        sweep: { p50Ms: mean('sweep', 'p50Ms'), meanMs: mean('sweep', 'meanMs'), p95Ms: mean('sweep', 'p95Ms'), moves: mean('sweep', 'moves'), keptCells: mean('sweep', 'meanKeptCells') },
        audits: samples.every(s => s.audit), samples };
      result.scenarios.push(row);
      console.log(`${course}/${quality}/${scenario}: parity ${parity}; median ${row.plain.p50Ms.toFixed(3)} -> ${row.sweep.p50Ms.toFixed(3)} ms, mean ${row.plain.meanMs.toFixed(3)} -> ${row.sweep.meanMs.toFixed(3)} ms, p95 ${row.plain.p95Ms.toFixed(3)} -> ${row.sweep.p95Ms.toFixed(3)} ms, moves ${row.plain.moves} -> ${row.sweep.moves}, kept cells ${row.sweep.keptCells.toFixed(1)}, audits ${row.audits}`);
    }
    report.results.push(result);
    await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
