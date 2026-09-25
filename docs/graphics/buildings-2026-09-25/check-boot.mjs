// Boots the built app with the buildings batch and with its befores on WebGL2,
// compiles every material in the scene and reads back what was painted: the
// models given the wall's foot (and their meshes, materials and vertices), the
// batch's stamped vertices, its triangles and roof slopes, the time the stamping
// took, and every page or console error -- a shader that fails to compile
// reports one; and how much of each building's walls stands in the foot's
// band over the course's own ground (foot-area.mjs), which is where the foot
// shows. States, not pictures (full courses render black in software
// rendering).
//  - Ängsö, high quality (det=1): its facilities and the batch;
//  - Ängsö, high quality, both befores: nothing stamped, and the batch's roofs
//    two triangles a slope fewer -- the triangles it had;
//  - Ängsö, low quality: the same models painted as at high quality (its
//    batch is its own: low quality has always drawn fewer inferred houses);
//  - Veckefjärden: its facilities, its church and its ski jump;
//  - Tortuna: its authored clubhouse and facilities;
//  - Norrfällsviken: its facilities built from measured meshes.
// Run from the repository root after a build:
//   node docs/graphics/buildings-2026-09-25/check-boot.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { BUILDING_PAINT } from '../../../apps/golf/src/engine/building-paint.mjs';
import { footArea } from './foot-area.mjs';

const dir = 'docs/graphics/buildings-2026-09-25';
const out = process.argv[2] || `${dir}/boot-check.json`;
const port = 8702;
const BEFORE = 'wallbase=0&roofridge=0';
const RUNS = [
  { name: 'Ängsö, high quality', key: 'angso', course: 'angso', q: 'hi', query: 'det=1&ljus=kvall', models: 1 },
  { name: 'Ängsö, high quality, both befores', key: 'angso-before', course: 'angso', q: 'hi', query: `det=1&ljus=kvall&${BEFORE}`, before: 'angso' },
  { name: 'Ängsö, low quality', key: 'angso-lo', course: 'angso', q: 'lo', query: 'det=1&ljus=kvall', models: 1, same: 'angso' },
  { name: 'Veckefjärden: facilities, church and ski jump', key: 'veckefjarden', course: 'veckefjarden', q: 'hi', query: 'det=1&ljus=kvall', models: 3 },
  { name: 'Tortuna: authored buildings', key: 'tortuna', course: 'tortuna', q: 'hi', query: 'det=1&ljus=kvall', models: 1 },
  { name: 'Norrfällsviken: measured facility meshes', key: 'norrfallsviken', course: 'norrfallsviken', q: 'hi', query: 'det=1&ljus=kvall', models: 1 },
];

