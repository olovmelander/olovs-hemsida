// The sky's draw order and the output dither in an isolated scene
// (isolated.html), on WebGL2 and on WebGPU with reversed depth:
//  - the sky drawn last is the same picture as the sky drawn first, pixel for
//    pixel, and still covers everything the hill does not;
//  - the dither moves no channel by more than one level, and does move some.
// Software rendering by default, BANVY_GPU=1 for the real adapter. Run from the
// repository root: node docs/graphics/visual-fixes-2026-09-24/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/visual-fixes-2026-09-24';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const port = 8673;
const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
/* WebGPU on the software adapter needs Vulkan through SwiftShader (as tools/check-tree-shadows.mjs) */
const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
const report = { adapter: GPU ? 'gpu' : 'swiftshader', backends: {} };
let failed = false;
const check = (backend, label, ok, detail) => {
  report.backends[backend].checks.push({ label, ok, ...detail });
  if (!ok) failed = true;
  console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail)}`);
};
try {
  for (const backend of ['webgl2', 'webgpu']) {
    report.backends[backend] = { checks: [] };
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 300000, polling: 500 });
    const result = await page.evaluate(() => window.__result);
    if (result.error) { check(backend, 'renders', false, { error: result.error }); await browser.close(); continue; }
    const { W, H } = result, variants = {};
    /* the order, read from a target on both backends */
    for (const order of ['first', 'last']) variants[`target-${order}`] = { order, pixels: await page.evaluate(o => window.__readTarget(o), order) };
    const shaders = await page.evaluate(() => window.__shaders());
    report.backends[backend].shaders = shaders;
    /* the picture on the canvas, through the output transform and its dither; SwiftShader's
       WebGPU presents no canvas surface here, so that backend is judged on its target
       and on compiling the dithered output without an error */
    for (const name of ['first-plain', 'first-dither', 'last-plain', 'last-dither']) {
      const order = await page.evaluate(name => window.__show(name), name);
      const png = await page.locator('canvas').first().screenshot();
      variants[name] = { order, pixels: await page.evaluate(b64 => window.__decode(b64), png.toString('base64')) };
    }
    await browser.close();
    const px = name => variants[name].pixels;
    const compare = (a, b) => {
      let max = 0, differing = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        max = Math.max(max, d);
        if (d) differing++;
      }
      return { maxLevels: max, differingPixels: differing, pixels: a.length / 4 };
    };
    /* where the sky shows and where the hill does: magenta is the clear colour, the hill is dark green */
    const cover = pixels => {
      let magenta = 0, sky = 0, hill = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (r > 200 && g < 60 && b > 200) magenta++;
        else if (g > r && g > b + 8 && r < 110) hill++;
        else sky++;
      }
      return { magenta, sky, hill };
    };
    const onTarget = cover(px('target-first'));
    check(backend, 'the sky and the hill cover the frame (target)', onTarget.magenta === 0 && onTarget.sky > W * H / 4 && onTarget.hill > W * H / 8, onTarget);
    const targetOrder = compare(px('target-first'), px('target-last'));
    check(backend, 'the sky drawn last is the same picture (target)', targetOrder.maxLevels === 0, targetOrder);
    const onCanvas = cover(px('first-plain'));
    const presents = onCanvas.sky > 0 && onCanvas.hill > 0;
    report.backends[backend].canvasPresents = presents;
    if (backend === 'webgl2' || presents) {
      check(backend, 'the sky and the hill cover the frame (canvas)', onCanvas.magenta === 0 && onCanvas.hill > W * H / 8, onCanvas);
      const order = compare(px('first-plain'), px('last-plain'));
      check(backend, 'the sky drawn last is the same picture (canvas)', order.maxLevels === 0, order);
      const orderDither = compare(px('first-dither'), px('last-dither'));
      check(backend, 'the same with the dither (canvas)', orderDither.maxLevels === 0, orderDither);
      const dither = compare(px('last-plain'), px('last-dither'));
      check(backend, 'the dither moves a channel one level at most, and moves some', dither.maxLevels <= 1 && dither.differingPixels > dither.pixels * 0.05, dither);
    } else console.log(`${backend} note the canvas presents nothing in this container; judged on the target and on errors`);
    check(backend, 'the striped ground compiles and draws with either stripe fade',
      shaders.ground.across.drawn > 0.9 && shaders.ground.iso.drawn > 0.9, shaders.ground);
    /* a stump 50 m up: its own height draws bark with a pale top, as at 0 m; the instanced
       positionLocal the materials read before drew it all cut face */
    const st = shaders.stumps;
    check(backend, 'an instanced stump is coloured by its own height, wherever it stands',
      st['geometry-0'].paleShare < 0.5 && Math.abs(st['geometry-50'].paleShare - st['geometry-0'].paleShare) < 0.05
        && st['local-50'].paleShare > 0.95, st);
    check(backend, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
