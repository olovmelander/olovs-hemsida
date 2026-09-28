// Boots the built app on WebGL2 with the crowns' cut through the MSAA samples and
// with its before, compiles every material in the scene and reads back how each
// drawn tree crown is cut (its material's alpha to coverage, blend and alpha test),
// whether every prepared startup path replayed (the ground tint, the vista, the
// scatter's sections and the water), the tree tier audit, and every page or
// console error. States, not pictures.
//  - Ängsö in golden hour, the tee view, at high and low quality (Hero and Full crowns);
//  - Ängsö with ?crowncoverage=0: the hard cut, still from prepared startup data;
//  - Puttom's 12th, from the orbit: a forested course across a lake;
//  - Visby: measured vegetation, its water on the runtime path.
// Run from the repository root after the build and the re-bake (BANVY_RUNS=<pattern> runs the
// boots whose names match): node docs/graphics/tree-sparkle-2026-09-28/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';

const dir = 'docs/graphics/tree-sparkle-2026-09-28';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8733;
/* the sections a course's prepared scatter carries: a course without a lake has no reeds section, one that plants nothing none */
const catalogue = JSON.parse(fs.readFileSync('apps/golf/public/courses/index.json'));
const scatterSections = (slug, quality) => {
  const ref = catalogue.courses.find(c => c.slug === slug)?.preparedScatter?.[`scatter-${quality}`];
  return !ref || ref.none ? [] : Object.keys(ref.sections).filter(name => ref.sections[name] !== null).sort();
};

const ALL_RUNS = [
  { name: 'Ängsö, Kväll, the tee view, high quality', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee', coverage: true },
  { name: 'Ängsö, Kväll, the tee view, low quality', course: 'angso', q: 'lo', query: 'ljus=kvall&vy=tee', coverage: true },
  { name: 'Ängsö, Kväll, the tee view, ?crowncoverage=0', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee&crowncoverage=0', coverage: false },
  { name: 'Puttom, Kväll, the 12th from the orbit', course: 'puttom', q: 'hi', query: 'ljus=kvall&vy=fritt&hal=12', coverage: true },
  { name: 'Visby, Kväll, the tee view', course: 'visby', q: 'hi', query: 'ljus=kvall&vy=tee', coverage: true, runtimeWater: true },
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
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&det=1&${run.query.includes('hal=') ? '' : 'hal=1&'}${run.query}`;
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
      const { scene } = V3D.harness();
      /* each drawn tier's crown material (trees-<template>-crown-<tier>), and the impostors' */
      const crowns = new Map(), impostors = new Map();
      scene.traverse(o => {
        if (/^trees-.*-crown-/.test(o.name)) crowns.set(o.material, o.name);
        if (/^trees-.*-impostor-/.test(o.name)) impostors.set(o.material, o.name);
      });
      const cutOf = m => ({ coverage: m.alphaToCoverage === true, blending: m.blending, alphaTest: m.alphaTest,
        centred: m.alphaTestNode?.isNode === true, shadowCut: m.maskShadowNode?.isNode === true });
      const perf = V3D.perf();
      return { crowns: [...crowns.keys()].map(cutOf), crownMeshes: [...crowns.values()].length,
        impostors: [...impostors.keys()].map(m => m.alphaToCoverage === true),
        settled: V3D.settled(), tierAudit: V3D.treeTierAudit().ok,
        prepared: { tint: perf.preparedTint, vista: perf.preparedVista, water: perf.preparedWater, scatter: perf.preparedScatter } };
    });
    await browser.close();
    const sections = scatterSections(run.course, run.q), replayed = Object.keys(got.prepared.scatter || {}).sort();
    const checks = {
      noErrors: errors.length === 0, tierAudit: got.tierAudit === true, settled: got.settled === true,
      /* every crown cut as the run expects: through the samples, centred, the shadow keeping its own cut; or the hard cut */
      crowns: got.crowns.length > 0 && got.crowns.every(c => c.alphaTest === 0.5 && c.shadowCut
        && (run.coverage ? c.coverage && c.centred && c.blending === 5 : !c.coverage && !c.centred && c.blending === 1)),
      /* the impostors were cut through the samples before, and still are */
      impostors: got.impostors.length > 0 && got.impostors.every(Boolean),
      /* every prepared startup path replayed, the before too: each section the course's scatter carries */
      prepared: got.prepared.tint === true && got.prepared.vista === true && (run.runtimeWater ? got.prepared.water !== true : got.prepared.water === true)
        && JSON.stringify(replayed) === JSON.stringify(sections) && replayed.every(name => got.prepared.scatter[name] === true),
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, got: { ...got, crowns: got.crowns.length, crownCuts: [...new Set(got.crowns.map(c => JSON.stringify(c)))].map(s => JSON.parse(s)) },
      expected: { coverage: run.coverage, scatterSections: sections }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, crowns: row.got.crowns, crownCuts: row.got.crownCuts, prepared: got.prepared }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
