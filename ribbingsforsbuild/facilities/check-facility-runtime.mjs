#!/usr/bin/env node
/* Real-browser facility loading, alignment and fallback checks for Ribbingsfors.
 * Uses an owned headless Chrome context; never attaches to the user's browser.
 *   BANVY_GPU=1 node ribbingsforsbuild/facilities/check-facility-runtime.mjs [base-url]
 *     [--baseline] [--fallback] [--gl]
 * Baseline requests the source-building view for direct comparison; fallback
 * blocks the GLB so the retained buildings must all come back. */
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
const out = path.join(ROOT, 'ribbingsforsbuild/cache/facilities-runtime', variant);
fs.mkdirSync(out, { recursive: true });
const url = new URL('?bana=ribbingsfors&hal=1&vy=fritt&ljus=dag&det=1', base);
if (baseline) url.searchParams.set('buildingGeometry', 'source');
if (gl) url.searchParams.set('gl', '1');
const checks = [], errors = [], consoleErrors = [], requests = [], screenshots = [];
const gate = (ok, message, detail) => checks.push({ ok: Boolean(ok), message, ...(detail === undefined ? {} : { detail }) });
const report = { schemaVersion: 1, groundId: 'ribbingsfors', variant, url: url.href, startedAt: new Date().toISOString() };
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/models/ribbingsfors/facilities-v1.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  if (fallback) await context.route('**/models/ribbingsfors/facilities-*.glb*', route => route.abort('failed'));
  const page = await context.newPage();
  await page.routeWebSocket('**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000)); });
  page.on('response', response => {
    if (/models\/ribbingsfors\//.test(response.url())) requests.push({ url: response.url(), status: response.status() });
  });
  console.log(`Opening Ribbingsfors ${variant}.`);
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  const bootProgress = setInterval(() => {
    page.locator('#bmsg').textContent({ timeout: 5000 }).then(message => {
      if (message) console.log(`Ribbingsfors boot: ${message}`);
    }).catch(() => {});
  }, 30000);
  try {
    await page.waitForSelector('#boot.done', { timeout: 420000 });
  } finally { clearInterval(bootProgress); }
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  report.state = await page.evaluate(() => ({ course: V3D.course(), renderer: V3D.rendererInfo(),
    stats: V3D.stats, geometry: V3D.facilityGeometry(), terrain: V3D.v2Terrain(), camera: V3D.cameraInfo() }));
  const state = report.state;
  gate(state.course.slug === 'ribbingsfors', 'The requested Ribbingsfors course booted');
  gate(state.stats.backend === (gl ? 'webgl2' : 'webgpu'), 'The requested renderer is active');
  const replaced = manifest.facilities.filter(f => f.sourceBuildingId).map(f => f.sourceBuildingId);
  const suppressed = manifest.suppressedSourceBuildingIds.map(entry => entry.id);
  if (baseline || fallback) {
    gate(!state.geometry, 'No authored architecture is attached in the baseline or failure view');
    gate([...replaced, ...suppressed].every(id => state.stats.sourceBuildingBatchIds.includes(id)),
      'Every replaced and suppressed source building is back in the generic batch');
    if (fallback) gate(state.stats.facilities?.status === 'fallback', 'A failed GLB request uses the generic fallback');
  } else {
    report.asset = manifest.asset;
    const installed = state.stats.facilities;
    gate(installed?.status === 'loaded', 'The complete authored facility asset loaded', installed?.reason);
    gate(installed?.assetSha256 === manifest.asset.sha256 && state.geometry?.assetSha256 === manifest.asset.sha256,
      'The browser rendered the exact exported asset checksum');
    gate([...replaced, ...suppressed].every(id => installed?.replacedBuildingIds.includes(id))
      && installed?.replacedBuildingIds.length === replaced.length + suppressed.length,
    'Every replaced and suppressed source building is owned exactly once');
    gate([...replaced, ...suppressed].every(id => !state.stats.sourceBuildingBatchIds.includes(id)),
      'Replaced and suppressed source buildings are absent from the generic geometry batch');
    gate(state.geometry?.facilities.length === manifest.facilities.length
      && manifest.facilities.every(f => state.geometry.facilities.filter(node => node.id === f.id).length === 1),
    'Every manifest facility has one live scene node');
    gate(state.stats.authoredRangeFacilities === true, 'The authored range fixtures own the range');
    const roofs = manifest.facilities.filter(f => f.sourceFeatureId && f.kind === 'roof' && f.footprintLocal);
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
      return facilities.map(f => ({ id: f.id, treeTrunksInside: trees.filter(t => inside(t[0], t[2], f.footprintLocal)).length }));
    }, roofs);
    gate(roofTreeCollisions.every(f => f.treeTrunksInside === 0),
      'New roof interiors contain no rendered tree trunks', roofTreeCollisions.filter(f => f.treeTrunksInside));
    const placement = installed?.facilities.map(f => {
      const bounds = state.geometry?.facilities.find(node => node.id === f.id);
      return { id: f.id, mode: f.mode, shift: f.shift, groundResidualMetres: f.groundResidualMetres,
        heightShiftErrorMetres: bounds ? Math.abs(bounds.min[1] - f.boundsBeforePlacement.min[1] - f.shift) : null,
        horizontalErrorMetres: bounds ? Math.max(Math.abs(bounds.min[0] - f.boundsBeforePlacement.min[0]),
          Math.abs(bounds.min[2] - f.boundsBeforePlacement.min[2])) : null };
    }) ?? [];
    gate(placement.length === manifest.facilities.length && placement.every(p => p.heightShiftErrorMetres !== null
      && p.heightShiftErrorMetres < 1e-5 && p.horizontalErrorMetres < 1e-5),
    'Live geometry keeps horizontal coordinates and receives one vertical placement', placement.slice(0, 5));
    // The grid frame carries absolute RH2000: on the v2 ground nothing may move.
    gate(!state.terrain?.ready || placement.every(p => p.mode === 'absolute-rh2000' && Math.abs(p.shift) < 1e-6),
      'Absolute RH2000 heights receive a zero bridge on the 1 m ground', placement.filter(p => Math.abs(p.shift) >= 1e-6));
    report.groundResiduals = placement.map(p => p.groundResidualMetres);
    gate(placement.every(p => Math.abs(p.groundResidualMetres) < .6),
      'Every facility anchor sits within 0.6 m of the visible ground', placement.filter(p => Math.abs(p.groundResidualMetres) >= .6));
    gate(requests.some(r => /facilities-[a-f0-9]{64}\.glb/.test(r.url) && r.status === 200), 'The GLB was fetched successfully');
  }
  console.log(`Ribbingsfors ${variant} booted; facilities ${state.stats.facilities?.status ?? 'source view'}.`);
  const poses = [
    { id: 'campus-overview', position: [560, 125, -380], target: [500, 78, -470] },
    { id: 'clubhouse-terrace', position: [515, 86, -418], target: [482, 79, -457] },
    { id: 'clubhouse-west', position: [446, 86, -422], target: [480, 79, -457] },
    { id: 'range-bays', position: [608, 92, -400], target: [648, 78, -436] },
    { id: 'manor', position: [560, 100, -470], target: [520, 78, -532] },
    { id: 'maintenance', position: [-290, 100, 240], target: [-350, 82, 185] },
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
    'Clubhouse, range, manor and maintenance camera targets are visible');
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
