#!/usr/bin/env node
/* Look at the world terrain: boot a v2 course on a real GPU, read what the
   world adapter reports, and shoot the views where the old seam lived.

     node tools/serve.mjs apps/golf/dist 8620 &
     BANVY_GPU=1 node tools/world-capture.mjs http://127.0.0.1:8620 [--course puttom] [--out tools/goldens/<course>-world]

   The first view is the exact URL a person reported (hole 14 from the tee at
   dusk); the rest walk the course edge and the horizon. The JSON beside the
   shots records the adapter snapshot, draw calls, boot time and any page
   error, so a regression is a number before it is a picture.               */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620').replace(/\/$/, '');
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const SLUG = flag('course', 'puttom');
const OUT = path.resolve(ROOT, flag('out', `tools/goldens/${SLUG}-world`));
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 600) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { id: 'h14_tee_dusk', hole: 14, cam: 'tee', booted: true },
  { id: 'h14_top', hole: 14, cam: 'top' },
  { id: 'h14_free', hole: 14, cam: 'free' },
  { id: 'h01_top', hole: 1, cam: 'top' },
  { id: 'h07_tee', hole: 7, cam: 'tee' },
  { id: 'h12_tee', hole: 12, cam: 'tee' },
  { id: 'h18_tee', hole: 18, cam: 'tee' },
  { id: 'h05_green', hole: 5, cam: 'green' },
];

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 240)));
const consoleWarnings = [];
page.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleWarnings.push(m.text().slice(0, 240)); });
const url = `${BASE}/?bana=${SLUG}&det=1&v2=require&hal=14&vy=tee&ljus=kvall`;
console.log(`${SLUG} world <- ${url}`);
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
let booted = true;
try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); } catch { booted = false; }
const bootSeconds = (Date.now() - t0) / 1000;
console.log(`  boot ${booted ? 'completed' : 'FAILED'} in ${bootSeconds.toFixed(1)} s; page errors ${errors.length}`);
for (const e of errors) console.log(`  error: ${e}`);
const report = booted ? await page.evaluate(() => {
  const V = window.V3D;
  const v2 = V.v2Terrain();
  return { stats: { ...V.stats }, v2, perf: V.perf?.() ?? null, trees: V.legacyTrees?.()?.total ?? null };
}) : null;
if (report) {
  const a = report.v2.adapter || {};
  console.log(`  adapter ${a.kind}/${a.phase} renderer ${JSON.stringify(a.renderer && { status: a.renderer.status, tiles: a.renderer.tiles, levels: a.renderer.levels, ringTiles: a.renderer.ringTiles, drawCalls: a.renderer.drawCalls, renderedTiles: a.renderer.renderedTiles })}`);
  console.log(`  stream ${JSON.stringify(a.stream)}`);
  console.log(`  stats draws ${report.stats.draws} tris ${report.stats.tris} trees ${report.stats.trees} vista ${report.stats.vista} tintMs ${report.stats.tintMs} backend ${report.stats.backend} selection ${report.v2.selection.mode}`);
}
const shots = [];
if (booted) {
  for (const view of VIEWS) {
    if (!view.booted) {
      await page.evaluate(([h, c]) => { window.V3D.goHole?.(h, true, true); window.V3D.setCam?.(c, true); }, [view.hole, view.cam]);
    }
    await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const file = path.join(OUT, `${view.id}.png`);
    await page.screenshot({ path: file, timeout: 300000, animations: 'disabled' });
    const stream = await page.evaluate(() => window.V3D.v2Terrain().adapter?.stream ?? null);
    shots.push({ ...view, file: path.relative(ROOT, file).replaceAll('\\', '/'), stream });
    console.log(`  shot ${view.id} rendered ${stream?.renderedTiles} tiles, ${stream?.drawCalls} draws, ${stream?.loadingTiles} loading`);
  }
}
await browser.close();
/* the gates: the world adapter served, in one draw, with nothing still loading once settled */
const adapter = report?.v2?.adapter || {};
const gates = [
  [booted, 'boot completed'],
  [errors.length === 0, 'no page errors'],
  [adapter.kind === 'graph' && adapter.phase === 'ready', `world adapter serving (${adapter.kind}/${adapter.phase})`],
  [shots.length === VIEWS.length && shots.every(shot => shot.stream?.drawCalls === 1), 'every view drew the terrain in one call'],
  [shots.every(shot => shot.stream?.loadingTiles === 0), 'every view settled before its shot'],
];
let failed = 0;
for (const [ok, label] of gates) { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; }
fs.writeFileSync(path.join(OUT, 'world-capture.json'), JSON.stringify({ url, booted, bootSeconds, errors, consoleWarnings: consoleWarnings.slice(0, 20), report, shots, gates: gates.map(([ok, label]) => ({ ok, label })) }, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, path.join(OUT, 'world-capture.json'))}${failed ? ` (${failed} gate(s) failed)` : ' (all gates passed)'}`);
if (failed) process.exit(1);
