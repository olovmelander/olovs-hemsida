#!/usr/bin/env node
/* Browser acceptance for any course with a reviewed v2 frontier contract.

   usage:
     node tools/serve.mjs apps/golf/dist 8620
     BANVY_GPU=1 node tools/check-course-v2.mjs [baseUrl] [--course <slug>]

   With no --course this gates EVERY slug in V2_GRAPH_FRONTIER_CONFIGS, which
   is the point: the registry is the list of courses claiming a reviewed live
   contract, so a course added there without its browser proof passing fails
   here rather than in front of someone.

   Both ordinary and historical opt-out links must serve v2 + Ghibli.
   The reviewed per-course contract still gates tile counts, bridges and cuts.
   Missing/corrupt terrain must fail visibly rather than select GPK1. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from '../apps/golf/src/engine/v2-frontier-configs.mjs';

const BASE = (process.argv.find(argument => /^https?:/.test(argument)) ||
  'http://127.0.0.1:8620').replace(/\/$/, '');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const requested = process.argv.includes('--course')
  ? process.argv[process.argv.indexOf('--course') + 1]
  : null;
const slugs = requested ? [requested] : Object.keys(V2_GRAPH_FRONTIER_CONFIGS).sort();
for (const slug of slugs) {
  if (!V2_GRAPH_FRONTIER_CONFIGS[slug]) {
    console.error(`no reviewed v2 frontier contract for ${slug}`);
    process.exit(1);
  }
}

const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : { channel: 'chrome' }),
  args: browserArgs(),
});

async function boot(search) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  await page.addInitScript(() => localStorage.setItem('banvy:ghibli-look', '0'));
  page.on('pageerror', error => errors.push(String(error).split('\n')[0].slice(0, 240)));
  await page.goto(`${BASE}/${search}`, { waitUntil: 'load', timeout: 120_000 });
  let booted = true;
  try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); }
  catch { booted = false; }
  const report = booted ? await page.evaluate(() => {
    const terrain = window.V3D.v2Terrain();
    return {
      terrain: {
        requested: terrain.requested,
        ready: terrain.ready,
        status: terrain.status,
        kind: terrain.kind,
        mode: terrain.selection.mode,
        requestMode: terrain.selection.requestMode,
        defaulted: terrain.selection.defaulted,
        surfaceRepresentation: terrain.surfaceRepresentation,
        surfacePolicy: terrain.surfacePolicy,
        renderer: terrain.renderer,
        bridge: terrain.bridge,
        sharedFrontierMaterial: terrain.sharedFrontierMaterial,
        boundaryBlendMetres: terrain.boundaryBlendMetres,
      },
      objects: window.V3D.v2Objects(),
      look: window.V3D.treeCatalogue().look,
      styleControls: document.querySelectorAll('#lookBtn, #dLookBtn').length,
    };
  }) : null;
  await page.close();
  return { booted, errors, report };
}

let failures = 0;
const gate = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures++;
};
const near = (value, expected, tolerance = 1e-6) =>
  Number.isFinite(value) && Math.abs(value - expected) <= tolerance;

for (const slug of slugs) {
  const config = V2_GRAPH_FRONTIER_CONFIGS[slug];
  console.log(`\n${slug} — ${config.label}`);
  const oldLink = await boot(`?bana=${slug}&det=1&v2=0&ghibli=0&look=real&ground=mesh&trees=procedural`);
  const plain = await boot(`?bana=${slug}&det=1`);

  gate(oldLink.booted && oldLink.errors.length === 0, 'historical visual-mode link boots without page errors');
  gate(oldLink.report?.terrain.ready === true && oldLink.report?.terrain.requestMode === 'require',
    'historical opt-out still serves verified v2');
  gate([oldLink, plain].every(run => run.report?.look === 'painted' && run.report?.styleControls === 0),
    'Ghibli is the sole style even with a saved realistic preference');

  const terrain = plain.report?.terrain;
  const renderer = terrain?.renderer;
  gate(plain.booted && plain.errors.length === 0, 'default v2 path boots without page errors');
  gate(terrain?.requested === true && terrain?.ready === true && terrain?.status === 'ready' &&
    terrain?.mode === 'fixed-frontier' && terrain?.requestMode === 'require' &&
    terrain?.defaulted === true,
    'the reviewed fixed frontier serves the flagless visit by default');
  /* A config that declares a published ring graph must be SERVED by it: the
     graph replaces the frontier renderer and the legacy CORE outright, so a
     boot that falls back to the fixed frontier is a regression even though
     every frontier assertion below would pass. That is exactly how a
     vegetation publish that stripped the tiles' parent links went unseen on
     two grounds: the world downgraded to the frontier and this gate agreed
     with the bug. The frontier assertions therefore apply only to a course
     whose contract has no ring graph, and a ring-graph course is asserted
     against its own reviewed ring shape instead. */
  const ring = config.ringGraph;
  if (ring) {
    gate(terrain?.kind === 'graph',
      'the published ring graph serves the world, not the frontier fallback');
    gate(renderer?.meshResolutionMetres === 1 && renderer?.tiles === ring.tiles &&
      renderer?.levels?.length === ring.levels,
      `${ring.tiles} tiles in ${ring.levels} levels reach the ${ring.rootSpanMetres / 1000} km root`);
    /* the graph adapter carries no surfacePolicy of its own; the atlas the
       course actually paints with is reported as surfaceRepresentation */
    gate(terrain?.surfaceRepresentation === config.surfacePolicy,
      `the reviewed surface policy (${config.surfacePolicy}) is in force`);
  } else {
    gate(terrain?.kind === 'fixed-frontier' && renderer?.meshResolutionMetres === 1 &&
      renderer?.renderedTiles === config.expectedTileCount && renderer?.drawCalls === 1,
      `${config.expectedTileCount} one-metre tiles render in one draw`);
    gate(terrain?.surfacePolicy === config.surfacePolicy,
      `the reviewed surface policy (${config.surfacePolicy}) is in force`);
    /* The seam: a fixed frontier is a square of 1 m tiles inside a legacy
       world, and the owner's phone showed the square (Ribbingsfors,
       2026-09-10) because the surroundings drew with the vertex-colour
       material while the tiles drew with the tinted one. Every fixed
       frontier must share the material, and a ground that has measured a
       height step at its edge must be blending it. */
    gate(terrain?.sharedFrontierMaterial === true,
      'the legacy surroundings draw with the frontier\'s own ground material');
    gate(terrain?.boundaryBlendMetres === (config.legacyBoundaryBlendMetres || 0),
      `the legacy heights blend onto the frontier edge over the reviewed ${config.legacyBoundaryBlendMetres || 0} m`);
  }

  /* The bridge is the part that puts the terrain in the right PLACE, so it is
     checked against the config's own declaration rather than against zero. */
  const bridge = terrain?.bridge;
  if (config.bridgeMode === 'wgs84-legacy-frame') {
    gate(Number.isFinite(bridge?.rotationRadians) && Math.abs(bridge.rotationRadians) > 1e-4 &&
      near(bridge?.translateY,
        config.canonicalOrigin.heightRH2000 + config.legacyFrame.verticalDatumOffsetMetres, 1e-6) &&
      bridge?.scaleX > 0.99 && bridge?.scaleX < 1.01,
      'the legacy-frame bridge carries its convergence rotation and measured vertical step');
  } else {
    gate(near(bridge?.translateX, 0) && near(bridge?.translateZ, 0) &&
      bridge?.rotationRadians === 0 && bridge?.scaleX === 1 && bridge?.scaleZ === 1,
      'the reviewed EPSG:3006 identity bridge is exact');
  }

  /* In graph service no legacy CORE is built at all, so the cutout contract
     is never reached -- it is the frontier-only fallback's contract, still
     asserted whenever that path serves. */
  const cutout = config.legacyCoreCutout;
  if (cutout && !ring) {
    gate(renderer?.skippedBasePoints === cutout.expectedSkippedBasePoints &&
      renderer?.totalBasePoints === cutout.expectedTotalBasePoints &&
      renderer?.removedTriangles > 0,
      'the reviewed legacy CORE omission is applied exactly');
  }

  /* Vegetation is optional: a ground publishes object and stand layers only
     once its LiDAR generation exists. Absent layers must be absent, not
     half-loaded, and must never leave two populations over one ground.

     THE DEAD-BOOT CASE HAS TO BE ITS OWN BRANCH, because otherwise this reads
     as a pass. A failed boot leaves `plain.report` null, so `objects` is
     undefined, `objects?.loaded` is falsy and the else below asks
     `objects?.error === undefined` -- which is TRUE of nothing at all. Visby
     printed "no v2 vegetation is published for this ground" beside five other
     failures while its ground manifest published 116 object and 256 stand
     tiles: the checker agreeing with the bug, for the fourth time in this
     repository. Nothing was measured, so nothing may be asserted. */
  const objects = plain.report?.objects;
  if (!plain.booted || !plain.report) {
    gate(false, 'the flagless boot completed, so its vegetation could be measured at all');
  } else if (objects?.loaded) {
    // A measured stand field does not imply a surveyed individual registry.
    // Gate each published layer against its own declared population.
    gate(objects.error === null &&
      objects.loaded.referencedObjectTiles === objects.graphObjectTiles &&
      objects.loaded.referencedStandTiles === objects.graphStandTiles &&
      (objects.loaded.records > 0 ? objects.planned?.individuals > 0 : objects.planned?.individuals === 0) &&
      (objects.graphStandTiles > 0 ? objects.planned?.standTrees > 0 : objects.planned?.standTrees === 0),
      'published vegetation layers verify, load and plant');
  } else {
    gate(objects?.error === null || objects?.error === undefined,
      'no v2 vegetation is published for this ground, and none is half-loaded');
  }

  for (const error of oldLink.errors.slice(0, 2)) console.log(`  historical link page error: ${error}`);
  for (const error of plain.errors.slice(0, 2)) console.log(`  flagless page error: ${error}`);
  if (renderer?.error) console.log(`  renderer: ${renderer.error}`);
}

await browser.close();
console.log(failures
  ? `\n${failures} course v2 browser gate(s) failed`
  : `\nv2 browser proof passed for ${slugs.join(', ')}`);
process.exit(failures ? 1 : 0);
