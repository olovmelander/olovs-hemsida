// Turns the camera a few degrees either way at a tee in the built app, and
// records which trees the tiers keep: the change keeps the out-of-view cells
// whose shadows reach the view (as impostors); ?offscreenshadow=0 drops them.
// Counts, not pictures: full courses render black in software rendering.
// Run from the repository root after a build:
//   node docs/graphics/tree-shadows-offscreen-2026-09-24/check-turning.mjs
// SwiftShader by default, BANVY_GPU=1 for the real adapter (tools/browser-args.mjs).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/tree-shadows-offscreen-2026-09-24';
const out = process.argv[2] || `${dir}/turning-counts.json`;
const port = 8671;
/* the owner's report was a phone at Ängsö's first tee: low quality, portrait */
const RUNS = [
  { course: 'angso', q: 'hi', viewport: { width: 960, height: 600 } },
  { course: 'angso', q: 'lo', viewport: { width: 412, height: 915 } },
  { course: 'puttom', q: 'hi', viewport: { width: 960, height: 600 } },
];
const YAWS = [0, 6, 12, 24, -6, -12, -24];

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const rows = [];
try {
  for (const run of RUNS) for (const variant of ['', 'offscreenshadow=0']) {
    const page = await browser.newPage({ viewport: run.viewport, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    /* golden hour: a low sun, so shadows fall long across the view */
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&det=1&hal=1&vy=tee&ljus=kvall${variant ? '&' + variant : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 600000, polling: 1000 });
    /* terrain loaded, no fade running, and three more frames */
    const settle = async () => {
      const f = await page.evaluate(() => V3D.frame());
      await page.waitForFunction(f0 => V3D.frame() >= f0 + 3 && V3D.settled() && !V3D.treeTiers().fading
        && (V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0, f, { timeout: 600000, polling: 500 });
    };
    await settle();
    const base = await page.evaluate(() => { const { camera, controls } = V3D.harness(); return { p: camera.position.toArray(), t: controls.target.toArray() }; });
    for (const yawDeg of YAWS) {
      /* turn in place: the camera stays, its target swings about it */
      await page.evaluate(({ base, yawDeg }) => {
        const { camera, controls } = V3D.harness();
        const a = yawDeg * Math.PI / 180, [px, py, pz] = base.p, [tx, ty, tz] = base.t;
        const dx = tx - px, dz = tz - pz;
        camera.position.set(px, py, pz);
        controls.target.set(px + dx * Math.cos(a) - dz * Math.sin(a), ty, pz + dx * Math.sin(a) + dz * Math.cos(a));
        controls.update();
      }, { base, yawDeg });
      await settle();
      const row = await page.evaluate(() => {
        const t = V3D.treeTiers(), s = V3D.shadowFit();
        return { hero: t.tier0, impostors: t.tier3, cellsVisible: t.cellsVisible, shadowCells: t.shadowCells ?? null,
          updateMs: +t.updateMs.toFixed(3), fit: s.R, audit: V3D.treeTierAudit().ok };
      });
      rows.push({ course: run.course, q: run.q, viewport: `${run.viewport.width}x${run.viewport.height}`,
        variant: variant || 'default', yawDeg, ...row, errors: errors.length });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
    await page.close();
  }
} finally {
  await browser.close(); server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', backend: 'webgl2', lighting: 'kvall', yaws: YAWS, rows }, null, 1) + '\n');
console.log(`turning counts: ${rows.length} rows -> ${out}`);
