// Boots the built app in the summer day and beside it on WebGL2, compiles every
// material in the scene and reads back the light's state (V3D.atmosphere,
// V3D.quality) and every page or console error. States, not pictures (full
// courses render black in software rendering).
//  - Visby, ljus=sommar, high and low quality (det=1): the summer preset, its sky
//    without clouds (coverage and density nil), no cloud shadows, the glow at its
//    threshold and strength, the haze as setPreset leaves it, the link kept;
//  - Visby, ljus=dag: noon keeps its clouds and their shadows;
//  - Visby, Dag, then the rail's Sommar button, then the drawer's Dag: the
//    buttons switch the light, the link and each other's highlight, and noon's
//    clouds come back as they were. Then the menus: at desktop widths no light
//    button's name overflows the rail, at phone widths none overflows the drawer,
//    which lays the nine lights out three by three; a picture of both;
//  - Ängsö, a lake course, in the summer day.
// Run from the repository root after a build (BANVY_RUNS=<pattern> runs the
// boots whose names match):
//   node docs/graphics/summer-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { ATMOSPHERE_PRESETS } from '../../../apps/golf/src/engine/atmosphere-presets.mjs';
import { paintedAtmosphere } from '../../../apps/golf/src/engine/painted-world-palette.mjs';
import { cloudShadowOf } from '../../../apps/golf/src/engine/cloud-shadow.mjs';
import { glowThresholdOf } from '../../../apps/golf/src/engine/glow.mjs';

const dir = 'docs/graphics/summer-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8722;
const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
/* the light setPreset leaves: the sky's clouds, their shadows, the glow at high quality, the haze off the continuous ocean */
const expected = (name, q) => {
  const p = painted(name);
  return { preset: name, cloudCoverage: p.cloud, cloudDensity: p.cloudDensity, cloudShadow: cloudShadowOf(p),
    bloom: q === 'hi' ? p.bloom ?? 0.14 : null, bloomThreshold: q === 'hi' ? glowThresholdOf(p) : null, fogDensity: p.dens * 0.9 };
};
const ALL_RUNS = [
  { name: 'Visby, Sommar, high quality', course: 'visby', q: 'hi', ljus: 'sommar', light: 'summer' },
  { name: 'Visby, Sommar, low quality', course: 'visby', q: 'lo', ljus: 'sommar', light: 'summer' },
  { name: 'Visby, Dag', course: 'visby', q: 'hi', ljus: 'dag', light: 'noon' },
  { name: 'Visby, Dag, then the buttons and the menus', course: 'visby', q: 'hi', ljus: 'dag', light: 'noon', buttons: true },
  { name: 'Ängsö, a lake course, Sommar', course: 'angso', q: 'hi', ljus: 'sommar', light: 'summer' },
];
const RUNS = ALL_RUNS.filter(run => !process.env.BANVY_RUNS || new RegExp(process.env.BANVY_RUNS).test(run.name));
/* desktop widths show the rail -- a tall window, and each of its two short-window tiers -- and phone widths the drawer
   (the rail is a sheet there) */
const RAIL_WIDTHS = [[1440, 900], [1280, 800], [1024, 768]];
const DRAWER_WIDTHS = [[390, 844], [360, 740]];

const close = (a, b) => (a === null || b === null) ? a === b : Math.abs(a - b) < 1e-6;
const light = () => {
  const a = V3D.atmosphere(), q = V3D.quality(), { scene } = V3D.harness();
  return { preset: a.preset, cloudCoverage: a.cloudCoverage, cloudDensity: a.cloudDensity,
    cloudShadow: { cover: a.cloudShadow.cover, opacity: a.cloudShadow.opacity }, bloom: q.bloom, bloomThreshold: q.bloomThreshold,
    fogDensity: scene.fog.density, ljus: new URLSearchParams(location.search).get('ljus'),
    railOn: [...document.querySelectorAll('#rail .btn[data-preset]')].filter(b => b.classList.contains('on')).map(b => b.dataset.preset),
    drawerActive: [...document.querySelectorAll('.d-btn[data-preset]')].filter(b => b.classList.contains('active')).map(b => b.dataset.preset) };
};
const matches = (got, want, ljus) => ({
  preset: got.preset === want.preset,
  sky: close(got.cloudCoverage, want.cloudCoverage) && close(got.cloudDensity, want.cloudDensity),
  cloudShadow: close(got.cloudShadow.cover, want.cloudShadow.cover) && close(got.cloudShadow.opacity, want.cloudShadow.opacity),
  glow: close(got.bloom, want.bloom) && close(got.bloomThreshold, want.bloomThreshold),
  haze: Math.abs(got.fogDensity - want.fogDensity) < 1e-9,
  link: got.ljus === ljus,
  buttons: got.railOn.length === 1 && got.railOn[0] === want.preset && got.drawerActive.length === 1 && got.drawerActive[0] === want.preset,
});
/* every light button's name inside its button */
const measure = sel => [...document.querySelectorAll(sel)].map(b => ({ preset: b.dataset.preset, text: b.textContent.trim(),
  width: +b.getBoundingClientRect().width.toFixed(1), overflow: b.scrollWidth > b.clientWidth, top: Math.round(b.getBoundingClientRect().top) }));
