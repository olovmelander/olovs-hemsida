#!/usr/bin/env node
/* The graphics gallery: a fixed set of views on the real GPU, for A/B review.
 *
 * node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/gfx-gallery.mjs --label before [--query a=b&c=d] [--views id,id] [--gl]
 * node tools/gfx-gallery.mjs --compare before,after      (side-by-side sheets, no browser)
 *
 * Each view boots its course on its own page (vsync-locked, 1920 x 1080, det=1),
 * waits for the terrain to finish streaming and two more frames, photographs the
 * canvas, then reads GPU milliseconds from timestamp queries (gputime=1) over
 * about 40 frames: the cost of the view without lifting the frame-rate cap, so
 * the machine stays cool. Output goes to tools/goldens/gfx/<label>/ (ignored).
 * --compare writes <a>-vs-<b>/<view>.png: the two shots one above the other,
 * at half size, and a summary of the GPU times.                              */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG, encodePNG } from '../geobuild/png.mjs';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

export const GALLERY = [
  { id: 'puttom-h1-tee-kvall', slug: 'puttom', hole: 1, vy: 'tee', ljus: 'kvall' },
  { id: 'puttom-h5-green-dag', slug: 'puttom', hole: 5, vy: 'green', ljus: 'dag' },
  { id: 'angso-h3-green-kvall', slug: 'angso', hole: 3, vy: 'green', ljus: 'kvall' },
  { id: 'angso-h1-fritt-dag', slug: 'angso', hole: 1, vy: 'fritt', ljus: 'dag' },
  { id: 'norrfallsviken-h2-fritt-dag', slug: 'norrfallsviken', hole: 2, vy: 'fritt', ljus: 'dag' },
  { id: 'norrfallsviken-h1-tee-kvall', slug: 'norrfallsviken', hole: 1, vy: 'tee', ljus: 'kvall' },
  { id: 'johannesberg-h1-tee-sommar', slug: 'johannesberg', hole: 1, vy: 'tee', ljus: 'sommar' },
  { id: 'upsala-h4-tee-gryning', slug: 'upsala', hole: 4, vy: 'tee', ljus: 'gryning' },
  { id: 'veckefjarden-h13-tee-kvall', slug: 'veckefjarden', hole: 13, vy: 'tee', ljus: 'kvall' },
  { id: 'visby-h1-fritt-dag', slug: 'visby', hole: 1, vy: 'fritt', ljus: 'dag' },
  { id: 'ribbingsfors-h3-tee-host', slug: 'ribbingsfors', hole: 3, vy: 'tee', ljus: 'host' },
  { id: 'lidingo-h1-ovan-dag', slug: 'lidingo', hole: 1, vy: 'ovan', ljus: 'dag' },
];

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve('tools/goldens/gfx');

function halve(img) {
  const w = img.width >> 1, h = img.height >> 1, out = new Uint8Array(w * h * 3), c = img.channels;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    const p = (yy, xx) => img.data[((y * 2 + yy) * img.width + x * 2 + xx) * c + k];
    out[(y * w + x) * 3 + k] = (p(0, 0) + p(0, 1) + p(1, 0) + p(1, 1) + 2) >> 2;
  }
  return { width: w, height: h, data: out };
}

if (flag('compare', null)) {
  const [a, b] = flag('compare').split(',');
  const dir = path.join(ROOT, `${a}-vs-${b}`);
  fs.mkdirSync(dir, { recursive: true });
  const ra = JSON.parse(fs.readFileSync(path.join(ROOT, a, 'gallery.json'))), rb = JSON.parse(fs.readFileSync(path.join(ROOT, b, 'gallery.json')));
  for (const view of ra.views) {
    const fa = path.join(ROOT, a, `${view.id}.png`), fb = path.join(ROOT, b, `${view.id}.png`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
    const A = halve(decodePNG(fs.readFileSync(fa))), B = halve(decodePNG(fs.readFileSync(fb)));
    const out = new Uint8Array(A.width * (A.height + B.height + 4) * 3).fill(255);
    out.set(A.data, 0); out.set(B.data, A.width * (A.height + 4) * 3);
    fs.writeFileSync(path.join(dir, `${view.id}.png`), encodePNG(A.width, A.height + B.height + 4, out));
    const vb = rb.views.find(v => v.id === view.id);
    console.log(`${view.id.padEnd(30)} gpu ${view.gpuMs ?? '-'} -> ${vb?.gpuMs ?? '-'} ms   draws ${view.draws} -> ${vb?.draws}`);
  }
  console.log(`sheets in ${dir}`);
  process.exit(0);
}

const LABEL = flag('label', 'gallery');
const QUERY = flag('query', '');
const BASE = flag('base', 'http://127.0.0.1:8620').replace(/\/$/, '');
const pick = flag('views', null)?.split(',');
const views = pick ? GALLERY.filter(v => pick.includes(v.id) || pick.includes(v.slug)) : GALLERY;
const out = path.join(ROOT, LABEL);
fs.mkdirSync(out, { recursive: true });
if (!GPU) console.warn('WARN: BANVY_GPU is not 1; pictures and times are SwiftShader\'s');

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { label: LABEL, query: QUERY, when: new Date().toISOString(), views: [] };
for (const view of views) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n')[0].slice(0, 300)); });
  const url = `${BASE}/?bana=${view.slug}&hal=${view.hole}&vy=${view.vy}&ljus=${view.ljus}&q=hi&qualitylock=1&det=1&gputime=1${args.includes('--gl') ? '&gl=1' : ''}${QUERY ? '&' + QUERY : ''}`;
  const row = { ...view, url, errors };
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#boot.done');
    const f = await page.evaluate(() => window.V3D.frame());
    await page.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 50 });
    const f1 = await page.evaluate(() => window.V3D.frame());
    await page.waitForFunction(f0 => window.V3D.frame() >= f0 + 3 && window.V3D.settled(), f1, { polling: 20 });
    await page.evaluate(() => window.V3D.prepareCapture());
    await page.locator('body > canvas').screenshot({ path: path.join(out, `${view.id}.png`) });
    Object.assign(row, await page.evaluate(async () => {
      const V = window.V3D, ms = [];
      for (let i = 0; i < 40; i++) {
        await new Promise(r => requestAnimationFrame(r));
        /* the sum of every pass of the last frame resolved (tools/frame-time.mjs reads it the same way) */
        if (V.gpuTime && i % 2 === 1) { const t = await V.gpuTime(); if (Number.isFinite(t.ms) && t.ms > 0) ms.push(t.ms); }
      }
      ms.sort((a, b) => a - b);
      const r = V.rendererInfo();
      return { backend: V.stats.backend, gpuMs: ms.length ? +ms[ms.length >> 1].toFixed(2) : null, draws: r.drawCalls, tris: r.triangles };
    }));
  } catch (error) { row.fail = String(error).split('\n')[0]; }
  report.views.push(row);
  console.log(`${row.fail ? 'FAIL' : 'ok  '} ${view.id.padEnd(30)} ${row.backend ?? ''} gpu ${row.gpuMs ?? '-'} ms  draws ${row.draws ?? '-'}${errors.length ? '  ERR ' + errors[0] : ''}${row.fail ? '  ' + row.fail : ''}`);
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'gallery.json'), JSON.stringify(report, null, 2));
console.log(`gallery in ${out}`);
