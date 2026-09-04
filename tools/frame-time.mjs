/* Frame time per view on the real GPU, in CPU rAF intervals with the vsync
   lock lifted AND in GPU milliseconds from timestamp queries, plus one
   moving-camera row (docs/specs/tree-lod-hardware-harness.md).

   usage: node tools/serve.mjs apps/golf/dist 8620 &
          BANVY_GPU=1 node tools/frame-time.mjs [http://127.0.0.1:8620] [--course puttom]
              [--px hero,full,impostor] [--frames 300] [--warm 30] [--out file.json] [--label text]

   The page boots with ?gputime=1 (a timestamp-query pool the renderer resolves
   on request) and Chrome is launched with the frame-rate cap off, so a
   requestAnimationFrame interval is a frame time and not a multiple of the
   refresh period. GPU milliseconds are the sum of every render pass (shadow,
   scene, bloom) of the last frame before a resolve.
   Numbers from this tool are comparable only with numbers from this tool. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';

if (!GPU) { console.error('BANVY_GPU=1 required: a frame time under SwiftShader is not a measurement'); process.exit(2); }
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const PX = flag('px', null);
const N = +flag('frames', 300), WARM = +flag('warm', 30);
const OUT = flag('out', null), LABEL = flag('label', PX || 'default');
const VIEWS = [
  ['h1_tee_golden', 1, 'tee', 'golden'], ['h12_tee_golden', 12, 'tee', 'golden'], ['h14_tee_golden', 14, 'tee', 'golden'],
  ['h7_top_noon', 7, 'top', 'noon'], ['h12_orbit_golden', 12, 'orbit', 'golden'], ['h5_tee_noon', 5, 'tee', 'noon'],
];

const browser = await chromium.launch({ channel: 'chrome', args: browserArgs({ uncappedFrameRate: true }) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
/* the adapter, from the hub page (about:blank is not a secure context) */
await page.goto(`${BASE}/`, { waitUntil: 'load' });
const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  const c = document.createElement('canvas'), gl = c.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const ts = []; await new Promise(r => { const f = t => { ts.push(t); ts.length < 60 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((x, y) => x - y);
  return { vendor: a?.info?.vendor, architecture: a?.info?.architecture, timestampQuery: !!a?.features.has('timestamp-query'),
           webgl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, hubRafMs: { median: +d[d.length >> 1].toFixed(2), min: +d[0].toFixed(2) } };
});
console.log(`adapter ${adapter.vendor}/${adapter.architecture} timestamp-query ${adapter.timestampQuery} | ${adapter.webgl} | hub rAF median ${adapter.hubRafMs.median} ms (uncapped if < 3)`);
const tBoot = Date.now();
await page.goto(`${BASE}/?bana=${SLUG}&det=1&v2=require&gputime=1&ren=1${PX ? `&lodpx=${PX}` : ''}`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done');
const boot = await page.evaluate(() => ({ backend: window.V3D.stats.backend, trees: window.V3D.stats.trees, gpuTiming: window.V3D.gpuTimingEnabled(), px: window.V3D.treeLodPx() }));
console.log(`${SLUG} ${boot.backend} boot ${((Date.now() - tBoot) / 1000).toFixed(1)} s, trees ${boot.trees}, thresholds ${boot.px.hero}/${boot.px.full}/${boot.px.impostor}, gpu timing ${boot.gpuTiming}`);
if (!boot.gpuTiming) console.log('WARN: the backend did not enable timestamp queries; the GPU column will be null');
const settle = async () => {
  const f = await page.evaluate(() => window.V3D.frame());
  await page.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 50 });
  const f1 = await page.evaluate(() => window.V3D.frame());
  await page.waitForFunction(f0 => window.V3D.frame() >= f0 + 2 && window.V3D.settled(), f1, { polling: 20 });
};
const stat = arr => { const s = [...arr].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) }; };
const mode = arr => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
/* n rAF intervals measured in the page, after warm ticks; the app's frame() runs before this callback on every tick */
const cpuWindow = () => page.evaluate(({ n, warm }) => new Promise(resolve => {
  const V = window.V3D, ts = [], tris = [], draws = []; let k = 0;
  const cb = t => {
    if (k >= warm) { ts.push(t); const r = V.rendererInfo(); tris.push(r.triangles); draws.push(r.drawCalls); }
    if (++k < warm + n + 1) requestAnimationFrame(cb);
    else resolve({ ms: ts.slice(1).map((t, i) => t - ts[i]), tris, draws, tiers: V.treeTiers(), fov: V.cameraInfo().fov });
  };
  requestAnimationFrame(cb);
}), { n: N, warm: WARM });
/* GPU ms per frame: one resolve in flight at a time. three's pool returns the total of every
   pass of the LAST frame in the resolved batch (WebGPUTimestampQueryPool._resolveQueries), so a
   sample is already one frame's GPU time; nothing is divided by the frames a resolve spanned. */