const server = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const rows = [], byKey = {};
let failed = false;
try {
  for (const run of RUNS) {
    const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const url = `http://127.0.0.1:${port}/?bana=${run.course}&v2=require&ghibli=1&q=${run.q}&qualitylock=1&gl=1&hal=1&vy=tee&${run.query}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 900000, polling: 1000 });
    const f = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 3, f, { timeout: 600000, polling: 500 });
    /* every material compiled, in view or not: a failing shader reports an error */
    await page.evaluate(async () => { const { scene, renderer, camera } = V3D.harness(); await renderer.compileAsync(scene, camera); });
    const f1 = await page.evaluate(() => V3D.frame());
    await page.waitForFunction(f0 => V3D.frame() >= f0 + 2, f1, { timeout: 600000, polling: 500 });
    const state = await page.evaluate(() => {
      const { scene } = V3D.harness();
      /* what carries a stamped ground, as drawn */
      let meshes = 0, vertices = 0, unstampedLimits = 0;
      scene.traverse(o => {
        const g = o.isMesh && o.geometry?.getAttribute('aGround');
        if (!g) return;
        meshes++; vertices += g.count;
        for (let i = 0; i < g.count; i++) if (g.array[i] === -1e4) unstampedLimits++;
      });
      return { paint: structuredClone(V3D.stats.buildingPaint), stamped: { meshes, vertices, withoutGround: unstampedLimits },
        facilities: V3D.stats.facilities?.status ?? null, landmarks: V3D.landmarkModels()?.landmarks?.map(l => l.status) ?? null,
        authored: V3D.authoredBuildings().map(a => a.status) };
    });
    /* every model and the batch, each building's walls and their part in the band, on the course's own ground */
    const areas = await page.evaluate(([source, band]) => {
      const measure = new Function(`return ${source}`)();
      const { scene } = V3D.harness();
      const roots = [];
      for (const child of scene.children) {
        let stamped = false;
        child.traverse(o => { if (o.isMesh && o.geometry?.getAttribute('aGround')) stamped = true; });
        if (!stamped) continue;
        const batch = child.isMesh && [child.material].flat().some(m => m.vertexColors);
        const buildings = measure(child, band);
        const sum = f => Math.round(buildings.reduce((s, b) => s + b[f], 0) * 10) / 10;
        roots.push({ name: batch ? 'the batch' : child.name || child.uuid, wall: sum('wall'), foot: sum('foot'), buildings: buildings.length,
          withoutFoot: buildings.filter(b => b.wall > 5 && b.foot === 0).map(b => b.name) });
      }
      return roots;
    }, [footArea.toString(), { metres: BUILDING_PAINT.foot.model.metres, batch: BUILDING_PAINT.foot.batch.metres }]);
    const tiersAudit = await page.evaluate(() => V3D.treeTierAudit().ok);
    await browser.close();
    const p = state.paint, before = run.query.includes(BEFORE);
    const checks = { noErrors: errors.length === 0, tierAudit: tiersAudit === true,
      switches: p.wallBase === !before && p.roofRidge === !before };
    if (before) {
      /* nothing stamped, nothing painted; the roofs as they were: two triangles a slope fewer */
      const main = byKey[run.before].paint;
      checks.nothingStamped = p.models === 0 && p.modelMeshes === 0 && p.modelCopies === 0 && p.batchVertices === 0 && state.stamped.meshes === 0;
      checks.roofsAsBefore = p.roofSlopes === main.roofSlopes && main.batchTriangles - p.batchTriangles === 2 * p.roofSlopes;
    } else {
      checks.batchStamped = p.batchVertices > 0 && p.batchVertices === 3 * p.batchTriangles;
      checks.modelsPainted = p.models >= run.models && p.modelMeshes > 0 && p.modelMaterials > 0;
      /* every stamped mesh drawn is the batch or a painted model's */
      checks.stampedAsReported = state.stamped.meshes === p.modelMeshes + 1 && state.stamped.vertices === p.modelVertices + p.batchVertices;
      checks.groundUnderEveryVertex = state.stamped.withoutGround === 0;
      /* on the course's own ground the foot reaches the batch's walls and every painted model's */
      checks.footOnTheGround = areas.length === p.models + 1 && areas.every(a => a.foot > 0);
    }
    if (run.same) {
      /* the models are the same at either quality; the batch is not -- low quality thins the inferred houses
         that fill a residential area without mapped ones, as it did before this batch */
      const hi = byKey[run.same].paint;
      checks.modelsAsHighQuality = ['models', 'modelMeshes', 'modelMaterials', 'modelVertices', 'modelCopies', 'modelCopiedVertices']
        .every(k => p[k] === hi[k]);
    }
    const row = { name: run.name, q: run.q, url: url.replace(`http://127.0.0.1:${port}`, ''), seconds: Math.round((Date.now() - started) / 1000),
      checks, ...state, footArea: areas, errors };
    rows.push(row); byKey[run.key] = row;
    if (!Object.values(checks).every(Boolean)) failed = true;
    console.log(JSON.stringify({ name: run.name, checks, paint: p, stamped: state.stamped, facilities: state.facilities,
      landmarks: state.landmarks, authored: state.authored, footArea: areas.map(a => `${a.name}: ${a.foot} of ${a.wall} m2`) }));
  }
} finally {
  server.kill();
}
fs.writeFileSync(out, JSON.stringify({ adapter: GPU ? 'gpu' : 'swiftshader', rows }, null, 1) + '\n');
console.log(failed ? 'boot check FAILED' : `boot check passed -> ${out}`);
process.exitCode = failed ? 1 : 0;
