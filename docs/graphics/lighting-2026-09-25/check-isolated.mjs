// The lighting batch's shaders in isolated scenes (isolated.html), on WebGL2 and
// on WebGPU with reversed depth, each against its before:
//  - the sun glow: the low-sun skies are warmer toward the sun, hardly changed
//    away from it, and the skies without a glow are the same picture;
//  - the shadow tint: sunlit ground is unchanged, and the umbra gains the
//    preset's sky colour at its share of the sun -- the predicted amount -- yet
//    stays darker than sunlit ground in every channel;
//  - the haze: warmer toward the sun in the low-sun presets, the same away
//    from it, and the same picture where the sky has no glow;
//  - the crowns: an approved crown drawn as the player draws it, and the
//    impostor baked from it, darker for its baked depth, and brighter against
//    the sun for the back-light but hardly at all away from it.
// Software rendering by default, BANVY_GPU=1 for the real adapter. Run from the
// repository root: node docs/graphics/lighting-2026-09-25/check-isolated.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/lighting-2026-09-25';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const port = 8677;
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
const round = v => Math.round(v * 1e4) / 1e4;
const GLOW = ['golden', 'dawn', 'midnight', 'host'];
const PLAIN = ['noon', 'bluehour', 'storm', 'mist'];
/* warmth of a view: the mean of (r - b) / (r + g + b) over the sky's pixels */
const warmth = px => {
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const t = px[i] + px[i + 1] + px[i + 2];
    if (t > 1e-4) { sum += (px[i] - px[i + 2]) / t; n++; }
  }
  return sum / Math.max(1, n);
};
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const sheets = {};
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

    /* the sun glow */
    const sky = {}, shots = [];
    for (const preset of [...GLOW, ...PLAIN]) {
      sky[preset] = {};
      for (const toward of ['sun', 'away']) for (const glow of [false, true]) {
        const px = await page.evaluate(a => window.__sky(a), { preset, glow, toward });
        sky[preset][`${toward}-${glow ? 'glow' : 'before'}`] = px;
        if (backend === 'webgl2' && toward === 'sun' && GLOW.includes(preset)) {
          shots.push({ label: `${preset} ${glow ? 'glow' : 'before'}`, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
        }
      }
    }
    const glowRows = {};
    for (const preset of GLOW) {
      const s = sky[preset];
      const sunward = warmth(s['sun-glow']) - warmth(s['sun-before']);
      const away = warmth(s['away-glow']) - warmth(s['away-before']);
      glowRows[preset] = { sunwardWarmer: round(sunward), awayWarmer: round(away) };
    }
    check(backend, 'each low-sun sky is warmer toward the sun with its glow, and little changed away from it',
      GLOW.every(p => glowRows[p].sunwardWarmer > 0.004 && Math.abs(glowRows[p].awayWarmer) < glowRows[p].sunwardWarmer / 3), glowRows);
    const plainRows = Object.fromEntries(PLAIN.map(p => [p, round(Math.max(maxDiff(sky[p]['sun-glow'], sky[p]['sun-before']), maxDiff(sky[p]['away-glow'], sky[p]['away-before'])))]));
    check(backend, 'the skies without a glow are the same picture', Object.values(plainRows).every(v => v === 0), { maxDifference: plainRows });

    /* the shadow tint */
    const shadowRows = {};
    let shadowOk = true;
    for (const preset of ['noon', 'golden', 'dawn', 'midnight', 'host', 'storm']) {
      const plain = await page.evaluate(a => window.__shadow(a), { preset, tinted: false });
      const tinted = await page.evaluate(a => window.__shadow(a), { preset, tinted: true });
      /* three's direct diffuse: dotNL x light x albedo / pi, on a white floor */
      const predicted = tinted.sky.map(c => tinted.share * tinted.int * tinted.sunUp * c / Math.PI);
      const gained = [0, 1, 2].map(c => tinted.umbra[c] - plain.umbra[c]);
      const litChange = Math.max(...[0, 1, 2].map(c => Math.abs(tinted.lit[c] - plain.lit[c])));
      const row = { lit: tinted.lit.map(round), umbraBefore: plain.umbra.map(round), umbra: tinted.umbra.map(round),
        gained: gained.map(round), predicted: predicted.map(round), litChange: round(litChange),
        pixels: { lit: tinted.litPixels, umbra: tinted.umbraPixels, floor: tinted.floorPixels } };
      const ok = litChange < 1e-3 && tinted.umbraPixels > 200 && tinted.litPixels > 1000
        && [0, 1, 2].every(c => Math.abs(gained[c] - predicted[c]) <= 0.03 * Math.max(predicted[c], 1e-3) + 2e-3)
        && [0, 1, 2].every(c => tinted.umbra[c] < tinted.lit[c]);
      row.ok = ok;
      if (!ok) shadowOk = false;
      shadowRows[preset] = row;
    }
    check(backend, 'the umbra gains the sky colour at its share of the sun, sunlit ground is unchanged, and the shadow stays darker', shadowOk, shadowRows);
    /* the haze */
    const haze = {}, hazeShots = [];
    for (const preset of [...GLOW, ...PLAIN]) {
      haze[preset] = {};
      for (const toward of ['sun', 'away']) for (const warm of [false, true]) {
        const { pixels } = await page.evaluate(a => window.__haze(a), { preset, warm, toward });
        haze[preset][`${toward}-${warm ? 'warm' : 'before'}`] = pixels;
        if (backend === 'webgl2' && GLOW.includes(preset) && (toward === 'sun' || preset === 'golden')) {
          hazeShots.push({ label: `${preset} ${toward === 'sun' ? 'sunward' : 'away'} ${warm ? 'warm haze' : 'before'}`,
            png: (await page.locator('canvas').first().screenshot()).toString('base64') });
        }
      }
    }
    const hazeRows = {};
    for (const preset of GLOW) {
      const h = haze[preset];
      hazeRows[preset] = { sunwardWarmer: round(warmth(h['sun-warm']) - warmth(h['sun-before'])),
        awayWarmer: round(warmth(h['away-warm']) - warmth(h['away-before'])) };
    }
    check(backend, 'the haze is warmer toward the sun in each low-sun preset, and hardly changed away from it',
      GLOW.every(p => hazeRows[p].sunwardWarmer > 0.003 && Math.abs(hazeRows[p].awayWarmer) < hazeRows[p].sunwardWarmer / 3), hazeRows);
    const hazePlain = Object.fromEntries(PLAIN.map(p => [p, round(Math.max(maxDiff(haze[p]['sun-warm'], haze[p]['sun-before']), maxDiff(haze[p]['away-warm'], haze[p]['away-before'])))]));
    check(backend, 'without a sun glow the haze is the same picture', Object.values(hazePlain).every(v => v <= 2e-3), { maxDifference: hazePlain });
    if (hazeShots.length) shots.push(...hazeShots);

    /* the crowns */
    const crowns = {}, crownShots = [];
    const lum = m => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    for (const key of ['gran', 'björk', 'ek']) {
      crowns[key] = {};
      for (const impostor of [false, true]) {
        const kind = impostor ? 'impostor' : 'mesh';
        const at = async (toward, depth, back) => lum((await page.evaluate(a => window.__tree(a), { key, preset: 'golden', depth, back, toward, impostor })).mean);
        const flatSide = await at('side', false, false), deepSide = await at('side', true, false);
        const deepSun = await at('sun', true, false), backSun = await at('sun', true, true), backSide = await at('side', true, true);
        crowns[key][kind] = { depth: round(deepSide / flatSide - 1), backTowardSun: round(backSun / deepSun - 1), backAway: round(backSide / deepSide - 1) };
        if (backend === 'webgl2' && !impostor) for (const [toward, depth, back, label] of [['side', false, false, 'flat'], ['side', true, false, 'depth'],
          ['sun', true, false, 'against the sun'], ['sun', true, true, 'back-light']]) {
          await page.evaluate(a => window.__tree(a), { key, preset: 'golden', depth, back, toward, impostor, picture: true });
          crownShots.push({ label: `${key} ${label}`, png: (await page.locator('canvas').first().screenshot()).toString('base64') });
        }
      }
    }
    check(backend, 'the baked depth darkens each crown, and its impostor with it', Object.values(crowns).every(c =>
      c.mesh.depth < -0.02 && c.mesh.depth > -0.2 && c.impostor.depth < -0.01 && c.impostor.depth > -0.2), crowns);
    check(backend, 'the back-light brightens a crown against the sun, mesh and impostor, and hardly at all away from it', Object.values(crowns).every(c =>
      ['mesh', 'impostor'].every(k => c[k].backTowardSun > 0.2 && c[k].backTowardSun < 1.5 && Math.abs(c[k].backAway) < 0.05)), crowns);
    if (crownShots.length) sheets.crowns = { shots: crownShots, columns: 4 };
    check(backend, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    const sheet = (shots, columns) => page.evaluate(async ({ shots, columns }) => {
      const images = await Promise.all(shots.map(async s => { const im = new Image(); im.src = `data:image/png;base64,${s.png}`; await im.decode(); return im; }));
      const w = images[0].width, h = images[0].height, c = document.createElement('canvas');
      c.width = w * columns; c.height = h * Math.ceil(images.length / columns);
      const g = c.getContext('2d');
      images.forEach((im, i) => {
        const x = (i % columns) * w, y = Math.floor(i / columns) * h;
        g.drawImage(im, x, y);
        g.font = '14px sans-serif';
        const width = g.measureText(shots[i].label).width + 12;
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + 6, y + 6, width, 22);
        g.fillStyle = '#fff'; g.fillText(shots[i].label, x + 12, y + 22);
      });
      return c.toDataURL('image/jpeg', 0.86).split(',')[1];
    }, { shots, columns });
    if (shots.length) sheets.sky = await sheet(shots, 2);
    if (sheets.crowns?.shots) sheets.crowns = await sheet(sheets.crowns.shots, sheets.crowns.columns);
    await browser.close();
  }
} finally {
  server.kill();
}
if (typeof sheets.sky === 'string') fs.writeFileSync(`${dir}/sun-glow-and-haze.jpg`, Buffer.from(sheets.sky, 'base64'));
if (typeof sheets.crowns === 'string') fs.writeFileSync(`${dir}/crowns.jpg`, Buffer.from(sheets.crowns, 'base64'));
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
