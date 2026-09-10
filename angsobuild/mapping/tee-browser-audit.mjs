/* Run after rebuilding Ängsö. Checks the actual selectable tee camera and all
 * loaded tee geometry, then captures every yellow tee and two fairway tees.
 * BANVY_GPU=1 BANVY_BOOT_TIMEOUT=120 node angsobuild/mapping/tee-browser-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { teeMarkerPositions } from '../../apps/golf/src/engine/tee-marker-placement.mjs';
import { teeView } from '../../apps/golf/src/engine/tee-view.mjs';
import { inRing } from '../../apps/golf/src/engine/geom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = (process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:8619').replace(/\/$/, '');
const OUT = path.join(ROOT, 'angsobuild/shots/tee-review-2026-09-09');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 120) * 1000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const modelBytes = read('angsobuild/course-model.json'), model = JSON.parse(modelBytes);
const packBytes = read('apps/golf/public/courses/angso/pack.bin');
const pack = readPack(packBytes), vectors = JSON.parse(inflateStream(pack.sv));
const expectedHoles = withInferredTeePads(vectors.holes);
const inputsSha256 = { model: sha(modelBytes), pack: sha(packBytes),
  markerHelper: sha(read('apps/golf/src/engine/tee-marker-placement.mjs')),
  cameraHelper: sha(read('apps/golf/src/engine/tee-view.mjs')),
  main: sha(read('apps/golf/src/main.js')) };
const expectedMarkerInstances = vectors.infra.objectPlacement === 'mapped-only' ? 0 :
  expectedHoles.reduce((sum, hole) => sum + hole.tees.marks.reduce((count, mark) => count + teeMarkerPositions(hole, mark).length, 0), 0);
const views = [
  ...Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, teeIndex: 1, id: `h${String(i + 1).padStart(2, '0')}_gul_tee` })),
  { hole: 5, teeIndex: 4, id: 'h05_orange_tee' },
  { hole: 17, teeIndex: 4, id: 'h17_orange_tee' },
];
const report = { schemaVersion: 1, groundId: 'angso', auditedAt: new Date().toISOString(), inputsSha256,
  url: `${BASE}/?bana=angso&det=1&v2=require&hal=2&tee=2&vy=tee&ljus=dag`,
  requestedViews: views.length, booted: false, bootSeconds: null, expectedMarkerInstances,
  errors: [], consoleWarnings: [], packResponses: [], geometryChecks: [], shots: [], gates: [] };
fs.mkdirSync(OUT, { recursive: true });
const linuxChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(fs.existsSync(linuxChrome) ? { executablePath: linuxChrome } : { channel: 'chrome' }), args: browserArgs() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(String(error).split('\n')[0].slice(0, 400)));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type()) && report.consoleWarnings.length < 30) report.consoleWarnings.push(message.text().slice(0, 400));
  });
  const pendingResponses = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/courses/angso/pack.bin')) {
      pendingResponses.push(response.body().then(bytes => report.packResponses.push({ url: response.url(),
        status: response.status(), bytes: bytes.length, sha256: sha(bytes) })).catch(error => report.errors.push(`Pack response: ${error.message}`)));
    }
  });
  console.log(`Ängsö tee browser audit <- ${report.url}`);
  const started = Date.now();
  await page.goto(report.url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
  report.booted = true; report.bootSeconds = (Date.now() - started) / 1000;
  const boot = await page.evaluate(() => {
    const V = window.V3D;
    return { holes: V.HOLES, geo: V.GEO, stats: V.stats, v2: V.v2Terrain(),
      markerMeshes: V.sceneInventory().filter(mesh => mesh.tag === 'markers'), groundClamp: V.groundClamp() };
  });
  report.boot = { geo: boot.geo, stats: boot.stats, v2: boot.v2, markerMeshes: boot.markerMeshes, groundClamp: boot.groundClamp };
  report.actualMarkerInstances = boot.markerMeshes.reduce((sum, mesh) => sum + (mesh.instances ?? 0), 0);
  for (const expected of expectedHoles) {
    const actual = boot.holes.find(hole => hole.n === expected.n);
    const source = model.holes.find(hole => hole.n === expected.n);
    report.geometryChecks.push({ hole: expected.n,
      modelAndPackReferencesMatch: equal(source.tees.marks.map(mark => mark.c), vectors.holes.find(hole => hole.n === expected.n).tees.marks.map(mark => mark.c)),
      referencesMatch: equal(actual?.tees?.marks.map(mark => mark.c), expected.tees.marks.map(mark => mark.c)),
      platformRingsMatch: equal(actual?.tees?.pads.map(pad => pad.ring), expected.tees.pads.map(pad => pad.ring)),
      referenceEvidenceMatches: equal(actual?.tees?.marks.map(mark => [mark.referenceSurfaceKind, mark.sourcePadId, mark.orthophotoReference]),
        expected.tees.marks.map(mark => [mark.referenceSurfaceKind, mark.sourcePadId, mark.orthophotoReference])),
      bearingsMatch: actual?.tees?.marks.every((mark, i) => Math.abs(mark.b - expected.tees.marks[i].b) < 1e-9),
    });
  }
  console.log(`Boot completed in ${report.bootSeconds.toFixed(2)} s; ${report.actualMarkerInstances} marker instances.`);
  for (const view of views) {
    await page.evaluate(hole => { window.V3D.goHole(hole, true, true); window.V3D.setCam('tee', true); }, view.hole);
    // Use the visitor's actual tee selector, then finish its camera transition.
    await page.locator('#tees .tee').nth(view.teeIndex).click();
    await page.evaluate(() => window.V3D.setCam('tee', true));
    await page.waitForFunction(() => window.V3D.settled() && window.V3D.v2Terrain().adapter?.stream?.loadingTiles === 0,
      null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    const state = await page.evaluate(({ hole, teeIndex }) => {
      const V = window.V3D, h = V.HOLES.find(item => item.n === hole), mark = h.tees.marks[teeIndex];
      return { camera: V.camExact(), mode: V.camInfo().mode, reference: mark,
        selectedTeeIndex: [...document.querySelectorAll('#tees .tee')].findIndex(node => node.classList.contains('on')),
        classification: V.classify(...mark.c), ground: V.terrainH(...mark.c),
        stream: V.v2Terrain().adapter?.stream ?? null, url: location.href };
    }, view);
    const hole = expectedHoles.find(item => item.n === view.hole), mark = hole.tees.marks[view.teeIndex];
    const target = teeView(hole, mark), cameraPosition = [state.camera.pos[0], state.camera.pos[2]];
    const sourceRings = mark.referenceSurfaceKind === 'fairway' && mark.orthophotoReference?.kind === 'guide-orthophoto-reference'
      ? hole.fairway.rings : hole.tees.pads.filter(pad => mark.sourcePadId === undefined || pad.reviewId === mark.sourcePadId || pad.id === mark.sourcePadId).map(pad => pad.ring);
    const row = { ...view, ...state, expectedReference: mark.c,
      cameraToReferenceMetres: distance(cameraPosition, mark.c),
      cameraAimToExpectedMetres: distance([state.camera.look[0], state.camera.look[2]], [target.aim.x, target.aim.z]),
      cameraEyeHeightMetres: state.camera.pos[1] - state.ground,
      cameraInsideReferenceSurface: sourceRings.some(ring => inRing(...cameraPosition, ring)),
      markerPairs: teeMarkerPositions(hole, mark),
      file: `angsobuild/shots/tee-review-2026-09-09/${view.id}.png` };
    await page.screenshot({ path: path.join(ROOT, row.file), timeout: 60000, animations: 'disabled' });
    report.shots.push(row);
    console.log(`${view.id}: camera error ${row.cameraToReferenceMetres.toFixed(6)} m, eye ${row.cameraEyeHeightMetres.toFixed(3)} m, reference ${mark.orthophotoReference?.kind}`);
  }
  await Promise.all(pendingResponses);
} catch (error) {
  report.errors.push(error.stack ?? String(error));
} finally {
  await browser?.close();
}
const adapter = report.boot?.v2?.adapter;
report.gates = [
  { name: 'WebGPU course and v2 graph booted successfully', pass: report.booted && report.boot?.stats?.backend === 'webgpu' && adapter?.kind === 'graph' && adapter?.phase === 'ready' },
  { name: 'no browser errors', pass: report.errors.length === 0 },
  { name: 'browser loaded the exact rebuilt course pack', pass: report.packResponses.length > 0 && report.packResponses.every(response => response.status === 200 && response.sha256 === inputsSha256.pack) },
  { name: 'all 18 holes retain model/pack references, reviewed platform rings, evidence and derived bearings', pass: report.geometryChecks.length === 18 && report.geometryChecks.every(row => Object.entries(row).filter(([key]) => key !== 'hole').every(([, value]) => value === true)) },
  { name: 'actual scene marker instance count matches shared placement', pass: report.actualMarkerInstances === expectedMarkerInstances },
  { name: 'all 20 requested views captured through the actual tee selector', pass: report.shots.length === views.length && report.shots.every(row => row.selectedTeeIndex === row.teeIndex && row.mode === 'tee') },
  { name: 'all selected tee cameras retain exact reference coordinates and forward aim', pass: report.shots.every(row => row.cameraToReferenceMetres < 1e-6 && row.cameraAimToExpectedMetres < 1e-6) },
  { name: 'all accepted selected references and cameras stand on the associated turf', pass: report.shots.every(row => row.reference.orthophotoReference?.kind !== 'guide-orthophoto-reference' || row.cameraInsideReferenceSurface) },
  { name: 'every view settled with the terrain in one draw call', pass: report.shots.every(row => row.stream?.loadingTiles === 0 && row.stream?.drawCalls === 1) },
  { name: 'the source model and course pack remained unchanged throughout capture', pass: sha(read('angsobuild/course-model.json')) === inputsSha256.model && sha(read('apps/golf/public/courses/angso/pack.bin')) === inputsSha256.pack },
];
report.pass = report.gates.every(gate => gate.pass);
fs.writeFileSync(path.join(OUT, 'tee-browser-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ pass: report.pass, bootSeconds: report.bootSeconds, views: report.shots.length,
  report: path.relative(ROOT, path.join(OUT, 'tee-browser-audit.json')), failedGates: report.gates.filter(gate => !gate.pass), errors: report.errors }, null, 2));
if (!report.pass) process.exitCode = 1;
