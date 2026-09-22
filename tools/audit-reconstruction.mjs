#!/usr/bin/env node
// Diagnostic component replay. This does not measure complete boot time or FPS.
// Real startup inputs stay inside the browser, preserving shared ring identities.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';
import { checkMarkerParity } from './reconstruction-marker-check.mjs';
const args = process.argv.slice(2), arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const baseline = arg('--baseline', 'f5f1e18840d83088c9f30f113a347178b8464dc6');
const out = path.resolve(arg('--out', 'output/performance-audit/reconstruction-2026-09-22'));
const only = arg('--courses', '').split(',').filter(Boolean);
const calibration = args.includes('--calibration');
const root = process.cwd(), app = path.join(root, 'apps/golf'), engine = path.join(app, 'src/engine');
const requireApp = createRequire(path.join(app, 'package.json'));
const { createServer } = await import(requireApp.resolve('vite'));
const revision = courseSourceRevision(root);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(await fs.readFile(path.join(app, 'public/courses/index.json')));
assert.ok(only.every(slug => catalog.courses.some(c => c.slug === slug)));
const copies = new Set(['atlas.js', 'exact-class-sdf.mjs', 'ring-index.mjs', 'hole-marker.mjs']);
const dir = path.join(out, 'baseline'); await fs.mkdir(dir, { recursive: true });
const sources = {};
for (const file of copies) {
  const rel = `apps/golf/src/engine/${file}`;
  const original = execFileSync('git', ['show', `${baseline}:${rel}`], { encoding: 'utf8' });
  sources[rel] = { baseline: sha(original), candidate: sha(await fs.readFile(path.join(root, rel))) };
  let source = original.replace(/(from\s*['"]|import\s*['"])(\.\.?\/[^'"]+)(['"])/g, (_, prefix, target, suffix) =>
    `${prefix}${copies.has(path.basename(target)) ? target : path.resolve(engine, target)}${suffix}`);
  if (file === 'atlas.js') source = source.replace('const raster = rasterizeGroundAtlas(options);', 'const raster = rasterizeGroundAtlas(options); globalThis.__auditBaselineRaster = raster;');
  await fs.writeFile(path.join(dir, file), source);
}
const replace = (source, before, after) => { assert.ok(source.includes(before), `instrumentation anchor missing: ${before}`); return source.replace(before, after); };
const server = await createServer({ root: app, configFile: path.join(app, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 8665, strictPort: true },
  resolve: { alias: [{ find: /^three\/webgpu$/, replacement: requireApp.resolve('three/webgpu') }] },
  plugins: [{ name: 'reconstruction-audit-only', enforce: 'pre', transform(source, id) {
    if (id === path.join(engine, 'atlas.js')) {
      source = replace(source, 'export function createGroundAtlas({', 'export function createGroundAtlas(input) { globalThis.__auditInput = input; const result = __createGroundAtlas(input); globalThis.__auditAtlas = result; return result; }\nfunction __createGroundAtlas({');
      source = replace(source, 'const raster = rasterizeGroundAtlas(options);', 'const raster = rasterizeGroundAtlas(options); globalThis.__auditRaster = raster;');
      return replace(source, 'const packed = packClassPlanes(exact);', 'const packed = packClassPlanes(exact); globalThis.__auditExact = exact;');
    }
    if (id === path.join(app, 'src/main.js')) return replace(source, "span('ground atlas (1 m, CORE)', atlasStarted);", "span('ground atlas (1 m, CORE)', atlasStarted); globalThis.__auditReady = { perf: BOOT_PERF }; await new Promise(() => {});");
    if (id === path.join(engine, 'ring-index.mjs')) return replace(source,
      'export function ringSDIndexed(x, z, ring, cutoff = Infinity) {',
      'export function ringSDIndexed(x, z, ring, cutoff = Infinity) { if (!globalThis.__auditReady && cutoff === Infinity) { globalThis.__auditQueryCount = (globalThis.__auditQueryCount || 0) + 1; if (globalThis.__auditQueryCount % 8 === 0 && (globalThis.__auditQueries ||= []).length < 25000) globalThis.__auditQueries.push([x, z, ring]); } return __ringSDIndexed(x, z, ring, cutoff); }\nfunction __ringSDIndexed(x, z, ring, cutoff = Infinity) {');
  } }] });
await server.listen();
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { baseline, revision, calibration, sources, browser: await browser.version(), physicalPhone: false, hardwareFpsMeasured: false,
  mode: 'Vite diagnostic startup stopped after atlas; isolated component replay; SW blocked; no normal-use timing', courses: [] };
try {
  for (const meta of catalog.courses.filter(c => !only.length || only.includes(c.slug))) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`http://127.0.0.1:8665/?bana=${meta.slug}&q=lo&gl=1&qualitylock=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!globalThis.__auditReady, null, { timeout: 180000 });
      assert.deepEqual(errors, [], meta.slug);
      const result = await page.evaluate(async ({ dir, engine, calibration }) => {
        const base = await import(`/@fs${dir}/atlas.js`), next = await import(`/@fs${engine}/atlas.js`);
        const bSdf = await import(`/@fs${dir}/exact-class-sdf.mjs`), nSdf = await import(`/@fs${engine}/exact-class-sdf.mjs`);
        const bRing = await import(`/@fs${dir}/ring-index.mjs`), nRing = await import(`/@fs${engine}/ring-index.mjs`);
        const hash = async array => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(array.buffer, array.byteOffset, array.byteLength)))].map(n => n.toString(16).padStart(2, '0')).join('');
        const fingerprint = async (atlas, raster) => {
          const result = { bounds: atlas.bounds, channels: atlas.exactEdges.channels, arrays: {} };
          for (const [k, a] of Object.entries(raster)) if (ArrayBuffer.isView(a)) result.arrays[`raster.${k}`] = await hash(a);
          for (const [k, a] of atlas.exactEdges.data.planes) result.arrays[`plane.${k}`] = await hash(a);
          result.arrays.ring = await hash(atlas.exactEdges.data.ringBytes);
          result.arrays.classField = await hash(atlas.exactEdges.texF.image.data);
          for (const [i, tex] of atlas.exactEdges.texSdf.entries()) result.arrays[`texture.${i}`] = await hash(tex.image.data);
          return result;
        };
        const input = globalThis.__auditInput, candidate = globalThis.__auditAtlas;
        const original = base.createGroundAtlas(input);
        const fingerprints = { baseline: await fingerprint(original, globalThis.__auditBaselineRaster), candidate: await fingerprint(candidate, globalThis.__auditRaster) };
        if (JSON.stringify(fingerprints.baseline) !== JSON.stringify(fingerprints.candidate)) throw new Error('atlas output mismatch');
        const queries = globalThis.__auditQueries || [];
        for (const [x, z, ring] of queries) if (!Object.is(bRing.ringSDIndexed(x, z, ring), nRing.ringSDIndexed(x, z, ring))) throw new Error('shore query differs');
        const raster = globalThis.__auditBaselineRaster;
        globalThis.__auditReplay = { queries, bRing, nRing: calibration ? bRing : nRing, base, next: calibration ? base : next, bSdf, nSdf: calibration ? bSdf : nSdf, input, raster };
        original.dispose();
        const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return { fingerprint: fingerprints.candidate, exactAtlas: true, shoreSamples: queries.length, shoreCallsSeen: globalThis.__auditQueryCount || 0,
          adapter: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, preparedWater: globalThis.__auditReady.perf.preparedWater ?? null };
      }, { dir, engine, calibration });
      const cdp = await page.context().newCDPSession(page);
      const samples = [];
      for (let round = -2; round < 6; round++) {
        await cdp.send('HeapProfiler.collectGarbage');
        for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          const sample = await page.evaluate(({ variant, round }) => {
            const a = globalThis.__auditReplay, candidate = variant === 'candidate';
            const atlas = candidate ? a.next : a.base, sdf = candidate ? a.nSdf : a.bSdf, ring = candidate ? a.nRing : a.bRing;
            let mowing = 0, packing = 0;
            for (let rep = 0; rep < 3; rep++) {
              // Fresh range identities rebuild their index, as startup does.
              const options = { bounds: a.raster.bounds, owner: a.raster.owner, classes: a.raster.classes,
                holes: structuredClone(a.input.HOLES), ranges: structuredClone(a.input.ranges) };
              let t = performance.now(); globalThis.__auditSink = atlas.mowDirectionBytes(options); mowing += performance.now() - t;
              t = performance.now(); globalThis.__auditSink = sdf.packClassPlanes(globalThis.__auditExact); packing += performance.now() - t;
            }
            let sum = 0; const t = performance.now();
            for (const [x, z, points] of a.queries) sum += ring.ringSDIndexed(x, z, points);
            const shoreline = performance.now() - t; globalThis.__auditSink = sum;
            return { round, variant, mowing: mowing / 3, packing: packing / 3, combined: (mowing + packing) / 3, shoreline };
          }, { variant, round });
          if (round >= 0) samples.push(sample);
        }
      }
      report.courses.push({ course: meta.slug, packSha256: meta.sha256, ...result, samples });
      await fs.writeFile(path.join(out, calibration ? 'component-calibration.json' : 'component-replay.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`${meta.slug}: exact atlas; ${result.shoreSamples} exact sampled shore queries; six paired component batches`);
    } finally { await page.close(); }
  }
  const markerPage = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try { report.marker = await checkMarkerParity(markerPage, { baselineDirectory: dir, engineDirectory: engine, threeModule: requireApp.resolve('three/webgpu') }); } finally { await markerPage.close(); }
  await fs.writeFile(path.join(out, calibration ? 'component-calibration.json' : 'component-replay.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(courseSourceRevision(root), revision, 'runtime changed during audit');
} finally { await browser.close(); await server.close(); }
