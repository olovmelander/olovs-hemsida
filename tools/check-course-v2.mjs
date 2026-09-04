#!/usr/bin/env node
/* Browser acceptance for any course with a reviewed v2 frontier contract.

   usage:
     node tools/serve.mjs apps/golf/dist 8620
     BANVY_GPU=1 node tools/check-course-v2.mjs [baseUrl] [--course <slug>]

   With no --course this gates EVERY slug in V2_GRAPH_FRONTIER_CONFIGS, which
   is the point: the registry is the list of courses claiming a reviewed live
   contract, so a course added there without its browser proof passing fails
   here rather than in front of someone.

   Each course is booted twice on purpose. A slug in this registry serves v2
   BY DEFAULT, so the ordinary flagless URL -- the one a visitor actually
   opens -- must complete the transactional preflight and legacy cut, then
   render the published metre terrain; and the explicit ?v2=0 opt-out must
   stay pure GPK1 -- a v2 chunk must not reach a visitor who declined it.
   (?v2=require's fail-closed semantics are unit-tested in
   v2-terrain-select.test.mjs; the serving path it proves in a browser is the
   same one the flagless boot takes here.) What is asserted per course comes
   from that course's own config, never from a literal here: the tile count,
   the bridge the config declares, and the exact legacy CORE omission it
   reviewed. */
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
const executablePath = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : { channel: 'chrome' }),
  args: browserArgs(),
});

async function boot(search) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
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
        mode: terrain.selection.mode,
        requestMode: terrain.selection.requestMode,
        defaulted: terrain.selection.defaulted,
        surfaceRepresentation: terrain.surfaceRepresentation,
        surfacePolicy: terrain.surfacePolicy,
        renderer: terrain.renderer,
        bridge: terrain.bridge,
      },
      objects: window.V3D.v2Objects(),
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
  const optOut = await boot(`?bana=${slug}&det=1&v2=0`);
  const plain = await boot(`?bana=${slug}&det=1`);

  gate(optOut.booted && optOut.errors.length === 0, '?v2=0 GPK1 path boots without page errors');
  gate(optOut.report?.terrain.requested === false && optOut.report?.terrain.mode === 'off',
    '?v2=0 opt-out does not request v2');
  gate(optOut.report?.objects.loaded === null && optOut.report?.objects.planned === null,
    '?v2=0 opt-out does not load or plant v2 vegetation');

  const terrain = plain.report?.terrain;
  const renderer = terrain?.renderer;
  gate(plain.booted && plain.errors.length === 0, 'default v2 path boots without page errors');
  gate(terrain?.requested === true && terrain?.ready === true && terrain?.status === 'ready' &&
    terrain?.mode === 'fixed-frontier' && terrain?.requestMode === 'opt-in' &&
    terrain?.defaulted === true,
    'the reviewed fixed frontier serves the flagless visit by default');
  gate(renderer?.meshResolutionMetres === 1 &&
    renderer?.renderedTiles === config.expectedTileCount && renderer?.drawCalls === 1,
    `${config.expectedTileCount} one-metre tiles render in one draw`);
  gate(terrain?.surfacePolicy === config.surfacePolicy,
    `the reviewed surface policy (${config.surfacePolicy}) is in force`);

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

  const cutout = config.legacyCoreCutout;
  if (cutout) {
    gate(renderer?.skippedBasePoints === cutout.expectedSkippedBasePoints &&
      renderer?.totalBasePoints === cutout.expectedTotalBasePoints &&
      renderer?.removedTriangles > 0,
      'the reviewed legacy CORE omission is applied exactly');
  }

  /* Vegetation is optional: a ground publishes object and stand layers only
     once its LiDAR generation exists. Absent layers must be absent, not
     half-loaded, and must never leave two populations over one ground. */
  const objects = plain.report?.objects;
  if (objects?.loaded) {
    gate(objects.error === null && objects.planned?.individuals > 0 &&
      objects.planned?.standTrees > 0,
      'published vegetation layers verify, load and plant');
  } else {
    gate(objects?.error === null || objects?.error === undefined,
      'no v2 vegetation is published for this ground, and none is half-loaded');
  }

  for (const error of optOut.errors.slice(0, 2)) console.log(`  ?v2=0 page error: ${error}`);
  for (const error of plain.errors.slice(0, 2)) console.log(`  flagless page error: ${error}`);
  if (renderer?.error) console.log(`  renderer: ${renderer.error}`);
}

await browser.close();
console.log(failures
  ? `\n${failures} course v2 browser gate(s) failed`
  : `\nv2 browser proof passed for ${slugs.join(', ')}`);
process.exit(failures ? 1 : 0);
