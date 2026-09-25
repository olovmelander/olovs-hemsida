// The air batch's shaders in isolated scenes (isolated.html), on WebGL2 and on
// WebGPU with reversed depth, each against its before:
//  - cloud shadows: with a clear sky the lit world is the before bit for bit;
//    a cloud pattern darkens the field and a platform 40 m up exactly as the
//    sun under the clouds says it should, pixel by pixel, the platform's shifted
//    along the sun; under a cloud a tree's shadow keeps its tint while the
//    ground round it darkens toward it; a bush without a shadow map darkens as
//    the ground does; the impostors and a Hero crown darken alike;
//  - one wind: plants move along the wind's axis (and across it, on its side),
//    by its strength and the gust the air carries, and stand still without it;
//  - the sky: its clouds drift downwind, east for a westerly and south for a northerly;
//  - valley mist: nothing without it, and with it the share of the view the
//    air takes at every pixel is the closed form's, alone and with the haze.
// Software rendering by default, BANVY_GPU=1 for the real adapter. Run from the
// repository root: node docs/graphics/air-2026-09-25/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { gustAt } from '../../../apps/golf/src/engine/one-wind.mjs';
import { valleyMistAmount } from '../../../apps/golf/src/engine/aerial-perspective.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';

const dir = 'docs/graphics/air-2026-09-25';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const port = 8691;
const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
const report = { adapter: GPU ? 'gpu' : 'swiftshader', backends: {} };
let failed = false;
const check = (backend, label, ok, detail) => {
  report.backends[backend].checks.push({ label, ok, ...detail });
  if (!ok) failed = true;
  console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail).slice(0, 400)}`);
};
const r4 = v => Math.round(v * 1e4) / 1e4;
const lum = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
const quantile = (values, q) => { const s = Float64Array.from(values).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);

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
    const { W, H, layout: L, marks, cloud } = result;
    const N = W * H;
    const call = (fn, arg) => page.evaluate(([f, a]) => window[f](a), [fn, arg]);

    /* ------------------------------------------------------------ cloud shadows */
    const pos = await call('__cloudPositions');
    const where = k => [pos[k * 4], pos[k * 4 + 1], pos[k * 4 + 2]];
    const inRect = (x, z, cx, cz, hx, hz) => Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz;
    /* the pattern as the texture holds it: bilinear between texel centres, repeating */
    const bytes = result.bytes, S = cloud.size;
    const texel = (i, j) => bytes[((j % S + S) % S) * S + ((i % S + S) % S)] / 255;
    const sample = (u, v) => {
      const x = u * S - 0.5, y = v * S - 0.5, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      return mix(mix(texel(i, j), texel(i + 1, j), fx), mix(texel(i, j + 1), texel(i + 1, j + 1), fx), fy);
    };
    const sunlight = (x, y, z, st) => {
      const u = (x - st.slope[0] * y - st.offset[0]) / cloud.tile, v = (z - st.slope[1] * y - st.offset[1]) / cloud.tile;
      const e = cloud.softness, t = Math.min(1, Math.max(0, (sample(u, v) - (st.threshold - e)) / (2 * e)));
      return 1 - smooth(t) * st.opacity;
    };
    const before = await call('__cloud', { world: 'before' });
    const clear = await call('__cloud', { world: 'clouds', cover: 0, opacity: 0 });
    let maxDiff = 0, differing = 0;
    for (let k = 0; k < N * 4; k++) { const d = Math.abs(before.px[k] - clear.px[k]); if (d > 0) differing++; maxDiff = Math.max(maxDiff, d); }
    check(backend, 'with a clear sky, the lit world is the before: field, platform, pole and its shadow, bush, impostors and a Hero crown',
      maxDiff === 0, { maxDiff, differingValues: differing });

    const dark = await call('__cloud', { world: 'clouds', cover: 0, opacity: 0, sunOff: true });
    const noPole = await call('__cloud', { world: 'clouds', cover: 0, opacity: 0, poleOff: true });
    /* a cloud's edge across the platform and some shade on the field: the
       offset, on a 32 m lattice over the tile, that puts the platform (40 m up)
       nearest half in shade with a fifth of the field or more in it too (the
       pattern's clouds are hundreds of metres across; the view is 200 m) */
    const probe = await call('__cloud', { world: 'clouds', cover: 0.5, opacity: 0.62 });
    let offset = [0, 0], nearest = Infinity;
    for (let oz = 0; oz < cloud.tile; oz += 32) for (let ox = 0; ox < cloud.tile; ox += 32) {
      const trial = { slope: probe.slope, offset: [ox, oz], threshold: probe.threshold, opacity: probe.opacity };
      let n = 0, dim = 0, pn = 0, pdim = 0;
      for (let z = -50; z <= 50; z += 10) for (let x = -95; x <= 95; x += 10) { n++; if (sunlight(x, 0, z, trial) < 0.69) dim++; }
      for (let z = L.platform.z - 18; z <= L.platform.z + 18; z += 4) for (let x = L.platform.x - 18; x <= L.platform.x + 18; x += 4) { pn++; if (sunlight(x, L.platform.y, z, trial) < 0.69) pdim++; }
      const score = Math.abs(pdim / pn - 0.5) + (dim / n < 0.2 ? 1 : 0);
      if (score < nearest) { nearest = score; offset = [ox, oz]; }
    }
    const patterned = await call('__cloud', { world: 'clouds', cover: 0.5, opacity: 0.62, offset });
    const st = { slope: patterned.slope, offset, threshold: patterned.threshold, opacity: patterned.opacity };
    const tint = patterned.tint;
    /* where the ground is plain: no object over it, not the pole's shadow */
    const kind = k => {
      const [x, y, z] = where(k);
      if (!(Math.abs(x) + Math.abs(y) + Math.abs(z) > 0)) return 'none';
      if (inRect(x, z, L.bush.x, L.bush.z, L.bush.size / 2 + 1, L.bush.size / 2 + 1)) return 'bush';
      if (inRect(x, z, L.pole.x, L.pole.z, 2, 2)) return 'pole';
      if (z > L.trees.z - 12 && z < L.trees.z + 12) return 'trees';
      if (inRect(x, z, L.spruce.x, L.spruce.z, 9, 9)) return 'spruce';
      if (lum(clear.px, k * 4) < 0.8 * lum(noPole.px, k * 4)) return 'shadow';
      return y > 20 ? 'platform' : 'field';
    };
    const kinds = Array.from({ length: N }, (_, k) => kind(k));
    const expectLit = (k, c) => [0, 1, 2].map(ch => dark.px[k * 4 + ch] + (clear.px[k * 4 + ch] - dark.px[k * 4 + ch]) * mix(tint[ch], 1, c));
    const errorsOf = (k, c, px) => { const e = expectLit(k, c), m = [0, 1, 2].map(ch => px[k * 4 + ch]); return Math.abs(0.2126 * (m[0] - e[0]) + 0.7152 * (m[1] - e[1]) + 0.0722 * (m[2] - e[2])) / (0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]); };
    const fieldErr = [], platformErr = { slope: [], flat: [], against: [] };
    let shaded = 0, fieldCount = 0;
    for (let k = 0; k < N; k++) {
      const [x, y, z] = where(k);
      if (kinds[k] === 'field') {
        const c = sunlight(x, y, z, st);
        fieldErr.push(errorsOf(k, c, patterned.px)); fieldCount++;
        if (c < 0.7) shaded++;
      } else if (kinds[k] === 'platform') {
        platformErr.slope.push(errorsOf(k, sunlight(x, y, z, st), patterned.px));
        platformErr.flat.push(errorsOf(k, sunlight(x, 0, z, st), patterned.px));
        platformErr.against.push(errorsOf(k, sunlight(x, -y, z, st), patterned.px));
      }
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const field = { offset, pixels: fieldCount, shadedShare: r4(shaded / fieldCount), medianError: r4(quantile(fieldErr, 0.5)), p99Error: r4(quantile(fieldErr, 0.99)) };
    const platform = { pixels: platformErr.slope.length, meanError: r4(mean(platformErr.slope)), ifUnshifted: r4(mean(platformErr.flat)), ifShiftedAgainst: r4(mean(platformErr.against)), slope: st.slope.map(r4) };
    check(backend, 'a cloud pattern darkens the field as the sun under the clouds says, pixel by pixel, and the platform 40 m up by the pattern moved along the sun',
      field.shadedShare > 0.1 && field.medianError < 0.005 && field.p99Error < 0.03
        && platform.meanError < 0.01 && platform.meanError * 3 < Math.min(platform.ifUnshifted, platform.ifShiftedAgainst), { field, platform });

    /* the whole view under one cloud */
    const opacity = 0.62, c = 1 - opacity;
    const overcast = await call('__cloud', { world: 'clouds', threshold: -1, opacity });
    const shadow = [], around = [], bush = [], crowns = { impostors: [], spruce: [] }, groundErr = [];
    for (let k = 0; k < N; k++) {
      const t = kinds[k];
      if (t === 'shadow') shadow.push(k);
      else if (t === 'field') {
        const [x, , z] = where(k);
        if (Math.hypot(x - (L.pole.x + 3), z - (L.pole.z - 5)) < 16) around.push(k);
        groundErr.push(errorsOf(k, c, overcast.px));
      } else if (t === 'bush') { if (Math.abs(lum(clear.px, k * 4) - lum(dark.px, k * 4)) > 1e-3) bush.push(k); }
      else if ((t === 'trees' || t === 'spruce') && lum(clear.px, k * 4) > 0.01 && [0, 1, 2].every(ch => clear.px[k * 4 + ch] === dark.px[k * 4 + ch])) {
        /* a painted crown pixel: unlit by the scene's sun, so the same with it off */
        (t === 'trees' ? crowns.impostors : crowns.spruce).push(k);
      }
    }
    const meanLum = (ks, px) => mean(ks.map(k => lum(px, k * 4)));
    /* each shadow pixel's own shadow s, from the clear sky: clear = dark + S mix(tint, 1, s),
       S the sun's part without the pole; under the cloud it must be dark + S mix(tint, 1, s c) */
    const shadowErr = [], umbra = [];
    for (const k of shadow) {
      let sSum = 0;
      const S = [0, 1, 2].map(ch => noPole.px[k * 4 + ch] - dark.px[k * 4 + ch]);
      for (let ch = 0; ch < 3; ch++) sSum += ((clear.px[k * 4 + ch] - dark.px[k * 4 + ch]) / S[ch] - tint[ch]) / (1 - tint[ch]);
      const sk = Math.min(1, Math.max(0, sSum / 3));
      if (sk < 0.02) umbra.push(k);
      const e = [0, 1, 2].map(ch => dark.px[k * 4 + ch] + S[ch] * mix(tint[ch], 1, sk * c));
      const m = [0, 1, 2].map(ch => overcast.px[k * 4 + ch]);
      shadowErr.push(Math.abs(0.2126 * (m[0] - e[0]) + 0.7152 * (m[1] - e[1]) + 0.0722 * (m[2] - e[2])) / (0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]));
    }
    const shadowKept = meanLum(umbra, overcast.px) / meanLum(umbra, clear.px);
    const contrast = { clear: r4(meanLum(shadow, clear.px) / meanLum(around, clear.px)), cloud: r4(meanLum(shadow, overcast.px) / meanLum(around, overcast.px)) };
    const bushErr = bush.map(k => errorsOf(k, c, overcast.px));
    const crownRatio = { impostors: r4(meanLum(crowns.impostors, overcast.px) / meanLum(crowns.impostors, clear.px)),
      spruce: r4(meanLum(crowns.spruce, overcast.px) / meanLum(crowns.spruce, clear.px)) };
    const groundRatio = mean(around.map(k => lum(overcast.px, k * 4) / lum(clear.px, k * 4)));
    check(backend, 'under a cloud a tree\'s shadow keeps its sky-lit tint while the ground round it darkens toward it: sun x mix(tint, 1, shadow x cloud) at every pixel, penumbra too',
      shadow.length > 100 && umbra.length > 40 && Math.abs(shadowKept - 1) < 0.005 && quantile(shadowErr, 0.99) < 0.02
        && contrast.cloud > contrast.clear + 0.1 && quantile(groundErr, 0.99) < 0.02,
      { shadowPixels: shadow.length, umbraPixels: umbra.length, umbraKept: r4(shadowKept), shadowP99Error: r4(quantile(shadowErr, 0.99)), contrast,
        groundRatio: r4(groundRatio), groundP99Error: r4(quantile(groundErr, 0.99)) });
    check(backend, 'a bush with no shadow map darkens under the cloud as the ground does',
      bush.length > 50 && quantile(bushErr, 0.99) < 0.02, { pixels: bush.length, medianError: r4(quantile(bushErr, 0.5)), p99Error: r4(quantile(bushErr, 0.99)) });
    check(backend, 'the impostors and a Hero crown darken under the cloud alike, and about as the open ground round them does',
      crowns.impostors.length > 200 && crowns.spruce.length > 100 && Math.abs(crownRatio.impostors - crownRatio.spruce) < 0.05
        && Math.abs(crownRatio.impostors - groundRatio) < 0.12, { pixels: { impostors: crowns.impostors.length, spruce: crowns.spruce.length }, ratio: crownRatio, groundRatio: r4(groundRatio) });

    /* ------------------------------------------------------------ one wind */
    const mpos = await call('__markerPositions');
    const blobs = px => {
      const seen = new Uint8Array(N), found = [];
      for (let k = 0; k < N; k++) {
        if (seen[k] || px[k * 4] < 0.5) continue;
        const stack = [k]; seen[k] = 1;
        let sx = 0, sz = 0, n = 0;
        while (stack.length) {
          const q = stack.pop(), qx = q % W, qy = Math.floor(q / W);
          sx += mpos[q * 4]; sz += mpos[q * 4 + 2]; n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = qx + dx, y = qy + dy, r = y * W + x;
            if (x >= 0 && x < W && y >= 0 && y < H && !seen[r] && px[r * 4] >= 0.5) { seen[r] = 1; stack.push(r); }
          }
        }
        found.push({ x: sx / n, z: sz / n, n });
      }
      return found;
    };
    const rests = [];
    for (const z of marks.zs) for (const x of marks.xs) rests.push([x, z]);
    const swayCase = async ({ axis, sway, offset = [0, 0], across = false }) => {
      const found = blobs(await call('__sway', { axis, sway, offset, across }));
      const dirn = across ? [-axis[1], axis[0]] : axis;
      const expected = rests.map(([x, z]) => {
        const m = 4 * sway * (0.6 + 0.4 * gustAt(x - offset[0], z - offset[1]));
        return [x + dirn[0] * m, z + dirn[1] * m];
      });
      let worst = 0, matched = 0;
      for (const [ex, ez] of expected) {
        let best = Infinity;
        for (const b of found) best = Math.min(best, Math.hypot(b.x - ex, b.z - ez));
        if (best < 1) matched++;
        worst = Math.max(worst, best);
      }
      return { markers: expected.length, blobs: found.length, matched, worstMetres: r4(worst) };
    };
    const still = await swayCase({ axis: [1, 0], sway: 0 });
    const cases = {
      westerly: await swayCase({ axis: [1, 0], sway: 1 }),
      northerlyGustsCarried: await swayCase({ axis: [0, 1], sway: 1, offset: [37, -11] }),
      northWestGale: await swayCase({ axis: [-0.6, 0.8], sway: 1.5 }),
      acrossTheWind: await swayCase({ axis: [1, 0], sway: 1, across: true }),
    };
    check(backend, 'plants move along the wind\'s axis by its strength and the gust the air carries, across it on its side, and not at all when it is still',
      /* within a pixel (0.2 m) of where the wind puts each marker: a wrong axis, side, strength or gust would miss by metres */
      still.matched === still.markers && still.worstMetres < 0.2
        && Object.values(cases).every(s => s.matched === s.markers && s.blobs === s.markers && s.worstMetres < 0.2), { metresPerPixel: 0.2, still, ...cases });

    /* ------------------------------------------------------------ sky drift */
    const dirs = await call('__skyDirections');
    const skyA = await call('__sky', { drift: [0, 0, 0.5] });
    const delta = 0.02;
    const skyE = await call('__sky', { drift: [delta, 0, 0.5] });
    const skyS = await call('__sky', { drift: [0, delta, 0.5] });
    /* near the zenith the cloud plane is dir.xz x K */
    const elev = skyA.cloudElevation, K = skyA.cloudScale * 3600 / (mix(1, 0.4, elev) + 0.12);
    /* the screen's map to dir.xz round the centre, by least squares: [dx dz] = J [px py] */
    const cx = W / 2, cy = H / 2, R = 60;
    let sxx = 0, sxy = 0, syy = 0, bx = [0, 0], by = [0, 0];
    for (let y = cy - R; y < cy + R; y++) for (let x = cx - R; x < cx + R; x++) {
      const k = (y * W + x) * 4, u = x - cx, v = y - cy;
      sxx += u * u; sxy += u * v; syy += v * v;
      bx[0] += u * dirs[k]; bx[1] += v * dirs[k]; by[0] += u * dirs[k + 2]; by[1] += v * dirs[k + 2];
    }
    const det = sxx * syy - sxy * sxy;
    const J = [[(syy * bx[0] - sxy * bx[1]) / det, (sxx * bx[1] - sxy * bx[0]) / det], [(syy * by[0] - sxy * by[1]) / det, (sxx * by[1] - sxy * by[0]) / det]];
    const toScreen = ([dx, dz]) => { const d = J[0][0] * J[1][1] - J[0][1] * J[1][0]; return [(J[1][1] * dx - J[0][1] * dz) / d, (-J[1][0] * dx + J[0][0] * dz) / d]; };
    const shiftOf = (a, b) => {
      /* the screen shift s with b(p) = a(p - s), round the centre */
      const err = (sx, sy) => { let e = 0; for (let y = cy - R; y < cy + R; y++) for (let x = cx - R; x < cx + R; x++) { const d = lum(b, (y * W + x) * 4) - lum(a, ((y - sy) * W + (x - sx)) * 4); e += d * d; } return e; };
      let best = [0, 0], bestE = Infinity;
      for (let sy = -14; sy <= 14; sy++) for (let sx = -14; sx <= 14; sx++) { const e = err(sx, sy); if (e < bestE) { bestE = e; best = [sx, sy]; } }
      const para = (m, z, p) => { const d = m - 2 * z + p; return d > 0 ? 0.5 * (m - p) / d : 0; };
      const [bx0, by0] = best;
      return [bx0 + para(err(bx0 - 1, by0), bestE, err(bx0 + 1, by0)), by0 + para(err(bx0, by0 - 1), bestE, err(bx0, by0 + 1))];
    };
    const east = { measured: shiftOf(skyA.px, skyE.px).map(r4), expected: toScreen([delta / K, 0]).map(r4) };
    const south = { measured: shiftOf(skyA.px, skyS.px).map(r4), expected: toScreen([0, delta / K]).map(r4) };
    const off = s => Math.hypot(s.measured[0] - s.expected[0], s.measured[1] - s.expected[1]);
    check(backend, 'the sky\'s clouds drift downwind: east for a westerly, south for a northerly',
      off(east) < 1 && off(south) < 1 && Math.hypot(...east.expected) > 3, { east, south });

    /* ------------------------------------------------------------ valley mist */
    const vp = await call('__valleyPositions');
    const cam = vp.camera, fwd = vp.forward;
    const dawn = painted('dawn'), hazeDensity = 0.0012;
    const beforeHaze = await call('__mist', { on: false, preset: 'noon', haze: hazeDensity });
    const noMist = await call('__mist', { on: true, preset: 'noon', haze: hazeDensity });
    let mistDiff = 0;
    for (let k = 0; k < N * 4; k++) mistDiff = Math.max(mistDiff, Math.abs(beforeHaze.px[k] - noMist.px[k]));
    const ground = [];
    for (let k = 0; k < N; k++) if (Math.abs(vp.px[k * 4]) + Math.abs(vp.px[k * 4 + 1]) + Math.abs(vp.px[k * 4 + 2]) > 0) ground.push(k);
    check(backend, 'a preset without mist leaves the haze exactly as it was, and the before has none',
      mistDiff === 0 && ground.length > N * 0.5, { maxDiff: mistDiff, groundPixels: ground.length });
    const hazeMax = dawn.hazeMax;
    const expectMist = (k, haze) => {
      const x = vp.px[k * 4], y = vp.px[k * 4 + 1], z = vp.px[k * 4 + 2];
      const length = Math.hypot(x - cam[0], y - cam[1], z - cam[2]);
      const m = valleyMistAmount({ fromY: cam[1], toY: y, length, base: 0, ...dawn.valleyMist });
      const viewZ = (x - cam[0]) * fwd[0] + (y - cam[1]) * fwd[1] + (z - cam[2]) * fwd[2];
      const h = haze ? (1 - Math.exp(-((haze * viewZ) ** 2))) * hazeMax : 0;
      return { amount: Math.min(hazeMax, h + m * (1 - h)), y, length };
    };
    const mistOnly = await call('__mist', { on: true, preset: 'dawn' });
    const withHaze = await call('__mist', { on: true, preset: 'dawn', haze: hazeDensity });
    const errOnly = [], errHaze = [], floor = [], slope = [];
    for (const k of ground) {
      const e = expectMist(k, 0), g = mistOnly.px[k * 4 + 1];
      errOnly.push(Math.abs(g - e.amount));
      errHaze.push(Math.abs(withHaze.px[k * 4 + 1] - expectMist(k, hazeDensity).amount));
      if (e.length > 350 && e.length < 450) (e.y < 3 ? floor : e.y > 25 ? slope : []).push(g);
    }
    const mistStats = { snapshot: mistOnly.snapshot.valleyMist, medianError: r4(quantile(errOnly, 0.5)), p99Error: r4(quantile(errOnly, 0.99)),
      withHaze: { medianError: r4(quantile(errHaze, 0.5)), p99Error: r4(quantile(errHaze, 0.99)) },
      at400m: { floor: r4(mean(floor)), slopes: r4(mean(slope)), floorPixels: floor.length, slopePixels: slope.length } };
    check(backend, 'the mist the eye sees at every pixel is the closed form\'s, alone and with the haze, and it lies on the valley floor, not its slopes',
      mistStats.medianError < 0.003 && mistStats.p99Error < 0.02 && mistStats.withHaze.p99Error < 0.02
        && floor.length > 50 && slope.length > 50 && mistStats.at400m.floor > 4 * mistStats.at400m.slopes && mistStats.at400m.floor > 0.03, mistStats);

    check(backend, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });

    if (backend === 'webgl2') {
      const picture = async label => shots.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
      await call('__pictureClouds', { opacity: 0, cover: 0, offset: [256, 3776] }); await picture('noon, before');
      /* the noon preset's own cover and opacity, the pattern placed so that its clouds cross the view */
      const noon = painted('noon').cloudShadow;
      await call('__pictureClouds', { opacity: noon.opacity, cover: noon.cover, offset: [256, 3776] }); await picture('noon, cloud shadows');
      await call('__pictureMist', { on: false }); await picture('dawn, before');
      await call('__pictureMist', { on: true }); await picture('dawn, valley mist');
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
      fs.writeFileSync(`${dir}/clouds-and-mist.jpg`, Buffer.from(jpg, 'base64'));
    }
    await browser.close();
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
