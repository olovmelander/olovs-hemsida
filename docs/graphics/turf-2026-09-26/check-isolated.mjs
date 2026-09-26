// The turf batch in an isolated hole (isolated.html) on the app's own exact-edge
// atlas and ground material, on WebGL2 and on WebGPU with reversed depth, beside
// main's own ground material -- generated from git at the baseline, drawn in the
// same page over the same atlas and textures:
//  - the befores: with ?turfgrain=0, ?groundwear=0 and ?bareground=0 the ground
//    is main's, pixel for pixel, in seventeen views and lights -- the ground
//    batch's six, a player's on the tee, the tee, the green's surround, the
//    fairway and the green close, the rock and the soil from above (lit and in
//    their classes' colours), the hollow in the storm and the mist, and the hole
//    view at golden hour;
//  - the taps: main's ground reads the detail texture seven times a pixel, the
//    befores seven, the batch four;
//  - the grain: close from above, the fairway's lit luminance varies about 2% of
//    display either side (its colour 2.5%; the sheen over it takes some),
//    where main's barely did; the green's stays under 1%; across the wide
//    fairway the broad blotch is about 2.5 times main's, and the fairway and
//    the rough keep their mean tone;
//  - no shimmer: past 80 m the fairway's step from one pixel to the next, and
//    its change when the view moves half a pixel sideways, are main's; along
//    the view, where a pixel spans metres, the stronger broad blotch changes in
//    proportion to the shift, as smoothly as main's own;
//  - the wear: about 1% of the tee's middle is scarred toward soil and sand
//    (2% touched at all), and none of its outer half metre; the ground
//    1.2-2.6 m from the green's and the tee's edge is paler and yellower, in
//    worn patches, the green and the ground past 5 m untouched (within a half
//    float's last bits);
//  - the damp: in the storm the sheltered hollow darkens and cools, the open
//    ground round it untouched; the mist does 0.6 of it; no other light any;
//  - the bare ground: rock, soil and mud mottle in soft blotches, 4-7% of
//    display luminance either side as lit, where main's were near flat, and the
//    rock's straight edges wander about 7-13 cm, where main's ran straight;
// and pictures through the app's tone mapping, main beside the batch. Each
// read-back is drawn until two renders in a row agree. Software rendering by
// default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/turf-2026-09-26/check-isolated.mjs
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/turf-2026-09-26';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const baseline = 'f08e68ac';
const port = 8753;
/* whole 256-byte rows in both read-backs */
const W = 480, H = 272;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
/* BANVY_PARTS=before,taps,grain,shimmer,wear,damp,bare,pictures runs those parts alone */
const PARTS = new Set((process.env.BANVY_PARTS || 'before,taps,grain,shimmer,wear,damp,bare,pictures').split(','));
const report = { adapter: GPU ? 'gpu' : 'swiftshader', baseline, backends: {} };
let failed = false;
const r4 = v => Math.round(v * 10000) / 10000;

/* ------------------------------------------------------------------ MAIN'S GROUND MATERIAL, FROM GIT */
const CHANGED = ['ground-material-core.mjs', 'material.js'];
/* every other module the page draws with is main's own */
const PAGE_MODULES = ['atlas.js', 'surface.js', 'ground-surface-relief.mjs', 'ground-detail-upload.mjs', 'ground-detail-texture.mjs',
  'painted-world-palette.mjs', 'atmospheric-sky.mjs', 'atmosphere-presets.mjs', 'geom.js', 'exact-class-sdf.mjs'];
