// Boots the built app with the clouds batch and with its befores on WebGL2,
// compiles every material in the scene and reads back what each light's sky,
// clouds' shadows and water draw (V3D.atmosphere, V3D.water), and every page or
// console error. States, not pictures (full courses render black in software
// rendering).
//  - Visby in golden hour at high and low quality, with ?cloudlight=0,
//    ?cloudstretch=0 and both: the sky lit by the sun, its base colour, the
//    shadows' stretch along the sun, the water's body taking long shadows;
//  - Visby at noon and in autumn, Ängsö (a lake course) at dawn and under the
//    midnight sun: each light's share, base and stretch;
//  - Visby in the blue hour and the storm: a sky lit by the sun at no share;
//  - Visby in golden hour with the air moving (no det=1): the shadows' drift
//    stays finite and within the pattern's tile as the air carries it.
// Run from the repository root after a build (BANVY_RUNS=<pattern> runs the
// boots whose names match):
//   node docs/graphics/clouds-2026-09-26/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';
import { shadowStretch } from '../../../apps/golf/src/engine/cloud-shadow.mjs';

const dir = 'docs/graphics/clouds-2026-09-26';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8728;
/* what setPreset leaves: the sky's sun lighting and base colour, the shadows' stretch and azimuth, the water's rule */
const expected = (name, { light = true, stretch = true } = {}) => {
  const p = paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]), n = Math.hypot(...p.dir), flat = Math.hypot(p.dir[0], p.dir[2]);
  return { preset: name, sunLit: light, cloudSun: light ? p.skyCloudSun ?? 0 : 0, cloudBase: p.skyCloudBase ?? p.skyCloudShade ?? 0xa5b5c6,
    stretch: stretch ? +shadowStretch(p.dir[1] / n).toFixed(4) : null, along: stretch ? [p.dir[0] / flat, p.dir[2] / flat].map(v => +v.toFixed(4)) : null,
    longShadows: stretch, shadowOpacity: p.cloudShadow?.opacity ?? 0 };
};
const ALL_RUNS = [
  { name: 'Visby, Kväll, high quality', course: 'visby', q: 'hi', query: 'ljus=kvall', light: 'golden' },
  { name: 'Visby, Kväll, low quality', course: 'visby', q: 'lo', query: 'ljus=kvall', light: 'golden' },
  { name: 'Visby, Kväll, ?cloudlight=0', course: 'visby', q: 'hi', query: 'ljus=kvall&cloudlight=0', light: 'golden', off: { light: false } },
  { name: 'Visby, Kväll, ?cloudstretch=0', course: 'visby', q: 'hi', query: 'ljus=kvall&cloudstretch=0', light: 'golden', off: { stretch: false } },
  { name: 'Visby, Kväll, both befores', course: 'visby', q: 'hi', query: 'ljus=kvall&cloudlight=0&cloudstretch=0', light: 'golden', off: { light: false, stretch: false } },
  { name: 'Visby, Dag', course: 'visby', q: 'hi', query: 'ljus=dag', light: 'noon' },
  { name: 'Visby, Höst', course: 'visby', q: 'hi', query: 'ljus=host', light: 'host' },
  { name: 'Ängsö, Gryning', course: 'angso', q: 'hi', query: 'ljus=gryning', light: 'dawn' },
  { name: 'Ängsö, Midnattssol', course: 'angso', q: 'hi', query: 'ljus=midnattssol', light: 'midnight' },
  { name: 'Visby, Blå timmen', course: 'visby', q: 'hi', query: 'ljus=blatimmen', light: 'bluehour' },
  { name: 'Visby, Oväder', course: 'visby', q: 'hi', query: 'ljus=ovader', light: 'storm' },
  { name: 'Visby, Kväll, the air moving', course: 'visby', q: 'hi', query: 'ljus=kvall', light: 'golden', live: true },
];
const RUNS = ALL_RUNS.filter(run => !process.env.BANVY_RUNS || new RegExp(process.env.BANVY_RUNS).test(run.name));

const close = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const state = () => {
  const a = V3D.atmosphere(), w = V3D.water(), c = a.cloudShadow;
  return { preset: a.preset, sunLit: a.sunLit, cloudSun: a.cloudSun, cloudBase: a.cloudBase,
    stretch: c?.stretch ?? null, along: c?.along ?? null, shadowOpacity: c?.opacity ?? 0, offset: c?.offset ?? null, longShadows: w.longShadows };
};

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [];
let failed = false;
try {
  for (const run of RUNS) {
    const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee${run.live ? '' : '&det=1'}&${run.query}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const got = await page.evaluate(state);
    /* with the air moving, the drift a few seconds on: carried, finite, within the tile */
    let drift = null;
    if (run.live) {
      const f2 = await page.evaluate(() => V3D.frame());
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 30, f2, { timeout: 600000, polling: 500 });
      drift = { first: got.offset, later: (await page.evaluate(state)).offset };
    }
    const tierAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const want = expected(run.light, run.off);
    const checks = {
      noErrors: errors.length === 0, tierAudit: tierAudit === true, preset: got.preset === want.preset,
      sky: got.sunLit === want.sunLit && close(got.cloudSun, want.cloudSun) && got.cloudBase === want.cloudBase,
      shadows: want.stretch === null ? got.stretch === null && got.along === null
        : close(got.stretch, want.stretch, 1e-3) && got.along.every((v, i) => close(v, want.along[i], 1e-3)),
      /* the drift the shader subtracts: the air's own, or stretched, the pattern's, within the tile */
      drift: want.stretch === null || got.offset.every(v => v >= 0 && v < 4096),
      ...(run.live ? { carried: [...drift.first, ...drift.later].every(v => Number.isFinite(v) && v >= 0 && v < 4096)
        && drift.later.some((v, i) => v !== drift.first[i]) } : {}),
      water: got.longShadows === want.longShadows, shadowOpacity: close(got.shadowOpacity, want.shadowOpacity),
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000), checks, got, want, drift, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, got }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
