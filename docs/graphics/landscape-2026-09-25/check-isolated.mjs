// The landscape batch's shaders in isolated scenes (isolated.html), on WebGL2
// and on WebGPU with reversed depth, each against its before:
//  - the stands: a closed forest of the approved crowns' impostors, tinted by
//    the player's own tint -- broad washes across it where there was speckle;
//  - the surfaces: fairway unchanged, a green glossier and a rough more matte,
//    a bunker's lip darker and warmer, a path grown in at its edges and worn in
//    its middle, deep sand and the ground beside the path untouched;
//  - the relief: open ground bit for bit the before, sheltered ground darker
//    on every surface, an exposed crest drier on natural ground only.
// Software rendering by default, BANVY_GPU=1 for the real adapter. Run from the
// repository root: node docs/graphics/landscape-2026-09-25/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/landscape-2026-09-25';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const port = 8689;
const W = 480, H = 270;
const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
const report = { adapter: GPU ? 'gpu' : 'swiftshader', backends: {} };
let failed = false;
const check = (backend, label, ok, detail) => {
  report.backends[backend].checks.push({ label, ok, ...detail });
  if (!ok) failed = true;
  console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail)}`);
};
const r4 = v => Math.round(v * 1e4) / 1e4;
/* the forest's warmth, (r - b) / (r + g + b), in 24 px blocks: its spread across blocks, and within them */
const blockSpread = (px, n = 24) => {
  const means = [], within = [];
  for (let by = 0; by + n <= H; by += n) for (let bx = 0; bx + n <= W; bx += n) {
    const v = [];
    for (let y = by; y < by + n; y++) for (let x = bx; x < bx + n; x++) {
      const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], t = r + g + b;
      if (r > 0.9 && g < 0.1 && b > 0.9) continue;
      if (t > 1e-4) v.push((r - b) / t);
    }
    if (v.length < n * n * 0.6) continue;
    const m = v.reduce((a, c) => a + c, 0) / v.length;
    means.push(m);
    within.push(Math.sqrt(v.reduce((a, c) => a + (c - m) ** 2, 0) / v.length));
  }
  const mm = means.reduce((a, c) => a + c, 0) / means.length;
  return { blocks: means.length, across: r4(Math.sqrt(means.reduce((a, c) => a + (c - mm) ** 2, 0) / means.length)),
    within: r4(within.reduce((a, c) => a + c, 0) / within.length) };
};
/* a strip region's mean linear colour: x in metres (the view spans -24..24 at 10 px a metre), the middle 150 rows (z symmetric) */
const region = (px, x0, x1) => {
  const c0 = Math.ceil((x0 + 24) * 10), c1 = Math.floor((x1 + 24) * 10), sum = [0, 0, 0];
  let n = 0;
  for (let row = 60; row < 210; row++) for (let c = c0; c < c1; c++) {
    const i = (row * W + c) * 4;
    sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; n++;
  }
  return sum.map(v => v / n);
};
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
const shots = [];
try {
  for (const backend of ['webgl2', 'webgpu']) {
    report.backends[backend] = { checks: [] };
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 500 });
    const result = await page.evaluate(() => window.__result);
    if (result.error) { check(backend, 'renders', false, { error: result.error }); await browser.close(); continue; }
    const picture = async label => { if (backend === 'webgl2') shots.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') }); };

    /* the stands */
    const stands = {};
    for (const preset of ['noon', 'golden']) {
      const before = blockSpread(await page.evaluate(a => window.__stands(a), { stands: false, preset }));
      const after = blockSpread(await page.evaluate(a => window.__stands(a), { stands: true, preset }));
      stands[preset] = { before, after, acrossGain: r4(after.across / before.across - 1) };
      for (const on of [false, true]) { await page.evaluate(a => window.__stands(a), { stands: on, preset, picture: true }); await picture(`${preset} ${on ? 'stands' : 'before'}`); }
    }
    check(backend, 'the forest shows broad washes where it was speckled: block-scale warmth spread up a quarter or more',
      Object.values(stands).every(s => s.acrossGain > 0.25 && s.after.blocks > 60), { trees: result.trees, ...stands });

    /* the surfaces and the relief, from straight above at noon */
    const px = {};
    for (const [key, args] of Object.entries({ before: { gloss: false, edges: false }, gloss: { gloss: true, edges: false }, edges: { gloss: false, edges: true },
      open: { gloss: false, edges: false, relief: true, reliefByte: 128 }, shelter: { gloss: false, edges: false, relief: true, reliefByte: 52 },
      exposed: { gloss: false, edges: false, relief: true, reliefByte: 230 } })) {
      px[key] = await page.evaluate(a => window.__ground(a), { ...args, preset: 'noon' });
    }
    const R = (key, x0, x1) => region(px[key], x0, x1);
    const gloss = {
      fairway: { before: R('before', -21, -17).map(r4), gloss: R('gloss', -21, -17).map(r4) },
      green: { lumGain: r4(lum(R('gloss', -11, -7)) / lum(R('before', -11, -7)) - 1) },
      rough: { lumGain: r4(lum(R('gloss', 15, 21)) / lum(R('before', 15, 21)) - 1) },
    };
    check(backend, 'a fairway is unchanged, a green takes more of the sun and rough less', same(gloss.fairway.before, gloss.fairway.gloss)
      && gloss.green.lumGain > 0.01 && gloss.rough.lumGain < -0.01, gloss);
    const lip = R('edges', -3, -2.7), lipBefore = R('before', -3, -2.7);
    const edges = {
      lip: { lumGain: r4(lum(lip) / lum(lipBefore) - 1), blueGain: r4(lip[2] / lipBefore[2] - 1), redGain: r4(lip[0] / lipBefore[0] - 1) },
      deepSand: same(R('edges', 0, 2), R('before', 0, 2)),
      pathEdge: { greenness: r4(R('edges', 8, 8.3)[1] / (R('edges', 8, 8.3)[0] + R('edges', 8, 8.3)[2])), before: r4(R('before', 8, 8.3)[1] / (R('before', 8, 8.3)[0] + R('before', 8, 8.3)[2])) },
      pathMiddle: { lumGain: r4(lum(R('edges', 9.2, 9.8)) / lum(R('before', 9.2, 9.8)) - 1) },
      beside: same(R('edges', 15, 21), R('before', 15, 21)),
    };
    check(backend, 'a bunker lip is darker and warmer, a path grown in at its edges and paler in its middle, the rest untouched',
      edges.lip.lumGain < -0.05 && edges.lip.blueGain < edges.lip.redGain && edges.deepSand
        && edges.pathEdge.greenness > edges.pathEdge.before * 1.15 && edges.pathMiddle.lumGain > 0.03 && edges.beside, edges);
    const classes = { fairway: [-21, -17], green: [-11, -7], sand: [0, 2], rough: [15, 21] };
    const relief = Object.fromEntries(Object.entries(classes).map(([name, [x0, x1]]) => {
      const o = R('open', x0, x1), b = R('before', x0, x1), s = R('shelter', x0, x1), e = R('exposed', x0, x1);
      return [name, { openIsBefore: same(o, b), shelter: s.map((v, c) => r4(v / o[c])), exposed: e.map((v, c) => r4(v / o[c])) }];
    }));
    check(backend, 'open ground is the before; sheltered ground is darker on every surface; a crest dries natural ground only',
      Object.values(relief).every(r => r.openIsBefore && lum(r.shelter) < 0.9)
        && ['fairway', 'green', 'sand'].every(k => relief[k].exposed.every(v => Math.abs(v - 1) < 1e-4))
        && relief.rough.exposed[0] > 1.02 && relief.rough.exposed[2] < 0.99, relief);
    if (backend === 'webgl2') for (const view of ['across', 'lip', 'path']) for (const on of [false, true]) {
      await page.evaluate(a => window.__ground(a), { gloss: on, edges: on, relief: on, preset: 'noon', picture: true, view });
      await picture(`surfaces ${view} ${on ? 'after' : 'before'}`);
    }
    check(backend, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    if (backend === 'webgl2' && shots.length) {
      const jpg = await page.evaluate(async shots => {
        const images = await Promise.all(shots.map(async s => { const im = new Image(); im.src = `data:image/png;base64,${s.png}`; await im.decode(); return im; }));
        const w = images[0].width, h = images[0].height, c = document.createElement('canvas');
        c.width = w * 2; c.height = h * Math.ceil(images.length / 2);
        const g = c.getContext('2d');
        images.forEach((im, i) => {
          const x = (i % 2) * w, y = Math.floor(i / 2) * h;
          g.drawImage(im, x, y);
          g.font = '14px sans-serif';
          const width = g.measureText(shots[i].label).width + 12;
          g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + 6, y + 6, width, 22);
          g.fillStyle = '#fff'; g.fillText(shots[i].label, x + 12, y + 22);
        });
        return c.toDataURL('image/jpeg', 0.86).split(',')[1];
      }, shots);
      fs.writeFileSync(`${dir}/stands-and-surfaces.jpg`, Buffer.from(jpg, 'base64'));
    }
    await browser.close();
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
