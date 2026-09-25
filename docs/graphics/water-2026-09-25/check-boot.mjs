// Boots the built app with the water batch and with its before switches, on
// WebGL2 at high and low quality, compiles every material in the scene -- the
// water's included, in view or not -- and records the water's state and every
// page or console error: a shader that fails to compile reports one. States,
// not pictures (full courses render black in software rendering).
//  - Ängsö at golden hour, high and low quality, pinned (det=1); and with both befores;
//  - Ängsö at noon in a 12 m/s westerly (?vind=270,12), pinned;
//  - Ängsö at noon running, as it runs and with reduced motion asked for;
//  - Norrfällsviken at golden hour, pinned: the open sea's sheets.
// Run from the repository root after a build:
//   node docs/graphics/water-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { waterChopFor } from '../../../apps/golf/src/engine/nordic-water.mjs';
import { ONE_WIND } from '../../../apps/golf/src/engine/one-wind.mjs';

const dir = 'docs/graphics/water-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8695;
const BEFORE = 'nordicwater=0&waterwind=0';
const RUNS = [
  { name: 'Ängsö, golden hour', course: 'angso', q: 'hi', query: 'det=1&ljus=kvall' },
  { name: 'Ängsö, golden hour, low quality', course: 'angso', q: 'lo', query: 'det=1&ljus=kvall' },
  { name: 'Ängsö, golden hour, both befores', course: 'angso', q: 'hi', query: `det=1&ljus=kvall&${BEFORE}` },
  { name: 'Ängsö, noon, a 12 m/s westerly', course: 'angso', q: 'hi', query: 'det=1&ljus=dag&vind=270,12' },
  { name: 'Ängsö, noon, running', course: 'angso', q: 'hi', query: 'ljus=dag', live: true },
  { name: 'Ängsö, noon, running, reduced motion', course: 'angso', q: 'hi', query: 'ljus=dag', live: true, reducedMotion: true },
  { name: 'Norrfällsviken, golden hour', course: 'norrfallsviken', q: 'hi', query: 'det=1&ljus=kvall' },
];

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [];
let failed = false;
try {
  for (const run of RUNS) {
    const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    if (run.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee&${run.query}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material, the water's out of view too, compiled: a failing shader reports an error */
    const sheets = await page.evaluate(async () => {
      const { scene, renderer, camera } = V3D.harness();
      await renderer.compileAsync(scene, camera);
      let water = 0;
      scene.traverse(o => { if (o.isMesh && o.geometry?.getAttribute?.('aShore')) water++; });
      return water;
    });
    const read = () => page.evaluate(() => ({ water: V3D.water(), wind: V3D.atmosphere().wind, frame: V3D.frame() }));
    const first = await read();
    let later = null;
    if (run.live) {
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 12, first.frame, { timeout: 600000, polling: 500 });
      later = await read();
    }
    const tiersAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const w = first.water, checks = { noErrors: errors.length === 0, tierAudit: tiersAudit === true, waterSheets: sheets > 0 };
    if (run.query.includes(BEFORE)) checks.beforesOff = w.nordic === null && w.wind === null;
    else {
      checks.nordicOn = Array.isArray(w.nordic?.sun) && Math.max(...w.nordic.sun) > 0.999 && w.nordic.treeLine.every(v => v < 0.2);
      const targetMs = Number.isFinite(first.wind.target.ms) ? first.wind.target.ms : ONE_WIND.referenceMs;
      checks.chopFollowsWind = Math.abs(w.wind.chop - waterChopFor(targetMs)) < 1e-9 || run.live;
      if (!run.live) checks.pinned = w.wind.patch.every(v => v === 0) && w.wind.flow.every(f => f.every(v => v === 0));
    }
    if (run.query.includes('vind=270,12')) checks.galeChop = w.wind.chop === 1.6;
    if (run.live && !run.reducedMotion) checks.waterMoves = later.water.wind.patch[0] > w.wind.patch[0] && JSON.stringify(later.water.wind.flow) !== JSON.stringify(w.wind.flow);
    if (run.reducedMotion) checks.stillForReducedMotion = JSON.stringify(later.water.wind) === JSON.stringify(w.wind);
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), waterSheets: sheets, checks, first, later, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, sheets, checks, water: first.water }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
