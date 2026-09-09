#!/usr/bin/env node
/* Render the actual class-SDF material around decoded terrain normals.
 * node tools/v2-material-relief-review.mjs --root BUILT_PROOF --out OUTPUT --chrome CHROMIUM
 * Synthetic correctness evidence only; never use SwiftShader times as device FPS. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { decodePNG } from '../geobuild/png.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!['root', 'out', 'chrome'].includes(key) || !process.argv[i + 1]) throw new Error('Expected --root, --out and optional --chrome');
  options[key] = process.argv[i + 1];
}
if (!options.root || !options.out) throw new Error('--root and --out are required');
const root = fs.realpathSync(options.root), out = path.resolve(options.out);
fs.mkdirSync(out, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const server = createServer((req, res) => {
  try {
    const file = fs.realpathSync(path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
    if (!file.startsWith(root + path.sep)) throw new Error('Outside proof');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = { schemaVersion: 1, date: new Date().toISOString(), executionAdapter: 'swiftshader',
  performanceEvidence: false, viewport: [640, 480], cases: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ ...(options.chrome ? { executablePath: options.chrome } : {}), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-unsafe-webgpu',
      '--enable-webgpu-developer-features', '--use-gpu-in-tests', '--enable-features=UseSkiaRenderer,Vulkan',
      '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'] });
  report.browser = browser.version();
  for (const backend of ['webgl2', 'webgpu']) {
    let baseline;
    for (const tier of ['off', 'low', 'high']) {
      const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(`http://127.0.0.1:${server.address().port}/v2-terrain-proof.html?materialProof=1&surfaceRelief=${tier}&gl=${backend === 'webgl2' ? 1 : 0}`);
      await page.waitForFunction(() => window.V3D, null, { timeout: 60000 });
      const state = await page.evaluate(() => ({ stats: window.V3D.stats, error: window.V3D.error, shader: window.V3D.shader }));
      if (state.error || errors.length || state.stats?.backend !== backend) throw new Error(JSON.stringify({ backend, tier, state, errors }));
      await page.evaluate(() => window.V3D.prepareCapture());
      let bytes;
      if (backend === 'webgpu') {
        const capture = await page.evaluate(() => window.V3D.captureReadback());
        bytes = Buffer.from(capture.base64, 'base64');
      } else bytes = await page.locator('canvas').first().screenshot();
      const file = `${backend}-${tier}.png`;
      fs.writeFileSync(path.join(out, file), bytes);
      const pixels = decodePNG(bytes), colours = new Set();
      for (let y = 180; y < 420; y += 2) for (let x = 100; x < 540; x += 2) {
        const o = (y * pixels.width + x) * pixels.channels;
        colours.add(Array.from(pixels.data.subarray(o, o + 3)).join(','));
      }
      if (colours.size < 50) throw new Error('Material proof is blank');
      const row = { backend, tier, file, imageSha256: hash(bytes), stats: state.stats, errors, centralColours: colours.size };
      if (state.shader) {
        const vertex = state.shader.vertexShader, fragment = state.shader.fragmentShader;
        // Fragment additions can renumber Three's generated temporaries and
        // extend the shared uniform block. Compare the vertex entry point with
        // only temporary names canonicalised; retain all operations and inputs.
        const temporaries = new Map();
        const mainBody = vertex.slice(vertex.indexOf('@vertex')).replace(/\b(?:VERTEX_)?nodeVar\d+\b/g, name => {
          if (!temporaries.has(name)) temporaries.set(name, `temporary${temporaries.size}`);
          return temporaries.get(name);
        });
        row.shader = { vertexSha256: hash(vertex), vertexMainSha256: hash(mainBody), textureSamples: (fragment.match(/textureSample\w*\(/g) || []).length,
          dx: (fragment.match(/dpdx\(/g) || []).length, dy: (fragment.match(/dpdy\(/g) || []).length };
        fs.writeFileSync(path.join(out, `${backend}-${tier}.wgsl`), fragment);
        fs.writeFileSync(path.join(out, `${backend}-${tier}.vertex.wgsl`), vertex);
      }
      if (tier === 'off') baseline = row;
      else {
        if (row.stats.triangles !== baseline.stats.triangles || row.stats.drawCalls !== baseline.stats.drawCalls ||
          row.stats.textureCapacityBytes !== baseline.stats.textureCapacityBytes || row.imageSha256 === baseline.imageSha256) {
          throw new Error('Relief changed geometry/allocation or produced no image change');
        }
        if (row.shader && (row.shader.vertexMainSha256 !== baseline.shader.vertexMainSha256 || row.shader.textureSamples !== baseline.shader.textureSamples)) {
          throw new Error(`Relief changed vertex main or added texture samples: ${JSON.stringify({ baseline: baseline.shader, candidate: row.shader })}`);
        }
      }
      report.cases.push(row);
      console.log(`${backend} ${tier}: ${row.stats.triangles} triangles, ${colours.size} colours`);
      await page.close();
    }
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
