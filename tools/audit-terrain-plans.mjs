#!/usr/bin/env node
// Diagnostic CPU replay. No rendering, hardware FPS or opening-time claims.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

const args = process.argv.slice(2), arg = (key, value) => args.includes(key) ? args[args.indexOf(key) + 1] : value;
const root = process.cwd(), app = path.join(root, 'apps/golf'), mainPath = path.join(app, 'src/main.js');
const baseline = arg('--baseline', '3ec71683da0abe78c762f95e417769eeb4b1c9e2');
const out = path.resolve(arg('--out', 'output/performance-audit/terrain-plans-2026-09-22'));
const courses = arg('--courses', 'veckefjarden,puttom,visby').split(',');
const reuse = args.includes('--reuse-fixtures'), calibration = args.includes('--calibration');
const parityOnly = args.includes('--parity-only');
const modulePath = 'packages/course-v2/runtime/terrain-tile-manager.mjs';
const original = execFileSync('git', ['show', `${baseline}:${modulePath}`], { encoding: 'utf8' });
const candidate = await fs.readFile(path.join(root, modulePath), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const revision = courseSourceRevision(root), requireApp = createRequire(path.join(app, 'package.json'));
const catalog = JSON.parse(await fs.readFile(path.join(app, 'public/courses/v2-index.json')));
assert.ok(courses.every(slug => catalog.courses.some(entry => entry.slug === slug)), 'unknown course');
const verified = async reference => {
  const bytes = await fs.readFile(path.join(app, 'public', reference.url));
  assert.equal(bytes.length, reference.bytes); assert.equal(sha(bytes), reference.sha256);
  return JSON.parse(bytes);
};
const { createServer } = await import(requireApp.resolve('vite'));
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root: app, configFile: path.join(app, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 8667, strictPort: true },
  resolve: { alias: [{ find: /^three\/webgpu$/, replacement: requireApp.resolve('three/webgpu') }] },
  plugins: [{ name: 'terrain-plan-audit', enforce: 'pre', configureServer(server) {
    server.middlewares.use('/__terrain_empty', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Terrain plan replay</title>'); });
    for (const [name, source] of [['baseline', original], ['candidate', calibration ? original : candidate]]) {
      server.middlewares.use(`/__terrain_${name}.mjs`, (_req, res) => { res.setHeader('Content-Type', 'text/javascript'); res.end(source); });
    }
  }, transform(text, id) {
    if (id !== mainPath) return;
    const anchor = "await tick('ritar första vyn', 0.98);";
    assert.ok(text.includes(anchor));
    return text.replace(anchor, `globalThis.__terrainAudit = { terrainV2, camera, controls, HOLES, goHole, setCam, updateTerrainView, viewport: renderResolution.detailHeight(), renderer };\nawait new Promise(() => {});\n${anchor}`);
  } }] });
await server.listen();
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { baseline, revision, sourceHashes: { baseline: sha(original), candidate: sha(calibration ? original : candidate) },
  calibration, parityOnly, browser: await browser.version(), hardwareFpsMeasured: false, physicalPhoneMeasured: false,
  mode: 'CPU planner replay; real course ground, resident opening frontier and frustum captures; synthetic orbit; WebGL2 low quality locked; no scene drawing; service worker blocked', results: [] };
