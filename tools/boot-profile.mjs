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
import { recordRequestedAdapters } from './startup-adapter-probe.mjs';
import { assertGpuIdle } from './timing-mode.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = args.find(a => !a.startsWith('--') && /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const V2 = flag('v2', 'require');
const Q = flag('q', null);
const STARTUP = flag('startup', '1');
const LIGHT = flag('light', 'kvall');
const PAINTED = flag('ghibli', '1');
const GL = flag('gl', '0');
const HOLE = flag('hole', '1');
const MOBILE = args.includes('--mobile');
/* normal use unless --det: det cold-solves every flag cloth in the first
   frames and hides the shadow's rest behaviour (tools/timing-mode.mjs) */
const DET = args.includes('--det');
const gpuIdle = GPU ? await assertGpuIdle({ allowBusy: args.includes('--allow-busy-gpu') }) : { checked: false, utilisation: null, allowedBusy: false };
const CPU_RATE = +flag('cpu', '1');
const MBPS = +flag('mbps', '0');
const LATENCY = +flag('latency', '0');
const RUNS = +flag('runs', 1);
const OUT = flag('out', null);
/* --fingerprint hashes what the boot BUILT -- every tree's position, the tint
   rasters' bytes, the scatter counts -- so two builds can be shown to plant
   the same world while their timings differ. */
const FINGERPRINT = args.includes('--fingerprint');
const VERBOSE = args.includes('--verbose');
const FRAMES = args.includes('--frames');     /* also measure the first frames after boot */   /* every console line, not only the v2 ones */
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 900) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;

/* 'off' emits an explicit v2=0: with v2 the flagless default on reviewed
   grounds, an unflagged URL would profile the v2 boot, not the GPK1 one. */
/* --query k=v&k2=v2 appends parameters, e.g. prepvista=0 for the before of a prepared step */
const EXTRA_QUERY = flag('query', '');
const search = `?bana=${SLUG}${DET ? '&det=1' : ''}&qualitylock=1&startup=${STARTUP}&ljus=${LIGHT}&ghibli=${PAINTED}&gl=${GL}&hal=${HOLE}&vy=tee${V2 === 'off' ? '&v2=0' : `&v2=${V2}`}${Q ? `&q=${Q}` : ''}${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ''}`;
const url = `${BASE}/${search}`;
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const runs = [];
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: MOBILE ? { width: 390, height: 844 } : { width: 1600, height: 900 },
    deviceScaleFactor: MOBILE ? 2 : 1, isMobile: MOBILE, hasTouch: MOBILE,
    // Isolate application traffic for reproducible cold-network comparisons.
    // SW-enabled/offline behavior is checked separately; this is not a phone GPU.
    serviceWorkers: args.includes('--sw') ? 'allow' : 'block' });
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(recordRequestedAdapters);
  await cdp.send('Network.enable');
  if (CPU_RATE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  if (MBPS > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY,
    downloadThroughput: MBPS * 1e6 / 8, uploadThroughput: MBPS * 1e6 / 8 });
  let transferredBytes = 0, requests = 0;
  cdp.on('Network.requestWillBeSent', () => requests++);
  cdp.on('Network.loadingFinished', event => { transferredBytes += event.encodedDataLength; });
  page.setDefaultTimeout(BOOT_TIMEOUT);
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
  page.on('console', m => { const t = m.text(); if (VERBOSE || /^v2 |settl|frontier|preflight/i.test(t)) logs.push({ atMs: Date.now() - t0, text: t.slice(0, 300) }); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  let booted = true;
  try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); } catch { booted = false; }
  const wallMs = Date.now() - t0;
  if (!booted) { console.log(`run ${run + 1}: boot did not complete in ${(wallMs / 1000).toFixed(0)} s; errors: ${errors.join(' | ') || 'none'}`); runs.push({ booted: false, wallMs, errors, logs }); await page.close(); continue; }
  /* --frames waits for the first frames to run: under SwiftShader the first one
     compiles every shader in the scene and takes most of a minute */
  if (FRAMES) await page.waitForFunction(() => (window.V3D?.perf?.().firstFrames?.length ?? 12) >= 6, null, { timeout: 300000 }).catch(() => {});
  const report = await page.evaluate(() => ({ perf: window.V3D.perf(), stats: { ...window.V3D.stats }, adapters: window.__startupAdapters,
    treeAllocation: window.V3D.treeTierAllocation?.() ?? null, rendererInfo: window.V3D.rendererInfo?.() ?? null,
    v2: (() => { const v = window.V3D.v2Terrain(); return { status: v.status, mode: v.selection?.mode, backend: v.backend }; })() }));
  if (FINGERPRINT) {
    report.fingerprint = await page.evaluate(async () => {
      const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      const V = window.V3D;
      const trees = V.legacyTrees({ instances: true });
      const encoder = new TextEncoder();
      const tint = V.groundTint?.();
      return {
        exactTables: V.startupWorldFingerprint ? await V.startupWorldFingerprint() : null,
        trees: await hex(encoder.encode(JSON.stringify(trees.holes ?? trees.total) + JSON.stringify(trees.species) + JSON.stringify(trees.reasons) + JSON.stringify(trees.zones))),
        treeInstances: await hex(encoder.encode(JSON.stringify(trees.instances))),
        tintNear: tint ? await hex(tint.near) : null,
        tintFar: tint ? await hex(tint.far) : null,
        counts: { trees: V.stats.trees, vista: V.stats.vista, reeds: V.stats.reeds, tufts: V.stats.tufts, bushes: V.stats.bushes, stones: V.stats.stones, stumps: V.stats.stumps, draws: V.stats.draws },
      };
    });
  }
  await page.close();
  runs.push({ booted: true, wallMs, errors, logs, network: { requests, transferredBytes,
    scope: 'page CDP; service-worker requests excluded', serviceWorkers: args.includes('--sw'), mbps: MBPS, latencyMs: LATENCY }, ...report });
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
  console.log(`  ${fmt(r.perf.totalMs)}  total (BOOT_PERF.totalMs)${r.perf.doneAtMs ? `, done marker at ${fmt(r.perf.doneAtMs)}` : ''}`);
  if (r.perf.firstFrames?.length) console.log(`  first frames: ${r.perf.firstFrames.map(f => `${(f.atMs / 1000).toFixed(1)}s+${f.ms}ms`).join('  ')}`);
  console.log('\n  spans (the blocks inside the stages)');
  for (const s of [...r.perf.spans].sort((a, b) => b.ms - a.ms)) {
    const extra = Object.entries(s).filter(([k]) => k !== 'name' && k !== 'ms').map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  ${fmt(s.ms)}  ${s.name}${extra ? `  (${extra})` : ''}`);
  }
  if (r.logs.length) { console.log('\n  runtime log'); for (const l of r.logs) console.log(`  ${fmt(l.atMs)}  ${l.text}`); }
  if (r.fingerprint) { console.log('\n  fingerprint'); for (const [k, v] of Object.entries(r.fingerprint)) console.log(`  ${k.padEnd(14)} ${typeof v === 'string' ? v : JSON.stringify(v)}`); }
}
if (OUT) { fs.writeFileSync(path.resolve(ROOT, OUT), JSON.stringify({ url, gpu: GPU, det: DET, gpuIdle, mobileEmulation: MOBILE,
  cpuRate: CPU_RATE, physicalPhone: false, runs }, null, 2) + '\n'); console.log(`\nwrote ${OUT}`); }
if (runs.some(r => !r.booted)) process.exit(1);
