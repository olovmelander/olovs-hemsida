/* What a course open actually costs the network: every same-origin response
   between navigation and #boot.done, grouped by kind, with bytes.

   The boot profiler says where the TIME goes; this says how many round trips
   and how many bytes buy it. On localhost a request is nearly free, which is
   exactly why the count has to be measured rather than felt: the same boot on
   a phone pays a round trip for each one.

     node tools/serve.mjs apps/golf/dist 8620 &
     node tools/boot-requests.mjs [baseUrl] [--course puttom] [--modes require,0]

   Modes are ?v2= values. 'require' is the reviewed v2 ground (the flagless
   default on every course that has one); '0' is the GPK1 pack path. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const BASE = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const MODES = String(flag('modes', 'require,0')).split(',');
const TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 900) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const kindOf = p =>
  p.endsWith('.bvch') ? 'bvch (terrain/surface/objects/stands)'
  : p.endsWith('.bin') ? 'pack.bin'
  : p.endsWith('.glb') ? 'glb (facility models)'
  : p.endsWith('.js') ? 'js'
  : p.endsWith('.json') ? 'json (manifests, landcover)'
  : p.endsWith('.woff2') ? 'font'
  : p.endsWith('.webp') ? 'webp (posters)'
  : 'other';

const browser = await chromium.launch({
  ...(fs.existsSync(LINUX_CHROME) ? { executablePath: LINUX_CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const origin = new URL(BASE).origin;
const results = [];
for (const mode of MODES) {
  /* a fresh context each time: a shared service worker or HTTP cache would
     make the second mode look free, which is the one thing this must not do */
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const seen = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== origin) return;
    seen.push({ path: url.pathname, bytes: Number(response.headers()['content-length'] || 0) });
  });
  const started = Date.now();
  await page.goto(`${BASE}/?bana=${SLUG}&det=1&v2=${mode}`, { waitUntil: 'load', timeout: 120_000 });
  let booted = true;
  try { await page.waitForSelector('#boot.done', { timeout: TIMEOUT }); } catch { booted = false; }
  const wallMs = Date.now() - started;
  const perf = await page.evaluate(() => window.V3D?.perf?.() ?? null).catch(() => null);

  const groups = new Map();
  for (const r of seen) {
    const k = kindOf(r.path);
    const g = groups.get(k) || { count: 0, bytes: 0 };
    g.count++; g.bytes += r.bytes;
    groups.set(k, g);
  }
  const bytes = seen.reduce((s, r) => s + r.bytes, 0);
  results.push({ mode, booted, wallMs, bootMs: perf?.totalMs ?? null, requests: seen.length, bytes, groups });

  console.log(`\n=== ?v2=${mode}  ${SLUG}${booted ? '' : '  (DID NOT REACH #boot.done)'}`);
  console.log(`    boot ${(perf?.totalMs ?? 0) / 1000 || '?'} s on the page clock, ${(wallMs / 1000).toFixed(1)} s wall`);
  console.log(`    ${seen.length} same-origin requests, ${(bytes / 1048576).toFixed(2)} MB`);
  for (const [kind, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`      ${String(g.count).padStart(5)} x  ${kind.padEnd(36)} ${(g.bytes / 1024).toFixed(0).padStart(8)} KB`);
  }
  await context.close();
}

if (results.length === 2) {
  const [a, b] = results;
  const ratio = (x, y) => (y > 0 ? (x / y).toFixed(1) + 'x' : '—');
  console.log(`\n=== ?v2=${a.mode} against ?v2=${b.mode}`);
  console.log(`    requests ${a.requests} vs ${b.requests}   (${ratio(a.requests, b.requests)})`);
  console.log(`    bytes    ${(a.bytes / 1048576).toFixed(2)} MB vs ${(b.bytes / 1048576).toFixed(2)} MB   (${ratio(a.bytes, b.bytes)})`);
  if (a.bootMs && b.bootMs) console.log(`    boot     ${(a.bootMs / 1000).toFixed(1)} s vs ${(b.bootMs / 1000).toFixed(1)} s   (${ratio(a.bootMs, b.bootMs)})`);
}
await browser.close();