const rowsOf = buttons => [...new Set(buttons.map(b => b.top))].map(top => buttons.filter(b => b.top === top).map(b => b.text));

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [];
let failed = false, menus = null;
try {
  for (const run of RUNS) {
    const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee&det=1&ljus=${run.ljus}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const booted = await page.evaluate(light);
    const tierAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    const checks = { noErrors: true, tierAudit: tierAudit === true };
    for (const [k, v] of Object.entries(matches(booted, expected(run.light, run.q), run.ljus))) checks[k] = v;
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), checks, light: booted, expected: expected(run.light, run.q) };

    if (run.buttons) {
      /* the rail's Sommar button (a programmatic click: the rail is a hidden sheet at this width), then the drawer's Dag */
      await page.evaluate(() => document.querySelector('#rail .btn[data-preset="summer"]').click());
      const f2 = await page.evaluate(() => V3D.frame());
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f2, { timeout: 600000, polling: 500 });
      const summer = await page.evaluate(light);
      await page.evaluate(() => document.querySelector('.d-btn[data-preset="noon"]').click());
      const f3 = await page.evaluate(() => V3D.frame());
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f3, { timeout: 600000, polling: 500 });
      const noon = await page.evaluate(light);
      checks.railButton = Object.values(matches(summer, expected('summer', run.q), 'sommar')).every(Boolean);
      checks.drawerButton = Object.values(matches(noon, expected('noon', run.q), 'dag')).every(Boolean);
      /* noon's clouds and their shadows come back as they booted */
      checks.noonAsBooted = JSON.stringify({ ...noon, ljus: null }) === JSON.stringify({ ...booted, ljus: null });
      row.switched = { summer, noon };

      /* the menus, the page's own markup: the scene stops drawing while they are measured and shot (a
         full course takes software rendering longer than a screenshot waits for a frame at desktop sizes) */
      await page.evaluate(() => V3D.harness().renderer.setAnimationLoop(null));
      menus = { rail: [], drawer: [] };
      const shots = [];
      for (const [width, height] of RAIL_WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(400);
        await page.evaluate(() => document.fonts.ready);
        const buttons = await page.evaluate(`(${measure})('#rail .btn[data-preset]')`);
        menus.rail.push({ viewport: [width, height], rows: rowsOf(buttons), overflowing: buttons.filter(b => b.overflow).map(b => b.text),
          widths: Object.fromEntries(buttons.map(b => [b.text, b.width])) });
        if (width === 1440) {
          const clip = await page.evaluate(() => {
            const rail = document.querySelector('#rail').getBoundingClientRect();
            const label = [...document.querySelectorAll('#rail .lbl')].find(l => /Ljus/.test(l.textContent)).getBoundingClientRect();
            const last = document.querySelector('#rail .btn[data-preset="host"]').getBoundingClientRect();
            return { x: rail.x, y: label.y - 6, width: rail.width, height: last.bottom - label.y + 12 };
          });
          shots.push({ label: 'Rail, 1440 px', png: (await page.screenshot({ clip })).toString('base64') });
        }
      }
      for (const [width, height] of DRAWER_WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => { if (!window.__navDrawer.isOpen()) window.__navDrawer.open(); });
        await page.waitForTimeout(700);
        const buttons = await page.evaluate(`(${measure})('.d-btn[data-preset]')`);
        const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.d-btn[data-preset]').parentElement).gridTemplateColumns.split(' ').length);
        const open = await page.evaluate(() => window.__navDrawer.isOpen());
        menus.drawer.push({ viewport: [width, height], open, columns, rows: rowsOf(buttons), overflowing: buttons.filter(b => b.overflow).map(b => b.text),
          widths: Object.fromEntries(buttons.map(b => [b.text, b.width])) });
        if (width === 390) {
          /* the light section, scrolled into the drawer's view */
          const section = page.locator('.drawer-section').filter({ has: page.locator('.d-btn[data-preset]') });
          await section.scrollIntoViewIfNeeded();
          shots.push({ label: 'Drawer, 390 px', png: (await section.screenshot()).toString('base64') });
        }
      }
      checks.railFits = menus.rail.every(m => m.overflowing.length === 0 && m.rows[0].includes('Sommar'));
      checks.drawerFits = menus.drawer.every(m => m.open && m.overflowing.length === 0 && m.columns === 3 && m.rows.every(r => r.length === 3));
      /* one picture of both, side by side on the menus' own dark */
      const jpg = await page.evaluate(async shots => {
        const images = await Promise.all(shots.map(async s => { const im = new Image(); im.src = `data:image/png;base64,${s.png}`; await im.decode(); return im; }));
        const pad = 12, top = 22, c = document.createElement('canvas');
        c.width = images.reduce((w, im) => w + im.width + pad, pad);
        c.height = Math.max(...images.map(im => im.height)) + top + pad;
        const g = c.getContext('2d');
        g.fillStyle = '#07100c'; g.fillRect(0, 0, c.width, c.height);
        let x = pad;
        images.forEach((im, i) => {
          g.drawImage(im, x, top);
          g.font = '12px sans-serif'; g.fillStyle = '#cfe3d6'; g.fillText(shots[i].label, x, 15);
          x += im.width + pad;
        });
        return c.toDataURL('image/jpeg', 0.92).split(',')[1];
      }, shots);
      fs.writeFileSync(`${dir}/menus.jpg`, Buffer.from(jpg, 'base64'));
    }
    await browser.close();
    checks.noErrors = errors.length === 0;
    row.seconds = Math.round((Date.now() - started) / 1000);
    row.errors = errors;
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, light: booted }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows, menus }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
