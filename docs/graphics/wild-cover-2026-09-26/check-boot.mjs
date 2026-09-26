// Boots the built app with the wild cover and with its befores on WebGL2, compiles
// every material in the scene and reads back what grew (V3D.wildCover()):
//  - the near trees the forest floor was planted under, its candidates, scrub and
//    ferns, and the flowers' clumps;
//  - each kind's tiles, how many the eye's reach leaves in, and the scene's wild
//    cover meshes; the tiles, plants and vertices the view draws; a tile of each
//    kind compiled with the opening view;
//  - how long planting and building them took at boot (the 'wild cover (forest
//    floor, flowers)' span), beside the ground cover's own span for scale;
//  - whether every prepared startup path replayed (the ground tint, the vista, the
//    scatter's sections and the water), and every page or console error.
// States, not pictures (full courses render black in software rendering). The boots:
//  - Ängsö in golden hour, the tee view, at high and low quality: the wild cover,
//    from prepared startup data, the low quality's floor half the high's under
//    each tree;
//  - Ängsö with ?forestfloor=0&wildflowers=0: nothing grown, still from prepared data;
//  - Ängsö with ?forestfloor=0, and with ?wildflowers=0: each before alone;
//  - Johannesberg and Upsala, the tee view: other grounds, other woods;
//  - Visby: measured vegetation only, which grows nothing it did not measure --
//    no wild cover; its water on the runtime path.
// Run from the repository root after the build and the re-bake (BANVY_RUNS=<pattern> runs the
// boots whose names match): node docs/graphics/wild-cover-2026-09-26/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { WILD_COVER } from '../../../apps/golf/src/engine/wild-cover.mjs';

const dir = 'docs/graphics/wild-cover-2026-09-26';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8733;
const SPAN = 'wild cover (forest floor, flowers)';
/* the sections a course's prepared scatter carries: a course without a lake has no reeds section, one that plants nothing none */
const catalogue = JSON.parse(fs.readFileSync('apps/golf/public/courses/index.json'));
const scatterSections = (slug, quality) => {
  const ref = catalogue.courses.find(c => c.slug === slug)?.preparedScatter?.[`scatter-${quality}`];
  return !ref || ref.none ? [] : Object.keys(ref.sections).filter(name => ref.sections[name] !== null).sort();
};