try {
  for (const course of courses) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      const courseRef = catalog.courses.find(entry => entry.slug === course).manifest;
      const courseManifest = await verified(courseRef), groundManifest = await verified(courseManifest.groundManifest);
      const file = path.join(out, `${course}-input.json`);
      let fixture;
      if (reuse) fixture = JSON.parse(await fs.readFile(file));
      else {
        console.log(`${course}: capturing settled terrain before opening GPU preparation`);
        await page.goto(`http://127.0.0.1:8667/?bana=${course}&q=lo&gl=1&qualitylock=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!globalThis.__terrainAudit, null, { timeout: 240000 });
        assert.deepEqual(errors, []);
        fixture = { revision, course, ...await page.evaluate(() => {
          const a = globalThis.__terrainAudit, r = a.terrainV2.runtime, controller = r.controller;
          const snapshot = controller.snapshot(), ground = r.ground, course = r.course;
          if (snapshot.loadingTileIds.length || snapshot.failedTileIds.length) throw new Error('opening terrain not settled');
          const gl = a.renderer.backend.getContext(), adapter = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
          const iterations = 1000, components = {};
          const time = (label, fn) => {
            for (let i = 0; i < 100; i++) fn();
            const t = performance.now(); for (let i = 0; i < iterations; i++) fn();
            components[label] = (performance.now() - t) / iterations;
          };
          r.tick(performance.now() + 1000);
          const statsBefore = r.layer.stats();
          time('completeSettledUpdateMs', () => a.updateTerrainView());
          const options = { ...r.lastUpdate, residentTileIds: new Set(snapshot.readyTileIds) };
          time('plannerMs', () => r.manager.plan(options));
          time('controllerSnapshotMs', () => controller.snapshot());
          time('batchSyncMs', () => r.layer.sync(snapshot.renderResources, { now: performance.now() + 2000 }));
          time('batchTickMs', () => r.tick(performance.now() + 3000));
          const statsAfter = r.layer.stats();
          const frames = [], update = controller.update;
          controller.update = options => {
            const { visible, ...plain } = options;
            frames.push({ ...plain, visibleTileIds: ground.tiles.filter(visible).map(tile => tile.id) });
            return snapshot.plan;
          };
          try {
            a.updateTerrainView();
            const target = a.controls.target.clone(), eye = a.camera.position.clone().sub(target);
            const radius = Math.hypot(eye.x, eye.z), start = Math.atan2(eye.z, eye.x);
            for (let i = 0; i < 360; i++) {
              const angle = start + i / 360 * Math.PI * 2;
              a.camera.position.set(target.x + Math.cos(angle) * radius, target.y + eye.y, target.z + Math.sin(angle) * radius);
              a.camera.lookAt(target); a.updateTerrainView();
            }
            for (let hole = 1; hole <= course.holes.length; hole++) {
              a.goHole(hole, false); a.setCam('tee', true); a.controls.update(); a.updateTerrainView();
            }
          } finally { controller.update = update; }
          return { ground, courseManifest: course, residentTileIds: snapshot.readyTileIds,
            renderErrors: [...r.manager.renderErrors], frames, adapter, components, statsBefore, statsAfter };
        }) };
        await fs.writeFile(file, JSON.stringify(fixture));
      }
      assert.equal(fixture.course, course, 'wrong fixture');
      assert.deepEqual(fixture.courseManifest, courseManifest, 'course manifest changed; recapture fixture');
      // Runtime replaces the origin with its verified legacy/grid bridge. The
      // rest of the ground, including tile bounds and asset identities, matches.
      const withoutFrame = ({ frame, ...ground }) => ground;
      assert.deepEqual(withoutFrame(fixture.ground), withoutFrame(groundManifest), 'ground changed; recapture fixture');
      await page.goto('http://127.0.0.1:8667/__terrain_empty');
      const cdp = await page.context().newCDPSession(page);
      const parity = await page.evaluate(async fixture => {
        const A = (await import('/__terrain_baseline.mjs')).TerrainTileManager;
        const B = (await import('/__terrain_candidate.mjs')).TerrainTileManager;
        const make = Type => { const m = new Type({ ground: fixture.ground, courseSlug: fixture.course });
          for (const [id, error] of fixture.renderErrors) m.setRenderErrorMetres(id, error); return m; };
        const residentTileIds = new Set(fixture.residentTileIds);
        const frames = fixture.frames.map(frame => { const visible = new Set(frame.visibleTileIds);
          return { ...frame, residentTileIds, visible: tile => visible.has(tile.id) }; });
        const equal = (left, right) => {
          if (Object.is(left, right)) return true;
          if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
          const keys = Object.keys(left);
          return Array.isArray(left) === Array.isArray(right) && keys.length === Object.keys(right).length &&
            keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
        };
        const a = make(A), b = make(B);
        let comparisons = 0;
        for (const state of [residentTileIds, new Set(), new Set(['shell']), new Set(fixture.ground.tiles.map(t => t.id))]) {
          for (const frame of frames) {
            const options = { ...frame, residentTileIds: state };
            const left = a.plan(options), right = b.plan(options);
            if (!equal(left, right)) throw new Error(`plan mismatch at ${comparisons}`);
            comparisons++;
          }
        }
        globalThis.__planReplay = { A, B, make, frames };
        return { exact: true, comparisons };
      }, fixture);
      const scenarios = [];
      for (const scenario of ['rest', 'orbit', 'holes']) {
        const samples = [];
        for (let round = parityOnly ? 6 : -2; round < 6; round++) for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          await cdp.send('HeapProfiler.collectGarbage');
          const sample = await page.evaluate(({ scenario, variant }) => {
            const r = globalThis.__planReplay, manager = r.make(variant === 'baseline' ? r.A : r.B);
            const frames = scenario === 'rest' ? r.frames.slice(0, 1) : scenario === 'orbit' ? r.frames.slice(1, 361) : r.frames.slice(361);
            const count = 3600, t = performance.now();
            for (let i = 0; i < count; i++) manager.plan(frames[i % frames.length]);
            return { meanMs: (performance.now() - t) / count, count };
          }, { scenario, variant });
          if (round >= 0) samples.push({ round, variant, ...sample });
        }
        scenarios.push({ scenario, samples });
      }
      report.results.push({ course, tiles: fixture.ground.tiles.length, resident: fixture.residentTileIds.length,
        courseManifestSha256: courseRef.sha256, groundManifestSha256: courseManifest.groundManifest.sha256,
        inputRevision: fixture.revision, inputSha256: sha(JSON.stringify(fixture)), adapter: fixture.adapter,
        components: fixture.components, statsBefore: fixture.statsBefore, statsAfter: fixture.statsAfter, parity, scenarios });
      await fs.writeFile(path.join(out, arg('--report', parityOnly ? 'terrain-browser-parity.json' : calibration ? 'terrain-calibration.json' : 'terrain-plans.json')), JSON.stringify(report, null, 2) + '\n');
      console.log(`${course}: ${parity.comparisons} exact plans; components ${JSON.stringify(fixture.components)}`);
    } finally { await page.close(); }
  }
  assert.equal(courseSourceRevision(root), revision, 'runtime changed during audit');
} finally { await browser.close(); await server.close(); }
