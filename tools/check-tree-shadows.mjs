#!/usr/bin/env node
/* The tree shadow proof (docs/tree-shadows-zoom.md) on the real shaders:
   each species' mesh and impostor shadow against each other as the sun's box
   grows, the reference build's colour passes against these, and the
   crossfade in both shadows (apps/golf/src/studies/tree-shadow-proof.mjs).
   SwiftShader by default, BANVY_GPU=1 for the real adapter; shading evidence,
   never frame-time evidence.

   node tools/check-tree-shadows.mjs --out output/tree-shadows --ref GIT_REF
     [--backend webgl2|webgpu] [--modes match,thin,colour,fade] [--tier hero|full] [--species 0,2]

   --ref names the build whose tree-impostor.mjs and ghibli-foliage-material.mjs
   are the reference: the colour passes must match it pixel for pixel, and
   `thin` reports its crown shadow as the before. Without it the working tree
   is its own reference. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback;
const out = path.resolve(flag('out', 'output/tree-shadows'));
const ref = flag('ref', null), backend = flag('backend', 'webgl2');
if (!['webgl2', 'webgpu'].includes(backend)) throw new Error('Use --backend webgl2|webgpu');
const query = new URLSearchParams({ modes: flag('modes', 'match,thin,colour,fade'), tier: flag('tier', 'hero') });
if (flag('species', null)) query.set('species', flag('species', ''));
if (backend === 'webgl2') query.set('gl', '1');
const root = path.resolve('apps/golf'), engine = path.join(root, 'src/engine'), dist = path.join(out, 'dist'), models = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });

const require = createRequire(path.join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const PREFIX = 'virtual:tree-shadow-reference/';
const referenceSource = file => {
  const code = ref ? execFileSync('git', ['show', `${ref}:apps/golf/src/engine/${file}`], { encoding: 'utf8', maxBuffer: 16 << 20 })
    : fs.readFileSync(path.join(engine, file), 'utf8');
  /* a virtual module has no directory: its sibling imports resolve into this checkout's engine */
  return code.replace(/from '\.\/([^']+)'/g, (_, name) => `from ${JSON.stringify(path.join(engine, name).replaceAll('\\', '/'))}`);
};
await build({ configFile: false, root, base: '/', publicDir: false, logLevel: 'warn',
  plugins: [{ name: 'tree-shadow-reference', enforce: 'pre',
    resolveId: id => id.startsWith(PREFIX) ? `\0${id}` : null,
    load: id => id.startsWith(`\0${PREFIX}`) ? referenceSource(id.slice(PREFIX.length + 1)) : null }],
  build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: path.join(root, 'tree-shadow-proof.html') } } });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = [dist, models].map(dir => [dir, path.join(dir, pathname)])
    .find(([dir, f]) => f.startsWith(dir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())?.[1];
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const args = browserArgs();
if (backend === 'webgpu') args.push('--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']));
const browser = await chromium.launch({ ...browserExecutable(), args });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); else if (m.text().startsWith('{')) console.log(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/tree-shadow-proof.html?${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.treeShadowProof, null, { timeout: 4 * 3600 * 1000, polling: 1000 });
  const result = await page.evaluate(() => window.treeShadowProof);
  for (const d of result.dumps) fs.writeFileSync(path.join(out, `${d.name}.png`), Buffer.from(d.png));
  const report = { ref: ref || 'working-tree', adapter: GPU ? 'hardware' : 'swiftshader', performanceEvidence: false, query: `${query}`,
    ...result, dumps: result.dumps.map(d => `${d.name}.png`), pageErrors };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 1) + '\n');

  const gate = (ok, label) => { if (!ok) failures.push(label); };
  gate(result.backend === backend, `expected ${backend}, rendered ${result.backend}`);
  gate(!result.errors.length && !pageErrors.filter(e => !/Failed to load resource/.test(e)).length, `page errors: ${[...result.errors, ...pageErrors].join(' | ')}`);
  for (const r of result.colour) gate(r.differingPixels === 0 && r.coveredPixels > 0, `${r.what} view ${r.view}: ${r.differingPixels} pixels differ from the reference`);
  for (const r of result.match) {
    const band = r.texel < 0.26 ? [0.8, 0.85, 1.2] : r.R === 850 && r.mapSize === 2048 ? [0.75, 0.8, 1.25] : null;
    if (band) gate(r.iou >= band[0] && r.massRatio >= band[1] && r.massRatio <= band[2],
      `${r.species} at ${r.elevationDeg} deg, box ${r.R}/${r.mapSize}: impostor against mesh IoU ${r.iou}, darkness ${r.massRatio}`);
  }
  for (const r of result.thin) gate(r.mesh >= 0.75 && r.impostor >= 0.75, `${r.species} box ${r.R}/${r.mapSize}: mesh kept ${r.mesh}, impostor ${r.impostor} of the fine-texel shadow`);
  for (const r of result.fade) {
    const [lo, hi] = /half/.test(r.label) ? [0.35, 0.65] : /in, done/.test(r.label) ? [0.95, 1.05] : [-0.01, 0.05];
    gate(r.shareOfSteady >= lo && r.shareOfSteady <= hi, `${r.label}: ${r.shareOfSteady} of the steady shadow`);
  }
  console.log(JSON.stringify({ backend: result.backend, reversedDepth: result.reversedDepth, adapter: report.adapter, ref: report.ref,
    match: result.match.length, thin: result.thin.length, colour: result.colour.length, fade: result.fade.length, failures }, null, 1));
} finally {
  await browser.close();
  server.close();
}
if (failures.length) process.exitCode = 1;
