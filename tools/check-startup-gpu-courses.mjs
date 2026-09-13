#!/usr/bin/env node
// Every published course must still reach a complete, drawable opening view.
// The full eight-atmosphere image comparison lives in check-course-startup.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8645';
const out = path.resolve(process.argv[3] || 'tools/reference/gpu-startup-courses');
await fs.mkdir(out, { recursive: true });
const catalog = await (await fetch(`${base}/courses/index.json`)).json();
const revision = await (await fetch(`${base}/course-startup-build.json`)).json();
const treeCatalog = await (await fetch(`${base}/models/trees/ghibli-fluffy.json`)).json();
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex < 0 ? [] : process.argv[onlyIndex + 1].split(',');
assert.ok(only.every(slug => catalog.courses.some(course => course.slug === slug)), 'unknown course');
const report = { revision, treeRevision: treeCatalog.revision, physicalPhone: false, timingBenchmark: false, cases: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  for (const course of catalog.courses.filter(course => !only.length || only.includes(course.slug))) for (const mode of [
    { look: '0', gl: '1', q: 'lo', backend: 'webgl2' }, { look: '1', gl: '1', q: 'lo', backend: 'webgl2' },
    { look: '0', gl: '0', q: 'hi', backend: 'webgpu' }, { look: '1', gl: '0', q: 'hi', backend: 'webgpu' },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type()) && /GL_INVALID|GPUValidationError|validation error|shader.*error|pipeline.*failed|buffer.*destroyed/i.test(message.text())) errors.push(message.text());
    });
    try {
      const query = new URLSearchParams({ bana: course.slug, startup: '1', ghibli: mode.look, gl: mode.gl, q: mode.q,
        v2: 'require', det: '1', qualitylock: '1', hal: '1', vy: 'tee', ren: '1' });
      await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('#boot.done', { timeout: 180000 });
      const data = await page.evaluate(() => ({ perf: V3D.perf(), backend: V3D.v2Terrain().backend,
        trees: V3D.stats.trees, audit: V3D.treeTierAudit(), catalogue: V3D.treeCatalogue() }));
      assert.equal(data.backend, mode.backend); assert.ok(data.trees > 0); assert.equal(data.audit.ok, true);
      if (mode.look === '1') {
        assert.equal(data.catalogue.loaded, true, 'painted tree models must load');
        assert.equal(data.catalogue.revision, treeCatalog.revision, 'latest published canopy design');
        const expectedFiles = treeCatalog.species.reduce((sum, species) => sum + (species.foliage ? 1 : 0)
          + species.variants.slice(0, data.catalogue.variants).reduce((n, variant) => n + Object.keys(variant.tiers).length, 0), 0);
        assert.equal(data.catalogue.files, expectedFiles, 'all models and foliage atlases');
      }
      assert.equal(data.perf.courseData.complete, true); assert.deepEqual(data.perf.courseData.fallbackReasons, []);
      assert.equal(data.perf.preparedTint, true);
      assert.equal(Boolean(data.perf.preparedWater), Boolean(course.preparedWater));
      assert.ok(data.perf.gpuPreparation?.completed > 0);
      assert.equal(data.perf.gpuPreparation.completed, data.perf.gpuPreparation.branches);
      assert.ok(data.perf.firstFrames[0].tris > 0);
      const name = `${course.slug}-${mode.backend}-${mode.look}.png`;
      const png = mode.backend === 'webgpu'
        ? Buffer.from((await page.evaluate(() => V3D.captureReadback())).base64, 'base64')
        : await page.locator('body > canvas').screenshot();
      await fs.writeFile(path.join(out, name), png);
      assert.deepEqual(errors, []);
      report.cases.push({ course: course.slug, ...mode, image: name, trees: data.trees,
        catalogue: data.catalogue, preparation: data.perf.gpuPreparation, verifiedChunks: data.perf.courseData.verified });
      console.log(`${course.slug} ${mode.backend} look=${mode.look}: complete, drawn, tree tiers valid`);
    } catch (error) { report.errors.push({ course: course.slug, ...mode, error: error.stack, browserErrors: errors }); }
    finally { await page.close(); }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
} finally { await browser.close(); }
assert.deepEqual(await (await fetch(`${base}/course-startup-build.json`)).json(), revision, 'served build changed');
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors }, null, 2));
if (report.errors.length) process.exitCode = 1;
