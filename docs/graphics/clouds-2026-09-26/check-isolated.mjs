// The clouds batch in an isolated scene (isolated.html): an island course, a lake
// and the open sea lit as the player lights them, on WebGL2 and on WebGPU with
// reversed depth, beside main's own sky, cloud shadows and water -- generated from
// git at the baseline, drawn in the same page over the same trees, atlas and
// textures:
//  - the before: with both switches off every light is main's, pixel for pixel,
//    in the sky and on the ground, the lake and the sea, and the lights without a
//    sun and clouds (the summer day, blue hour, storm, mist) are main's as they
//    are; on the CPU, every light's painted atmosphere is main's but for the two
//    values the sky lit by the sun reads;
//  - the clouds lit by the sun: their tops brighter than their bases seen away
//    from the sun, their sunward flanks brighter than their far ones seen across
//    its light, where main's noise has no such order; toward the sun, their
//    edges brighter against their bodies than main's; away from the sun no paint
//    brighter than main's; near the sun, the glow's threshold crossed over at
//    least 60% of main's share in the lights that glow there;
//  - the shadows drawn out along a low sun's light: seen from above, longer along
//    the sun than across by its stretch (main's are round), over the same share
//    of the ground;
//  - the water: the body in a cloud's shade seen low under a low sun, where
//    main's is not, and the sun's road whole under it, as main's is;
// and pictures through the app's tone mapping and high quality's glow, main
// beside now. Each read-back is drawn until two renders in a row agree. Software
// rendering by default, BANVY_GPU=1 for the real adapter.
// Run from the repository root: node docs/graphics/clouds-2026-09-26/check-isolated.mjs
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';
import { glowThresholdOf } from '../../../apps/golf/src/engine/glow.mjs';
import { CLOUD_SHADOW, cloudPattern, createCloudShadow, shadowStretch } from '../../../apps/golf/src/engine/cloud-shadow.mjs';

const dir = 'docs/graphics/clouds-2026-09-26';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const baseline = '0de84582';
const port = 8746;
/* rows of whole 256-byte blocks in both read-backs (8 bytes a pixel in half float, 16 in float) */
const W = 480, H = 300;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
/* BANVY_PARTS=before,clouds,shadows,water,pictures runs those parts alone */
const PARTS = new Set((process.env.BANVY_PARTS || 'before,clouds,shadows,water,pictures').split(','));
const LIGHTS = Object.keys(ATMOSPHERE_PRESETS);
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
/* the lights with a sun and clouds: the ones the batch draws differently */
const SUNLIT = LIGHTS.filter(name => painted(name).skyCloudSun > 0);
const UNLIT = LIGHTS.filter(name => !SUNLIT.includes(name));
/* the lights whose glow crosses its threshold toward the sun (glow.mjs): each keeps most of it */
const GLOWING = ['golden', 'dawn', 'midnight'];
/* where the clouds' order is measured: their tops in every light but the midnight sun's, whose clouds are thin (density
   0.36) and show little of any order; their sunward flanks where the light comes more from the side than over the
   top (dawn's deck is lit mostly over its tops) */
const TOPS = ['golden', 'noon', 'dawn', 'host'], FLANKS = ['golden', 'noon', 'host'];
const NAMES = { golden: 'Kväll', noon: 'Dag', summer: 'Sommar', dawn: 'Gryning', midnight: 'Midnattssol', bluehour: 'Blå timmen', storm: 'Oväder', mist: 'Dis', host: 'Höst' };
const report = { adapter: GPU ? 'gpu' : 'swiftshader', baseline, sunlit: SUNLIT, backends: {} };
let failed = false;
const r4 = v => Math.round(v * 10000) / 10000;

/* ------------------------------------------------------------------ MAIN'S SKY, SHADOWS AND WATER, FROM GIT */
const CHANGED = ['atmospheric-sky.mjs', 'painted-sky.mjs', 'cloud-shadow.mjs', 'water-shading.mjs', 'water-above.mjs', 'water-road.mjs', 'painted-world-palette.mjs'];
/* every other module the page draws with is main's own */
const PAGE_MODULES = ['atmosphere-presets.mjs', 'ghibli-tree-assets.mjs', 'ghibli-foliage-material.mjs', 'crown-depth.mjs', 'tree-impostor.mjs',
  'shadow-tint.mjs', 'aerial-perspective.mjs', 'stand-tint.mjs', 'geom.js', 'material.js', 'nordic-water.mjs', 'water-normal-texture.mjs',
  'ground-detail-upload.mjs', 'water-lighting.mjs', 'painted-world-lighting.mjs', 'output-dither.mjs', 'lighting-environment.mjs', 'glow.mjs'];
