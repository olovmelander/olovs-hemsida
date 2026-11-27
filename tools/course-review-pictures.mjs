#!/usr/bin/env node
/* EVERY HOLE OF A GROUND, IN BOTH MODES, AS THE REVIEWER SEES IT.

   The owner's decision (27 November 2026): a course is released on the automated reviewer's verdict alone. This
   draws what that reviewer looks at: one sheet a hole, for every hole of every routing of the ground, with
     - Detaljerad 3D from the tee and from above (the desktop's player, high quality, the day's light), and
     - Lätt 3D's view of the hole (the phone map), and
     - the photo with the traced outlines, where the mapping stage drew one (render-source-overlays.py).
   The two modes draw the same records with two renderers, so a fault in either shows as a disagreement; whether
   the outlines match the place is the ring review's question, asked before this. Nothing on a sheet says what is
   known to be wrong: the review is blind (.claude/agents/course-reviewer.md).

     BANVY_GPU=1 node tools/course-review-pictures.mjs --ground <id> [--base <url>] [--holes 1,2]

   Without --base it serves apps/golf/dist, which must be a build of what is published (pnpm --filter @banvy/golf
   build). It writes <build>/cache/visual-review/<slug>-hNN.jpg and report.json (each sheet's sha256), and fails on
   a console error or a view that does not settle. Then: the course-reviewer agent on the sheets, and
   packages/course-workflow/visual-review.mjs --record. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';
import { groundRoutings } from './course-rebuild.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Frames drawn after a view settles before it is taken: the temporal AA's history fills in about a dozen. */
const TAA_FRAMES = 16;
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const sheetId = (slug, hole) => `${slug}-h${String(hole).padStart(2, '0')}`;

/* The photo of a hole with its outlines, if the mapping stage drew one under one of the ground's builds: the newest.
   A ground's routings can build in folders of their own while its photos are drawn under the first. */
export function photoFor(builds, id, root = ROOT) {
  const found = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'visual-review'].includes(entry.name)) walk(full);
      else if (entry.name === `${id}.png` && /[\\/]overlays[^\\/]*$/.test(dir)) found.push(full);
    }
  };
  /* private caches stay in the checkout that fetched them: a worktree reads the main checkout's */
  for (const checkout of new Set([root, mainCheckout(root)])) for (const build of [builds].flat()) walk(path.join(checkout, build, 'cache'));
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

