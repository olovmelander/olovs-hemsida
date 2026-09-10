#!/usr/bin/env node
/* Real-browser facility loading, alignment and fallback checks. Uses an owned
 * headless Chrome context; never attaches to the user's open browser.
 * BANVY_GPU=1 node visbybuild/facilities/check-facility-runtime.mjs [base-url]
 *   [--baseline] [--fallback] [--gl]
 * Baseline requests the existing source-building view for direct comparison. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = process.argv.includes('--baseline'), fallback = process.argv.includes('--fallback');
const gl = process.argv.includes('--gl');
const variant = `${baseline ? 'baseline' : fallback ? 'fallback' : 'authored'}-${gl ? 'webgl' : 'webgpu'}`;
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:5173/';
const out = path.join(ROOT, 'visbybuild/cache/facilities-runtime', variant);
fs.mkdirSync(out, { recursive: true });
const url = new URL('?bana=visby&hal=1&vy=fritt&ljus=dag&det=1', base);
if (baseline) url.searchParams.set('buildingGeometry', 'source');
if (gl) url.searchParams.set('gl', '1');
const checks = [], errors = [], consoleErrors = [], requests = [], screenshots = [];
const gate = (ok, message, detail) => checks.push({ ok: Boolean(ok), message, ...(detail === undefined ? {} : { detail }) });
const report = { schemaVersion: 1, groundId: 'visby', variant, url: url.href, startedAt: new Date().toISOString() };
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  if (fallback) await context.route('**/models/visby/facilities-v1.glb*', route => route.abort('failed'));
  const page = await context.newPage();
  // Vite otherwise reloads this heavy course while source/reference files are
  // being exported elsewhere in the workspace. Keep this one audit stable.
  await page.routeWebSocket('**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000)); });
  page.on('response', response => {
    if (/models\/visby\//.test(response.url())) requests.push({ url: response.url(), status: response.status() });
  });
  console.log(`Opening Visby ${variant}.`);
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  const bootProgress = setInterval(() => {
    page.locator('#bmsg').textContent({ timeout: 5000 }).then(message => {
      if (message) console.log(`Visby boot: ${message}`);
    }).catch(() => {});
  }, 30000);
  try {
    await page.waitForSelector('#boot.done', { timeout: 420000 });
  } finally { clearInterval(bootProgress); }
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  report.state = await page.evaluate(() => ({ course: V3D.course(), renderer: V3D.rendererInfo(),
    stats: V3D.stats, geometry: V3D.facilityGeometry(), terrain: V3D.v2Terrain(), camera: V3D.cameraInfo() }));
  const state = report.state;
  gate(state.course.slug === 'visby', 'The requested Visby course booted');
  gate(state.stats.backend === (gl ? 'webgl2' : 'webgpu'), 'The requested renderer is active');
  if (baseline || fallback) {
    gate(!state.geometry, 'No authored architecture is attached in the baseline or failure view');
    gate(state.stats.sourceBuildingBatchIds.includes('way/530655631'), 'The source clubhouse remains in the generic batch');
    if (fallback) gate(state.stats.facilities?.status === 'fallback', 'A failed GLB request uses the generic fallback');
  } else {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/models/visby/facilities-v1.json'), 'utf8'));
    report.asset = manifest.asset;
    const installed = state.stats.facilities;
    gate(installed?.status === 'loaded', 'The complete authored facility asset loaded', installed?.reason);
    gate(installed?.assetSha256 === manifest.asset.sha256 && state.geometry?.assetSha256 === manifest.asset.sha256,
      'The browser rendered the exact exported asset checksum');
    const buildingIds = manifest.facilities.filter(f => f.sourceBuildingId).map(f => f.sourceBuildingId);
    gate(buildingIds.every(id => installed?.replacedBuildingIds.includes(id))
      && installed?.replacedBuildingIds.length === buildingIds.length,
    'Every modeled source building has exactly one replacement');
    gate(buildingIds.every(id => !state.stats.sourceBuildingBatchIds.includes(id)),
      'Replaced source buildings are absent from the generic geometry batch');
    gate(state.geometry?.facilities.length === manifest.facilities.length
      && manifest.facilities.every(f => state.geometry.facilities.filter(node => node.id === f.id).length === 1),
    'Every manifest facility has one live scene node');
    gate(manifest.facilities.filter(f => f.sourceLandmarkId).every(f => installed?.replacedLandmarkIds.includes(f.sourceLandmarkId)),
      'The authored lighthouse owns the old procedural lighthouse replacement');
    const structureFootprints = manifest.facilities.filter(f => f.sourceFeatureId
      && /(?:building|shelter|service|shed)/.test(f.sourceFeatureId)
      && !/(?:mats|net)/.test(f.sourceFeatureId) && f.footprintLocal);
    const roofTreeCollisions = await page.evaluate(facilities => {
      const trees = V3D.legacyTrees({ instances: true }).instances;
      const inside = (x, z, ring) => {
        let contained = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [ax, az] = ring[i], [bx, bz] = ring[j];
          if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) contained = !contained;
        }
        return contained;
      };
      return facilities.map(f => ({ id: f.id,
        treeTrunksInside: trees.filter(t => inside(t[0], t[2], f.footprintLocal)).length }));
    }, structureFootprints);
    gate(roofTreeCollisions.every(f => f.treeTrunksInside === 0),
      'New structure interiors contain no rendered tree trunks', roofTreeCollisions);
    const placement = installed?.facilities.map(f => {
      const bounds = state.geometry?.facilities.find(node => node.id === f.id);
      return { id: f.id, mode: f.mode, shift: f.shift, groundResidualMetres: f.groundResidualMetres,
        heightShiftErrorMetres: bounds ? Math.abs(bounds.min[1] - f.boundsBeforePlacement.min[1] - f.shift) : null,
        horizontalErrorMetres: bounds ? Math.max(Math.abs(bounds.min[0] - f.boundsBeforePlacement.min[0]),
          Math.abs(bounds.min[2] - f.boundsBeforePlacement.min[2])) : null };
    }) ?? [];
    gate(placement.length === manifest.facilities.length && placement.every(p => p.heightShiftErrorMetres !== null
      && p.heightShiftErrorMetres < 1e-5 && p.horizontalErrorMetres < 1e-5),
    'Live geometry keeps horizontal coordinates and receives one vertical placement', placement);
    gate(requests.some(r => /facilities-v1\.glb/.test(r.url) && r.status === 200), 'The GLB was fetched successfully');
  }
  console.log(`Visby ${variant} booted; facilities ${state.stats.facilities?.status ?? 'source view'}.`);
  const poses = [
    { id: 'facility-overview', position: [-687, 96, 336], target: [-490, 7, 178] },
    { id: 'clubhouse-seaward', position: [-576, 21, 265], target: [-521, 7, 206] },
    { id: 'clubhouse-entrance', position: [-467, 22, 162], target: [-522, 7, 207] },
    { id: 'lighthouse', position: [-650, 18, 236], target: [-601, 8, 199] },
    { id: 'range', position: [-385, 31, 151], target: [-308, 7, 71] },
  ];
  report.cameras = [];
  for (const pose of poses) {
    await page.evaluate(p => { V3D.setPreset('noon'); V3D.setView(...p.position, ...p.target); }, pose);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
    const camera = await page.evaluate(p => ({ ...V3D.cameraInfo(), targetProjected: V3D.project(...p.target) }), pose);
    report.cameras.push({ ...pose, camera });
    const filename = path.join(out, `${pose.id}.png`);
    await page.screenshot({ path: filename, animations: 'disabled', timeout: 120000 });
    screenshots.push(path.relative(ROOT, filename).replaceAll('\\', '/'));
    console.log(`Captured ${variant}/${pose.id}.`);
  }
  gate(report.cameras.every(c => c.camera.position.every(Number.isFinite) && c.camera.targetProjected.visible),
    'Clubhouse, lighthouse and range camera targets are visible');
  gate(errors.length === 0, 'No uncaught browser errors during loading or camera review', errors);
} catch (error) {
  report.error = error.stack;
  gate(false, 'Browser audit completed', error.message);
} finally {
  await browser.close();
}
Object.assign(report, { completedAt: new Date().toISOString(), status: checks.every(c => c.ok) ? 'passed' : 'failed',
  checks, errors, consoleErrors, requests, screenshots });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, variant,
  checks: checks.map(({ ok, message, detail }) => ({ ok, message, ...(!ok ? { detail } : {}) })),
  report: path.relative(ROOT, path.join(out, 'report.json')) }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