const gpuWindow = () => page.evaluate(({ n }) => new Promise(resolve => {
  const V = window.V3D, samples = []; if (!V.gpuTime) return resolve(samples);
  let pending = false, k = 0, fPrev = V.frame();
  const cb = () => {
    if (!pending) { pending = true; V.gpuTime().then(r => { const frames = r.frame - fPrev; fPrev = r.frame; if (frames > 0 && r.ms > 0) samples.push(r.ms); pending = false; }); }
    if (++k < n) requestAnimationFrame(cb); else setTimeout(() => resolve(samples), 300);
  };
  requestAnimationFrame(cb);
}), { n: N });
const rows = [];
for (const [id, h, cam, preset] of VIEWS) {
  await page.evaluate(([h, cam, preset]) => { window.V3D.setPreset(preset); window.V3D.goHole(h, true, true); window.V3D.setCam(cam, true); }, [h, cam, preset]);
  await settle();
  const c = await cpuWindow();
  const g = (await gpuWindow()).slice(2);
  const row = { id, cpuMs: stat(c.ms), gpuMs: g.length ? stat(g) : null, triangles: mode(c.tris), drawCalls: mode(c.draws),
                tiers: { t0: c.tiers.tier0, t1: c.tiers.tier1, t2: c.tiers.tier2, t3: c.tiers.tier3, cellsVisible: c.tiers.cellsVisible, updateMs: +c.tiers.updateMs.toFixed(3) } };
  rows.push(row);
  console.log(`  ${id.padEnd(18)} cpu ${row.cpuMs.median}/${row.cpuMs.p95} ms  gpu ${row.gpuMs ? `${row.gpuMs.median}/${row.gpuMs.p95}` : 'n/a'} ms  tris ${(row.triangles / 1e6).toFixed(2)} M  draws ${row.drawCalls}  tiers ${row.tiers.t0}/${row.tiers.t1}/${row.tiers.t2}/${row.tiers.t3}  update ${row.tiers.updateMs} ms`);
}
/* the walk: one pose per rAF along hole 1, the only row that can see a crossfade's cost */
await page.evaluate(() => { window.V3D.setPreset('golden'); window.V3D.goHole(1, true, true); window.V3D.setCam('tee', true); });
await settle();
const walk = await page.evaluate(({ n }) => new Promise(resolve => {
  const V = window.V3D, cam = V.camInfo(), dx = cam.look[0] - cam.pos[0], dz = cam.look[2] - cam.pos[2], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const ts = [], tris = [], sw = []; let k = 0, s0 = V.treeTiers().switches;
  const cb = t => {
    const x = cam.pos[0] + ux * k, z = cam.pos[2] + uz * k, y = V.probeH(x, z) + 1.7;
    V.placeCamera([x, y, z], [x + ux * 40, y, z + uz * 40]);
    ts.push(t); const r = V.rendererInfo(); tris.push(r.triangles); const s = V.treeTiers().switches; sw.push(s - s0); s0 = s;
    if (++k < n) requestAnimationFrame(cb); else resolve({ ms: ts.slice(1).map((t, i) => t - ts[i]), tris, sw });
  };
  requestAnimationFrame(cb);
}), { n: N });
const g2 = (await gpuWindow()).slice(2);
const walkRow = { id: 'h1_walk_golden', cpuMs: stat(walk.ms), trianglesMax: Math.max(...walk.tris), framesWithSwitches: walk.sw.filter(s => s > 0).length, switches: walk.sw.reduce((a, b) => a + b, 0), gpuMsAfter: g2.length ? stat(g2) : null };
console.log(`  ${walkRow.id.padEnd(18)} cpu ${walkRow.cpuMs.median}/${walkRow.cpuMs.p95}/${walkRow.cpuMs.max} ms  tris max ${(walkRow.trianglesMax / 1e6).toFixed(2)} M  ${walkRow.framesWithSwitches} of ${N} frames switched ${walkRow.switches} trees`);
const report = { tool: 'frame-time', date: new Date().toISOString(), label: LABEL, base: BASE, course: SLUG, viewport: [1920, 1080], adapter, boot, frames: N, warm: WARM, views: rows, walk: walkRow, errors };
if (errors.length) console.log('page errors:', errors.join(' | '));
if (OUT) { fs.mkdirSync(OUT.replace(/[\\/][^\\/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); console.log(`wrote ${OUT}`); }
await browser.close();
