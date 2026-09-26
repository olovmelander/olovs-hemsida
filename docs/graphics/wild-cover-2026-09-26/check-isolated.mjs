// The wild cover (wild-cover.mjs) round two woods beside an isolated hole
// (isolated.html), on the app's own ground atlas, material and palette, on WebGL2
// and on WebGPU with reversed depth. Every module the page draws with but the wild
// cover's is main's (checked against the baseline in git), so the scene without it
// is main's:
//  - one draw a tile: the wild cover adds exactly one draw for each of its tiles
//    that is left in and in the eye's frustum, in five views;
//  - where it grows: straight down over the left wood's edge, no scrub or fern
//    stands more than 1.5 m from the forest floor (a plant's reach), and no flower
//    stands more than 0.8 m from ground a tussock could stand on -- off the
//    fairway, the path and the woods -- straight down over the fairway's edge, the
//    rough and the path, nor over the wood's edge;
//  - how far: from 10 m up no flower stands past its fade's end (66 m), and from the
//    hole view 41 m up no fern past 220 m and no scrub past 320 m, with forest floor
//    in view past both;
//  - Höst: the scrub turns red and the ferns rust, and the flowers are gone, pixel
//    for pixel, their tiles left out;
//  - the shade: the plants on the forest floor take the trees' shadows;
//  - the wind: the ferns and the flowers move from frame to frame on the one wind,
//    the scrub stands still; under reduced motion (windSway 0) every read-back
//    settles;
//  - the low quality: half the floor under each tree, the flowers of its own
//    tussocks, and still one draw a tile;
// and pictures through the app's tone mapping, main beside the wild cover. Each
// read-back is drawn until two renders in a row agree (the wind's excepted).
// Software rendering by default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/wild-cover-2026-09-26/check-isolated.mjs
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { WILD_COVER } from '../../../apps/golf/src/engine/wild-cover.mjs';

const dir = 'docs/graphics/wild-cover-2026-09-26';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const baseline = 'f05006e8';
const port = 8766;
/* whole 256-byte rows in both read-backs */
const W = 480, H = 272;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
/* BANVY_PARTS=draws,where,fade,season,shade,wind,lo,pictures runs those parts alone */
const PARTS = new Set((process.env.BANVY_PARTS || 'draws,where,fade,season,shade,wind,lo,pictures').split(','));
const report = { adapter: GPU ? 'gpu' : 'swiftshader', baseline, backends: {} };
let failed = false;
const r4 = v => Math.round(v * 10000) / 10000;

/* every module the page draws with, the wild cover's aside, is main's own */
const PAGE_MODULES = ['atlas.js', 'surface.js', 'ground-material-core.mjs', 'material.js', 'ground-surface-relief.mjs', 'ground-detail-upload.mjs',
  'ground-detail-texture.mjs', 'painted-world-palette.mjs', 'painted-world-lighting.mjs', 'atmospheric-sky.mjs', 'atmosphere-presets.mjs', 'geom.js',
  'exact-class-sdf.mjs', 'one-wind.mjs', 'ground-cover.mjs'];
execFileSync('git', ['diff', '--quiet', baseline, '--', ...PAGE_MODULES.map(f => `apps/golf/src/engine/${f}`)]);

