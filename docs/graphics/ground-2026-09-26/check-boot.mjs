// Boots the built app with the ground batch and with its befores on WebGL2,
// compiles every material in the scene and reads back what the ground material
// was built with (V3D.v2Terrain().groundEdges), what the ground cover draws
// (V3D.cover(): per population its shadows, blade normal and seat, and the
// stones' colour), how many reeds stand, whether the prepared scatter replayed
// (V3D.perf().preparedScatter), and every page or console error. States, not
// pictures (full courses render black in software rendering).
//  - Ängsö in golden hour at high and low quality: the batch everywhere, from
//    prepared startup data; its reeds the re-baked scatter's, bit for bit;
//  - Ängsö with every drawn before (?groundedges=0 ... ?coverseat=0): main's
//    ground and cover, still from prepared startup data;
//  - Ängsö with ?reedlakes=0: planted live, and exactly main's reeds (the
//    baseline's prepared scatter, from git); with ?prepscatter=0, the batch's
//    reeds planted live, exactly the re-baked scatter's, and each loop's time;
//  - Ängsö with ?surfaceRelief=1: prepared startup data kept;
//  - Johannesberg: its stones in its reviewed rock colour;
//  - Puttom (four lakes at four heights) and Veckefjärden (the reed bed): their
//    reeds the re-baked scatter's;
//  - Visby: no ground cover (measured vegetation only), the ground's edges drawn.
// Run from the repository root after the build and the re-bake (BANVY_RUNS=<pattern> runs the
// boots whose names match): node docs/graphics/ground-2026-09-26/check-boot.mjs
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { PAINTED_SCENERY } from '../../../apps/golf/src/engine/painted-world-palette.mjs';
import { groundAppearance } from '../../../apps/golf/src/engine/scenery/johannesberg-ground-surfaces.mjs';

const dir = 'docs/graphics/ground-2026-09-26';
const out = process.argv[2] || `${dir}/boot-check.json`;
const baseline = '4170051d';
const port = 8729;
const root = 'apps/golf/public/';
const BEFORES = 'groundedges=0&stripereach=0&hardground=0&coverlight=0&covershadow=0&covercolour=0&coverseat=0';

/* how many reeds a prepared scatter plants: the set bits of its reeds section */
const catalogue = { now: JSON.parse(fs.readFileSync(`${root}courses/index.json`)),
  main: JSON.parse(execFileSync('git', ['show', `${baseline}:${root}courses/index.json`], { encoding: 'utf8', maxBuffer: 64 << 20 })) };
const reedsIn = (which, slug, quality) => {
  const ref = catalogue[which].courses.find(c => c.slug === slug)?.preparedScatter?.[`scatter-${quality}`];
  if (!ref) return null;
  const bytes = which === 'now' ? fs.readFileSync(root + ref.url) : execFileSync('git', ['show', `${baseline}:${root}${ref.url}`], { maxBuffer: 64 << 20 });
  const payload = inflateRawSync(bytes), s = ref.sections.reeds;
  let n = 0;
  for (const b of payload.subarray(s.offset, s.offset + ((s.candidates + 7) >> 3))) { let v = b; while (v) { n += v & 1; v >>= 1; } }
  return n;
};

const ALL_RUNS = [
  { name: 'Ängsö, Kväll, high quality', course: 'angso', q: 'hi', query: 'ljus=kvall', prepared: true, reeds: 'now' },
  { name: 'Ängsö, Kväll, low quality', course: 'angso', q: 'lo', query: 'ljus=kvall', prepared: true, reeds: 'now' },
  { name: 'Ängsö, Kväll, every drawn before', course: 'angso', q: 'hi', query: `ljus=kvall&${BEFORES}`, prepared: true, reeds: 'now', off: true },
  { name: 'Ängsö, Kväll, ?reedlakes=0', course: 'angso', q: 'hi', query: 'ljus=kvall&reedlakes=0', prepared: false, reeds: 'main' },
  { name: 'Ängsö, Kväll, ?prepscatter=0', course: 'angso', q: 'hi', query: 'ljus=kvall&prepscatter=0', prepared: false, reeds: 'now' },
  { name: 'Ängsö, Dag, ?surfaceRelief=1', course: 'angso', q: 'hi', query: 'ljus=dag&surfaceRelief=1', prepared: true, reeds: 'now' },
  { name: 'Johannesberg, Kväll', course: 'johannesberg', q: 'hi', query: 'ljus=kvall', prepared: true, reeds: 'now', stone: groundAppearance.palette.rock },
  { name: 'Puttom, Dag', course: 'puttom', q: 'hi', query: 'ljus=dag', prepared: true, reeds: 'now' },
  { name: 'Veckefjärden, Kväll', course: 'veckefjarden', q: 'hi', query: 'ljus=kvall', prepared: true, reeds: 'now' },
  { name: 'Visby, Kväll', course: 'visby', q: 'hi', query: 'ljus=kvall', prepared: true, noCover: true },
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
    const got = await page.evaluate(() => ({ surfaceEdges: V3D.v2Terrain().surfaceEdges, groundEdges: V3D.v2Terrain().groundEdges, cover: V3D.cover(), reeds: V3D.stats.reeds,
      preparedScatter: V3D.perf().preparedScatter, tierAudit: V3D.treeTierAudit().ok,
      reedLatticeMs: V3D.perf().spans.find(s => s.name === 'reed lattice')?.ms ?? null }));
    await browser.close();
    const on = !run.off, pops = got.cover.populations;
    const expectedReeds = run.reeds ? reedsIn(run.reeds, run.course, run.q) : null;
    const scatterUsed = Object.values(got.preparedScatter || {}).filter(v => v === true).length;
    const checks = {
      noErrors: errors.length === 0, tierAudit: got.tierAudit === true,
      /* the exact-edge ground material, where the course draws its cut lines from exact fields */
      groundEdges: got.surfaceEdges === 'exact' && JSON.stringify(got.groundEdges) === JSON.stringify({ across: on, stripeReach: on, hardGround: on }),
      switches: ['light', 'shadow', 'colour', 'seat'].every(k => got.cover[k] === on) && got.cover.reedLakes === !/reedlakes=0/.test(run.query),
      cover: run.noCover ? Object.keys(pops).length === 0
        : ['tufts', 'edgeTufts', 'bushes', 'stones'].every(k => pops[k]?.count > 0 && pops[k].receiveShadow === on)
          && ['tufts', 'edgeTufts', 'reeds'].filter(k => pops[k]).every(k => pops[k].bladeNormal === on)
          && ['bushes', 'stones'].every(k => (pops[k].seat.lowered > 0) === on && pops[k].seat.lowered <= pops[k].count),
      stones: run.noCover || got.cover.stoneColour === (on && run.stone !== undefined ? run.stone : PAINTED_SCENERY.stone),
      /* the prepared scatter replayed where it should, and was left alone where the planting moves */
      prepared: run.noCover ? true : run.prepared ? scatterUsed === 3 : scatterUsed === 0,
      reeds: expectedReeds === null || got.reeds === expectedReeds,
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, got, expected: { reeds: expectedReeds, reedsFrom: run.reeds ?? null }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, reeds: [got.reeds, expectedReeds], prepared: got.preparedScatter }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', baseline, rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
