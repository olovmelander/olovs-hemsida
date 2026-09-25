// Boots the built app with the air batch and with every before switch, on
// WebGL2 at high and low quality, and records what each change left in the
// running scene -- the wind the plants and sky are on, the cloud shadows and
// the valley mist -- and every page or console error: a shader that fails to
// compile reports one. States, not pictures (full courses render black in
// software rendering). Ängsö's first tee:
//  - at dawn, which has both cloud shadows and valley mist, high and low quality;
//  - at dawn with every before switch;
//  - at noon with a forced northerly of 8 m/s (?vind=0,8), pinned (det=1);
//  - at noon live, twice: as it runs, and with reduced motion asked for.
// Run from the repository root after a build:
//   node docs/graphics/air-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { flagWindYaw } from '../../../apps/golf/src/engine/flag-motion.mjs';
import { downwindOf, swayStrength, ONE_WIND } from '../../../apps/golf/src/engine/one-wind.mjs';

const dir = 'docs/graphics/air-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8692;
const BEFORE = 'onewind=0&cloudshadows=0&valleymist=0';
/* WebGPU on the real adapter only: in software rendering the full app never
   finished loading on WebGPU in this container, before these changes too;
   isolated.html compiles the changed shaders there */
const RUNS = [
  { name: 'dawn', q: 'hi', query: 'det=1&ljus=gryning' },
  { name: 'dawn, low quality', q: 'lo', query: 'det=1&ljus=gryning' },
  { name: 'dawn, every before', q: 'hi', query: `det=1&ljus=gryning&${BEFORE}` },
  { name: 'noon, a northerly at 8 m/s', q: 'hi', query: 'det=1&ljus=dag&vind=0,8' },
  { name: 'noon, live', q: 'hi', query: 'ljus=dag', live: true },
  { name: 'noon, live, reduced motion', q: 'hi', query: 'ljus=dag', live: true, reducedMotion: true },
  ...(GPU ? [{ name: 'dawn, WebGPU', q: 'hi', query: 'det=1&ljus=gryning', backend: 'webgpu' }] : []),
];
const argsFor = backend => backend === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu'] : browserArgs();

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [];
let failed = false;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
try {
  for (const run of RUNS) {
    const backend = run.backend || 'webgl2';
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    if (run.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=angso&v2=require&ghibli=1&q=${run.q}&qualitylock=1${backend === 'webgl2' ? '&gl=1' : ''}&hal=1&vy=tee&${run.query}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    const read = () => page.evaluate(() => {
      const a = V3D.atmosphere();
      return { preset: a.preset, wind: a.wind, cloudShadow: a.cloudShadow, valleyMist: a.aerialPerspective.valleyMist, frame: V3D.frame() };
    });
    const first = await read();
    let later = null;
    if (run.live) {
      /* a few seconds of the running app later */
      const f1 = first.frame;
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 12, f1, { timeout: 600000, polling: 500 });
      later = await read();
    }
    const tiersAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const w = first.wind, target = w.target;
    const targetMs = Number.isFinite(target.ms) ? target.ms : ONE_WIND.referenceMs;
    const [ax, az] = downwindOf(Number.isFinite(target.fromDeg) ? flagWindYaw(target.fromDeg) : 0);
    const checks = {};
    checks.noErrors = errors.length === 0;
    checks.tierAudit = tiersAudit === true;
    if (run.query.includes(BEFORE)) {
      checks.beforesOff = w.oneWind === false && first.cloudShadow === null && first.valleyMist === null;
    } else {
      checks.oneWindOn = w.oneWind === true;
      if (first.preset === 'dawn') {
        checks.dawnCloudShadows = first.cloudShadow?.opacity === 0.45 && first.cloudShadow.cover === 0.3 && first.cloudShadow.threshold < 1;
        checks.dawnValleyMist = first.valleyMist?.density === 0.0016 && first.valleyMist.height === 6 && Number.isFinite(first.valleyMist.base);
      }
      if (first.preset === 'noon') {
        checks.noonCloudShadows = first.cloudShadow?.opacity === 0.62 && first.cloudShadow.cover === 0.3;
        checks.noonNoMist = first.valleyMist?.density === 0;
      }
    }
    if (!run.live) {
      /* det=1 pins the air to the target wind: its axis, its sway, nothing carried */
      checks.pinnedToTarget = near(w.axis[0], ax, 1e-9) && near(w.axis[1], az, 1e-9) && near(w.sway, swayStrength(targetMs), 1e-9)
        && w.gust.every(v => v === 0) && w.sky.every(v => v === 0);
    }
    if (run.query.includes('vind=0,8')) checks.northerlyBlowsSouth = target.source === 'url' && near(w.axis[0], 0, 1e-9) && near(w.axis[1], 1, 1e-9) && near(w.sway, 1.8, 1e-9);
    if (run.live && !run.reducedMotion) {
      const moved = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-6);
      checks.airCarries = moved(w.gust, later.wind.gust) && later.wind.sky[2] > w.sky[2] && moved(first.cloudShadow.offset, later.cloudShadow.offset) && later.wind.sway > 0;
    }
    if (run.reducedMotion) {
      checks.stillForReducedMotion = w.sway === 0 && later.wind.sway === 0
        && JSON.stringify([w.gust, w.sky, first.cloudShadow.offset]) === JSON.stringify([later.wind.gust, later.wind.sky, later.cloudShadow.offset]);
    }
    const row = { name: run.name, backend, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), checks, first, later, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, wind: first.wind, cloudShadow: first.cloudShadow, valleyMist: first.valleyMist }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
