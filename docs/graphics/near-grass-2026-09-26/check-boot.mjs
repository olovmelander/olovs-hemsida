// Boots the built app with the grass round the ball and with its before on
// WebGL2, compiles every material in the scene and reads back what the grass was
// built with and what it is doing (V3D.nearGrass()): whether it is drawn in the
// tee view (1.7 m over the ground, six metres behind the tee) and hidden in the
// view from above, its instances for the quality, the ground grid round the eye
// filled at boot and how long that took, the scene's one grass mesh, whether
// every prepared startup path replayed (the ground tint, the vista, the
// scatter's sections and the water), and every page or console error. States,
// not pictures (full courses render black in software rendering).
//  - Ängsö in golden hour, the tee view, at high and low quality: the grass,
//    from prepared startup data;
//  - Ängsö from above: built, and hidden (the eye far over the ground);
//  - Ängsö with ?neargrass=0: no grass, still from prepared startup data;
//  - Johannesberg and Upsala, the tee view: other grounds, other fields;
//  - Visby: measured vegetation only, which grows nothing it did not measure --
//    no grass; its water on the runtime path.
// Run from the repository root after the build and the re-bake (BANVY_RUNS=<pattern> runs the
// boots whose names match): node docs/graphics/near-grass-2026-09-26/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { nearGrassLayout } from '../../../apps/golf/src/engine/near-grass.mjs';

const dir = 'docs/graphics/near-grass-2026-09-26';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8732;
/* the sections a course's prepared scatter carries: a course without a lake has no reeds section, one that plants nothing none */
const catalogue = JSON.parse(fs.readFileSync('apps/golf/public/courses/index.json'));
const scatterSections = (slug, quality) => {
  const ref = catalogue.courses.find(c => c.slug === slug)?.preparedScatter?.[`scatter-${quality}`];
  return !ref || ref.none ? [] : Object.keys(ref.sections).filter(name => ref.sections[name] !== null).sort();
};

const ALL_RUNS = [
  { name: 'Ängsö, Kväll, the tee view, high quality', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee', grass: 'drawn' },
  { name: 'Ängsö, Kväll, the tee view, low quality', course: 'angso', q: 'lo', query: 'ljus=kvall&vy=tee', grass: 'drawn' },
  { name: 'Ängsö, Dag, from above', course: 'angso', q: 'hi', query: 'ljus=dag&vy=ovan', grass: 'hidden' },
  { name: 'Ängsö, Kväll, the tee view, ?neargrass=0', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee&neargrass=0', grass: 'off' },
  { name: 'Johannesberg, Dag, the tee view', course: 'johannesberg', q: 'hi', query: 'ljus=dag&vy=tee', grass: 'drawn' },
  { name: 'Upsala, Kväll, the tee view', course: 'upsala', q: 'hi', query: 'ljus=kvall&vy=tee', grass: 'drawn' },
  { name: 'Visby, Kväll, the tee view', course: 'visby', q: 'hi', query: 'ljus=kvall&vy=tee', grass: 'measured', runtimeWater: true },
];
const RUNS = ALL_RUNS.filter(run => !process.env.BANVY_RUNS || new RegExp(process.env.BANVY_RUNS).test(run.name));

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
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&det=1&${run.query}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const got = await page.evaluate(() => {
      const { scene, camera } = V3D.harness();
      let meshes = 0;
      scene.traverse(o => { if (o.name === 'near-grass') meshes++; });
      const perf = V3D.perf();
      return { grass: V3D.nearGrass(), meshes, settled: V3D.settled(), eye: camera.position.toArray().map(v => +v.toFixed(2)),
        prepared: { tint: perf.preparedTint, vista: perf.preparedVista, water: perf.preparedWater, scatter: perf.preparedScatter },
        tierAudit: V3D.treeTierAudit().ok };
    });
    await browser.close();
    const g = got.grass || {};
    const sections = scatterSections(run.course, run.q), replayed = Object.keys(got.prepared.scatter || {}).sort();
    const layout = nearGrassLayout(run.q);
    const built = run.grass === 'drawn' || run.grass === 'hidden';
    const checks = {
      noErrors: errors.length === 0, tierAudit: got.tierAudit === true, settled: got.settled === true,
      /* the grass as the run expects it: built for its quality with the exact fields, one mesh, drawn low and hidden high */
      grass: built
        ? g.on === true && g.exactEdges === true && got.meshes === 1 && g.quality === run.q && g.instances === layout.instances
          && g.blades === layout.bladesTotal && g.visible === (run.grass === 'drawn') && g.clip?.pending === 0
          && (run.grass === 'drawn' ? g.altitude > 0.5 && g.altitude < 3 : g.altitude > 40)
        : got.meshes === 0 && g.instances === undefined && (run.grass === 'off' ? g.on === false : g.on === true && g.policy === 'measured-only'),
      /* every prepared startup path replayed, the before too: each section the course's scatter carries */
      prepared: got.prepared.tint === true && got.prepared.vista === true && (run.runtimeWater ? got.prepared.water !== true : got.prepared.water === true)
        && JSON.stringify(replayed) === JSON.stringify(sections) && replayed.every(name => got.prepared.scatter[name] === true),
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, got, expected: { grass: run.grass, scatterSections: sections }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, grass: { on: g.on, visible: g.visible, instances: g.instances, altitude: g.altitude, primeMs: g.primeMs,
      reads: g.clip?.reads, lastMs: g.clip?.lastMs }, prepared: got.prepared }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
