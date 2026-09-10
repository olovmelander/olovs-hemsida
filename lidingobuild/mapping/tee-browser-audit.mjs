#!/usr/bin/env node
/* Verify all 90 selected references and actual instanced marker geometry in
 * a locally served normal production build. Raw screenshots stay ignored. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { auditLidingoTees } from './tee-runtime-audit.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = (process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8648').replace(/\/$/, '');
const useGl = process.argv.includes('--gl'), mode = useGl ? 'webgl' : 'webgpu';
const OUT = path.join(ROOT, 'lidingobuild/cache/tee-browser-review');
fs.mkdirSync(OUT, { recursive: true });
const read = p => fs.readFileSync(path.join(ROOT, p));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modelBytes = read('lidingobuild/course-model.json'), packBytes = read('apps/golf/public/courses/lidingo/pack.bin');
const model = JSON.parse(modelBytes), vectors = JSON.parse(inflateStream(readPack(packBytes).sv));
const card = JSON.parse(read('lidingobuild/reference/club-scorecard.json'));
const surfaces = JSON.parse(read('lidingobuild/mapping/playing-surfaces.geojson')).features;
const issues = [], errors = [], networkErrors = [], selections = [], screenshots = [];
const report = { schemaVersion: 1, groundId: 'lidingo', kind: 'tee-browser-alignment-audit',
  startedAt: new Date().toISOString(), baseUrl: BASE, backendRequested: mode,
  modelSha256: sha(modelBytes.toString('utf8').replace(/\r\n/g, '\n')), packSha256: sha(packBytes),
  selections, screenshots, errors, networkErrors, issues };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
let bootProgress;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === 'OB (karta)') window.__obMapLabelDraws = (window.__obMapLabelDraws || 0) + 1;
      return original.call(this, text, ...args);
    };
  });
  page.on('pageerror', e => { errors.push(String(e)); console.log(JSON.stringify({ mode, pageError: String(e) })); });
  page.on('response', response => { if (response.status() >= 400) networkErrors.push({ url: response.url(), status: response.status() }); });
  const url = `${BASE}/?bana=lidingo&hal=1&tee=2&vy=tee&v2=require&det=1&ljus=dag${useGl ? '&gl=1' : ''}`;
  console.log(JSON.stringify({ state: 'booting', mode, url }));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  bootProgress = setInterval(() => {
    void page.evaluate(() => document.querySelector('#boot')?.innerText ?? 'boot screen absent')
      .then(message => console.log(JSON.stringify({ mode, bootProgress: message }))).catch(() => {});
  }, 30000);
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  clearInterval(bootProgress);
  const state = await page.evaluate(() => ({ holes: V3D.HOLES, course: V3D.course(), terrain: V3D.v2Terrain(),
    backend: V3D.stats.backend, markerGeometry: V3D.teeMarkerGeometry(),
    boundaryMarkerGeometry: V3D.boundaryMarkerGeometry(), outOfBounds: V3D.M.outOfBounds,
    boundaryMarking: V3D.M.marking, obMapLabelDraws: window.__obMapLabelDraws || 0,
    policies: { objects: V3D.M.infra.objectPlacement,
      terrain: V3D.M.infra.terrainPlacement, vegetation: V3D.M.infra.vegetationPlacement } }));
  report.boot = { ...state }; delete report.boot.holes; delete report.boot.markerGeometry;
  if (state.course.slug !== 'lidingo') issues.push('Wrong course booted');
  if (state.backend !== (useGl ? 'webgl2' : 'webgpu')) issues.push(`Requested ${mode}; got ${state.backend}`);
  if (!state.terrain.ready || state.terrain.status !== 'ready') issues.push('Required v2 terrain did not become ready');
  const response = await context.request.get(`${BASE}/courses/lidingo/pack.bin`);
  report.httpPackSha256 = sha(await response.body());
  if (!response.ok() || report.httpPackSha256 !== report.packSha256) issues.push('Served pack differs from the source pack');
  if (model.outOfBounds) {
    if (JSON.stringify(model.outOfBounds) !== JSON.stringify(vectors.outOfBounds) ||
        JSON.stringify(vectors.outOfBounds) !== JSON.stringify(state.outOfBounds)) issues.push('Reviewed OB map boundaries differ between source, pack and browser');
    if (!state.obMapLabelDraws) issues.push('Reviewed OB map annotation was not drawn');
    const whiteSourcePoints = (model.marking || []).filter(m => m.color === 'w').flatMap(m => m.pts).length;
    const whiteRuntimePoints = (state.boundaryMarking || []).filter(m => m.c === 'w').flatMap(m => m.pts).length;
    if (whiteSourcePoints !== whiteRuntimePoints) issues.push('Runtime invented or dropped physical white stake points');
    if (!(vectors.marking || []).length && state.boundaryMarkerGeometry.length) issues.push('Runtime invented physical boundary marker instances');
    report.outOfBoundsSummary = { reviewedSegments: state.outOfBounds.lines.length,
      reviewedVertices: state.outOfBounds.lines.reduce((sum, line) => sum + line.line.length, 0),
      allSegmentsVirtual: state.outOfBounds.lines.every(line => line.virtual === true),
      whiteSourcePoints, whiteRuntimePoints, physicalBoundaryInstances: state.boundaryMarkerGeometry.length,
      mapLabelDraws: state.obMapLabelDraws };
  }
  const audit = auditLidingoTees(model, vectors, card, surfaces, state.holes);
  issues.push(...audit.issues); report.runtimeSummary = audit.summary;
  const expected = audit.holes.flatMap(h => h.marks.flatMap(m => m.pair.map(p => ({ hole: h.hole, colour: m.colour, position: p }))));
  const unmatched = state.markerGeometry.map((p, index) => ({ ...p, originalIndex: index }));
  report.geometry = expected.map(p => {
    const ranked = unmatched.map((actual, index) => ({ actual, index, residualM: distance(p.position, [actual.position[0], actual.position[2]]) })).sort((a, b) => a.residualM - b.residualM);
    const match = ranked[0];
    if (!match || match.residualM > .001) issues.push(`Hole ${p.hole} ${p.colour}: expected marker was not present in GPU geometry`);
    if (match) unmatched.splice(match.index, 1);
    return { ...p, actual: match?.actual ?? null, horizontalResidualM: match?.residualM ?? null };
  });
  if (unmatched.length) issues.push(`${unmatched.length} unexpected GPU marker instances`);
  report.unexpectedMarkerInstances = unmatched;
  for (const hole of model.holes) {
    const rows = await page.evaluate(async number => {
      const rows = [], h = V3D.HOLES.find(hole => hole.n === number);
      for (let index = 0; index < h.tees.marks.length; index++) {
        V3D.goHole(number, true, true);
        document.querySelectorAll('#tees .tee')[index].click();
        V3D.setCam('tee', true);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const selected = document.querySelector('#tees .tee.on');
        rows.push({ hole: number, index, reference: h.tees.marks[index].c, camera: V3D.camExact(),
          activeIndex: [...document.querySelectorAll('#tees .tee')].indexOf(selected),
          displayedMetres: +selected.querySelector('b').textContent,
          displayedHole: +document.getElementById('cno').textContent,
          rangefinderOrigin: V3D.rangefinder().origin });
      }
      return rows;
    }, hole.n);
    for (const row of rows) {
      const reference = hole.tees.marks[row.index].c;
      row.referenceResidualM = distance(row.reference, reference);
      row.cameraResidualM = distance([row.camera.pos[0], row.camera.pos[2]], reference);
      row.rangefinderResidualM = distance(row.rangefinderOrigin, reference);
      if (Math.max(row.referenceResidualM, row.cameraResidualM, row.rangefinderResidualM) > .00001) issues.push(`Hole ${hole.n} colour ${row.index}: selected origin moved`);
      if (row.activeIndex !== row.index || row.displayedHole !== hole.n || row.displayedMetres !== hole.t[row.index]) issues.push(`Hole ${hole.n} colour ${row.index}: selected card metadata differs`);
      selections.push(row);
    }
    console.log(JSON.stringify({ mode, reviewedHole: hole.n, selectedReferences: selections.length }));
  }
  for (const hole of [1, 2, 8, 15, 17, 6, 9, 10, 18]) {
    await page.evaluate(number => { V3D.goHole(number, true, true); document.querySelectorAll('#tees .tee')[1].click(); V3D.setCam('tee', true); }, hole);
    await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
    const target = path.join(OUT, `${mode}-hole-${hole.toString().padStart(2, '0')}.png`);
    await page.screenshot({ path: target }); screenshots.push(path.relative(ROOT, target).split(path.sep).join('/'));
    console.log(JSON.stringify({ mode, screenshot: target }));
  }
} catch (error) { issues.push(String(error)); }
finally { clearInterval(bootProgress); await browser.close(); }
if (!read('lidingobuild/course-model.json').equals(modelBytes) || !read('apps/golf/public/courses/lidingo/pack.bin').equals(packBytes)) {
  issues.push('Source model or pack changed during the browser audit');
}
issues.push(...errors);
if (networkErrors.length) issues.push(`${networkErrors.length} HTTP failures`);
report.completedAt = new Date().toISOString(); report.state = issues.length ? 'failed' : 'passed';
report.summary = { selections: selections.length, markerInstances: report.geometry?.length ?? 0,
  maxMarkerHorizontalResidualM: Math.max(0, ...(report.geometry || []).map(g => g.horizontalResidualM ?? Infinity)),
  maxCameraHorizontalResidualM: Math.max(0, ...selections.map(s => s.cameraResidualM)), screenshots: screenshots.length, issues: issues.length };
const output = path.join(ROOT, `lidingobuild/mapping/tee-browser-validation-${mode}.json`);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, state: report.state, summary: report.summary, issues }, null, 2));
if (issues.length) process.exitCode = 1;
