#!/usr/bin/env node
/* Browser acceptance for Ribbingsfors' reviewed fixed frontier.

   usage:
     node tools/serve.mjs apps/golf/dist 8620
     BANVY_GPU=1 node tools/check-ribbingsfors-v2.mjs [baseUrl]

   This intentionally boots both paths. Ribbingsfors serves v2 by default now
   (the frontier registry decides), so the pure-GPK1 proof runs on the
   explicit ?v2=0 opt-out; the required URL must complete the transactional
   GPU preflight and legacy cut, then expose the published 1 m terrain and
   vegetation evidence. The flagless default itself is gated by
   tools/check-course-v2.mjs. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const BASE = (process.argv.find(argument => /^https?:/.test(argument)) ||
  'http://127.0.0.1:8620').replace(/\/$/, '');
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
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
    const objects = window.V3D.v2Objects();
    return {
      terrain: {
        requested: terrain.requested,
        ready: terrain.ready,
        status: terrain.status,
        mode: terrain.selection.mode,
        requestMode: terrain.selection.requestMode,
        surfaceRepresentation: terrain.surfaceRepresentation,
        surfacePolicy: terrain.surfacePolicy,
        renderer: terrain.renderer,
        bridge: terrain.bridge,
      },
      objects,
      legacyInsideCoverage: window.V3D.legacyTrees().legacyInsideCoverage,
      tint: window.V3D.tintRefresh(),
      groundProbe: window.V3D.probeGround(0, 0),
      /* the lake: Skagern's bed under the frontier, and the one sheet that draws it */
      lakeBed: {
        open: window.V3D.waterBedAt(-100, -300),    /* open water in the north-east arm, 200 m off any shore */
        shore: window.V3D.waterBedAt(-100, -600),   /* nearer the arm's east bank */
        openGround: window.V3D.probeGround(-100, -300).h,
      },
      lakeSheets: window.V3D.waterSheets().filter(sheet => sheet.vertices > 5000),
      lakeRings: window.V3D.waterLevels().filter(body => body.isLake),
    };
  }) : null;
  await page.close();
  return { booted, errors, report };
}

const plain = await boot('?bana=ribbingsfors&det=1&v2=0');
const required = await boot('?bana=ribbingsfors&det=1&v2=require');
await browser.close();

let failures = 0;
const gate = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures++;
};
gate(plain.booted && plain.errors.length === 0, '?v2=0 GPK1 path boots without page errors');
gate(plain.report?.terrain.requested === false && plain.report?.terrain.mode === 'off',
  '?v2=0 opt-out does not request v2');
gate(plain.report?.objects.loaded === null && plain.report?.objects.planned === null,
  '?v2=0 opt-out does not load or plant v2 vegetation');

const terrain = required.report?.terrain;
const renderer = terrain?.renderer;
gate(required.booted && required.errors.length === 0, 'required v2 path boots without page errors');
gate(terrain?.requested === true && terrain?.ready === true && terrain?.status === 'ready' &&
  terrain?.mode === 'fixed-frontier' && terrain?.requestMode === 'require',
  'required fixed frontier is active');
gate(renderer?.meshResolutionMetres === 1 && renderer?.renderedTiles === 64 &&
  renderer?.drawCalls === 1 && renderer?.skippedBasePoints === 90_520 &&
  renderer?.removedTriangles > 0,
  '64 one-metre tiles replace the reviewed legacy CORE in one draw');
gate(terrain?.surfaceRepresentation === 'legacy-ground-atlas' &&
  terrain?.surfacePolicy === 'legacy-ground-atlas',
  'the complete GPK ground atlas remains the sole surface authority');
gate(required.report?.tint?.near?.n === 513 && required.report?.tint?.far?.n === 513 &&
  required.report?.tint?.near?.sampleSum > 0 && required.report?.tint?.far?.sampleSum > 0 &&
  required.report?.groundProbe?.tintNear?.length === 3 && required.report?.groundProbe?.tintFar?.length === 3,
  'fixed-frontier ground receives the same populated near/far tint contract as Puttom v2');
gate(terrain?.bridge?.translateX === 0 && terrain?.bridge?.translateZ === 0 &&
  terrain?.bridge?.translateY === 69.14 && terrain?.bridge?.rotationRadians === 0 &&
  terrain?.bridge?.scaleX === 1 && terrain?.bridge?.scaleZ === 1,
  'published EPSG:3006/RH2000 terrain uses the reviewed exact identity bridge');

const objects = required.report?.objects;
gate(objects?.error === null && objects?.loaded?.loadedTiles === 64 &&
  objects?.loaded?.referencedObjectTiles === 60 && objects?.loaded?.referencedStandTiles === 64,
  'all published vegetation layers verify and load');
gate(objects?.planned?.individuals > 0 && objects?.planned?.standTrees > 0 &&
  required.report?.legacyInsideCoverage === 0,
  'v2 trees plant and the legacy lattice is absent inside their coverage');

/* The lake. Three coplanar sheets and an uncarved laser surface used to draw
   Skagern as pale silt with a z-fight sawtooth (2026-09-05, owner's phone
   screenshots); the model now carries ONE Skagern ring and the frontier
   carves its bed as the tiles decode. */
const lake = required.report?.lakeBed;
gate(required.report?.lakeRings?.length === 1 && required.report?.lakeRings[0].points > 1000,
  'one lake ring draws Skagern (no overlapping same-level sheets)');
gate(lake?.open?.inWater === true && lake?.open?.depth >= 5 && lake?.open?.ground < lake?.open?.level - 4.5,
  'the frontier carries a carved bed under open water (>= 4.5 m under the sheet)');
gate(lake?.shore?.inWater === true && lake?.shore?.depth > 0.5 && lake?.shore?.depth < lake?.open?.depth,
  'the bed shoals toward the shore');
gate(required.report?.lakeSheets?.length === 1 && required.report?.lakeSheets[0].depthMean > 1.5,
  'the Skagern sheet reads deep water over most of its vertices, not silt');
const plainLake = plain.report?.lakeBed;
gate(plainLake?.openGround < 69.3 - 4.5, 'the GPK1 path carves the same lake (legacy carve)');

if (plain.errors.length) console.log(`?v2=0 page error: ${plain.errors[0]}`);
if (required.errors.length) console.log(`required page error: ${required.errors[0]}`);
console.log(failures ? `${failures} Ribbingsfors v2 browser gate(s) failed` : 'Ribbingsfors v2 browser proof passed');
process.exit(failures ? 1 : 0);