execFileSync('git', ['diff', '--quiet', baseline, '--', ...PAGE_MODULES.map(f => `apps/golf/src/engine/${f}`)]);
const genOf = file => `main-${file.replace(/\.m?js$/, '')}.gen.mjs`;
for (const file of CHANGED) {
  let source = execFileSync('git', ['show', `${baseline}:apps/golf/src/engine/${file}`], { encoding: 'utf8' })
    .replaceAll("from './", "from '../../../apps/golf/src/engine/")
    .replaceAll("from 'three/webgpu'", "from '../../../apps/golf/node_modules/three/build/three.webgpu.js'")
    .replaceAll("from 'three/tsl'", "from '../../../apps/golf/node_modules/three/build/three.tsl.js'")
    .replaceAll("from 'three/addons/", "from '../../../apps/golf/node_modules/three/examples/jsm/");
  /* main's changed modules import each other's main versions */
  for (const other of CHANGED) source = source.replaceAll(`from '../../../apps/golf/src/engine/${other}'`, `from './${genOf(other)}'`);
  fs.writeFileSync(`${dir}/${genOf(file)}`, `// generated by check-isolated.mjs from ${file} at ${baseline}; not committed\n${source}`);
}

/* a light's values in one order, undefined dropped: the painted atmosphere as data */
const canonical = v => JSON.stringify(v, (key, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => [k, x[k]])) : x);
const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
try {
  /* THE PALETTE, AS DATA: every light's painted atmosphere is main's but for the two values the sky lit by the sun reads */
  {
    const main = (await import(`../../../${dir}/${genOf('painted-world-palette.mjs')}`)).paintedAtmosphere;
    const rows = {};
    for (const name of LIGHTS) {
      const now = painted(name), then = main(name, ATMOSPHERE_PRESETS[name]);
      const { skyCloudSun, skyCloudBase, ...rest } = now;
      rows[name] = { restIsMain: canonical(rest) === canonical(then), skyCloudSun, skyCloudBase: skyCloudBase?.toString(16),
        sunElevation: +(Math.asin(now.dir[1] / Math.hypot(...now.dir)) * 180 / Math.PI).toFixed(2),
        shadowStretch: now.cloudShadow ? +shadowStretch(now.dir[1] / Math.hypot(...now.dir)).toFixed(3) : null };
    }
    const ok = LIGHTS.every(n => rows[n].restIsMain) && SUNLIT.length === 5 && UNLIT.every(n => rows[n].skyCloudSun === undefined);
    report.data = { ok, rows };
    console.log(`${ok ? 'ok  ' : 'FAIL'} every light's painted atmosphere is main's but for the sky's sun lighting, in the five lights with a sun and clouds ${JSON.stringify(rows).slice(0, 700)}`);
    if (!ok) failed = true;
  }

  await new Promise(r => setTimeout(r, 1200));
  const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
    ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
  const check = (backend, label, ok, detail) => {
    report.backends[backend].checks.push({ label, ok, ...detail });
    if (!ok) failed = true;
    console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail).slice(0, 900)}`);
  };
  const decode = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(new Uint8Array(b).buffer); };
  const compare = (a, b) => {
    let differing = 0, max = 0;
    for (let i = 0; i < W * H; i++) {
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i * 4 + c] - b[i * 4 + c]));
      if (d > 0) differing++;
      if (d > max) max = d;
    }
    return { differing, maxDiff: r4(max) };
  };
  /* the picture as luminance, row 0 at the top whatever the backend's row order */
  const luminance = (px, backend) => {
    const L = new Float32Array(W * H);
    for (let row = 0; row < H; row++) {
      const top = backend === 'webgl2' ? H - 1 - row : row;
      for (let x = 0; x < W; x++) { const i = row * W + x; L[top * W + x] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; }
    }
    return L;
  };
  /* THE CLOUDS' ORDER: within their interiors (a pixel whose neighbours `k` away are cloud too -- where the sky
     differs from the same sky without clouds by more than 0.02), how much more each pixel's neighbour `k` toward
     (dx, dy) adds to the clear sky than its neighbour `k` away, over what the clouds add: the sky's own gradient
     behind a thin cloud does not count */
  const order = (L, clear, [dx, dy], k = 6) => {
    const add = i => L[i] - clear[i], cloud = i => Math.abs(add(i)) > 0.02;
    let n = 0, sum = 0, mean = 0;
    for (let y = k; y < H - k; y++) for (let x = k; x < W - k; x++) {
      const i = y * W + x, a = (y + dy * k) * W + x + dx * k, b = (y - dy * k) * W + x - dx * k;
      if (!cloud(i) || !cloud(a) || !cloud(b)) continue;
      n++; sum += add(a) - add(b); mean += Math.abs(add(i));
    }
    return n ? { order: r4(sum / mean), pixels: n } : { order: 0, pixels: 0 };
  };
  /* toward the sun: the clouds' edges (cloud pixels with clear sky within 3) against their bodies (none within 8) */
  const edges = (L, clear) => {
    const cloud = i => Math.abs(L[i] - clear[i]) > 0.01;
    const near = (x, y, r) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < W && Y < H && !cloud(Y * W + X)) return true; } return false; };
    let e = 0, en = 0, b = 0, bn = 0;
    for (let y = 8; y < H - 8; y += 2) for (let x = 8; x < W - 8; x += 2) {
      const i = y * W + x;
      if (!cloud(i)) continue;
      if (near(x, y, 3)) { e += L[i] - clear[i]; en++; } else if (!near(x, y, 8)) { b += L[i] - clear[i]; bn++; }
    }
    return { edgeOverBody: en && bn ? r4((e / en) / Math.max(b / bn, 1e-4)) : null, edges: en, bodies: bn };
  };
  const over = (L, threshold) => r4(L.reduce((a, v) => a + (v > threshold), 0) / L.length);
  const maxOf = L => r4(L.reduce((a, v) => Math.max(a, v), 0));
  /* how far the picture stays like itself along screen x and y: the lag at which its correlation falls to a half,
     between whole pixels as the correlation falls */
  const correlationLength = (L, [dx, dy]) => {
    let mean = 0; for (const v of L) mean += v; mean /= L.length;
    let variance = 0; for (const v of L) variance += (v - mean) ** 2; variance /= L.length;
    let last = 1;
    for (let lag = 1; lag < (dx ? W : H) / 2; lag++) {
      let c = 0, n = 0;
      for (let y = 0; y + dy * lag < H; y++) for (let x = 0; x + dx * lag < W; x++) { c += (L[y * W + x] - mean) * (L[(y + dy * lag) * W + x + dx * lag] - mean); n++; }
      const r = c / n / variance;
      if (r < 0.5) return r4(lag - 1 + (last - 0.5) / (last - r));
      last = r;
    }
    return Infinity;
  };

  const pearson = (a, b) => {
    let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= b.length;
    let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
    return ab / Math.sqrt(aa * bb);
  };
  /* the share of the sun past the clouds at each pixel of the `plane` view, as cloud-shadow.mjs reads its pattern
     (texel centres at half a texel, linear, repeating), stretched or round */
  const PATTERN = cloudPattern();
  const patternShade = (stretch, preset, dir, offset) => {
    const cloud = createCloudShadow({ stretch }), n = Math.hypot(...dir);
    cloud.setPreset(preset); cloud.setSun({ x: dir[0] / n, y: dir[1] / n, z: dir[2] / n }); cloud.setOffset(...offset);
    const { tileMetres, softness, size: N } = CLOUD_SHADOW, t = cloud.threshold.value, opacity = cloud.opacity.value;
    const a = cloud.along.value, k = cloud.squeeze.value, o = cloud.offset.value, half = Math.tan(Math.PI / 6) * 8000;
    const at = (i, j) => PATTERN[(((j % N) + N) % N) * N + (((i % N) + N) % N)] / 255;
    const smooth = (e0, e1, x) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
    const out = new Float32Array(W * H);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      let gx = ((px + 0.5) / W * 2 - 1) * half * W / H, gz = ((py + 0.5) / H * 2 - 1) * half;
      if (stretch) { const d = (gx * a.x + gz * a.y) * k; gx += a.x * d; gz += a.y * d; }
      const u = (gx - o.x) / tileMetres * N - 0.5, v = (gz - o.y) / tileMetres * N - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      const value = (at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu) * (1 - fv) + (at(i0, j0 + 1) * (1 - fu) + at(i0 + 1, j0 + 1) * fu) * fv;
      out[py * W + px] = 1 - smooth(t - softness, t + softness, value) * opacity;
    }
    return out;
  };

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
    if (!ready.ready || !ready.main) throw new Error(`${backend}: ${ready.error || 'main\'s sky, shadows and water missing'}`);
    const reads = [];
    const read = async options => {
      const r = await page.evaluate(o => window.__read(o), options);
      reads.push({ settled: r.settled, renders: r.renders });
      return decode(r.px);
    };

    /* THE BEFORE: with both switches off every light is main's, pixel for pixel; the lights without a sun and clouds are
       main's as they are */
    if (PARTS.has('before')) {
      const rows = {};
      for (const name of LIGHTS) {
        const views = SUNLIT.includes(name) ? ['towardSky', 'sideSky', 'tee', 'lake', 'seaHigh', 'above'] : ['towardSky', 'tee', 'seaHigh'];
        for (const view of views) {
          const theirs = await read({ preset: name, view, version: 'main' });
          rows[`${name}/${view}`] = { before: compare(await read({ preset: name, view, version: 'before' }), theirs) };
          if (UNLIT.includes(name)) rows[`${name}/${view}`].now = compare(await read({ preset: name, view, version: 'now' }), theirs);
        }
      }
      check(backend, 'with ?cloudlight=0&cloudstretch=0 every light is main\'s, pixel for pixel, and the summer day, blue hour, storm and mist are main\'s as they are',
        Object.values(rows).every(r => r.before.differing === 0 && (!r.now || r.now.differing === 0)), rows);
    }

    /* THE CLOUDS LIT BY THE SUN, NOW AGAINST MAIN */
    const m = {};
    if (PARTS.has('clouds')) {
      for (const name of SUNLIT) {
        m[name] = {};
        const p = painted(name), threshold = glowThresholdOf(p);
        for (const version of ['main', 'now']) {
          const sky = async view => [luminance(await read({ preset: name, view, version }), backend),
            luminance(await read({ preset: name, view, version, over: { cloudDensity: 0 } }), backend)];
          const [away, awayClear] = await sky('cloudsAway'), [side, sideClear] = await sky('cloudsSide'), [toward, towardClear] = await sky('cloudsToward');
          const wide = luminance(await read({ preset: name, view: 'towardSky', version }), backend);
          m[name][version] = {
            /* seen away from the sun, tops (up the screen) against bases; across its light, the sunward flank (the sun is to the right) */
            topsOverBases: order(away, awayClear, [0, -1]), sunwardOverFar: order(side, sideClear, [1, 0]),
            /* toward the sun, the edges against the bodies */
            toward: edges(toward, towardClear),
            /* the brightest cloud paint away from the sun and across its light, and the share over the glow's threshold toward it */
            brightest: Math.max(maxOf(away), maxOf(side)), glow: { towardSky: over(wide, threshold), cloudsToward: over(toward, threshold) },
          };
        }
      }
      check(backend, 'the clouds lit by the sun: seen away from it their tops brighter than their bases, seen across its light their sunward flanks brighter than their far ones, where main\'s have no such order',
        TOPS.every(n => m[n].now.topsOverBases.order > 0.05 && m[n].now.topsOverBases.order > m[n].main.topsOverBases.order + 0.04)
          && FLANKS.every(n => m[n].now.sunwardOverFar.order > 0.01 && m[n].now.sunwardOverFar.order > m[n].main.sunwardOverFar.order + 0.005),
        Object.fromEntries(SUNLIT.map(n => [n, { tops: [m[n].main.topsOverBases.order, m[n].now.topsOverBases.order], sunward: [m[n].main.sunwardOverFar.order, m[n].now.sunwardOverFar.order] }])));
      check(backend, 'toward the sun their edges brighter against their bodies than main\'s: the lining',
        SUNLIT.every(n => m[n].now.toward.edgeOverBody > m[n].main.toward.edgeOverBody),
        Object.fromEntries(SUNLIT.map(n => [n, [m[n].main.toward.edgeOverBody, m[n].now.toward.edgeOverBody]])));
      check(backend, 'no cloud paint brighter than main\'s away from the sun, and near it the glow\'s threshold crossed over at least 60% of main\'s share where the glow is the light\'s',
        SUNLIT.every(n => m[n].now.brightest <= m[n].main.brightest * 1.01)
          && GLOWING.every(n => m[n].now.glow.towardSky >= 0.6 * m[n].main.glow.towardSky && m[n].now.glow.cloudsToward >= 0.6 * m[n].main.glow.cloudsToward),
        Object.fromEntries(SUNLIT.map(n => [n, { brightest: [m[n].main.brightest, m[n].now.brightest], glow: [m[n].main.glow, m[n].now.glow] }])));
    }

    /* THE SHADOWS DRAWN OUT: a plain field seen from 8 km up (north up), under a sun along screen x at each light's own
       height, without haze, the sun strong enough on the level field and the shade deepened to measure the shapes.
       Pixel by pixel the field's shade is the pattern as cloud-shadow.mjs reads it -- drawn out by the light's stretch
       now, round in main -- and not the other; longer along the sun than across; about the same share of the field in
       shade (a window of 9 by 15 km samples less of a pattern drawn out five times: cloud-shadow.test.mjs holds the
       share over 20 km) */
    const shadows = {};
    if (PARTS.has('shadows')) {
      for (const name of SUNLIT) {
        const p = painted(name), e = Math.asin(p.dir[1] / Math.hypot(...p.dir)), dir = [Math.cos(e), Math.sin(e), 0];
        const over = { dir, int: 3 / Math.sin(e), dens: 0, valleyMist: undefined, cloudShadow: { cover: 0.3, opacity: 0.9 } };
        const offset = [1300, 700];
        shadows[name] = { stretch: +shadowStretch(Math.sin(e)).toFixed(3) };
        const models = { round: patternShade(false, { ...p, ...over }, dir, offset), stretched: patternShade(true, { ...p, ...over }, dir, offset) };
        for (const version of ['main', 'now']) {
          const L = luminance(await read({ preset: name, view: 'plane', version, over, cloudOffset: offset }), backend);
          const lit = luminance(await read({ preset: name, view: 'plane', version, over: { ...over, cloudShadow: { cover: 0.3, opacity: 0 } }, cloudOffset: offset }), backend);
          /* the shade alone: the picture over the same picture without the clouds' shade */
          const shade = L.map((v, i) => v / Math.max(lit[i], 1e-5));
          const deepest = [...shade].sort((a, b) => a - b)[Math.floor(shade.length * 0.01)];
          const shaded = shade.reduce((a, v) => a + (v < (1 + deepest) / 2), 0) / shade.length;
          const along = correlationLength(shade, [1, 0]), across = correlationLength(shade, [0, 1]);
          shadows[name][version] = { round: r4(pearson(shade, models.round)), stretched: r4(pearson(shade, models.stretched)),
            along, across, ratio: r4(along / across), shaded: r4(shaded) };
        }
      }
      check(backend, 'the shadows drawn out along a low sun\'s light: pixel by pixel the pattern drawn out by the light\'s stretch, where main\'s is the round one, longer along the sun than across, over the same share of the ground',
        SUNLIT.every(n => shadows[n].now.stretched > 0.95 && shadows[n].main.round > 0.95
          && (n === 'noon' || (shadows[n].now.round < shadows[n].now.stretched - 0.1 && shadows[n].main.stretched < shadows[n].main.round - 0.1))
          && shadows[n].now.ratio > shadows[n].main.ratio * Math.min(2, shadows[n].stretch) * 0.8
          && Math.abs(shadows[n].now.shaded - shadows[n].main.shaded) < 0.08), shadows);
    }

    /* THE WATER under a low sun, seen low: the body takes a cloud's shade, main's does not; the sun's road stays whole */
    const water = {};
    if (PARTS.has('water')) {
      const shadeOf = async (version, view, extra = {}) => {
        const withShade = luminance(await read({ preset: 'golden', view, version, cloudOffset: [2400, -1300], ...extra }), backend);
        const without = luminance(await read({ preset: 'golden', view, version, cloudOffset: [2400, -1300], over: { cloudShadow: { cover: 0.22, opacity: 0 } }, ...extra }), backend);
        /* the sea: below the horizon (the lower half of these views); the road: its brightest pixels without the shade */
        let sea = 0, darker = 0, drop = 0;
        for (let y = Math.floor(H * 0.52); y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x; sea++;
          if (withShade[i] < 0.995 * without[i]) { darker++; drop += 1 - withShade[i] / without[i]; }
        }
        const road = [...without.keys()].filter(i => i >= H * 0.52 * W).sort((a, b) => without[b] - without[a]).slice(0, Math.floor(0.01 * W * H));
        const roadKept = road.reduce((a, i) => a + withShade[i] / without[i], 0) / road.length;
        return { darker: r4(darker / sea), meanDrop: darker ? r4(drop / darker) : 0, roadKept: r4(roadKept) };
      };
      for (const view of ['seaAcross', 'seaToward']) water[view] = { main: await shadeOf('main', view), now: await shadeOf('now', view) };
      water.roadcut = await shadeOf('now', 'seaToward', { water: 'roadcut' });
      check(backend, 'the water seen low under a low sun: the body in a cloud\'s shade, where main\'s is not, and the sun\'s road whole under it',
        ['seaAcross', 'seaToward'].every(v => water[v].main.darker === 0 && water[v].now.darker > 0.05)
          && water.seaToward.now.roadKept > 0.97 && water.seaToward.main.roadKept > 0.999, water);
    }

    report.backends[backend].measures = { clouds: m, shadows, water };
    report.backends[backend].reads = { count: reads.length, settled: reads.filter(r => r.settled).length, maxRenders: Math.max(...reads.map(r => r.renders)) };
    check(backend, 'every read-back settled', reads.every(r => r.settled), report.backends[backend].reads);
    check(backend, 'no page or console error', errors.filter(e => !e.includes('404')).length === 0, { errors: errors.slice(0, 3) });
    await browser.close();
  }

  /* THE BACKENDS AGREE on every measure */
  if (BACKENDS.length > 1 && PARTS.size === 5) {
    const [a, b] = BACKENDS.map(k => report.backends[k].measures);
    const pairs = [];
    const walk = (x, y, path) => {
      if (typeof x === 'number' && Number.isFinite(x)) pairs.push([path, x, y]);
      else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], y?.[k], `${path}.${k}`);
    };
    walk(a, b, 'measures');
    /* counts of pixels and lags agree within a few percent; shares and orders within 0.01 */
    const agree = ([path, x, y]) => typeof y === 'number' && (/pixels|edges|bodies|along|across/.test(path)
      ? Math.abs(x - y) <= Math.max(3, 0.08 * Math.max(Math.abs(x), Math.abs(y))) : Math.abs(x - y) <= 0.01 + 0.03 * Math.max(Math.abs(x), Math.abs(y)));
    const worst = pairs.filter(pair => !agree(pair)).slice(0, 8);
    report.agreement = { measures: pairs.length, disagreeing: worst };
    console.log(`${worst.length ? 'FAIL' : 'ok  '} the backends agree over ${pairs.length} measures ${JSON.stringify(worst)}`);
    if (worst.length) failed = true;
  }

  /* PICTURES, through the app's tone mapping and high quality's glow: main beside now */
  if (PARTS.has('pictures')) {
    const PW = 480, PH = 300;
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor('webgl2') });
    const page = await browser.newPage({ viewport: { width: PW, height: PH } });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=webgl2&w=${PW}&h=${PH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
    const VIEW = { tee: 'from the tee', cloudsSide: 'across the light', cloudsAway: 'away from the sun', cloudsToward: 'toward the sun',
      above: 'from 1.6 km', seaHigh: 'the sea from 180 m', flyover: 'flyover' };
    const LIST = [['golden', 'tee'], ['golden', 'cloudsSide'], ['golden', 'cloudsAway'], ['golden', 'cloudsToward'], ['golden', 'flyover'],
      ['noon', 'tee'], ['noon', 'cloudsAway'], ['dawn', 'tee'], ['midnight', 'cloudsSide'], ['host', 'tee'],
      ['golden', 'above', { over: { dens: 0.00008 }, cloudOffset: [1300, 700] }], ['golden', 'seaHigh', { cloudOffset: [2400, -1300] }]];
    const shots = [];
    for (const [name, view, extra = {}] of LIST) for (const version of ['main', 'now']) {
      await page.evaluate(o => window.__show(o), { preset: name, view, version, ...extra });
      shots.push({ label: `${NAMES[name]}, ${VIEW[view]}: ${version}`, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
    }
    /* tried and dropped: the clouds' long shadows cutting golden hour's road */
    await page.evaluate(o => window.__show(o), { preset: 'golden', view: 'seaHigh', version: 'now', water: 'roadcut', cloudOffset: [2400, -1300] });
    shots.push({ label: 'Kväll, the sea from 180 m: tried, the road cut', png: (await page.locator('canvas').first().screenshot()).toString('base64') });
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
    fs.writeFileSync(`${dir}/clouds.jpg`, Buffer.from(jpg, 'base64'));
    await browser.close();
  }
} finally {
  server.kill();
  for (const file of CHANGED) fs.rmSync(`${dir}/${genOf(file)}`, { force: true });
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
