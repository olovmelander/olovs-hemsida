#!/usr/bin/env node
/* Owned-browser range review. BANVY_GPU=1 node ... [--before] [--gl].
   Before captures are deliberately frozen before the next model export. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = process.argv.includes('--before'), gl = process.argv.includes('--gl');
const variant = `${before ? 'before' : 'after'}${gl ? '-webgl' : ''}`;
const out = path.join(ROOT, 'visbybuild/cache/range-refinement', variant);
if (before && fs.existsSync(path.join(out, 'report.json'))) throw new Error('The range before review is already frozen.');
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/models/visby/facilities-v1.json'), 'utf8'));
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:5173/';
const url = new URL('?bana=visby&hal=1&vy=fritt&ljus=dag&det=1', base);
if (gl) url.searchParams.set('gl', '1');
const report = { schemaVersion: 1, groundId: 'visby', variant, startedAt: new Date().toISOString(), asset: manifest.asset };
const checks = [], errors = [], screenshots = [];
const gate = (ok, message, detail) => checks.push({ ok: Boolean(ok), message, ...(detail === undefined ? {} : { detail }) });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.routeWebSocket('**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  const heartbeat = setInterval(() => page.locator('#bmsg').textContent({ timeout: 5000 })
    .then(message => console.log(`Range boot: ${message}`)).catch(() => {}), 30000);
  try { await page.waitForSelector('#boot.done', { timeout: 420000 }); }
  finally { clearInterval(heartbeat); }
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  report.state = await page.evaluate(async facilities => {
    const visby = await import('/src/engine/scenery/visby.js');
    const trees = V3D.legacyTrees({ instances: true }).instances;
    const inside = (x, z, ring) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[j];
        if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
      }
      return hit;
    };
    return { course: V3D.course(), stats: V3D.stats, geometry: V3D.facilityGeometry(),
      field: visby.reviewedRangeSurface ?? null,
      rangeFeatures: facilities.filter(f => /range|530655627/.test(f.id)).map(f => ({
        id: f.id, footprintLocal: f.footprintLocal ?? null,
        // Broad old feature envelopes are observations, never clearing polygons.
        observedTreeTrunksInEnvelope: f.footprintLocal ? trees.filter(t => inside(t[0], t[2], f.footprintLocal)).map(t => [t[0], t[1], t[2]]) : []
      })),
      treeTrunksInReviewedOpenGround: visby.isRangeOpenGround ? trees.filter(t => visby.isRangeOpenGround(t[0], t[2])).map(t => [t[0], t[1], t[2]]) : null,
      rangeGroundProbes: [[-300, 35], [-263, -55], [-220, -130], [-297, 105]].map(([x, z]) => ({ x, z, probe: V3D.probeGround(x, z) })),
    };
  }, manifest.facilities);
  gate(report.state.course.slug === 'visby', 'Visby range loaded');
  gate(report.state.stats.backend === (gl ? 'webgl2' : 'webgpu'), 'Requested renderer active');
  gate(report.state.stats.facilities?.status === 'loaded' && report.state.geometry?.assetSha256 === manifest.asset.sha256,
    'Exact exported range asset rendered');
  const features = report.state.rangeFeatures;
  gate(features.every(f => report.state.geometry.facilities.filter(node => node.id === f.id).length === 1), 'Every range feature has one live node');
  gate(report.state.stats.inferredRangeTargets === 0, 'No generic procedural range targets');
  if (!before && report.state.field) {
    gate(report.state.treeTrunksInReviewedOpenGround.length === 0, 'Reviewed open range and hitting surfaces contain no display tree trunks', report.state.treeTrunksInReviewedOpenGround);
  }
  const poses = [
    { id: 'range', position: [-385, 31, 151], target: [-308, 7, 71] },
    { id: 'range-wide', position: [-417, 125, 185], target: [-261, 4, -22] },
    { id: 'firing-line', position: [-309, 13, 159], target: [-288, 4, 96] },
    { id: 'west-shelter', position: [-349, 11, 112], target: [-329, 5, 80] },
    { id: 'east-net', position: [-136, 23, 107], target: [-208, 4, 21] },
    { id: 'downrange', position: [-184, 17, -220], target: [-280, 4, 68] },
  ];
  report.cameras = [];
  for (const pose of poses) {
    await page.evaluate(p => { V3D.setPreset('noon'); V3D.setView(...p.position, ...p.target); }, pose);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => V3D.settled(), null, { timeout: 120000 });
    report.cameras.push({ ...pose, camera: await page.evaluate(p => ({ ...V3D.cameraInfo(), targetProjected: V3D.project(...p.target) }), pose) });
    const filename = path.join(out, `${pose.id}.png`);
    await page.screenshot({ path: filename, animations: 'disabled', timeout: 120000 });
    screenshots.push(path.relative(ROOT, filename).replaceAll('\\', '/'));
    console.log(`Captured ${variant}/${pose.id}.`);
  }
  gate(report.cameras.every(c => c.camera.targetProjected.visible), 'All range camera targets visible');
  gate(errors.length === 0, 'No uncaught browser errors', errors);
} catch (error) { report.error = error.stack; gate(false, 'Range review completed', error.message); }
finally { await browser.close(); }
Object.assign(report, { completedAt: new Date().toISOString(), status: checks.every(c => c.ok) ? 'passed' : 'failed', checks, errors, screenshots });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks, report: path.relative(ROOT, path.join(out, 'report.json')) }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