function mainCheckout(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    return path.dirname(common);
  } catch { return root; }
}

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function main() {
  const groundId = flag('--ground');
  if (!groundId) throw new Error('usage: course-review-pictures.mjs --ground <id> [--base <url>] [--holes 1,2]');
  if (!GPU) console.warn('WARN: BANVY_GPU is not 1: the pictures are SwiftShader\'s, slow and not what a golfer sees');
  const { routings } = groundRoutings(groundId);
  if (!routings.length) throw new Error(`${groundId}: no published routing`);
  const only = flag('--holes')?.split(',').map(Number);
  const out = path.join(ROOT, routings[0].build, 'cache', 'visual-review');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  let base = flag('--base'), server = null;
  if (!base) {
    const dist = path.join(ROOT, 'apps/golf/dist');
    const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
    const built = JSON.parse(fs.readFileSync(path.join(dist, 'courses/index.json'), 'utf8'));
    for (const { slug } of routings) {
      const want = published.courses.find(c => c.slug === slug)?.sha256, have = built.courses.find(c => c.slug === slug)?.sha256;
      if (!want || want !== have) throw new Error(`${slug}: apps/golf/dist is not a build of what is published; run pnpm --filter @banvy/golf build`);
    }
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), dist, String(port)], { stdio: 'ignore' });
    base = `http://127.0.0.1:${port}/`;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  base = base.replace(/\/?$/, '/');
  const problems = [], sheets = [];
  const watch = (page, where) => {
    page.on('pageerror', error => problems.push(`${where}: ${String(error).split('\n')[0].slice(0, 240)}`));
    /* a static server has no /api/health; the app's probe of it is not the course's fault */
    page.on('console', message => { if (message.type() === 'error' && !(message.location()?.url ?? '').endsWith('/api/health')) problems.push(`${where}: ${message.text().split('\n')[0].slice(0, 240)}`); });
  };
  const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
  const started = Date.now();
  try {
    for (const routing of routings) {
      const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8')).courses.find(c => c.slug === routing.slug);
      const count = Array.isArray(catalogue?.holes) ? catalogue.holes.length : Number(catalogue?.holes ?? 18);
      const holes = Array.from({ length: count }, (_, i) => i + 1).filter(n => !only || only.includes(n));
      const shots = new Map(holes.map(n => [n, {}]));

      /* Detaljerad 3D: one boot, then every hole from its tee and from above. det=1 pins the clock, the weather
         and the seeds; aa=traa keeps the temporal AA a high-quality desktop draws with, and with it the water's
         mirror of its shores, which det=1 alone leaves out (MSAA): the first look at Bro Hof took a pond drawn
         without it for ice (27 November). The settle waits out the AA's history after every jump. */
      const detailed = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      detailed.setDefaultTimeout(240000);
      watch(detailed, `${routing.slug} Detaljerad 3D`);
      await detailed.goto(`${base}?bana=${routing.slug}&karta=0&hal=${holes[0]}&vy=tee&ljus=dag&q=hi&qualitylock=1&det=1&aa=traa&ren=1`, { waitUntil: 'load' });
      await detailed.waitForSelector('#boot.done');
      const settle = async () => {
        const f = await detailed.evaluate(() => window.V3D.frame());
        await detailed.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 50 });
        const f1 = await detailed.evaluate(() => window.V3D.frame());
        await detailed.waitForFunction(([f0, n]) => window.V3D.frame() >= f0 + n && window.V3D.settled(), [f1, TAA_FRAMES], { polling: 20 });
        await detailed.evaluate(() => window.V3D.prepareCapture());
      };
      for (const n of holes) {
        for (const [view, cam] of [['tee', 'tee'], ['top', 'top']]) {
          await detailed.evaluate(([hole, mode]) => { window.V3D.goHole(hole, true, true); window.V3D.setCam(mode, true); }, [n, cam]);
          await settle();
          shots.get(n)[view] = await detailed.locator('body > canvas').screenshot({ type: 'jpeg', quality: 88 });
        }
      }
      await detailed.close();

      /* Lätt 3D: one start, then every hole as the golfer's phone shows it */
      const map = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      map.setDefaultTimeout(120000);
      watch(map, `${routing.slug} Lätt 3D`);
      await map.goto(`${base}?bana=${routing.slug}&karta=1&hal=${holes[0]}`, { waitUntil: 'load' });
      await map.waitForFunction(() => globalThis.V3DMap?.stats().frames > 0);
      for (const n of holes) {
        await map.evaluate(hole => window.V3DMap.goHole(hole), n);
        for (let i = 0; i < 2; i++) {
          await map.waitForFunction(() => { const s = V3DMap.stats(); return s.busy === 0 && !V3DMap.state.flight; }, null, { polling: 100 });
          await map.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        }
        await map.waitForTimeout(900);
        shots.get(n).map = await map.screenshot({ type: 'jpeg', quality: 88 });
      }
      await map.close();

      /* one sheet a hole */
      /* One sheet a hole, 2 x 2 and at most 1,560 px a side: a reader shrinks a larger picture before it looks, and
         the first sheets, four panels in a row 3,300 px wide, left the phone's panel 100 px wide. */
      const sheet = await browser.newPage({ viewport: { width: 1560, height: 1560 }, deviceScaleFactor: 1 });
      for (const n of holes) {
        const id = sheetId(routing.slug, n), photo = photoFor(routings.map(r => r.build), id);
        const img = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`;
        const panel = (title, src) => `<figure><figcaption>${title}</figcaption>${src ? `<img src="${src}">` : '<div class="none">inget foto med konturer för hålet</div>'}</figure>`;
        await sheet.setContent(`<!doctype html><meta charset="utf-8"><style>
          body { margin: 0; width: 1560px; height: 1560px; background: #14181a; color: #e8ece8; font: 600 22px system-ui, sans-serif; overflow: hidden; }
          header { height: 40px; padding: 8px 14px 0; box-sizing: border-box; }
          main { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; padding: 0 10px 10px; height: 1510px; box-sizing: border-box; }
          figure { margin: 0; display: flex; flex-direction: column; min-height: 0; }
          figcaption { font: 500 16px system-ui, sans-serif; color: #b8c2bc; margin: 0 0 4px; }
          img { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: left top; display: block; }
          .none { flex: 1; display: grid; place-items: center; background: #22282b; border-radius: 6px; color: #8a948e; }
        </style><header>${catalogue?.name ?? routing.slug} · hål ${n}</header><main>
          ${panel('Detaljerad 3D, från tee', img(shots.get(n).tee, 'image/jpeg'))}
          ${panel('Detaljerad 3D, ovanifrån', img(shots.get(n).top, 'image/jpeg'))}
          ${panel('Lätt 3D, hålet', img(shots.get(n).map, 'image/jpeg'))}
          ${panel('Foto med de spårade konturerna', photo ? img(fs.readFileSync(photo), 'image/png') : null)}
        </main>`, { waitUntil: 'load' });
        const bytes = await sheet.screenshot({ type: 'jpeg', quality: 86 });
        fs.writeFileSync(path.join(out, `${id}.jpg`), bytes);
        sheets.push({ id, slug: routing.slug, hole: n, file: `${id}.jpg`, sha256: sha256(bytes), photo: photo ? path.relative(ROOT, photo).split(path.sep).join('/') : null });
      }
      await sheet.close();
      console.log(`${routing.slug}: ${holes.length} holes drawn in both modes (${sheets.filter(s => s.slug === routing.slug && s.photo).length} with the photo)`);
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/v2-index.json'), 'utf8')).courses.filter(c => c.groundId === groundId);
  const report = { schemaVersion: 1, groundId, drawnOn: new Date().toISOString().slice(0, 10), gpu: GPU, seconds: Math.round((Date.now() - started) / 1000),
    courses: published.map(c => c.slug).sort(), sheets, problems };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`${sheets.length} sheets in ${report.seconds} s: ${path.relative(ROOT, out)}${problems.length ? `\n${problems.length} problems:\n  ${problems.slice(0, 12).join('\n  ')}` : ''}`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