execFileSync('git', ['diff', '--quiet', baseline, '--', ...PAGE_MODULES.map(f => `apps/golf/src/engine/${f}`)]);
/* ...but for the lights' uniforms, which main's material reads from the page's own module: the batch only adds to it */
const lighting = execFileSync('git', ['diff', '-U0', baseline, '--', 'apps/golf/src/engine/painted-world-lighting.mjs'], { encoding: 'utf8' });
const removed = lighting.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---'));
if (removed.length) throw new Error(`painted-world-lighting.mjs changed main's lines: ${removed.join(' | ')}`);
const genOf = file => `main-${file.replace(/\.m?js$/, '')}.gen.mjs`;
for (const file of CHANGED) {
  let source = execFileSync('git', ['show', `${baseline}:apps/golf/src/engine/${file}`], { encoding: 'utf8' })
    .replaceAll("from './", "from '../../../apps/golf/src/engine/")
    .replaceAll("from 'three/webgpu'", "from '../../../apps/golf/node_modules/three/build/three.webgpu.js'")
    .replaceAll("from 'three/tsl'", "from '../../../apps/golf/node_modules/three/build/three.tsl.js'");
  for (const other of CHANGED) source = source.replaceAll(`from '../../../apps/golf/src/engine/${other}'`, `from './${genOf(other)}'`);
  fs.writeFileSync(`${dir}/${genOf(file)}`, `// generated by check-isolated.mjs from ${file} at ${baseline}; not committed\n${source}`);
}

