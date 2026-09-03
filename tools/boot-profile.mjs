/* Where a boot spends its time, stage by stage and block by block.

   usage: node tools/serve.mjs apps/golf/dist 8620 &
          node tools/boot-profile.mjs [baseUrl] [--course puttom] [--v2 require|1|off]
            [--runs 1] [--out file.json] [--q lo|hi]
          BANVY_GPU=1 node tools/boot-profile.mjs ...   # the real adapter

   Boots the built app once per run, waits for #boot.done, and prints the
   stage marks (the twelve boot labels), the spans main.js records around its
   heavy blocks (V3D.perf().spans), and every "v2 …" console line the runtime
   logs (ring read, flat water, beds, settle). Wall time per stage is the
   difference between consecutive marks; the spans say what inside a stage
   cost it.

   Under SwiftShader (the default here) anything that waits on the GPU --
   the first-frontier settle, the preflight, PMREM, shader compile -- is
   inflated by software rasterisation and says nothing about a real card;
   the CPU-bound blocks (decode, carve, rasters, planters) are representative
   in RELATIVE terms. Measure the absolute numbers with BANVY_GPU=1 on the
   development machine; this tool exists so that run is a one-liner. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = args.find(a => !a.startsWith('--') && /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const V2 = flag('v2', 'require');
const Q = flag('q', null);
const RUNS = +flag('runs', 1);
const OUT = flag('out', null);
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 900) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;

const search = `?bana=${SLUG}&det=1${V2 === 'off' ? '' : `&v2=${V2}`}${Q ? `&q=${Q}` : ''}`;
const url = `${BASE}/${search}`;
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const runs = [];
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(BOOT_TIMEOUT);
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
  page.on('console', m => { const t = m.text(); if (/^v2 |settl|frontier|preflight/i.test(t)) logs.push({ atMs: Date.now() - t0, text: t.slice(0, 300) }); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  let booted = true;
  try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); } catch { booted = false; }
  const wallMs = Date.now() - t0;
  if (!booted) { console.log(`run ${run + 1}: boot did not complete in ${(wallMs / 1000).toFixed(0)} s; errors: ${errors.join(' | ') || 'none'}`); runs.push({ booted: false, wallMs, errors, logs }); await page.close(); continue; }
  const report = await page.evaluate(() => ({ perf: window.V3D.perf(), stats: { ...window.V3D.stats }, v2: (() => { const v = window.V3D.v2Terrain(); return { status: v.status, mode: v.selection?.mode, backend: v.backend }; })() }));
  await page.close();
  runs.push({ booted: true, wallMs, errors, logs, ...report });
}
await browser.close();

const fmt = ms => `${(ms / 1000).toFixed(2).padStart(7)} s`;
for (const [i, r] of runs.entries()) {
  console.log(`\n${SLUG} ${search}  run ${i + 1}/${runs.length}  ${GPU ? 'real GPU' : 'SwiftShader'}  wall ${fmt(r.wallMs)}${r.booted ? '' : '  (DID NOT BOOT)'}`);
  if (!r.booted) continue;
  console.log(`  backend ${r.stats.backend}, v2 ${r.v2.mode}/${r.v2.status}, draws ${r.stats.draws}, trees ${r.stats.trees}, vista ${r.stats.vista}, reeds ${r.stats.reeds}, tufts ${r.stats.tufts}`);
  if (r.errors.length) console.log(`  page errors: ${r.errors.join(' | ')}`);
  console.log('\n  stage (time between marks)');
  const marks = r.perf.marks;
  for (let k = 0; k < marks.length; k++) {
    const next = k + 1 < marks.length ? marks[k + 1].atMs : r.perf.totalMs;
    console.log(`  ${fmt(next - marks[k].atMs)}  ${marks[k].name}${k === 0 ? `   (+${fmt(marks[0].atMs)} before the first mark: manifest, pack, sha256)` : ''}`);
  }
  console.log(`  ${fmt(r.perf.totalMs)}  total (BOOT_PERF.totalMs)`);
  console.log('\n  spans (the blocks inside the stages)');
  for (const s of [...r.perf.spans].sort((a, b) => b.ms - a.ms)) {
    const extra = Object.entries(s).filter(([k]) => k !== 'name' && k !== 'ms').map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  ${fmt(s.ms)}  ${s.name}${extra ? `  (${extra})` : ''}`);
  }
  if (r.logs.length) { console.log('\n  runtime log'); for (const l of r.logs) console.log(`  ${fmt(l.atMs)}  ${l.text}`); }
}
if (OUT) { fs.writeFileSync(path.resolve(ROOT, OUT), JSON.stringify({ url, gpu: GPU, runs }, null, 2) + '\n'); console.log(`\nwrote ${OUT}`); }
if (runs.some(r => !r.booted)) process.exit(1);
