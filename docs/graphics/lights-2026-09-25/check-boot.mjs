// Boots the built app in the audited lights and with their before on WebGL2,
// compiles every material in the scene and reads back each light's state
// (V3D.atmosphere: the sky, the sun, the glaze on the land, the air's wind;
// the renderer's exposure) and every page or console error. States, not
// pictures (full courses render black in software rendering).
//  - Visby in the blue hour at high and low quality, and with ?lights=before;
//  - Visby in the storm, with a wind asked for (?vind=270,3), and before;
//  - Visby in golden hour and at noon: their suns' heights;
//  - Ängsö at dawn and under the midnight sun: their glazes, and dawn's mist.
// Run from the repository root after a build (BANVY_RUNS=<pattern> runs the
// boots whose names match):
//   node docs/graphics/lights-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';
import { glazeOf } from '../../../apps/golf/src/engine/aerial-perspective.mjs';
import { lightWind } from '../../../apps/golf/src/engine/one-wind.mjs';

const dir = 'docs/graphics/lights-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8727;
/* what setPreset leaves: the sky's clouds and sun, the glaze, the exposure, and the air's wind over the default breeze
   (an automated browser never reads the weather) or the one asked for */
const expected = (name, { before = false, vind = null } = {}) => {
  const p = paintedAtmosphere(name, ATMOSPHERE_PRESETS[name], { before }), g = glazeOf(p);
  const target = vind ? { fromDeg: vind[0], ms: vind[1], gust: null, source: 'url' } : { fromDeg: null, ms: null, gust: null, source: 'default' };
  return { preset: name, elevation: +(Math.asin(p.dir[1] / Math.hypot(...p.dir)) * 180 / Math.PI).toFixed(2),
    cloudCoverage: p.cloud, cloudDensity: p.cloudDensity, cloudScale: p.cloudScale, exposure: p.exp,
    glaze: { amount: g.amount, tint: g.tint.toArray() }, windMs: lightWind(target, p.wind).ms ?? 4 };
};
const ALL_RUNS = [
  { name: 'Visby, Blå timmen, high quality', course: 'visby', q: 'hi', query: 'ljus=blatimmen', light: 'bluehour' },
  { name: 'Visby, Blå timmen, low quality', course: 'visby', q: 'lo', query: 'ljus=blatimmen', light: 'bluehour' },
  { name: 'Visby, Blå timmen, before', course: 'visby', q: 'hi', query: 'ljus=blatimmen&lights=before', light: 'bluehour', before: true },
  { name: 'Visby, Oväder', course: 'visby', q: 'hi', query: 'ljus=ovader', light: 'storm' },
  { name: 'Visby, Oväder, a wind asked for', course: 'visby', q: 'hi', query: 'ljus=ovader&vind=270,3', light: 'storm', vind: [270, 3] },
  { name: 'Visby, Oväder, before', course: 'visby', q: 'hi', query: 'ljus=ovader&lights=before', light: 'storm', before: true },
  { name: 'Visby, Kväll', course: 'visby', q: 'hi', query: 'ljus=kvall', light: 'golden' },
  { name: 'Visby, Dag', course: 'visby', q: 'hi', query: 'ljus=dag', light: 'noon' },
  { name: 'Ängsö, Gryning', course: 'angso', q: 'hi', query: 'ljus=gryning', light: 'dawn' },
  { name: 'Ängsö, Midnattssol', course: 'angso', q: 'hi', query: 'ljus=midnattssol', light: 'midnight' },
];
const RUNS = ALL_RUNS.filter(run => !process.env.BANVY_RUNS || new RegExp(process.env.BANVY_RUNS).test(run.name));

const close = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const light = () => {
  const a = V3D.atmosphere(), { renderer } = V3D.harness(), s = a.sun, n = Math.hypot(...s);
  return { preset: a.preset, elevation: +(Math.asin(s[1] / n) * 180 / Math.PI).toFixed(2), cloudCoverage: a.cloudCoverage, cloudDensity: a.cloudDensity,
    cloudScale: a.cloudScale, exposure: renderer.toneMappingExposure, glaze: a.aerialPerspective.glaze,
    valleyMist: a.aerialPerspective.valleyMist, wind: { air: a.wind.ms, light: a.wind.light, target: a.wind.target } };
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
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee&det=1&${run.query}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const got = await page.evaluate(light);
    const tierAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const want = expected(run.light, run);
    const checks = {
      noErrors: errors.length === 0, tierAudit: tierAudit === true, preset: got.preset === want.preset,
      sun: close(got.elevation, want.elevation, 0.02),
      sky: close(got.cloudCoverage, want.cloudCoverage) && close(got.cloudDensity, want.cloudDensity) && close(got.cloudScale, want.cloudScale, 1e-9),
      exposure: close(got.exposure, want.exposure),
      glaze: close(got.glaze.amount, want.glaze.amount) && got.glaze.tint.every((v, c) => close(v, want.glaze.tint[c], 1e-5)),
      /* det=1 pins the air to its target: the light's wind over the target's */
      wind: close(got.wind.air, want.windMs, 1e-4),
    };
    if (run.light === 'dawn') checks.valleyMist = got.valleyMist?.density > 0;
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000), checks, got, want, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, got: { ...got, glaze: { amount: got.glaze.amount } } }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
