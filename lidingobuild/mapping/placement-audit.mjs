/* Browser regression for source-only placement policies. Run against the
 * current app build; --baseline records the pre-fix behaviour without gating. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:8634';
const baseline = process.argv.includes('--baseline');
const out = path.join(root, 'lidingobuild/cache/placement-audit');
fs.mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = [], requests = [];
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
let report;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('response', response => {
    if (/courses\/lidingo|grounds\/lidingo/.test(response.url())) requests.push({ url: response.url(), status: response.status() });
  });
  const url = `${base.replace(/\/$/, '')}/?bana=lidingo&v2=require&det=1&ljus=dag`;
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  const state = await page.evaluate(() => {
    const V = window.V3D, M = V.M;
    return {
      stats: V.stats, terrain: V.v2Terrain(), trees: V.legacyTrees(), roadDraping: V.roadDraping?.() ?? null,
      policies: { objects: M.infra.objectPlacement, terrain: M.infra.terrainPlacement, vegetation: M.infra.vegetationPlacement },
      mapped: { buildings: M.infra.buildings.length, paths: M.infra.paths.length, tracks: M.infra.tracks.length,
        roads: M.infra.roads.length, parking: M.infra.parking.length, bridges: (M.infra.bridges || []).length,
        facilities: (M.scenery.mappedFeatures || []).map(f => ({ id: f.id, kind: f.kind })),
        rangeRings: M.scenery.range.length, rangeFacilities: M.scenery.rangeFacilities,
        cartPark: M.scenery.cartPark, water: V.waterLevels() },
    };
  });
  const checks = [
    { ok: errors.length === 0, label: 'no-browser-exceptions', details: errors },
    { ok: state.policies.objects === 'mapped-only' && state.policies.vegetation === 'measured-only', label: 'source-placement-policies-active' },
    { ok: ['tufts', 'bushes', 'stones', 'stumps', 'reeds'].every(key => state.stats[key] === 0), label: 'no-unobserved-procedural-ground-cover',
      details: Object.fromEntries(['tufts', 'bushes', 'stones', 'stumps', 'reeds'].map(key => [key, state.stats[key]])) },
    { ok: state.stats.inferredRangeTargets === 0, label: 'no-inferred-range-target-flags', details: state.stats.inferredRangeTargets ?? 'counter-unavailable' },
    { ok: state.stats.cars === 0, label: 'no-inferred-parking-occupancy', details: state.stats.cars },
    { ok: Array.isArray(state.roadDraping) && state.roadDraping.length > 0 && state.roadDraping.every(proof =>
        proof.vertices > 0 && proof.syntheticGrading === false && proof.expectedOffsetMetres === .03 &&
        Number.isFinite(proof.maximumOffsetErrorMetres) && proof.maximumOffsetErrorMetres < .002),
      label: 'submitted-road-vertices-follow-their-own-ground-samples', details: state.roadDraping },
    { ok: state.trees.total > 0 && state.trees.reasons.v2Stand === state.trees.total && state.trees.legacyInsideCoverage === 0,
      label: 'measured-stand-representatives-retained', details: state.trees.reasons },
  ];
  const screenshots = [];
  for (const hole of [12, 18]) {
    await page.evaluate(hole => { window.V3D.goHole(hole, false, true); window.V3D.setCam('green', true); }, hole);
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
    const relative = `lidingobuild/cache/placement-audit/${baseline ? 'baseline' : 'review'}-hole-${hole}.png`;
    await page.screenshot({ path: path.join(root, relative) });
    screenshots.push(relative);
  }
  report = { schemaVersion: 1, groundId: 'lidingo', observedAt: new Date().toISOString(), url,
    mode: baseline ? 'baseline-before-placement-policy-fix' : 'placement-policy-regression',
    status: checks.every(c => c.ok) ? 'passed' : 'failed', checks, state, requests, screenshots,
    inspectedSourceFiles: ['apps/golf/src/main.js', 'lidingobuild/course-model.json'].map(p => ({ path: p, sha256: hash(fs.readFileSync(path.join(root, p))) })),
    limitations: ['Source-preservation and placement-policy audit, not current survey approval.',
      'Canopy trees are representatives from 2021 stand cells, not measured individual stems.',
      'Building dimensions and facility identities require their separate evidence review.'] };
} finally { await browser.close(); }
const destination = baseline ? path.join(out, 'baseline.json') : path.join(root, 'lidingobuild/mapping/placement-audit.json');
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: path.relative(root, destination), checks: report.checks }, null, 2));
if (!baseline && report.status !== 'passed') process.exitCode = 1;
