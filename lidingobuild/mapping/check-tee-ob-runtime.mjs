#!/usr/bin/env node
/* Serve the rebuilt app, then run:
 * BANVY_GPU=1 node lidingobuild/mapping/check-tee-ob-runtime.mjs [baseUrl] [--gl]
 * Compares actual GPU-bound tee transforms and reviewed OB map annotations
 * with the pack; captures the yellow-tee selector at holes 1, 10, 12 and 18.
 * Virtual boundaries do not require or imply physical stake instances. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { canRenderTeeMarker } from '../../apps/golf/src/engine/tee-marker-visibility.mjs';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
import { boundaryMarkerSubmerged } from '../../apps/golf/src/engine/boundary-marker-placement.mjs';
import { inRing, ringSD } from '../../apps/golf/src/engine/geom.js';
import { teeView } from '../../apps/golf/src/engine/tee-view.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = (process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:8634').replace(/\/$/, '');
const useGl = process.argv.includes('--gl');
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const filePrefix = `lidingobuild/cache/tee-ob-review/${useGl ? 'webgl' : 'webgpu'}`;
fs.mkdirSync(path.join(ROOT, filePrefix), { recursive: true });
const modelPath = 'lidingobuild/course-model.json', packPath = 'apps/golf/public/courses/lidingo/pack.bin';
const modelBytes = read(modelPath), packBytes = read(packPath), model = JSON.parse(modelBytes);
const packed = readPack(packBytes), vectors = JSON.parse(inflateStream(packed.sv));
const holes = withInferredTeePads(vectors.holes);
const expectedMarkers = holes.flatMap(hole => hole.tees.marks.flatMap((mark, colourIndex) =>
  canRenderTeeMarker(hole, mark, vectors.infra.objectPlacement)
    ? reviewedTeeMarkerPositions(hole, mark).map(c => ({ hole: hole.n, colourIndex, c,
      ring: hole.tees.pads.find(pad => pad.id === mark.sourcePadId || pad.reviewId === mark.sourcePadId)?.ring })) : []));
const whitePoints = (vectors.marking || []).filter(run => run.c === 'w').flatMap(run => run.pts);
const rootIndex = JSON.parse(read('apps/golf/public/courses/v2-index.json'));
const entry = rootIndex.courses.find(course => course.slug === 'lidingo');
const courseManifest = JSON.parse(read(`apps/golf/public/${entry.manifest.url}`));
const ground = JSON.parse(read(`apps/golf/public/${courseManifest.groundManifest.url}`));
const report = { schemaVersion: 1, groundId: 'lidingo', auditedAt: new Date().toISOString(),
  url: `${BASE}/?bana=lidingo&v2=require&det=1&hal=1&tee=2&vy=tee&ljus=dag${useGl ? '&gl=1' : ''}`,
  inputs: { modelSha256: sha(modelBytes), packSha256: sha(packBytes), groundManifestSha256: courseManifest.groundManifest.sha256,
    runtimeSha256: sha(read('apps/golf/src/main.js')) },
  expectedMarkerInstances: expectedMarkers.length, sourceWhitePoints: whitePoints.length,
  sourceVirtualBoundarySegments: vectors.outOfBounds?.lines?.length ?? 0,
  errors: [], packResponses: [], geometry: [], shots: [], gates: [] };
const gate = (name, pass, detail) => report.gates.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
let browser, bootProgress;
try {
  const linuxChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  browser = await chromium.launch({ headless: true,
    ...(fs.existsSync(linuxChrome) ? { executablePath: linuxChrome } : { channel: 'chrome' }), args: browserArgs() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === 'OB (karta)') window.__teeReviewObLabels = (window.__teeReviewObLabels || 0) + 1;
      return fillText.call(this, text, ...args);
    };
    CanvasRenderingContext2D.prototype.stroke = function (...args) {
      if (Math.abs(this.lineWidth - 1.6) < .001 && this.getLineDash().join(',') === '4,3') {
        window.__teeReviewObStrokes = (window.__teeReviewObStrokes || 0) + 1;
      }
      return stroke.apply(this, args);
    };
  });
  page.on('pageerror', error => { report.errors.push(String(error).slice(0, 1000)); console.log(`Browser error: ${error}`); });
  const responses = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/courses/lidingo/pack.bin')) {
      responses.push(response.body().then(bytes => report.packResponses.push({ status: response.status(), sha256: sha(bytes) }))
        .catch(error => report.errors.push(`pack response: ${error.message}`)));
    }
  });
  console.log(`Lidingo tee/OB browser review: ${report.url}`);
  const started = Date.now();
  await page.goto(report.url, { waitUntil: 'load', timeout: 120000 });
  bootProgress = setInterval(() => {
    void page.evaluate(() => document.querySelector('#boot')?.innerText ?? 'boot screen absent')
      .then(message => console.log(`Boot progress: ${message}`)).catch(() => {});
  }, 30000);
  await page.waitForSelector('#boot.done', { timeout: +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000 });
  clearInterval(bootProgress);
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  report.bootSeconds = (Date.now() - started) / 1000;
  const state = await page.evaluate(({ markers, whitePoints }) => {
    const V = window.V3D;
    return { holes: V.HOLES, policies: V.M.infra, marking: V.M.marking, water: V.M.water,
      outOfBounds: V.M.outOfBounds, obLabelDraws: window.__teeReviewObLabels || 0, obLineDraws: window.__teeReviewObStrokes || 0,
      stats: V.stats, terrain: V.v2Terrain(),
      markers: V.teeMarkerGeometry(), boundary: V.boundaryMarkerGeometry(),
      markerHeights: markers.map(point => V.terrainH(...point)),
      whiteHeights: whitePoints.map(point => V.terrainH(...point)) };
  }, { markers: expectedMarkers.map(marker => marker.c), whitePoints });
  report.boot = { stats: state.stats, terrain: state.terrain,
    policies: Object.fromEntries(['objectPlacement', 'terrainPlacement', 'vegetationPlacement'].map(key => [key, state.policies[key]])),
    actualMarkerInstances: state.markers.length, actualWhiteInstances: state.boundary.filter(post => post.colour === 'w').length };
  gate('required v2 graph boots', state.terrain.adapter?.kind === 'graph' && state.terrain.adapter?.phase === 'ready');
  gate('requested graphics backend is active', state.stats.backend === (useGl ? 'webgl2' : 'webgpu'));
  gate('mapped objects and measured terrain/vegetation policies remain active',
    state.policies.objectPlacement === 'mapped-only' && state.policies.terrainPlacement === 'measured-only' && state.policies.vegetationPlacement === 'measured-only');
  gate('published surrounding terrain rings remain present', ground.tiles.some(tile => tile.parentId));
  gate('inferred furniture and ground cover stay suppressed',
    ['tufts', 'bushes', 'stones', 'stumps', 'reeds', 'inferredRangeTargets', 'cars'].every(key => state.stats[key] === 0));
  for (const expected of holes) {
    const actual = state.holes.find(hole => hole.n === expected.n), source = model.holes.find(hole => hole.n === expected.n);
    const tee = h => ({ inferPads: h?.tees?.inferPads, markerLayout: h?.tees?.markerLayout, markerPlacement: h?.tees?.markerPlacement,
      pads: h?.tees?.pads.map(pad => [pad.ring,
        h.tees.marks.some(mark => mark.sourcePadId === pad.id) ? pad.id : undefined, pad.preserveTerrain]),
      marks: h?.tees?.marks.map(mark => [mark.c, mark.sourcePadId, mark.orthophotoReference]) });
    report.geometry.push({ hole: expected.n, sourceAndPackMatch: equal(tee(source), tee(expected)),
      loadedReviewMatches: equal(tee(actual), tee(expected)),
      routeAndCardMatch: equal([actual?.line, actual?.t, actual?.par, actual?.idx], [expected.line, expected.t, expected.par, expected.idx]),
      bearingsMatch: actual?.tees.marks.every((mark, i) => Math.abs(mark.b - expected.tees.marks[i].b) < 1e-9) });
  }
  gate('all holes retain reviewed references, platform rings, route, card and derived bearings',
    report.geometry.length === holes.length && report.geometry.every(row => row.sourceAndPackMatch && row.loadedReviewMatches && row.routeAndCardMatch && row.bearingsMatch));
  report.markerTransforms = expectedMarkers.map((expected, i) => {
    const actual = state.markers[i], p = actual?.position;
    return { hole: expected.hole, colourIndex: expected.colourIndex,
      horizontalErrorM: p ? distance(expected.c, [p[0], p[2]]) : null,
      heightErrorM: p ? Math.abs(p[1] - state.markerHeights[i] - .11) : null,
      edgeClearanceM: p && expected.ring ? -ringSD(p[0], p[2], expected.ring) : null,
      radiusM: actual?.radius ?? null };
  });
  gate('every accepted tee pair reaches GPU geometry inside its nominated surface',
    expectedMarkers.length > 0 && state.markers.length === expectedMarkers.length && report.markerTransforms.every(row =>
      row.horizontalErrorM !== null && row.horizontalErrorM < .001 && row.heightErrorM < .001 && row.edgeClearanceM >= row.radiusM));
  const expectedWhite = whitePoints.flatMap((c, i) => boundaryMarkerSubmerged(...c, state.whiteHeights[i], state.water)
    ? [] : [{ c, height: state.whiteHeights[i] }]);
  const actualWhite = state.boundary.filter(post => post.colour === 'w');
  report.whiteTransforms = expectedWhite.map((expected, i) => ({
    horizontalErrorM: actualWhite[i] ? distance(expected.c, [actualWhite[i].position[0], actualWhite[i].position[2]]) : null,
    heightErrorM: actualWhite[i] ? Math.abs(actualWhite[i].position[1] - expected.height) : null }));
  gate('physical white stakes match the explicitly supplied points and dry-ground heights',
    actualWhite.length === expectedWhite.length && report.whiteTransforms.every(row => row.horizontalErrorM !== null && row.horizontalErrorM < .001 && row.heightErrorM < .001));
  gate('boundary review metadata survives loading', equal(state.marking, vectors.marking));
  const virtualBoundaries = state.outOfBounds?.lines || [];
  report.outOfBounds = { reviewedSegments: virtualBoundaries.length,
    reviewedVertices: virtualBoundaries.reduce((sum, line) => sum + line.line.length, 0),
    labelDraws: state.obLabelDraws, dashedLineDraws: state.obLineDraws,
    physicalWhiteStakes: actualWhite.length, sourcePhysicalWhitePoints: whitePoints.length };
  gate('reviewed OB map boundaries and evidence match source, pack and browser', virtualBoundaries.length > 0 &&
    equal(model.outOfBounds, vectors.outOfBounds) && equal(vectors.outOfBounds, state.outOfBounds) &&
    virtualBoundaries.every(line => line.virtual === true && line.completeBoundary === false &&
      line.evidence?.capturedAt && line.evidence?.ruleSourceId));
  gate('reviewed virtual OB boundaries reach the map canvas', state.obLabelDraws > 0 && state.obLineDraws >= virtualBoundaries.length);
  console.log(`Booted in ${report.bootSeconds.toFixed(1)} s; checked ${state.markers.length} tee balls, ${virtualBoundaries.length} OB map segments and ${actualWhite.length} physical white stakes.`);
  for (const holeNumber of [1, 10, 12, 18]) {
    await page.evaluate(hole => { window.V3D.goHole(hole, true, true); window.V3D.setCam('tee', true); }, holeNumber);
    await page.locator('#tees .tee').nth(1).click();
    await page.evaluate(() => window.V3D.setCam('tee', true));
    await page.waitForFunction(() => window.V3D.settled() && window.V3D.v2Terrain().adapter?.stream?.loadingTiles === 0, null, { timeout: 120000 });
    const view = await page.evaluate(number => {
      const V = window.V3D, hole = V.HOLES.find(h => h.n === number);
      return { camera: V.camExact(), mode: V.camInfo().mode, reference: hole.tees.marks[1],
        selectedTeeIndex: [...document.querySelectorAll('#tees .tee')].findIndex(node => node.classList.contains('on')) };
    }, holeNumber);
    const expectedHole = holes.find(hole => hole.n === holeNumber), reference = expectedHole.tees.marks[1], target = teeView(expectedHole, reference);
    const cameraC = [view.camera.pos[0], view.camera.pos[2]];
    const file = `${filePrefix}/hole-${String(holeNumber).padStart(2, '0')}-yellow-tee.png`;
    await page.screenshot({ path: path.join(ROOT, file), animations: 'disabled', timeout: 60000 });
    report.shots.push({ hole: holeNumber, file, ...view, cameraReferenceErrorM: distance(cameraC, reference.c),
      cameraAimErrorM: distance([view.camera.look[0], view.camera.look[2]], [target.aim.x, target.aim.z]),
      cameraInsideNominatedPlatform: expectedHole.tees.pads.some(pad => pad.id === reference.sourcePadId && inRing(...cameraC, pad.ring)) });
    console.log(`Captured hole ${holeNumber} yellow tee.`);
  }
  gate('all four tee views use the actual selector and preserve reference coordinates and aim',
    report.shots.length === 4 && report.shots.every(shot => shot.mode === 'tee' && shot.selectedTeeIndex === 1 &&
      shot.cameraReferenceErrorM < .0001 && shot.cameraAimErrorM < .0001 &&
      (shot.reference.orthophotoReference?.kind === 'unresolved-guide-tee-reference' || shot.cameraInsideNominatedPlatform)));
  await Promise.all(responses);
} catch (error) {
  report.errors.push(error.stack || String(error));
} finally {
  clearInterval(bootProgress);
  await browser?.close();
}
gate('no browser exceptions', report.errors.length === 0);
gate('browser loaded the current exact pack', report.packResponses.length > 0 && report.packResponses.every(response => response.status === 200 && response.sha256 === report.inputs.packSha256));
gate('model and pack stayed unchanged during capture', sha(read(modelPath)) === report.inputs.modelSha256 && sha(read(packPath)) === report.inputs.packSha256);
report.pass = report.gates.every(item => item.pass);
const reportPath = `lidingobuild/mapping/tee-ob-runtime-validation${useGl ? '-webgl' : ''}.json`;
fs.writeFileSync(path.join(ROOT, reportPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: report.pass, report: reportPath, failedGates: report.gates.filter(item => !item.pass), errors: report.errors }, null, 2));
if (!report.pass) process.exitCode = 1;
