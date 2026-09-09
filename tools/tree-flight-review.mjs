#!/usr/bin/env node
/* Real-shader motion and distant-color review on both backends. Software by
   default; never FPS evidence. --ref uses the SAME fixture with older material. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => i % 2 ? pairs : [...pairs, [arg.replace(/^--/, ''), all[i + 1]]], []));
if (!args.out || !args.chrome) throw new Error('Usage: node tools/tree-flight-review.mjs --out DIR --chrome PATH [--ref GIT_REF] [--adapter software|hardware]');
const allowed = new Set(['out', 'chrome', 'ref', 'backend', 'coverage', 'adapter']);
if (process.argv.slice(2).length % 2 || Object.entries(args).some(([key, value]) => !allowed.has(key) || !value)
  || args.backend && !['webgl2', 'webgpu'].includes(args.backend)
  || args.adapter && !['software', 'hardware'].includes(args.adapter)
  || args.coverage && !['0', '1'].includes(args.coverage)) throw new Error('Invalid tree review arguments');
const out = path.resolve(args.out), root = path.resolve('apps/golf');
fs.mkdirSync(out, { recursive: true });
const require = createRequire(path.join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const historical = args.ref ? execFileSync('git', ['show', `${args.ref}:apps/golf/src/engine/tree-impostor.mjs`], { encoding: 'utf8' }) : null;
await build({ configFile: false, root, base: '/', publicDir: false, logLevel: 'warn',
  plugins: historical ? [{ name: 'historical-tree-material', enforce: 'pre', load(id) { if (id.replaceAll('\\', '/') === path.join(root, 'src/engine/tree-impostor.mjs').replaceAll('\\', '/')) return historical; } }] : [],
  build: { outDir: path.join(out, 'dist'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tree-flight-proof.html') } } });
const server = http.createServer((req, res) => {
  const file = path.join(out, 'dist', new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(path.join(out, 'dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const source = historical ?? fs.readFileSync(path.join(root, 'src/engine/tree-impostor.mjs'), 'utf8');
const report = { ref: args.ref || 'working-tree', materialSha256: createHash('sha256').update(source).digest('hex'),
  executionAdapter: args.adapter === 'hardware' ? 'hardware-requested' : 'swiftshader-software', performanceEvidence: false, backends: [] };
const delta = (a, b) => {
  let changed = 0, sum = 0, occupied = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ds = [0, 1, 2].map(k => Math.abs(a[i + k] - b[i + k]));
    if (Math.max(...ds) > 25) changed++;
    sum += ds.reduce((v, x) => v + x, 0);
    if (Math.min(...a.slice(i, i + 3), ...b.slice(i, i + 3)) < 245) occupied++;
  }
  return { changedPixels: changed, occupiedPixels: occupied, changedFraction: changed / Math.max(1, occupied), meanAbsolute: sum / (256 * 256 * 3) };
};
// Render-target RGB is linear. Black over white measures resolved MSAA
// coverage directly; subtract uncovered white before averaging lit color.
const appearance = (lit, silhouette) => {
  let area = 0, opaquePixels = 0, partialPixels = 0;
  const litAlpha = { minimum: 255, nonOpaquePixels: 0 }, silhouetteAlpha = { minimum: 255, nonOpaquePixels: 0 };
  const foreground = [0, 0, 0];
  for (let i = 0; i < silhouette.length; i += 4) {
    const coverage = 1 - (silhouette[i] + silhouette[i + 1] + silhouette[i + 2]) / 765;
    area += coverage;
    if (coverage > 0.99) opaquePixels++;
    else if (coverage > 0.01) partialPixels++;
    for (let k = 0; k < 3; k++) foreground[k] += lit[i + k] / 255 - (1 - coverage);
    for (const [pixels, alpha] of [[lit, litAlpha], [silhouette, silhouetteAlpha]]) {
      alpha.minimum = Math.min(alpha.minimum, pixels[i + 3]);
      if (pixels[i + 3] !== 255) alpha.nonOpaquePixels++;
    }
  }
  const meanCoveredRgb = foreground.map(v => v / Math.max(area, 1e-6));
  return { area, opaquePixels, partialPixels, meanCoveredRgb, litAlpha, silhouetteAlpha,
    meanCoveredLuminance: meanCoveredRgb[0] * 0.2126 + meanCoveredRgb[1] * 0.7152 + meanCoveredRgb[2] * 0.0722 };
};
try {
  for (const backend of args.backend ? [args.backend] : ['webgl2', 'webgpu']) {
    const flags = args.adapter === 'hardware'
      ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--force_high_performance_gpu', '--ignore-gpu-blocklist']
      : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
    if (backend === 'webgpu') {
      flags.push('--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--enable-experimental-web-platform-features');
      if (args.adapter !== 'hardware') flags.push('--use-gpu-in-tests', '--enable-features=UseSkiaRenderer,Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface');
    }
    const browser = await chromium.launch({ executablePath: args.chrome, headless: true, args: flags });
    try {
      const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/tree-flight-proof.html?gl=${backend === 'webgl2' ? 1 : 0}`);
      await page.waitForFunction(() => !!window.treeProof, { timeout: 180000 });
      const actual = await page.evaluate(() => ({ backend: treeProof.backend, samples: treeProof.samples }));
      if (actual.backend !== backend) throw new Error(`Expected ${backend}, got ${actual.backend}`);
      const capture = async options => Buffer.from(await page.evaluate(o => treeProof.capture(o), options), 'base64');
      const pairs = [];
      for (const [name, a, b] of [
        ['repeat-identical-view', { theta: 0 }, { theta: 0 }],
        ['old-polar-boundary', { theta: Math.acos(0.999) - 0.00002 }, { theta: Math.acos(0.999) + 0.00002 }],
        ['across-zenith', { theta: -0.00002 }, { theta: 0.00002 }],
        ['atlas-frame-boundary', { theta: 0.64, azimuth: Math.PI / 4 - 0.00002 }, { theta: 0.64, azimuth: Math.PI / 4 + 0.00002 }],
        ['lit-with-fade-attributes', { theta: -0.00002, lit: true }, { theta: 0.00002, lit: true }],
        ['lit-midfade', { theta: -0.00002, lit: true, fadeCode: 1 }, { theta: 0.00002, lit: true, fadeCode: 1 }],
      ]) {
        const first = await capture({ ...a, coverage: !args.ref && args.coverage !== '0' });
        await page.screenshot({ path: path.join(out, `${backend}-${name}-a.png`) });
        const second = await capture({ ...b, coverage: !args.ref && args.coverage !== '0' });
        await page.screenshot({ path: path.join(out, `${backend}-${name}-b.png`) });
        pairs.push({ name, ...delta(first, second) });
      }
      const edges = [];
      for (const coverage of [false, true]) {
        const areas = [];
        for (let i = 0; i < 16; i++) {
          areas.push(await page.evaluate(o => treeProof.capture(o), { theta: 1.1, distance: 700,
            shift: (i / 16) * (2 * 700 * Math.tan(20 * Math.PI / 180) / 256), coverage, measureOnly: true }));
        }
        const mean = areas.reduce((a, b) => a + b) / areas.length;
        edges.push({ coverage, meanArea: mean, relativeAreaRange: (Math.max(...areas) - Math.min(...areas)) / mean });
      }
      // Non-MSAA readback must still discard empty texels, never an opaque quad.
      const single = await capture({ samples: 0, coverage: true });
      const whiteCorners = [0, 255 * 4, 255 * 256 * 4, (256 * 256 - 1) * 4].every(i => single.slice(i, i + 3).every(v => v >= 250));
      const fadeAreas = [];
      for (const fadeCode of [0, 1, 4]) fadeAreas.push(await page.evaluate(o => treeProof.capture(o), { lit: true, fadeCode, measureOnly: true }));
      const fadeRelativeError = Math.abs(fadeAreas[1] + fadeAreas[2] - fadeAreas[0]) / fadeAreas[0];
      const distantAppearance = [];
      for (const [viewName, theta, azimuth] of [['high', 0.65, 0.3], ['oblique', 1.1, 1.1], ['horizon', 1.45, 2.3]]) {
        for (const [distance, fog] of [[350, false], [700, false], [700, true], [1400, true]]) {
          const measurements = {};
          for (const kind of ['mesh', 'impostor']) {
            const options = { theta, azimuth, distance, kind, lit: true, fog };
            const lit = await capture(options);
            await page.screenshot({ path: path.join(out, `${backend}-distant-${viewName}-${distance}-${fog ? 'fog-' : ''}${kind}.png`) });
            const silhouette = await capture({ ...options, silhouette: true });
            measurements[kind] = appearance(lit, silhouette);
          }
          distantAppearance.push({ view: viewName, theta, azimuth, distance, fog, ...measurements,
            coverageRatio: measurements.impostor.area / measurements.mesh.area,
            luminanceRatio: measurements.impostor.meanCoveredLuminance / measurements.mesh.meanCoveredLuminance });
        }
      }
      const mixedTexelTint = await page.evaluate(() => treeProof.mixedTexelTint());
      const opaqueDisplay = await page.evaluate(() => treeProof.opaqueDisplay());
      await page.screenshot({ path: path.join(out, `${backend}-opaque-aces-display.png`) });
      const result = { ...actual, pairs, edges, whiteCorners, fadeAreas, fadeRelativeError, distantAppearance, mixedTexelTint, opaqueDisplay, errors };
      if (pairs.some(p => p.changedFraction > 0.02) && !args.ref) {
        fs.writeFileSync(path.join(out, `${backend}-lit-shader.json`), JSON.stringify(await page.evaluate(() => treeProof.shader()), null, 2));
      }
      report.backends.push(result);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(result));
      if (errors.length || !whiteCorners || pairs.some(p => p.occupiedPixels < 100)) throw new Error('Shader/readback regression');
      if (!args.ref && pairs.some(p => p.changedFraction > 0.02)) throw new Error('Discontinuous tree view');
      if (!args.ref && edges[1].relativeAreaRange >= edges[0].relativeAreaRange) throw new Error('Coverage increased small-tree area instability');
      if (!args.ref && mixedTexelTint.samples.some(s => s.maxError > mixedTexelTint.tolerance)) throw new Error('Filtered crown/trunk tint drifted from the original surfaces');
      if (!args.ref && distantAppearance.some(v => ['mesh', 'impostor'].some(k => v[k].litAlpha.minimum !== 255 || v[k].silhouetteAlpha.minimum !== 255))) throw new Error('Tree sample coverage made an opaque backdrop translucent');
      if (!args.ref && opaqueDisplay.maxRgbError > opaqueDisplay.tolerance) throw new Error('Tree coverage left an outline in the ACES output');
      if (fadeRelativeError > 0.001) throw new Error('Tree fade masks lost complementary coverage');
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