/* floor / flowers: what the run expects of each ('grown', 'off', or 'measured': nothing invented) */
const ALL_RUNS = [
  { name: 'Ängsö, Kväll, the tee view, high quality', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee', floor: 'grown', flowers: 'grown' },
  { name: 'Ängsö, Kväll, the tee view, low quality', course: 'angso', q: 'lo', query: 'ljus=kvall&vy=tee', floor: 'grown', flowers: 'grown' },
  { name: 'Ängsö, Kväll, the tee view, ?forestfloor=0&wildflowers=0', course: 'angso', q: 'hi', query: 'ljus=kvall&vy=tee&forestfloor=0&wildflowers=0', floor: 'off', flowers: 'off' },
  { name: 'Ängsö, Dag, the tee view, ?forestfloor=0', course: 'angso', q: 'hi', query: 'ljus=dag&vy=tee&forestfloor=0', floor: 'off', flowers: 'grown' },
  { name: 'Ängsö, Dag, the tee view, ?wildflowers=0', course: 'angso', q: 'hi', query: 'ljus=dag&vy=tee&wildflowers=0', floor: 'grown', flowers: 'off' },
  { name: 'Johannesberg, Dag, the tee view', course: 'johannesberg', q: 'hi', query: 'ljus=dag&vy=tee', floor: 'grown', flowers: 'grown' },
  { name: 'Upsala, Kväll, the tee view', course: 'upsala', q: 'hi', query: 'ljus=kvall&vy=tee', floor: 'grown', flowers: 'grown' },
  { name: 'Visby, Kväll, the tee view', course: 'visby', q: 'hi', query: 'ljus=kvall&vy=tee', floor: 'measured', flowers: 'measured', runtimeWater: true },
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
    const got = await page.evaluate(SPAN => {
      const { scene, camera, renderer } = V3D.harness();
      /* each kind's tiles in the scene, their plants, and how near the eye the nearest comes (its sphere's edge) */
      const KIND = { 'forest-floor-scrub': 'scrub', 'forest-floor-ferns': 'fern', 'wild-flowers': 'flowers' };
      const meshes = {}, nearest = {};
      let instances = 0;
      /* what the view draws: each tile left in whose sphere meets the eye's frustum, its plants and their vertices */
      const view = { tiles: 0, plants: 0, vertices: 0 };
      camera.updateMatrixWorld();
      const tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect;
      const cosV = 1 / Math.hypot(1, tanV), sinV = tanV * cosV, cosH = 1 / Math.hypot(1, tanH), sinH = tanH * cosH;
      const inFrustum = (sphere, drawn) => {
        const p = sphere.center.clone().applyMatrix4(camera.matrixWorldInverse), r = sphere.radius;
        return drawn && -p.z + r > camera.near && -p.z - r < camera.far && p.y * cosV + p.z * sinV <= r && -p.y * cosV + p.z * sinV <= r
          && p.x * cosH + p.z * sinH <= r && -p.x * cosH + p.z * sinH <= r;
      };
      scene.traverse(o => {
        if (o.userData?.tag !== 'wild-cover') return;
        const kind = KIND[o.parent?.name] ?? o.parent?.name ?? '?';
        meshes[kind] = (meshes[kind] || 0) + 1;
        instances += o.count;
        const edge = o.boundingSphere.center.distanceTo(camera.position) - o.boundingSphere.radius;
        nearest[kind] = Math.min(nearest[kind] ?? Infinity, +edge.toFixed(1));
        if (inFrustum(o.boundingSphere, o.visible && o.parent.visible)) {
          view.tiles++; view.plants += o.count; view.vertices += o.count * o.geometry.getAttribute('position').count;
        }
      });
      const perf = V3D.perf();
      const span = perf.spans.find(s => s.name === SPAN), cover = perf.spans.find(s => s.name === 'ground cover (tufts, bushes, stones, stumps)');
      return { wild: V3D.wildCover(), meshes, nearest, instances, view, drawCalls: renderer.info.render.drawCalls, spanMs: span ? span.ms : null, coverMs: cover ? cover.ms : null, settled: V3D.settled(),
        eye: camera.position.toArray().map(v => +v.toFixed(2)),
        prepared: { tint: perf.preparedTint, vista: perf.preparedVista, water: perf.preparedWater, scatter: perf.preparedScatter },
        tierAudit: V3D.treeTierAudit().ok };
    }, SPAN);
    await browser.close();
    const w = got.wild || {};
    const sections = scatterSections(run.course, run.q), replayed = Object.keys(got.prepared.scatter || {}).sort();
    const tiles = w.tiles || {}, drawn = w.drawnTiles || {};
    /* a kind grown: its tiles all in the scene, and drawn exactly those whose nearest plant is within its fade's end */
    const REACH = { scrub: WILD_COVER.fade.scrub[1], fern: WILD_COVER.fade.fern[1], flowers: WILD_COVER.fade.flowers[1] };
    const grownKinds = ['scrub', 'fern', 'flowers'].filter(name => tiles[name] > 0).length;
    const kindOk = (name, want) => want === 'grown'
      ? tiles[name] > 0 && got.meshes[name] === tiles[name] && drawn[name] >= 0 && drawn[name] <= tiles[name]
        && (drawn[name] > 0) === (got.nearest[name] < REACH[name])
      : !(name in tiles) && !got.meshes[name];
    const checks = {
      noErrors: errors.length === 0, tierAudit: got.tierAudit === true, settled: got.settled === true,
      /* the span is always timed; nothing is built on a measured-only ground or with both befores */
      span: typeof got.spanMs === 'number',
      switches: w.forestFloor === (run.floor !== 'off') && w.flowers === (run.flowers !== 'off'),
      /* the forest floor as the run expects it: planted under the near trees, both kinds in tiles, one mesh a tile */
      floor: run.floor === 'grown'
        ? w.trees > 0 && w.candidates > 0 && w.scrub > 0 && w.ferns > 0 && w.scrub + w.ferns <= w.candidates
          && kindOk('scrub', 'grown') && kindOk('fern', 'grown')
        : w.trees === undefined && kindOk('scrub', 'none') && kindOk('fern', 'none'),
      flowers: run.flowers === 'grown'
        ? w.flowerClumps > 0 && kindOk('flowers', 'grown')
        : w.flowerClumps === undefined && kindOk('flowers', 'none'),
      /* a tile of each kind grown compiled with the opening view; nothing built where nothing grows */
      nothingElse: run.floor === 'grown' || run.flowers === 'grown' ? w.drawnTiles !== null && w.compiledAtOpening === grownKinds
        : w.drawnTiles === null && got.instances === 0 && w.compiledAtOpening === undefined,
      /* every prepared startup path replayed, the befores too: each section the course's scatter carries */
      prepared: got.prepared.tint === true && got.prepared.vista === true && (run.runtimeWater ? got.prepared.water !== true : got.prepared.water === true)
        && JSON.stringify(replayed) === JSON.stringify(sections) && replayed.every(name => got.prepared.scatter[name] === true),
    };
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, got, expected: { floor: run.floor, flowers: run.flowers, scatterSections: sections }, errors };
    rows.push(row);
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, wild: w, meshes: got.meshes, nearest: got.nearest, instances: got.instances, view: got.view, drawCalls: got.drawCalls, spanMs: got.spanMs, coverMs: got.coverMs, prepared: got.prepared }));
  }
} finally {
  server.kill();
}
/* the low quality's floor stands at half the high's candidates under each of its trees (it has fewer trees) */
const hi = rows.find(r => r.name === ALL_RUNS[0].name), lo = rows.find(r => r.name === ALL_RUNS[1].name);
const perTree = w => w.candidates / w.trees;
const halves = hi && lo ? { hi: { trees: hi.got.wild.trees, candidates: hi.got.wild.candidates }, lo: { trees: lo.got.wild.trees, candidates: lo.got.wild.candidates },
  ratio: +(perTree(lo.got.wild) / perTree(hi.got.wild)).toFixed(3) } : null;
if (halves && !(halves.ratio > 0.45 && halves.ratio < 0.55)) failed = true;
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', lowQualityFloor: halves, rows }, null, 1) + '\n');
console.log(JSON.stringify({ lowQualityFloor: halves }));
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