const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
try {
  await new Promise(r => setTimeout(r, 1200));
  const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
    ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
  const check = (backend, label, ok, detail) => {
    report.backends[backend].checks.push({ label, ok, ...detail });
    if (!ok) failed = true;
    console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail).slice(0, 900)}`);
  };
  const decode = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(new Uint8Array(b).buffer); };
  const bytes = s => new Uint8Array(Buffer.from(s, 'base64'));
  /* rgba rows, row 0 at the top whatever the backend's row order */
  const topDown = (px, backend) => {
    if (backend !== 'webgl2') return px;
    const o = new Float32Array(px.length);
    for (let row = 0; row < H; row++) o.set(px.subarray((H - 1 - row) * W * 4, (H - row) * W * 4), row * W * 4);
    return o;
  };
  const lum = (px, i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  /* display luminance: the linear read-back through the palette's 2.2 */
  const disp = (px, i) => Math.pow(Math.max(lum(px, i), 0), 1 / 2.2);
  const diffAt = (a, b, i) => Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2]));
  const compare = (a, b) => {
    let differing = 0, max = 0;
    for (let i = 0; i < W * H; i++) { const d = diffAt(a, b, i); if (d > 0) differing++; if (d > max) max = d; }
    return { pixels: W * H, differing, maxDiff: r4(max) };
  };
  /* the pixels the wild cover changed: well past a half float's last bits */
  const changedList = (a, b) => { const list = []; for (let i = 0; i < W * H; i++) if (diffAt(a, b, i) > 2e-3) list.push(i); return list; };
  const meanDisp = (px, list) => list.reduce((s, i) => s + disp(px, i), 0) / Math.max(1, list.length);
  const meanRgb = (px, list) => [0, 1, 2].map(c => list.reduce((a, i) => a + px[i * 4 + c], 0) / Math.max(1, list.length));
  /* nothing of the wild cover shown: the scene as main draws it */
  const NONE = { floor: false, flowers: false };

  for (const backend of BACKENDS) {
    report.backends[backend] = { checks: [] };
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const errors = [];
    const open = async (quality = 'hi') => {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
      await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}&w=${W}&h=${H}&q=${quality}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
      const ready = await page.evaluate(() => ({ ...window.__result, flowerList: undefined, scrubList: undefined, fernList: undefined }));
      if (!ready.ready) throw new Error(`${backend}: ${ready.error}`);
      const reads = [];
      const read = async options => {
        const r = await page.evaluate(o => window.__scene(o), options);
        reads.push({ settled: r.settled, renders: r.renders });
        return { px: topDown(decode(r.px), backend), settled: r.settled, calls: r.calls, tiles: r.tiles, inView: r.inView };
      };
      const grounds = {};
      /* where each pixel's centre meets the flat ground: x, z and the distance to it */
      const groundOf = async view => (grounds[view] ??= decode(await page.evaluate(v => window.__ground(v), view)));
      const ruleOf = (view, rule, reach) => page.evaluate(([v, r, m]) => window.__rule(v, r, m), [view, rule, reach]).then(bytes);
      return { page, ready, read, reads, groundOf, ruleOf };
    };
    const hi = await open('hi');
    const { ready, read, reads, groundOf, ruleOf } = hi;
    const measures = { planted: ready.planted };

    /* ONE DRAW A TILE: the draws it adds are its tiles left in and in view */
    const drawsOf = async (session, views) => {
      const rows = {};
      for (const view of views) {
        const without = await session.read({ view, preset: 'noon', ...NONE });
        const withIt = await session.read({ view, preset: 'noon' });
        const inView = Object.values(withIt.inView).reduce((a, b) => a + b, 0);
        rows[view] = { added: withIt.calls - without.calls, inView, byKind: withIt.inView, leftIn: withIt.tiles };
      }
      return rows;
    };
    if (PARTS.has('draws')) {
      const rows = await drawsOf(hi, ['tee', 'woodEdge', 'inWood', 'meadowLow', 'overview']);
      const ok = Object.values(rows).every(r => r.added === r.inView) && ['tee', 'woodEdge', 'inWood', 'meadowLow'].every(v => rows[v].inView > 0);
      check(backend, 'the wild cover adds one draw for each of its tiles left in and in view', ok, { tiles: ready.planted.tiles, rows });
      measures.draws = rows;
    }

    /* WHERE IT GROWS: straight down, the trees hidden so the ground shows */
    if (PARTS.has('where')) {
      const rows = {};
      for (const [label, view, kinds, rule, reach] of [
        ['the forest floor over the left wood\'s edge', 'woodTop', { floor: true, flowers: false }, 'floor', 1.5],
        ['the flowers over the left wood\'s edge', 'woodTop', { floor: false, flowers: true }, 'flowers', 0.8],
        ['the flowers over the fairway\'s edge, the rough and the path', 'meadowTop', { floor: false, flowers: true }, 'flowers', 0.8]]) {
        const mask = await ruleOf(view, rule, reach);
        const without = await read({ view, preset: 'noon', trees: false, ...NONE });
        const withIt = await read({ view, preset: 'noon', trees: false, ...kinds });
        const changed = new Set(changedList(without.px, withIt.px));
        let outside = 0, outsideChanged = 0, inside = 0, insideChanged = 0;
        for (let i = 0; i < W * H; i++) {
          if (mask[i] === 0) { outside++; if (changed.has(i)) outsideChanged++; }
          if (mask[i] === 2) { inside++; if (changed.has(i)) insideChanged++; }
        }
        rows[label] = { view, rule, reach, outsidePixels: outside, outsideChanged, insidePixels: inside, insideCovered: r4(insideChanged / Math.max(1, inside)) };
      }
      const [floor, flowersByWood, flowersByFairway] = Object.values(rows);
      const ok = Object.values(rows).every(r => r.outsidePixels > 5000 && r.outsideChanged === 0 && r.insidePixels > 5000)
        && floor.insideCovered > 0.02 && flowersByWood.insideCovered > 0.001 && flowersByFairway.insideCovered > 0.001;
      check(backend, 'no scrub or fern stands off the forest floor, and no flower on the fairway, the path or in the wood; both grow where they may', ok,
        { meadowTopZ: ready.meadowTopZ, rows });
      measures.where = rows;
    }

    /* HOW FAR: a plant stands in front of the ground its pixel looks at, and its root within its reach
       (a clump's heads 0.3 m, a fern's fronds 1 m, a shrub's leaves 0.65 m) of what the pixel shows, so the
       furthest ground behind any of its pixels, and that reach, bound how far off the plants stand */
    if (PARTS.has('fade')) {
      const rows = {};
      for (const [kind, view, reach] of [['flowers', 'flowerFade', 0.3], ['fern', 'overview', 1], ['scrub', 'overview', 0.65]]) {
        const end = WILD_COVER.fade[kind][1];
        const ground = await groundOf(view), mask = await ruleOf(view, kind === 'flowers' ? 'flowers' : 'floor', 0.8);
        const only = { floor: false, flowers: kind === 'flowers', scrub: kind === 'scrub', fern: kind === 'fern' };
        const without = await read({ view, preset: 'noon', trees: false, ...NONE });
        const withIt = await read({ view, preset: 'noon', trees: false, ...only });
        const changed = changedList(without.px, withIt.px);
        /* seen from above its tallest plant, every plant is seen against the ground, never the sky */
        const behind = changed.map(i => ground[i * 3 + 2]), againstSky = behind.filter(t => !Number.isFinite(t)).length;
        const sorted = behind.filter(Number.isFinite).sort((a, b) => a - b);
        let beyond = 0;
        for (let i = 0; i < W * H; i++) if (mask[i] === 2 && ground[i * 3 + 2] > end + 5) beyond++;
        rows[kind] = { view, fadeEnd: end, reach, changed: changed.length, againstSky, furthest: r4(sorted.at(-1) ?? 0),
          nearly: r4(sorted[Math.floor(sorted.length * 0.99)] ?? 0), groundBeyondFade: beyond };
      }
      const ok = Object.values(rows).every(r => r.changed > 30 && r.againstSky === 0 && r.furthest + r.reach < r.fadeEnd && r.groundBeyondFade > 100);
      check(backend, 'no flower stands past 66 m, no fern past 220 m and no scrub past 320 m, with their ground in view past each', ok, { rows });
      measures.fade = rows;
    }

    /* HÖST: the scrub red, the ferns rust, the flowers gone */
    if (PARTS.has('season')) {
      const hueOf = async (preset, only) => {
        const without = await read({ view: 'inWood', preset, ...NONE });
        const withIt = await read({ view: 'inWood', preset, ...only });
        const list = changedList(without.px, withIt.px), rgb = meanRgb(withIt.px, list);
        return { pixels: list.length, rg: r4(rgb[0] / rgb[1]), bg: r4(rgb[2] / rgb[1]) };
      };
      const rows = {
        'scrub, summer': await hueOf('noon', { floor: false, flowers: false, scrub: true }), 'scrub, Höst': await hueOf('host', { floor: false, flowers: false, scrub: true }),
        'ferns, summer': await hueOf('noon', { floor: false, flowers: false, fern: true }), 'ferns, Höst': await hueOf('host', { floor: false, flowers: false, fern: true }),
      };
      const withoutF = await read({ view: 'meadowLow', preset: 'host', ...NONE });
      const withF = await read({ view: 'meadowLow', preset: 'host', floor: false, flowers: true });
      const summerF = await read({ view: 'meadowLow', preset: 'noon', floor: false, flowers: true });
      const gone = { ...compare(withoutF.px, withF.px), addedDraws: withF.calls - withoutF.calls, tilesLeftIn: withF.tiles.flowers, summerTilesLeftIn: summerF.tiles.flowers };
      const ok = rows['scrub, summer'].rg < 0.8 && rows['scrub, Höst'].rg > 1.5 && rows['ferns, summer'].rg < 0.8 && rows['ferns, Höst'].rg > 1.1
        && Object.values(rows).every(r => r.pixels > 300) && gone.differing === 0 && gone.addedDraws === 0 && gone.tilesLeftIn === 0 && gone.summerTilesLeftIn > 0;
      check(backend, 'in Höst the scrub turns red and the ferns rust, and the flowers are gone pixel for pixel, their tiles left out', ok, { rows, flowers: gone });
      measures.season = { rows, flowers: gone };
    }

    /* THE SHADE: the forest floor's plants take the trees' shadows */
    if (PARTS.has('shade')) {
      const only = { floor: true, flowers: false };
      const without = await read({ view: 'inWood', preset: 'noon', ...NONE });
      const shaded = await read({ view: 'inWood', preset: 'noon', ...only });
      const open = await read({ view: 'inWood', preset: 'noon', ...only, treeShadows: false });
      const list = changedList(without.px, shaded.px);
      const detail = { pixels: list.length, shaded: r4(meanDisp(shaded.px, list)), open: r4(meanDisp(open.px, list)) };
      detail.ratio = r4(detail.shaded / detail.open);
      check(backend, 'the forest floor\'s plants take the trees\' shadows', list.length > 1000 && detail.ratio < 0.8, detail);
      measures.shade = detail;
    }

    /* THE WIND moves the ferns and the flowers; the scrub stands; reduced motion holds them all */
    if (PARTS.has('wind')) {
      const detail = {};
      for (const [label, view, only] of [['ferns', 'inWood', { floor: false, flowers: false, fern: true }], ['scrub', 'inWood', { floor: false, flowers: false, scrub: true }],
        ['flowers', 'meadowLow', { floor: false, flowers: true }]]) {
        detail[label] = { still: (await read({ view, preset: 'noon', ...only, sway: 0 })).settled, windy: (await read({ view, preset: 'noon', ...only, sway: 1 })).settled };
      }
      const ok = detail.ferns.still && !detail.ferns.windy && detail.scrub.still && detail.scrub.windy && detail.flowers.still && !detail.flowers.windy;
      check(backend, 'the ferns and the flowers sway on the one wind, the scrub stands, and all stand still under reduced motion', ok, detail);
      measures.wind = detail;
    }

    /* THE LOW QUALITY: half the floor under each tree, the flowers of its own tussocks, one draw a tile */
    if (PARTS.has('lo')) {
      const lo = await open('lo');
      const rows = await drawsOf(lo, ['tee', 'inWood', 'meadowLow']);
      const p = lo.ready.planted, q = ready.planted;
      const detail = { planted: p, floorPerTree: r4((p.candidates / p.trees) / (q.candidates / q.trees)), flowersPerTuft: r4((p.flowerClumps / (p.tufts + p.edge)) / (q.flowerClumps / (q.tufts + q.edge))), rows };
      const ok = p.trees === q.trees && Math.abs(detail.floorPerTree - 0.5) < 0.06 && Math.abs(detail.flowersPerTuft - 1) < 0.12
        && Object.values(rows).every(r => r.added === r.inView && r.inView > 0);
      check(backend, 'low quality: half the floor under each tree, the flowers of its own tussocks, one draw a tile', ok, detail);
      measures.lo = detail;
      reads.push(...lo.reads);
      await lo.page.close();
    }

    /* every read-back but the windy ferns' and flowers' settled; no page errors */
    const unsettled = reads.filter(r => !r.settled).length;
    check(backend, 'no page errors, and every still read-back settled', errors.length === 0 && unsettled === (PARTS.has('wind') ? 2 : 0),
      { errors: errors.slice(0, 5), reads: reads.length, unsettled });
    report.backends[backend].measures = measures;
    await browser.close();
  }

  /* THE BACKENDS AGREE on every measure */
  if (BACKENDS.length === 2) {
    const flat = (o, path = '') => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${path}.${k}`)) : [[path, o]]);
    const a = new Map(flat(report.backends[BACKENDS[0]].measures)), b = new Map(flat(report.backends[BACKENDS[1]].measures));
    /* (each backend's furthest plant pixel is checked against the fade above; it is one pixel's coverage at
       the fade's end under each backend's own multisampling, so the backends compare the 99th percentile.
       For the same reason they do not compare how many pixels the fading plants touch: from 41 m up, the
       scrub and ferns 200-300 m off are under a pixel, and each backend's samples meet them differently) */
    const pairs = [...a].filter(([path]) => b.has(path) && typeof a.get(path) === 'number' && !path.endsWith('.furthest')
      && !/^\.fade\..*\.changed$/.test(path)).map(([path, x]) => [path, x, b.get(path)]);
    const agree = ([path, x, y]) => (/pixels|Pixels|changed|Changed|differing|added|inView|leftIn|byKind|tiles|planted|Draws|LeftIn|beyond|Beyond/.test(path) && Number.isInteger(x)
      ? Math.abs(x - y) <= Math.max(3, 0.1 * Math.max(Math.abs(x), Math.abs(y))) : Math.abs(x - y) <= 0.01 + 0.05 * Math.max(Math.abs(x), Math.abs(y)));
    const worst = pairs.filter(pair => !agree(pair)).slice(0, 8);
    report.agreement = { measures: pairs.length, disagreeing: worst };
    console.log(`${worst.length ? 'FAIL' : 'ok  '} the backends agree over ${pairs.length} measures ${JSON.stringify(worst)}`);
    if (worst.length) failed = true;
  }

  /* PICTURES through the app's tone mapping: main beside the wild cover */
  if (PARTS.has('pictures')) {
    const PW = 640, PH = 360;
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor('webgl2') });
    const page = await browser.newPage({ viewport: { width: PW, height: PH } });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=webgl2&w=${PW}&h=${PH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
    const shots = [];
    const shot = async (label, o) => {
      await page.evaluate(x => window.__show(x), o);
      shots.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
    };
    for (const [label, o] of [['Dag, in the wood', { view: 'inWood', preset: 'noon' }], ['Kväll, the wood\'s edge from the fairway', { view: 'woodEdge', preset: 'golden' }],
      ['Dag, among the flowers', { view: 'meadowLow', preset: 'noon' }], ['Dag, along the fringe', { view: 'fringe', preset: 'noon' }],
      ['Dag, from the tee', { view: 'tee', preset: 'noon' }], ['Höst, in the wood', { view: 'inWood', preset: 'host' }]]) {
      await shot(`${label}: main`, { ...o, ...NONE });
      await shot(`${label}: the wild cover`, o);
    }
    const jpg = await page.evaluate(async ({ list, cols }) => {
      const images = await Promise.all(list.map(async s => { const im = new Image(); im.src = `data:image/png;base64,${s.png}`; await im.decode(); return im; }));
      const w = images[0].width, h = images[0].height, c = document.createElement('canvas');
      c.width = w * cols; c.height = h * Math.ceil(images.length / cols);
      const g = c.getContext('2d');
      images.forEach((im, i) => {
        const x = (i % cols) * w, y = Math.floor(i / cols) * h;
        g.drawImage(im, x, y);
        g.font = '13px sans-serif';
        const tw = g.measureText(list[i].label).width + 10;
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 4, y + 4, tw, 20);
        g.fillStyle = '#fff'; g.fillText(list[i].label, x + 9, y + 18);
      });
      return c.toDataURL('image/jpeg', 0.86).split(',')[1];
    }, { list: shots, cols: 2 });
    fs.writeFileSync(`${dir}/wild-cover.jpg`, Buffer.from(jpg, 'base64'));
    await browser.close();
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
