// Boots the built app with the water from above and with its befores on WebGL2,
// compiles every material in the scene -- every water sheet included, in view or
// not -- and reads back the water's state (V3D.water) and every page or console
// error: a water shader that fails to compile reports one. States, not pictures
// (full courses render black in software rendering).
//  - Visby, high and low quality (det=1, golden hour), and at noon: the body's
//    share in a cloud's full shade is the one level ground keeps under that light,
//    reckoned with the environment the app lit the scene with, and the patches on;
//  - Visby with both befores: neither;
//  - Ängsö: a lake course, the same.
// Run from the repository root after a build:
//   node docs/graphics/water-above-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { groundCloudShadeFor } from '../../../apps/golf/src/engine/water-above.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';

const dir = 'docs/graphics/water-above-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8713;
const BEFORE = 'watercloud=0&waterlanes=0';
const share = (name, environment) => groundCloudShadeFor(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]), { environment }).toArray();
const RUNS = [
  { name: 'Visby, high quality', course: 'visby', q: 'hi', query: 'det=1&ljus=kvall', light: 'golden' },
  { name: 'Visby, low quality', course: 'visby', q: 'lo', query: 'det=1&ljus=kvall', light: 'golden' },
  { name: 'Visby, both befores', course: 'visby', q: 'hi', query: `det=1&ljus=kvall&${BEFORE}`, light: 'golden', before: true },
  { name: 'Visby at noon', course: 'visby', q: 'hi', query: 'det=1&ljus=dag', light: 'noon' },
  { name: 'Ängsö, a lake course', course: 'angso', q: 'hi', query: 'det=1&ljus=kvall', light: 'golden' },
];

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
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee&${run.query}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const water = await page.evaluate(() => V3D.water());
    const environment = await page.evaluate(() => V3D.lightingEnvironment().enabled);
    const tiersAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const checks = { noErrors: errors.length === 0, tierAudit: tiersAudit === true };
    const expected = share(run.light, environment);
    if (run.before) checks.befores = water.cloudShade === null && water.lanes === false;
    else {
      checks.cloudShade = Array.isArray(water.cloudShade) && water.cloudShade.every((v, c) => Math.abs(v - expected[c]) < 1e-6);
      checks.lanes = water.lanes === true;
    }
    /* the water road pass stays as it was */
    checks.waterRoad = water.road === true && water.mirror === true && water.openSea.on === true;
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, environment, expected: run.before ? null : expected.map(v => +v.toFixed(4)),
      water: { cloudShade: water.cloudShade && water.cloudShade.map(v => +v.toFixed(4)), lanes: water.lanes, road: water.road, relief: water.relief,
        openSeaSheets: water.openSea.sheets, lakeSheets: water.openSea.lakeSheets }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, environment, water: row.water }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
