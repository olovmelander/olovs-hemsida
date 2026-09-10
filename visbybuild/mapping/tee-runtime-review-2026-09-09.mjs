#!/usr/bin/env node
/** Exercise every Visby tee through real card controls, the camera and GPS.
 * BANVY_GPU=1 node visbybuild/mapping/tee-runtime-review-2026-09-09.mjs http://127.0.0.1:8642
 * Optional: --backend=webgpu --modes=v2,gpk --out=relative/report.json
 * Source imagery is never loaded or published by this browser check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from '../../tools/browser-args.mjs';
import { VISBY_FRAME } from '../frame.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = (args.find(a => !a.startsWith('--')) || 'http://127.0.0.1:8642').replace(/\/$/, '');
const BACKEND = option('backend', 'webgl2');
const MODES = option('modes', 'v2,gpk').split(',');
if (!['webgl2', 'webgpu', 'auto'].includes(BACKEND) || MODES.some(m => !['v2', 'gpk'].includes(m))) throw new Error('Unexpected browser mode');
const OUT = path.resolve(ROOT, option('out', `visbybuild/mapping/tee-runtime-review-2026-09-09${BACKEND === 'webgl2' ? '' : `-${BACKEND}`}.json`));
const SHOTS = path.join(ROOT, 'visbybuild/cache/tee-runtime-review-2026-09-09', BACKEND);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const rel = file => path.relative(ROOT, file).replaceAll(path.sep, '/');
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const MODEL_FILE = path.join(ROOT, 'visbybuild/course-model.json');
const modelBytes = fs.readFileSync(MODEL_FILE), model = JSON.parse(modelBytes);
const manifestFile = path.join(ROOT, 'apps/golf/public/courses/index.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile));
const course = manifest.courses.find(c => c.slug === 'visby');
if (!course || model.holes.length !== 18 || course.tees.names.length !== 6) throw new Error('Expected the six-tee Visby eighteen');
const packFile = path.join(ROOT, 'apps/golf/public/courses/visby/pack.bin');
const packSha256 = sha(fs.readFileSync(packFile));
const projected = model.holes.flatMap(h => h.tees.marks.map((m, i) => ({
  hole: h.n, teeIndex: i, tee: course.tees.names[i], local: m.c,
  epsg3006: [VISBY_FRAME.easting + m.c[0], VISBY_FRAME.northing - m.c[1]],
})));
if (projected.length !== 108) throw new Error('Expected 108 source references');
// An independent PROJ inverse, rather than the app's own GPS arithmetic.
const PYTHON = process.env.COURSE_GEO_PYPROJ_PYTHON || [
  'upsalabuild/cache/review-venv/Scripts/python.exe',
  'geobuild/cache/ortho-venv/Scripts/python.exe',
].map(f => path.join(ROOT, f)).find(f => fs.existsSync(f)) || 'python';
const projection = JSON.parse(execFileSync(PYTHON, ['-c',
  "import json,sys,pyproj; t=pyproj.Transformer.from_crs(3006,4326,always_xy=True); p=json.load(sys.stdin); print(json.dumps({'pyproj':pyproj.__version__,'proj':pyproj.proj_version_str,'wgs84':[list(t.transform(*v)) for v in p]}))"],
  { input: JSON.stringify(projected.map(p => p.epsg3006)), encoding: 'utf8' }));
projected.forEach((p, i) => { p.wgs84LongitudeLatitude = projection.wgs84[i]; });
const report = {
  schemaVersion: 2, groundId: 'visby', kind: 'real-browser-all-tee-coordinate-review',
  startedAt: new Date().toISOString(), completedAt: null, passed: false,
  inputs: { model: rel(MODEL_FILE), modelSha256: sha(modelBytes), pack: rel(packFile), packSha256,
    courseManifest: rel(manifestFile), courseManifestSha256: sha(fs.readFileSync(manifestFile)) },
  execution: { baseUrl: BASE, requestedBackend: BACKEND, hardwareRequested: GPU, headless: true,
    serialBrowserExecution: true, viewport: [1280, 900], quality: 'lo', graphics: 1,
    reducedMotion: true, performanceEvidence: false, projection: { pyproj: projection.pyproj, proj: projection.proj },
    gps: 'Synthetic WGS84 fixes from independent PROJ inverse of source EPSG:3006 points enter the actual navigator.geolocation watch callback. No device location is requested.',
  },
  tolerances: { sourceAndCameraHorizontalMetres: 0.00001, cameraEyeHeightMetres: 0.01, gpsHorizontalMetres: 0.01 },
  limitations: ['Runtime agreement does not establish surveyed tee-marker accuracy or resolve provisional numbered-platform associations.',
    'Every tee selection receives numeric camera/card/GPS checks; all par-3 selections also receive direct strategy-distance checks; screenshots sample selected corrected areas only.'],
  modes: [], issues: [],
};
const save = () => fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
save();
const browser = await chromium.launch({ headless: true,
  ...(process.env.BANVY_CHROME ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }),
  args: browserArgs() });
try {
  for (const mode of MODES) {
    const row = { mode, url: `${BASE}/?bana=visby&hal=1&tee=1&vy=tee&ljus=dag&det=1&q=lo&graphics=1&v2=${mode === 'v2' ? 'require' : '0'}${BACKEND === 'webgl2' ? '&gl=1' : ''}`,
      passed: false, errors: [], issues: [], selections: [], screenshots: [] };
    report.modes.push(row); save();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => row.errors.push(String(error).slice(0, 700)));
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(BASE).origin) row.errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.addInitScript(() => {
      let callback = null;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        watchPosition(success) { callback = success; return 1; },
        clearWatch() { callback = null; },
        getCurrentPosition() { throw new Error('The test only supports watchPosition'); },
      } });
      window.__teeReviewGpsPublish = coords => {
        if (!callback) throw new Error('GPS has no active watch callback');
        callback({ coords: { ...coords, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      };
    });
    try {
      console.log(JSON.stringify({ mode, state: 'booting', url: row.url }));
      await page.goto(row.url, { waitUntil: 'load', timeout: 120000 });
      await page.waitForSelector('#boot.done', { timeout: +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000 });
      row.boot = await page.evaluate(() => ({ slug: V3D.course().slug, backend: V3D.stats.backend,
        terrain: V3D.v2Terrain(), eyeHeight: V3D.groundClamp().eye, teeNames: V3D.course().tees.names,
        geo: V3D.GEO, defaultTeeIndex: V3D.course().tees.def, platformCount: V3D.HOLES.reduce((n, h) => n + h.tees.pads.length, 0),
      }));
      if (row.boot.slug !== 'visby') row.issues.push('Wrong course booted');
      if (BACKEND !== 'auto' && row.boot.backend !== BACKEND) row.issues.push(`Requested ${BACKEND}; got ${row.boot.backend}`);
      if (mode === 'v2' && (!row.boot.terrain.ready || row.boot.terrain.selection.requestMode !== 'require' || row.boot.terrain.status !== 'ready')) row.issues.push('Required V2 did not become ready');
      if (mode === 'gpk' && row.boot.terrain.requested) row.issues.push('GPK opt-out unexpectedly requested V2');
      const response = await context.request.get(`${BASE}/courses/visby/pack.bin`);
      row.httpPackSha256 = sha(await response.body());
      if (!response.ok() || row.httpPackSha256 !== packSha256) row.issues.push('HTTP pack differs from the current source pack');
      row.appModules = [];
      for (const url of await page.locator('script[type="module"][src]').evaluateAll(nodes => nodes.map(node => node.src))) {
        const asset = await context.request.get(url);
        row.appModules.push({ url, status: asset.status(), sha256: sha(await asset.body()) });
        if (!asset.ok()) row.issues.push(`Application module could not be fingerprinted: ${url}`);
      }
      for (const sourceHole of model.holes) {
        const measurements = await page.evaluate(async ({ number, expected }) => {
          const V = window.V3D, h = V.HOLES.find(h => h.n === number), rows = [];
          for (let index = 0; index < expected.length; index++) {
            V.goHole(number, true, true);
            document.querySelectorAll('#tees .tee')[index].click();
            V.setCam('tee', true);
            const initial = V.camExact();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const camera = V.camExact(), marker = h.tees.marks[index], selected = document.querySelector('#tees .tee.on');
            rows.push({ hole: number, teeIndex: index, sourceReference: expected[index], runtimeReference: marker.c,
              initialCamera: initial, camera, mode: V.camInfo().mode, eyeHeight: V.groundClamp().eye,
              strategy: V.caddie().strategy,
              metadata: { hole: +document.getElementById('cno').textContent,
                teeName: selected.querySelector('i').textContent, metres: +selected.querySelector('b').textContent,
                activeIndex: [...document.querySelectorAll('#tees .tee')].indexOf(selected), cardLine: document.getElementById('cpi').textContent,
                railMetres: document.getElementById('railHoleDist')?.textContent ?? null,
                rangefinderOrigin: V.rangefinder().origin, rangefinderTee: V.rangefinder().tee,
                url: location.search },
              sourcePadId: marker.sourcePadId ?? null,
              associationConfidence: marker.associationConfidence ?? null,
              sourceReviewId: marker.sourceReviewId ?? null,
            });
          }
          return rows;
        }, { number: sourceHole.n, expected: sourceHole.tees.marks.map(m => m.c) });
        for (const m of measurements) {
          const index = m.teeIndex, sourcePoint = sourceHole.tees.marks[index].c;
          m.tee = course.tees.names[index];
          m.residuals = { runtimeSourceMetres: distance(m.runtimeReference, sourcePoint),
            initialCameraHorizontalMetres: distance([m.initialCamera.pos[0], m.initialCamera.pos[2]], sourcePoint),
            settledCameraHorizontalMetres: distance([m.camera.pos[0], m.camera.pos[2]], sourcePoint),
            initialEyeHeightMetres: Math.abs(m.initialCamera.pos[1] - m.initialCamera.ground - m.eyeHeight),
            settledEyeHeightMetres: Math.abs(m.camera.pos[1] - m.camera.ground - m.eyeHeight),
            rangefinderOriginMetres: distance(m.metadata.rangefinderOrigin, sourcePoint),
          };
          const issues = [];
          for (const [key, value] of Object.entries(m.residuals)) if (value > (key.includes('EyeHeight') ? 0.01 : 0.00001)) issues.push(`${key}=${value}`);
          if (m.mode !== 'tee' || m.metadata.hole !== sourceHole.n || m.metadata.activeIndex !== index ||
              m.metadata.teeName !== m.tee || m.metadata.rangefinderTee !== m.tee || m.metadata.metres !== sourceHole.t[index]) issues.push('Selected metadata differs from the source tee');
          if (m.metadata.railMetres !== `${sourceHole.t[index]} M`) issues.push('Rail distance differs from selected tee');
          if (!m.metadata.cardLine.includes(`Par ${sourceHole.par}`) || !m.metadata.cardLine.includes(`Index ${sourceHole.idx}`)) issues.push('Displayed par/index differs from the source card');
          if (!m.strategy || distance(m.strategy.origin, sourcePoint) > 0.00001) issues.push('Strategy origin differs from the selected source reference');
          if (sourceHole.par <= 3) {
            const target = sourceHole.green?.c || sourceHole.line.at(-1);
            m.par3Strategy = m.strategy ? {
              directMetres: distance(sourcePoint, m.strategy.primary),
              labelledMetres: m.strategy.primaryDistance,
              distanceErrorMetres: Math.abs(m.strategy.primaryDistance - distance(sourcePoint, m.strategy.primary)),
              greenCentreResidualMetres: distance(m.strategy.primary, target),
              zoneDistanceErrorMetres: Math.abs((m.strategy.zones[0]?.distance ?? Infinity) - distance(sourcePoint, m.strategy.primary)),
            } : null;
            if (!m.par3Strategy || m.par3Strategy.distanceErrorMetres > 0.00001 || m.par3Strategy.greenCentreResidualMetres > 0.00001 || m.par3Strategy.zoneDistanceErrorMetres > 0.00001) issues.push('Par-3 strategy does not target the green directly from the selected tee');
          }
          const search = new URLSearchParams(m.metadata.url), urlTee = search.has('tee') ? +search.get('tee') - 1 : row.boot.defaultTeeIndex;
          if (+search.get('hal') !== sourceHole.n || urlTee !== index) issues.push('Deep link differs from selected hole/tee');
          m.issues = issues;
          row.selections.push(m);
        }
        console.log(JSON.stringify({ mode, reviewedHole: sourceHole.n, selections: row.selections.length }));
        save();
      }
      // Capture the course before activating synthetic GPS, so screenshots have
      // no retained ball, rangefinder state or GPS-stop toast from the checks.
      for (const [hole, teeIndex, view] of [[10, 0, 'tee'], [11, 0, 'top'], [14, 5, 'tee'], [17, 5, 'top']]) {
        await page.evaluate(({ hole, teeIndex, view }) => { V3D.goHole(hole, true, true); document.querySelectorAll('#tees .tee')[teeIndex].click(); V3D.setCam(view, true); }, { hole, teeIndex, view });
        await page.waitForFunction(() => V3D.settled(), null, { timeout: 90000 });
        const state = await page.evaluate(() => ({ caddie: V3D.caddie(), rangefinder: V3D.rangefinder(), camera: V3D.camExact() }));
        if (state.caddie.gps.active || state.caddie.gps.point || state.caddie.kik.on || state.caddie.kik.ball || state.caddie.kik.point || state.rangefinder.fromGps) row.issues.push(`H${hole} screenshot contains active GPS/rangefinder state`);
        const file = path.join(SHOTS, `${mode}-h${hole}-tee${course.tees.names[teeIndex]}-${view}.png`);
        await page.screenshot({ path: file });
        row.screenshots.push({ hole, tee: course.tees.names[teeIndex], view, state, file: rel(file), sha256: sha(fs.readFileSync(file)) });
      }
      // Exercise the production GPS handler separately, avoiding follow-mode
      // camera movement during the tee camera/DOM loop above.
      await page.evaluate(() => { document.getElementById('gpsBtn').click(); if (V3D.caddie().gps.follow) document.getElementById('gpsFollowBtn').click(); });
      for (const p of projected) {
        const gps = await page.evaluate(({ hole, coordinate }) => {
          V3D.goHole(hole, false, true);
          window.__teeReviewGpsPublish({ longitude: coordinate[0], latitude: coordinate[1] });
          return { ...V3D.caddie().gps, recognizedHole: V3D.flightState().hole, rangefinderOrigin: V3D.rangefinder().origin, fromGps: V3D.rangefinder().fromGps };
        }, { hole: p.hole, coordinate: p.wgs84LongitudeLatitude });
        const measurement = row.selections.find(s => s.hole === p.hole && s.teeIndex === p.teeIndex);
        measurement.gps = { epsg3006: p.epsg3006, wgs84LongitudeLatitude: p.wgs84LongitudeLatitude, received: gps,
          horizontalResidualMetres: gps.point ? distance(gps.point, p.local) : null };
        if (!gps.active || !gps.point || measurement.gps.horizontalResidualMetres > 0.01 || !gps.fromGps || distance(gps.rangefinderOrigin, p.local) > 0.01) measurement.issues.push('Actual GPS conversion/rangefinder does not recover the canonical reference');
      }
      await page.evaluate(() => { document.getElementById('gpsStopBtn').click(); if (V3D.caddie().kik.on) document.getElementById('rangeBtn').click(); });
      row.summary = { selections: row.selections.length, gpsFixes: row.selections.filter(s => s.gps).length,
        par3StrategyChecks: row.selections.filter(s => s.par3Strategy).length,
        maximumPar3StrategyDistanceErrorMetres: Math.max(...row.selections.filter(s => s.par3Strategy).map(s => s.par3Strategy.distanceErrorMetres)),
        maximumCameraHorizontalResidualMetres: Math.max(...row.selections.map(s => s.residuals.settledCameraHorizontalMetres)),
        maximumCameraEyeHeightErrorMetres: Math.max(...row.selections.map(s => s.residuals.settledEyeHeightMetres)),
        maximumGpsHorizontalResidualMetres: Math.max(...row.selections.map(s => s.gps?.horizontalResidualMetres ?? Infinity)),
        gpsAutomaticHoleDifferences: row.selections.filter(s => s.gps?.received.recognizedHole !== s.hole).map(s => ({ hole: s.hole, tee: s.tee, recognizedHole: s.gps?.received.recognizedHole })),
        failingSelections: row.selections.filter(s => s.issues.length).length, pageErrors: row.errors.length };
      row.passed = row.selections.length === 108 && !row.summary.failingSelections && !row.errors.length && !row.issues.length;
      console.log(JSON.stringify({ mode, passed: row.passed, summary: row.summary, issues: row.issues }));
    } catch (error) { row.issues.push(String(error)); console.error(`${mode}: ${error.message}`); }
    finally { await context.close(); save(); }
  }
} finally { await browser.close(); }
if (sha(fs.readFileSync(MODEL_FILE)) !== report.inputs.modelSha256 || sha(fs.readFileSync(packFile)) !== packSha256) report.issues.push('Model or pack changed during the browser review');
report.completedAt = new Date().toISOString();
report.passed = !report.issues.length && report.modes.length === MODES.length && report.modes.every(m => m.passed);
save();
console.log(JSON.stringify({ report: rel(OUT), passed: report.passed, modes: report.modes.map(m => ({ mode: m.mode, passed: m.passed, summary: m.summary, issues: m.issues })), issues: report.issues }, null, 2));
if (!report.passed) process.exitCode = 1;
