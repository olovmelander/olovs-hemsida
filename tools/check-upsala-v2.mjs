#!/usr/bin/env node
/* Browser acceptance for Upsala's published v2 world.

   usage:
     node tools/serve.mjs apps/golf/dist 8620
     BANVY_GPU=1 node tools/check-upsala-v2.mjs [baseUrl]

   Both courses on this ground are booted, and both paths of each. The ordinary
   URL must remain pure GPK1; the required URL must resolve, verify and render
   the published ring graph -- one terrain from the played ground to a 16 km
   horizon, in one draw, with no legacy CORE, MID or FAR beneath it.

   The bridge assertions are the reason this file exists. Upsala's pack is a
   flat-earth frame 2.16 degrees off the grid, so the rotation and the two frame
   scales must arrive non-trivial and exact; and its vertical term must arrive
   as ZERO, because this pack was re-grounded on the same laser DTM rather than
   bridged off Terrarium. A silent regression to a Terrarium pack would show up
   here as a non-zero translateY beyond the frame origin height. */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
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
    return {
      terrain: {
        requested: terrain.requested,
        ready: terrain.ready,
        status: terrain.status,
        mode: terrain.selection?.mode,
        requestMode: terrain.selection?.requestMode,
        surfaceRepresentation: terrain.surfaceRepresentation,
        surfacePolicy: terrain.surfacePolicy,
        renderer: terrain.renderer,
        bridge: terrain.bridge,
      },
      card: document.querySelector('.c-title')?.textContent?.trim() || null,
      groundProbe: window.V3D.probeGround(0, 0),
    };
  }) : null;
  await page.close();
  return { booted, errors, report };
}

const courses = [
  { slug: 'upsala', label: 'Stora banan' },
  { slug: 'upsala-mellanbanan', label: 'Mellanbanan' },
];

let failures = 0;
const gate = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures++;
};

for (const course of courses) {
  console.log(`\n${course.slug} (${course.label})`);
  const plain = await boot(`?bana=${course.slug}&det=1`);
  const required = await boot(`?bana=${course.slug}&det=1&v2=require`);

  gate(plain.booted && plain.errors.length === 0, 'flagless GPK1 path boots without page errors');
  gate(plain.report?.terrain.requested === false && plain.report?.terrain.mode === 'off',
    'flagless path does not request v2');

  const terrain = required.report?.terrain;
  const renderer = terrain?.renderer;
  const bridge = terrain?.bridge;
  gate(required.booted && required.errors.length === 0, 'required v2 path boots without page errors');
  gate(terrain?.requested === true && terrain?.ready === true && terrain?.status === 'ready' &&
    terrain?.requestMode === 'require',
    'required v2 terrain is active');
  /* Seven levels and 277 tiles is the whole published ring graph: 64 at one
     metre over both courses, then 2, 4 and 8 m rings and the 16, 32 and 64 m
     shell out to a 16 km root. One draw for all of it. */
  gate(renderer?.kind === 'graph' && renderer?.tiles === 277 &&
    Array.isArray(renderer?.levels) && renderer.levels.length === 7 &&
    renderer?.meshResolutionMetres === 1 && renderer?.drawCalls === 1 &&
    renderer?.triangles > 0,
    'the published ring graph is the only terrain, drawn once at 1 m');
  /* surfaceRepresentation is what actually paints the ground and is the
     assertion that matters. The sibling `surfacePolicy` field is NOT checked
     here: main.js reads it off whichever adapter is serving, and the streaming
     ring adapter carries none, so it reports the 'v2-atlas' default even
     though no v2 surface tile exists and none is drawn. Asserting it would be
     asserting a reporting artifact. */
  gate(terrain?.surfaceRepresentation === 'legacy-ground-atlas',
    'the complete GPK ground atlas remains the sole surface authority');
  /* The pack's flat-earth frame is the grid rotated by the meridian
     convergence and scaled by its own metres-per-degree constants. Both terms
     are derived from the two frames and are exact; a translation-only bridge
     would be 24.6 m wrong at the far end of this property. */
  gate(Math.abs((bridge?.rotationRadians ?? 0) * 180 / Math.PI - 2.157738) < 1e-4 &&
    Math.abs((bridge?.scaleX ?? 0) - 0.997659212) < 1e-6 &&
    Math.abs((bridge?.scaleZ ?? 0) - 0.999356507) < 1e-6,
    'the derived flat-earth bridge carries the 2.1577 degree convergence and both frame scales');
  gate(Math.abs((bridge?.translateX ?? 0) - 313.229) < 0.01 &&
    Math.abs((bridge?.translateZ ?? 0) + 31.109) < 0.01,
    'the bridge translation is the pack origin against the reviewed frame origin');
  /* translateY is the frame origin height and nothing else: this pack carries
     RH 2000, so there is no datum step to add. */
  gate(bridge?.translateY === 13.28,
    'the vertical bridge is the frame origin alone -- the pack is already RH 2000');
  /* Håmö is 20-35 m above the sea across the played ground; a Terrarium-era
     regression would read some 6-7 m higher. */
  const height = required.report?.groundProbe?.h;
  gate(Number.isFinite(height) && height > 18 && height < 30,
    `the ground under the pack origin reads ${height} m RH 2000`);
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nUpsala v2 acceptance passed');
process.exitCode = failures ? 1 : 0;
