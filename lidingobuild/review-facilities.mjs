/* Source-identity, surface and close-view review of the implemented facilities. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../tools/browser-args.mjs';
import { centroid, pointInPoly } from '../geobuild/lib.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
const base = (process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:8634').replace(/\/$/, '');
const model = JSON.parse(fs.readFileSync(new URL('./course-model.json', import.meta.url)));
const output = new URL('./cache/facility-review/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
let report;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/?bana=lidingo&ljus=dag&det=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  const probes = model.scenery.mappedFeatures.filter(f => f.kind === 'practice_green' || f.kind === 'paved_path').map(f => {
    const ring = f.rings[0], bounds = [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
    const candidates = [centroid(ring)];
    for (let x = bounds[0] + 1; x < bounds[2]; x += 1) for (let z = bounds[1] + 1; z < bounds[3]; z += 1) candidates.push([x, z]);
    return { id: f.id, expectedSurface: f.kind === 'practice_green' ? SURFACE.GREEN : SURFACE.GRAVEL,
      points: candidates.filter(p => pointInPoly(...p, ring) && !f.rings.slice(1).some(r => pointInPoly(...p, r))) };
  });
  const state = await page.evaluate(probes => {
    const V = window.V3D;
    return { facilities: V.M.scenery.mappedFeatures, parking: V.M.infra.parking, stats: V.stats, terrain: V.v2Terrain(),
      probes: probes.map(p => ({ id: p.id, expectedSurface: p.expectedSurface,
        matches: p.points.filter(q => V.groundSample(...q)?.surface === p.expectedSurface).length,
        totalInteriorPoints: p.points.length })) };
  }, probes);
  const checks = [
    { ok: errors.length === 0, message: 'No browser exceptions', errors },
    { ok: state.terrain.ready && state.terrain.selection.defaulted === true && state.terrain.renderer.meshResolutionMetres === 1,
      message: 'Plain Lidingö URL selects the measured 1 m graph by default' },
    { ok: JSON.stringify(state.facilities) === JSON.stringify(model.scenery.mappedFeatures), message: 'Every facility ring and courtyard island survived the pack unchanged' },
    { ok: state.parking.length === 29 && state.parking.every(p => p.cars === false), message: '29 source parking areas, no inferred occupancy' },
    { ok: state.probes.every(p => p.matches > 0), message: 'Practice greens and hardstanding are visible in the active surface atlas', details: state.probes },
    { ok: state.stats.measuredRoofBuildings === 5 && state.stats.measuredRoofTriangles === 7069 && state.stats.genericRoofBuildings === 557,
      message: 'Five measured roof meshes replace their generic buildings' },
  ];
  const views = [
    { name: 'clubhouse', centre: centroid(model.infra.buildings.find(b => b.amenity === 'clubhouse').ring), offset: [90, 85, 125] },
    { name: 'range-buildings', centre: centroid(model.infra.buildings.find(b => b.id === 'way/26408210').ring), offset: [-130, 90, 105] },
  ];
  const screenshots = [];
  for (const view of views) {
    await page.evaluate(view => {
      const V = window.V3D, [x, z] = view.centre, h = V.terrainH(x, z);
      V.setPreset('noon');
      V.setView(x + view.offset[0], h + view.offset[1], z + view.offset[2], x, h + 3, z);
    }, view);
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('#boot') || Number(getComputedStyle(document.querySelector('#boot')).opacity) === 0, null, { timeout: 10000 });
    const relative = `lidingobuild/cache/facility-review/runtime-${view.name}.png`;
    await page.screenshot({ path: relative });
    screenshots.push(relative);
  }
  report = { schemaVersion: 1, groundId: 'lidingo', reviewedAt: new Date().toISOString(), baseUrl: base,
    status: checks.every(c => c.ok) ? 'passed' : 'failed',
    reviewBuildContext: { isolated: base.includes(':8638'), note: base.includes(':8638') ? 'Temporary review build excludes the unfinished Visby module; original shared source is preserved.' : null },
    modelSha256: createHash('sha256').update(fs.readFileSync(new URL('./course-model.json', import.meta.url))).digest('hex'),
    checks, screenshots, limitations: ['2019 surface observations and 2021 roof returns do not establish current as-built positions.', 'Two roof surfaces are incomplete; unknown parts remain open.'] };
} finally { await browser.close(); }
fs.writeFileSync(new URL('./mapping/facility-runtime-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
