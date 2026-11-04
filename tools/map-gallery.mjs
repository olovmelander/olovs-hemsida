#!/usr/bin/env node
/* The map mode on a phone-sized viewport, photographed on the real GPU.
 *
 * node tools/serve.mjs apps/golf/dist 8620      (or a dev server)
 * BANVY_GPU=1 node tools/map-gallery.mjs --label a [--url http://localhost:8620/]
 *     [--views id,id] [--landscape] [--gl swiftshader]
 *
 * Each view opens on its own page at 412 x 915, device pixel ratio 2, waits for
 * every tile to arrive and two more frames, and photographs the page. It fails on
 * any console error. Output goes to tools/goldens/map/<label>/ (ignored). The
 * numbers are this GPU's, so they compare views; they say nothing of a phone's
 * frame rate. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const has = name => args.includes(`--${name}`);
const LABEL = flag('label', 'map'), URL_BASE = flag('url', 'http://localhost:8631/');
const OUT = path.resolve('tools/goldens/map', LABEL);
fs.mkdirSync(OUT, { recursive: true });
if (!GPU) console.warn('WARN: BANVY_GPU is not 1; pictures are SwiftShader\'s');

/* do: a function body run in the page once the map is up. */
export const VIEWS = [
  { id: 'veckefjarden-h1', slug: 'veckefjarden', hole: 1 },
  { id: 'veckefjarden-h13', slug: 'veckefjarden', hole: 13 },
  { id: 'veckefjarden-bana', slug: 'veckefjarden', course: true },
  { id: 'angso-h3', slug: 'angso', hole: 3 },
  { id: 'johannesberg-h7', slug: 'johannesberg', hole: 7 },
  { id: 'visby-h5', slug: 'visby', hole: 5 },
  { id: 'visby-bana', slug: 'visby', course: true },
  { id: 'lidingo-h1', slug: 'lidingo', hole: 1 },
  { id: 'puttom-h5', slug: 'puttom', hole: 5 },
  { id: 'upsala-h4', slug: 'upsala', hole: 4 },
  { id: 'tortuna-h9', slug: 'tortuna', hole: 9 },
  { id: 'norrfallsviken-h2', slug: 'norrfallsviken', hole: 2 },
  { id: 'ribbingsfors-h3', slug: 'ribbingsfors', hole: 3 },
  { id: 'upsala-mellanbanan-h2', slug: 'upsala-mellanbanan', hole: 2 },
  { id: 'johannesberg-9-h1', slug: 'johannesberg-9', hole: 1 },
  { id: 'veckefjarden-korthalsbanan-h4', slug: 'veckefjarden-korthalsbanan', hole: 4 },
  { id: 'veckefjarden-green', slug: 'veckefjarden', hole: 1, do: `
    const { state, camera, course, invalidate } = V3DMap;
    const g = course.holes[0].green.c;
    state.flight = null; state.follow = false;
    Object.assign(camera.state, { x: g[0], z: g[1], distance: 90, tilt: 0.95 });
    invalidate();` },
];

const only = flag('views', null)?.split(',');
const views = only ? VIEWS.filter(view => only.includes(view.id)) : VIEWS;
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const viewport = has('landscape') ? { width: 915, height: 412 } : { width: 412, height: 915 };
const results = [];
let failed = 0;

for (const view of views) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('pageerror', error => problems.push(error.message));
  const started = Date.now();
  const query = `?bana=${view.slug}&karta=1${view.hole ? `&hal=${view.hole}` : ''}${view.course ? '&vy=bana' : ''}${flag('query', '')}`;
  await page.goto(`${URL_BASE}${query}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => globalThis.V3DMap?.stats().frames > 0, null, { timeout: 60000 });
    const firstPicture = Date.now() - started;
    if (view.do) await page.evaluate(view.do);
    const settled = async () => page.waitForFunction(() => {
      const s = V3DMap.stats();
      return s.busy === 0 && !V3DMap.state.flight;
    }, null, { timeout: 60000, polling: 100 });
    await settled();
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await settled();
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const stats = await page.evaluate(() => V3DMap.stats());
    await page.waitForTimeout(900);    /* the boot screen's fade */
    await page.screenshot({ path: path.join(OUT, `${view.id}.png`) });
    results.push({ id: view.id, firstPicture, ready: Date.now() - started, ...stats, camera: undefined, problems });
    console.log(`${view.id.padEnd(32)} ${firstPicture} ms first picture · ${(stats.triangles / 1000).toFixed(0)}k tris · ${stats.patches} patches · ${stats.metreTiles} 1 m tiles · ${stats.resident} resident · ${(stats.bytesFetched / 1048576).toFixed(2)} MB fetched${problems.length ? ` · ${problems.length} ERRORS` : ''}`);
    if (problems.length) { failed++; console.log(problems.slice(0, 3).join('\n')); }
  } catch (error) {
    failed++;
    console.log(`${view.id}: ${error.message.split('\n')[0]}\n${problems.slice(0, 4).join('\n')}`);
    await page.screenshot({ path: path.join(OUT, `${view.id}-FAILED.png`) }).catch(() => {});
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'gallery.json'), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
