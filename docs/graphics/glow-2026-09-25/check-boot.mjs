// Boots the built app with the glow batch and with its befores on WebGL2,
// compiles every material in the scene (the sky's included) and steps through
// every light with the page's own buttons, reading back the glow's threshold and
// strength and the clouds' shine, and every page or console error: a shader
// that fails to compile reports one. States, not pictures (full courses render
// black in software rendering).
//  - Ängsö, high quality, pinned (det=1): all eight lights;
//  - Ängsö, low quality: no glow and no shine;
//  - Ängsö, high quality, both befores: 0.86 and no shine in every light;
//  - Norrfällsviken at dawn from the URL;
//  - Ängsö, high quality without the quality lock: software rendering is slow
//    enough for the runtime drop, which takes the glow and the shine with it.
// Run from the repository root after a build:
//   node docs/graphics/glow-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { GLOW, glowThresholdOf, cloudGlowOf } from '../../../apps/golf/src/engine/glow.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';

const dir = 'docs/graphics/glow-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8699;
const BEFORE = 'glowthreshold=0&cloudglow=0';
const LIGHTS = Object.keys(ATMOSPHERE_PRESETS);
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const RUNS = [
  { name: 'Ängsö, high quality, every light', course: 'angso', q: 'hi', query: 'det=1&ljus=kvall', lights: LIGHTS },
  { name: 'Ängsö, low quality', course: 'angso', q: 'lo', query: 'det=1&ljus=kvall', lights: ['golden', 'dawn'] },
  { name: 'Ängsö, high quality, both befores, every light', course: 'angso', q: 'hi', query: `det=1&ljus=kvall&${BEFORE}`, lights: LIGHTS },
  { name: 'Norrfällsviken at dawn, from the URL', course: 'norrfallsviken', q: 'hi', query: 'det=1&ljus=gryning', lights: [] },
  { name: 'Ängsö, high quality, the runtime drop', course: 'angso', q: 'hi', query: 'ljus=kvall', lights: [], drop: true },
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
    const lock = run.drop ? '' : '&qualitylock=1';
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}${lock}&gl=1&hal=1&vy=tee&${run.query}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const read = () => page.evaluate(() => { const q = V3D.quality(), a = V3D.atmosphere();
      return { preset: a.preset, threshold: q.bloomThreshold, strength: q.bloom, cloudGlow: a.cloudGlow, lowfx: q.lowfx }; });
    /* before the verdict (14 s after boot applies the preset -- a full course boots slower than that
       in software rendering): the preset with its glow and shine, read as soon as the page has it */
    const early = run.drop ? (await page.waitForFunction(() => { try { const q = V3D.quality(), a = V3D.atmosphere();
      return !q.lowfx && q.bloom > 0 && a.cloudGlow?.[0] > 0 ? { preset: a.preset, threshold: q.bloomThreshold, strength: q.bloom, cloudGlow: a.cloudGlow, lowfx: q.lowfx } : null; }
      catch { return null; } }, null, { timeout: 900000, polling: 200 })).jsonValue() : null;
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const states = [...(early ? [await early] : []), await read()];
    for (const light of run.lights) {
      await page.evaluate(name => document.querySelector(`[data-preset="${name}"]`).click(), light);
      states.push(await read());
    }
    if (run.drop) {
      /* the verdict comes 14 s after load, from ten one-second frame-rate samples */
      await page.waitForFunction(() => V3D.quality().lowfx, null, { timeout: 120000, polling: 1000 });
      states.push(await read());
    }
    const tiersAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const checks = { noErrors: errors.length === 0, tierAudit: tiersAudit === true };
    const expected = s => {
      const p = painted(s.preset), before = run.query.includes(BEFORE);
      if (run.q === 'lo') return s.threshold === null && same(s.cloudGlow, [0, 0, 0]);
      if (s.lowfx) return s.strength === 0 && same(s.cloudGlow, [0, 0, 0]);
      return s.threshold === (before ? GLOW.threshold : glowThresholdOf(p)) && s.strength === (p.bloom ?? 0.14)
        && same(s.cloudGlow, before ? [0, 0, 0] : cloudGlowOf(p).toArray());
    };
    checks.everyLight = states.every(expected);
    if (run.lights.length) checks.lightsVisited = run.lights.every(l => states.some(s => s.preset === l));
    /* the shine was on before the verdict and went with the glow */
    if (run.drop) checks.dropped = states[0].lowfx === false && !same(states[0].cloudGlow, [0, 0, 0])
      && states.at(-1).lowfx === true && states.at(-1).strength === 0 && same(states.at(-1).cloudGlow, [0, 0, 0]);
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), checks, states, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, states: states.map(s => `${s.preset} ${s.threshold} ${s.strength} [${s.cloudGlow.map(v => v.toFixed(3))}]${s.lowfx ? ' lowfx' : ''}`) }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