const NONE = { turfGrain: false, groundWear: false, bareGround: false };
const DRY = { turfGrain: true, groundWear: false, bareGround: true };
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
  const compare = (a, b, where = () => true) => {
    let differing = 0, max = 0, n = 0;
    for (let i = 0; i < W * H; i++) {
      if (!where(i)) continue;
      n++;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i * 4 + c] - b[i * 4 + c]));
      if (d > 0) differing++;
      if (d > max) max = d;
    }
    return { pixels: n, differing, maxDiff: r4(max) };
  };
  /* over the pixels `list`: display luminance's mean and its spread either side, as a share of the mean */
  const spread = (px, list) => {
    let s = 0, q = 0;
    for (const i of list) { const d = disp(px, i); s += d; q += d * d; }
    const mean = s / list.length;
    return { pixels: list.length, mean: r4(mean), cv: r4(Math.sqrt(Math.max(0, q / list.length - mean * mean)) / mean) };
  };
  const meanRgb = (px, list) => [0, 1, 2].map(c => list.reduce((a, i) => a + px[i * 4 + c], 0) / list.length);
  const hue = rgb => ({ rg: r4(rgb[0] / rgb[1]), bg: r4(rgb[2] / rgb[1]) });

  for (const backend of BACKENDS) {
    report.backends[backend] = { checks: [] };
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}&w=${W}&h=${H}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
    const ready = await page.evaluate(() => window.__result);
    if (!ready.ready || !ready.main) throw new Error(`${backend}: ${ready.error || 'main\'s ground material missing'}`);
    const hole = ready.hole;
    const reads = [];
    const read = async options => {
      const r = await page.evaluate(o => window.__hole(o), options);
      reads.push({ settled: r.settled, renders: r.renders });
      return topDown(decode(r.px), backend);
    };
    const grounds = {};
    const groundOf = async view => (grounds[view] ??= decode(await page.evaluate(v => window.__ground(v), view)));
    /* the pixels whose ground point passes `test(x, z)` */
    const where = (ground, test) => { const list = []; for (let i = 0; i < W * H; i++) { const x = ground[i * 2], z = ground[i * 2 + 1]; if (Number.isFinite(x) && test(x, z)) list.push(i); } return list; };
    const measures = {};

    /* THE BEFORES ARE MAIN'S */
    if (PARTS.has('before')) {
      const rows = {};
      for (const [view, preset, debug] of [['tee', 'noon'], ['tee', 'golden'], ['tee', 'noon', true], ['wide', 'noon'], ['beside', 'noon'], ['mud', 'noon'],
        ['teeEye', 'noon'], ['teeTop', 'noon'], ['greenTop', 'noon'], ['fairTop', 'noon'], ['greenIn', 'noon'], ['rockTop', 'noon'], ['rockTop', 'noon', true],
        ['dirtTop', 'noon'], ['damp', 'storm'], ['damp', 'mist'], ['overview', 'golden']]) {
        const key = `${view}/${preset}${debug ? '/weights' : ''}`;
        const main = await read({ version: 'main', view, preset, debug });
        rows[key] = { before: compare(await read({ version: 'now', switches: NONE, view, preset, debug }), main),
          now: compare(await read({ version: 'now', view, preset, debug }), main) };
      }
      check(backend, 'with ?turfgrain=0, ?groundwear=0 and ?bareground=0 the ground is main\'s, pixel for pixel, and the batch\'s is not',
        Object.values(rows).every(r => r.before.differing === 0) && Object.values(rows).filter(r => r.now.differing > 0).length >= 15, rows);
    }

    /* THE TAPS */
    if (PARTS.has('taps')) {
      const taps = await page.evaluate(() => window.__taps());
      measures.taps = { main: taps.main, before: taps.before, now: taps.now };
      check(backend, 'main\'s ground reads the detail texture seven times a pixel, the befores seven, the batch four',
        taps.main === 7 && taps.before === 7 && taps.now === 4 && JSON.stringify(taps.groundDetail) === JSON.stringify({ turfGrain: true, groundWear: true, bareGround: true }), taps);
    }

    /* THE GRAIN: from above, no stripes (a millionth of the mowing: the same material with no pass to see) */
    if (PARTS.has('grain')) {
      const close = {};
      for (const view of ['fairTop', 'greenIn']) {
        const ground = await groundOf(view);
        const list = view === 'fairTop' ? where(ground, () => true) : where(ground, (x, z) => Math.hypot(x, z - 375) < 14);
        close[view] = {};
        for (const [name, o] of [['main', { version: 'main' }], ['now', { version: 'now' }]]) close[view][name] = spread(await read({ ...o, view, preset: 'noon', mowStrength: 1e-6 }), list);
      }
      /* the wide fairway: its 8 m blocks' means (the broad blotch), and the fairway's and the rough's mean tone */
      const ground = await groundOf('wide');
      const fair = where(ground, (x, z) => Math.abs(x) < 44 && z > 192 && z < 268 && Math.hypot(x - 12, z - 150) > 6);
      const rough = where(ground, (x, z) => Math.abs(x) > 48 && z > 185 && z < 275);
      const wide = {};
      for (const [name, o] of [['main', { version: 'main' }], ['now', { version: 'now' }]]) {
        const px = await read({ ...o, view: 'wide', preset: 'noon', mowStrength: 1e-6 });
        const blocks = new Map();
        for (const i of fair) { const key = `${Math.floor(ground[i * 2] / 8)},${Math.floor(ground[i * 2 + 1] / 8)}`; const b = blocks.get(key) || [0, 0]; b[0] += disp(px, i); b[1]++; blocks.set(key, b); }
        const means = [...blocks.values()].filter(b => b[1] > 100).map(b => b[0] / b[1]);
        const m = means.reduce((a, v) => a + v, 0) / means.length;
        wide[name] = { fairway: spread(px, fair).mean, rough: spread(px, rough).mean, blocks: means.length,
          blockSpread: r4(Math.sqrt(means.reduce((a, v) => a + (v - m) ** 2, 0) / means.length) / m) };
      }
      const toneKept = { fairway: r4(wide.now.fairway / wide.main.fairway - 1), rough: r4(wide.now.rough / wide.main.rough - 1) };
      measures.grain = { close, wide, toneKept };
      /* the grain is 2.5% of the turf's colour either side; the sheen, the same over it, takes some of that from what is lit */
      check(backend, 'close from above the fairway\'s grain is about 2% of display luminance either side as lit, where main\'s barely was; the green\'s under 1%',
        close.fairTop.now.cv > 0.015 && close.fairTop.now.cv < 0.03 && close.fairTop.now.cv > 2.5 * close.fairTop.main.cv
          && close.greenIn.now.cv < 0.01, close);
      check(backend, 'across the wide fairway the broad blotch is about 2.5 times main\'s, and the fairway and the rough keep their tone',
        wide.now.blockSpread > 2 * wide.main.blockSpread && Math.abs(toneKept.fairway) < 0.005 && Math.abs(toneKept.rough) < 0.005, { wide, toneKept });
    }

    /* NO SHIMMER. From the tee at golden hour, mown as the app mows, the whole view shifted by a quarter and
       a half pixel: sideways, where a texture finer than the pixel would flicker, and along the view, where a
       pixel spans metres of ground. A smooth pattern changes in proportion to the shift; an aliased one about
       as much for a quarter pixel as for a half. */
    if (PARTS.has('shimmer')) {
      const ground = await groundOf('tee');
      const bands = [[40, 80], [80, 160], [160, 340]];
      const lists = bands.map(([z0, z1]) => where(ground, (x, z) => z > z0 && z < z1 && Math.abs(x) < 18));
      const shimmer = {};
      for (const [name, o] of [['main', { version: 'main' }], ['now', { version: 'now' }]]) {
        const a = await read({ ...o, view: 'tee', preset: 'golden' });
        shimmer[name] = {};
        for (const [label, shift] of [['sideways 1/2', [0.5, 0]], ['sideways 1/4', [0.25, 0]], ['along 1/2', [0, 0.5]], ['along 1/4', [0, 0.25]]]) {
          const b = await read({ ...o, view: 'tee', preset: 'golden', shift });
          bands.forEach(([z0, z1], k) => {
            let sum = 0; for (const i of lists[k]) sum += Math.abs(disp(a, i) - disp(b, i)) / Math.max(disp(a, i), 1e-4);
            (shimmer[name][`${z0}-${z1} m`] ??= {})[label] = r4(sum / lists[k].length);
          });
        }
        /* the texture's own step from one pixel to the next across the view */
        bands.forEach(([z0, z1], k) => {
          let sum = 0; for (const i of lists[k]) sum += Math.abs(disp(a, i) - disp(a, i + 1)) / Math.max(disp(a, i), 1e-4);
          shimmer[name][`${z0}-${z1} m`].step = r4(sum / lists[k].length);
        });
      }
      measures.shimmer = shimmer;
      const far = ['80-160 m', '160-340 m'];
      check(backend, 'past 80 m the fairway takes no finer texture than main\'s: its step across the view and its change for a sideways half pixel are main\'s',
        far.every(k => shimmer.now[k].step <= shimmer.main[k].step * 1.1 + 0.0002 && shimmer.now[k]['sideways 1/2'] <= shimmer.main[k]['sideways 1/2'] * 1.25 + 0.0002), shimmer);
      /* along the view the stronger broad blotch slides with the view: in proportion to the shift, as main's own does */
      const smooth = (v, k) => r4(shimmer[v][k]['along 1/2'] / shimmer[v][k]['along 1/4']);
      check(backend, 'along the view the stronger broad blotch changes in proportion to the shift, as smoothly as main\'s',
        far.every(k => smooth('now', k) >= smooth('main', k) - 0.1 && smooth('now', k) > 1.4),
        Object.fromEntries(far.map(k => [k, { main: smooth('main', k), now: smooth('now', k) }])));
    }

    /* THE WEAR: the tee's divots and the walk round the green and the tee, against the batch without its wear */
    if (PARTS.has('wear')) {
      const [tx0, tz0, tx1, tz1] = hole.tee;
      const inTee = (x, z) => Math.min(x - tx0, tx1 - x, z - tz0, tz1 - z);
      const teeGround = await groundOf('teeTop');
      const teeNow = await read({ version: 'now', view: 'teeTop', preset: 'noon' }), teeDry = await read({ version: 'now', switches: DRY, view: 'teeTop', preset: 'noon' });
      const middle = where(teeGround, (x, z) => inTee(x, z) > 1.5), rim = where(teeGround, (x, z) => inTee(x, z) > 0.1 && inTee(x, z) < 0.5);
      /* touched: a change of 1% in display luminance or in red over green; scarred: red over green risen by half the
         deepest scar's rise or more (the scars are soft, the crests of a smooth field) */
      const rise = i => teeNow[i * 4] / teeNow[i * 4 + 1] - teeDry[i * 4] / teeDry[i * 4 + 1];
      const touched = list => list.filter(i => Math.abs(disp(teeNow, i) / disp(teeDry, i) - 1) > 0.01 || Math.abs(rise(i)) > 0.01);
      const rises = middle.map(rise).sort((a, b) => a - b), deepest = rises[Math.floor(rises.length * 0.999)];
      const scars = middle.filter(i => rise(i) >= deepest / 2), marks = touched(middle);
      const divots = { middle: middle.length, touched: r4(marks.length / middle.length), scarred: r4(scars.length / middle.length), deepestRise: r4(deepest),
        rimTouched: touched(rim).length, rim: rim.length, scar: { now: hue(meanRgb(teeNow, scars)), without: hue(meanRgb(teeDry, scars)) } };
      /* the rough round the tee, 1.2-2.6 m out from its edge */
      const teeBand = where(teeGround, (x, z) => -inTee(x, z) > 1.2 && -inTee(x, z) < 2.6);
      const teeWalk = { pixels: teeBand.length, now: hue(meanRgb(teeNow, teeBand)), without: hue(meanRgb(teeDry, teeBand)),
        lum: r4(spread(teeNow, teeBand).mean / spread(teeDry, teeBand).mean - 1) };
      /* round the green: by distance from its edge */
      const greenGround = await groundOf('greenTop');
      const gNow = await read({ version: 'now', view: 'greenTop', preset: 'noon' }), gDry = await read({ version: 'now', switches: DRY, view: 'greenTop', preset: 'noon' });
      const edge = (x, z) => Math.hypot(x - hole.green[0], z - hole.green[1]) - hole.green[2];
      const ring = (a, b) => {
        const list = where(greenGround, (x, z) => edge(x, z) > a && edge(x, z) < b);
        return { pixels: list.length, lum: r4(spread(gNow, list).mean / spread(gDry, list).mean - 1), now: hue(meanRgb(gNow, list)), without: hue(meanRgb(gDry, list)) };
      };
      const walk = { green: compare(gNow, gDry, i => edge(greenGround[i * 2], greenGround[i * 2 + 1]) < -0.1),
        '0.1-0.4 m': ring(0.1, 0.4), '1.2-2.6 m': ring(1.2, 2.6), '2.6-4.6 m': ring(2.6, 4.6),
        beyond: compare(gNow, gDry, i => edge(greenGround[i * 2], greenGround[i * 2 + 1]) > 5) };
      measures.wear = { divots, teeWalk, walk };
      check(backend, 'about 1% of the tee\'s middle is scarred toward soil and sand, 2% touched, and none of its outer half metre',
        divots.scarred > 0.005 && divots.scarred < 0.025 && divots.touched < 0.04 && divots.rimTouched === 0 && divots.scar.now.rg > divots.scar.without.rg + 0.2, divots);
      check(backend, 'the ground 1.2-2.6 m from the green\'s and the tee\'s edge is paler and yellower; the green and the ground past 5 m are untouched',
        walk['1.2-2.6 m'].lum > 0.005 && walk['1.2-2.6 m'].now.rg > walk['1.2-2.6 m'].without.rg && walk['1.2-2.6 m'].now.bg < walk['1.2-2.6 m'].without.bg
          && teeWalk.lum > 0.005 && teeWalk.now.bg < teeWalk.without.bg
          && walk.green.maxDiff <= 0.001 && walk.beyond.maxDiff <= 0.001, { walk, teeWalk });
    }

    /* THE DAMP: the hollow in each light, against the batch without its wear */
    if (PARTS.has('damp')) {
      const ground = await groundOf('damp');
      const [hx0, hz0, hx1, hz1] = hole.hollow;
      const hollow = where(ground, (x, z) => x > hx0 + 5 && x < hx1 - 5 && z > hz0 + 5 && z < hz1 - 5);
      const open = i => { const x = ground[i * 2], z = ground[i * 2 + 1]; return x < hx0 - 3 || x > hx1 + 3 || z < hz0 - 3 || z > hz1 + 3; };
      const damp = {};
      for (const preset of ['storm', 'mist', 'golden', 'noon']) {
        const now = await read({ version: 'now', view: 'damp', preset }), dry = await read({ version: 'now', switches: DRY, view: 'damp', preset });
        damp[preset] = { hollow: r4(spread(now, hollow).mean / spread(dry, hollow).mean - 1), cooler: r4(hue(meanRgb(now, hollow)).bg - hue(meanRgb(dry, hollow)).bg),
          open: compare(now, dry, open), all: compare(now, dry) };
      }
      measures.damp = damp;
      check(backend, 'in the storm the sheltered hollow darkens and cools, the open ground round it untouched; the mist does 0.6 of it; no other light any',
        damp.storm.hollow < -0.04 && damp.storm.cooler > 0 && damp.storm.open.maxDiff <= 0.001
          && Math.abs(damp.mist.hollow / damp.storm.hollow - 0.6) < 0.1 && damp.mist.open.maxDiff <= 0.001
          && damp.golden.all.maxDiff <= 0.001 && damp.noon.all.maxDiff <= 0.001, damp);
    }

    /* THE BARE GROUND: its mottle, and its edge in the classes' colours */
    if (PARTS.has('bare')) {
      const mottle = {};
      for (const [name, view, test] of [['rock', 'rockTop', (x, z) => x > 9 && x < 13 && Math.abs(z) < 3], ['soil', 'dirtTop', (x, z) => x > -15 && x < -11 && Math.abs(z) < 3],
        ['mud', 'mud', (x, z) => x > -68 && x < -52 && z > 112 && z < 138]]) {
        const list = where(await groundOf(view), test);
        mottle[name] = {};
        for (const [version, o] of [['main', { version: 'main' }], ['now', { version: 'now' }]]) mottle[name][version] = spread(await read({ ...o, view, preset: 'noon' }), list);
      }
      /* each row's crossing of the rock's left and right edges (x = 8 and 14): where its share of the classes' colours passes a half */
      const ground = await groundOf('rockTop');
      const [R, K] = [ready.debug.ROUGH, ready.debug.ROCK];
      const share = (px, i) => { let num = 0, den = 0; for (let c = 0; c < 3; c++) { num += (px[i * 4 + c] - R[c]) * (K[c] - R[c]); den += (K[c] - R[c]) ** 2; } return num / den; };
      const ragged = {};
      for (const [version, o] of [['main', { version: 'main' }], ['now', { version: 'now' }]]) {
        const px = await read({ ...o, view: 'rockTop', preset: 'noon', debug: true });
        const offsets = { left: [], right: [] };
        /* in a view from above with north up, the screen's right is the world's -x: order each pair by x */
        for (let y = 0; y < H; y++) for (const [side, x0, inward] of [['left', 8, 1], ['right', 14, -1]]) {
          let crossing = null, nearest = Infinity;
          for (let x = 0; x + 1 < W; x++) {
            let i = y * W + x, j = i + 1;
            if (ground[j * 2] < ground[i * 2]) [i, j] = [j, i];
            const gx = ground[i * 2], gx1 = ground[j * 2];
            if (Math.abs(gx - x0) > 0.9) continue;
            const a = share(px, i), b = share(px, j);
            if ((a - 0.5) * (b - 0.5) <= 0 && a !== b && (b - a) * inward > 0) {
              const at = gx + (0.5 - a) / (b - a) * (gx1 - gx);
              if (Math.abs(at - x0) < nearest) { nearest = Math.abs(at - x0); crossing = at; }
            }
          }
          if (crossing !== null) offsets[side].push(crossing - x0);
        }
        const sd = list => { const m = list.reduce((a, v) => a + v, 0) / list.length; return r4(Math.sqrt(list.reduce((a, v) => a + (v - m) ** 2, 0) / list.length)); };
        ragged[version] = { rows: offsets.left.length + offsets.right.length, sdLeft: sd(offsets.left), sdRight: sd(offsets.right),
          widest: r4(Math.max(...offsets.left.map(Math.abs), ...offsets.right.map(Math.abs))) };
      }
      measures.bare = { mottle, ragged };
      check(backend, 'rock, soil and mud mottle in soft blotches, 4-7% of display luminance either side as lit, where main\'s were near flat',
        mottle.rock.now.cv > 0.045 && mottle.rock.now.cv < 0.09 && mottle.soil.now.cv > 0.03 && mottle.soil.now.cv < 0.08 && mottle.mud.now.cv > 0.02 && mottle.mud.now.cv < 0.06
          && Object.values(mottle).every(m => m.now.cv > 5 * m.main.cv), mottle);
      check(backend, 'the rock\'s straight edges wander about 7-13 cm, where main\'s ran straight',
        ragged.main.rows > 400 && ragged.now.rows > 400 && ragged.main.sdLeft < 0.02 && ragged.main.sdRight < 0.02 && ragged.now.sdLeft > 0.06 && ragged.now.sdLeft < 0.2 && ragged.now.sdRight > 0.06 && ragged.now.sdRight < 0.2, ragged);
    }

    report.backends[backend].measures = measures;
    report.backends[backend].reads = { count: reads.length, settled: reads.filter(r => r.settled).length, maxRenders: Math.max(0, ...reads.map(r => r.renders)) };
    check(backend, 'every read-back settled', reads.every(r => r.settled), report.backends[backend].reads);
    check(backend, 'no page or console error', errors.filter(e => !e.includes('404')).length === 0, { errors: errors.slice(0, 3) });
    await browser.close();
  }

  /* THE BACKENDS AGREE on every measure */
  if (BACKENDS.length > 1) {
    const [a, b] = BACKENDS.map(k => report.backends[k].measures);
    const pairs = [];
    const walk = (x, y, path) => {
      if (typeof x === 'number' && Number.isFinite(x)) pairs.push([path, x, y]);
      else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], y?.[k], `${path}.${k}`);
    };
    walk(a, b, 'measures');
    /* counts of pixels within a few percent; shares, ratios and colours within 0.01 and 3% */
    const agree = ([path, x, y]) => typeof y === 'number' && (/pixels|rows|middle$|rim$|blocks|differing|Scarred$/.test(path) && Number.isInteger(x)
      ? Math.abs(x - y) <= Math.max(3, 0.08 * Math.max(Math.abs(x), Math.abs(y))) : Math.abs(x - y) <= 0.01 + 0.03 * Math.max(Math.abs(x), Math.abs(y)));
    const worst = pairs.filter(pair => !agree(pair)).slice(0, 8);
    report.agreement = { measures: pairs.length, disagreeing: worst };
    console.log(`${worst.length ? 'FAIL' : 'ok  '} the backends agree over ${pairs.length} measures ${JSON.stringify(worst)}`);
    if (worst.length) failed = true;
  }

  /* PICTURES through the app's tone mapping: main beside the batch */
  if (PARTS.has('pictures')) {
    const PW = 480, PH = 272;
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor('webgl2') });
    const page = await browser.newPage({ viewport: { width: PW, height: PH } });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=webgl2&w=${PW}&h=${PH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
    const shots = [];
    const shot = async (label, o) => {
      await page.evaluate(x => window.__showHole(x), o);
      shots.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
    };
    for (const [label, o] of [['Dag, a player on the tee', { view: 'teeEye', preset: 'noon' }], ['Dag, the tee from above', { view: 'teeTop', preset: 'noon' }],
      ['Dag, round the green', { view: 'greenTop', preset: 'noon' }], ['Dag, the rock and the soil', { view: 'bareTop', preset: 'noon' }],
      ['Dag, the fairway close', { view: 'fairTop', preset: 'noon' }], ['Oväder, the hollow', { view: 'damp', preset: 'storm' }],
      ['Kväll, the hole view', { view: 'overview', preset: 'golden' }], ['Kväll, from the tee', { view: 'tee', preset: 'golden' }]]) {
      await shot(`${label}: main`, { ...o, version: 'main' });
      await shot(`${label}: now`, { ...o, version: 'now' });
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
    fs.writeFileSync(`${dir}/turf.jpg`, Buffer.from(jpg, 'base64'));
    await browser.close();
  }
} finally {
  server.kill();
  for (const file of CHANGED) fs.rmSync(`${dir}/${genOf(file)}`, { force: true });
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
