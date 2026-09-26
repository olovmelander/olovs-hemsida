// Boots the built app with the turf batch and with its befores on WebGL2,
// compiles every material in the scene and reads back what the ground material
// was built with (V3D.v2Terrain().groundDetail), how many times its drawn graph
// reads the detail texture (its distinct reads of the 512-texel repeating
// detail texture, walked in the page), whether every prepared startup path
// replayed (the ground tint, the vista, the scatter's sections and the water),
// and every page or console error. States, not pictures (full courses render
// black in software rendering).
//  - Ängsö in golden hour at high and low quality: the batch, from prepared
//    startup data;
//  - Ängsö with every before (?turfgrain=0&groundwear=0&bareground=0): main's
//    ground, seven reads, still from prepared startup data;
//  - Ängsö in the storm and the mist, where the damp lies;
//  - Johannesberg, whose reviewed ground maps its rock, and Upsala (ponds and
//    no lake: its scatter carries no reeds section);
//  - Visby: measured vegetation only, its water on the runtime path.
// A course's bare ground is drawn where its exact fields carry rock, soil or mud.
// Run from the repository root after the build and the re-bake (BANVY_RUNS=<pattern> runs the
// boots whose names match): node docs/graphics/turf-2026-09-26/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { SURFACE } from '../../../apps/golf/src/engine/surface.js';

const dir = 'docs/graphics/turf-2026-09-26';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8731;
const BEFORES = 'turfgrain=0&groundwear=0&bareground=0';
const BARE = [SURFACE.ROCK, SURFACE.DIRT, SURFACE.MUD];
/* the sections a course's prepared scatter carries: a course without a lake has no reeds section, one that plants nothing none */
const catalogue = JSON.parse(fs.readFileSync('apps/golf/public/courses/index.json'));
const scatterSections = (slug, quality) => {
  const ref = catalogue.courses.find(c => c.slug === slug)?.preparedScatter?.[`scatter-${quality}`];
  return !ref || ref.none ? [] : Object.keys(ref.sections).filter(name => ref.sections[name] !== null).sort();
};

const ALL_RUNS = [
  { name: 'Ängsö, Kväll, high quality', course: 'angso', q: 'hi', query: 'ljus=kvall' },
  { name: 'Ängsö, Kväll, low quality', course: 'angso', q: 'lo', query: 'ljus=kvall' },
  { name: 'Ängsö, Kväll, every before', course: 'angso', q: 'hi', query: `ljus=kvall&${BEFORES}`, off: true },
  { name: 'Ängsö, Oväder', course: 'angso', q: 'hi', query: 'ljus=ovader' },
  { name: 'Ängsö, Dis', course: 'angso', q: 'hi', query: 'ljus=dis' },
  { name: 'Johannesberg, Dag', course: 'johannesberg', q: 'hi', query: 'ljus=dag' },
  { name: 'Upsala, Kväll', course: 'upsala', q: 'hi', query: 'ljus=kvall' },
  { name: 'Visby, Kväll', course: 'visby', q: 'hi', query: 'ljus=kvall', runtimeWater: true },
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
    const got = await page.evaluate(() => {
      const terrain = V3D.v2Terrain();
      /* the ground material's distinct reads of the detail texture: the one repeating 512-texel data texture it samples */
      const { scene } = V3D.harness();
      let material = null;
      scene.traverse(o => { if (!material && o.material?.userData?.groundDetail) material = o.material; });
      const seen = new Set(), reads = new Set();
      const walk = node => {
        if (!node || typeof node !== 'object' || !node.isNode || seen.has(node.id)) return;
        seen.add(node.id);
        const t = node.isTextureNode ? node.value : null;
        if (t?.isDataTexture && t.image?.width === 512 && t.image?.height === 512 && t.wrapS === 1000) reads.add(node.id);
        for (const child of node.getChildren()) walk(child);
      };
      if (material) { walk(material.colorNode); walk(material.roughnessNode); }
      const perf = V3D.perf();
      return { surfaceEdges: terrain.surfaceEdges, channels: terrain.exactEdges?.channels ?? null, groundEdges: terrain.groundEdges,
        groundDetail: terrain.groundDetail, detailReads: reads.size, graphNodes: seen.size,
        prepared: { tint: perf.preparedTint, vista: perf.preparedVista, water: perf.preparedWater, scatter: perf.preparedScatter },
        tierAudit: V3D.treeTierAudit().ok };
    });
    await browser.close();
    const on = !run.off;
    const bare = on && (got.channels || []).some(sid => BARE.includes(sid));
    const sections = scatterSections(run.course, run.q), replayed = Object.keys(got.prepared.scatter || {}).sort();
    const checks = {
      noErrors: errors.length === 0, tierAudit: got.tierAudit === true,
      /* the exact-edge ground material, built with the batch where it is on, and the ground batch's fixes as before */
      groundDetail: got.surfaceEdges === 'exact' && JSON.stringify(got.groundDetail) === JSON.stringify({ turfGrain: on, groundWear: on, bareGround: bare }),
      groundEdges: JSON.stringify(got.groundEdges) === JSON.stringify({ across: true, stripeReach: true, hardGround: true }),
      detailReads: got.detailReads === (on ? 4 : 7),
      /* every prepared startup path replayed, befores and all: each section the course's scatter carries */
      prepared: got.prepared.tint === true && got.prepared.vista === true && (run.runtimeWater ? got.prepared.water !== true : got.prepared.water === true)
        && JSON.stringify(replayed) === JSON.stringify(sections) && replayed.every(name => got.prepared.scatter[name] === true),
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, got, expected: { scatterSections: sections }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, groundDetail: got.groundDetail, reads: got.detailReads, prepared: got.prepared }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
