/* Photograph the page headlessly, and say whether what came back is a picture.

   Verifying by reading the source does not work on a renderer: the file can be
   perfectly valid and still draw a black screen. So this loads the real page, waits
   for its own boot marker, and then measures the pixels -- mean luminance and the
   share that are nearly black -- because a glance at a dark screenshot will not
   reliably tell you the difference between night and nothing.

   Every CDN request is served from geobuild/cache/vendor, since Chromium cannot get
   through this environment's proxy. Run `node geobuild/vendor.mjs` first.

   Usage: node geobuild/shot.mjs <page.html|file.svg> <out.png> [--hole n] [--preset p]
                                 [--cam name] [--w 1600] [--h 900] [--wait ms]      */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, CACHE } from './lib.mjs';
import { browserArgs } from '../tools/browser-args.mjs';

const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const target = args[0], out = args[1] || path.join(ROOT, 'geobuild/shots/shot.png');
if (!target) { console.error('usage: shot.mjs <page.html|file.svg> <out.png> [--hole n] [--preset p]'); process.exit(2); }

const WIDTH = +flag('w', 1600), HEIGHT = +flag('h', 900), WAIT = +flag('wait', 0);
/* How long a boot may take before the shot is called a failure. The atlas made
   the course build heavier and SwiftShader is roughly an order of magnitude
   slower than a GPU, so the old hardcoded 180 s failed every course on a machine
   that renders all six perfectly. Raise it with --boot-timeout when a run has to
   share the CPU with another harness. */
const BOOT_TIMEOUT = +flag('boot-timeout', 420) * 1000;
const vendor = path.join(CACHE, 'vendor');

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300000);

const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + String(e).split('\n')[0].slice(0, 200)));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon/.test(t)) problems.push('console: ' + t.slice(0, 200));
});

/* replay the CDN out of the vendor cache; localhost is a real server, let it through */
await page.route('**/*', async route => {
  const url = route.request().url();
  if (url.startsWith('file:')) return route.continue();
  if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return route.continue();
  const base = url.split('?')[0].split('/').pop();
  const local = path.join(vendor, base);
  if (fs.existsSync(local)) {
    return route.fulfill({ body: fs.readFileSync(local), contentType: 'text/javascript; charset=utf-8' });
  }
  if (/fonts\.googleapis|fonts\.gstatic/.test(url)) return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
  if (/^https?:/.test(url)) { problems.push('unvendored: ' + url.slice(0, 110)); return route.abort(); }
  return route.continue();
});

const t0 = Date.now();
const targetUrl = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
await page.goto(targetUrl, { waitUntil: 'load', timeout: 120000 });

const wantHole = flag('hole', null), wantPreset = flag('preset', null), wantCam = flag('cam', null);
const wantSeq = flag('seq', null);
let boot = 'n/a';
const isPage = /\.html($|\?)/.test(target) || /^https?:/.test(target);
if (isPage && wantSeq) {
  /* one boot, many shots: --seq "hole:cam:preset,hole:cam:preset,…" writes
     out-1.png, out-2.png, … next to the given out path. Twelve views cost one
     boot instead of twelve, which is what makes a parity matrix affordable. */
  try {
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    boot = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  } catch { console.error(`boot did not complete within ${BOOT_TIMEOUT/1000} s`); await browser.close(); process.exit(1); }
  const steps = wantSeq.split(',').map(s => s.split(':'));
  const base = path.resolve(out).replace(/\.png$/, '');
  fs.mkdirSync(path.dirname(base), { recursive: true });
  let k = 0;
  for (const [h, c, pr] of steps) {
    k++;
    await page.evaluate(([hh, cc, pp]) => {
      if (pp) window.V3D?.setPreset?.(pp);
      if (hh) window.V3D?.goHole?.(+hh, false, true);
      if (cc) window.V3D?.setCam?.(cc, true);
    }, [h, c, pr]);
    await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${base}-${k}.png`, timeout: 300000, animations: 'disabled' });
    console.log(`  ${path.basename(base)}-${k}.png  hole ${h} ${c} ${pr}`);
  }
  await browser.close();
  if (problems.length) { console.log('  problems:'); for (const q of [...new Set(problems)].slice(0, 8)) console.log('    ' + q); }
  process.exit(problems.some(q => q.startsWith('pageerror')) ? 1 : 0);
}
if (/\.html$/.test(target) || /^https?:/.test(target)) {
  try {
    await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
    boot = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  } catch { problems.push(`boot did not complete within ${BOOT_TIMEOUT/1000} s`); boot = 'TIMEOUT'; }
  /* Move the camera instantly rather than tweening it. Under software rendering the
     page draws about twice a second, so a 1.5 s tween would still be in its second
     frame when the shutter opens and every shot would be of the previous view. */
  if (wantPreset) await page.evaluate(p => window.V3D?.setPreset?.(p), wantPreset);
  if (wantHole) await page.evaluate(n => window.V3D?.goHole?.(+n, true, true), wantHole);
  if (wantCam) await page.evaluate(c => window.V3D?.setCam?.(c, true), wantCam);
  if (wantHole || wantPreset || wantCam) {
    await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }   // the camera tween runs 1.5 s
}
if (WAIT) await page.waitForTimeout(WAIT);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: path.resolve(out), timeout: 300000, animations: 'disabled' });

/* Measure the screenshot rather than the canvas: reading a WebGL drawing buffer back
   needs preserveDrawingBuffer, and a page that does not set it returns black even
   when it is rendering perfectly. The PNG on disk is what a person would see. */
const { decodePNG } = await import('./png.mjs');
const img = decodePNG(fs.readFileSync(path.resolve(out)));
let sum = 0, dark = 0, blown = 0;
const n = img.width * img.height;
for (let i = 0; i < n; i++) {
  const o = i * img.channels;
  const l = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
  sum += l; if (l < 8) dark++; if (l > 250) blown++;
}
const meanLum = sum / n / 255, pctDark = 100 * dark / n, pctBlown = 100 * blown / n;
const stats = await page.evaluate(() => window.V3D?.stats || null);
const perf = await page.evaluate(() => window.V3D?.perf?.() || null);
const camAt = await page.evaluate(() => window.V3D?.camInfo?.() || null);
await browser.close();

console.log(`${path.basename(target)} -> ${path.relative(process.cwd(), out)}  ${img.width}x${img.height}`);
console.log(`  boot ${boot}   mean luminance ${meanLum.toFixed(3)}   near-black ${pctDark.toFixed(1)}%   blown ${pctBlown.toFixed(1)}%`);
if (stats) console.log('  ' + Object.entries(stats).map(([k, v]) => `${k} ${v}`).join('  '));
if (perf) {
  console.log(`  atlas ${perf.atlasMs} ms   boot-js ${perf.totalMs} ms`);
  let previous = 0;
  console.log('  phases ' + perf.marks.map(mark => {
    const delta = mark.atMs - previous;
    previous = mark.atMs;
    return `${mark.name}:${Math.round(delta)}ms`;
  }).join('  '));
}
if (wantCam || wantHole) console.log('  camera ' + JSON.stringify(camAt));
if (problems.length) {
  console.log('  problems:');
  for (const p of [...new Set(problems)].slice(0, 12)) console.log('    ' + p);
}
const blank = meanLum < 0.02 || pctDark > 88;
if (blank) console.log('  VERDICT: blank or near-black — this is not a picture of anything');
process.exit(blank || boot === 'TIMEOUT' ? 1 : 0);
